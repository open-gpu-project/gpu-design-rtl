import type { Vec2 } from '../geom/types';
import { DISCRETE_DELTA_PX, PINCH_K, WHEEL_K } from './theme';
import type { ViewController } from './view.svelte';

export type WheelKind = 'pinch' | 'trackpad-pan' | 'mouse-wheel';

/**
 * All four gesture sources arrive as `wheel` events, so they have to be told apart by shape.
 *
 * This is a heuristic and can misfire on high-resolution or free-spin mice, which emit small
 * smooth deltas that look like a trackpad. Cmd+wheel (always zoom) and Shift+wheel (always pan)
 * are the deterministic escape hatches.
 */
export function classifyWheel(e: WheelEvent): WheelKind {
  if (e.ctrlKey) return 'pinch'; // macOS synthesises ctrlKey for a pinch gesture
  if (e.deltaMode !== 0) return 'mouse-wheel'; // LINE/PAGE mode means discrete notches
  if (e.deltaX !== 0) return 'trackpad-pan'; // a horizontal component: almost certainly a pad

  // Chrome and Safari report wheelDeltaY in exact multiples of 120 for a real wheel notch.
  const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (typeof legacy === 'number' && legacy !== 0 && Math.abs(legacy) % 120 === 0) {
    return 'mouse-wheel';
  }
  if (!Number.isInteger(e.deltaY)) return 'trackpad-pan'; // fractional: momentum or a pad
  return Math.abs(e.deltaY) < DISCRETE_DELTA_PX ? 'trackpad-pan' : 'mouse-wheel';
}

/** Rough CSS pixels per line / per page, for browsers that report wheel deltas in those units. */
const PX_PER_LINE = 16;
const PX_PER_PAGE = 800;

/**
 * Wheel deltas are only in pixels when `deltaMode` is DOM_DELTA_PIXEL. Firefox reports a mouse
 * wheel in LINES (about 3 per notch), so using the raw number made a notch worth 0.45% of zoom
 * and the wheel looked dead. Everything downstream works in pixels.
 */
function normalizeDelta(e: WheelEvent): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? PX_PER_LINE : e.deltaMode === 2 ? PX_PER_PAGE : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

interface GestureLikeEvent extends Event {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Safari fires these instead of, or alongside, ctrl+wheel for a trackpad pinch. */
const SAFARI_GESTURE_SUPPRESS_MS = 400;

/**
 * Accumulates wheel input and applies it once per animation frame. A 120 Hz trackpad otherwise
 * drives 120 separate camera updates and repaints in a second.
 */
export class WheelController {
  #zoomExp = 0;
  #panX = 0;
  #panY = 0;
  #anchor: Vec2 = { x: 0, y: 0 };
  #raf = 0;

  #gestureScale = 1;
  #gestureAnchor: Vec2 = { x: 0, y: 0 };
  #suppressPinchUntil = 0;

  constructor(
    private readonly view: ViewController,
    private readonly onApplied: () => void,
  ) {}

  /** `screen` is the pointer position in CSS pixels relative to the stage. */
  handleWheel(e: WheelEvent, screen: Vec2): void {
    // Always: otherwise macOS rubber-bands the page and Chrome can trigger back-navigation on
    // horizontal deltas. Requires the listener to be registered with { passive: false }.
    e.preventDefault();

    const kind = classifyWheel(e);
    if (kind === 'pinch' && performance.now() < this.#suppressPinchUntil) return;

    const { dx, dy } = normalizeDelta(e);
    const forceZoom = e.metaKey;
    const forcePan = e.shiftKey && !e.metaKey && kind !== 'pinch';

    if (forcePan) {
      this.#panX += dx !== 0 ? dx : dy;
      this.#schedule();
      return;
    }

    if (kind === 'trackpad-pan' && !forceZoom) {
      this.#panX += dx;
      this.#panY += dy;
      this.#schedule();
      return;
    }

    // Pick the curve from the delta's shape rather than the classification, so ctrl+wheel on a
    // real mouse does not get the fine-grained pinch constant and jump several steps at once.
    const smooth = e.deltaMode === 0 && Math.abs(dy) < DISCRETE_DELTA_PX;
    this.#anchor = screen;
    this.#zoomExp += dy * (smooth ? PINCH_K : WHEEL_K);
    this.#schedule();
  }

  onGestureStart(e: Event, screen: Vec2): void {
    e.preventDefault();
    this.#gestureScale = 1;
    this.#gestureAnchor = screen;
    this.#suppressPinchUntil = performance.now() + SAFARI_GESTURE_SUPPRESS_MS;
  }

  onGestureChange(e: Event, screen: Vec2): void {
    e.preventDefault();
    const scale = (e as GestureLikeEvent).scale;
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.#suppressPinchUntil = performance.now() + SAFARI_GESTURE_SUPPRESS_MS;
    this.#gestureAnchor = screen;
    const factor = scale / this.#gestureScale;
    this.#gestureScale = scale;
    this.view.zoomAt(this.#gestureAnchor, factor);
    this.onApplied();
  }

  onGestureEnd(e: Event): void {
    e.preventDefault();
    this.#suppressPinchUntil = performance.now() + SAFARI_GESTURE_SUPPRESS_MS;
  }

  dispose(): void {
    if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  #schedule(): void {
    if (this.#raf !== 0) return;
    this.#raf = requestAnimationFrame(this.#apply);
  }

  #apply = (): void => {
    this.#raf = 0;
    if (this.#zoomExp !== 0) {
      this.view.zoomAt(this.#anchor, Math.exp(-this.#zoomExp));
      this.#zoomExp = 0;
    }
    if (this.#panX !== 0 || this.#panY !== 0) {
      // Scrolling down should move the camera down, which is the opposite of a drag.
      this.view.pan(-this.#panX, -this.#panY);
      this.#panX = 0;
      this.#panY = 0;
    }
    this.onApplied();
  };
}
