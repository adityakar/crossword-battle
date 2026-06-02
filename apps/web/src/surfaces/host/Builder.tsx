// Builder.tsx — organizer's "Create Puzzle" flow. Faithful TSX port of
// prototype/builder.jsx (OrgBuilder), wired to the real generators:
//   - Manual + AI words feed the CLIENT-side `generatePuzzle` for a live preview.
//   - "Generate with AI" calls the SERVER (`api.aiDraftWords` → OpenRouter, with
//     a curated fallback) to draft editable words.
//   - "Use This Puzzle" POSTs to `/api/puzzles`; the SERVER re-generates and
//     stores the canonical puzzle (source of truth) and returns its id. We then
//     return to /host Setup with the new puzzle pre-selected.
//
// The preview is just a preview: the stored grid comes from the server. The
// deterministic generator means they match, but we never assume byte-identity.
import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  generatePuzzle,
  toPublicPuzzle,
  type GenerateResult,
} from '@cwb/engine';
import { Btn, Chip, Crossword, Screen, Spark, Stepper, Wordmark } from '../../components';
import { useEvent } from '../../lib/event';
import { useHostShell } from '../../lib/useHostShell';
import { useMediaQuery } from '../../lib/useMediaQuery';
import * as api from '../../lib/api';

interface Row {
  answer: string;
  clue: string;
}

// ---- mini grid preview (with answers — the organizer owns this puzzle) ----
// The shared Crossword renders letters from `entries`, not from a grid, so we
// build an answer map ("r,c" -> letter) from the full Puzzle's grid.
function MiniPreview({ result }: { result: GenerateResult }) {
  const pz = result.puzzle;
  const cell = Math.max(16, Math.min(34, Math.floor(300 / Math.max(pz.rows, pz.cols))));
  const pub = useMemo(() => toPublicPuzzle(pz), [pz]);
  const entries = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [r, c] of pz.fill) {
      const letter = pz.grid[r]?.[c];
      if (letter) m[`${r},${c}`] = letter;
    }
    return m;
  }, [pz]);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 14px' }}>
        <Crossword puzzle={pub} entries={entries} reveal interactive={false} cellSize={cell} />
      </div>
      <div className="label" style={{ textAlign: 'center' }}>
        {pz.rows}×{pz.cols} · {pz.across.length + pz.down.length} WORDS · {pz.cellCount} CELLS
      </div>
      {result.dropped.length > 0 && (
        <div className="well" style={{ marginTop: 12, padding: '11px 14px' }}>
          <div className="label" style={{ color: 'var(--coral-ink)' }}>
            COULDN&apos;T INTERLOCK
          </div>
          <div className="body" style={{ fontSize: 12, marginTop: 5 }}>
            {result.dropped.join(', ')} — these don&apos;t share letters with the rest. Tweak or swap
            them.
          </div>
        </div>
      )}
    </div>
  );
}

// ---- one word/clue row ----
function WordRow({
  idx,
  row,
  count,
  onChange,
  onRemove,
  onMove,
}: {
  idx: number;
  row: Row;
  count: number;
  onChange: (i: number, k: keyof Row, v: string) => void;
  onRemove: (i: number) => void;
  onMove: (i: number, delta: number) => void;
}) {
  const chev = (dir: number, disabled: boolean) => (
    <button
      onClick={() => !disabled && onMove(idx, dir)}
      disabled={disabled}
      aria-label={dir < 0 ? 'move up' : 'move down'}
      style={{
        width: 24,
        height: 20,
        borderRadius: 5,
        border: '1px solid var(--line-2)',
        background: 'transparent',
        color: disabled ? 'var(--line-3)' : 'var(--grey)',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        lineHeight: 1,
      }}
    >
      {dir < 0 ? '▲' : '▼'}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0, paddingTop: 1 }}
      >
        {chev(-1, idx === 0)}
        {chev(1, idx === count - 1)}
      </div>
      <input
        value={row.answer}
        onChange={(e) => onChange(idx, 'answer', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
        placeholder="WORD"
        maxLength={9}
        style={{
          width: 82,
          flexShrink: 0,
          fontFamily: 'var(--mono)',
          fontWeight: 600,
          fontSize: 15,
          letterSpacing: '0.05em',
          color: 'var(--ink)',
          background: 'var(--paper)',
          border: '1.5px solid var(--line-2)',
          borderRadius: 8,
          padding: '11px 10px',
          outline: 'none',
        }}
      />
      <input
        value={row.clue}
        onChange={(e) => onChange(idx, 'clue', e.target.value)}
        placeholder="Clue for this word"
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'var(--sans)',
          fontSize: 14,
          color: 'var(--ink)',
          background: 'var(--paper)',
          border: '1.5px solid var(--line-2)',
          borderRadius: 8,
          padding: '12px 12px',
          outline: 'none',
        }}
      />
      <button
        onClick={() => onRemove(idx)}
        aria-label="remove"
        style={{
          flexShrink: 0,
          width: 36,
          height: 42,
          borderRadius: 8,
          border: '1px solid var(--line-2)',
          background: 'transparent',
          color: 'var(--grey-soft)',
          cursor: 'pointer',
          fontSize: 18,
        }}
      >
        ×
      </button>
    </div>
  );
}

