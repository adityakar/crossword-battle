// Landing.tsx — the public front door at `/`. A single-fold, mobile-first hero
// over an animated grid background (ShapeGrid) that mirrors the brand mark. Two
// audiences, two paths: participants join a round by session code (→ /j/<code>),
// organizers sign in (→ /login). White-labels through the active Brand
// (appName / eventLine / venueLabel / accent) via useEvent().
import { useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isValidJoinCode, normalizeJoinCode } from '@cwb/shared';
import { useEvent } from '../../lib/event';
import { useFullBleed } from '../../lib/useFullBleed';
import { Btn, Mark, ShapeGrid } from '../../components';

export function Landing() {
  useFullBleed(); // single-fold hero over a full-viewport grid — opt out of the frame
  const navigate = useNavigate();
  const event = useEvent();
  const codeRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [hint, setHint] = useState(false);

  const canJoin = isValidJoinCode(code);

  // The CTA stays vivid (it's the hero's coral spotlight); clicking it with a
  // malformed code focuses the field and shows a hint rather than sitting
  // disabled. Validity of a *well-formed* code (does the session exist?) is the
  // player surface's job, so a good-format code navigates straight through.
  const join = () => {
    if (!canJoin) {
      setHint(true);
      codeRef.current?.focus();
      return;
    }
    navigate(`/j/${code}`);
  };
  const onCodeChange = (raw: string) => {
    setCode(normalizeJoinCode(raw));
    if (hint) setHint(false);
  };
  const onCodeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') join();
  };

  // The event identity heads the front door (e.g. "ACME CO. · TEAM OFFSITE"),
  // falling back to a neutral descriptor when no brand line is set.
  const eyebrow = event.eventLine || 'LIVE CROSSWORD GAME';
  // White-label app names vary widely (BrandSchema allows up to 60 chars); step
  // the hero title down for long names so it never overflows or stacks ugly.
  const appName = event.appName;
  const titleSize =
    appName.length > 40 ? ' lp-title--xs' : appName.length > 22 ? ' lp-title--sm' : '';

  return (
    <section className="lp">
      <div className="lp-grid">
        <ShapeGrid
          direction="diagonal"
          speed={0.45}
          squareSize={46}
          shape="square"
          borderColor="rgba(31,27,25,0.2)"
          hoverFillColor={event.accent}
          hoverTrailAmount={5}
          fadeColor="#F5F2EA"
        />
      </div>

      <div className="lp-content">
        <div className="lp-inner">
          <div className="lp-mark pop">
            <Mark size={54} />
          </div>

          <div className="label rise d1 lp-eyebrow">{eyebrow}</div>

          <h1 className={`display rise d2 lp-title${titleSize}`}>
            {appName}
            <span className="coral">.</span>
          </h1>

          <p className="body rise d3 lp-tagline">
            One grid. One clock. The fastest correct solve wins the round.
          </p>

          <div className="lp-join rise d4">
            <div className="lp-join-field">
              <label className="label lp-join-label" htmlFor="lp-session-code">
                Session code
              </label>
              <div className="lp-join-row">
                <input
                  ref={codeRef}
                  id="lp-session-code"
                  className="field lp-code"
                  value={code}
                  onChange={(e) => onCodeChange(e.target.value)}
                  onKeyDown={onCodeKey}
                  placeholder="QXR-481"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={hint || undefined}
                />
                <Btn kind="coral" className="lp-cta" onClick={join}>
                  Join the game <span className="lp-arrow">→</span>
                </Btn>
              </div>
            </div>
            {hint ? (
              <p className="lp-helper lp-helper-hint" role="alert">
                That doesn’t look like a game code. They look like QXR-481.
              </p>
            ) : (
              <p className="lp-helper">
                Already see a QR on the screen? Point your phone camera at it.
              </p>
            )}
          </div>

          <div className="lp-org rise d5">
            <span className="lp-org-text">Running the room?</span>
            <Link to="/login" className="lp-org-link">
              Organizer sign in <span className="lp-arrow">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
