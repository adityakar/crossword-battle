// QR.tsx — REAL QR code (replaces the prototype's pseudo-QR). Encodes `value`
// (a URL) using the `qrcode` package's synchronous `create()`, which returns a
// BitMatrix (`modules.size`, `modules.data: Uint8Array`). We render the modules
// as SVG rects — ink on cream — keeping a similar visual footprint to the
// prototype (size prop, square scannable block).
import { useMemo } from 'react';
import QRCode from 'qrcode';

export interface QRProps {
  value: string;
  size?: number;
  /** Foreground (module) color. */
  fg?: string;
  /** Background color (the quiet zone / light modules). */
  bg?: string;
  /**
   * Light-margin modules baked into the SVG. The QR spec wants ~4 for reliable
   * scanning. Override lower (e.g. 2) only where the QR already sits inside a
   * same-colored light frame whose padding makes up the rest of the quiet zone —
   * e.g. the booth's cream tile — so the visible margin stays tight without
   * starving scanners of contrast.
   */
  quiet?: number;
}

export function QR({ value, size = 188, fg = 'var(--ink)', bg = 'var(--cream)', quiet = 4 }: QRProps) {
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      return { n: qr.modules.size, data: qr.modules.data };
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) return null;
  const { n, data } = matrix;
  // `create()` returns the bare symbol with no quiet zone. Scanners want ~4
  // modules of light margin, so render into an (n + 2*quiet)-module canvas and
  // offset the modules. The `size` prop remains the total rendered footprint.
  const total = n + quiet * 2;
  const cs = size / total;
  const rects = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (data[r * n + c]) {
        rects.push(
          <rect
            key={`${r},${c}`}
            x={(c + quiet) * cs}
            y={(r + quiet) * cs}
            width={cs}
            height={cs}
            fill={fg}
          />,
        );
      }
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block' }}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill={bg} />
      {rects}
    </svg>
  );
}
