// RecentWinners.tsx — the lobby's "recent winners" list. Faithful port of
// prototype/display.jsx RecentWinners (trophy + name + time + note).
//
// Data comes from the PUBLIC history endpoint (GET /api/history/public?prefix=) —
// the booth display has no login. Scoped PER-BOOTH by the organizer prefix, so a
// booth only shows its own recent winners. On any fetch failure (or no winners
// yet) the graceful empty placeholder shows.
import { useEffect, useState } from 'react';
import * as api from '../../lib/api';

export interface RecentWinnersProps {
  /** The booth's organizer prefix (per-booth scoping). */
  prefix: string;
}

export function RecentWinners({ prefix }: RecentWinnersProps) {
  const [winners, setWinners] = useState<api.RecentWinner[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .historyPublic(prefix)
      .then((res) => {
        if (alive) setWinners(res.recentWinners);
      })
      .catch(() => {
        /* keep the empty placeholder */
      });
    return () => {
      alive = false;
    };
  }, [prefix]);

  return (
    <div>
      <div className="label" style={{ marginBottom: 14 }}>
        RECENT WINNERS
      </div>
      {winners.length === 0 ? (
        <div className="body" style={{ fontSize: 15 }}>
          Winners will appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {winners.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 18 }}>🏆</span>
              <span className="h3" style={{ fontSize: 17, flex: 1 }}>
                {w.name}
              </span>
              <span className="mono" style={{ fontSize: 15, color: 'var(--grey)' }}>
                {w.time}
              </span>
              <span className="chip chip-line">{w.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
