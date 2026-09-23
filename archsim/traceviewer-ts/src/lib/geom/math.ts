import type { Rect, Vec2 } from './types';

export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

/** Rect spanning two corners, in any order. Always normalized. */
export function rectFromPoints(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Fold negative width/height into the origin so `w >= 0 && h >= 0`. */
export function normalizeRect(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function expandRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Shortest distance from `p` to the segment `a`-`b`. Degenerate segments fall back to a point. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.sqrt(dist2(p, a));
  const t = clampNum(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1);
  const dx = p.x - (a.x + t * vx);
  const dy = p.y - (a.y + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Does the segment `a`->`b` touch the axis-aligned rectangle `r`?
 *
 * Liang-Barsky slab clipping rather than four edge-vs-edge tests: it is branch-light, needs no
 * special case for a segment that lies entirely inside `r`, and degenerates correctly to a
 * point-in-rect test when `a` and `b` coincide.
 */
export function segmentIntersectsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - r.x, r.x + r.w - a.x, a.y - r.y, r.y + r.h - a.y];

  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i] ?? 0;
    const qi = q[i] ?? 0;
    // Parallel to this slab: no crossing to find, but being outside it rules the segment out.
    if (pi === 0) {
      if (qi < 0) return false;
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}
