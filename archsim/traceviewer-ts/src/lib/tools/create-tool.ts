import { ALIGN_SNAP_PX } from '../canvas/theme';
import type { Vec2 } from '../geom/types';
import { alignIndex, alignSnap, type AlignIndex, type Guide } from '../scene/align';
import { opsFor } from '../scene/registry';
import type { DrawContext, Shape, ShapeName } from '../scene/shape';
import { fabricOps } from '../scene/shapes/fabric';
import { fifoOps, makeFifo } from '../scene/shapes/fifo';
import { makePlainBox } from '../scene/shapes/plain-box';
import { rectOps } from '../scene/shapes/rect';
import { drawGuides } from './guides';
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

const NO_GUIDES: readonly Guide[] = [];
const NOTHING: ReadonlySet<ShapeName> = new Set();
const BOTH_AXES = { x: true, y: true } as const;
const NO_PINS = { x: null, y: null } as const;

/**
 * Click and drag: press places one corner, release places the opposite one, and a dashed ghost
 * tracks the snapped cursor in between.
 *
 * Both corners align with the new shape's siblings-to-be, the placed shapes of whatever it is
 * being drawn inside. The press aligns the anchor's edges; the drag then aligns the moving
 * corner's edges and the medians, with the anchor held.
 *
 * A press that never moved makes a shape `normalize` refuses -- a sub-cell box, a queue thinner
 * than a cell across -- so a stray click creates nothing rather than a speck.
 */
class CreateTool implements Tool {
  readonly defaultCursor = 'crosshair';

  #anchor: Vec2 | null = null;
  /** Built at press from the scene as it stands, which the gesture does not change. */
  #index: AlignIndex | null = null;
  #guides: readonly Guide[] = NO_GUIDES;

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
    const shapes = c.scene.shapes;
    const index = alignIndex(shapes, NOTHING);
    // A point has no extent, so only edges can align it, and there is nothing to show yet.
    const anchor = alignSnap({
      index,
      sourceIndex: shapes.length,
      q: p.world,
      tol: ALIGN_SNAP_PX * c.view.worldPerPx,
      axes: BOTH_AXES,
      pins: NO_PINS,
      geometryAt: (g) => ({ x: g.x, y: g.y, w: 0, h: 0 }),
    }).at;
    this.#index = index;
    this.#anchor = anchor;
    c.scene.setDraft(this.spec.make(anchor, anchor, 'preview'));
    c.setHint('Release to place the opposite corner. Esc cancels.');
    c.requestFrame();
  }

  onPointerMove(p: PointerInfo, c: ToolContext): void {
    const anchor = this.#anchor;
    const index = this.#index;
    if (anchor === null || index === null) return;
    const make = (g: Vec2): Shape => this.spec.make(anchor, g, 'preview');
    const r = alignSnap({
      index,
      // It will be appended, so it lies above everything.
      sourceIndex: c.scene.shapes.length,
      q: p.world,
      tol: ALIGN_SNAP_PX * c.view.worldPerPx,
      axes: BOTH_AXES,
      pins: anchor,
      geometryAt: (g) => {
        const s = make(g);
        return opsFor(s).bounds(s);
      },
    });
    const draft = make(r.at);
    // Guides only once the drag is a shape: the degenerate first moves are a line, or a point.
    this.#guides = opsFor(draft).normalize(draft) === null ? NO_GUIDES : r.guides;
    c.scene.setDraft(draft);
    c.requestFrame();
  }

  onPointerUp(_p: PointerInfo, c: ToolContext): void {
    this.#guides = NO_GUIDES;
    this.#index = null;
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

  drawOverlay(dc: DrawContext): void {
    drawGuides(dc, this.#guides);
  }

  #cancel(c: ToolContext): void {
    this.#guides = NO_GUIDES;
    this.#index = null;
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
  { id: 'rect', label: 'Rectangle', order: 0, icon: rectOps.icon },
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
  { id: 'fifo', label: 'Queue (FIFO)', order: 2, icon: fifoOps.icon },
  {
    make: makeFifo,
    prefix: 'fifo',
    hint: 'Drag to draw a queue. Esc cancels.',
    undoLabel: 'draw queue',
  },
);

/* Interfaces arrive from the property panel. */
registerCreateTool(
  { id: 'fabric', label: 'Fabric', order: 3, icon: fabricOps.icon },
  {
    make: (a, b, name) => makePlainBox('fabric', a, b, name),
    prefix: 'fabric',
    hint: 'Drag to draw a fabric, then set its interface count. Esc cancels.',
    undoLabel: 'draw fabric',
  },
);
