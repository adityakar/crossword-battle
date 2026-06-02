// joincode.ts — the canonical join-code format, shared by the worker (the /ws
// guard + the existence check) and the web client (landing validation, player
// preflight). Format: LLL-NNN — 3 letters from the unambiguous alphabet (no I/O)
// + a dash + 3 digits, e.g. "QXR-481". Mirror of apps/worker/src/joincode.ts
// (newJoinCode), kept here so both sides validate against one definition.

export const JOIN_CODE_RE = /^[A-HJ-NP-Z]{3}-\d{3}$/;

// A booth/organizer prefix is the LETTER half of a join code: 3 letters from the
// same unambiguous alphabet (no I/O). A full code is then `<PREFIX>-NNN`, so a
// prefix passes the letter portion of JOIN_CODE_RE by construction.
export const PREFIX_RE = /^[A-HJ-NP-Z]{3}$/;

/** True when `code` is exactly a well-formed join code (LLL-NNN). */
export function isValidJoinCode(code: string): boolean {
  return JOIN_CODE_RE.test(code);
}

/** True when `prefix` is exactly a well-formed booth prefix (3 letters, no I/O). */
export function isValidPrefix(prefix: string): boolean {
  return PREFIX_RE.test(prefix);
}

/** Coerce free input toward a prefix: trim + uppercase. Does NOT guarantee
 *  validity (pair with isValidPrefix for the final check). */
export function normalizePrefix(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Coerce free user input toward the LLL-NNN shape: uppercase, drop anything that
 * isn't a letter or digit, cap at 6 characters, and insert the dash. Does NOT
 * guarantee validity (e.g. letters in the digit slots survive) — pair with
 * isValidJoinCode for the final check.
 */
export function normalizeJoinCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return s.length <= 3 ? s : `${s.slice(0, 3)}-${s.slice(3)}`;
}
