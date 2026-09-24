import type { Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import { makeFifo } from '../scene/shapes/fifo';
import { registerTool } from './registry';
import type { PointerInfo, Tool, ToolContext } from './tool';

const HINT = 'Drag to draw a queue. Esc cancels.';

/**
 * Click and drag, exactly as `RectTool` does. The drag's longer axis picks the orientation, so
 * a wide drag makes a left-to-right queue and a tall one makes a top-to-bottom queue -- the
 * cell count and spacing are then the property panel's business.
 */
export class FifoTool implements Tool {
  readonly id = 'fifo';
  readonly label = 'Queue (FIFO)';
  readonly defaultCursor = 'crosshair';

  #anchor: Vec2 | null = null;

  isGesturing(): boolean {
    return this.#anchor !== null;
  }

  onActivate(c: ToolContext): void {
    c.setHint(HINT);
  }

  onDeactivate(c: ToolContext): void {
    this.#cancel(c);
  }

  onPointerDown(p: PointerInfo, c: ToolContext): void {
    if (p.button !== 0) return;
    this.#anchor = p.snapped;
    c.scene.setDraft(makeFifo(p.snapped, p.snapped, 'preview'));
    c.setHint('Release to place the opposite corner. Esc cancels.');
    c.requestFrame();
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    c.scene.setDraft(makeFifo(this.#anchor, p.snapped, 'preview'));
    c.requestFrame();
  }

  onPointerUp(_p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    this.#anchor = null;

    const draft = c.scene.draft;
    c.scene.setDraft(null);
    c.setHint(HINT);

    if (draft === null) return;
    // A stray click that never moved leaves a queue thinner than a cell across, which
    // `normalize` refuses -- so it creates nothing rather than a speck.
    const shape = opsFor(draft).normalize(draft);
    if (shape === null) {
      c.requestFrame();
      return;
    }

    const named = { ...shape, name: c.scene.nextName('fifo') };
    c.scene.commit('draw queue', () => {
      c.scene.shapes = [...c.scene.shapes, named];
      c.scene.setSelection(new Set([named.name]));
    });
    c.requestFrame();
  }

  onPointerCancel(c: ToolContext): void {
    this.#cancel(c);
  }

  onKeyDown(e: KeyboardEvent, c: ToolContext): boolean {
    if (e.key !== 'Escape') return false;
    if (this.#anchor !== null) {
      this.#cancel(c);
      return true;
    }
    c.setTool('pointer');
    return true;
  }

  #cancel(c: ToolContext): void {
    if (this.#anchor === null && c.scene.draft === null) return;
    this.#anchor = null;
    c.scene.setDraft(null);
    c.setHint(HINT);
    c.requestFrame();
  }
}

/*
  `order: 2`, after `connect`, and not because queues belong at the end of the bar.

  Digit shortcuts are assigned by toolbar POSITION (`registry.ts`), so inserting anything ahead
  of `connect` renumbers it -- and the checks press a literal `Digit4` for it. Appending leaves
  every existing shortcut where the user learned it.
*/
registerTool({
  id: 'fifo',
  label: 'Queue (FIFO)',
  group: 'shape',
  order: 2,
  icon: 'M3 7h18v10H3zm4.5 0v10M12 7v10m4.5-10v10',
  make: () => new FifoTool(),
});
