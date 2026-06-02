// Live.tsx — the live booth board: a big leaderboard on the left (or the "Heads
// down." suspense state when the host hides the board) and a dark "OUT IN FRONT"
// leader spotlight on the right. The leaderboard ranks finishers by score (these
// reorder with a FLIP animation as solves land); still-solving players hold a
// stable order below. The spotlight crowns the top ACTUAL finisher — there is no
// "leader" until someone solves correctly. Faithful port of prototype DispLive.
import { fmtTime, rankPlayers, type Snapshot } from '@cwb/shared';
import { Avatar, Chip, LbRow } from '../../components';
import { DispChrome } from './DispChrome';
import { useCountUp, useFlip } from '../../lib/motion';

export interface LiveProps {
  snapshot: Snapshot;
  remainingMs: number;
}

export function Live({ snapshot, remainingMs }: LiveProps) {
  const { config, paused, showLeaderboard } = snapshot;
  // stableUnfinished: still-solving rows don't shuffle by the (hidden, unverified)
  // filledPct — only a real finish reorders the board.
  const ranked = rankPlayers(snapshot.players, config, { stableUnfinished: true });
  const top = ranked.slice(0, 6);
  const champ = top[0] && top[0].finishMs != null ? top[0] : null;
  const remainingSec = remainingMs / 1000;
  const danger = remainingSec <= 20;
  const finished = ranked.filter((p) => p.finishMs != null).length;

  const register = useFlip(top.map((p) => p.id).join(','));
  const champPoints = useCountUp(champ?.score?.points ?? 0);

  return (
    <DispChrome
      right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {paused && (
            <Chip kind="line" style={{ fontSize: 13, padding: '8px 14px' }}>
              PAUSED
            </Chip>
          )}
          <div style={{ textAlign: 'right' }}>
            <div className="label" style={{ fontSize: 11 }}>
              TIME LEFT
            </div>
            <div
              className={'count-num tnum' + (danger ? ' coral' : '')}
              style={{ fontSize: 52, lineHeight: 1 }}
            >
              {fmtTime(remainingSec)}
            </div>
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', height: '100%' }}>
        {/* leaderboard */}
        <div style={{ padding: '30px 44px', overflow: 'hidden' }}>
          <div className="label" style={{ marginBottom: 6 }}>
            LIVE LEADERBOARD
          </div>
          {showLeaderboard ? (
            top.map((p, i) => (
              <LbRow
                key={p.id}
                innerRef={register(p.id)}
                rank={i + 1}
                player={p}
                cfg={config}
                lead={i === 0 && p.finishMs != null}
                big
              />
            ))
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '80%',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div className="display" style={{ fontSize: 56 }}>
                  Heads down
                  <span className="coral">.</span>
                </div>
                <div className="body" style={{ fontSize: 18, marginTop: 12 }}>
                  Ranks revealed at the buzzer.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* leader spotlight */}
        <div
          style={{
            background: 'var(--ink)',
            color: 'var(--cream)',
            padding: '40px 40px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div className="label" style={{ color: 'rgba(245,242,234,0.55)' }}>
            OUT IN FRONT
          </div>
          {champ ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18 }}>
                <Avatar name={champ.name} coral size={64} />
                <div className="h1" style={{ fontSize: 38, color: 'var(--cream)' }}>
                  {champ.name}
                </div>
              </div>
              <div className="display tnum coral" style={{ fontSize: 84, marginTop: 24 }}>
                {champPoints}
              </div>
              <div className="label" style={{ color: 'rgba(245,242,234,0.55)', marginTop: 4 }}>
                POINTS · {fmtTime(champ.score!.raw)}
              </div>
            </>
          ) : (
            <div
              className="body"
              style={{ color: 'rgba(245,242,234,0.62)', marginTop: 20, fontSize: 20, lineHeight: 1.4 }}
            >
              No solves yet.
              <br />
              First correct solve takes the lead.
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div className="label" style={{ color: 'rgba(245,242,234,0.45)' }}>
            {finished} FINISHED · {ranked.length} PLAYING
          </div>
        </div>
      </div>
    </DispChrome>
  );
}
