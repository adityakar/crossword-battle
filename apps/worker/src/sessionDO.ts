// sessionDO.ts — authoritative session state machine (design §3, §4).
//
// One SessionDO per join code (env.SESSION.idFromName(joinCode)). Holds the
// FULL puzzle (with answers) IN MEMORY only — it is never serialized to storage
// nor broadcast; it is rebuilt from D1 on every wake (constructor). Clients only
// ever receive the answer-free PublicPuzzle inside a Snapshot.
//
// Anti-cheat invariants (design §4):
//  - Solution letters live only here + in D1; `publicPuzzle` excludes them.
//  - `finishMs` is server-stamped from the server clock, NEVER client-claimed.
//  - SUBMIT is server-validated via engine `validateSolution`.
//  - Host control verbs require a constant-time host-token match.
//  - PROGRESS is non-authoritative + rate-limited; hints are deduped per cell.
import {
  buildPuzzle,
  toPublicPuzzle,
  validateSolution,
  solutionAt,
  pWordAt,
  type Grid,
  type Puzzle,
  type PublicPuzzle,
} from '@cwb/engine';
import {
  DEFAULT_BRAND,
  fmtTime,
  parseClientMsg,
  rankPlayers,
  scoreFor,
  SessionConfigSchema,
  type ClientMsg,
  type Phase,
  type PublicPlayer,
  type SessionConfig,
  type Snapshot,
} from '@cwb/shared';
import {
  getPuzzleById,
  getSessionByJoinCode,
  setLobbyIfSoleActive,
  sessionHasResults,
  setSessionStatus,
  upsertRoundResult,
  type PuzzleRow,
} from './db';
import { fallbackWinnerLine, winnerCommentary } from './ai';
// Type-only import (erased at build) — bridges the DO's loose local Env to the
// typed worker Env that ai.ts expects. No runtime import cycle with index.ts.
import type { Env as WorkerEnv } from './index';

interface Env {
  DB: D1Database;
  SESSION: DurableObjectNamespace;
  // Used as the internal credential for the terminate RPC (see fetch()).
  JWT_SECRET?: string;
  [key: string]: unknown;
}

// Per-socket attachment (survives hibernation via serializeAttachment).
interface SockMeta {
  role: 'host' | 'player' | 'tv';
  playerId?: string;
  // Per-socket rejoin secret minted at hello. Promoted onto the PlayerRec when
  // the player actually JOINs (rows are created at join, not at hello).
  rejoinSecret?: string;
  hostOk?: boolean;
}

// Server-side player record. `revealedCells` is a Set in memory but serialized
// as an array (JSON drops Sets). `lastProgressAt` rate-limits PROGRESS;
// `lastHintAt` rate-limits hints. `rejoinSecret` is a server-only credential
// (NEVER projected into PublicPlayer/snapshots — it gates reattach in onHello).
interface PlayerRec {
  id: string;
  name: string;
  filledPct: number;
  hintsUsed: number;
  wrongAttempts: number;
  finishMs: number | null;
  connected: boolean;
  revealedCells: Set<string>;
  lastProgressAt: number;
  lastHintAt: number;
  rejoinSecret: string;
}

// Serialized player (Set → array) for DO storage.
interface PlayerSer extends Omit<PlayerRec, 'revealedCells'> {
  revealedCells: string[];
}

interface AlarmIntent {
  // 'lobbyRecycle' = recycle an EMPTY, idle lobby back to standby (booth self-heal).
  kind: 'countdown' | 'roundEnd' | 'lobbyRecycle';
  round: number;
  dueAt: number;
}

// Shared session fields (everything except the players map, which differs
// between the in-memory form (Set) and the serialized form (array)).
interface SessionCommon {
  phase: Phase;
  round: number;
  joinCode: string;
  config: SessionConfig;
  startedAt: number | null;
  pausedAccumMs: number;
  pausedAt: number | null;
  countdownEndsAt: number | null;
  showLeaderboard: boolean;
  prizeGiven: boolean;
  resultsWritten: boolean;
  alarmIntent: AlarmIntent | null;
  // Winner-screen commentary (null outside winner phase / winnerless round). Set
  // to a deterministic line at round end, then upgraded to an AI line in place.
  commentary: string | null;
  // Terminal lifecycle flag (multi-booth). Set by terminate() when this session
  // is REPLACED by a newer one for the same organizer. A terminated DO rejects
  // all host verbs and its alarm() is a no-op, so it can never resurrect its D1
  // status out of 'ended'. Codes are never reused, so this stays correct forever.
  terminated: boolean;
}

// In-memory state: players carry Sets (revealedCells).
interface MemState extends SessionCommon {
  players: Record<string, PlayerRec>;
}

// Persisted blob (one storage key). Sets → arrays. The full Puzzle (answers) is
// intentionally NOT here — it is rebuilt from D1 each wake.
interface PersistState extends SessionCommon {
  players: Record<string, PlayerSer>;
}

