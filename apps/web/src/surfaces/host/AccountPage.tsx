// AccountPage.tsx — organizer self-service account screen (route /host/account).
//
// Organizer-gated (api.me() guard, mirroring HostApp). Three sections, each with
// local error/success state: the organizer roster (list + remove), add-organizer,
// and change-your-password. After any roster mutation we re-fetch listOrganizers()
// so the UI reflects server truth rather than an optimistic local guess.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Btn, Screen } from '../../components';
import { isValidPrefix, normalizePrefix } from '@cwb/shared';
import * as api from '../../lib/api';
import { useHostShell } from '../../lib/useHostShell';
import { OrgHeader } from './OrgHeader';

// Shared input styling — borderless cream card with a var(--line) border, fitting
// the editorial screens (there is no Input primitive in the design system).
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

export function AccountPage() {
  const navigate = useNavigate();
  useHostShell('read'); // desktop: a bounded reading column, not a phone strip
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [selfPrefix, setSelfPrefix] = useState<string | null>(null);

  // Booth-prefix editor.
  const [prefixInput, setPrefixInput] = useState('');
  const [prefixErr, setPrefixErr] = useState<string | null>(null);
  const [prefixOk, setPrefixOk] = useState<string | null>(null);
  const [prefixBusy, setPrefixBusy] = useState(false);

  // Auth guard. We also capture selfId + booth prefix here (me() returns them) so
  // the roster can disable removing your own row and the prefix editor seeds.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => {
        if (!alive) return;
        setSelfId(r.organizer.id);
        setSelfPrefix(r.organizer.prefix ?? null);
        setPrefixInput(r.organizer.prefix ?? '');
        setAuthed(true);
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

  // Roster.
  const [organizers, setOrganizers] = useState<api.OrganizerListItem[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add-organizer form.
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [addOk, setAddOk] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  // Change-password form.
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  function loadOrganizers() {
    return api
      .listOrganizers()
      .then(({ organizers }) => setOrganizers(organizers))
      .catch((err) => setListErr(err instanceof api.ApiError ? err.message : 'failed to load organizers'));
  }

  useEffect(() => {
    if (!authed) return;
    loadOrganizers();
  }, [authed]);

  async function onRemove(org: api.OrganizerListItem) {
    setListErr(null);
    setBusyId(org.id);
    try {
      await api.deleteOrganizer(org.id);
      await loadOrganizers();
    } catch (err) {
      setListErr(err instanceof api.ApiError ? err.message : 'failed to remove organizer');
    } finally {
      setBusyId(null);
    }
  }

  async function onSavePrefix() {
    setPrefixErr(null);
    setPrefixOk(null);
    const p = normalizePrefix(prefixInput);
    if (!isValidPrefix(p)) {
      setPrefixErr('Prefix is 3 letters (A–Z, excluding I and O).');
      return;
    }
    setPrefixBusy(true);
    try {
      const res = await api.putPrefix(p);
      setSelfPrefix(res.prefix);
      setPrefixInput(res.prefix);
      setPrefixOk('Booth prefix updated.');
      await loadOrganizers(); // reflect the new prefix in the roster
    } catch (err) {
      setPrefixErr(err instanceof api.ApiError ? err.message : 'failed to update prefix');
    } finally {
      setPrefixBusy(false);
    }
  }

  async function onAdd() {
    setAddErr(null);
    setAddOk(null);
    const email = newEmail.trim();
    if (!email) {
      setAddErr('Enter an email.');
      return;
    }
    if (newPassword.length < 8) {
      setAddErr('Password must be at least 8 characters.');
      return;
    }
    setAddBusy(true);
    try {
      await api.createOrganizer(email, newPassword);
      setNewEmail('');
      setNewPassword('');
      setAddOk('Organizer added.');
      await loadOrganizers();
    } catch (err) {
      setAddErr(err instanceof api.ApiError ? err.message : 'failed to add organizer');
    } finally {
      setAddBusy(false);
    }
  }

  async function onChangePassword() {
    setPwErr(null);
    setPwOk(null);
    if (nextPassword.length < 8) {
      setPwErr('New password must be at least 8 characters.');
      return;
    }
    setPwBusy(true);
    try {
      await api.changePassword(currentPassword, nextPassword);
      setCurrentPassword('');
      setNextPassword('');
      setPwOk('Password updated.');
    } catch (err) {
      setPwErr(err instanceof api.ApiError ? err.message : 'failed to change password');
    } finally {
      setPwBusy(false);
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
        <div className="label">ACCOUNT</div>
        <div className="h1" style={{ fontSize: 32, marginTop: 8 }}>
          Manage organizers
        </div>
      </div>

      {/* your booth prefix */}
      <div className="pad" style={{ marginTop: 24 }}>
        <div className="label" style={{ marginBottom: 11 }}>
          YOUR BOOTH PREFIX
        </div>
        <p className="body" style={{ fontSize: 13, marginBottom: 12 }}>
          Your sessions get codes like{' '}
          <span className="mono" style={{ color: 'var(--ink)' }}>{(selfPrefix ?? 'PUB')}-001</span>. Point a booth
          screen at{' '}
          <span className="mono" style={{ color: 'var(--ink)' }}>/tv/{selfPrefix ?? 'PUB'}</span>{' '}
          to track only your games.
        </p>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <input
            className="mono"
            value={prefixInput}
            onChange={(e) => {
              setPrefixInput(normalizePrefix(e.target.value).slice(0, 3));
              if (prefixErr) setPrefixErr(null);
              if (prefixOk) setPrefixOk(null);
            }}
            placeholder="PUB"
            maxLength={3}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Booth prefix"
            style={{ ...inputStyle, letterSpacing: '0.22em', maxWidth: 170 }}
          />
          <Btn kind="coral" sm disabled={prefixBusy} onClick={onSavePrefix} style={{ width: 'auto' }}>
            {prefixBusy ? 'Saving…' : 'Save prefix'}
          </Btn>
        </div>
        {prefixErr && (
          <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--coral)' }}>
            {prefixErr}
          </div>
        )}
        {prefixOk && (
          <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--ink)' }}>
            {prefixOk}
          </div>
        )}
      </div>

      {/* organizers list */}
      <div className="pad" style={{ marginTop: 24 }}>
        <div className="label" style={{ marginBottom: 11 }}>
          ORGANIZERS
        </div>
        <div className="card" style={{ padding: '4px 18px' }}>
          {organizers.map((org, i) => {
            const isSelf = org.id === selfId;
            const cantRemove = isSelf || organizers.length <= 1;
            return (
              <div
                key={org.id}
                className="kv"
                style={{
                  padding: '16px 0',
                  borderBottom: i < organizers.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="h3" style={{ fontSize: 15 }}>
                    {org.email}
                    {isSelf && (
                      <span className="label" style={{ marginLeft: 8 }}>
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="label" style={{ marginTop: 4 }}>
                    {org.prefix && (
                      <>
                        BOOTH <span className="mono" style={{ color: 'var(--ink)' }}>{org.prefix}</span>
                        {' · '}
                      </>
                    )}
                    JOINED {new Date(org.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Btn
                  kind="ghost"
                  sm
                  disabled={cantRemove || busyId === org.id}
                  onClick={() => onRemove(org)}
                  style={{ width: 'auto' }}
                >
                  {busyId === org.id ? 'Removing…' : 'Remove'}
                </Btn>
              </div>
            );
          })}
          {organizers.length === 0 && (
            <div className="body" style={{ fontSize: 13, padding: '16px 0' }}>
              No organizers found.
            </div>
          )}
        </div>
        {listErr && (
          <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--coral)' }}>
            {listErr}
          </div>
        )}
      </div>

      {/* add organizer */}
      <div className="pad" style={{ marginTop: 26 }}>
        <div className="label" style={{ marginBottom: 11 }}>
          ADD ORGANIZER
        </div>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="email"
            autoComplete="off"
            style={inputStyle}
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="password (min 8 characters)"
            autoComplete="new-password"
            style={inputStyle}
          />
          <Btn kind="coral" sm disabled={addBusy} onClick={onAdd} style={{ width: 'auto' }}>
            {addBusy ? 'Adding…' : 'Add organizer'}
          </Btn>
        </div>
        {addErr && (
          <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--coral)' }}>
            {addErr}
          </div>
        )}
        {addOk && (
          <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--ink)' }}>
            {addOk}
          </div>
        )}
      </div>

      {/* change password */}
      <div className="pad" style={{ marginTop: 26 }}>
        <div className="label" style={{ marginBottom: 11 }}>
          CHANGE YOUR PASSWORD
        </div>
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="current password"
            autoComplete="current-password"
            style={inputStyle}
          />
          <input
            type="password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
            placeholder="new password (min 8 characters)"
            autoComplete="new-password"
            style={inputStyle}
          />
          <Btn kind="dark" sm disabled={pwBusy} onClick={onChangePassword} style={{ width: 'auto' }}>
            {pwBusy ? 'Updating…' : 'Change password'}
          </Btn>
        </div>
        {pwErr && (
          <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--coral)' }}>
            {pwErr}
          </div>
        )}
        {pwOk && (
          <div className="body" style={{ fontSize: 13, marginTop: 10, color: 'var(--ink)' }}>
            {pwOk}
          </div>
        )}
      </div>
    </Screen>
  );
}
