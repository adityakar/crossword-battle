// HostApp.tsx — the organizer control surface.
//
// Auth-guards via me() (redirect to /login on failure). Before a session exists
// it shows local nav screens (Home / Setup). Setup hands a config up; HostApp
// creates the session (api.createSession), persists {joinCode,hostToken} in
// sessionStorage, and mounts <HostSession>, which owns the useSession hook and
// renders the live screens by snapshot.phase (Lobby/Countdown/Live/Winner).
//
// Production data flow differs from the prototype's local reducer: phase comes
// from the server snapshot, driven through useSession's host send helpers.
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SessionConfig } from '@cwb/shared';
import * as api from '../../lib/api';
import { Btn, Chip, Screen, Wordmark } from '../../components';
import { useSession } from '../../lib/useSession';
import { useHostShell } from '../../lib/useHostShell';
import { Home } from './Home';
import { Setup, type SetupConfig } from './Setup';
import { Lobby } from './Lobby';
import { Countdown } from './Countdown';
import { Live } from './Live';
import { Winner } from './Winner';
import { OrgHeader } from './OrgHeader';

const SESSION_KEY = 'cwb:host:session';

interface StoredSession {
  joinCode: string;
  hostToken: string;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(s: StoredSession | null): void {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

type LocalView = 'home' | 'setup';

export function HostApp() {
  const navigate = useNavigate();
  // The Builder route returns here with { openSetup, puzzleId } so we land on
  // Setup with the freshly-created puzzle pre-selected (instead of Home).
  const location = useLocation();
  const nav = (location.state ?? null) as { openSetup?: boolean; puzzleId?: string } | null;
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [puzzles, setPuzzles] = useState<api.PuzzleSummary[]>([]);
  const [session, setSession] = useState<StoredSession | null>(() => readStoredSession());
  const [view, setView] = useState<LocalView>(() => (nav?.openSetup ? 'setup' : 'home'));
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [resumeInfo, setResumeInfo] = useState<api.ActiveSession | null>(null);
  const [boothPrefix, setBoothPrefix] = useState<string | null>(null);
  // One-active conflict: a create returned 409 with the active session. We keep
  // the attempted SetupConfig so "Replace" can re-submit it with replace:true.
  const [conflict, setConflict] = useState<{ active: api.ActiveSession; cfg: SetupConfig } | null>(null);

  // Auth guard.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => {
        if (!alive) return;
        setAuthed(true);
        setBoothPrefix(r.organizer.prefix ?? null);
      })
      .catch(() => {
        if (alive) {
          setAuthed(false);
          navigate('/login');
        }
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  // Load puzzles once authed.
  useEffect(() => {
    if (!authed) return;
    api
      .listPuzzles()
      .then(({ puzzles }) => setPuzzles(puzzles))
      .catch((err) => setCreateErr(err instanceof Error ? err.message : 'failed to load puzzles'));
  }, [authed]);

  // Passive check for a resumable session (best-effort: failures leave it null).
  useEffect(() => {
    if (!authed) return;
    api
      .sessionsActive()
      .then(({ session }) => setResumeInfo(session))
      .catch(() => {});
  }, [authed]);

  // A Home error (a failed resume) auto-dismisses so a stale "session not found"
  // never freezes on the footer. Scoped to Home only — Setup's create errors and
  // the conflict prompt stay until the host acts, so they aren't missed.
  const onHome = !session && !conflict && view === 'home';
  useEffect(() => {
    if (!createErr || !onHome) return;
    const t = setTimeout(() => setCreateErr(null), 6000);
    return () => clearTimeout(t);
  }, [createErr, onHome]);

  async function onOpenLobby(cfg: SetupConfig, replace = false) {
    setBusy(true);
    setCreateErr(null);
    try {
      const config: Partial<SessionConfig> = {
        difficulty: cfg.difficulty,
        durationSec: cfg.durationSec,
        hintPenalty: cfg.hintPenalty,
        wrongPenalty: cfg.wrongPenalty,
        maxPlayers: cfg.maxPlayers,
        allowLate: cfg.allowLate,
        strictValidation: true,
        puzzleName: cfg.puzzleName,
      };
      const res = await api.createSession(cfg.puzzleId, config, replace);
      if (!res.ok) {
        // One active session per organizer — prompt to resume or replace.
        setConflict({ active: res.active, cfg });
        return;
      }
      setConflict(null);
      const next = { joinCode: res.joinCode, hostToken: res.hostToken };
      writeStoredSession(next);
      setSession(next);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'failed to create session');
    } finally {
      setBusy(false);
    }
  }

  // From the conflict prompt: resume the existing active session instead of
  // starting a new one (re-mints its host token and reconnects).
  async function onResumeConflict() {
    if (!conflict) return;
    setBusy(true);
    setCreateErr(null);
    try {
      const res = await api.resumeSession(conflict.active.joinCode);
      const next = { joinCode: res.joinCode, hostToken: res.hostToken };
      writeStoredSession(next);
      setSession(next);
      setConflict(null);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'failed to resume session');
    } finally {
      setBusy(false);
    }
  }

