// LoginPage.tsx — organizer login. Mobile: a bold, branded splash (event lockup
// over the editorial canvas, form in the lower third). Desktop: a two-pane split
// — brand panel beside a bounded form column — so the form never stretches across
// a wide viewport. White-labels via the active Brand. Layout/motion live in the
// `.login-*` rules in styles/global.css.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import { useEvent, lockup } from '../../lib/event';
import { useFullBleed } from '../../lib/useFullBleed';
import { Btn, Mark } from '../../components';

export function LoginPage() {
  useFullBleed(); // own desktop two-pane layout — opt out of the phone-column frame
  const navigate = useNavigate();
  const event = useEvent();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step the wordmark down for long white-label names (BrandSchema allows 60
  // chars) so it never stacks to many lines — mirrors the landing hero.
  const appName = event.appName;
  const wordmarkSize =
    appName.length > 40 ? ' login-wordmark--xs' : appName.length > 22 ? ' login-wordmark--sm' : '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.login(email, password);
      navigate('/host');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      {/* brand panel — lower third on mobile, the left pane on desktop */}
      <div className="login-brand">
        <div className="login-brand-inner">
          <div className="pop">
            <Mark size={46} />
          </div>
          <div className="label rise d1 login-eyebrow">
            {lockup(event.venueLabel.toUpperCase(), 'ORGANIZER ACCESS')}
          </div>
          <h1 className={`display rise d2 login-wordmark${wordmarkSize}`}>
            {appName}
            <span className="coral">.</span>
          </h1>
          <p className="body rise d3 login-tagline">
            Sign in to run the floor: open a lobby, start the clock, crown a winner.
          </p>
        </div>
      </div>

      {/* form panel — bottom on mobile, the right pane on desktop */}
      <div className="login-form-wrap">
        <form onSubmit={onSubmit} className="login-form">
          <div className="login-field rise d4">
            <label className="label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="field"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="login-field rise d5">
            <label className="label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div className="rise d6">
            <Btn kind="coral" className="login-cta" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : <>Sign in <span className="login-arrow">→</span></>}
            </Btn>
          </div>

          {error && (
            <div className="login-error rise" role="alert">
              {error}
            </div>
          )}

          {event.eventLine && <div className="login-eventline">{event.eventLine}</div>}
        </form>
      </div>
    </div>
  );
}
