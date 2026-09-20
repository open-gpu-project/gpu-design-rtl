import type { Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import { makeRect } from '../scene/shapes/rect';
import { registerTool } from './registry';
import type { Tool, ToolContext, PointerInfo } from './tool';

/**
 * Click and drag: press places one corner, release places the opposite one, and a dashed ghost
 * tracks the snapped cursor in between.
 */
export class RectTool implements Tool {
  readonly id = 'rect';
  readonly label = 'Rectangle';
  readonly defaultCursor = 'crosshair';

  #anchor: Vec2 | null = null;

  isGesturing(): boolean {
    return this.#anchor !== null;
  }

  onActivate(c: ToolContext): void {
    c.setHint('Drag to draw a block. Esc cancels.');
  }

  onDeactivate(c: ToolContext): void {
    this.#cancel(c);
  }

  onPointerDown(p: PointerInfo, c: ToolContext): void {
    if (p.button !== 0) return;
    this.#anchor = p.snapped;
    c.scene.setDraft(makeRect(p.snapped, p.snapped, 'preview'));
    c.setHint('Release to place the opposite corner. Esc cancels.');
    c.requestFrame();
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    c.scene.setDraft(makeRect(this.#anchor, p.snapped, 'preview'));
    c.requestFrame();
  }

  onPointerUp(_p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    this.#anchor = null;

    const draft = c.scene.draft;
    c.scene.setDraft(null);
    c.setHint('Drag to draw a block. Esc cancels.');

    if (draft === null) return;
    // A sub-cell block would be invisible, unhittable and unresizable, so a stray click that
    // never moved creates nothing at all rather than a one-cell speck.
    const shape = opsFor(draft).normalize(draft);
    if (shape === null) {
      c.requestFrame();
      return;
    }

    const named = { ...shape, name: c.scene.nextName() };
    c.scene.commit('draw block', () => {
      c.scene.shapes = [...c.scene.shapes, named];
      c.scene.setSelection(new Set([named.id]));
    });
    c.requestFrame();
  }

  onPointerCancel(c: ToolContext): void {
    this.#cancel(c);
  }

  onKeyDown(e: KeyboardEvent, c: ToolContext): boolean {
    if (e.key === 'Escape') {
      if (this.#anchor !== null) {
        this.#cancel(c);
        return true;
      }
      c.setTool('select');
      return true;
    }
    return false;
  }

  #cancel(c: ToolContext): void {
    if (this.#anchor === null && c.scene.draft === null) return;
    this.#anchor = null;
    c.scene.setDraft(null);
    c.setHint('Drag to draw a block. Esc cancels.');
    c.requestFrame();
  }
}

registerTool({
  id: 'rect',
  label: 'Rectangle',
  shortcut: '2',
  icon: 'M4 5h16v14H4z',
  make: () => new RectTool(),
});