type Mode = 'manual' | 'ai';

export function Builder() {
  const navigate = useNavigate();
  const event = useEvent();
  useHostShell();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [mode, setMode] = useState<Mode>('manual');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([
    { answer: '', clue: '' },
    { answer: '', clue: '' },
    { answer: '', clue: '' },
    { answer: '', clue: '' },
  ]);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(6);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);

  const setRow = (i: number, k: keyof Row, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { answer: '', clue: '' }]);
  const removeRow = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  const moveRow = (i: number, delta: number) =>
    setRows((rs) => {
      const j = i + delta;
      if (j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const validRows = rows.filter((r) => r.answer.trim().length >= 2 && r.clue.trim());

  // Build the client-side preview grid from a set of entries.
  const build = useCallback(
    (entries: Row[], meta: { name: string; tag: string; topic?: string }) => {
      const res = generatePuzzle(entries, { ...meta, seed: Math.floor(Math.random() * 1e6) });
      if (!res) {
        setError('Need at least 2 words that share letters.');
        setResult(null);
        return;
      }
      setError(null);
      setResult(res);
    },
    [],
  );

  const buildManual = () => {
    if (validRows.length < 2) {
      setError('Add at least 2 words, each with a clue.');
      return;
    }
    build(validRows, { name: name.trim() || 'Custom Puzzle', tag: 'Custom' });
  };

  const generateAI = async () => {
    if (!topic.trim()) {
      setError('Describe a topic or theme first.');
      return;
    }
    setLoading(true);
    setError(null);
    setAiNote(null);
    setResult(null);
    try {
      const { entries, source } = await api.aiDraftWords(topic.trim(), count);
      if (!entries.length) throw new Error('empty');
      const nextRows: Row[] = entries.map((e) => ({ answer: e.answer, clue: e.clue }));
      setRows(nextRows);
      setName(
        topic
          .trim()
          .replace(/\b\w/g, (ch) => ch.toUpperCase())
          .slice(0, 28),
      );
      setAiNote(
        source === 'fallback'
          ? 'AI was unavailable — used a starter set; edit freely.'
          : null,
      );
      // Auto-build the grid and switch to Manual to review the generated words.
      build(nextRows, { name: topic.trim().slice(0, 28) || 'AI Puzzle', tag: 'AI-generated', topic: topic.trim() });
      setMode('manual');
    } catch {
      setError('AI generation hit a snag — try a more concrete topic, or add words manually.');
    } finally {
      setLoading(false);
    }
  };

  // Persist the puzzle server-side (source of truth), then return to Setup with
  // the new puzzle pre-selected.
  const useIt = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const words = result.placed
        .map((answer) => ({ answer, clue: result.puzzle.clues[answer] ?? '' }))
        // Defensive: drop any word we somehow have no clue for.
        .filter((w) => w.clue.trim().length > 0);
      // Include any dropped words too, so the server sees the full intent (it will
      // re-run the generator and drop the same non-interlocking words).
      for (const answer of result.dropped) {
        const clue = result.puzzle.clues[answer];
        if (clue && clue.trim()) words.push({ answer, clue });
      }
      const finalName = name.trim() || result.puzzle.name || 'Custom Puzzle';
      const { id } = await api.createPuzzle(finalName, words);
      navigate('/host', { state: { openSetup: true, puzzleId: id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the puzzle.');
    } finally {
      setSaving(false);
    }
  };

  const tab = (id: Mode, label: string) => (
    <button
      onClick={() => {
        setMode(id);
        setError(null);
      }}
      style={{
        flex: 1,
        padding: '11px',
        borderRadius: 9,
        cursor: 'pointer',
        fontFamily: 'var(--head)',
        fontWeight: 600,
        fontSize: 14,
        border: '1.5px solid ' + (mode === id ? 'var(--ink)' : 'var(--line)'),
        background: mode === id ? 'var(--ink)' : 'transparent',
        color: mode === id ? 'var(--cream)' : 'var(--grey)',
      }}
    >
      {label}
    </button>
  );

  const headerBar = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 22px 14px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <Wordmark />
      <Chip kind="coral-soft">
        <Spark size={10} />
        NEW PUZZLE
      </Chip>
    </div>
  );

  const intro = (
    <>
      <div className="label">PUZZLE BUILDER</div>
      <div className="h1" style={{ fontSize: 30, marginTop: 8 }}>
        Make a crossword
      </div>
      <p className="body" style={{ fontSize: 14, marginTop: 10, maxWidth: '46ch' }}>
        Add your own words &amp; clues, or let AI draft them from a topic. The grid sizes itself
        around whatever interlocks.
      </p>
    </>
  );

  const modeTabs = (
    <div style={{ display: 'flex', gap: 8 }}>
      {tab('manual', 'Manual')}
      {tab('ai', 'AI assist')}
    </div>
  );

  const editorSection =
    mode === 'ai' ? (
      <>
        <div className="label" style={{ marginBottom: 8 }}>
          TOPIC OR PROMPT
        </div>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          placeholder={'e.g. ' + event.topicHint}
          style={{
            width: '100%',
            fontFamily: 'var(--sans)',
            fontSize: 15,
            color: 'var(--ink)',
            background: 'var(--paper)',
            border: '1.5px solid var(--line-2)',
            borderRadius: 12,
            padding: '14px',
            outline: 'none',
            resize: 'vertical',
            lineHeight: 1.4,
          }}
        />
        <div className="kv" style={{ marginTop: 16, alignItems: 'center' }}>
          <span className="label">HOW MANY WORDS</span>
          <Stepper value={count} set={setCount} min={4} max={10} step={1} />
        </div>
        <div style={{ marginTop: 18 }}>
          <Btn kind="dark" disabled={loading} onClick={generateAI}>
            {loading ? (
              'Drafting with AI…'
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Spark color="var(--cream)" /> Generate with AI
              </span>
            )}
          </Btn>
        </div>
        <div className="body" style={{ fontSize: 12, marginTop: 10, color: 'var(--grey-soft)' }}>
          AI drafts words + clues, then you can edit them in the Manual tab before building.
        </div>
      </>
    ) : (
      <>
        <div className="kv" style={{ marginBottom: 10 }}>
          <span className="label">WORDS &amp; CLUES</span>
          <span className="label">{validRows.length} READY</span>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Puzzle name (optional)"
          style={{
            width: '100%',
            marginBottom: 12,
            fontFamily: 'var(--head)',
            fontWeight: 600,
            fontSize: 15,
            color: 'var(--ink)',
            background: 'var(--paper)',
            border: '1.5px solid var(--line-2)',
            borderRadius: 8,
            padding: '12px',
            outline: 'none',
          }}
        />
        {aiNote && (
          <div className="body" style={{ fontSize: 12, marginBottom: 10, color: 'var(--grey-soft)' }}>
            {aiNote}
          </div>
        )}
        <div className="stack" style={{ '--gap': '8px' } as CSSProperties}>
          {rows.map((row, i) => (
            <WordRow
              key={i}
              idx={i}
              row={row}
              count={rows.length}
              onChange={setRow}
              onRemove={removeRow}
              onMove={moveRow}
            />
          ))}
        </div>
        <button onClick={addRow} className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }}>
          + Add word
        </button>
      </>
    );

  const buildSection = (
    <>
      <Btn kind={mode === 'ai' ? 'ghost' : 'coral'} onClick={buildManual} disabled={validRows.length < 2}>
        {result ? 'Rebuild grid' : 'Build grid'} ({validRows.length} words)
      </Btn>
      {error && (
        <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--coral-ink)' }}>
          {error}
        </div>
      )}
    </>
  );

  const previewCard = result ? (
    <>
      <div className="label" style={{ marginBottom: 10 }}>
        PREVIEW · {(name || 'Custom Puzzle').toUpperCase()}
      </div>
      <div className="card" style={{ padding: '16px' }}>
        <MiniPreview result={result} />
      </div>
    </>
  ) : null;

  const useItBtn = (
    <Btn kind="coral" disabled={!result || saving} onClick={useIt}>
      {saving ? 'Saving…' : result ? 'Use This Puzzle →' : 'Build a grid to continue'}
    </Btn>
  );
  const cancelBtn = (
    <Btn kind="ghost" onClick={() => navigate('/host')}>
      Cancel
    </Btn>
  );

  // ---------------- desktop two-pane (>=1024px): editor | sticky preview ----------------
  if (isDesktop) {
    return (
      <>
        {headerBar}
        <div className="host-page">
          <div style={{ marginBottom: 26 }}>{intro}</div>
          <div className="host-split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 420px)' }}>
            <div className="stack" style={{ '--gap': '18px' } as CSSProperties}>
              {modeTabs}
              <div>{editorSection}</div>
              <div>{buildSection}</div>
            </div>
            <div>
              <div style={{ position: 'sticky', top: 0 }}>
                {previewCard ?? (
                  <div className="well" style={{ padding: '40px 20px', textAlign: 'center' }}>
                    <div className="label">PREVIEW</div>
                    <div className="body" style={{ fontSize: 13, marginTop: 8 }}>
                      Build a grid to preview it here.
                    </div>
                  </div>
                )}
                <div className="host-actions" style={{ marginTop: 16 }}>
                  {useItBtn}
                  {cancelBtn}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ---------------- phone layout (unchanged) ----------------
  return (
    <Screen
      footer={
        <div className="stack" style={{ '--gap': '10px' } as CSSProperties}>
          {useItBtn}
          {cancelBtn}
        </div>
      }
    >
      {headerBar}
      <div className="pad" style={{ paddingTop: 20 }}>
        {intro}
      </div>
      <div className="pad" style={{ marginTop: 18 }}>
        {modeTabs}
      </div>
      <div className="pad" style={{ marginTop: 18 }}>
        {editorSection}
      </div>
      <div className="pad" style={{ marginTop: 18 }}>
        {buildSection}
      </div>
      {result && (
        <div className="pad" style={{ marginTop: 22 }}>
          {previewCard}
        </div>
      )}
    </Screen>
  );
}
