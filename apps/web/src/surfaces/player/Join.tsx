// Join.tsx — the entry screen. Faithful port of prototype/player.jsx PlayerJoin.
// Coral-tint pitch chip, "Beat the floor." hero, large name field, join code +
// player count, and a sticky "Join the Sprint →" footer (disabled until a name).
// The `locked` variant renders when late joins are closed / the round is over.
import { useState } from 'react';
import type { Snapshot } from '@cwb/shared';
import { Btn, Chip, Screen, Spark, Wordmark } from '../../components';

export interface JoinProps {
  snapshot: Snapshot;
  locked?: boolean;
  onJoin: (name: string) => void;
}

export function Join({ snapshot, locked = false, onJoin }: JoinProps) {
  const [name, setName] = useState('');
  const joined = snapshot.players.length;

  if (locked) {
    return (
      <Screen center>
        <div className="pad" style={{ paddingTop: 16 }}>
          <Wordmark />
        </div>
        <div className="pad" style={{ margin: 'auto 0', textAlign: 'center' }}>
          <div className="h1" style={{ fontSize: 30 }}>
            Round in progress
          </div>
          <p className="body" style={{ marginTop: 12 }}>
            This organizer locked late joins. Hang tight. The next round opens in a moment.
          </p>
        </div>
      </Screen>
    );
  }

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onJoin(trimmed);
  };

  return (
    <Screen
      center
      footer={
        <Btn kind="coral" disabled={!name.trim()} onClick={submit}>
          Join the Sprint →
        </Btn>
      }
    >
      <div className="pad" style={{ paddingTop: 16 }}>
        <Wordmark />
      </div>
      {/* Hero + name field center between the wordmark and the sticky CTA. */}
      <div style={{ margin: 'auto 0' }}>
        <div className="pad" style={{ paddingTop: 24 }}>
          <Chip kind="coral-soft" style={{ marginBottom: 18 }}>
            <Spark size={10} />A FAST AI CROSSWORD CHALLENGE
          </Chip>
          <div className="display" style={{ fontSize: 46 }}>
            Beat the
            <br />
            floor<span className="coral">.</span>
          </div>
          <p className="body" style={{ fontSize: 15, marginTop: 16, maxWidth: 290 }}>
            Tiny grid. Live clock. Fastest correct solve wins the round. AI hints if you're stuck,
            but they cost you.
          </p>
        </div>
        <div className="pad" style={{ marginTop: 30 }}>
          <div className="label" style={{ marginBottom: 9 }}>
            YOUR NAME
          </div>
          <input
            className="field"
            placeholder="Type your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={18}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) submit();
            }}
          />
          <div
            className="label"
            style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between' }}
          >
            <span>CODE · {snapshot.joinCode}</span>
            <span>{joined} ALREADY IN</span>
          </div>
        </div>
      </div>
    </Screen>
  );
}
