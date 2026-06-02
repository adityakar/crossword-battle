// messages.ts — full WebSocket protocol as zod discriminated unions on `t`.
// See design §4. `t` discriminator values are the lowercase camelCase wire
// names enumerated in Task 3 (the spec's HELLO/OPEN_LOBBY etc. are prose names).
import { z } from 'zod';
import type { PublicPuzzle } from '@cwb/engine';
import { PhaseSchema, SessionConfigSchema, PublicPlayerSchema } from './state';
import { ScoreSchema } from './scoring';

// ============================================================
// Client → Server
// ============================================================

// One HELLO shape: role is an enum; player/tv identity fields stay optional.
// Host-token PRESENCE is enforced on the ClientMsg union (see superRefine below)
// so a `role:'host'` hello must carry a non-empty `hostToken`. The auth layer
// still verifies the token's VALUE server-side (constant-time) per spec §5.
export const HelloMsgSchema = z.object({
  t: z.literal('hello'),
  role: z.enum(['player', 'host', 'tv']),
  code: z.string(),
  playerId: z.string().optional(),
  // Private per-player rejoin credential (from a prior IDENTITY frame). Required
  // to reattach to an existing playerId; absent/wrong → server mints a fresh id.
  rejoinSecret: z.string().optional(),
  name: z.string().optional(),
  hostToken: z.string().optional(),
});

export const JoinMsgSchema = z.object({ t: z.literal('join'), name: z.string() });
// filledPct is a fraction in [0,1] (non-authoritative progress signal).
export const ProgressMsgSchema = z.object({
  t: z.literal('progress'),
  filledPct: z.number().min(0).max(1),
});
// wordId is the engine PublicWord id: `${dir}:${num}` → e.g. "across:1".
export const UseHintMsgSchema = z.object({
  t: z.literal('useHint'),
  wordId: z.string().regex(/^(across|down):\d+$/),
});
// entries: "r,c" cell keys → single uppercase letters.
export const SubmitMsgSchema = z.object({
  t: z.literal('submit'),
  entries: z.record(z.string().regex(/^\d+,\d+$/), z.string().regex(/^[A-Z]$/)),
});

// Host verbs (token checked server-side, not in schema).
export const OpenLobbyMsgSchema = z.object({ t: z.literal('openLobby') });
export const StartCountdownMsgSchema = z.object({ t: z.literal('startCountdown') });
export const PauseToggleMsgSchema = z.object({ t: z.literal('pauseToggle') });
export const ToggleLeaderboardMsgSchema = z.object({ t: z.literal('toggleLeaderboard') });
export const EndRoundMsgSchema = z.object({ t: z.literal('endRound') });
export const NextRoundMsgSchema = z.object({ t: z.literal('nextRound') });
export const MarkPrizeMsgSchema = z.object({ t: z.literal('markPrize') });
export const SetConfigMsgSchema = z.object({
  t: z.literal('setConfig'),
  patch: SessionConfigSchema.partial(),
});
export const SetPuzzleMsgSchema = z.object({ t: z.literal('setPuzzle'), puzzleId: z.string() });
export const ResetMsgSchema = z.object({ t: z.literal('reset') });
// End Session: terminal (vs reset, which only idles). The DO marks the session
// 'ended' + sets its terminated flag so it leaves the booth immediately and can
// never be resumed/resurrected. Host-only (token checked server-side).
export const EndSessionMsgSchema = z.object({ t: z.literal('endSession') });

// Host-token presence rule lives on the union (a refined object cannot be a
// discriminatedUnion member in zod 3). When role==='host', hostToken must be a
// non-empty string. Player/tv hellos are unaffected.
export const ClientMsg = z
  .discriminatedUnion('t', [
    HelloMsgSchema,
    JoinMsgSchema,
    ProgressMsgSchema,
    UseHintMsgSchema,
    SubmitMsgSchema,
    OpenLobbyMsgSchema,
    StartCountdownMsgSchema,
    PauseToggleMsgSchema,
    ToggleLeaderboardMsgSchema,
    EndRoundMsgSchema,
    NextRoundMsgSchema,
    MarkPrizeMsgSchema,
    SetConfigMsgSchema,
    SetPuzzleMsgSchema,
    ResetMsgSchema,
    EndSessionMsgSchema,
  ])
  .superRefine((m, ctx) => {
    if (m.t === 'hello' && m.role === 'host' && !m.hostToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hostToken'],
        message: 'hostToken is required for role "host"',
      });
    }
  });

export type HelloMsg = z.infer<typeof HelloMsgSchema>;
export type JoinMsg = z.infer<typeof JoinMsgSchema>;
export type ProgressMsg = z.infer<typeof ProgressMsgSchema>;
export type UseHintMsg = z.infer<typeof UseHintMsgSchema>;
export type SubmitMsg = z.infer<typeof SubmitMsgSchema>;
export type OpenLobbyMsg = z.infer<typeof OpenLobbyMsgSchema>;
export type StartCountdownMsg = z.infer<typeof StartCountdownMsgSchema>;
export type PauseToggleMsg = z.infer<typeof PauseToggleMsgSchema>;
export type ToggleLeaderboardMsg = z.infer<typeof ToggleLeaderboardMsgSchema>;
export type EndRoundMsg = z.infer<typeof EndRoundMsgSchema>;
export type NextRoundMsg = z.infer<typeof NextRoundMsgSchema>;
export type MarkPrizeMsg = z.infer<typeof MarkPrizeMsgSchema>;
export type SetConfigMsg = z.infer<typeof SetConfigMsgSchema>;
export type SetPuzzleMsg = z.infer<typeof SetPuzzleMsgSchema>;
export type ResetMsg = z.infer<typeof ResetMsgSchema>;
export type EndSessionMsg = z.infer<typeof EndSessionMsgSchema>;
export type ClientMsg = z.infer<typeof ClientMsg>;

