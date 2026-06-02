// PlayerApp.tsx — the player surface router. Owns the realtime useSession hook
// and renders the faithful player screens by snapshot.phase + whether you've
// joined. Server-authoritative: the client has NO answers; "you" is derived from
// the snapshot (players.find(id === playerId)), not a local flag, so it survives
// reconnects. Faithful recreation of prototype/player.jsx PlayerSurface.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PublicPuzzle } from '@cwb/engine';
import { isValidJoinCode, type PublicPlayer } from '@cwb/shared';
import * as api from '../../lib/api';
import { Screen, Wordmark } from '../../components';
import { useSession } from '../../lib/useSession';
import { usePrefersReducedMotion } from '../../lib/motion';
import { Join } from './Join';
import { Waiting } from './Waiting';
import { Countdown } from './Countdown';
import { Game } from './Game';
import { Completion } from './Completion';
import { Result } from './Result';
import { clearStoredEntries } from './useSolve';

// A centered status / terminal screen (connecting, idle, not-found, loading). The
// wordmark stays pinned top-left and the message centers vertically, matching the
// resting screens (Join / Waiting / Completion) so moving between any of them never
// jumps the content from top to center.
function StatusScreen({
  title,
  body,
  footer,
}: {
  title: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Screen center footer={footer}>
      <div className="pad" style={{ paddingTop: 16 }}>
        <Wordmark />
      </div>
      <div className="pad" style={{ margin: 'auto 0', textAlign: 'center' }}>
        <div className="h1" style={{ fontSize: 28 }}>
          {title}
        </div>
        {body != null && (
          <p className="body" style={{ marginTop: 12 }}>
            {body}
          </p>
        )}
      </div>
    </Screen>
  );
}

