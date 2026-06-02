// BrandingPage.tsx — organizer-gated event-identity editor (route /host/branding).
// Loads the active brand from GET /api/config, edits the 7 white-label fields, and
// saves via PUT /api/config. On save it re-applies to the live EventProvider so the
// change is visible immediately.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Brand } from '@cwb/shared';
import { Btn, Screen } from '../../components';
import * as api from '../../lib/api';
import { useSetEvent } from '../../lib/event';
import { useHostShell } from '../../lib/useHostShell';
import { OrgHeader } from './OrgHeader';

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  fontFamily: 'var(--sans)',
  fontSize: 15,
  color: 'var(--ink)',
};

type Field = { key: keyof Brand; label: string; placeholder: string };
const FIELDS: Field[] = [
  { key: 'appName', label: 'APP / EVENT NAME', placeholder: 'Crossword Battle' },
  { key: 'eventLine', label: 'SUB-LOCKUP LINE', placeholder: 'ACME CO. · TEAM OFFSITE' },
  { key: 'venueLabel', label: 'VENUE LABEL', placeholder: 'Booth 14 / Room B / Table 3' },
  { key: 'prizeLabel', label: 'PRIZE LABEL', placeholder: 'Prize' },
  { key: 'aiTone', label: 'AI TONE', placeholder: 'dry, confident, lightly witty' },
  { key: 'topicHint', label: 'TOPIC HINT', placeholder: 'Suggested crossword topics' },
];

export function BrandingPage() {
  const navigate = useNavigate();
  useHostShell('read'); // desktop: a bounded reading column, not a phone strip
  const setEvent = useSetEvent();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(() => {
        if (alive) setAuthed(true);
      })
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

  useEffect(() => {
    if (!authed) return;
    api
      .getBrandConfig()
      .then(({ event }) => setBrand(event))
      .catch((e) => setErr(e instanceof api.ApiError ? e.message : 'failed to load brand'));
  }, [authed]);

  function set<K extends keyof Brand>(key: K, value: Brand[K]) {
    setBrand((b) => (b ? { ...b, [key]: value } : b));
  }

  async function onSave() {
    if (!brand) return;
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const { event } = await api.updateBrand(brand);
      setBrand(event);
      setEvent(event); // re-skin the live app immediately
      setOk('Branding saved.');
    } catch (e) {
      setErr(e instanceof api.ApiError ? e.message : 'failed to save branding');
    } finally {
      setBusy(false);
    }
  }

  if (authed === null) return <main className="pad" style={{ paddingTop: 40 }}>Checking session…</main>;
  if (authed === false) return <main className="pad" style={{ paddingTop: 40 }}>Redirecting…</main>;

  return (
    <Screen
      footer={
        <Btn kind="coral" disabled={!brand || busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save branding →'}
        </Btn>
      }
    >
      <OrgHeader
        right={
          <Btn kind="ghost" sm onClick={() => navigate('/host')} style={{ width: 'auto' }}>
            ← Back
          </Btn>
        }
      />
      <div className="pad" style={{ paddingTop: 18 }}>
        <div className="label">EVENT BRANDING</div>
        <div className="h1" style={{ fontSize: 28, marginTop: 6 }}>
          Make it yours<span className="coral">.</span>
        </div>
        <p className="body" style={{ fontSize: 13, marginTop: 8 }}>
          Re-skin the app for this event. Players and the booth display update on their next load.
        </p>
      </div>

      {brand && (
        <div className="pad" style={{ marginTop: 8 }}>
          <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
            {FIELDS.map((f) => (
              <label key={f.key} style={{ display: 'block' }}>
                <div className="label" style={{ marginBottom: 6 }}>{f.label}</div>
                <input
                  style={inputStyle}
                  value={brand[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </label>
            ))}
            <label style={{ display: 'block' }}>
              <div className="label" style={{ marginBottom: 6 }}>ACCENT COLOR</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="color"
                  value={brand.accent}
                  onChange={(e) => set('accent', e.target.value)}
                  style={{ width: 48, height: 40, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)' }}
                />
                <input
                  style={{ ...inputStyle, fontFamily: 'var(--mono)' }}
                  value={brand.accent}
                  placeholder="#FE414D"
                  onChange={(e) => set('accent', e.target.value)}
                />
              </div>
            </label>
          </div>

          {err && <div className="body" style={{ color: 'var(--coral)', fontSize: 13, marginTop: 14 }}>{err}</div>}
          {ok && <div className="body" style={{ color: 'var(--ink)', fontSize: 13, marginTop: 14 }}>{ok}</div>}
        </div>
      )}
    </Screen>
  );
}
