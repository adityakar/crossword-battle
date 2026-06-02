// state.ts — phase machine + public session/player shapes.
// See plan §"Shared contracts (LOCKED)" and design §3, §4.
import { z } from 'zod';

export type Phase = 'idle' | 'lobby' | 'countdown' | 'live' | 'winner';
export const PhaseSchema = z.enum(['idle', 'lobby', 'countdown', 'live', 'winner']);

// Session config (host-controllable). `strictValidation` defaults true.
export const SessionConfigSchema = z.object({
  puzzleId: z.string(),
  puzzleName: z.string(),
  difficulty: z.string(),
  // Bounded so a hostile/garbage patch can't strand a round (e.g. a negative or
  // Infinity duration). `.int()` also rejects non-finite values (Infinity/NaN).
  durationSec: z.number().int().min(15).max(600),
  hintPenalty: z.number().int().min(0).max(120),
  wrongPenalty: z.number().int().min(0).max(120),
  maxPlayers: z.number().int().min(1).max(64),
  allowLate: z.boolean(),
  strictValidation: z.boolean(),
  // AI commentary tone, SNAPSHOTTED from the active brand at session-create time
  // (apps/worker session/create) so the round's tone is fixed and the DO never
  // reads D1 mid-round. Optional: sessions created before this field exists have
  // config_json without it; readers fall back to DEFAULT_BRAND.aiTone.
  aiTone: z.string().max(120).optional(),
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

// Client-safe player projection (NO answer letters; filledPct is non-authoritative).
// No `isYou` field by design: "you" is derived client-side by matching this `id`
// against the player's own playerId (from IdentityMsg). Keeps the wire shape uniform.
export const PublicPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  filledPct: z.number(),
  hintsUsed: z.number(),
  wrongAttempts: z.number(),
  finishMs: z.number().nullable(),
  connected: z.boolean(),
});
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;
