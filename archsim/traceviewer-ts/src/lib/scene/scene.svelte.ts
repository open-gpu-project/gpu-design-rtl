import type { Rect } from '../geom/types';
import { unionBounds } from './bounds';
import { History } from './history.svelte';
import { nextIndexedName } from './names';
import { opsFor, registryHasDependencies } from './registry';
import { resolveDependencies } from './resolve';
import type { Shape, ShapeName } from './shape';

const EMPTY_SELECTION: ReadonlySet<ShapeName> = new Set();

/**
 * The document.
 *
 * Everything is `$state.raw` and every shape is immutable. Deep `$state` would proxy each shape
 * and create a signal per property -- slow for a renderer that reads every field every frame,
 * and an identity trap, since a proxied shape and the raw one it wraps are not `===`.
 */
export class SceneStore {
  /** The z-order. Index 0 is the bottom of the stack; a layers panel will show this directly. */
  shapes = $state.raw<readonly Shape[]>([]);
  selection = $state.raw<ReadonlySet<ShapeName>>(EMPTY_SELECTION);
  /** An uncommitted preview (the rect being drawn). Never part of `shapes`. */
  draft = $state.raw<Shape | null>(null);

  readonly history = new History();

  /** Recomputed only when the array reference changes, which is once per commit. */
  contentBounds = $derived<Rect | null>(unionBounds(this.shapes));

  /**
   * Run synchronously at the end of every commit, after bounds are valid. The view uses it to
   * resize the world and re-clamp the camera; doing that from an `$effect` would let the browser
   * paint one frame with stale bounds.
   */
  onCommit: (() => void) | null = null;

  /**
   * Run after any change to `selection`, including the ones undo and redo restore.
   *
   * `EditorSession` uses it to clear the trace panel's selection whenever blocks become
   * selected. The alternative -- teaching every selection call site about the trace -- would
   * have missed undo/redo, which assign `selection` directly and never go through a tool.
   */
  onSelectionChanged: (() => void) | null = null;

  /** One high-water mark per prefix, so `block_` and `conn_` count independently. */
  #counters = new Map<string, number>();

  /**
   * Auto-name for the next shape of a kind. `block_N` by default; connections pass `'conn'`.
   *
   * Scans the live names rather than trusting the counter: undo, delete and import all make
   * `block_3` available again, and since the name *is* the identity, handing out a duplicate
   * would be two shapes sharing one identity rather than a cosmetic annoyance.
   */
  nextName(prefix = 'block'): ShapeName {
    const taken = new Set(this.shapes.map((s) => s.name));
    const name = nextIndexedName(prefix, taken, (this.#counters.get(prefix) ?? 0) + 1);
    this.#counters.set(prefix, Number(name.slice(prefix.length + 1)));
    return name;
  }

  setDraft(d: Shape | null): void {
    this.draft = d;
  }

  /**
   * The single write path for `selection`, so `onSelectionChanged` cannot be bypassed.
   * Assigning `selection` directly anywhere in this class is a bug.
   */
  #setSelection(ids: ReadonlySet<ShapeName>): void {
    if (ids === this.selection) return;
    this.selection = ids;
    this.onSelectionChanged?.();
  }

  setSelection(ids: ReadonlySet<ShapeName>): void {
    this.#setSelection(ids);
  }

  selectOnly(id: ShapeName): void {
    this.#setSelection(new Set([id]));
  }

  toggleSelected(id: ShapeName): void {
    const next = new Set(this.selection);
    if (!next.delete(id)) next.add(id);
    this.#setSelection(next);
  }

  clearSelection(): void {
    if (this.selection.size > 0) this.#setSelection(EMPTY_SELECTION);
  }

  selectedShapes(): readonly Shape[] {
    return this.shapes.filter((s) => this.selection.has(s.name));
  }

  /** The single selected shape, or null when nothing or more than one thing is selected. */
  soleSelected(): Shape | null {
    if (this.selection.size !== 1) return null;
    return this.shapes.find((s) => this.selection.has(s.name)) ?? null;
  }

  /**
   * Replace one shape with an edited version of itself, possibly under a new name. The only
   * path the property editor commits through.
   *
   * Rename is a structural change here, not a field assignment, because identity is the name:
   * the selection has to follow, and every other shape gets a chance to rewrite references via
   * `renameRef`. Doing that inside the single `commit` keeps it to one history entry.
   */
  replaceShape(prev: Shape, next: Shape, label: string): void {
    const index = this.shapes.indexOf(prev);
    if (index < 0) return;
    const renamedFrom = prev.name !== next.name ? prev.name : null;

    this.commit(label, () => {
      this.shapes = this.shapes.map((s, i) => {
        if (i === index) return next;
        if (renamedFrom === null) return s;
        return opsFor(s).renameRef?.(s, renamedFrom, next.name) ?? s;
      });
      if (renamedFrom !== null && this.selection.has(renamedFrom)) {
        const sel = new Set(this.selection);
        sel.delete(renamedFrom);
        sel.add(next.name);
        this.#setSelection(sel);
      }
    });
  }

  /** Mid-gesture preview. Deliberately does not touch bounds, history, or the camera. */
  previewShapes(next: readonly Shape[]): void {
    this.shapes = next;
  }

  /**
   * The only path that records history or moves the world. `mutate` should assign to `shapes`
   * and/or `selection`; everything after is bookkeeping.
   */
  commit(label: string, mutate: () => void): void {
    const before = this.shapes;
    const beforeSel = this.selection;
    this.draft = null;

    mutate();
    this.#resolveDependencies();

    if (this.shapes !== before) {
      this.history.push({
        before,
        after: this.shapes,
        beforeSel,
        afterSel: this.selection,
        label,
      });
    }
    this.onCommit?.();
  }

  /** Apply a preview that was built during a drag, as a single history entry. */
  commitPreview(label: string, before: readonly Shape[]): void {
    const after = this.shapes;
    this.shapes = before;
    this.commit(label, () => {
      this.shapes = after;
    });
  }

  undo(): void {
    const entry = this.history.popUndo();
    if (entry === null) return;
    this.draft = null;
    this.shapes = entry.before;
    this.#setSelection(entry.beforeSel);
    this.onCommit?.();
  }

  redo(): void {
    const entry = this.history.popRedo();
    if (entry === null) return;
    this.draft = null;
    this.shapes = entry.after;
    this.#setSelection(entry.afterSel);
    this.onCommit?.();
  }

  /**
   * Cascade-delete shapes whose dependencies vanished, then let survivors re-route.
   *
   * The work lives in `resolve.ts` so the select tool can run the reroute half against a
   * mid-drag preview, where there is no commit to hang it off.
   */
  #resolveDependencies(): void {
    if (!registryHasDependencies()) return;

    // The identity guard is load-bearing, not an optimisation: `commit` decides whether to push
    // an undo entry by comparing `shapes` against its pre-mutate value, so assigning an
    // equal-but-new array here would make every commit -- including ones that changed nothing --
    // an undoable step.
    const next = resolveDependencies(this.shapes);
    if (next !== this.shapes) this.shapes = next;

    if (this.selection.size > 0) {
      const live = new Set(this.shapes.map((s) => s.name));
      if ([...this.selection].some((id) => !live.has(id))) {
        this.#setSelection(new Set([...this.selection].filter((id) => live.has(id))));
      }
    }
  }
}
