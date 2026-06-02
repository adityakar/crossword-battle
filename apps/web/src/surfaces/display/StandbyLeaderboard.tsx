// StandbyLeaderboard.tsx — the booth standby hero: an all-time top-10 for the
// booth's most-recently-played puzzle. Mirrors the in-game LbRow vocabulary
// (.lb-row / rank / name / points headline, coral on the leader) so the standby
// board reads as the same family as the live board, sized up for booth distance.
// Pre-formatted entries come from GET /api/leaderboard/public (points/time/note).
import type { LbEntry } from '../../lib/api';

export interface StandbyLeaderboardProps {
  puzzleName: string;
  entries: LbEntry[];
}

export function StandbyLeaderboard({ puzzleName, entries }: StandbyLeaderboardProps) {
  return (
    <div style={{ width: 'min(720px, 90%)', margin: '0 auto' }}>
      <div className="label" style={{ fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
        TOP SCORES · {puzzleName}
      </div>
      {entries.map((e) => {
        const lead = e.rank === 1;
        return (
          <div
            key={e.rank}
            className={'lb-row' + (lead ? ' lead' : '')}
            style={{ gridTemplateColumns: '44px 1fr auto', padding: '11px 6px' }}
          >
            <span className="lb-rank" style={{ fontSize: 18 }}>
              {e.rank}
            </span>
            <div style={{ minWidth: 0 }}>
              <span className="lb-name" style={{ fontSize: 20 }}>
                {e.name}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className={'h3 tnum' + (lead ? ' coral' : '')} style={{ fontSize: 20 }}>
                {e.points}
              </div>
              <div className="lb-time">
                {e.time} · {e.note}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
