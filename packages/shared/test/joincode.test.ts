import { describe, it, expect } from 'vitest';
import {
  isValidJoinCode,
  normalizeJoinCode,
  JOIN_CODE_RE,
  isValidPrefix,
  normalizePrefix,
  PREFIX_RE,
} from '../src/joincode';

describe('isValidJoinCode', () => {
  it('accepts well-formed LLL-NNN codes', () => {
    expect(isValidJoinCode('QXR-481')).toBe(true);
    expect(isValidJoinCode('SPR-742')).toBe(true);
    expect(isValidJoinCode('ABC-000')).toBe(true);
  });

  it('rejects the ambiguous letters I and O', () => {
    expect(isValidJoinCode('QIR-481')).toBe(false);
    expect(isValidJoinCode('QOR-481')).toBe(false);
  });

  it('rejects malformed shapes', () => {
    expect(isValidJoinCode('SPR-7K2')).toBe(false); // letter in the digit slot
    expect(isValidJoinCode('QX-481')).toBe(false); // too few letters
    expect(isValidJoinCode('QXR481')).toBe(false); // missing dash
    expect(isValidJoinCode('QXR-48')).toBe(false); // too few digits
    expect(isValidJoinCode('qxr-481')).toBe(false); // lowercase
    expect(isValidJoinCode('')).toBe(false);
  });

  it('is anchored (no surrounding junk)', () => {
    expect(JOIN_CODE_RE.test(' QXR-481 ')).toBe(false);
    expect(JOIN_CODE_RE.test('QXR-481X')).toBe(false);
  });
});

describe('normalizeJoinCode', () => {
  it('uppercases, strips junk, and inserts the dash', () => {
    expect(normalizeJoinCode('qxr481')).toBe('QXR-481');
    expect(normalizeJoinCode('qxr-481')).toBe('QXR-481');
    expect(normalizeJoinCode('qxr 481')).toBe('QXR-481');
  });

  it('shapes partial input without forcing a dash too early', () => {
    expect(normalizeJoinCode('qx')).toBe('QX');
    expect(normalizeJoinCode('qxr')).toBe('QXR');
    expect(normalizeJoinCode('qxr4')).toBe('QXR-4');
  });

  it('caps length at 6 significant characters', () => {
    expect(normalizeJoinCode('qxr4810000')).toBe('QXR-481');
  });

  it('round-trips with isValidJoinCode for valid input', () => {
    expect(isValidJoinCode(normalizeJoinCode('qxr481'))).toBe(true);
  });
});

describe('isValidPrefix', () => {
  it('accepts 3 letters from the unambiguous alphabet', () => {
    expect(isValidPrefix('PUB')).toBe(true);
    expect(isValidPrefix('XYZ')).toBe(true);
    expect(isValidPrefix('ABC')).toBe(true);
  });

  it('rejects the ambiguous letters I and O', () => {
    expect(isValidPrefix('PIO')).toBe(false);
    expect(isValidPrefix('AIB')).toBe(false);
    expect(isValidPrefix('AOB')).toBe(false);
  });

  it('rejects wrong length, digits, lowercase, junk', () => {
    expect(isValidPrefix('PU')).toBe(false);
    expect(isValidPrefix('PUBL')).toBe(false);
    expect(isValidPrefix('PU1')).toBe(false);
    expect(isValidPrefix('pub')).toBe(false);
    expect(isValidPrefix('')).toBe(false);
  });

  it('is anchored (no surrounding junk)', () => {
    expect(PREFIX_RE.test(' PUB ')).toBe(false);
    expect(PREFIX_RE.test('PUB-')).toBe(false);
  });

  it('a valid prefix is the letter half of a valid join code', () => {
    expect(isValidJoinCode(`${normalizePrefix('pub')}-001`)).toBe(true);
  });
});

describe('normalizePrefix', () => {
  it('trims and uppercases', () => {
    expect(normalizePrefix(' pub ')).toBe('PUB');
    expect(normalizePrefix('xyz')).toBe('XYZ');
    expect(normalizePrefix('PuB')).toBe('PUB');
  });
});
