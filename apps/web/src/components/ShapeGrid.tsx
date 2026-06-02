// ShapeGrid.tsx — animated grid-of-cells canvas background.
//
// Vendored from React Bits (MIT — https://reactbits.dev, "ShapeGrid") and
// rethemed for Crossword Battle's light "Editorial Stage" hero. The grid mirrors
// the brand mark (a 3×3 crossword glyph): the game IS a grid, so this isn't
// decoration, it's the product's own visual DNA.
//
// Changes from upstream:
//   - `fadeColor` prop: the edge vignette fades into the page bg (cream) instead
//     of the upstream hard-coded dark `#120F17`, so the grid dissolves at the
//     viewport edges rather than darkening them.
//   - prefers-reduced-motion: renders ONE static frame, no rAF loop, no hover.
//   - pauses the rAF while the tab is hidden (visibilitychange).
//   - caps devicePixelRatio so retina phones stay crisp without 3× fill cost.
//   - hover (coral fill + trail) is a desktop bonus; mobile has no pointer, so
//     the ambient diagonal drift carries the effect on its own.
import { useEffect, useRef } from 'react';

export interface ShapeGridProps {
  direction?: 'diagonal' | 'up' | 'right' | 'down' | 'left';
  speed?: number;
  borderColor?: string;
  squareSize?: number;
  hoverFillColor?: string;
  shape?: 'square' | 'hexagon' | 'circle' | 'triangle';
  /** Number of trailing hovered cells (0 = no trail). Desktop only. */
  hoverTrailAmount?: number;
  /** Edge-vignette color the grid fades into (default: cream page bg). */
  fadeColor?: string;
  /** Cap devicePixelRatio for the backing store (default 2). */
  maxDpr?: number;
}

interface GridOffset {
  x: number;
  y: number;
}

