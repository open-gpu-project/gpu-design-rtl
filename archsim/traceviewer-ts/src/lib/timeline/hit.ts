import type { SignalId, Tick } from '../trace/model';
import type { TraceStore } from '../trace/store.svelte';
import { cursorFlagBox, cursorMeasurer, flagAt, flagMeasurer, visibleFlags } from './layout';
import { CURSOR_HIT_PX, FLAG_H, FLAG_HIT_PX, GUTTER_EDGE_HIT_PX } from './theme';
import type { TimelineView } from './view.svelte';

/**
 * What is under the pointer.
 *
 * Same shape as `canvas/hit.ts` -- a discriminated union resolved in priority order, with every
 * tolerance written as a CSS-pixel constant -- but none of its body. A timeline needs no
 * reverse z-order scan: the row is arithmetic, and the flag within it is a binary search.
 */
export type TraceHit =
  | { readonly type: 'gutter-edge' }
  | { readonly type: 'cursor' }
  | { readonly type: 'timescale'; readonly tick: Tick }
  | { readonly type: 'flag'; readonly signal: SignalId; readonly tick: Tick }
  | { readonly type: 'row'; readonly signal: SignalId; readonly inGutter: boolean }
  | { readonly type: 'empty' };

/**
 * Priority: the gutter's resize edge, then the cursor handle, then the timescale, then the
 * rows.
 *
 * The cursor is only grabbable **in the timescale strip**, which is where its flag is drawn.
 * Making the whole full-height stem grabbable would put an invisible 12px-wide dead zone over
 * every row, swallowing clicks on any flag the cursor happens to be parked on -- and the cursor
 * parks on flags constantly, because selecting one moves it there.
 *
 * Within the strip the grab zone is the stem's tolerance **or** the flag body, which is the
 * part of the cursor that actually looks draggable. Both come from `cursorFlagBox`, so the box
 * that responds is the box that was painted.
 */
export function hitTest(view: TimelineView, store: TraceStore, x: number, y: number): TraceHit {
  if (Math.abs(x - view.gutterW) <= GUTTER_EDGE_HIT_PX) return { type: 'gutter-edge' };

  if (y < view.laneTop) {
    if (Math.abs(x - view.toX(store.cursorTick)) <= CURSOR_HIT_PX) return { type: 'cursor' };
    const box = cursorFlagBox(view, store.cursorTick, cursorMeasurer(view.ctx));
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      return { type: 'cursor' };
    }
    return { type: 'timescale', tick: Math.round(view.toTick(x)) };
  }

  const rowIndex = view.rowAt(y);
  if (rowIndex < 0) return { type: 'empty' };
  const signal = store.rows[rowIndex];
  if (signal === undefined) return { type: 'empty' };

  if (x < view.gutterW) return { type: 'row', signal, inGutter: true };

  const track = store.trackOf(signal);
  const sig = store.signalOf(signal);
  if (track !== undefined && sig !== undefined) {
    // Same measurer the renderer used, so the clickable box is the drawn box.
    const boxes = visibleFlags(view, track, sig, flagMeasurer(view.ctx));
    const hit = flagAt(boxes, x, y, view.rowY(rowIndex), FLAG_H, FLAG_HIT_PX);
    if (hit !== null) return { type: 'flag', signal, tick: hit.tick };
  }

  return { type: 'row', signal, inGutter: false };
}
