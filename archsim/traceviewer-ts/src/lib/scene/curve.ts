import type { Anchor, Vec2 } from '../geom/types';
import { GRID } from '../grid';
import { samePoint } from './route';

/**
 * The curved router, and the spline algebra everything else reads through.
 *
 * Pure: no canvas, no store, no tools -- the same standard `route.ts` is held to, and for the
 * same reason. A curve is the part of a connection least likely to be wrong in a way a
 * screenshot shows, so it is exposed on `window.__curve` and driven as a function.
 *
 * **`points` is the CONTROL POLYGON, not the drawn path**: the source anchor, the target anchor,
 * and the user's waypoints in between. Two points is a straight line, which is how "try to
 * connect the two interfaces directly" falls out of the general form instead of being a case --
 * and that is the ordinary shape of a link rather than the rare one.
 *
 * Every function returns its INPUT reference when nothing changed, because `SceneStore.commit`
 * decides whether to record an undo entry by comparing array identity.
 */

/** Centripetal. The one parameterisation that cannot cusp or self-intersect between knots. */
const ALPHA = 0.5;

/** Below this a chord is a duplicate point, and the knot spacing would divide by zero. */
const EPS = 1e-6;

/** Samples per span when flattening. Enough that the polyline is within a hair at any zoom. */
const FLATTEN_STEPS = 16;

/** One cubic Bézier span: the two knots it runs between, and the two control points. */
export interface CubicSpan {
  readonly p0: Vec2;
  readonly c1: Vec2;
  readonly c2: Vec2;
  readonly p1: Vec2;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function mul(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}
function len(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}
function unit(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/**
 * The control polygon padded with phantom endpoints, so the first and last spans have the four
 * knots the formula needs.
 *
 * **The phantom DUPLICATES its endpoint rather than reflecting it**, and that choice is load
 * bearing beyond the shape of the curve: with duplication the tangent at an end comes out
 * parallel to the last chord, which is exactly what `route.ts`'s `endDirection` assumes when it
 * orients the arrowhead. A reflected phantom would tilt every arrowhead off its own line by an
 * amount that depends on the waypoint before it -- a bug with no visible cause.
 */
function padded(points: readonly Vec2[]): readonly Vec2[] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return [first, ...points, last];
}

/**
 * The control polygon as cubic Bézier spans.
 *
 * Centripetal Catmull-Rom, converted with the standard knot-spaced form -- **except at the two
 * ends, which are handled explicitly rather than by letting the formula cope.**
 *
 * The phantoms duplicate their endpoint, so the outer knot spacing is exactly zero and the
 * conversion becomes 0/0 there: both numerator and denominator vanish, and floating point then
 * returns whatever the rounding happens to give. Measured: the end tangent of a three-point
 * curve came out nowhere near the last chord, which is precisely the property the arrowhead
 * depends on. Clamping the spacing to an epsilon does not fix it -- it only makes the garbage
 * finite.
 *
 * The explicit answer is the one the degenerate case is supposed to mean: put the control point
 * a third of the way along the chord, which makes the end tangent parallel to that chord. That
 * is the convention `route.ts`'s `endDirection` assumes when it orients the arrowhead, and the
 * reason it can be reused unchanged for a curve.
 */
export function curveSpans(points: readonly Vec2[]): readonly CubicSpan[] {
  if (points.length < 2) return [];
  const k = padded(points);
  const out: CubicSpan[] = [];

  for (let i = 1; i + 2 < k.length; i++) {
    const p0 = k[i - 1]!;
    const p1 = k[i]!;
    const p2 = k[i + 1]!;
    const p3 = k[i + 2]!;

    const r1 = Math.pow(len(sub(p1, p0)), ALPHA);
    const d2 = Math.max(Math.pow(len(sub(p2, p1)), ALPHA), EPS);
    const r3 = Math.pow(len(sub(p3, p2)), ALPHA);

    const third = mul(sub(p2, p1), 1 / 3);
    const c1 =
      r1 < EPS
        ? add(p1, third)
        : mul(
            add(
              add(mul(p2, r1 * r1), mul(p0, -(d2 * d2))),
              mul(p1, 2 * r1 * r1 + 3 * r1 * d2 + d2 * d2),
            ),
            1 / (3 * r1 * (r1 + d2)),
          );
    const c2 =
      r3 < EPS
        ? sub(p2, third)
        : mul(
            add(
              add(mul(p1, r3 * r3), mul(p3, -(d2 * d2))),
              mul(p2, 2 * r3 * r3 + 3 * r3 * d2 + d2 * d2),
            ),
            1 / (3 * r3 * (r3 + d2)),
          );
    out.push({ p0: p1, c1, c2, p1: p2 });
  }
  return out;
}

function cubicAt(s: CubicSpan, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y,
  };
}

