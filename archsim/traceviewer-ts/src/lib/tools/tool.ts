import type { HitResult } from '../canvas/hit';
import type { ViewController } from '../canvas/view.svelte';
import type { Modifiers, Vec2 } from '../geom/types';
import type { SceneStore } from '../scene/scene.svelte';
import type { DrawContext } from '../scene/shape';

export type ToolId = 'select' | 'rect' | (string & {});

export interface PointerInfo {
  /** Raw world position under the cursor. */
  readonly world: Vec2;
  /** Grid-snapped world position. All committed geometry is built from this, not `world`. */
  readonly snapped: Vec2;
  /** CSS pixels relative to the stage's top-left corner. */
  readonly screen: Vec2;
  readonly button: number;
  readonly buttons: number;
  readonly mods: Modifiers;
  readonly event: PointerEvent;
}

export interface ToolContext {
  readonly scene: SceneStore;
  readonly view: ViewController;
  hitTest(p: PointerInfo): HitResult;
  setCursor(cursor: string): void;
  setHint(hint: string): void;
  setTool(id: ToolId): void;
  /** Hand the current gesture to the host's pan handler. */
  startPan(p: PointerInfo): void;
  /** Coalesced repaint request; safe to call many times per frame. */
  requestFrame(): void;
}

export interface Tool {
  readonly id: ToolId;
  readonly label: string;
  readonly defaultCursor: string;

  onActivate?(c: ToolContext): void;
  /** Must abort any in-flight gesture and leave the scene in a committed state. */
  onDeactivate?(c: ToolContext): void;

  onPointerDown?(p: PointerInfo, c: ToolContext): void;
  onPointerMove?(p: PointerInfo, c: ToolContext): void;
  onPointerUp?(p: PointerInfo, c: ToolContext): void;
  onPointerCancel?(c: ToolContext): void;

  /**
   * The pointer left the canvas. Not a gesture end: an in-flight drag holds pointer capture and
   * keeps receiving moves, so this fires only for hover.
   *
   * It exists because hover-only decoration -- the connect tool's perimeter dot -- is otherwise
   * stranded on screen at wherever the pointer last was, which reads as a stuck UI.
   */
  onPointerLeave?(c: ToolContext): void;

  /** Return true when the key was consumed, so the host skips its global bindings. */
  onKeyDown?(e: KeyboardEvent, c: ToolContext): boolean;

  /** Drawn after all shapes, before the draft ghost. `dc.ctx` is in world space. */
  drawOverlay?(dc: DrawContext, c: ToolContext): void;

  /** True while a gesture is mid-flight. Undo and redo are refused during one. */
  isGesturing(): boolean;
}
