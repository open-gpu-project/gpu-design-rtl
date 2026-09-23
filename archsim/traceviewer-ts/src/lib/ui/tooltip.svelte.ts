import type { Attachment } from 'svelte/attachments';
import { HOVER_DELAY_MS } from '../canvas/theme';

/**
 * Hover tooltips for DOM chrome: toolbar buttons, status-bar readings, trace controls.
 *
 * These used to be native `title` attributes and are not any more. Three things were measured
 * against the running app before replacing them, and each on its own would have been enough:
 *
 *  - `title` is untestable here, permanently. A native tooltip is drawn by AppKit's
 *    `NSToolTipManager` off real window-server mouse events inside an `NSTrackingArea`, so
 *    `Input.dispatchMouseEvent` -- which is all `page.mouse.move` can send -- never raises one
 *    at all. No CDP domain reports tooltip text, and a page screenshot is a renderer surface
 *    that structurally cannot contain OS chrome. Keeping `title` meant exempting the toolbar
 *    from the house rule that every behaviour has an assertion, and that exemption is exactly
 *    what let "the toolbar shows a tooltip" ship without ever being true.
 *  - Every control this replaces is an icon button, so the innermost hovered node is a `<path>`
 *    inside an `<svg>`, two levels below the element that carried the attribute. Blink does
 *    resolve the ancestor's title into the accessibility tree from there -- verified -- but
 *    whether it paints is the browser's business and not something the app can assert.
 *  - A native tooltip is light OS chrome on a dark app, on the OS's dwell rather than the
 *    450ms this app already uses for the canvas tooltip.
 *
 * So the tooltip became ours, on the same dwell as `CanvasTooltip`, which is the point: one
 * hover delay for the whole app rather than one for the canvas and whatever the OS felt like
 * for the chrome around it.
 */

/** A fixed string, or a thunk when the text is derived from something that moves. */
export type TipText = string | (() => string);

/** A tooltip and the anchor it hangs off. `rect` is in viewport CSS pixels. */
export interface ChromeTip {
  /**
   * Called by the layer at render time, not resolved here.
   *
   * This is a defect fix, not a nicety. An attachment re-runs whenever its EXPRESSION's
   * dependencies change, and its teardown dismisses whatever it is showing -- so with
   * `tip(`Undo: ${label}`)` the reactive read happens in the markup, and committing anything
   * while the pointer rests on Undo tears the attachment down and takes the visible tooltip
   * with it. It never comes back, because `pointerenter` does not fire again for a pointer
   * that never left. Measured: hover Undo, press Cmd+Z, and the tooltip vanishes at exactly
   * the moment its text became worth reading.
   *
   * Passing a thunk moves the reactive read inside the layer's own render, so the attachment
   * never re-runs and the visible tooltip simply re-renders with the new text.
   */
  readonly read: () => string;
  readonly rect: DOMRect;
}

/**
 * The id the layer renders with, so an anchor can point `aria-describedby` at it.
 *
 * One layer means one id, which is what makes that safe: two tooltips could not both claim it.
 */
export const CHROME_TIP_ID = 'chrome-tooltip';

/**
 * `$state.raw` and rebuilt from scratch on every change, exactly like `ToolHost.hover`: the
 * layer re-renders when the tooltip appears, moves to another control, or goes away, and at no
 * other time. Written only when a dwell expires -- never per pointer move.
 */
let current = $state.raw<ChromeTip | null>(null);

/**
 * The node the visible tooltip belongs to, and the dwell in flight. Plain fields, not signals:
 * nothing renders from either, and putting them behind `$state` would invalidate the document
 * on every pointer crossing.
 *
 * One of each, module-wide, because only one control can be hovered at a time. That is also
 * what makes `pointerleave` safe to act on -- it can check that the tooltip being dismissed is
 * its own, rather than one a faster neighbour has already replaced.
 */
