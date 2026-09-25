/**
 * What `CanvasSurface` needs from a panel's input host and renderer. Structural, so the diagram's
 * `ToolHost` and the trace panel's `TimelineHost` both satisfy it without sharing a base class --
 * their gesture models have nothing else in common.
 */
export interface SurfaceHost {
  readonly cursor: string;
  attach(canvas: HTMLCanvasElement, stage: HTMLElement): void;
  detach(canvas: HTMLCanvasElement): void;
  /** Re-read the stage's client rect; pointer coordinates are taken against the cached one. */
  refreshRect(): void;
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
  onWheel(e: WheelEvent): void;
  onGestureStart(e: Event): void;
  onGestureChange(e: Event): void;
  onGestureEnd(e: Event): void;
  onKeyDown(e: KeyboardEvent): void;
  onKeyUp(e: KeyboardEvent): void;
  onWindowBlur(): void;
}

export interface SurfaceRenderer {
  requestFrame(): void;
  /** Cancels a pending frame and drops caches. Safe against a live renderer. */
  dispose(): void;
}

/**
 * Whether a key event belongs to a text field rather than to a canvas.
 *
 * Walks ancestors, not just the immediate target: the property editor focuses wrapper divs and
 * the caret often sits in a child of the contenteditable, so an exact-target test misses both.
 */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
  );
}
