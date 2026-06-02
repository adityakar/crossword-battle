// Waiting.tsx — post-join lobby. Coral avatar, "You're in, {first}", join code, a
// pulsing "WAITING FOR ORGANIZER" chip, an auto-rotating HOW TO PLAY tips card (the
// useful use of the dead wait time — it replaced a purely decorative pulse-ring),
// and a session info card.
import { fmtTime, type PublicPlayer, type Snapshot } from '@cwb/shared';
import { Avatar, Chip, HowToPlay, Screen, Wordmark } from '../../components';

export interface WaitingProps {
  snapshot: Snapshot;
  me: PublicPlayer;
}

export function Waiting({ snapshot, me }: WaitingProps) {
  const { config } = snapshot;
  const joined = snapshot.players.length;
  const first = me.name.split(' ')[0];

  return (
    <Screen center>
      <div className="pad" style={{ paddingTop: 16 }}>
        <Wordmark />
      </div>
      {/* Body centers in the space below the wordmark (margin:auto, clip-safe). */}
      <div style={{ margin: 'auto 0' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '24px 22px 0',
          }}
        >
          <Avatar name={me.name} coral size={68} />
          <div className="h1" style={{ fontSize: 30, marginTop: 20 }}>
            You're in, {first}
          </div>
          <div className="label" style={{ marginTop: 10 }}>
            CODE · {snapshot.joinCode}
          </div>

          <Chip kind="coral-soft" pulse style={{ marginTop: 22 }}>
            WAITING FOR ORGANIZER
          </Chip>
        </div>
        <div className="pad" style={{ marginTop: 26 }}>
          <HowToPlay hintPenalty={config.hintPenalty} wrongPenalty={config.wrongPenalty} />
        </div>
        <div className="pad" style={{ marginTop: 12 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="kv">
              <span className="label">SESSION</span>
              <span className="h3" style={{ fontSize: 15 }}>
                {config.puzzleName}
              </span>
            </div>
            <hr className="hr" style={{ margin: '13px 0' }} />
            <div className="kv">
              <span className="label">PLAYERS IN LOBBY</span>
              <span className="h2 tnum" style={{ fontSize: 20 }}>
                {joined}
              </span>
            </div>
            <hr className="hr" style={{ margin: '13px 0' }} />
            <div className="kv">
              <span className="label">CLOCK</span>
              <span className="h3 tnum" style={{ fontSize: 15 }}>
                {fmtTime(config.durationSec)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}
