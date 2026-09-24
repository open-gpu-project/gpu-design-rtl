import type { Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import { makeFabric } from '../scene/shapes/fabric';
import { registerTool } from './registry';
import type { PointerInfo, Tool, ToolContext } from './tool';

const HINT = 'Drag to draw a fabric, then set its interface count. Esc cancels.';

/** Click and drag, exactly as `RectTool` does. Interfaces arrive from the property panel. */
export class FabricTool implements Tool {
  readonly id = 'fabric';
  readonly label = 'Fabric';
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
    c.scene.setDraft(makeFabric(p.snapped, p.snapped, 'preview'));
    c.setHint('Release to place the opposite corner. Esc cancels.');
    c.requestFrame();
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    c.scene.setDraft(makeFabric(this.#anchor, p.snapped, 'preview'));
    c.requestFrame();
  }

  onPointerUp(_p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    this.#anchor = null;

    const draft = c.scene.draft;
    c.scene.setDraft(null);
    c.setHint(HINT);

    if (draft === null) return;
    const shape = opsFor(draft).normalize(draft);
    if (shape === null) {
      c.requestFrame();
      return;
    }

    const named = { ...shape, name: c.scene.nextName('fabric') };
    c.scene.commit('draw fabric', () => {
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

// `order: 3`, after `fifo`. Appending is what keeps every existing digit shortcut put -- see
// `fifo-tool.ts` for the full reason. There is no tool for a network interface on purpose:
// interfaces come from their parent's count, not from the toolbar.
registerTool({
  id: 'fabric',
  label: 'Fabric',
  group: 'shape',
  order: 3,
  icon: 'M3 9h18v6H3zm4 -4v4m5-4v4m5-4v4M7 15v4m5-4v4m5-4v4',
  make: () => new FabricTool(),
});
