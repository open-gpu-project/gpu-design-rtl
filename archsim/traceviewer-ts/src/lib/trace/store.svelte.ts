import {
  EMPTY_TRACE,
  firstEventTick,
  lastEventTick,
  nextEventTick,
  prevEventTick,
  runAt,
  type SignalId,
  type SignalTrack,
  type Tick,
  type TraceDoc,
  type TraceSignal,
  type TraceValue,
} from './model';

/** What the property panel shows when a flag is selected. */
export interface SelectedEvent {
  readonly signal: SignalId;
  readonly tick: Tick;
  /** Every record at that tick. More than one is a merged flag. */
  readonly values: readonly TraceValue[];
}

/**
 * The trace document, the row order, and the time cursor.
 *
 * Owned by `EditorSession`, not by the panel: the dock re-mounts a pane's content when it is
 * maximized or floated, so anything living in the view dies with it (iter-2 §3.2).
 *
 * Cross-panel selection rules are **not** here -- they live on `EditorSession`, which is the
 * only thing that can see both this and the scene.
 */
export class TraceStore {
  doc = $state.raw<TraceDoc>(EMPTY_TRACE);

  /**
   * Visible rows, top to bottom. Filtering, grouping and reordering all hang off this array
   * later; today it is every `display: 'event'` signal in file order.
   */
  rows = $state.raw<readonly SignalId[]>([]);

  cursorTick = $state(0);

  selectedSignal = $state.raw<SignalId | null>(null);

  /**
   * The selected flag, **derived rather than stored**.
   *
   * Both of the rules asked for fall out of that one decision: clicking a flag only has to set
   * `selectedSignal` and `cursorTick` for the event to follow, and moving the cursor onto a
   * flag of the selected row selects it automatically. Storing it as well would make a
   * disagreement between the cursor and the highlighted flag representable, and therefore
   * eventually real.
   */
  selectedEvent = $derived.by<SelectedEvent | null>(() => {
    const id = this.selectedSignal;
    if (id === null) return null;
    const track = this.doc.tracks[id];
    if (track === undefined) return null;
    const { start, end } = runAt(track, this.cursorTick);
    if (start === end) return null;
    return { signal: id, tick: this.cursorTick, values: track.values.slice(start, end) };
  });

  load(doc: TraceDoc): void {
    this.doc = doc;
    this.rows = doc.signals.filter((s) => s.display === 'event').map((s) => s.id);
    this.selectedSignal = null;
    this.cursorTick = Math.min(this.cursorTick, doc.lastTick);
  }

  signalOf(id: SignalId): TraceSignal | undefined {
    return this.doc.signals[id];
  }

  trackOf(id: SignalId): SignalTrack | undefined {
    return this.doc.tracks[id];
  }

  rowIndexOf(id: SignalId): number {
    return this.rows.indexOf(id);
  }

  /** Ticks are integers, so every cursor move snaps. Clamped to the document. */
  setCursor(tick: Tick): void {
    const t = Math.max(0, Math.min(this.doc.lastTick, Math.round(tick)));
    if (t !== this.cursorTick) this.cursorTick = t;
  }

  /* --------------------------------------------------------------- navigation ---- */

  /** The selected row's track, or null. Every navigation command needs it. */
  #selectedTrack(): SignalTrack | null {
    const id = this.selectedSignal;
    if (id === null) return null;
    return this.doc.tracks[id] ?? null;
  }

  /**
   * Move the cursor to the next record on the selected row.
   *
   * With no row selected this steps one tick, so the arrow keys always do something sensible.
   * Returns whether the cursor moved, which is what the caller uses to decide about scrolling.
   */
  nextEvent(): boolean {
    const track = this.#selectedTrack();
    const before = this.cursorTick;
    if (track === null) this.setCursor(this.cursorTick + 1);
    else {
      const t = nextEventTick(track, this.cursorTick);
      if (t === null) return false;
      this.setCursor(t);
    }
    return this.cursorTick !== before;
  }

  prevEvent(): boolean {
    const track = this.#selectedTrack();
    const before = this.cursorTick;
    if (track === null) this.setCursor(this.cursorTick - 1);
    else {
      const t = prevEventTick(track, this.cursorTick);
      if (t === null) return false;
      this.setCursor(t);
    }
    return this.cursorTick !== before;
  }

  /** First record on the selected row, or tick 0. */
  firstEvent(): void {
    const track = this.#selectedTrack();
    this.setCursor(track === null ? 0 : (firstEventTick(track) ?? 0));
  }

  /** Last record on the selected row, or the end of the document. */
  lastEvent(): void {
    const track = this.#selectedTrack();
    this.setCursor(
      track === null ? this.doc.lastTick : (lastEventTick(track) ?? this.doc.lastTick),
    );
  }
}
