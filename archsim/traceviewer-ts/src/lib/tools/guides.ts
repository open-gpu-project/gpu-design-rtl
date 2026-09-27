import { alignStroke } from '../canvas/pixel';
import type { Guide } from '../scene/align';
import type { DrawContext } from '../scene/shape';

/**
 * Alignment guides, as one path of hairlines in device space.
 *
 * Device space for the same reason a box's outline is: a world-space line lands on fractional
 * pixels at most zooms. Only the coordinate across the line is aligned; its ends are where the
 * targets and the source end.
 */
export function drawGuides(dc: DrawContext, guides: readonly Guide[]): void {
  if (guides.length === 0) return;
  const restore = dc.toDeviceSpace();
  const { ctx, dpr } = dc;
  const lw = Math.max(1, Math.round(dpr));
  ctx.lineWidth = lw;
  ctx.strokeStyle = dc.theme.alignGuide;
  ctx.beginPath();
  for (const g of guides) {
    if (g.axis === 'x') {
      const a = dc.project({ x: g.at, y: g.from });
      const b = dc.project({ x: g.at, y: g.to });
      const x = alignStroke(a.x * dpr, lw);
      ctx.moveTo(x, a.y * dpr);
      ctx.lineTo(x, b.y * dpr);
    } else {
      const a = dc.project({ x: g.from, y: g.at });
      const b = dc.project({ x: g.to, y: g.at });
      const y = alignStroke(a.y * dpr, lw);
      ctx.moveTo(a.x * dpr, y);
      ctx.lineTo(b.x * dpr, y);
    }
  }
  ctx.stroke();
  restore();
}
