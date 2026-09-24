/**
 * The violations popup: which connection's problems are open, and where to put the panel.
 *
 * A module-level store, exactly like `ui/tooltip.svelte.ts`, and for the same two reasons. One
 * popup can be open at a time, so one store is the whole model; and the tool that opens it
 * would otherwise have to thread a callback through `ToolContext` for something no other tool
 * will ever want.
 *
 * **It cannot reuse either existing tooltip layer.** `CanvasTooltip` is `pointer-events: none`
 * and lives inside `.stage`, which is `contain: strict` and would clip it. `ChromeTooltip` is
 * also `pointer-events: none`. This one has to be clickable -- you dismiss it by clicking away
 * from it, and its text is worth selecting -- so it gets its own layer at the app root, with
 * `ChromeTooltip`'s placement rules copied rather than extended.
 */
export interface Violations {
  /** The shape whose problems these are, so a second click on the same badge closes it. */
  readonly shape: string;
  readonly title: string;
  readonly lines: readonly string[];
  /** Viewport coordinates of the badge, in CSS pixels. */
  readonly x: number;
  readonly y: number;
}

/**
 * `$state.raw` and replaced wholesale, like `ToolHost.hover`: the layer re-renders when the
 * popup opens, moves to another badge, or closes, and at no other time.
 */
let current = $state.raw<Violations | null>(null);

export const violations = {
  get current(): Violations | null {
    return current;
  },
};

/** Open, or close again when the same badge is clicked twice. */
export function toggleViolations(next: Violations): void {
  current = current !== null && current.shape === next.shape ? null : next;
}

export function closeViolations(): void {
  if (current !== null) current = null;
}