export function PlayerApp() {
  const { code = '' } = useParams();

  // Preflight: a failed /ws upgrade (bad/expired/typo'd code → 400/404) is hidden
  // from the WebSocket API, so without this the client would "Reconnecting…"
  // forever. The verdict is KEYED to `code` so a stale result from a previous
  // code never applies to a new one. exists: null = checking, false = no such
  // session, true = exists. (Derived: a malformed code is false immediately; a
  // valid-but-not-yet-checked code is null.)
  const [check, setCheck] = useState<{ code: string; exists: boolean | null }>(() => ({
    code,
    exists: isValidJoinCode(code) ? null : false,
  }));
  const exists = check.code === code ? check.exists : isValidJoinCode(code) ? null : false;
  useEffect(() => {
    let alive = true;
    if (!isValidJoinCode(code)) {
      setCheck({ code, exists: false });
      return;
    }
    setCheck({ code, exists: null });
    api
      .sessionExists(code)
      .then((r) => {
        if (alive) setCheck({ code, exists: r.exists });
      })
      .catch(() => {
        // Network error on the preflight itself — fall back to letting the WS try
        // (today's behavior); don't strand a real session behind a flaky check.
        if (alive) setCheck({ code, exists: null });
      });
    return () => {
      alive = false;
    };
  }, [code]);

  // Gate autoConnect on BOTH format and existence: a malformed code never opens a
  // doomed socket, and a known-missing code tears its socket down (no 404 loop).
  const { status, snapshot, playerId, remainingMs, lastHint, lastResult, send } = useSession(
    code,
    'player',
    { autoConnect: isValidJoinCode(code) && exists !== false },
  );

  // Optimistic name to cover the one render between send.join() and the snapshot
  // that lists us in players[] (so the lobby greeting doesn't flash empty).
  const [pendingName, setPendingName] = useState<string | null>(null);

  // "you" = the snapshot's projection of our own player, matched by id.
  const me = useMemo<PublicPlayer | null>(() => {
    if (!snapshot || !playerId) return null;
    return snapshot.players.find((p) => p.id === playerId) ?? null;
  }, [snapshot, playerId]);

  const onJoin = (name: string) => {
    setPendingName(name);
    send.join(name);
  };

  // Clear the persisted grid once the server marks us finished. This lives here
  // (not in useSolve) because finishing flips finishMs non-null → PlayerApp
  // swaps <Game> for <Completion>, unmounting useSolve, so a clear-on-finish
  // effect inside useSolve might never commit. Round-scoped keys already blank a
  // new round on their own; this is hygiene so a solved grid isn't left behind.
  const finished = me?.finishMs != null;
  useEffect(() => {
    if (snapshot && finished) clearStoredEntries(snapshot.joinCode, snapshot.round);
  }, [finished, snapshot]);

  // Clear the PREVIOUS round's persisted grid when the round advances (the
  // server only bumps `round` on winner→lobby, so <Game>/useSolve has already
  // unmounted and its write timer cancelled — no race with this removeItem).
  // Round-scoping alone makes the NEW round start blank; this actively evicts
  // the stale blob left under the OLD round's key.
  const prevRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const prev = prevRoundRef.current;
    if (prev != null && prev !== snapshot.round) {
      clearStoredEntries(snapshot.joinCode, prev);
    }
    prevRoundRef.current = snapshot.round;
  }, [snapshot]);

  // --- round-end board sweep ("pencils down") --------------------------------
  // When the round ends WITHOUT a solve (clock hit 0, or the organizer ended the
  // round), glide the play surface out before the result instead of a hard cut.
  // Driven by the live→winner phase transition, so it covers BOTH triggers. A
  // player who already finished is on Completion (finishMs set) and is skipped;
  // reduced motion cuts straight to the result. The last non-null puzzle is kept
  // so the board still renders during the sweep if the winner snapshot drops it.
  const reduce = usePrefersReducedMotion();
  const lastPuzzleRef = useRef<PublicPuzzle | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  // End the sweep once the board-sweep animation has played, then the result
  // renders into the cleared stage. (The START is decided synchronously during
  // render — see below — so the result never flashes before the board leaves.)
  useEffect(() => {
    if (!sweeping) return;
    const t = setTimeout(() => setSweeping(false), 470);
    return () => clearTimeout(t);
  }, [sweeping]);

  // No such session (bad/expired/typo'd code): a real terminal screen instead of
  // an endless "Reconnecting…". autoConnect is false here, so no socket is open.
  if (exists === false) {
    return (
      <StatusScreen
        title="Game not found"
        body={
          <>
            We couldn’t find a live game with code{' '}
            <span className="mono" style={{ color: 'var(--ink)' }}>
              {code || '—'}
            </span>
            . Double-check the code, or scan the QR on the screen again.
          </>
        }
        footer={
          <Link to="/" className="btn btn-coral" style={{ textDecoration: 'none' }}>
            Back to start →
          </Link>
        }
      />
    );
  }

  // Pre-snapshot: connecting.
  if (!snapshot) {
    return (
      <StatusScreen
        title={status === 'error' || status === 'closed' ? 'Reconnecting…' : 'Connecting…'}
        body={`Joining session ${code}.`}
      />
    );
  }

  const phase = snapshot.phase;
  const pp = snapshot.publicPuzzle as PublicPuzzle | null;
  // Keep the last real (live) puzzle so the board still renders during the sweep
  // even if the winner snapshot drops publicPuzzle.
  if (pp) lastPuzzleRef.current = pp;

  // Round-end board sweep: decide to sweep on the SAME render the phase flips
  // live→winner (covers timeout AND organizer end), so the result never flashes
  // before the board glides out. setState-during-render is the supported
  // "adjust state when a prop changes" pattern (guarded so it runs once per
  // transition). Skipped if the player already finished (they're on Completion)
  // or under reduced motion (straight cut to the result).
  const prevPhase = prevPhaseRef.current;
  if (prevPhase !== phase) {
    prevPhaseRef.current = phase;
    if (
      prevPhase === 'live' &&
      phase === 'winner' &&
      me != null &&
      me.finishMs == null &&
      lastPuzzleRef.current != null &&
      !reduce &&
      !sweeping
    ) {
      setSweeping(true);
    }
  }

  // A join is in flight (we sent join, snapshot not yet reflecting us). Build an
  // optimistic player so Waiting/Completion render with our name immediately.
  const joined = me != null || (pendingName != null && phase === 'lobby');
  const effectiveMe: PublicPlayer | null =
    me ??
    (pendingName != null
      ? {
          id: playerId ?? 'pending',
          name: pendingName,
          filledPct: 0,
          hintsUsed: 0,
          wrongAttempts: 0,
          finishMs: null,
          connected: true,
        }
      : null);

  // --- not yet joined: Join (open) / Join (locked) / idle ---
  if (!joined || !effectiveMe) {
    if (phase === 'idle') {
      return (
        <StatusScreen
          title="No active session"
          body="Waiting for the organizer to open a lobby. The QR will appear on the booth screen."
        />
      );
    }
    if (phase === 'lobby') return <Join snapshot={snapshot} onJoin={onJoin} />;
    if (phase === 'countdown' || phase === 'live') {
      return snapshot.config.allowLate ? (
        <Join snapshot={snapshot} onJoin={onJoin} />
      ) : (
        <Join snapshot={snapshot} locked onJoin={onJoin} />
      );
    }
    // winner: late arrival, joining closed.
    return <Join snapshot={snapshot} locked onJoin={onJoin} />;
  }

  // --- joined: route by phase ---
  // The playable board renders while live, AND stays mounted (exiting) through the
  // round-end sweep — the SAME instance animates out, so the player's own letters
  // glide away rather than a fresh board flashing in. Stable key (round is
  // unchanged across this round's live→winner) prevents a remount.
  const playingGame = phase === 'live' && effectiveMe.finishMs == null && pp != null;
  const sweepPuzzle = pp ?? lastPuzzleRef.current;
  if ((playingGame || sweeping) && sweepPuzzle) {
    return (
      <Game
        key={snapshot.round}
        snapshot={snapshot}
        pp={sweepPuzzle}
        remainingMs={sweeping ? 0 : remainingMs}
        send={send}
        lastHint={lastHint}
        lastResult={lastResult}
        me={effectiveMe}
        exiting={sweeping}
      />
    );
  }
  if (phase === 'lobby') return <Waiting snapshot={snapshot} me={effectiveMe} />;
  if (phase === 'countdown') return <Countdown me={effectiveMe} remainingMs={remainingMs} />;
  if (phase === 'live') {
    if (effectiveMe.finishMs != null) {
      return <Completion snapshot={snapshot} me={effectiveMe} />;
    }
    return <StatusScreen title="Loading puzzle…" />;
  }
  if (phase === 'winner') return <Result snapshot={snapshot} playerId={playerId} />;

  // Fallback (idle while joined): waiting.
  return <Waiting snapshot={snapshot} me={effectiveMe} />;
}