let owner: HTMLElement | null = null;
let pending: { node: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

/** Read by `ChromeTooltip`, the single layer that draws whatever is here. */
export const chromeTip = {
  get current(): ChromeTip | null {
    return current;
  },
};

function disarm(): void {
  if (pending === null) return;
  clearTimeout(pending.timer);
  pending = null;
}

/**
 * Drop whatever is showing, and any dwell in flight.
 *
 * The layer calls this for everything that can move an anchor out from under a tooltip: a
 * resize, a scroll, the dock being rearranged, the window losing focus. Dismissing rather than
 * re-measuring is deliberate -- `rect` is read once, when the dwell expires, and a tooltip that
 * chased its anchor would be a second layout dependency for the sake of a case that only
 * arises while the user is doing something else.
 */
export function dismissChromeTip(): void {
  disarm();
  if (owner !== null) owner.removeAttribute('aria-describedby');
  owner = null;
  current = null;
}

/**
 * Give an element a tooltip: `{@attach tip('Rectangle (2)')}`.
 *
 * An attachment rather than a wrapper component, because the wrapper would be a second box in
 * the middle of a flex row -- and because this has to serve a `<span>` in the status bar as
 * readily as a `<button>` in a toolbar. Passing `''` attaches nothing, so a caller with an
 * optional description does not need a conditional in its markup.
 *
 * A derived tooltip -- `Undo: paste (Cmd+Z)` -- must be passed as a THUNK, for the reason
 * given on `ChromeTip.read`. A plain string is fine for anything fixed.
 */
export function tip(text: TipText): Attachment<HTMLElement> {
  const read = typeof text === 'function' ? text : (): string => text;
  return (node) => {
    const show = (): void => {
      pending = null;
      owner = node;
      current = { read, rect: node.getBoundingClientRect() };
      /*
        A description, not a name. Every icon button already carries an `aria-label`; what the
        tooltip adds is the keyboard shortcut. Set only while the tooltip is up, which is the
        ARIA tooltip pattern -- the id has nothing to point at the rest of the time.
      */
      node.setAttribute('aria-describedby', CHROME_TIP_ID);
    };

    const dismiss = (): void => {
      if (pending !== null && pending.node === node) disarm();
      if (owner !== node) return;
      owner = null;
      current = null;
      node.removeAttribute('aria-describedby');
    };

    const arm = (): void => {
      // Evaluated here rather than at show time so an empty tooltip does not even start a
      // timer. A thunk is cheap and this runs once per hover, not per move.
      if (read() === '') return;
      disarm();
      pending = { node, timer: setTimeout(show, HOVER_DELAY_MS) };
    };

    /*
      Focus shows it at once, with no dwell. A dwell models an undecided pointer and means
      nothing for a deliberate Tab -- and without this branch the tooltip, and so the shortcut
      it is carrying, would be invisible to anyone not using a mouse.

      `:focus-visible` rather than focus: a click focuses the button too, and pairing "show on
      focus" with "dismiss on press" would otherwise make a clicked button flash its own
      tooltip straight back up underneath the pointer.
    */
    const onFocus = (): void => {
      if (read() === '' || !node.matches(':focus-visible')) return;
      disarm();
      show();
    };

    /*
      `pointerenter` / `pointerleave`, never the bubbling `pointerover` / `pointerout` pair.
      Every control here wraps an `<svg>`, and the bubbling pair reports a crossing every time
      the pointer passes between a button and its own icon -- which would re-arm the dwell
      mid-hover and mean the tooltip never appears for a pointer that never left.
    */
    node.addEventListener('pointerenter', arm);
    node.addEventListener('pointerleave', dismiss);
    /* A press means the control is being used, not asked about. */
    node.addEventListener('pointerdown', dismiss);
    node.addEventListener('focus', onFocus);
    node.addEventListener('blur', dismiss);

    return () => {
      node.removeEventListener('pointerenter', arm);
      node.removeEventListener('pointerleave', dismiss);
      node.removeEventListener('pointerdown', dismiss);
      node.removeEventListener('focus', onFocus);
      node.removeEventListener('blur', dismiss);
      dismiss();
    };
  };
}