const STATE_KEY = 'state';
const COUNTDOWN_MS = 3000;
const ALL_FINISHED_GRACE_MS = 4000;
const PROGRESS_MIN_INTERVAL_MS = 400;
// Per-player hint cooldown: at most one reveal per 5s, so players try on their own
// between hints rather than spamming the grid open. A too-soon hint is refused (a
// `hintThrottled` message tells the player to wait). The web client mirrors this for
// instant feedback (HINT_COOLDOWN_MS in Game.tsx); this server value is authoritative.
const HINT_MIN_INTERVAL_MS = 5000;
// Tolerance for an early roundEnd alarm fire. Alarm delivery is at-least-once,
// so a redelivered/consumed countdown alarm can re-enter alarm() while the
// round-end intent is set; gating on dueAt prevents ending the round early.
const ALARM_SKEW_MS = 1000;
// Booth self-heal: an abandoned lobby (host's tab/phone gone AND no players) is
// recycled to standby after this idle window. Long enough that a host phone going
// to sleep does NOT end the session — any host/player (re)connect cancels it, and
// a lobby with players waiting is never recycled. Recycle is non-destructive (the
// session goes 'idle', still resumable), so we keep this fairly short so the booth
// clears a truly-abandoned lobby quickly. (Only 'lobby' needs this: countdown→live
// and live→winner via their alarms; winner ages out at 60s.)
const LOBBY_IDLE_RECYCLE_MS = 15 * 60 * 1000;
// Owner one-active window for openLobby's singleton guard. Keep in sync with
// index.ts ACTIVE_WINDOW_MS (the create / display / resume window).
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Constant-time hex string comparison (host-token hashes are equal-length hex).
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Constant-time string compare for the rejoin secret (length is not secret here;
// secrets are equal-length UUIDs, but guard the length branch anyway).
function timingSafeStrEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newPlayerId(): string {
  return 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

// Sanitize a joining player name: trim, strip control chars (incl. newlines),
// clamp to 24 chars. Applied BEFORE storing so the projection/snapshot is clean.
const NAME_MAX = 24;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
function sanitizeName(name: string): string {
  return name.replace(CONTROL_CHARS, '').trim().slice(0, NAME_MAX);
}

// Private per-player reattach credential. Random + never broadcast, so seeing a
// playerId in a snapshot is not enough to impersonate that player on hello.
function newRejoinSecret(): string {
  return crypto.randomUUID();
}

export class SessionDO implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  // In-memory only (rebuilt each wake from D1):
  private puzzle: Puzzle | null = null; // WITH answers — server-only
  private publicPuzzle: PublicPuzzle | null = null;
  private hostTokenHash: string | null = null;
  private loaded = false;

  // In-memory authoritative state (restored in constructor):
  private s: MemState = {
    phase: 'idle',
    round: 1,
    joinCode: '',
    config: emptyConfig(),
    players: {},
    startedAt: null,
    pausedAccumMs: 0,
    pausedAt: null,
    countdownEndsAt: null,
    showLeaderboard: true, // board visible by default (prototype); host can hide for suspense
    prizeGiven: false,
    resultsWritten: false,
    alarmIntent: null,
    commentary: null,
    terminated: false,
  };

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Restore persisted state AND rebuild the in-memory puzzle from D1 before any
    // request/message is dispatched. A hibernated socket can deliver a message
    // with NO preceding fetch(), so this is the only reliable init point.
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<PersistState>(STATE_KEY);
      if (stored) {
        // Rehydrate Sets (JSON serialized them as arrays).
        const players: Record<string, PlayerRec> = {};
        for (const [id, p] of Object.entries(stored.players)) {
          players[id] = { ...p, revealedCells: new Set(p.revealedCells) };
        }
        this.s = { ...stored, players };
        await this.loadFromD1(stored.joinCode);
      }
    });
  }

  // Parse a puzzle row's grid_json/clues_json and rebuild the full + public
  // Puzzle. Returns null (and logs) on any parse/build failure so a corrupt row
  // is treated as "puzzle unavailable" instead of crashing DO init or a verb.
  private buildPuzzleFromRow(
    row: PuzzleRow,
  ): { puzzle: Puzzle; publicPuzzle: PublicPuzzle } | null {
    try {
      const grid = JSON.parse(row.grid_json) as Grid;
      const clues = JSON.parse(row.clues_json) as Record<string, string>;
      const puzzle = buildPuzzle({
        grid,
        clues,
        id: row.id,
        name: row.name,
        tag: row.tag,
      });
      return { puzzle, publicPuzzle: toPublicPuzzle(puzzle) };
    } catch (err) {
      console.error('buildPuzzleFromRow failed (corrupt puzzle row)', row.id, err);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Lazy load: reconstruct the full Puzzle (answers) + publicPuzzle + host hash
  // from D1, keyed by join code. Idempotent.
  // -------------------------------------------------------------------------
  private async loadFromD1(joinCode: string): Promise<boolean> {
    if (this.loaded && this.s.joinCode === joinCode) return true;
    if (!joinCode) return false;
    const session = await getSessionByJoinCode(this.env.DB, joinCode);
    if (!session) return false;
    const puzzleRow = await getPuzzleById(this.env.DB, session.puzzle_id);
    if (!puzzleRow) return false;
    // A corrupt grid_json/clues_json must not crash DO init: treat as "puzzle
    // unavailable" (return false) rather than throwing out of the constructor.
    const built = this.buildPuzzleFromRow(puzzleRow);
    if (!built) return false;
    this.puzzle = built.puzzle;
    this.publicPuzzle = built.publicPuzzle;
    this.hostTokenHash = session.host_token_hash;
    // Seed first-boot persisted state from the D1 row.
    if (!this.s.joinCode) {
      this.s.joinCode = joinCode;
      this.s.round = session.round;
      this.s.config = JSON.parse(session.config_json) as SessionConfig;
    }
    // D1 'ended' (a replaced/terminated session) is AUTHORITATIVE: a cold DO whose
    // hibernated storage was lost or never written would otherwise load with
    // terminated=false and a stale host token could resurrect it. Re-deriving the
    // terminal flag from D1 here closes that gap (hostOnly/alarm then reject).
    if (session.status === 'ended') {
      this.s.terminated = true;
      this.s.phase = 'idle';
      this.s.alarmIntent = null;
    }
    this.loaded = true;
    return true;
  }

  private async persist(): Promise<void> {
    const players: Record<string, PlayerSer> = {};
    for (const [id, p] of Object.entries(this.s.players)) {
      players[id] = { ...p, revealedCells: [...p.revealedCells] };
    }
    await this.state.storage.put<PersistState>(STATE_KEY, { ...this.s, players });
  }

  // -------------------------------------------------------------------------
  // fetch(): WebSocket upgrade. The /ws/:code route forwards the code via the
  // x-join-code header. Reject if the session can't be loaded.
  // -------------------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    // Internal-only lifecycle RPC (NOT a WebSocket): create-with-replace calls it
    // to authoritatively stop a superseded session (design §I). The public /ws
    // proxy STRIPS x-terminate before forwarding, but a client must NOT be able to
    // end a session by knowing its join code, so require the deployment secret as
    // an unforgeable credential here too (self-defending regardless of route).
    const term = request.headers.get('x-terminate');
    if (term != null) {
      const secret = typeof this.env.JWT_SECRET === 'string' ? this.env.JWT_SECRET : '';
      if (!secret || !timingSafeStrEqual(term, secret)) {
        return new Response('forbidden', { status: 403 });
      }
      const joinCode = request.headers.get('x-join-code') ?? this.s.joinCode;
      await this.loadFromD1(joinCode);
      if (joinCode && !this.s.joinCode) this.s.joinCode = joinCode;
      await this.terminate();
      return new Response('terminated', { status: 200 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const joinCode = request.headers.get('x-join-code') ?? '';
    const ok = await this.loadFromD1(joinCode);
    if (!ok) return new Response('session not found', { status: 404 });
    // Persist the joinCode immediately so post-hibernation wakes can reload.
    if (this.s.joinCode !== joinCode) {
      this.s.joinCode = joinCode;
      await this.persist();
    } else if (!(await this.state.storage.get(STATE_KEY))) {
      await this.persist();
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Default attachment; refined on hello.
    server.serializeAttachment({ role: 'tv' } satisfies SockMeta);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // -------------------------------------------------------------------------
  // Hibernation message handler. Entry point after a wake (no fetch first).
  // -------------------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    // Ensure the puzzle is loaded (defensive; constructor normally handles it).
    if (!this.loaded && this.s.joinCode) await this.loadFromD1(this.s.joinCode);

    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendError(ws, 'bad_json', 'message was not valid JSON');
    }
    const res = parseClientMsg(parsed);
    if (!res.success) {
      return this.sendError(ws, 'bad_message', 'message failed schema validation');
    }
    await this.dispatch(ws, res.data);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const meta = this.meta(ws);
    if (meta.playerId) {
      const p = this.s.players[meta.playerId];
      if (p) {
        // Reconnect close-race: the OLD socket's close can arrive AFTER the NEW
        // hello already reattached this playerId. Only mark offline if no OTHER
        // open socket carries the same playerId.
        if (!this.hasOtherOpenSocketFor(meta.playerId, ws)) {
          p.connected = false;
          await this.persist();
          this.broadcast();
        }
      }
    }
    // Booth self-heal: a lobby that just became fully empty schedules a recycle.
    await this.maybeScheduleLobbyRecycle(ws);
  }

  // Schedule a lobby-recycle alarm IFF an OPEN lobby is fully empty (no host AND no
  // player socket; the booth's tv socket is ignored) and none is already pending.
  // Any host/player (re)connect cancels it (onHello), so a host phone going to sleep
  // does not end the session; not resetting an already-pending recycle means the
  // window measures idle time since the lobby actually emptied. Called both when a
  // socket closes (lobby empties) and on hello (e.g. a tv attaching to a lobby whose
  // host vanished without a clean close — belt-and-suspenders so it still self-heals).
  private async maybeScheduleLobbyRecycle(exclude?: WebSocket): Promise<void> {
    if (
      this.s.phase === 'lobby' &&
      this.s.alarmIntent?.kind !== 'lobbyRecycle' &&
      !this.hasOpenHostSocket(exclude) &&
      !this.hasOpenPlayerSocket(exclude)
    ) {
      const dueAt = Date.now() + LOBBY_IDLE_RECYCLE_MS;
      this.s.alarmIntent = { kind: 'lobbyRecycle', round: this.s.round, dueAt };
      await this.state.storage.setAlarm(dueAt);
      await this.persist();
    }
  }

  // Any OPEN, authorized-host socket other than `exclude`. The booth's 'tv' socket
  // is deliberately NOT a host — a booth watching a dead lobby must not keep it
  // alive. Used to decide/recheck the lobby-recycle.
  private hasOpenHostSocket(exclude?: WebSocket): boolean {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      const m = ws.deserializeAttachment() as SockMeta | null;
      if (m?.role === 'host' && m.hostOk) return true;
    }
    return false;
  }

  // Any OPEN player socket other than `exclude` (a player having merely hello'd
  // counts — someone is present, so the lobby isn't abandoned).
  private hasOpenPlayerSocket(exclude?: WebSocket): boolean {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      const m = ws.deserializeAttachment() as SockMeta | null;
      if (m?.role === 'player') return true;
    }
    return false;
  }

  // True if some OTHER currently-open socket (not `exclude`) is attached to
  // `playerId`. Used to avoid flipping an active player offline on a stale close.
  private hasOtherOpenSocketFor(playerId: string, exclude: WebSocket): boolean {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      const m = ws.deserializeAttachment() as SockMeta | null;
      if (m?.playerId === playerId) return true;
    }
    return false;
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // -------------------------------------------------------------------------
  // Dispatch by message type.
  // -------------------------------------------------------------------------
  private async dispatch(ws: WebSocket, msg: ClientMsg): Promise<void> {
    switch (msg.t) {
      case 'hello':
        return this.onHello(ws, msg);
      case 'join':
        return this.onJoin(ws, msg.name);
      case 'progress':
        return this.onProgress(ws, msg.filledPct);
      case 'useHint':
        return this.onUseHint(ws, msg.wordId);
      case 'submit':
        return this.onSubmit(ws, msg.entries);
      // Host verbs:
      case 'openLobby':
        return this.hostOnly(ws, () => this.openLobby(ws));
      case 'startCountdown':
        return this.hostOnly(ws, () => this.startCountdown());
      case 'pauseToggle':
        return this.hostOnly(ws, () => this.pauseToggle());
      case 'toggleLeaderboard':
        return this.hostOnly(ws, () => this.toggleLeaderboard());
      case 'endRound':
        return this.hostOnly(ws, () => this.endRound());
      case 'nextRound':
        return this.hostOnly(ws, () => this.nextRound());
      case 'markPrize':
        return this.hostOnly(ws, () => this.markPrize());
      case 'setConfig':
        return this.hostOnly(ws, () => this.setConfig(msg.patch));
      case 'setPuzzle':
        return this.hostOnly(ws, () => this.setPuzzle(msg.puzzleId));
      case 'reset':
        return this.hostOnly(ws, () => this.reset());
      case 'endSession':
        // Terminal end (vs reset, which only idles): mark 'ended' + set the
        // terminated flag so the session leaves the booth and can't be resurrected.
        return this.hostOnly(ws, () => this.terminate());
    }
  }

  private meta(ws: WebSocket): SockMeta {
    return (ws.deserializeAttachment() as SockMeta | null) ?? { role: 'tv' };
  }

  // Merge-and-write attachment (serializeAttachment replaces the WHOLE blob).
  private setMeta(ws: WebSocket, patch: Partial<SockMeta>): void {
    ws.serializeAttachment({ ...this.meta(ws), ...patch });
  }

  private async hostOnly(ws: WebSocket, fn: () => void | Promise<void>): Promise<void> {
    // A terminated (replaced) session accepts no further host control — this is
    // the chokepoint that prevents a lingering host socket from resurrecting it.
    if (this.s.terminated) {
      return this.sendError(ws, 'terminated', 'this session has ended');
    }
    if (!this.meta(ws).hostOk) {
      return this.sendError(ws, 'forbidden', 'host authorization required');
    }
    await fn();
  }

  // -------------------------------------------------------------------------
  // hello: idempotent identity attach. Host token verified constant-time.
  // -------------------------------------------------------------------------
  private async onHello(
    ws: WebSocket,
    msg: Extract<ClientMsg, { t: 'hello' }>,
  ): Promise<void> {
    if (msg.role === 'host') {
      const provided = msg.hostToken ? await sha256Hex(msg.hostToken) : '';
      let ok =
        this.hostTokenHash != null && timingSafeHexEqual(provided, this.hostTokenHash);
      // If the cached hash didn't match, the host token may have been RE-ISSUED in
      // D1 (the "resume session" flow rewrites sessions.host_token_hash). Re-read
      // the row and re-check against the fresh hash, updating the cache. Only a
      // miss against the FRESH hash is a real bad_host_token.
      if (!ok && provided) {
        const session = await getSessionByJoinCode(this.env.DB, this.s.joinCode);
        if (session) {
          this.hostTokenHash = session.host_token_hash;
          ok = timingSafeHexEqual(provided, this.hostTokenHash);
        }
      }
      this.setMeta(ws, { role: 'host', hostOk: ok });
      if (!ok) this.sendError(ws, 'bad_host_token', 'host token did not match');
    } else if (msg.role === 'tv') {
      this.setMeta(ws, { role: 'tv' });
    } else {
      // player: reattach an existing identity ONLY with a matching rejoinSecret;
      // otherwise mint a fresh id + secret. A playerId alone is NOT a credential
      // (it is broadcast in snapshots), so reattach is gated on the private secret.
      const candidate = msg.playerId ? this.s.players[msg.playerId] : undefined;
      const reattach =
        candidate != null &&
        msg.rejoinSecret != null &&
        timingSafeStrEqual(msg.rejoinSecret, candidate.rejoinSecret);

      let playerId: string;
      let rejoinSecret: string;
      if (reattach && candidate) {
        // Known player presenting the right secret → restore to connected.
        playerId = candidate.id;
        rejoinSecret = candidate.rejoinSecret;
        candidate.connected = true;
        await this.persist();
      } else {
        // New player (or impersonation attempt): mint a fresh id + secret. The
        // secret rides in SockMeta and is promoted onto the PlayerRec at JOIN.
        playerId = newPlayerId();
        rejoinSecret = newRejoinSecret();
      }
      this.setMeta(ws, { role: 'player', playerId, rejoinSecret });
      this.send(ws, { t: 'identity', playerId, rejoinSecret });
    }
    // A VALID presence (a player, or an authorized host) returning to an open
    // lobby means it isn't abandoned — cancel any pending recycle. A bad-token
    // host or a tv hello does NOT count (matches hasOpenHostSocket's hostOk rule).
    const m = this.meta(ws);
    if (
      this.s.phase === 'lobby' &&
      this.s.alarmIntent?.kind === 'lobbyRecycle' &&
      (m.role === 'player' || (m.role === 'host' && m.hostOk === true))
    ) {
      this.s.alarmIntent = null;
      await this.state.storage.deleteAlarm();
      await this.persist();
    } else {
      // A tv (or bad-token host) attaching to a lobby whose host/players already
      // vanished without a clean close: make sure the recycle is scheduled so the
      // booth still self-heals. No-op for a valid host/player (they're present now).
      await this.maybeScheduleLobbyRecycle();
    }
    // Reply with a snapshot built from post-attach state (avoids flicker).
    this.send(ws, this.snapshot(ws));
    // A reconnected player flips connected → tell everyone.
    if (msg.role === 'player') this.broadcast();
  }

  private async onJoin(ws: WebSocket, name: string): Promise<void> {
    const meta = this.meta(ws);
    if (meta.role !== 'player' || !meta.playerId) {
      return this.sendError(ws, 'no_identity', 'send hello before join');
    }
    const lateOk = this.s.config.allowLate;
    const phase = this.s.phase;
    const canJoin =
      phase === 'lobby' || (lateOk && (phase === 'countdown' || phase === 'live'));
    if (!canJoin) {
      return this.sendError(ws, 'closed', 'joining is closed for this phase');
    }
    const id = meta.playerId;
    const cleanName = sanitizeName(name);
    const existing = this.s.players[id];
    if (existing) {
      // Existing player (incl. a reconnect of a known id) is always allowed; just
      // update the name + mark connected. maxPlayers only gates NEW joins.
      existing.name = cleanName;
      existing.connected = true;
    } else {
      // NEW player: enforce the capacity cap. Existing players reconnecting never
      // reach here (they hit the branch above), so capacity can't lock them out.
      if (Object.keys(this.s.players).length >= this.s.config.maxPlayers) {
        return this.sendError(ws, 'full', 'this session is full');
      }
      // Row created here (NOT at hello). Promote the socket's rejoin secret onto
      // the record so future hellos can reattach by presenting it.
      this.s.players[id] = {
        id,
        name: cleanName,
        filledPct: 0,
        hintsUsed: 0,
        wrongAttempts: 0,
        finishMs: null,
        connected: true,
        revealedCells: new Set(),
        lastProgressAt: 0,
        lastHintAt: 0,
        rejoinSecret: meta.rejoinSecret ?? newRejoinSecret(),
      };
    }
    await this.persist();
    this.broadcast();
  }

  private async onProgress(ws: WebSocket, filledPct: number): Promise<void> {
    const meta = this.meta(ws);
    if (meta.role !== 'player' || !meta.playerId) return;
    const p = this.s.players[meta.playerId];
    if (!p) return;
    // Progress only counts during a live round and before the player finished.
    if (this.s.phase !== 'live') return;
    if (p.finishMs != null) return;
    const now = Date.now();
    if (now - p.lastProgressAt < PROGRESS_MIN_INTERVAL_MS) return; // rate-limit
    p.lastProgressAt = now;
    p.filledPct = Math.max(0, Math.min(1, filledPct));
    await this.persist();
    this.broadcast();
  }

  // -------------------------------------------------------------------------
  // useHint: reveal first unrevealed, not-yet-correct cell of the word.
  // Private HINT to the requester; snapshot broadcast (hintsUsed changed).
  // -------------------------------------------------------------------------
  private async onUseHint(ws: WebSocket, wordId: string): Promise<void> {
    const meta = this.meta(ws);
    if (meta.role !== 'player' || !meta.playerId) return;
    const p = this.s.players[meta.playerId];
    if (!p || !this.publicPuzzle || !this.puzzle) return;
    if (this.s.phase !== 'live') {
      return this.sendError(ws, 'not_live', 'hints are only available while live');
    }
    // Cooldown: a hint arriving within HINT_MIN_INTERVAL_MS is refused (no reveal,
    // no hintsUsed increment) and the player is told to wait. The per-cell dedupe
    // below still applies to granted hints.
    const now = Date.now();
    if (now - p.lastHintAt < HINT_MIN_INTERVAL_MS) {
      this.send(ws, { t: 'hintThrottled' });
      return;
    }
    const [dir, numStr] = wordId.split(':');
    const num = Number(numStr);
    const list = dir === 'across' ? this.publicPuzzle.across : this.publicPuzzle.down;
    const word = list.find((w) => w.num === num);
    if (!word) return this.sendError(ws, 'no_word', 'unknown word id');
    // First cell not already revealed for this player.
    for (const [r, c] of word.cells) {
      const key = `${r},${c}`;
      if (p.revealedCells.has(key)) continue;
      const letter = solutionAt(this.puzzle, r, c);
      if (letter == null) continue;
      p.revealedCells.add(key);
      p.hintsUsed++;
      p.lastHintAt = now;
      await this.persist();
      // Private reply to the player's CURRENT socket(s) (they may have reconnected
      // during persist; sending on the original `ws` could hit a dead socket).
      this.sendToPlayer(p.id, { t: 'hint', r, c, letter });
      this.broadcast();
      return;
    }
    // All cells of the word already revealed: no new cell, no charge.
  }

  // -------------------------------------------------------------------------
  // submit: server-authoritative validation. NEVER trust a client finish.
  // -------------------------------------------------------------------------
  private async onSubmit(ws: WebSocket, entries: Record<string, string>): Promise<void> {
    const meta = this.meta(ws);
    if (meta.role !== 'player' || !meta.playerId) return;
    const p = this.s.players[meta.playerId];
    if (!p || !this.puzzle) return;
    if (this.s.phase !== 'live') {
      return this.sendError(ws, 'not_live', 'submissions are only accepted while live');
    }
    if (p.finishMs != null) return; // already finished — idempotent
    // Cheap junk guard: a legit submit has at most `cellCount` keys (one per fill
    // cell). Anything with more than 2× that is a garbage-filled payload — ignore
    // it before doing any per-cell work.
    if (Object.keys(entries).length > this.puzzle.cellCount * 2) {
      return this.sendError(ws, 'bad_submit', 'submission payload too large');
    }

    if (validateSolution(this.puzzle, entries)) {
      const finishMs = this.serverElapsedMs();
      p.finishMs = finishMs;
      p.filledPct = 1;
      await this.persist();
      const score = scoreFor(p, this.s.config);
      // Private confirmation to the player's CURRENT socket(s) (reconnect-safe).
      this.sendToPlayer(p.id, { t: 'finished', finishMs, score: score! });
      this.broadcast();
      // Deliberately only hooked from submit: if the last unfinished player
      // disconnects, the round runs to the original timer instead of auto-ending.
      await this.maybeAutoEnd();
      return;
    }
    // Count how many fill cells are present (non-empty).
    let present = 0;
    for (const [r, c] of this.puzzle.fill) {
      const v = entries[`${r},${c}`];
      if (v != null && v !== '') present++;
    }
    if (present >= this.puzzle.cellCount) {
      // All filled but wrong → penalize.
      p.wrongAttempts++;
      await this.persist();
      this.send(ws, {
        t: 'wrong',
        wrongAttempts: p.wrongAttempts,
        penaltySec: this.s.config.wrongPenalty,
      });
      this.broadcast();
    } else {
      this.send(ws, {
        t: 'incomplete',
        remainingCells: this.puzzle.cellCount - present,
      });
    }
  }

  private async maybeAutoEnd(): Promise<void> {
    // Only live, unpaused rounds may have their round-end alarm pulled forward.
    if (this.s.phase !== 'live' || this.s.pausedAt != null) return;
    // With allowLate on, the clock must keep running for stragglers.
    if (this.s.config.allowLate) return;
    const connected = Object.values(this.s.players).filter((p) => p.connected);
    // Vacuous-every guard: onSubmit has a connected finisher, but a future
    // disconnect-side trigger must never end the round on the last rage-quit.
    if (connected.length === 0) return;
    // Any connected non-finisher keeps the original round clock in charge.
    if (!connected.every((p) => p.finishMs != null)) return;
    const now = Date.now();
    // Reuse the existing alarm()/endRoundInternal() path unchanged: no new
    // end-round logic. If the clock is already sooner than grace, the churn guard
    // leaves it alone; otherwise the pull-forward target is grace and never later
    // than the original clock.
    const dueAt = Math.min(
      this.roundEndsAt() ?? now + ALL_FINISHED_GRACE_MS,
      now + ALL_FINISHED_GRACE_MS,
    );
    // Avoid pointless churn if this round already has an earlier/equal roundEnd.
    if (
      this.s.alarmIntent?.kind === 'roundEnd' &&
      this.s.alarmIntent.round === this.s.round &&
      this.s.alarmIntent.dueAt <= dueAt
    ) {
      return;
    }
    this.s.alarmIntent = { kind: 'roundEnd', round: this.s.round, dueAt };
    await this.state.storage.setAlarm(dueAt);
    await this.persist();
  }

  // -------------------------------------------------------------------------
  // Host verbs.
  // -------------------------------------------------------------------------
  private async openLobby(ws?: WebSocket): Promise<void> {
    // Only open a lobby from a settled phase; ignore mid-round opens.
    if (this.s.phase !== 'idle' && this.s.phase !== 'winner') return;
    // Authoritative one-active guard (ATOMIC): flip THIS session to 'lobby' in D1
    // only if the owner has no OTHER active session. A stale/resurrected host
    // reconnecting to an idle session auto-fires openLobby (HostApp auto-reopen);
    // without this guard that creates the orphan the booth bounces to. The single
    // conditional UPDATE serializes across DOs, so two same-owner opens can't both
    // win. Fresh create / Clear Players (the owner's sole session) pass; only the
    // stale-tab resurrection is refused — and we tell that host so it returns to
    // Home instead of hanging on "opening lobby".
    const sess = await getSessionByJoinCode(this.env.DB, this.s.joinCode);
    if (sess) {
      const opened = await setLobbyIfSoleActive(
        this.env.DB,
        this.s.joinCode,
        sess.owner_id,
        Date.now() - ACTIVE_WINDOW_MS,
      );
      if (!opened) {
        if (ws) this.sendError(ws, 'superseded', 'another session is active for this booth');
        return;
      }
    } else {
      // No D1 row to guard against (shouldn't happen — the DO loaded from D1).
      await setSessionStatus(this.env.DB, this.s.joinCode, 'lobby');
    }
    this.s.phase = 'lobby';
    this.s.players = {};
    this.s.startedAt = null;
    this.s.pausedAccumMs = 0;
    this.s.pausedAt = null;
    this.s.countdownEndsAt = null;
    this.s.prizeGiven = false;
    this.s.resultsWritten = false;
    this.s.showLeaderboard = true; // fresh round shows the board (host can hide for suspense)
    this.s.alarmIntent = null;
    this.s.commentary = null;
    await this.state.storage.deleteAlarm();
    // D1 status was already set to 'lobby' atomically above (setLobbyIfSoleActive,
    // or the no-row fallback) — no second write needed here.
    await this.persist();
    this.broadcast();
  }

  private async startCountdown(): Promise<void> {
    if (this.s.phase !== 'lobby') return;
    const now = Date.now();
    const dueAt = now + COUNTDOWN_MS;
    this.s.phase = 'countdown';
    this.s.countdownEndsAt = dueAt;
    this.s.alarmIntent = { kind: 'countdown', round: this.s.round, dueAt };
    await this.state.storage.setAlarm(dueAt);
    await setSessionStatus(this.env.DB, this.s.joinCode, 'countdown');
    await this.persist();
    this.broadcast();
  }

  private async pauseToggle(): Promise<void> {
    if (this.s.phase !== 'live') return;
    const now = Date.now();
    if (this.s.pausedAt == null) {
      // Pause: stop the clock, delete the alarm so the round can't end.
      this.s.pausedAt = now;
      await this.state.storage.deleteAlarm();
    } else {
      // Resume: accumulate paused time, reschedule round-end alarm.
      this.s.pausedAccumMs += now - this.s.pausedAt;
      this.s.pausedAt = null;
      const dueAt = this.roundEndsAt()!;
      this.s.alarmIntent = { kind: 'roundEnd', round: this.s.round, dueAt };
      await this.state.storage.setAlarm(dueAt);
    }
    await this.persist();
    this.broadcast();
  }

  private async toggleLeaderboard(): Promise<void> {
    this.s.showLeaderboard = !this.s.showLeaderboard;
    await this.persist();
    this.broadcast();
  }

  private async endRound(): Promise<void> {
    // Host can only end a LIVE round; the alarm path calls endRoundInternal
    // directly and is already phase-gated.
    if (this.s.phase !== 'live') return;
    await this.endRoundInternal();
  }

  private async nextRound(): Promise<void> {
    // Only advance from the winner screen.
    if (this.s.phase !== 'winner') return;
    // Ensure results for the current round are written before advancing.
    if (!this.s.resultsWritten) await this.writeResults();
    this.s.round++;
    this.s.phase = 'lobby';
    this.s.players = {};
    this.s.startedAt = null;
    this.s.pausedAccumMs = 0;
    this.s.pausedAt = null;
    this.s.countdownEndsAt = null;
    this.s.prizeGiven = false;
    this.s.resultsWritten = false;
    this.s.showLeaderboard = true; // fresh round shows the board
    this.s.alarmIntent = null;
    this.s.commentary = null;
    await this.state.storage.deleteAlarm();
    await this.bumpSessionRound();
    await setSessionStatus(this.env.DB, this.s.joinCode, 'lobby');
    await this.persist();
    this.broadcast();
  }

  private async bumpSessionRound(): Promise<void> {
    await this.env.DB.prepare('UPDATE sessions SET round = ? WHERE join_code = ?')
      .bind(this.s.round, this.s.joinCode)
      .run();
  }

  private async markPrize(): Promise<void> {
    this.s.prizeGiven = true;
    await this.persist();
    this.broadcast();
  }

  private async setConfig(patch: Partial<SessionConfig>): Promise<void> {
    if (this.s.phase !== 'lobby' && this.s.phase !== 'idle') return;
    // Puzzle changes go through setPuzzle (which also loads answers from D1).
    // Strip puzzleId/puzzleName so a config patch can never swap the puzzle.
    const { puzzleId: _pid, puzzleName: _pname, aiTone: _tone, ...rest } = patch;
    const merged = { ...this.s.config, ...rest };
    // Belt-and-suspenders: SetConfigMsgSchema (SessionConfigSchema.partial())
    // already rejects out-of-range patch fields at parse time, but re-validate the
    // MERGED config so a bad value can never become the authoritative config.
    const parsed = SessionConfigSchema.safeParse(merged);
    if (!parsed.success) return;
    this.s.config = parsed.data;
    await this.persist();
    this.broadcast();
  }

  private async setPuzzle(puzzleId: string): Promise<void> {
    if (this.s.phase !== 'lobby' && this.s.phase !== 'idle') return;
    // Per-puzzle leaderboards attribute every round of a session to sessions.puzzle_id, so that key
    // must be stable once results exist — otherwise prior rounds get re-attributed to the new
    // puzzle. Lock it here. (The verb isn't wired into the host UI today; this guards against a
    // crafted client or future UI.)
    if (await sessionHasResults(this.env.DB, this.s.joinCode)) return;
    const puzzleRow = await getPuzzleById(this.env.DB, puzzleId);
    if (!puzzleRow) return;
    // Ownership: presets (owner_id null) are shared, but an OWNED puzzle must belong
    // to this session's organizer — never load another org's private puzzle (and its
    // answers) by id. getPuzzleById is unscoped, so gate it here as session-create does.
    const sess = await getSessionByJoinCode(this.env.DB, this.s.joinCode);
    if (puzzleRow.owner_id != null && puzzleRow.owner_id !== sess?.owner_id) return;
    // Corrupt row → ignore the verb (don't crash, keep the current puzzle).
    const built = this.buildPuzzleFromRow(puzzleRow);
    if (!built) return;
    this.puzzle = built.puzzle;
    this.publicPuzzle = built.publicPuzzle;
    this.s.config = { ...this.s.config, puzzleId, puzzleName: puzzleRow.name };
    await this.env.DB.prepare('UPDATE sessions SET puzzle_id = ? WHERE join_code = ?')
      .bind(puzzleId, this.s.joinCode)
      .run();
    await this.persist();
    this.broadcast();
  }

  private async reset(): Promise<void> {
    this.s.phase = 'idle';
    this.s.players = {};
    this.s.startedAt = null;
    this.s.pausedAccumMs = 0;
    this.s.pausedAt = null;
    this.s.countdownEndsAt = null;
    this.s.showLeaderboard = false;
    this.s.prizeGiven = false;
    this.s.resultsWritten = false;
    this.s.alarmIntent = null;
    this.s.commentary = null;
    await this.state.storage.deleteAlarm();
    await setSessionStatus(this.env.DB, this.s.joinCode, 'idle');
    await this.persist();
    this.broadcast();
  }

  // Authoritatively END a session — used both when it is REPLACED (design §I, via
  // the internal terminate RPC) and when the host clicks End Session (the
  // `endSession` verb). Sets the terminal flag, idles the phase, kills the alarm,
  // marks D1 'ended', and broadcasts so any connected booth/players drop to
  // standby. After this, hostOnly() rejects every verb and alarm() is a no-op, so
  // the row can never flip back out of 'ended' (no resurrection, no booth orphan).
  private async terminate(): Promise<void> {
    this.s.terminated = true;
    this.s.phase = 'idle';
    // Clear the roster like reset() does: an ended session's idle snapshot must NOT
    // still list players, or a connected player stays on the "waiting for organizer"
    // screen (PlayerApp shows "No active session" only when it isn't in players[]).
    this.s.players = {};
    this.s.alarmIntent = null;
    await this.state.storage.deleteAlarm();
    if (this.s.joinCode) await setSessionStatus(this.env.DB, this.s.joinCode, 'ended', Date.now());
    await this.persist();
    this.broadcast();
  }

  // -------------------------------------------------------------------------
  // alarm(): idempotent. Gates on intent IDENTITY (kind + round + phase), NOT
  // wall clock (runDurableObjectAlarm fires immediately).
  // -------------------------------------------------------------------------
  async alarm(): Promise<void> {
    if (this.s.terminated) return; // a terminated session never resurrects itself
    const intent = this.s.alarmIntent;
    if (!intent) return;
    if (intent.round !== this.s.round) return; // stale (round advanced)
    if (intent.kind === 'countdown') {
      if (this.s.phase !== 'countdown') return; // stale
      await this.goLive();
    } else if (intent.kind === 'lobbyRecycle') {
      if (this.s.phase !== 'lobby') return; // game progressed or already recycled
      // dueAt gate (same at-least-once protection as roundEnd): a redelivered/early
      // alarm must NOT recycle before the idle window — this is what keeps a host
      // phone-sleep from ending the session prematurely.
      if (Date.now() < intent.dueAt - ALARM_SKEW_MS) return;
      // Recheck live presence at fire time: a host/player reconnect (whose onHello
      // cancel may have raced the delivery) keeps the lobby alive.
      if (this.hasOpenHostSocket() || this.hasOpenPlayerSocket()) return;
      await this.reset(); // empty, idle lobby → standby (resumable, not destroyed)
    } else {
      if (this.s.phase !== 'live') return; // stale
      if (this.s.pausedAt != null) return; // paused — should not fire
      // Guard against an at-least-once / redelivered alarm (e.g. the just-
      // consumed countdown alarm) ending the round early: only end once the
      // round-end time has actually arrived.
      if (Date.now() < intent.dueAt - ALARM_SKEW_MS) return;
      // A PULLED-FORWARD all-finished grace alarm (its dueAt is earlier than the
      // real clock) must not cut off a player who reconnected unfinished during the
      // grace window: maybeAutoEnd only counted players connected at submit time,
      // and onHello can re-mark a straggler connected without restoring the clock.
      // If a connected non-finisher now exists, restore the original roundEnd clock
      // and let it (or a fresh all-finished re-pull) end the round. The genuine
      // timer expiry and a resume both schedule dueAt ≈ roundEndsAt(), so they never
      // match this pulled-forward test and still end normally. No broadcast needed:
      // the snapshot clock derives from startedAt+durationSec, never the alarm, so
      // clients showed the true clock throughout.
      const endsAt = this.roundEndsAt();
      if (
        endsAt != null &&
        intent.dueAt < endsAt - ALARM_SKEW_MS &&
        Object.values(this.s.players).some((p) => p.connected && p.finishMs == null)
      ) {
        this.s.alarmIntent = { kind: 'roundEnd', round: this.s.round, dueAt: endsAt };
        await this.state.storage.setAlarm(endsAt);
        await this.persist();
        return;
      }
      await this.endRoundInternal();
    }
  }

  private async goLive(): Promise<void> {
    const now = Date.now();
    this.s.phase = 'live';
    this.s.startedAt = now;
    this.s.pausedAccumMs = 0;
    this.s.pausedAt = null;
    this.s.countdownEndsAt = null;
    const dueAt = now + this.s.config.durationSec * 1000;
    this.s.alarmIntent = { kind: 'roundEnd', round: this.s.round, dueAt };
    await this.state.storage.setAlarm(dueAt);
    await setSessionStatus(this.env.DB, this.s.joinCode, 'live');
    await this.persist();
    this.broadcast();
  }

  private async endRoundInternal(): Promise<void> {
    this.s.phase = 'winner';
    this.s.pausedAt = null;
    this.s.alarmIntent = null;
    await this.state.storage.deleteAlarm();
    // Decide the winner + set the DETERMINISTIC commentary line immediately, so the
    // winner screen is never empty and the booth shows a line the instant it
    // appears. A winnerless round leaves commentary null (each surface renders its
    // own "no solve" copy).
    const winner = rankPlayers(this.publicPlayers(), this.s.config).find(
      (p) => p.finishMs != null,
    );
    const winnerScore = winner ? scoreFor(winner, this.s.config) : null;
    const commentaryParams =
      winner && winnerScore
        ? {
            name: winner.name,
            time: fmtTime(winnerScore.raw),
            hintsUsed: winner.hintsUsed,
            wrongAttempts: winner.wrongAttempts,
            puzzleName: this.s.config.puzzleName,
          }
        : null;
    this.s.commentary = commentaryParams ? fallbackWinnerLine(commentaryParams) : null;
    // writeResults() already swallows D1 errors, but wrap defensively so NOTHING
    // (even an unexpected throw) can prevent the phase→winner persist + broadcast.
    // The in-memory winner is authoritative for the screen; persistence retries
    // on the next end (resultsWritten stays false on failure).
    if (!this.s.resultsWritten) {
      try {
        await this.writeResults();
      } catch (err) {
        console.error('writeResults failed in endRoundInternal', err);
      }
    }
    await this.persist();
    this.broadcast();

    // Upgrade the deterministic line to a live AI line (best-effort; the fallback
    // is already on-screen so a slow/failed call changes nothing). The input gate
    // is OPEN across this fetch await, so a concurrent nextRound/reset could fire
    // meanwhile — guard the apply on the captured round still being the winner.
    if (commentaryParams) {
      const round = this.s.round;
      const env = this.env as unknown as WorkerEnv;
      const line = await winnerCommentary(env, commentaryParams, this.s.config.aiTone ?? DEFAULT_BRAND.aiTone);
      if (line && this.s.phase === 'winner' && this.s.round === round) {
        this.s.commentary = line;
        await this.persist();
        this.broadcast();
      }
    }
  }

  // round_results write — idempotent (UPSERT on UNIQUE(join_code,round)) AND
  // guarded by `resultsWritten` so host-endRound-then-alarm can't double-insert.
  // A D1 failure must NOT strand the round: it leaves resultsWritten=false (so the
  // next end retries) but does NOT throw past the catch — the winner screen still
  // shows from in-memory state.
  private async writeResults(): Promise<void> {
    const ranked = rankPlayers(this.publicPlayers(), this.s.config);
    const winner = ranked.find((p) => p.finishMs != null) ?? null;
    const winnerScore = winner ? scoreFor(winner, this.s.config) : null;
    try {
      await upsertRoundResult(this.env.DB, {
        joinCode: this.s.joinCode,
        round: this.s.round,
        winnerName: winner ? winner.name : null,
        winnerScoreJson: winnerScore ? JSON.stringify(winnerScore) : null,
        leaderboardJson: JSON.stringify(ranked),
        startedAt: this.s.startedAt,
        endedAt: Date.now(),
      });
      await setSessionStatus(this.env.DB, this.s.joinCode, 'winner', Date.now());
      // Only mark written once BOTH D1 writes succeeded.
      this.s.resultsWritten = true;
    } catch (err) {
      console.error('writeResults D1 write failed; will retry on next end', err);
    }
  }

  // -------------------------------------------------------------------------
  // Server clock (design §3). Single source of truth.
  // -------------------------------------------------------------------------
  private serverElapsedMs(): number {
    if (this.s.startedAt == null) return 0;
    const now = Date.now();
    const pausedNow = this.s.pausedAt != null ? now - this.s.pausedAt : 0;
    return Math.max(0, now - this.s.startedAt - this.s.pausedAccumMs - pausedNow);
  }

  private roundEndsAt(): number | null {
    if (this.s.startedAt == null) return null;
    return this.s.startedAt + this.s.config.durationSec * 1000 + this.s.pausedAccumMs;
  }

  // -------------------------------------------------------------------------
  // Projections + transport.
  // -------------------------------------------------------------------------
  private publicPlayers(): PublicPlayer[] {
    return Object.values(this.s.players).map((p) => ({
      id: p.id,
      name: p.name,
      filledPct: p.filledPct,
      hintsUsed: p.hintsUsed,
      wrongAttempts: p.wrongAttempts,
      finishMs: p.finishMs,
      connected: p.connected,
    }));
  }

  private winner(): PublicPlayer | null {
    if (this.s.phase !== 'winner') return null;
    const ranked = rankPlayers(this.publicPlayers(), this.s.config);
    return ranked.find((p) => p.finishMs != null) ?? null;
  }

  // Build a snapshot. publicPuzzle is included from lobby onward (NO answers);
  // null while idle (nothing to show yet).
  private snapshot(_ws?: WebSocket): Snapshot {
    const showPuzzle = this.s.phase !== 'idle';
    return {
      t: 'snapshot',
      phase: this.s.phase,
      round: this.s.round,
      joinCode: this.s.joinCode,
      config: this.s.config,
      publicPuzzle: showPuzzle ? this.publicPuzzle : null,
      players: this.publicPlayers(),
      startedAt: this.s.startedAt,
      serverTime: Date.now(),
      countdownEndsAt: this.s.countdownEndsAt,
      roundEndsAt: this.roundEndsAt(),
      paused: this.s.pausedAt != null,
      showLeaderboard: this.s.showLeaderboard,
      prizeGiven: this.s.prizeGiven,
      winner: this.winner(),
      commentary: this.s.commentary,
    };
  }

  private send(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket gone; ignore.
    }
  }

  // Send a private message to EVERY currently-open socket attached to `playerId`.
  // Used for reconnect-safe private replies (hint/finished): if the player
  // reconnected during an awaited persist, the reply still reaches the live
  // socket(s) instead of a dead one.
  private sendToPlayer(playerId: string, msg: unknown): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      const m = ws.deserializeAttachment() as SockMeta | null;
      if (m?.playerId !== playerId) continue;
      try {
        ws.send(payload);
      } catch {
        // ignore dead sockets
      }
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { t: 'error', code, message });
  }

  private broadcast(): void {
    const snap = this.snapshot();
    const payload = JSON.stringify(snap);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // ignore dead sockets
      }
    }
  }
}

function emptyConfig(): SessionConfig {
  return {
    puzzleId: '',
    puzzleName: '',
    difficulty: 'medium',
    durationSec: 120,
    hintPenalty: 0,
    wrongPenalty: 0,
    maxPlayers: 8,
    allowLate: false,
    strictValidation: true,
  };
}