function cubicTangent(s: CubicSpan, t: number): Vec2 {
  const u = 1 - t;
  return {
    x:
      3 * u * u * (s.c1.x - s.p0.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.p1.x - s.c2.x),
    y:
      3 * u * u * (s.c1.y - s.p0.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.p1.y - s.c2.y),
  };
}

/**
 * The curve as a polyline.
 *
 * **One sampling feeds `bounds`, `hitTest` and `intersects`**, which is the point. Centripetal
 * Catmull-Rom can bulge outside its control polygon, so a bounding box taken from the control
 * points under-reports: the renderer would cull the bulge and the hit test's bbox pre-filter
 * would reject clicks inside it.
 */
export function flattenCurve(points: readonly Vec2[], steps = FLATTEN_STEPS): readonly Vec2[] {
  if (points.length < 2) return points;
  const spans = curveSpans(points);
  if (spans.length === 0) return points;
  const out: Vec2[] = [spans[0]!.p0];
  for (const s of spans) {
    for (let i = 1; i <= steps; i++) out.push(cubicAt(s, i / steps));
  }
  return out;
}

/** Unit tangent arriving at the target, for the arrowhead. Null when there is no curve. */
export function curveEndDirection(points: readonly Vec2[]): Vec2 | null {
  const spans = curveSpans(points);
  if (spans.length === 0) return null;
  const d = unit(cubicTangent(spans[spans.length - 1]!, 1));
  return d.x === 0 && d.y === 0 ? null : d;
}

/** A point on the curve at `t` in `[0, 1]` of the whole run, for the label. */
export function curveAt(points: readonly Vec2[], t: number): Vec2 {
  const spans = curveSpans(points);
  if (spans.length === 0) return points[0] ?? { x: 0, y: 0 };
  const scaled = Math.min(Math.max(t, 0), 1) * spans.length;
  const i = Math.min(spans.length - 1, Math.floor(scaled));
  return cubicAt(spans[i]!, scaled - i);
}

/**
 * Drop waypoints that cannot be distinguished from their neighbour.
 *
 * **Coincident points only. A collinear one is kept, and that is the whole point.**
 *
 * The obvious version also removes any waypoint sitting on the chord between its neighbours, by
 * analogy with `route.ts`'s `collapseRoute`. It is wrong here twice over. A waypoint the user
 * deliberately lined up is still holding the curve straight there, so removing it changes the
 * shape. And worse, inserting a waypoint into a STRAIGHT curve puts it exactly on the chord by
 * construction -- so `normalize` deleted it in the same gesture that created it, and clicking
 * the insert badge did nothing at all except record an undo entry.
 *
 * A curve's waypoints are explicit: the user inserts them with the badge and removes them with
 * Delete. Nothing else gets to have an opinion.
 *
 * Deduping IS still required, and not for tidiness: the centripetal parameterisation divides by
 * the chord length between knots, so two points at the same place is a division by zero.
 */
export function collapseCurve(points: readonly Vec2[]): readonly Vec2[] {
  if (points.length < 3) return points;
  const out: Vec2[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    if (samePoint(out[out.length - 1]!, points[i]!)) continue;
    out.push(points[i]!);
  }
  const last = points[points.length - 1]!;
  // The final anchor is never dropped, even if a waypoint sits on it -- it is an endpoint, and
  // `normalize` refuses a route with fewer than two points.
  if (out.length > 1 && samePoint(out[out.length - 1]!, last)) out.pop();
  out.push(last);
  return out.length === points.length ? points : out;
}

