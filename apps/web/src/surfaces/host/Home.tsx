// Home.tsx — organizer landing (no active session). Editorial hero from the
// active EVENT, a "TODAY" stat card, and a "last winner" well. Faithful port of
// prototype/organizer.jsx OrgHome.
//
// History is wired via GET /api/history (round_results): the TODAY counts and
// the last-winner well start at graceful zeros/empty and fill in on mount. The
// fetch is best-effort — on any failure the placeholders simply remain.
//
// Responsive: on a phone it's a single scroll column with the primary action
// pinned in the sticky footer (unchanged). On a desktop viewport (>=1024px) it
// opts into the wider host shell (useHostShell) and reflows into a two-column
// dashboard — an identity + action "act" column beside a "today" status card —
// dissolving the sticky bar into the layout.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Btn, Chip, HeaderMenu, Screen, Stat } from '../../components';
import * as api from '../../lib/api';
import { useEvent, lockup } from '../../lib/event';
import { useHostShell } from '../../lib/useHostShell';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { OrgHeader } from './OrgHeader';

export interface HomeProps {
  onCreateNew: () => void;
  onResume: () => void;
  canResume: boolean;
  resumeInfo?: api.ActiveSession | null;
  /** This organizer's booth prefix → deep-links the booth-display launcher. */
  boothPrefix?: string | null;
  /** A resume/create failure surfaced from HostApp (coral line in the footer). */
  error?: string | null;
}

const tagline =
  'Run a fast crossword challenge for the floor. Players join by QR, the fastest correct solve wins.';

