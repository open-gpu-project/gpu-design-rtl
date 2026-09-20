import type { Rect } from '../geom/types';
import { unionBounds } from './bounds';
import { History } from './history.svelte';
import { opsFor, registryHasDependencies } from './registry';
import type { Shape, ShapeId } from './shape';

const EMPTY_SELECTION: ReadonlySet<ShapeId> = new Set();

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
  selection = $state.raw<ReadonlySet<ShapeId>>(EMPTY_SELECTION);
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

  #counter = 0;

  /** Auto-name for the next block. Hardware entities want names, even placeholder ones. */
  nextName(): string {
    this.#counter += 1;
    return `block_${this.#counter}`;
  }

  setDraft(d: Shape | null): void {
    this.draft = d;
  }

  setSelection(ids: ReadonlySet<ShapeId>): void {
    this.selection = ids;
  }

  selectOnly(id: ShapeId): void {
    this.selection = new Set([id]);
  }

  toggleSelected(id: ShapeId): void {
    const next = new Set(this.selection);
    if (!next.delete(id)) next.add(id);
    this.selection = next;
  }

  clearSelection(): void {
    if (this.selection.size > 0) this.selection = EMPTY_SELECTION;
  }

  selectedShapes(): readonly Shape[] {
    return this.shapes.filter((s) => this.selection.has(s.id));
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
    this.selection = entry.beforeSel;
    this.onCommit?.();
  }

  redo(): void {
    const entry = this.history.popRedo();
    if (entry === null) return;
    this.draft = null;
    this.shapes = entry.after;
    this.selection = entry.afterSel;
    this.onCommit?.();
  }

  /**
   * Cascade-delete shapes whose dependencies vanished, then let survivors re-route. No shape
   * kind implements these yet, so this is a no-op until connections land -- but building the
   * hook now is what keeps that change additive instead of touching every mutation path.
   */
  #resolveDependencies(): void {
    if (!registryHasDependencies()) return;

    let current = this.shapes;
    for (;;) {
      const byId = new Map(current.map((s) => [s.id, s]));
      const kept = current.filter((s) => {
        const deps = opsFor(s).dependsOn?.(s);
        return deps === undefined || deps.every((id) => byId.has(id));
      });
      if (kept.length === current.length) {
        current = kept;
        break;
      }
      current = kept; // A dropped shape may orphan another, so settle to a fixed point.
    }

    const byId = new Map(current.map((s) => [s.id, s]));
    this.shapes = current.map((s) => {
      const ops = opsFor(s);
      const deps = ops.dependsOn?.(s);
      if (deps === undefined || ops.reroute === undefined) return s;
      const resolved = new Map<ShapeId, Shape>();
      for (const id of deps) {
        const dep = byId.get(id);
        if (dep !== undefined) resolved.set(id, dep);
      }
      return ops.reroute(s, resolved);
    });

    if (this.selection.size > 0) {
      const live = new Set(this.shapes.map((s) => s.id));
      if ([...this.selection].some((id) => !live.has(id))) {
        this.selection = new Set([...this.selection].filter((id) => live.has(id)));
      }
    }
  }
}
