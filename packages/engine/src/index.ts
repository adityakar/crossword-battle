// @cwb/engine — pure TS crossword engine. See plan §"Shared contracts" and design §6.
export type {
  Cell,
  Grid,
  Dir,
  WordDef,
  Puzzle,
  PublicWord,
  PublicPuzzle,
  GenerateResult,
  GenerateMeta,
} from './types';

export {
  rngFrom,
  buildPuzzle,
  generatePuzzle,
  clueLeaksAnswer,
  toPublicPuzzle,
  validateSolution,
  solutionAt,
  progressFilled,
  pIsBlock,
  pWordAt,
  pDirFor,
  pStep,
  firstSel,
} from './engine';
