import { describe, it, expect } from 'vitest';
import { SessionConfigSchema, type SessionConfig } from '../src/state';

// A valid baseline config; tests clone + mutate a single field to isolate bounds.
const base: SessionConfig = {
  puzzleId: 'p1',
  puzzleName: 'Test',
  difficulty: 'medium',
  durationSec: 120,
  hintPenalty: 10,
  wrongPenalty: 5,
  maxPlayers: 8,
  allowLate: false,
  strictValidation: true,
};

describe('SessionConfigSchema bounds', () => {
  it('accepts an in-range config', () => {
    expect(SessionConfigSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the boundary values', () => {
    expect(
      SessionConfigSchema.safeParse({
        ...base,
        durationSec: 15,
        hintPenalty: 0,
        wrongPenalty: 0,
        maxPlayers: 1,
      }).success,
    ).toBe(true);
    expect(
      SessionConfigSchema.safeParse({
        ...base,
        durationSec: 600,
        hintPenalty: 120,
        wrongPenalty: 120,
        maxPlayers: 64,
      }).success,
    ).toBe(true);
  });

  describe('durationSec', () => {
    it('rejects below the minimum (14)', () => {
      expect(SessionConfigSchema.safeParse({ ...base, durationSec: 14 }).success).toBe(false);
    });
    it('rejects a negative value', () => {
      expect(SessionConfigSchema.safeParse({ ...base, durationSec: -5 }).success).toBe(false);
    });
    it('rejects above the maximum (601)', () => {
      expect(SessionConfigSchema.safeParse({ ...base, durationSec: 601 }).success).toBe(false);
    });
    it('rejects a non-integer', () => {
      expect(SessionConfigSchema.safeParse({ ...base, durationSec: 30.5 }).success).toBe(false);
    });
    it('rejects Infinity (non-finite)', () => {
      expect(SessionConfigSchema.safeParse({ ...base, durationSec: Infinity }).success).toBe(false);
    });
    it('rejects NaN (non-finite)', () => {
      expect(SessionConfigSchema.safeParse({ ...base, durationSec: NaN }).success).toBe(false);
    });
  });

  describe('hintPenalty / wrongPenalty', () => {
    it('rejects negative penalties', () => {
      expect(SessionConfigSchema.safeParse({ ...base, hintPenalty: -1 }).success).toBe(false);
      expect(SessionConfigSchema.safeParse({ ...base, wrongPenalty: -1 }).success).toBe(false);
    });
    it('rejects penalties above the maximum (121)', () => {
      expect(SessionConfigSchema.safeParse({ ...base, hintPenalty: 121 }).success).toBe(false);
      expect(SessionConfigSchema.safeParse({ ...base, wrongPenalty: 121 }).success).toBe(false);
    });
    it('rejects an Infinity penalty', () => {
      expect(SessionConfigSchema.safeParse({ ...base, hintPenalty: Infinity }).success).toBe(false);
    });
  });

  describe('maxPlayers', () => {
    it('is required', () => {
      const { maxPlayers: _omit, ...withoutMax } = base;
      void _omit;
      expect(SessionConfigSchema.safeParse(withoutMax).success).toBe(false);
    });
    it('rejects 0', () => {
      expect(SessionConfigSchema.safeParse({ ...base, maxPlayers: 0 }).success).toBe(false);
    });
    it('rejects above the maximum (65)', () => {
      expect(SessionConfigSchema.safeParse({ ...base, maxPlayers: 65 }).success).toBe(false);
    });
    it('rejects a non-integer', () => {
      expect(SessionConfigSchema.safeParse({ ...base, maxPlayers: 2.5 }).success).toBe(false);
    });
    it('rejects Infinity', () => {
      expect(SessionConfigSchema.safeParse({ ...base, maxPlayers: Infinity }).success).toBe(false);
    });
  });
});