  // Resume the organizer's most-recent session: re-mint the host token (rotates
  // it server-side), store it, then mount <HostSession> to reconnect.
  async function onResume() {
    if (!resumeInfo) return;
    setBusy(true);
    setCreateErr(null);
    try {
      const res = await api.resumeSession(resumeInfo.joinCode);
      const next = { joinCode: res.joinCode, hostToken: res.hostToken };
      writeStoredSession(next);
      setSession(next); // mounts <HostSession>, which reconnects with the re-minted token
    } catch (err) {
      // Only a 404 means the offered session genuinely vanished (ended elsewhere
      // / aged out) — drop it so the CTA collapses instead of re-offering a dead
      // session. A network blip / 5xx leaves it so the still-valid CTA survives.
      if (err instanceof api.ApiError && err.status === 404) setResumeInfo(null);
      setCreateErr(err instanceof Error ? err.message : 'failed to resume session');
    } finally {
      setBusy(false);
    }
  }

  function endSession() {
    writeStoredSession(null);
    setSession(null);
    setView('home');
  }

  if (authed === null) {
    return <HostStatus label="CHECKING SESSION" body="One moment." />;
  }
  if (authed === false) {
    return <HostStatus label="REDIRECTING" body="Taking you to login." />;
  }

  // Active session → drive the live surface by snapshot.phase.
  if (session) {
    return (
      <HostSession
        key={session.joinCode}
        session={session}
        boothPrefix={boothPrefix}
        onEndSession={endSession}
      />
    );
  }

  // One-active conflict → resume-or-replace prompt.
  if (conflict) {
    return (
      <ConflictPrompt
        active={conflict.active}
        busy={busy}
        error={createErr}
        onResume={onResumeConflict}
        onReplace={() => onOpenLobby(conflict.cfg, true)}
        onCancel={() => setConflict(null)}
      />
    );
  }

  // No session → local nav between Home and Setup.
  if (view === 'setup') {
    return (
      <Setup
        puzzles={puzzles}
        round={1}
        busy={busy}
        error={createErr}
        initialPuzzleId={nav?.openSetup ? nav.puzzleId : undefined}
        onOpenLobby={onOpenLobby}
        onBack={() => {
          setCreateErr(null);
          setView('home');
        }}
      />
    );
  }

  return (
    <Home
      onCreateNew={() => {
        setCreateErr(null);
        setView('setup');
      }}
      onResume={onResume}
      canResume={resumeInfo != null}
      resumeInfo={resumeInfo}
      boothPrefix={boothPrefix}
      error={createErr}
    />
  );
}

