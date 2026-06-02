// LbRow.tsx — leaderboard row. A finisher shows real points + finish time; a
// still-solving player shows a quiet status chip ("solving" live, "no solve"
// once the round is over). The filled-% bar was removed deliberately: filledPct
// doesn't verify correctness, so it misleads (a full-but-wrong grid reads 100%).
//   • `player` is a PublicPlayer (no `.score`/`.isYou`); score is computed via
//     `scoreFor(player, cfg)` and "you" comes from the `isYou` prop.
//   • `innerRef` exposes the row element for the live boards' FLIP reorder.
import { fmtTime, scoreFor, type PublicPlayer, type ScoreCfg } from '@cwb/shared';
import { Chip } from './Primitives';

export interface LbRowProps {
  rank: number;
  player: PublicPlayer;
  cfg: ScoreCfg;
  lead?: boolean;
  big?: boolean;
  /** Highlight this row as "you" (surface compares player.id to its playerId). */
  isYou?: boolean;
  /** Round is over: still-solving players read "no solve" instead of "solving". */
  roundOver?: boolean;
  /** Root-element ref, for the live boards' FLIP reorder animation. */
  innerRef?: (el: HTMLDivElement | null) => void;
}

export function LbRow({
  rank,
  player,
  cfg,
  lead = false,
  big = false,
  isYou = false,
  roundOver = false,
  innerRef,
}: LbRowProps) {
  const sc = scoreFor(player, cfg);
  return (
    <div
      ref={innerRef}
      className={'lb-row' + (lead ? ' lead' : '')}
      style={big ? { padding: '18px 4px' } : undefined}
    >
      <span className="lb-rank" style={big ? { fontSize: 20 } : undefined}>
        {rank}
      </span>
      <div style={{ minWidth: 0 }}>
        <span className="lb-name" style={big ? { fontSize: 22 } : undefined}>
          {player.name}
          {isYou && (
            <span
              className="label-coral"
              style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 10 }}
            >
              YOU
            </span>
          )}
        </span>
      </div>
      <div style={{ textAlign: 'right' }}>
        {sc ? (
          <>
            <div className={'h3 tnum' + (lead ? ' coral' : '')} style={{ fontSize: big ? 22 : 16 }}>
              {sc.points}
            </div>
            <div className="lb-time">
              {fmtTime(sc.raw)}
              {sc.pen > 0 && <span className="grey"> +{sc.pen}s</span>}
            </div>
          </>
        ) : (
          <Chip kind="line">{roundOver ? 'no solve' : 'solving'}</Chip>
        )}
      </div>
    </div>
  );
}
