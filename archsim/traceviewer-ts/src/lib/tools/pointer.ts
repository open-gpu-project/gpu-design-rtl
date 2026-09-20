import type { ViewController } from '../canvas/view.svelte';
import type { Modifiers } from '../geom/types';
import { snapPoint } from '../grid';
import type { PointerInfo } from './tool';

export function modifiersOf(e: MouseEvent | KeyboardEvent): Modifiers {
  return { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey };
}

/**
 * `offsetX`/`offsetY` are relative to whichever element the event happened to hit, so the stage
 * rect is measured explicitly and the caller is responsible for keeping it fresh.
 */
export function buildPointerInfo(
  e: PointerEvent,
  stageRect: DOMRect,
  view: ViewController,
): PointerInfo {
  const screen = { x: e.clientX - stageRect.left, y: e.clientY - stageRect.top };
  const world = view.toWorld(screen);
  return {
    world,
    snapped: snapPoint(world),
    screen,
    button: e.button,
    buttons: e.buttons,
    mods: modifiersOf(e),
    event: e,
  };
}
