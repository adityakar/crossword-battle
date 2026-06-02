// components/index.ts — shared component library barrel.
// Faithful TSX ports of the prototype's ui.jsx / organizer.jsx components,
// built on the ported design system (styles/global.css). The device-frame
// harness (PhoneFrame / DisplayFrame / StatusBar) is intentionally omitted.

export { Mark, Wordmark } from './Brand';
export type { MarkProps, WordmarkProps } from './Brand';

export {
  Screen,
  Btn,
  Chip,
  KV,
  Stat,
  Bar,
  Spark,
  Avatar,
  Stepper,
  Toggle,
} from './Primitives';
export type {
  ScreenProps,
  BtnProps,
  BtnKind,
  ChipProps,
  ChipKind,
  KVProps,
  StatProps,
  BarProps,
  SparkProps,
  AvatarProps,
  StepperProps,
  ToggleProps,
} from './Primitives';

export { Crossword } from './Crossword';
export type { CrosswordProps, CrosswordSelection } from './Crossword';

export { LbRow } from './LbRow';
export type { LbRowProps } from './LbRow';

export { ClueCard } from './Cards';
export type { ClueCardProps } from './Cards';

export { HowToPlay } from './HowToPlay';
export type { HowToPlayProps } from './HowToPlay';

export { LetterPad } from './LetterPad';
export type { LetterPadProps } from './LetterPad';

export { QR } from './QR';
export type { QRProps } from './QR';

export { ShapeGrid } from './ShapeGrid';
export type { ShapeGridProps } from './ShapeGrid';

export { HeaderMenu } from './HeaderMenu';
export type { HeaderMenuItem } from './HeaderMenu';