export function insertWaypoint(points: readonly Vec2[], span: number, at: Vec2): readonly Vec2[] {
  const i = Math.min(Math.max(span + 1, 1), points.length - 1);
  return [...points.slice(0, i), at, ...points.slice(i)];
}

/** Remove one interior waypoint. The two ends are the anchors and are never removable. */
export function removeWaypoint(points: readonly Vec2[], index: number): readonly Vec2[] {
  if (index <= 0 || index >= points.length - 1) return points;
  return [...points.slice(0, index), ...points.slice(index + 1)];
}

export function moveWaypoint(points: readonly Vec2[], index: number, to: Vec2): readonly Vec2[] {
  if (index <= 0 || index >= points.length - 1) return points;
  if (samePoint(points[index]!, to)) return points;
  const out = points.slice();
  out[index] = to;
  return out;
}

/**
 * The `routing: 'auto'` shape of a curved link: nothing at all when a straight line leaves the
 * front of one port and arrives at the front of the other, and two waypoints on the two
 * outward normals when it would not.
 *
 * **Straight when it can be straight, and by construction rather than by a special case.** Two
 * control points IS a straight line, so the test is only whether one would look wrong: it does
 * when the line leaves an interface backwards through its own parent, or arrives at the far one
 * from behind. Both are dot products against the anchor normals, and both being positive is
 * exactly "in front of".
 *
 * The threshold is zero, not the cos(15 degrees) it once was, which makes straight the common
 * case: a link runs straight unless a straight line would leave or arrive backwards.
 * The narrow rule it replaces called anything meaningfully off-axis a bow, on the grounds that
 * a bus leaving its own port diagonally does not read as a bus -- true of the 15-degree band it
 * was drawn for, and false of the offset pairs that are most of a real diagram.
 *
 * The case that WANTS a bow survives the change without being named: when two anchors share a
 * normal -- two ports on one face, which is what a loopback is -- `arrives` is exactly
 * `-leaves`, so the two can never both be positive and the pair always bows. Two ports on one
 * face of the same parent give both terms zero, and bow. Two on the same face of DIFFERENT
 * parents, diagonally apart, also bow, which is right: a straight chord there would run down
 * through the far parent's body. And two ports facing away from each other bow on two negative
 * terms. None of that needs to know what a fabric is.
 *
 * Deliberately modest -- no obstacle avoidance, in the spirit of `ROUTE_MAX_SEGMENTS = 3`. The
 * user is expected to drag a waypoint when the automatic answer runs through something, and
 * doing so pins the route to `manual`, which is the same bargain the rectilinear router strikes.
 */
export function autoWaypoints(a: Anchor, b: Anchor): readonly Vec2[] {
  const delta = sub(b.pos, a.pos);
  const span = len(delta);
  if (span < EPS) return [];

  const dir = unit(delta);
  const leaves = dir.x * a.normal.x + dir.y * a.normal.y;
  const arrives = -(dir.x * b.normal.x + dir.y * b.normal.y);

  // In front of both, so a direct line is what the link is: two points, and no waypoints.
  if (leaves > 0 && arrives > 0) return [];

  /*
    Far enough out to clear the face it is leaving, and proportional to the separation so a long
    link bows gently rather than kinking at both ends -- but CAPPED, which half the separation
    was not. Two rows of ports 380 units apart each pushed their control point 190 out, and the
    pair ballooned into a lens the width of the gap. A third of the separation, and never more
    than half a dozen grid steps, keeps the bow readable as a bus leaving a port.
  */
  const reach = Math.min(GRID * 6, Math.max(GRID * 2, span / 3));
  return [add(a.pos, mul(a.normal, reach)), add(b.pos, mul(b.normal, reach))];
}
