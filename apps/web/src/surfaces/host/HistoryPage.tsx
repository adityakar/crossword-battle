// HistoryPage.tsx — the organizer "Results" surface (route /host/history): the
// all-time leaderboard (HostLeaderboard) on top, then past games grouped by
// session, each deletable so trial/test rounds can be scrubbed off the public
// board. Organizer-gated (api.me() guard, mirroring HostApp).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Btn, Chip, Screen } from '../../components';
import * as api from '../../lib/api';
import { useHostShell } from '../../lib/useHostShell';
import { OrgHeader } from './OrgHeader';
import { HostLeaderboard } from './HostLeaderboard';

interface SessionGroup {
  code: string;
  active: boolean; // server-computed (genuinely live / lingering winner) → Delete hidden
  rounds: api.HistoryRound[];
}

export function HistoryPage() {
  const navigate = useNavigate();
  useHostShell('read'); // desktop: a bounded reading column, not a phone strip
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Auth guard.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(() => alive && setAuthed(true))
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

  const [rounds, setRounds] = useState<api.HistoryRound[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Bumped after a delete so the leaderboard refetches alongside the round list.
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    api
      .historyRounds(50)
      .then(({ rounds }) => {
        if (!alive) return;
        setRounds(rounds);
        setLoaded(true);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e instanceof api.ApiError ? e.message : 'failed to load history');
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
    // refreshKey re-pulls the authoritative list after a delete (the optimistic
    // local removal gives instant feedback; this reconciles + fills any 51st round).
  }, [authed, refreshKey]);

  // Group the flat (newest-first) round list by session; Map preserves order, so
  // the newest session leads and a group's rounds stay newest-first.
  const groups = useMemo<SessionGroup[]>(() => {
    const m = new Map<string, api.HistoryRound[]>();
    for (const r of rounds) {
      const arr = m.get(r.joinCode);
      if (arr) arr.push(r);
      else m.set(r.joinCode, [r]);
    }
    return [...m.entries()].map(([code, rs]) => ({ code, active: rs[0]!.active, rounds: rs }));
  }, [rounds]);

  async function doDelete(code: string) {
    setDeleting(true);
    setDelErr(null);
    try {
      await api.deleteSession(code);
      setRounds((rs) => rs.filter((r) => r.joinCode !== code));
      setRefreshKey((k) => k + 1);
      setConfirmCode(null);
    } catch (e) {
      const msg =
        e instanceof api.ApiError
          ? e.status === 409
            ? 'That game is currently live — end it first.'
            : e.message
          : 'could not delete this game';
      setDelErr(msg);
    } finally {
      setDeleting(false);
    }
  }

  if (authed === null) {
    return (
      <main className="pad" style={{ paddingTop: 40 }}>
        Checking session…
      </main>
    );
  }
  if (authed === false) {
    return (
      <main className="pad" style={{ paddingTop: 40 }}>
        Redirecting…
      </main>
    );
  }

  return (
    <Screen>
      <OrgHeader
        right={
          <Btn kind="ghost" sm onClick={() => navigate('/host')} style={{ width: 'auto' }}>
            ← Back
          </Btn>
        }
      />

      <div className="pad" style={{ paddingTop: 22 }}>
        <div className="label">RESULTS</div>
        <div className="h1" style={{ fontSize: 32, marginTop: 8 }}>
          Leaderboard &amp; history
        </div>
      </div>

      <div className="pad" style={{ marginTop: 20 }}>
        <HostLeaderboard refreshKey={refreshKey} />
      </div>

      <div className="pad" style={{ marginTop: 30 }}>
        <div className="label" style={{ marginBottom: 14 }}>
          PAST GAMES
        </div>
        {err && (
          <div className="body" style={{ fontSize: 13, marginBottom: 12, color: 'var(--coral)' }}>
            {err}
          </div>
        )}
        {loaded && !err && groups.length === 0 && (
          <div className="body" style={{ fontSize: 14 }}>
            No games played yet.
          </div>
        )}
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {groups.map((g) => {
            const deletable = !g.active;
            const confirming = confirmCode === g.code;
            return (
              <div key={g.code} className="card" style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span className="label mono">{g.code}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="label">
                      {g.rounds.length} round{g.rounds.length === 1 ? '' : 's'}
                    </span>
                    {deletable ? (
                      !confirming && (
                        <Btn
                          kind="ghost"
                          sm
                          onClick={() => {
                            setConfirmCode(g.code);
                            setDelErr(null);
                          }}
                          style={{ width: 'auto' }}
                        >
                          Delete game
                        </Btn>
                      )
                    ) : (
                      <Chip kind="line">live</Chip>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {g.rounds.map((r) => (
                    <div key={r.round} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                      <span className="label" style={{ width: 74, flexShrink: 0 }}>
                        ROUND {r.round}
                      </span>
                      <div className="h3" style={{ fontSize: 15, flex: 1, minWidth: 0 }}>
                        {r.winnerName ? (
                          <>
                            <span className="coral">{r.winnerName}</span>
                            {r.winnerTime && <span className="coral">{` · ${r.winnerTime}`}</span>}
                          </>
                        ) : (
                          <span className="grey">No solve</span>
                        )}
                      </div>
                      <span className="label" style={{ whiteSpace: 'nowrap' }}>
                        {r.players} player{r.players === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="label" style={{ marginTop: 10 }}>
                  {new Date(g.rounds[0]!.endedAt).toLocaleString()}
                </div>

                {confirming && (
                  <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                    <div className="body body-ink" style={{ fontSize: 13 }}>
                      Delete this game and its {g.rounds.length} round{g.rounds.length === 1 ? '' : 's'}? This
                      removes them from the leaderboard and history.
                    </div>
                    {delErr && (
                      <div className="body" style={{ fontSize: 12, color: 'var(--coral)', marginTop: 6 }}>
                        {delErr}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                      <Btn
                        kind="ghost"
                        sm
                        onClick={() => setConfirmCode(null)}
                        disabled={deleting}
                        style={{ width: 'auto' }}
                      >
                        Cancel
                      </Btn>
                      <Btn
                        kind="coral"
                        sm
                        onClick={() => doDelete(g.code)}
                        disabled={deleting}
                        style={{ width: 'auto' }}
                      >
                        {deleting ? 'Deleting…' : 'Delete game'}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
