// useSession.ts — the realtime client hook. One WebSocket to /ws/:code, the
// full client→server send surface, snapshot state, a locally-ticked clock
// derived from the server's authoritative time, and reconnect-with-backoff.
//
// Design refs: §3 (server clock + reconnect/hibernation), §4 (WS protocol).
// Task 6 surfaces depend on THIS exact return shape — do not change it casually.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseServerMsg,
  type ClientMsg,
  type Score,
  type SessionConfig,
  type Snapshot,
} from '@cwb/shared';

export type SessionStatus = 'connecting' | 'open' | 'closed' | 'error';
export type SessionRole = 'host' | 'player' | 'tv';

export interface UseSessionOpts {
  hostToken?: string;
  /** When false, the hook stays idle until you call `connect()`. Default true. */
  autoConnect?: boolean;
}

export interface LastHint {
  r: number;
  c: number;
  letter: string;
}

export interface LastResult {
  wrong?: { wrongAttempts: number; penaltySec: number };
  incomplete?: { remainingCells: number };
  finished?: { finishMs: number; score: Score };
  /** A hint was refused because it arrived inside the per-player cooldown. */
  hintThrottled?: boolean;
}

export interface SessionSend {
  join(name: string): void;
  progress(filledPct: number): void;
  useHint(wordId: string): void;
  submit(entries: Record<string, string>): void;
  openLobby(): void;
  startCountdown(): void;
  pauseToggle(): void;
  toggleLeaderboard(): void;
  endRound(): void;
  nextRound(): void;
  markPrize(): void;
  setConfig(patch: Partial<SessionConfig>): void;
  setPuzzle(puzzleId: string): void;
  reset(): void;
  /** Terminal end (vs reset): marks the session 'ended' so it leaves the booth
   *  and can't be resumed. Returns whether the verb was actually sent — callers
   *  must only clear local state (go Home) when it returns `true`, else a send
   *  dropped on a closed socket leaves a live, resumable server session. */
  endSession(): boolean;
}

export interface UseSessionResult {
  status: SessionStatus;
  snapshot: Snapshot | null;
  playerId: string | null;
  remainingMs: number;
  lastHint: LastHint | null;
  lastResult: LastResult | null;
  error: string | null;
  send: SessionSend;
}

const MAX_BACKOFF_MS = 5000;
const BASE_BACKOFF_MS = 300;
const TICK_MS = 250; // ~4x/s local clock tick