// Resume-or-replace prompt shown when create hits the one-active-session guard.
function ConflictPrompt({
  active,
  busy,
  error,
  onResume,
  onReplace,
  onCancel,
}: {
  active: api.ActiveSession;
  busy: boolean;
  error: string | null;
  onResume: () => void;
  onReplace: () => void;
  onCancel: () => void;
}) {
  useHostShell('read'); // a focused decision screen → bounded reading column on desktop
  return (
    <Screen
      footer={
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {error && (
            <div className="body" style={{ fontSize: 13, color: 'var(--coral)', textAlign: 'center' }}>
              {error}
            </div>
          )}
          <Btn kind="coral" disabled={busy} onClick={onResume}>
            Resume {active.joinCode} →
          </Btn>
          <Btn kind="dark" disabled={busy} onClick={onReplace}>
            Replace with a new session
          </Btn>
          <Btn kind="ghost" disabled={busy} onClick={onCancel}>
            Back
          </Btn>
        </div>
      }
    >
      <OrgHeader right={<Chip kind="line">ACTIVE SESSION</Chip>} />
      <div className="pad" style={{ paddingTop: 30 }}>
        <div className="label rise">ONE SESSION AT A TIME</div>
        <div className="display rise d1" style={{ fontSize: 34, marginTop: 12 }}>
          You’re already live<span className="coral">.</span>
        </div>
        <p className="body rise d2" style={{ fontSize: 15, marginTop: 14, maxWidth: 320 }}>
          This booth already has an active session. Resume it to keep going, or replace it
          to start fresh — replacing ends the current one.
        </p>
        <div className="well rise d3" style={{ marginTop: 18, padding: '14px 16px' }}>
          <div className="label">CURRENT</div>
          <div className="h3" style={{ fontSize: 16, marginTop: 4 }}>
            <span className="mono coral">{active.joinCode}</span>
            {active.puzzleName ? ` · ${active.puzzleName}` : ''} · {active.status.toUpperCase()}
          </div>
        </div>
      </div>
    </Screen>
  );
}

// HostSession owns the WebSocket (useSession). It's mounted only when a session
// exists, so the hook never connects with an empty code, and unmounts cleanly on
// end. An effect opens the lobby once the socket is live and the freshly-created
// session is still idle (idempotent: once phase ≠ idle it won't re-fire, so it
// survives reconnects too).
function HostSession({
  session,
  boothPrefix,
  onEndSession,
}: {
  session: StoredSession;
  boothPrefix: string | null;
  onEndSession: () => void;
}) {
  const { status, snapshot, remainingMs, error, send } = useSession(session.joinCode, 'host', {
    hostToken: session.hostToken,
  });

  useEffect(() => {
    if (status === 'open' && snapshot?.phase === 'idle') {
      send.openLobby();
    }
  }, [status, snapshot?.phase, send]);

  // If this session is no longer the booth's active one — ended/terminated here or
  // from another device ('terminated'), or refused resurrection because another
  // session is now active ('superseded') — the server rejects the host verb. Don't
  // sit stuck on "opening lobby"; return to Home, which clears the stale session.
  useEffect(() => {
    if (error && (error.startsWith('terminated:') || error.startsWith('superseded:'))) {
      onEndSession();
    }
  }, [error, onEndSession]);

  // Connecting / pre-snapshot.
  if (!snapshot) {
    return (
      <HostStatus
        label="CONNECTING"
        body={`Joining session ${session.joinCode}.`}
        error={error}
      />
    );
  }

  switch (snapshot.phase) {
    case 'lobby':
      return (
        <Lobby snapshot={snapshot} send={send} boothPrefix={boothPrefix} onCloseLobby={onEndSession} />
      );
    case 'countdown':
      return <Countdown snapshot={snapshot} remainingMs={remainingMs} />;
    case 'live':
      return <Live snapshot={snapshot} remainingMs={remainingMs} send={send} />;
    case 'winner':
      return <Winner snapshot={snapshot} send={send} onEndSession={onEndSession} />;
    case 'idle':
    default:
      // Transient: openLobby() has been (or is being) sent; show a brief opening
      // state rather than a blank screen.
      return <HostStatus label="OPENING LOBBY" body={`Setting up session ${session.joinCode}.`} />;
  }
}

// A centered status / transition screen (auth check, connecting, opening lobby)
// — wordmark pinned top, message centered — mirroring the player StatusScreen so
// moving between host states never flashes bare top-left text.
function HostStatus({
  label,
  body,
  error,
}: {
  label: string;
  body?: ReactNode;
  error?: string | null;
}) {
  useHostShell('read'); // brief transition screen → centered reading column on desktop
  return (
    <Screen center>
      <div className="pad" style={{ paddingTop: 16 }}>
        <Wordmark />
      </div>
      <div className="pad" style={{ margin: 'auto 0', textAlign: 'center' }}>
        <div className="label">{label}</div>
        {body != null && (
          <p className="body" style={{ fontSize: 14, marginTop: 10 }}>
            {body}
          </p>
        )}
        {error && (
          <p className="body" style={{ fontSize: 13, marginTop: 12, color: 'var(--coral)' }}>
            {error}
          </p>
        )}
      </div>
    </Screen>
  );
}
