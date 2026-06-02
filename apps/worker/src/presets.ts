// presets.ts — preset puzzle definitions (the seed words + clues used to build
// the bundled "mini" puzzles). Extracted from db.ts so it can be imported with
// NO runtime dependencies (no `@cwb/engine`), which lets the headless protocol
// driver (a Node .mjs that strips types) import it by relative path and
// regenerate a preset's solution deterministically (same words+seed+id as the
// seeder). Ported from prototype/store.jsx PRESET_DEFS (lines 234–262).
//
// IMPORTANT: this module must stay dependency-free (data + types only). Anything
// that imports `@cwb/engine` re-introduces the extensionless `./engine`
// re-export in the engine's index.ts, which native ESM cannot resolve.

export interface PresetDef {
  id: string;
  name: string;
  tag: string;
  topic: string;
  seed: number;
  words: [string, string][];
}

export const PRESET_DEFS: PresetDef[] = [
  {
    id: 'mini-ai',
    name: 'Sprint Mini',
    tag: 'AI-generated',
    topic: 'Machine learning',
    seed: 7,
    words: [
      ['MODEL', 'What you train on a pile of data'],
      ['AGENT', 'Autonomous AI that takes actions on its own'],
      ['DATA', 'The raw fuel every model learns from'],
      ['TOKEN', 'The chunk of text an LLM reads at a time'],
      ['LOGIC', 'Sound step-by-step reasoning'],
      ['LAYER', 'One tier of a neural network'],
    ],
  },
  {
    id: 'mini-tech',
    name: 'Stack Trace',
    tag: 'AI-generated',
    topic: 'Software engineering',
    seed: 23,
    words: [
      ['CACHE', 'Fast storage for recently used data'],
      ['ARRAY', 'An ordered list of values, by index'],
      ['QUERY', 'A request sent to a database'],
      ['DEBUG', 'Hunt down and squash errors'],
      ['LOOP', 'A block that repeats'],
      ['BYTE', 'Eight bits'],
    ],
  },
];
