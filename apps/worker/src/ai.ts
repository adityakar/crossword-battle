// ai.ts — server-side AI word/clue drafting via OpenRouter (design §9, Task 7).
//
// `draftWords` calls OpenRouter's chat-completions endpoint with the prototype's
// prompt contract (builder.jsx lines ~95-123), then runs the SAME defensive
// parse the prototype did client-side — now isolated in `parseDraftResponse` so
// it is unit-testable without a live endpoint. On ANY failure (no key, network,
// timeout, parse, too-few) it returns a deterministic curated fallback so the
// builder still works offline. The fallback list interlocks and is clue-leak
// clean (it must survive the /api/puzzles `clueLeaksAnswer` guard).
import { clueLeaksAnswer } from '@cwb/engine';
import type { Env } from './index';

export interface DraftEntry {
  answer: string;
  clue: string;
}

export interface DraftResult {
  entries: DraftEntry[];
  source: 'ai' | 'fallback';
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 12_000;
// Hard cap on the model text we regex + JSON.parse, so a pathological/huge
// upstream body can't become a CPU/memory DoS. A valid reply (max_tokens 700)
// is a few KB; 20k chars is generous headroom.
const MAX_RESPONSE_CHARS = 20_000;

// Deterministic curated starter set. Short, common-letter words that interlock,
// with clues that never contain their own answer. Used whenever the live AI
// call cannot produce a usable result. Generic enough for any topic.
// Exported so a test can prove they actually build a grid (the "works offline"
// guarantee) and survive the /api/puzzles clue-leak guard.
export const FALLBACK_ENTRIES: DraftEntry[] = [
  { answer: 'MODEL', clue: 'What you train on a pile of data' },
  { answer: 'AGENT', clue: 'Autonomous doer that takes actions' },
  { answer: 'DATA', clue: 'Raw fuel every system learns from' },
  { answer: 'TOKEN', clue: 'A small chunk of text or value' },
  { answer: 'LOGIC', clue: 'Sound step-by-step reasoning' },
  { answer: 'LAYER', clue: 'One tier of a stack' },
  { answer: 'NODE', clue: 'A single point in a network' },
  { answer: 'ARRAY', clue: 'An ordered list, by index' },
  { answer: 'CACHE', clue: 'Fast storage for recent items' },
  { answer: 'QUERY', clue: 'A request sent to a database' },
];

/**
 * Defensive parser for the model's raw text. Extracts the first `[...]` block,
 * JSON-parses it, then maps + filters entries to the LOCKED shape:
 *   - answer: UPPERCASE, A-Z only, 3-7 letters
 *   - clue:   trimmed, non-empty
 * Drops any entry whose clue leaks its own answer, and dedupes by answer.
 * Returns `null` when fewer than 2 valid entries survive (so the caller can fall
 * back). `count` caps the number of entries returned.
 */
export function parseDraftResponse(rawText: string, count: number): DraftEntry[] | null {
  if (typeof rawText !== 'string') return null;
  const match = rawText.match(/\[[\s\S]*\]/);
  if (!match) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  const seen = new Set<string>();
  const out: DraftEntry[] = [];
  for (const raw of arr) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rawAnswer = (raw as { answer?: unknown }).answer;
    const rawClue = (raw as { clue?: unknown }).clue;
    const answer = (typeof rawAnswer === 'string' ? rawAnswer : '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
    const clue = (typeof rawClue === 'string' ? rawClue : '').trim();
    if (answer.length < 3 || answer.length > 7) continue;
    if (!clue) continue;
    if (clueLeaksAnswer(answer, clue)) continue;
    if (seen.has(answer)) continue;
    seen.add(answer);
    out.push({ answer, clue });
    if (out.length >= count) break;
  }
  return out.length >= 2 ? out : null;
}

// Build the prompt — faithful to prototype/builder.jsx, with the active event's
// aiTone injected so generated clues match the deployment's voice.
function buildPrompt(topic: string, count: number, aiTone: string): string {
  return `You are building a tiny crossword for a live event game. Topic / theme: "${topic}".
Write the clues in a ${aiTone} tone.
Produce exactly ${count} entries that interlock well (favor common letters like A, E, R, S, T, O, N).
Each entry has:
- "answer": ONE word, UPPERCASE, letters only, 3 to 7 letters, no spaces or punctuation
- "clue": a short, clever clue (max 9 words). Never include the answer in its own clue.
Return ONLY a raw JSON array, no prose, no code fences. Example:
[{"answer":"MODEL","clue":"What you train on data"},{"answer":"AGENT","clue":"Autonomous AI doer"}]`;
}

/**
 * Draft `count` word/clue entries for `topic` via OpenRouter. Returns the parsed
 * entries with `source:'ai'`, or a deterministic curated fallback with
 * `source:'fallback'` on ANY failure (missing key, network, timeout, parse, or
 * too-few usable entries). Never throws.
 */
export async function draftWords(
  env: Env,
  topic: string,
  count: number,
  aiTone: string,
): Promise<DraftResult> {
  const fallback = (): DraftResult => ({
    entries: FALLBACK_ENTRIES.slice(0, count),
    source: 'fallback',
  });

  const apiKey = env.OPENROUTER_API_KEY;
  // No key in this environment (e.g. the test pool) → fall back BEFORE any fetch
  // so we never hang on the timeout or make a doomed request.
  if (!apiKey) return fallback();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [{ role: 'user', content: buildPrompt(topic, count, aiTone) }],
        max_tokens: 700,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback();
    const data = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    // Cap before regex/JSON.parse (defensive against a hostile/huge body).
    const text = (typeof content === 'string' ? content : '').slice(0, MAX_RESPONSE_CHARS);
    const parsed = parseDraftResponse(text, count);
    if (!parsed) return fallback();
    return { entries: parsed, source: 'ai' };
  } catch {
    // Network error, abort/timeout, or malformed JSON body — fall back.
    return fallback();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Winner commentary (design §9 AI touchpoint) — the one-line "AI COMMENTARY" on
// the winner screens. Like draftWords it has a deterministic fallback so the
// public booth NEVER shows an empty/AI-error card: the DurableObject sets the
// fallback line instantly, then calls `winnerCommentary` to upgrade it to a live
// model line when OpenRouter responds. A shorter timeout than drafting (the line
// is tiny + the fallback is already on-screen).
// ---------------------------------------------------------------------------
const COMMENTARY_TIMEOUT_MS = 8_000;
const MAX_COMMENTARY_CHARS = 240;

export interface WinnerCommentaryParams {
  name: string;
  time: string; // m:ss finish time (already formatted)
  hintsUsed: number;
  wrongAttempts: number;
  puzzleName: string;
}

// Deterministic winner line — the guaranteed fallback (and the instant line the
// DO shows before the AI call resolves). Varies by how cleanly they solved.
export function fallbackWinnerLine(p: WinnerCommentaryParams): string {
  if (p.hintsUsed === 0 && p.wrongAttempts === 0) {
    return `Clean sheet — no hints, no misses, ${p.time} flat. The model is taking notes.`;
  }
  if (p.hintsUsed > 0) {
    return `${p.time} with a little help from the assistant. Resourceful is a strategy.`;
  }
  return `${p.time} and steady hands. A worthy floor champion.`;
}

function buildCommentaryPrompt(p: WinnerCommentaryParams, aiTone: string): string {
  return `You are the live MC for a crossword game show at an event booth.
In a ${aiTone} tone, write ONE short sentence (max 20 words) celebrating the winner.
Do not use quotation marks, emoji, or the word "winner". Return ONLY the sentence.
Winner name: ${p.name}
Puzzle: ${p.puzzleName}
Finish time: ${p.time}
Hints used: ${p.hintsUsed}
Wrong attempts: ${p.wrongAttempts}`;
}

// Defensive parse of the model's reply → a single clean sentence (or null so the
// caller keeps the deterministic fallback). Strips code fences, takes the first
// non-empty line, removes wrapping quotes, and caps the length.
export function parseCommentary(rawText: string): string | null {
  if (typeof rawText !== 'string') return null;
  let s = rawText.trim();
  // Drop a leading ```lang fence and a trailing fence if the model wrapped it.
  s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  const line = s
    .split('\n')
    .map((x) => x.trim())
    .find(Boolean);
  if (!line) return null;
  // Strip wrapping straight/smart quotes.
  let out = line.replace(/^["'“‘]+/, '').replace(/["'”’]+$/, '').trim();
  if (!out) return null;
  if (out.length > MAX_COMMENTARY_CHARS) out = out.slice(0, MAX_COMMENTARY_CHARS).trim();
  return out;
}

/**
 * Generate a one-line winner commentary via OpenRouter. Returns the parsed AI
 * line, or `null` on ANY failure (no key, network, timeout, !ok, empty parse) so
 * the caller keeps the deterministic `fallbackWinnerLine`. Never throws.
 */
export async function winnerCommentary(
  env: Env,
  p: WinnerCommentaryParams,
  aiTone: string,
): Promise<string | null> {
  const apiKey = env.OPENROUTER_API_KEY;
  // No key (test pool / offline) → keep the fallback without a doomed fetch.
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMMENTARY_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [{ role: 'user', content: buildCommentaryPrompt(p, aiTone) }],
        max_tokens: 80,
        temperature: 0.8,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    const text = (typeof content === 'string' ? content : '').slice(0, MAX_RESPONSE_CHARS);
    return parseCommentary(text);
  } catch {
    // Network error, abort/timeout, or malformed JSON — keep the fallback.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
