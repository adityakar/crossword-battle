// Lobby.tsx — the join screen: real QR (to /j/:code), big join code, live roster
// of joined players, and the start/reset footer. Faithful port of
// prototype/organizer.jsx OrgLobby, driven by the live snapshot + send helpers.
//
// Responsive: phone is a single scroll column with the start/reset actions in the
// sticky footer (unchanged). Desktop (>=1024px) splits into a "how to join" panel
// (QR + code + cast link) beside the live roster, with the actions dissolved
// under the roster.
import type { Snapshot } from '@cwb/shared';
import { Avatar, Btn, Chip, QR, Screen } from '../../components';
import type { SessionSend } from '../../lib/useSession';
import { useHostShell } from '../../lib/useHostShell';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { OrgHeader } from './OrgHeader';

export interface LobbyProps {
  snapshot: Snapshot;
  send: SessionSend;
  /** This organizer's booth prefix → the BIG SCREEN link targets /tv/<prefix>
   *  (prefix-scoped + auto-recycling). Falls back to the code's letter half. */
  boothPrefix?: string | null;
  onCloseLobby: () => void;
}

export function Lobby({ snapshot, send, boothPrefix, onCloseLobby }: LobbyProps) {
  useHostShell();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const { joinCode, config } = snapshot;
  // A player appearing in snapshot.players IS the join signal (PublicPlayer has
  // no `joined` field) — mirrors the prototype's joined roster. Connection state
  // shows as the per-row dot color, not as roster membership.
  const joined = snapshot.players;
  const joinURL = `${location.origin}/j/${joinCode}`;
  const mirrorURL = `/tv/${boothPrefix ?? joinCode.slice(0, 3)}`;

  const joinPanel = (
    <div style={{ textAlign: 'center' }}>
      <div className="label">SCAN TO JOIN · {config.puzzleName.toUpperCase()}</div>
      <div
        className="card"
        style={{ display: 'inline-block', padding: 18, marginTop: 14, borderRadius: 18 }}
      >
        <QR value={joinURL} size={188} />
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="label">JOIN CODE</div>
        <div className="h1 mono" style={{ fontSize: 38, letterSpacing: '0.04em', marginTop: 6 }}>
          {joinCode}
        </div>
      </div>
    </div>
  );

  const bigScreenLink = (
    <a
      href={mirrorURL}
      target="_blank"
      rel="noreferrer"
      className="well"
      style={{
        marginTop: 12,
        padding: '12px 15px',
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        textDecoration: 'none',
      }}
    >
      <span className="chip chip-ink" style={{ fontSize: 9, flexShrink: 0 }}>
        ↗ BIG SCREEN
      </span>
      <span className="body" style={{ fontSize: 12 }}>
        Cast to the booth display for a big-screen lobby &amp; live board.
      </span>
    </a>
  );

  const rosterPanel = (
    <>
      <div className="kv" style={{ marginBottom: 10 }}>
        <div className="label">PLAYERS JOINED</div>
        <div className="h2 tnum">
          <span className="coral">{joined.length}</span>{' '}
          <span className="grey" style={{ fontSize: 16 }}>
            / {config.maxPlayers}
          </span>
        </div>
      </div>
      <div className="card" style={{ padding: '4px 16px', minHeight: 120 }}>
        {joined.length === 0 && (
          <div className="body" style={{ padding: '24px 0', textAlign: 'center', fontSize: 13 }}>
            Waiting for players to scan…
          </div>
        )}
        {joined.map((p, i) => (
          <div
            key={p.id}
            className="pop"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '12px 0',
              borderBottom: i < joined.length - 1 ? '1px solid var(--line)' : 'none',
            }}
          >
            <Avatar name={p.name} />
            <span className="h3" style={{ fontSize: 15, flex: 1 }}>
              {p.name}
            </span>
            <span className="chip chip-line">
              <span className="dot" style={{ color: p.connected ? '#3a9d6e' : 'var(--grey-soft)' }} />
              {p.connected ? 'ready' : 'away'}
            </span>
          </div>
        ))}
      </div>
    </>
  );

  const startBtn = (
    <Btn kind="coral" disabled={joined.length < 1} onClick={() => send.startCountdown()}>
      Start Countdown →
    </Btn>
  );
  // End Session: endSession() terminates the DO — marks it 'ended', releases
  // players, drops it from the booth AND makes it non-resumable. Only clear local
  // state (go Home) if the verb actually went out: a send dropped on a closed
  // socket must not strand a still-live, resumable server session.
  const endSessionBtn = (
    <Btn kind="ghost" onClick={() => { if (send.endSession()) onCloseLobby(); }}>
      End Session
    </Btn>
  );
  const clearBtn = (
    <Btn kind="ghost" onClick={() => send.reset()}>
      Clear Players
    </Btn>
  );

  // ---------------- desktop two-pane (>=1024px) ----------------
  if (isDesktop) {
    return (
      <>
        <OrgHeader right={<Chip kind="coral-soft" pulse>LOBBY OPEN</Chip>} />
        <div className="host-page">
          <div className="host-split" style={{ gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)' }}>
            <div>
              {joinPanel}
              {bigScreenLink}
            </div>
            <div>
              {rosterPanel}
              <div className="host-actions" style={{ marginTop: 18 }}>
                {startBtn}
                <div className="btn-row">
                  {endSessionBtn}
                  {clearBtn}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ---------------- phone layout (unchanged) ----------------
  return (
    <Screen
      footer={
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {startBtn}
          <div className="btn-row">
            {endSessionBtn}
            {clearBtn}
          </div>
        </div>
      }
    >
      <OrgHeader right={<Chip kind="coral-soft" pulse>LOBBY OPEN</Chip>} />
      <div className="pad" style={{ paddingTop: 20 }}>
        {joinPanel}
      </div>
      <div className="pad" style={{ marginTop: 22 }}>
        {rosterPanel}
        {bigScreenLink}
      </div>
    </Screen>
  );
}
