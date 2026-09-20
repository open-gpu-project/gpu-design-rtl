import type { Shape, ShapeId } from './shape';

export interface HistoryEntry {
  readonly before: readonly Shape[];
  readonly after: readonly Shape[];
  readonly beforeSel: ReadonlySet<ShapeId>;
  readonly afterSel: ReadonlySet<ShapeId>;
  /** Human-readable, for tooltips and a future history panel. */
  readonly label: string;
}

const CAPACITY = 200;

/**
 * Snapshot history. Shapes are immutable and the array is replaced wholesale on every commit,
 * so an entry holds two arrays of existing references -- O(n) pointers, not O(n) deep copies.
 *
 * Granularity comes for free from the store: only `commit` pushes, and a drag previews without
 * committing, so a whole drag is exactly one entry with no debouncing anywhere.
 */
export class History {
  #undo = $state.raw<readonly HistoryEntry[]>([]);
  #redo = $state.raw<readonly HistoryEntry[]>([]);

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  get undoLabel(): string | null {
    return this.#undo.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.#redo.at(-1)?.label ?? null;
  }

  push(entry: HistoryEntry): void {
    const next = [...this.#undo, entry];
    this.#undo = next.length > CAPACITY ? next.slice(next.length - CAPACITY) : next;
    this.#redo = [];
  }

  popUndo(): HistoryEntry | null {
    const entry = this.#undo.at(-1);
    if (entry === undefined) return null;
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, entry];
    return entry;
  }

  popRedo(): HistoryEntry | null {
    const entry = this.#redo.at(-1);
    if (entry === undefined) return null;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, entry];
    return entry;
  }

  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }
}