// ============================================================
// Server → Client
// ============================================================

// Strict structural schema mirroring the engine's PublicWord/PublicPuzzle. This
// replaces z.custom<PublicPuzzle>() so the snapshot actively REJECTS any object
// carrying answer-bearing keys (`grid`, word `answer`) — `.strict()` rejects any
// unknown key, which closes the anti-cheat hole. Fields match the ACTUAL engine
// PublicPuzzle (types.ts), including the answer-free `cellToWord` index.
const num = z.number().int();
const cell = z.tuple([num, num]);

export const PublicWordSchema = z
  .object({
    dir: z.enum(['across', 'down']),
    num: num,
    cells: z.array(cell),
    clue: z.string(),
    len: num,
    id: z.string(),
  })
  .strict();

export const PublicPuzzleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sub: z.string(),
    rows: num,
    cols: num,
    blocks: z.array(cell),
    numbers: z.record(z.string(), num),
    across: z.array(PublicWordSchema),
    down: z.array(PublicWordSchema),
    fill: z.array(cell),
    cellCount: num,
    cellToWord: z.record(
      z.string(),
      z.object({ across: num.optional(), down: num.optional() }).strict(),
    ),
  })
  .strict();

// Compile-time parity guard: the schema's inferred type must be assignable to the
// engine's PublicPuzzle (catches drift if the engine shape changes). Spends the
// `PublicPuzzle` import so noUnusedLocals stays happy.
type _PublicPuzzleParity = z.infer<typeof PublicPuzzleSchema> extends PublicPuzzle ? true : never;
const _publicPuzzleParity: _PublicPuzzleParity = true;
void _publicPuzzleParity;

export const SnapshotSchema = z.object({
  t: z.literal('snapshot'),
  phase: PhaseSchema,
  round: z.number(),
  joinCode: z.string(),
  config: SessionConfigSchema,
  publicPuzzle: PublicPuzzleSchema.nullable(),
  players: z.array(PublicPlayerSchema),
  startedAt: z.number().nullable(),
  serverTime: z.number(),
  countdownEndsAt: z.number().nullable(),
  roundEndsAt: z.number().nullable(),
  // True while the live round is paused; clients freeze the local clock so it
  // doesn't tick past the (fixed) roundEndsAt while paused.
  paused: z.boolean(),
  showLeaderboard: z.boolean(),
  prizeGiven: z.boolean(),
  winner: PublicPlayerSchema.nullable(),
  // Winner-screen commentary, decided server-side at round end (one line for ALL
  // surfaces). Set to a deterministic line instantly, then upgraded in place to
  // an AI-generated line when OpenRouter responds. Null outside the winner phase
  // (and for a winnerless round, where each surface shows its own no-solve copy).
  commentary: z.string().nullable(),
});

export const IdentityMsgSchema = z.object({
  t: z.literal('identity'),
  playerId: z.string(),
  // Server-only credential the client persists + presents on a future hello to
  // reattach to this playerId. NEVER appears in PublicPlayer/snapshots.
  rejoinSecret: z.string(),
});
export const HintMsgSchema = z.object({
  t: z.literal('hint'),
  r: z.number(),
  c: z.number(),
  letter: z.string().regex(/^[A-Z]$/),
});
export const WrongMsgSchema = z.object({
  t: z.literal('wrong'),
  wrongAttempts: z.number(),
  penaltySec: z.number(),
});
export const IncompleteMsgSchema = z.object({
  t: z.literal('incomplete'),
  remainingCells: z.number(),
});
export const FinishedMsgSchema = z.object({
  t: z.literal('finished'),
  finishMs: z.number(),
  score: ScoreSchema,
});
// Sent when a useHint arrives inside the per-player hint cooldown — the reveal is
// refused (no cell, no hintsUsed charge); the client shows a "try it yourself" toast.
export const HintThrottledMsgSchema = z.object({
  t: z.literal('hintThrottled'),
});
export const ErrorMsgSchema = z.object({
  t: z.literal('error'),
  code: z.string(),
  message: z.string(),
});

export const ServerMsg = z.discriminatedUnion('t', [
  SnapshotSchema,
  IdentityMsgSchema,
  HintMsgSchema,
  WrongMsgSchema,
  IncompleteMsgSchema,
  FinishedMsgSchema,
  HintThrottledMsgSchema,
  ErrorMsgSchema,
]);

// `Snapshot` is the inferred snapshot type (structurally equal to the LOCKED interface).
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type PublicWordWire = z.infer<typeof PublicWordSchema>;
export type PublicPuzzleWire = z.infer<typeof PublicPuzzleSchema>;
export type IdentityMsg = z.infer<typeof IdentityMsgSchema>;
export type HintMsg = z.infer<typeof HintMsgSchema>;
export type WrongMsg = z.infer<typeof WrongMsgSchema>;
export type IncompleteMsg = z.infer<typeof IncompleteMsgSchema>;
export type FinishedMsg = z.infer<typeof FinishedMsgSchema>;
export type HintThrottledMsg = z.infer<typeof HintThrottledMsgSchema>;
export type ErrorMsg = z.infer<typeof ErrorMsgSchema>;
export type ServerMsg = z.infer<typeof ServerMsg>;

// ============================================================
// Safe parse helpers
// ============================================================
export const parseClientMsg = (u: unknown) => ClientMsg.safeParse(u);
export const parseServerMsg = (u: unknown) => ServerMsg.safeParse(u);