function wsUrl(code: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws/${encodeURIComponent(code)}`;
}

function playerIdKey(code: string): string {
  return `cwb:playerId:${code}`;
}

function rejoinSecretKey(code: string): string {
  return `cwb:rejoinSecret:${code}`;
}

function readStoredPlayerId(code: string): string | null {
  try {
    return localStorage.getItem(playerIdKey(code));
  } catch {
    return null;
  }
}

function writeStoredPlayerId(code: string, id: string): void {
  try {
    localStorage.setItem(playerIdKey(code), id);
  } catch {
    // localStorage unavailable (private mode etc.) — non-fatal.
  }
}

function readStoredRejoinSecret(code: string): string | null {
  try {
    return localStorage.getItem(rejoinSecretKey(code));
  } catch {
    return null;
  }
}

function writeStoredRejoinSecret(code: string, secret: string): void {
  try {
    localStorage.setItem(rejoinSecretKey(code), secret);
  } catch {
    // localStorage unavailable (private mode etc.) — non-fatal.
  }
}

// Compute remaining ms for the CURRENT phase from a snapshot + the clock offset
// (offset = serverTime - localNow at the moment of the snapshot). We add the
// offset to Date.now() to estimate "server now", then diff against the relevant
// deadline. Clamped at 0; returns 0 when there is no active deadline.
function deriveRemainingMs(snap: Snapshot | null, offsetMs: number): number {
  if (!snap) return 0;
  if (snap.phase === 'countdown' && snap.countdownEndsAt != null) {
    return Math.max(0, snap.countdownEndsAt - (Date.now() + offsetMs));
  }
  if (snap.phase === 'live' && snap.roundEndsAt != null) {
    // Paused: the server holds roundEndsAt fixed but the local clock keeps
    // advancing, which would tick the timer down. Freeze it at the value at the
    // pause instant (roundEndsAt - serverTime). On resume, the paused:false
    // snapshot carries a fresh roundEndsAt and ticking resumes naturally.
    if (snap.paused) {
      return Math.max(0, snap.roundEndsAt - snap.serverTime);
    }
    return Math.max(0, snap.roundEndsAt - (Date.now() + offsetMs));
  }
  return 0;
}

export function useSession(
  code: string,
  role: SessionRole,
  opts?: UseSessionOpts,
): UseSessionResult {
  const autoConnect = opts?.autoConnect ?? true;
  const hostToken = opts?.hostToken;

  const [status, setStatus] = useState<SessionStatus>(autoConnect ? 'connecting' : 'closed');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() => readStoredPlayerId(code));
  // The rejoin secret is a private credential (paired with playerId) used to
  // reattach to the same server-side identity. Kept in a ref (not rendered).
  const rejoinSecretRef = useRef<string | null>(readStoredRejoinSecret(code));
  const [remainingMs, setRemainingMs] = useState(0);
  const [lastHint, setLastHint] = useState<LastHint | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs that must survive re-renders without re-triggering the connect effect.
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0); // serverTime - Date.now()
  const snapshotRef = useRef<Snapshot | null>(null);
  const playerIdRef = useRef<string | null>(playerId);
  const backoffRef = useRef(BASE_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUsRef = useRef(false);
  // Latest opts as refs so the persistent socket always sends current values on
  // (re)connect without resubscribing the effect.
  const roleRef = useRef(role);
  const hostTokenRef = useRef(hostToken);
  roleRef.current = role;
  hostTokenRef.current = hostToken;

  playerIdRef.current = playerId;
  snapshotRef.current = snapshot;

  // Low-level sender. Drops messages when the socket isn't open (best-effort).
  // Returns whether the frame was actually written (socket OPEN). Callers that
  // also mutate local state on a verb (endSession → clears the session + goes
  // Home) must gate that cleanup on a `true` return, or a dropped send strands a
  // still-live server session while the organizer thinks they ended it.
  const rawSend = useCallback((msg: ClientMsg): boolean => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  // Connect logic lives in a ref so reconnect timers can re-invoke it without it
  // being a dependency of the mount effect.
  const connectRef = useRef<() => void>(() => {});

  connectRef.current = () => {
    if (!code) return;
    // Tear down any prior socket before opening a new one.
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    closedByUsRef.current = false;
    setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(code));
    } catch {
      setStatus('error');
      setError('failed to open websocket');
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = BASE_BACKOFF_MS;
      setStatus('open');
      setError(null);
      // hello re-attaches identity (player) / authorizes (host) on every connect.
      // For a player we present BOTH the stored playerId AND its rejoinSecret;
      // the server only reattaches when the secret matches (else mints fresh).
      const hello: ClientMsg = {
        t: 'hello',
        role: roleRef.current,
        code,
        ...(roleRef.current === 'player' && playerIdRef.current
          ? { playerId: playerIdRef.current }
          : {}),
        ...(roleRef.current === 'player' && playerIdRef.current && rejoinSecretRef.current
          ? { rejoinSecret: rejoinSecretRef.current }
          : {}),
        ...(roleRef.current === 'host' && hostTokenRef.current
          ? { hostToken: hostTokenRef.current }
          : {}),
      };
      ws.send(JSON.stringify(hello));
    };

    ws.onmessage = (ev: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return; // ignore non-JSON frames
      }
      const res = parseServerMsg(parsed);
      if (!res.success) return; // ignore unknown / malformed frames (robustness)
      const msg = res.data;
      switch (msg.t) {
        case 'snapshot': {
          offsetRef.current = msg.serverTime - Date.now();
          snapshotRef.current = msg;
          setSnapshot(msg);
          setRemainingMs(deriveRemainingMs(msg, offsetRef.current));
          break;
        }
        case 'identity': {
          playerIdRef.current = msg.playerId;
          rejoinSecretRef.current = msg.rejoinSecret;
          setPlayerId(msg.playerId);
          writeStoredPlayerId(code, msg.playerId);
          writeStoredRejoinSecret(code, msg.rejoinSecret);
          break;
        }
        case 'hint': {
          setLastHint({ r: msg.r, c: msg.c, letter: msg.letter });
          break;
        }
        case 'wrong': {
          setLastResult({ wrong: { wrongAttempts: msg.wrongAttempts, penaltySec: msg.penaltySec } });
          break;
        }
        case 'incomplete': {
          setLastResult({ incomplete: { remainingCells: msg.remainingCells } });
          break;
        }
        case 'finished': {
          setLastResult({ finished: { finishMs: msg.finishMs, score: msg.score } });
          break;
        }
        case 'hintThrottled': {
          setLastResult({ hintThrottled: true });
          break;
        }
        case 'error': {
          setError(`${msg.code}: ${msg.message}`);
          break;
        }
      }
    };

    ws.onerror = () => {
      // onclose follows; surface a soft error but let reconnect handle recovery.
      if (!closedByUsRef.current) setStatus('error');
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (closedByUsRef.current) {
        setStatus('closed');
        return;
      }
      setStatus('closed');
      scheduleReconnect();
    };
  };

  // Exponential backoff reconnect (cap ~5s). Re-sends hello on reconnect, which
  // re-attaches the player via the stored playerId (design §3).
  function scheduleReconnect(): void {
    if (reconnectTimerRef.current) return;
    const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      connectRef.current();
    }, delay);
  }

  // Mount / code / autoConnect effect: open the socket and clean up on unmount.
  useEffect(() => {
    if (!autoConnect || !code) {
      setStatus('closed');
      return;
    }
    // Reset transient state when (re)subscribing to a new code.
    setSnapshot(null);
    snapshotRef.current = null;
    setLastHint(null);
    setLastResult(null);
    setError(null);
    const stored = readStoredPlayerId(code);
    playerIdRef.current = stored;
    setPlayerId(stored);
    rejoinSecretRef.current = readStoredRejoinSecret(code);
    backoffRef.current = BASE_BACKOFF_MS;

    connectRef.current();

    return () => {
      closedByUsRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, autoConnect]);

  // Local clock tick: re-derive remainingMs ~4x/s from the latest snapshot +
  // offset. Never advances phase — that's the server's job.
  useEffect(() => {
    const id = setInterval(() => {
      const snap = snapshotRef.current;
      if (!snap) return;
      if (snap.phase === 'countdown' || snap.phase === 'live') {
        setRemainingMs(deriveRemainingMs(snap, offsetRef.current));
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const send = useMemo<SessionSend>(
    () => ({
      join: (name) => rawSend({ t: 'join', name }),
      progress: (filledPct) =>
        rawSend({ t: 'progress', filledPct: Math.max(0, Math.min(1, filledPct)) }),
      useHint: (wordId) => rawSend({ t: 'useHint', wordId }),
      submit: (entries) => rawSend({ t: 'submit', entries }),
      openLobby: () => rawSend({ t: 'openLobby' }),
      startCountdown: () => rawSend({ t: 'startCountdown' }),
      pauseToggle: () => rawSend({ t: 'pauseToggle' }),
      toggleLeaderboard: () => rawSend({ t: 'toggleLeaderboard' }),
      endRound: () => rawSend({ t: 'endRound' }),
      nextRound: () => rawSend({ t: 'nextRound' }),
      markPrize: () => rawSend({ t: 'markPrize' }),
      setConfig: (patch) => rawSend({ t: 'setConfig', patch }),
      setPuzzle: (puzzleId) => rawSend({ t: 'setPuzzle', puzzleId }),
      reset: () => rawSend({ t: 'reset' }),
      endSession: () => rawSend({ t: 'endSession' }),
    }),
    [rawSend],
  );

  return { status, snapshot, playerId, remainingMs, lastHint, lastResult, error, send };
}

// Small helper used by surfaces: mm:ss from milliseconds.
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
