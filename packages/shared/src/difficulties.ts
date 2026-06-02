// difficulties.ts — difficulty presets. Ported verbatim from prototype
// store.jsx (DIFFICULTIES, lines 273–279). See plan §"Shared contracts".

export interface Difficulty {
  id: string;
  name: string;
  sub: string;
  dur: number; // round duration in seconds
  hint: number; // hint penalty seconds (per hint)
  wrong: number; // wrong-attempt penalty seconds (per wrong)
}

export const DIFFICULTIES: Difficulty[] = [
  { id: 'easy', name: 'Easy', sub: 'Warm-up pace', dur: 360, hint: 8, wrong: 4 },
  { id: 'medium', name: 'Medium', sub: 'Expo standard', dur: 240, hint: 10, wrong: 5 },
  { id: 'hard', name: 'Hard', sub: 'For the competitive', dur: 90, hint: 15, wrong: 8 },
  { id: 'poc', name: 'POC Mode', sub: 'Demo-safe, forgiving', dur: 240, hint: 5, wrong: 0 },
  { id: 'lightning', name: 'Lightning', sub: '60 seconds. Go.', dur: 60, hint: 12, wrong: 6 },
];
