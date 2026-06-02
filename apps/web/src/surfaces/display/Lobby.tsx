// Lobby.tsx — the booth lobby: a dark left QR panel ("Play the floor.") and a
// light right panel with the huge PLAYERS JOINED count, popping name chips, and
// the RECENT WINNERS list. Faithful port of prototype/display.jsx DispLobby,
// driven by the live snapshot.
//
// Adaptations: the real <QR> encodes `${origin}/j/${code}` (the player join URL)
// rather than the prototype's pseudo-QR seed; the joined roster IS snapshot
// .players (PublicPlayer has no `joined` flag — appearing in the array is the
// join signal).
import { fmtTime, type Snapshot } from '@cwb/shared';
import { Chip, QR } from '../../components';
import { RecentWinners } from './RecentWinners';
import { DispChrome } from './DispChrome';

export interface LobbyProps {
  snapshot: Snapshot;
  /** The booth's route prefix (per-booth recent-winners scoping). Falls back to
   *  the code's letter half for direct /tv/<code> links. */
  boothPrefix?: string;
}

export function Lobby({ snapshot, boothPrefix }: LobbyProps) {
  const { joinCode, config } = snapshot;
  const joined = snapshot.players;
  const joinURL = `${location.origin}/j/${joinCode}`;

  return (
    <DispChrome
      right={
        <Chip kind="coral-soft" pulse style={{ fontSize: 13, padding: '8px 14px' }}>
          LOBBY OPEN
        </Chip>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100%' }}>
        {/* QR panel */}
        <div
          style={{
            background: 'var(--ink)',
            color: 'var(--cream)',
            padding: '56px 56px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div className="label" style={{ color: 'rgba(245,242,234,0.55)' }}>
            SCAN WITH YOUR PHONE
          </div>
          <div className="display" style={{ fontSize: 56, color: 'var(--cream)', marginTop: 14 }}>
            Play the
            <br />
            floor
            <span className="coral">.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginTop: 40 }}>
            {/* The cream tile + the QR's own 2-module quiet zone together form the
                light frame scanners need; padding stays small so the code fills
                the tile instead of floating in white. */}
            <div style={{ background: 'var(--cream)', padding: 12, borderRadius: 14 }}>
              <QR value={joinURL} size={270} bg="#F5F2EA" quiet={2} />
            </div>
            <div>
              <div className="label" style={{ color: 'rgba(245,242,234,0.55)' }}>
                OR ENTER CODE
              </div>
              <div
                className="h1 mono"
                style={{
                  fontSize: 44,
                  color: 'var(--coral)',
                  marginTop: 8,
                  letterSpacing: '0.03em',
                }}
              >
                {joinCode}
              </div>
              <div
                className="body"
                style={{ color: 'rgba(245,242,234,0.6)', marginTop: 14, fontSize: 15, maxWidth: 200 }}
              >
                A fast AI crossword. Fastest correct solve wins.
              </div>
            </div>
          </div>
        </div>

        {/* right */}
        <div style={{ padding: '48px 48px', display: 'flex', flexDirection: 'column' }}>
          <div className="kv" style={{ alignItems: 'flex-end' }}>
            <div>
              <div className="label">PLAYERS JOINED</div>
              <div
                className="display tnum"
                style={{ fontSize: 120, lineHeight: 0.85, marginTop: 8 }}
              >
                {joined.length}
              </div>
            </div>
            <div className="label" style={{ paddingBottom: 14 }}>
              {config.puzzleName.toUpperCase()} · {fmtTime(config.durationSec)}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              margin: '26px 0',
              minHeight: 80,
              alignContent: 'flex-start',
            }}
          >
            {joined.map((p) => (
              <span
                key={p.id}
                className="pop chip chip-line"
                style={{
                  fontSize: 13,
                  padding: '8px 14px',
                  fontFamily: 'var(--head)',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                {p.name}
              </span>
            ))}
            {joined.length === 0 && (
              <span className="body" style={{ fontSize: 15 }}>
                Waiting for the first scan…
              </span>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <hr className="hr" style={{ margin: '0 0 24px' }} />
          {/* Per-booth recent winners: prefer the route prefix; fall back to the
              code's letter half (true for prefixed codes; legacy codes under a
              different backfilled prefix rely on the routed boothPrefix). */}
          <RecentWinners prefix={boothPrefix ?? joinCode.slice(0, 3)} />
        </div>
      </div>
    </DispChrome>
  );
}
