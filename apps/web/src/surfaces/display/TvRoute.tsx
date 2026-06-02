// TvRoute.tsx — dispatch for /tv/:slug. The slug is either a full join code
// (LLL-NNN → direct attach, back-compat for explicit-code deep links) or a
// 3-letter booth prefix (→ that booth's prefix-scoped, auto-recycling standby).
// Anything else falls back to the prefix-entry screen.
import { useParams } from 'react-router-dom';
import { isValidJoinCode, isValidPrefix } from '@cwb/shared';
import { useFullBleed } from '../../lib/useFullBleed';
import { DisplayApp } from './DisplayApp';
import { TvStandby } from './TvStandby';
import { PrefixEntry } from './PrefixEntry';

export function TvRoute() {
  useFullBleed(); // booth display fills the screen (no phone-column frame)
  const { slug = '' } = useParams();
  const up = slug.toUpperCase();
  if (isValidJoinCode(up)) return <DisplayApp code={up} key={up} />;
  if (isValidPrefix(up)) return <TvStandby prefix={up} key={up} />;
  return <PrefixEntry invalid={slug} />;
}
