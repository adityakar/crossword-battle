// Result.tsx — the final leaderboard from the player's seat. Faithful port of
// prototype/player.jsx PlayerResult. Big rank ("#1" coral when you won) from
// rankPlayers, "of n players · pts", winner banner (coral if you), and a full
// leaderboard (isYou = player.id === playerId).
import { fmtTime, rankPlayers, type Snapshot } from '@cwb/shared';
import { LbRow, Screen, Wordmark } from '../../components';

export interface ResultProps {
  snapshot: Snapshot;
  playerId: string | null;
}

export function Result({ snapshot, playerId }: ResultProps) {
  const { config } = snapshot;
  const ranked = rankPlayers(snapshot.players, config);
  const myIdx = ranked.findIndex((p) => p.id === playerId);
  const me = myIdx >= 0 ? ranked[myIdx]! : null;
  const myRank = myIdx >= 0 ? myIdx + 1 : null;
  // The round winner (first finisher); mirrors the prototype's `find(p=>p.score)`.
  const winner = ranked.find((p) => p.score) ?? null;

  return (
    <Screen>
      <div className="pad" style={{ paddingTop: 16 }}>
        <Wordmark />
      </div>
      <div className="pad" style={{ paddingTop: 26, textAlign: 'center' }}>
        {!winner ? (
          // No-solve round: nobody finished, so there is nothing to crown. An
          // honest, quiet ending — NOT the celebratory coral "#1", which would
          // misread as a win (everyone is technically "rank 1" of all-no-solvers).
          <>
            <div className="label rise">ROUND OVER</div>
            <div className="display rise d1" style={{ fontSize: 56, marginTop: 8 }}>
              No solve<span className="coral">.</span>
            </div>
            <div className="body rise d2" style={{ marginTop: 12 }}>
              Nobody cracked it in time. The puzzle wins this round.
            </div>
          </>
        ) : myRank ? (
          <>
            <div className="label rise">YOUR RANK</div>
            <div className="display rise d1" style={{ fontSize: 96, marginTop: 6, lineHeight: 0.85 }}>
              {/* Coral #1 is reserved for an actual win (I solved AND placed first). */}
              {me?.score && myRank === 1 ? <span className="coral">#1</span> : `#${myRank}`}
            </div>
            <div className="body rise d2" style={{ marginTop: 10 }}>
              of {ranked.length} players ·{' '}
              {me?.score ? `${me.score.points} pts` : 'no solve'}
            </div>
          </>
        ) : (
          <div className="display" style={{ fontSize: 40 }}>
            Round over
          </div>
        )}
      </div>

      {winner && winner.score && (
        <div className="pad rise d2" style={{ marginTop: 20 }}>
          <div
            style={{
              background: myRank === 1 ? 'var(--coral)' : 'var(--ink)',
              color: myRank === 1 ? '#fff' : 'var(--cream)',
              borderRadius: 14,
              padding: '15px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 13,
            }}
          >
            <div style={{ flex: 1 }}>
              {/* No trophy emoji: it broke the custom-SVG iconography and rendered
                  inconsistently across devices. The coral #1 hero above already
                  crowns the winner; the banner stays editorial. Label alpha lifted
                  0.6 → 0.78 so this mono eyebrow reads better on the fill — it stays
                  a deliberate, subordinate whisper; the solid-white name beside it
                  is the legible element (small caps can't hit AA on coral either way). */}
              <div className="label" style={{ color: 'rgba(255,255,255,0.78)' }}>
                {myRank === 1 ? 'THAT’S YOU' : 'ROUND WINNER'}
              </div>
              <div className="h2" style={{ fontSize: 20, color: '#fff' }}>
                {winner.name}
              </div>
            </div>
            <div className="h2 tnum" style={{ fontSize: 22, color: '#fff' }}>
              {fmtTime(winner.score.raw)}
            </div>
          </div>
        </div>
      )}

      <div className="pad rise d3" style={{ marginTop: 20 }}>
        <div className="label" style={{ marginBottom: 6 }}>
          LEADERBOARD
        </div>
        {ranked.slice(0, 6).map((p, i) => (
          <LbRow
            key={p.id}
            rank={i + 1}
            player={p}
            cfg={config}
            lead={i === 0 && p.finishMs != null}
            isYou={p.id === playerId}
            roundOver
          />
        ))}
      </div>
    </Screen>
  );
}
