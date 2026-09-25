import Columns3 from '@lucide/svelte/icons/columns-3';
import Network from '@lucide/svelte/icons/network';
import RectangleHorizontal from '@lucide/svelte/icons/rectangle-horizontal';
import type { Vec2 } from '../geom/types';
import { opsFor } from '../scene/registry';
import type { Shape, ShapeName } from '../scene/shape';
import { makeFifo } from '../scene/shapes/fifo';
import { makePlainBox } from '../scene/shapes/plain-box';
import { registerTool, type ToolDeclaration } from './registry';
import type { PointerInfo, Tool, ToolContext } from './tool';

/** What distinguishes one drag-to-create tool from another. */
interface CreateSpec {
  /** A shape spanning two corners. Named later: the draft is a preview. */
  readonly make: (a: Vec2, b: Vec2, name: ShapeName) => Shape;
  /** The prefix `nextName` counts from. */
  readonly prefix: string;
  readonly hint: string;
  /** The undo entry's label. */
  readonly undoLabel: string;
}

/**
 * Click and drag: press places one corner, release places the opposite one, and a dashed ghost
 * tracks the snapped cursor in between.
 *
 * A press that never moved makes a shape `normalize` refuses -- a sub-cell box, a queue thinner
 * than a cell across -- so a stray click creates nothing rather than a speck.
 */
class CreateTool implements Tool {
  readonly defaultCursor = 'crosshair';

  #anchor: Vec2 | null = null;

  constructor(private readonly spec: CreateSpec) {}

  isGesturing(): boolean {
    return this.#anchor !== null;
  }

  onActivate(c: ToolContext): void {
    c.setHint(this.spec.hint);
  }

  onDeactivate(c: ToolContext): void {
    this.#cancel(c);
  }

  onPointerDown(p: PointerInfo, c: ToolContext): void {
    if (p.button !== 0) return;
    this.#anchor = p.snapped;
    c.scene.setDraft(this.spec.make(p.snapped, p.snapped, 'preview'));
    c.setHint('Release to place the opposite corner. Esc cancels.');
    c.requestFrame();
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    c.scene.setDraft(this.spec.make(this.#anchor, p.snapped, 'preview'));
    c.requestFrame();
  }

  onPointerUp(_p: PointerInfo, c: ToolContext): void {
    if (this.#anchor === null) return;
    this.#anchor = null;

    const draft = c.scene.draft;
    c.scene.setDraft(null);
    c.setHint(this.spec.hint);

    if (draft === null) return;
    const shape = opsFor(draft).normalize(draft);
    if (shape === null) {
      c.requestFrame();
      return;
    }

    const named = { ...shape, name: c.scene.nextName(this.spec.prefix) };
    c.scene.commit(this.spec.undoLabel, () => {
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
    c.setHint(this.spec.hint);
    c.requestFrame();
  }
}

function registerCreateTool(
  declaration: Omit<ToolDeclaration, 'group' | 'make'>,
  spec: CreateSpec,
): void {
  registerTool({ ...declaration, group: 'shape', make: () => new CreateTool(spec) });
}

/*
  The orders are 0, 2 and 3, with `connect` at 1, and not because queues and fabrics belong at
  the end of the bar. Digit shortcuts are assigned by toolbar POSITION (`registry.ts`), so
  inserting anything ahead of an existing tool renumbers it; appending leaves every shortcut
  where the user learned it.

  There is no tool for a network interface on purpose: interfaces come from their parent's
  count, not from the toolbar.
*/
registerCreateTool(
  { id: 'rect', label: 'Rectangle', order: 0, icon: RectangleHorizontal },
  {
    make: (a, b, name) => makePlainBox('rect', a, b, name),
    prefix: 'block',
    hint: 'Drag to draw a block. Esc cancels.',
    undoLabel: 'draw block',
  },
);

/*
  The drag's longer axis picks the orientation, so a wide drag makes a left-to-right queue and a
  tall one a top-to-bottom queue -- the cell count and spacing are then the property panel's.
*/
registerCreateTool(
  { id: 'fifo', label: 'Queue (FIFO)', order: 2, icon: Columns3 },
  {
    make: makeFifo,
    prefix: 'fifo',
    hint: 'Drag to draw a queue. Esc cancels.',
    undoLabel: 'draw queue',
  },
);

/* Interfaces arrive from the property panel. */
registerCreateTool(
  { id: 'fabric', label: 'Fabric', order: 3, icon: Network },
  {
    make: (a, b, name) => makePlainBox('fabric', a, b, name),
    prefix: 'fabric',
    hint: 'Drag to draw a fabric, then set its interface count. Esc cancels.',
    undoLabel: 'draw fabric',
  },
);
