// HostLeaderboard.tsx — the organizer's all-time top-10 board, shown atop
// /host/history. Lets the host pick which puzzle's board to view (the booth TV
// only ever shows the latest); defaults to the latest puzzle. Refetches when the
// selection changes or the parent bumps `refreshKey` (e.g. after a delete).
import { useEffect, useState } from 'react';
import * as api from '../../lib/api';

export function HostLeaderboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [data, setData] = useState<{
    puzzle: api.LbPuzzle | null;
    entries: api.LbEntry[];
    puzzles: api.LbPuzzle[];
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api
      .leaderboard(selected)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setLoaded(true);
        // If the selected puzzle vanished (its last session was deleted), the server
        // fell back to the latest — drop the stale selection so the <select> re-syncs
        // to what's actually shown instead of pointing at a now-gone option.
        if (selected && !res.puzzles.some((p) => p.id === selected)) setSelected(undefined);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e instanceof api.ApiError ? e.message : 'failed to load leaderboard');
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [selected, refreshKey]);

  const puzzles = data?.puzzles ?? [];
  const entries = data?.entries ?? [];
  // The <select> follows an explicit pick, else the server-chosen latest puzzle.
  const currentId = selected ?? data?.puzzle?.id ?? '';

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div className="label">LEADERBOARD · ALL-TIME</div>
        {puzzles.length > 0 && (
          <select
            className="field"
            aria-label="Puzzle"
            value={currentId}
            onChange={(e) => setSelected(e.target.value)}
            style={{ fontSize: 14, fontWeight: 500, padding: '9px 12px', width: 'auto' }}
          >
            {puzzles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {err && (
        <div className="body" style={{ fontSize: 13, color: 'var(--coral)', marginTop: 10 }}>
          {err}
        </div>
      )}
      {loaded && !err && entries.length === 0 && (
        <div className="body" style={{ fontSize: 14, marginTop: 12 }}>
          No scores yet. Finished rounds appear here.
        </div>
      )}
      {entries.length > 0 && (
        <div className="card" style={{ padding: '4px 16px', marginTop: 12 }}>
          {entries.map((e) => {
            const lead = e.rank === 1;
            return (
              <div
                key={e.rank}
                className={'lb-row' + (lead ? ' lead' : '')}
                style={{ gridTemplateColumns: '36px 1fr auto' }}
              >
                <span className="lb-rank">{e.rank}</span>
                <div style={{ minWidth: 0 }}>
                  <span className="lb-name">{e.name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={'h3 tnum' + (lead ? ' coral' : '')} style={{ fontSize: 16 }}>
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
      )}
    </section>
  );
}
