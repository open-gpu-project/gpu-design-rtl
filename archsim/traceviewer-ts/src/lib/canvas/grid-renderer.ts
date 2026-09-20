import { clampNum } from '../geom/math';
import { GRID, MAJOR_EVERY } from '../grid';
import { MIN_DOT_PX, type Theme } from './theme';

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * One batched path per tier: `arc()` + `fill()` per dot is roughly ten times slower, and a
 * 1920x1080 viewport holds about ten thousand dots at GRID = 16.
 *
 * `skipEvery > 0` omits positions where both indices are multiples of it, which is how the
 * minor pass leaves holes for the major dots to sit in.
 */
function batchDots(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  step: number,
  skipEvery: number,
  z: number,
  dpr: number,
  devW: number,
  devH: number,
  size: number,
): void {
  const stepDev = step * z * dpr;
  if (!Number.isFinite(stepDev) || stepDev < 2) return;

  // floor, not (size-1)/2: an even size would otherwise put the rect on a half-pixel origin
  // and each dot would antialias into a blur instead of the crisp square this module exists for.
  const half = Math.floor(size / 2);
  // Indices rather than accumulated world coordinates: the major test must stay exact, and
  // repeatedly adding `step` drifts.
  const i0 = Math.ceil(camX / step);
  const j0 = Math.ceil(camY / step);
  const x0 = (i0 * step - camX) * z * dpr;
  const y0 = (j0 * step - camY) * z * dpr;

  ctx.beginPath();
  let j = j0;
  for (let y = y0; y < devH; y += stepDev, j++) {
    const majorRow = skipEvery > 0 && mod(j, skipEvery) === 0;
    const py = Math.round(y) - half;
    let i = i0;
    for (let x = x0; x < devW; x += stepDev, i++) {
      if (majorRow && mod(i, skipEvery) === 0) continue;
      ctx.rect(Math.round(x) - half, py, size, size);
    }
  }
  ctx.fill();
}

/**
 * Dot grid, drawn in device-pixel space. In world space a fractional camera puts every dot on a
 * fractional pixel and they render as four grey smudges instead of one crisp dot -- and trackpad
 * panning produces fractional camera positions constantly.
 *
 * Level of detail climbs in factors of MAJOR_EVERY so the hierarchy survives: minors fade out
 * and the old majors become the new minors. Snapping always uses the base GRID regardless.
 *
 * Leaves the context in device-pixel space; the caller is expected to set its own transform
 * afterwards.
 */
export function drawDotGrid(
  ctx: CanvasRenderingContext2D,
  camX: number,
  camY: number,
  cssW: number,
  cssH: number,
  z: number,
  dpr: number,
  theme: Theme,
): void {
  const level = Math.max(0, Math.ceil(Math.log(MIN_DOT_PX / (GRID * z)) / Math.log(MAJOR_EVERY)));
  const minorStep = GRID * MAJOR_EVERY ** level;
  const majorStep = minorStep * MAJOR_EVERY;

  const devW = cssW * dpr;
  const devH = cssH * dpr;

  // Drop to raw device pixels. The caller leaves the context scaled by dpr for the background
  // fill; without this reset every dot would be drawn at dpr times its intended size and
  // spacing, and the right and bottom edges would fall off the bitmap. The caller restores the
  // world transform immediately after this returns.
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Fade the minor tier out exactly as it reaches the density at which the next level takes
  // over. Anchoring this to MIN_DOT_PX is what makes the transition continuous: if the fade
  // bottomed out above zero, the tier would still be visible at the instant it was replaced.
  const minorAlpha = clampNum((minorStep * z - MIN_DOT_PX) / 6, 0, 1);
  if (minorAlpha > 0) {
    ctx.globalAlpha = minorAlpha;
    ctx.fillStyle = theme.gridDotMinor;
    batchDots(
      ctx,
      camX,
      camY,
      minorStep,
      MAJOR_EVERY,
      z,
      dpr,
      devW,
      devH,
      Math.max(1, Math.round(1.5 * dpr)),
    );
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = theme.gridDotMajor;
  batchDots(ctx, camX, camY, majorStep, 0, z, dpr, devW, devH, Math.max(2, Math.round(2.5 * dpr)));
}
