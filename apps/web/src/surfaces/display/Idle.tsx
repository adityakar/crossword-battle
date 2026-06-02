// Idle.tsx — the standby screen shown when there's no active round (phase 'idle',
// or no session at all). When given the booth's `prefix`, it shows that booth's
// all-time TOP SCORES board (the most-recently-played puzzle) as the standby hero;
// otherwise — or before any round has been played — it falls back to the white-
// labelled wordmark ("{event.appName}." with a coral dot). A subtle ShapeGrid
// drifts behind so the booth screen feels alive while it waits.
import { useEffect, useState } from 'react';
import { Chip, ShapeGrid } from '../../components';
import * as api from '../../lib/api';
import { useEvent } from '../../lib/event';
import { DispChrome } from './DispChrome';
import { StandbyLeaderboard } from './StandbyLeaderboard';

const REFRESH_MS = 60_000;

export function Idle({ prefix }: { prefix?: string } = {}) {
  const event = useEvent();
  const [board, setBoard] = useState<{ puzzle: api.LbPuzzle | null; entries: api.LbEntry[] } | null>(null);

  useEffect(() => {
    if (!prefix) {
      setBoard(null);
      return;
    }
    let alive = true;
    // Fetch once on mount + a slow refresh (deliberately NOT the 4s active poll):
    // new scores land during a session, when this screen isn't mounted, so a
    // remount already refreshes it; the interval just covers a long idle booth.
    const poll = () =>
      api
        .leaderboardPublic(prefix)
        .then((res) => {
          if (alive) setBoard(res);
        })
        .catch(() => {
          /* keep whatever we have (or the wordmark fallback) */
        });
    poll();
    const id = setInterval(poll, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [prefix]);

  const hasBoard = !!board && !!board.puzzle && board.entries.length > 0;

  return (
    <DispChrome
      right={
        <Chip kind="line" style={{ fontSize: 13, padding: '8px 14px' }}>
          STANDBY
        </Chip>
      }
    >
      {/* subtle animated grid (behind everything) */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <ShapeGrid
          direction="diagonal"
          speed={0.3}
          squareSize={64}
          shape="square"
          borderColor="rgba(31,27,25,0.07)"
          hoverFillColor={event.accent}
          fadeColor="#F5F2EA"
        />
      </div>
      {/* cream veil keeps the content crisp over the grid */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          background:
            'radial-gradient(ellipse 72% 60% at 50% 50%, rgba(245,242,234,0.86) 0%, rgba(245,242,234,0) 70%)',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          textAlign: 'center',
          padding: '24px 0',
        }}
      >
        {hasBoard ? (
          <StandbyLeaderboard puzzleName={board!.puzzle!.name} entries={board!.entries} />
        ) : (
          <>
            <div className="display" style={{ fontSize: 80 }}>
              {event.appName}
              <span className="coral">.</span>
            </div>
            <div className="body" style={{ fontSize: 20, marginTop: 20 }}>
              The next round is being set up at the booth.
            </div>
          </>
        )}
      </div>
    </DispChrome>
  );
}