export function Home({ onCreateNew, onResume, canResume, resumeInfo, boothPrefix, error }: HomeProps) {
  const event = useEvent();
  const navigate = useNavigate();
  useHostShell(); // widen #root on desktop; inert on phones (CSS-gated to >=1024px)
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Clear the organizer's server session, then return to login. Logout errors
  // are ignored — we clear the client side and redirect regardless.
  const onLogout = async () => {
    await api.logout().catch(() => {});
    navigate('/login');
  };

  const [history, setHistory] = useState<api.HistoryStats>({ rounds: 0, players: 0, winners: 0 });
  const [lastWinner, setLastWinner] = useState<api.HistoryLastWinner | null>(null);

  // Home is only mounted once the organizer is authed (HostApp guards it), so a
  // bare fetch is safe; failures keep the zero placeholders.
  useEffect(() => {
    let alive = true;
    api
      .history()
      .then((res) => {
        if (!alive) return;
        setHistory(res.today);
        setLastWinner(res.lastWinner);
      })
      .catch(() => {
        /* keep graceful placeholders */
      });
    return () => {
      alive = false;
    };
  }, []);

  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();

  // Shared between both layouts: ORGANIZER chip + the account/branding/logout
  // overflow menu (account-level actions never live in the page body).
  const headerRight = (
    <>
      <Chip kind="line">ORGANIZER</Chip>
      <HeaderMenu
        items={[
          { label: 'Manage organizers', onClick: () => navigate('/host/account') },
          { label: 'Event branding', onClick: () => navigate('/host/branding') },
          { label: 'Log out', onClick: onLogout, danger: true },
        ]}
      />
    </>
  );

  const stats = (
    <div className="host-dash-stats">
      <Stat n={history.rounds} label="ROUNDS" />
      <Stat n={history.players} label="PLAYERS" />
      <Stat n={history.winners} label="WINNERS" coral />
    </div>
  );

  const lastWinnerLine = lastWinner ? (
    <>
      Last winner — <span className="body-ink" style={{ fontWeight: 600 }}>{lastWinner.name}</span>
      {`, ${lastWinner.time} · ${lastWinner.hints} hint${lastWinner.hints === 1 ? '' : 's'}`}
    </>
  ) : (
    'No rounds played yet today.'
  );

  const quickLinks = (
    <>
      <Btn kind="ghost" sm onClick={() => navigate('/host/history')} style={{ width: 'auto' }}>
        Round history
      </Btn>
      {/* Booth display: opens the read-only big-screen view in a new tab/window,
          deep-linked to THIS booth's prefix (/tv/<prefix>). */}
      <Btn
        kind="ghost"
        sm
        onClick={() => window.open(boothPrefix ? `/tv/${boothPrefix}` : '/tv', '_blank', 'noopener')}
        style={{ width: 'auto' }}
      >
        Open booth display ↗
      </Btn>
    </>
  );

  // ---------------- desktop dashboard (>=1024px) ----------------
  if (isDesktop) {
    return (
      <>
        <OrgHeader right={headerRight} />
        <div className="host-dash">
          <div className="host-dash-grid">
            {/* act column: identity marquee + the primary action */}
            <div>
              <div className="label rise">
                {lockup(event.venueLabel.toUpperCase(), 'LIVE GAME SHOW')}
              </div>
              <h1
                className="display rise d1"
                style={{ fontSize: 'clamp(54px, 6vw, 76px)', marginTop: 16 }}
              >
                {event.appName}
                <span className="coral">.</span>
              </h1>
              <p className="body rise d2 host-dash-lead" style={{ fontSize: 16, marginTop: 18 }}>
                {tagline}
              </p>
              <div className="host-dash-actions rise d3">
                <Btn kind="coral" onClick={onCreateNew}>
                  Create New Session →
                </Btn>
                {canResume && resumeInfo && (
                  <div style={{ marginTop: 12 }}>
                    <Btn kind="ghost" onClick={onResume}>
                      Resume {resumeInfo.joinCode} →
                    </Btn>
                    <div className="label" style={{ marginTop: 8 }}>
                      {resumeInfo.puzzleName} · {resumeInfo.status.toUpperCase()}
                    </div>
                  </div>
                )}
                {error && (
                  <div className="body" style={{ fontSize: 13, color: 'var(--coral)', marginTop: 12 }}>
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* status column: one card, hairline-divided sections */}
            <aside className="card rise d2">
              <div className="host-dash-sec">
                <div className="label" style={{ marginBottom: 14 }}>
                  TODAY · {weekday}
                </div>
                {stats}
              </div>
              <div
                className="host-dash-sec"
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <span className="dot" style={{ color: 'var(--grey-soft)' }} />
                <span className="body" style={{ fontSize: 13 }}>
                  {lastWinnerLine}
                </span>
              </div>
              <div className="host-dash-sec">
                <div className="host-dash-links">{quickLinks}</div>
              </div>
            </aside>
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
          {error && (
            <div className="body" style={{ fontSize: 13, color: 'var(--coral)', textAlign: 'center' }}>
              {error}
            </div>
          )}
          <Btn kind="coral" onClick={onCreateNew}>
            Create New Session →
          </Btn>
          {/* Resume only renders when there is a genuinely-resumable session
              (server /sessions/active now returns only active statuses). No
              dead disabled bar when there's nothing to resume. */}
          {canResume && resumeInfo && (
            <>
              <Btn kind="ghost" onClick={onResume}>
                Resume {resumeInfo.joinCode} →
              </Btn>
              <div className="label" style={{ textAlign: 'center' }}>
                {resumeInfo.puzzleName} · {resumeInfo.status.toUpperCase()}
              </div>
            </>
          )}
        </div>
      }
    >
      <OrgHeader right={headerRight} />
      <div className="pad" style={{ paddingTop: 30 }}>
        <div className="label rise">{lockup(event.venueLabel.toUpperCase(), 'LIVE GAME SHOW')}</div>
        <div className="display rise d1" style={{ fontSize: 54, marginTop: 14 }}>
          {event.appName}
          <span className="coral">.</span>
        </div>
        <p className="body rise d2" style={{ fontSize: 15, marginTop: 16, maxWidth: 300 }}>
          {tagline}
        </p>
      </div>
      <div className="pad rise d3" style={{ marginTop: 30 }}>
        <div className="label" style={{ marginBottom: 14 }}>
          TODAY · {weekday}
        </div>
        <div
          className="card"
          style={{
            padding: '22px 20px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 8,
          }}
        >
          <Stat n={history.rounds} label="ROUNDS" />
          <Stat n={history.players} label="PLAYERS" />
          <Stat n={history.winners} label="WINNERS" coral />
        </div>
        <div
          className="well"
          style={{ marginTop: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <span className="dot" style={{ color: 'var(--grey-soft)' }} />
          <span className="body" style={{ fontSize: 13 }}>
            {lastWinnerLine}
          </span>
        </div>
        {/* Body keeps only the floor-relevant quick actions; account-level
            actions (organizers, branding, log out) live in the header menu. */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {quickLinks}
        </div>
      </div>
    </Screen>
  );
}
