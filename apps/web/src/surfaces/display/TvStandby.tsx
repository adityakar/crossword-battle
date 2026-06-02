import { useEffect, useState } from 'react';
import * as api from '../../lib/api';
import { DisplayApp } from './DisplayApp';
import { Idle } from './Idle';

// Booth standby for ONE booth (organizer `prefix`): poll for that booth's active
// session and attach to it. When the session ends or its winner ages past the
// recycle window, displayActive(prefix) returns null and we fall back to standby;
// when a NEW session starts for this prefix, its code arrives and DisplayApp
// remounts (keyed by code) onto it.
export function TvStandby({ prefix }: { prefix: string }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setCode(null); // reset when the booth prefix changes
    const poll = () =>
      api.displayActive(prefix).then(({ joinCode }) => { if (alive) setCode(joinCode); }).catch(() => {});
    poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [prefix]);

  if (code) return <DisplayApp code={code} boothPrefix={prefix} key={code} />;
  // Standby art — mirror DisplayApp's full-viewport wrapper so Idle lays out right.
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--cream)' }}>
      <Idle prefix={prefix} />
    </div>
  );
}
