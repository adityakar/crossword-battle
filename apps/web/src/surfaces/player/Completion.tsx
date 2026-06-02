// Completion.tsx — "you solved it, waiting for the final board". Faithful port of
// prototype/player.jsx PlayerCompletion. Rendered when the snapshot shows
// me.finishMs != null while phase is still `live`. Score breakdown via scoreFor.
import { fmtTime, scoreFor, type PublicPlayer, type Snapshot } from '@cwb/shared';
import { Btn, KV, Screen, Wordmark } from '../../components';

export interface CompletionProps {
  snapshot: Snapshot;
  me: PublicPlayer;
}

export function Completion({ snapshot, me }: CompletionProps) {
  const { config } = snapshot;
  const sc = scoreFor(me, config);
  const first = me.name.split(' ')[0];

  return (
    <Screen
      center
      footer={
        <Btn kind="ghost" disabled>
          Waiting for final leaderboard…
        </Btn>
      }
    >
      <div className="pad" style={{ paddingTop: 16 }}>
        <Wordmark />
      </div>
      {/* Score block centers between the wordmark and the (waiting) footer. The
          footer button already carries the wait state, so the redundant
          "WAITING FOR FINAL LEADERBOARD" chip that used to sit here is gone.
          A coral bloom (solve-glow) sits behind the headline as the earned
          personal-win moment; content is z-indexed above it. */}
      <div style={{ margin: 'auto 0', position: 'relative' }}>
        <div className="solve-glow" aria-hidden="true" />
        <div className="pad" style={{ position: 'relative', zIndex: 1 }}>
          <div
            className="label rise"
            style={{ color: 'var(--coral)', display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            {/* A checkmark that draws itself in (stroke-dashoffset); replaces the
                static ✓ glyph. currentColor inherits the coral label color. */}
            <svg className="check-draw" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M4 12.5 L10 18 L20 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            SOLVED · PENCILS DOWN
          </div>
          <div className="display rise d1" style={{ fontSize: 46, marginTop: 12 }}>
            Nice solve,
            <br />
            {first}
            <span className="coral">.</span>
          </div>
        </div>
        {sc && (
          <div className="pad rise d2" style={{ marginTop: 24, position: 'relative', zIndex: 1 }}>
            <div className="card" style={{ padding: '6px 18px' }}>
              <KV k="COMPLETION TIME" v={fmtTime(sc.raw)} vClass="coral" />
              {/* A clean run (zero penalty) reads "None" in muted grey rather than
                  a hollow "+0s 0×" — the penalty rows only assert weight when earned. */}
              <KV
                k="HINT PENALTY"
                v={me.hintsUsed ? `+${me.hintsUsed * config.hintPenalty}s` : 'None'}
                sub={me.hintsUsed ? `${me.hintsUsed}×` : undefined}
                vClass={me.hintsUsed ? '' : 'grey'}
              />
              <KV
                k="WRONG-ANSWER PENALTY"
                v={me.wrongAttempts ? `+${me.wrongAttempts * config.wrongPenalty}s` : 'None'}
                sub={me.wrongAttempts ? `${me.wrongAttempts}×` : undefined}
                vClass={me.wrongAttempts ? '' : 'grey'}
              />
              <div className="kv" style={{ padding: '18px 0' }}>
                <span className="label label-ink">ADJUSTED SCORE</span>
                <span className="h1 tnum" style={{ fontSize: 30 }}>
                  {sc.points}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
