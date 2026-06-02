import { describe, it, expect } from 'vitest';
import { BrandSchema, DEFAULT_BRAND, resolveBrand } from '../src/config';
import { DIFFICULTIES } from '../src/difficulties';

describe('DEFAULT_BRAND', () => {
  it('is the neutral product identity (no event-specific branding)', () => {
    expect(DEFAULT_BRAND.appName).toBe('Crossword Battle');
    expect(DEFAULT_BRAND.accent).toBe('#FE414D');
    expect(DEFAULT_BRAND.eventLine).toBe('');
    expect(DEFAULT_BRAND.venueLabel).toBe('');
  });
});

describe('BrandSchema', () => {
  const valid = {
    appName: 'Acme Cup',
    eventLine: 'ACME · 2026',
    venueLabel: 'Room B',
    accent: '#1a2b3c',
    prizeLabel: 'Trophy',
    aiTone: 'warm',
    topicHint: 'Company history',
  };

  it('accepts a valid brand and normalizes the accent to uppercase', () => {
    const r = BrandSchema.parse(valid);
    expect(r.accent).toBe('#1A2B3C');
    expect(r.appName).toBe('Acme Cup');
  });

  it('trims text and fills omitted optional fields from DEFAULT_BRAND', () => {
    const r = BrandSchema.parse({ appName: '  Acme  ', prizeLabel: 'Prize', accent: '#FE414D' });
    expect(r.appName).toBe('Acme');
    expect(r.eventLine).toBe('');
    expect(r.venueLabel).toBe('');
    expect(r.aiTone).toBe(DEFAULT_BRAND.aiTone);
    expect(r.topicHint).toBe(DEFAULT_BRAND.topicHint);
  });

  it('rejects an empty/whitespace appName', () => {
    expect(BrandSchema.safeParse({ ...valid, appName: '   ' }).success).toBe(false);
  });

  it('defaults the accent when omitted (ZodEffects .default path)', () => {
    const r = BrandSchema.parse({ appName: 'Acme', prizeLabel: 'Prize' });
    expect(r.accent).toBe(DEFAULT_BRAND.accent);
  });

  it('rejects a non-#RRGGBB accent', () => {
    expect(BrandSchema.safeParse({ ...valid, accent: 'red' }).success).toBe(false);
    expect(BrandSchema.safeParse({ ...valid, accent: 'rgb(1,2,3)' }).success).toBe(false);
    expect(BrandSchema.safeParse({ ...valid, accent: '#FFF' }).success).toBe(false);
  });

  it('rejects over-length and control-character text', () => {
    expect(BrandSchema.safeParse({ ...valid, appName: 'x'.repeat(61) }).success).toBe(false);
    expect(BrandSchema.safeParse({ ...valid, eventLine: 'a\u0007b' }).success).toBe(false);
  });
});

describe('resolveBrand', () => {
  it('returns DEFAULT_BRAND for null/undefined', () => {
    expect(resolveBrand(null)).toEqual(DEFAULT_BRAND);
    expect(resolveBrand(undefined)).toEqual(DEFAULT_BRAND);
  });
  it('overlays stored fields over the default', () => {
    expect(resolveBrand({ appName: 'X', venueLabel: 'Booth 9' })).toMatchObject({
      appName: 'X',
      venueLabel: 'Booth 9',
      accent: DEFAULT_BRAND.accent,
    });
  });
  it('ignores explicit undefined fields (keeps the default)', () => {
    expect(resolveBrand({ appName: undefined, venueLabel: 'Booth 9' })).toMatchObject({
      appName: DEFAULT_BRAND.appName,
      venueLabel: 'Booth 9',
    });
  });
});

describe('DIFFICULTIES', () => {
  it('ports the five presets verbatim', () => {
    expect(DIFFICULTIES.map((d) => d.id)).toEqual([
      'easy',
      'medium',
      'hard',
      'poc',
      'lightning',
    ]);
    const byId = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d]));
    expect(byId.easy).toMatchObject({ dur: 360, hint: 8, wrong: 4 });
    expect(byId.medium).toMatchObject({ dur: 240, hint: 10, wrong: 5 });
    expect(byId.hard).toMatchObject({ dur: 90, hint: 15, wrong: 8 });
    expect(byId.poc).toMatchObject({ dur: 240, hint: 5, wrong: 0 });
    expect(byId.lightning).toMatchObject({ dur: 60, hint: 12, wrong: 6 });
    expect(byId.medium!.name).toBe('Medium');
    expect(byId.poc!.name).toBe('POC Mode');
  });
});
