// config.ts — white-label brand. "Crossword Battle" is the product; a single
// editable Brand (persisted in D1, see apps/worker/src/db.ts) re-skins it for any
// event. DEFAULT_BRAND is the neutral out-of-the-box identity used until an
// organizer saves one (and as the merge base for partial/stored values).
import { z } from 'zod';

export interface Brand {
  appName: string;
  eventLine: string; // mono sub-lockup, e.g. "ACME CO. · TEAM OFFSITE"; may be ''
  venueLabel: string; // "Booth 14" / "Room B" / "Table 3"; may be ''
  accent: string; // #RRGGBB
  prizeLabel: string; // "Prize" / "Bragging rights"
  aiTone: string; // AI commentary/draft tone
  topicHint: string; // suggested crossword topics (builder placeholder)
}

// Neutral default — no event-specific branding. Coral accent is unchanged.
export const DEFAULT_BRAND: Brand = {
  appName: 'Crossword Battle',
  eventLine: '',
  venueLabel: '',
  accent: '#FE414D',
  prizeLabel: 'Prize',
  aiTone: 'dry, confident, lightly witty',
  topicHint: 'Anything your crowd knows — pop culture, your team, the topic of the day',
};

// Reject control characters so free-text fields can't break the UI/prompt.
const NO_CTRL = /^[^\u0000-\u001F\u007F]*$/;
const reqText = (max: number) =>
  z.string().trim().min(1).max(max).regex(NO_CTRL, 'no control characters');
const optText = (max: number) =>
  z.string().trim().max(max).regex(NO_CTRL, 'no control characters');
// 6-hex only (no rgb()/named/short forms), normalized to uppercase — so the value
// written into the --coral CSS custom property on the client is always inert.
const accentField = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'accent must be a #RRGGBB hex color')
  .transform((s) => s.toUpperCase());

// Validates a brand for PUT /api/config. Omitted optional fields fall back to
// DEFAULT_BRAND values via .default(), so the row is always fully populated.
export const BrandSchema = z.object({
  appName: reqText(60),
  eventLine: optText(120).default(''),
  venueLabel: optText(60).default(''),
  accent: accentField.default(DEFAULT_BRAND.accent),
  prizeLabel: reqText(40),
  aiTone: optText(120).default(DEFAULT_BRAND.aiTone),
  topicHint: optText(160).default(DEFAULT_BRAND.topicHint),
});

// Compile-time parity: the schema's output type must satisfy Brand.
type _BrandParity = z.infer<typeof BrandSchema> extends Brand ? true : never;
const _brandParity: _BrandParity = true;
void _brandParity;

// Merge a stored/partial brand over the neutral default → a complete Brand.
// Explicit `undefined` fields are dropped so they can't override a default and
// leave the result violating the Brand contract (e.g. accent: undefined).
export function resolveBrand(stored: Partial<Brand> | null | undefined): Brand {
  const defined = Object.fromEntries(
    Object.entries(stored ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<Brand>;
  return { ...DEFAULT_BRAND, ...defined };
}
