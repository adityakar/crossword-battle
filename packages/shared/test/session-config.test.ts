import { describe, it, expect } from 'vitest';
import { SessionConfigSchema } from '../src/state';

const base = {
  puzzleId: 'p',
  puzzleName: 'P',
  difficulty: 'medium',
  durationSec: 120,
  hintPenalty: 10,
  wrongPenalty: 5,
  maxPlayers: 8,
  allowLate: false,
  strictValidation: true,
};

describe('SessionConfigSchema.aiTone', () => {
  it('is optional — a pre-existing session config without aiTone still parses', () => {
    expect(SessionConfigSchema.safeParse(base).success).toBe(true);
  });
  it('accepts a tone string', () => {
    expect(SessionConfigSchema.parse({ ...base, aiTone: 'warm' }).aiTone).toBe('warm');
  });
  it('rejects an over-length tone', () => {
    expect(SessionConfigSchema.safeParse({ ...base, aiTone: 'x'.repeat(121) }).success).toBe(false);
  });
});
