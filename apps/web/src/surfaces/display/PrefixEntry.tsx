// PrefixEntry.tsx — the booth's front door. A TV at a booth opens /tv and is
// asked for its organizer (booth) PREFIX; on submit it routes to /tv/<PREFIX>,
// the prefix-scoped standby that only tracks that booth's sessions. Editorial
// Stage styling: cream stage, Space Grotesk display, one coral accent, a mono
// code input. Reused for the "unknown booth" case (an invalid /tv/:slug).
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isValidPrefix, normalizePrefix } from '@cwb/shared';
import { Mark, Btn } from '../../components';
import { useEvent } from '../../lib/event';
import { useFullBleed } from '../../lib/useFullBleed';

export function PrefixEntry({ invalid }: { invalid?: string } = {}) {
  useFullBleed(); // booth front door fills the screen (no phone-column frame)
  const navigate = useNavigate();
  const event = useEvent();
  const [value, setValue] = useState('');
  const [hint, setHint] = useState<string | null>(
    invalid ? `“${invalid}” isn’t a booth prefix. Enter your 3-letter prefix.` : null,
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = normalizePrefix(value);
    if (!isValidPrefix(p)) {
      setHint('Booth prefix is 3 letters (A–Z, no I or O).');
      return;
    }
    navigate(`/tv/${p}`);
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--cream)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <div className="rise" style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <Mark size={40} />
        </div>
        <div className="label rise d1">{event.appName.toUpperCase()} · BOOTH DISPLAY</div>
        <h1 className="display rise d1" style={{ fontSize: 40, marginTop: 12, lineHeight: 1.02 }}>
          Which booth<span className="coral">?</span>
        </h1>
        <p className="body rise d2" style={{ fontSize: 15, marginTop: 12 }}>
          Enter this booth’s prefix to track its games on the big screen.
        </p>

        <form onSubmit={submit} className="rise d3" style={{ marginTop: 26 }}>
          <input
            aria-label="Booth prefix"
            value={value}
            onChange={(e) => {
              setValue(normalizePrefix(e.target.value).slice(0, 3));
              if (hint) setHint(null);
            }}
            placeholder="PUB"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={3}
            className="mono"
            style={{
              width: '100%',
              textAlign: 'center',
              fontSize: 40,
              letterSpacing: '0.28em',
              textIndent: '0.28em',
              padding: '16px 12px',
              borderRadius: 14,
              border: '1px solid var(--line)',
              background: 'var(--paper)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
          {hint && (
            <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--coral)' }}>
              {hint}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            {/* Inside a <form>, a bare <button> defaults to type=submit → onSubmit. */}
            <Btn kind="coral" disabled={!value}>
              Open booth display →
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