export function ShapeGrid({
  direction = 'diagonal',
  speed = 0.5,
  borderColor = 'rgba(31,27,25,0.10)',
  squareSize = 44,
  // Canvas fillStyle can't resolve CSS custom properties; pass a concrete color
  // (the landing forwards the live brand accent `event.accent`).
  hoverFillColor = '#FE414D',
  shape = 'square',
  hoverTrailAmount = 0,
  fadeColor = '#F5F2EA',
  maxDpr = 2,
}: ShapeGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);
  const gridOffset = useRef<GridOffset>({ x: 0, y: 0 });
  const hoveredSquareRef = useRef<GridOffset | null>(null);
  const trailCells = useRef<GridOffset[]>([]);
  const cellOpacities = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isHex = shape === 'hexagon';
    const isTri = shape === 'triangle';
    const hexHoriz = squareSize * 1.5;
    const hexVert = squareSize * Math.sqrt(3);
    // CSS-pixel dimensions; the backing store is scaled by DPR, drawing is in CSS px.
    let cssW = 0;
    let cssH = 0;
    // Edge vignette, rebuilt only on resize (not per frame).
    let gradient: CanvasGradient | null = null;

    const drawHex = (cx: number, cy: number, size: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const vx = cx + size * Math.cos(angle);
        const vy = cy + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
    };

    const drawCircle = (cx: number, cy: number, size: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.closePath();
    };

    const drawTriangle = (cx: number, cy: number, size: number, flip: boolean) => {
      ctx.beginPath();
      if (flip) {
        ctx.moveTo(cx, cy + size / 2);
        ctx.lineTo(cx + size / 2, cy - size / 2);
        ctx.lineTo(cx - size / 2, cy - size / 2);
      } else {
        ctx.moveTo(cx, cy - size / 2);
        ctx.lineTo(cx + size / 2, cy + size / 2);
        ctx.lineTo(cx - size / 2, cy + size / 2);
      }
      ctx.closePath();
    };

    const drawGrid = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      // Skip the per-cell opacity lookup entirely when nothing is lit (the mobile
      // no-hover case) — avoids a string key allocation per cell per frame.
      const hasFills = cellOpacities.current.size > 0;

      if (isHex) {
        const colShift = Math.floor(gridOffset.current.x / hexHoriz);
        const offsetX = ((gridOffset.current.x % hexHoriz) + hexHoriz) % hexHoriz;
        const offsetY = ((gridOffset.current.y % hexVert) + hexVert) % hexVert;
        const cols = Math.ceil(cssW / hexHoriz) + 3;
        const rows = Math.ceil(cssH / hexVert) + 3;
        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const cx = col * hexHoriz + offsetX;
            const cy = row * hexVert + ((col + colShift) % 2 !== 0 ? hexVert / 2 : 0) + offsetY;
            const alpha = hasFills ? cellOpacities.current.get(`${col},${row}`) : undefined;
            if (alpha) {
              ctx.globalAlpha = alpha;
              drawHex(cx, cy, squareSize);
              ctx.fillStyle = hoverFillColor;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            drawHex(cx, cy, squareSize);
            ctx.strokeStyle = borderColor;
            ctx.stroke();
          }
        }
      } else if (isTri) {
        const halfW = squareSize / 2;
        const colShift = Math.floor(gridOffset.current.x / halfW);
        const rowShift = Math.floor(gridOffset.current.y / squareSize);
        const offsetX = ((gridOffset.current.x % halfW) + halfW) % halfW;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const cols = Math.ceil(cssW / halfW) + 4;
        const rows = Math.ceil(cssH / squareSize) + 4;
        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const cx = col * halfW + offsetX;
            const cy = row * squareSize + squareSize / 2 + offsetY;
            const flip = ((((col + colShift + row + rowShift) % 2) + 2) % 2) !== 0;
            const alpha = hasFills ? cellOpacities.current.get(`${col},${row}`) : undefined;
            if (alpha) {
              ctx.globalAlpha = alpha;
              drawTriangle(cx, cy, squareSize, flip);
              ctx.fillStyle = hoverFillColor;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            drawTriangle(cx, cy, squareSize, flip);
            ctx.strokeStyle = borderColor;
            ctx.stroke();
          }
        }
      } else if (shape === 'circle') {
        const offsetX = ((gridOffset.current.x % squareSize) + squareSize) % squareSize;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const cols = Math.ceil(cssW / squareSize) + 3;
        const rows = Math.ceil(cssH / squareSize) + 3;
        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const cx = col * squareSize + squareSize / 2 + offsetX;
            const cy = row * squareSize + squareSize / 2 + offsetY;
            const alpha = hasFills ? cellOpacities.current.get(`${col},${row}`) : undefined;
            if (alpha) {
              ctx.globalAlpha = alpha;
              drawCircle(cx, cy, squareSize);
              ctx.fillStyle = hoverFillColor;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            drawCircle(cx, cy, squareSize);
            ctx.strokeStyle = borderColor;
            ctx.stroke();
          }
        }
      } else {
        const offsetX = ((gridOffset.current.x % squareSize) + squareSize) % squareSize;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const cols = Math.ceil(cssW / squareSize) + 3;
        const rows = Math.ceil(cssH / squareSize) + 3;
        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const sx = col * squareSize + offsetX;
            const sy = row * squareSize + offsetY;
            const alpha = hasFills ? cellOpacities.current.get(`${col},${row}`) : undefined;
            if (alpha) {
              ctx.globalAlpha = alpha;
              ctx.fillStyle = hoverFillColor;
              ctx.fillRect(sx, sy, squareSize, squareSize);
              ctx.globalAlpha = 1;
            }
            ctx.strokeStyle = borderColor;
            ctx.strokeRect(sx, sy, squareSize, squareSize);
          }
        }
      }

      // Edge vignette: transparent at center, fading to the page bg at the rim so
      // the grid dissolves into the page instead of cropping hard at the viewport.
      if (gradient) {
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, cssW, cssH);
      }
    };

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      cssW = canvas.offsetWidth;
      cssH = canvas.offsetHeight;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gradient = ctx.createRadialGradient(
        cssW / 2,
        cssH / 2,
        0,
        cssW / 2,
        cssH / 2,
        Math.sqrt(cssW ** 2 + cssH ** 2) / 2,
      );
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, fadeColor);
    };

    const updateCellOpacities = () => {
      const targets = new Map<string, number>();
      if (hoveredSquareRef.current) {
        targets.set(`${hoveredSquareRef.current.x},${hoveredSquareRef.current.y}`, 1);
      }
      if (hoverTrailAmount > 0) {
        for (let i = 0; i < trailCells.current.length; i++) {
          const t = trailCells.current[i]!;
          const key = `${t.x},${t.y}`;
          if (!targets.has(key)) {
            targets.set(key, (trailCells.current.length - i) / (trailCells.current.length + 1));
          }
        }
      }
      for (const [key] of targets) {
        if (!cellOpacities.current.has(key)) cellOpacities.current.set(key, 0);
      }
      for (const [key, opacity] of cellOpacities.current) {
        const target = targets.get(key) || 0;
        const next = opacity + (target - opacity) * 0.15;
        if (next < 0.005) cellOpacities.current.delete(key);
        else cellOpacities.current.set(key, next);
      }
    };

    const updateAnimation = () => {
      const effectiveSpeed = Math.max(speed, 0.1);
      const wrapX = isHex ? hexHoriz * 2 : squareSize;
      const wrapY = isHex ? hexVert : isTri ? squareSize * 2 : squareSize;
      switch (direction) {
        case 'right':
          gridOffset.current.x = (gridOffset.current.x - effectiveSpeed + wrapX) % wrapX;
          break;
        case 'left':
          gridOffset.current.x = (gridOffset.current.x + effectiveSpeed + wrapX) % wrapX;
          break;
        case 'up':
          gridOffset.current.y = (gridOffset.current.y + effectiveSpeed + wrapY) % wrapY;
          break;
        case 'down':
          gridOffset.current.y = (gridOffset.current.y - effectiveSpeed + wrapY) % wrapY;
          break;
        case 'diagonal':
          gridOffset.current.x = (gridOffset.current.x - effectiveSpeed + wrapX) % wrapX;
          gridOffset.current.y = (gridOffset.current.y - effectiveSpeed + wrapY) % wrapY;
          break;
      }
      // Only run the fade pass when something is (or was) lit; otherwise skip the
      // per-frame Map allocation entirely on the no-hover (mobile) path.
      if (cellOpacities.current.size || hoveredSquareRef.current || trailCells.current.length) {
        updateCellOpacities();
      }
      drawGrid();
      requestRef.current = requestAnimationFrame(updateAnimation);
    };

    const cellFromPointer = (event: MouseEvent): GridOffset => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      if (isHex) {
        const colShift = Math.floor(gridOffset.current.x / hexHoriz);
        const offsetX = ((gridOffset.current.x % hexHoriz) + hexHoriz) % hexHoriz;
        const offsetY = ((gridOffset.current.y % hexVert) + hexVert) % hexVert;
        const col = Math.round((mouseX - offsetX) / hexHoriz);
        const rowOffset = (col + colShift) % 2 !== 0 ? hexVert / 2 : 0;
        return { x: col, y: Math.round((mouseY - offsetY - rowOffset) / hexVert) };
      }
      if (isTri) {
        const halfW = squareSize / 2;
        const offsetX = ((gridOffset.current.x % halfW) + halfW) % halfW;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        return {
          x: Math.round((mouseX - offsetX) / halfW),
          y: Math.floor((mouseY - offsetY) / squareSize),
        };
      }
      const offsetX = ((gridOffset.current.x % squareSize) + squareSize) % squareSize;
      const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
      const round = shape === 'circle' ? Math.round : Math.floor;
      return { x: round((mouseX - offsetX) / squareSize), y: round((mouseY - offsetY) / squareSize) };
    };

    const handleMouseMove = (event: MouseEvent) => {
      const cell = cellFromPointer(event);
      const cur = hoveredSquareRef.current;
      if (!cur || cur.x !== cell.x || cur.y !== cell.y) {
        if (cur && hoverTrailAmount > 0) {
          trailCells.current.unshift({ ...cur });
          if (trailCells.current.length > hoverTrailAmount) trailCells.current.length = hoverTrailAmount;
        }
        hoveredSquareRef.current = cell;
      }
    };

    const handleMouseLeave = () => {
      if (hoveredSquareRef.current && hoverTrailAmount > 0) {
        trailCells.current.unshift({ ...hoveredSquareRef.current });
        if (trailCells.current.length > hoverTrailAmount) trailCells.current.length = hoverTrailAmount;
      }
      hoveredSquareRef.current = null;
    };

    const onResize = () => {
      resizeCanvas();
      if (reduceMotion) drawGrid();
    };

    resizeCanvas();
    // Re-measure on any change to the canvas's RENDERED size, not just window
    // resize. The landing flips #root to full-bleed in a SEPARATE effect that runs
    // after this one, so the first measure can capture the constrained (frame)
    // width; the canvas then stretches that 440px backing store to the full-bleed
    // width — the "horizontally stretched until you nudge the window" bug. A
    // ResizeObserver fires once layout settles AND on every later resize, which a
    // window 'resize' listener alone misses (it never fires for the full-bleed
    // reflow). Covers font-load / container reflows for free.
    const ro = new ResizeObserver(() => onResize());
    ro.observe(canvas);

    if (reduceMotion) {
      // Static single frame — no animation loop, no hover interaction.
      drawGrid();
      return () => ro.disconnect();
    }

    const onVisibility = () => {
      if (document.hidden) {
        if (requestRef.current) {
          cancelAnimationFrame(requestRef.current);
          requestRef.current = null;
        }
      } else if (requestRef.current == null) {
        requestRef.current = requestAnimationFrame(updateAnimation);
      }
    };

    // Listen on window, not the canvas: the landing overlays its content above
    // the canvas, so canvas-level pointer events never fire. cellFromPointer uses
    // clientX/Y against the canvas rect, so the math stays correct through the
    // overlay; mobile has no pointer, so this is a desktop-only enhancement.
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('visibilitychange', onVisibility);
    requestRef.current = requestAnimationFrame(updateAnimation);

    return () => {
      ro.disconnect();
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    };
  }, [direction, speed, borderColor, hoverFillColor, squareSize, shape, hoverTrailAmount, fadeColor, maxDpr]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: '100%', height: '100%', display: 'block', border: 'none' }}
    />
  );
}
