/**
 * The trace document.
 *
 * This mirrors `archsim`'s `ARCHTRC` wire format (`framework-cpp/tracer.h`,
 * `tracer_codec.h`, `file_trace_sink.h` on the `kevin/archsim-v2` branch) closely enough that a
 * real reader can be dropped in behind it without any consumer changing:
 *
 * - a **signal** is a fully-qualified entity path plus a schema, indexed by a dense id;
 * - a **value** is constrained by the producer's `Traceable` concept to "a leaf, or a struct
 *   exactly one level deep whose members are all leaves" -- so a struct-valued signal is what
 *   this viewer draws as an *event*, and events are not a separate record kind;
 * - **time** is an unsigned integer tick. The producer pre-increments, so the first tick it
 *   writes is 1 and anything emitted before it belongs to tick 0.
 *
 * Nothing here decodes BEVE yet; see `fixture.ts` for where the current documents come from.
 */

/** Index into `TraceDoc.signals`, and the same number the wire format calls a signal id. */
export type SignalId = number;

/** An integer simulation tick. */
export type Tick = number;

/**
 * One positional slot of a traced value: a scalar, enum, string, or container of those.
 *
 * Deliberately a separate type from the property editor's `PropValue`, which it currently
 * happens to match. The scene document is editor state and a trace is simulator input; iter-1
 * §5.4 is explicit that one serializer must not serve both, and letting the two grammars share
 * a name is how that starts.
 */
export type TraceLeaf = string | number | boolean | readonly TraceLeaf[];

/** A struct-valued payload. Flat by construction -- the producer rejects deeper nesting. */
export type TraceRecord = Readonly<Record<string, TraceLeaf>>;

export type TraceValue = TraceLeaf | TraceRecord;

/** One member of a struct-valued signal, from the schema sidecar. */
export interface TraceField {
  readonly name: string;
  /** From the JSON Schema `description`. User-facing prose: it is the property footer's text. */
  readonly doc: string;
  /**
   * From `x-beve-enum`: wire number (as text) -> enumerator name. Present only on enum fields,
   * and the reason a value reads `retired` rather than `10`.
   */
  readonly enumNames?: Readonly<Record<string, string>>;
}

export interface TraceSignal {
  readonly id: SignalId;
  /**
   * The fully-qualified entity path, e.g. `top.xu_0.primary_bus`.
   *
   * This is the join key to the diagram: a shape's identity is its `name` for exactly this
   * reason (iter-2 §3.1). See `entityPath` and `EditorSession.signalToShape`.
   */
  readonly name: string;
  readonly doc: string;
  /** `event` draws flags. `value` is modelled but not drawn yet -- see §9 of the iteration doc. */
  readonly display: 'event' | 'value';
  /** Wire order, from `x-beve-order`. Empty when the root is a single leaf value. */
  readonly fields: readonly TraceField[];
  /** Which field supplies a flag's text. Defaults to `fields[0]`. */
  readonly summaryField?: string;
}

/**
 * Every record on one signal, in tick order.
 *
 * Parallel arrays rather than an array of objects: the renderer walks a visible tick range on
 * every frame, and a binary search over a typed array touches no objects at all.
 *
 * `ticks` is `Float64Array`, not `Int32Array` -- integers are exact to 2^53, which comfortably
 * covers a wire format that allows 2^63, where `Int32Array` would silently wrap at 2.1e9.
 * Ticks are non-decreasing and **may repeat**: the producer can emit several records for one
 * signal between two tick markers.
 */
export interface SignalTrack {
  readonly signal: SignalId;
  readonly ticks: Float64Array;
  readonly values: readonly TraceValue[];
}

export interface TraceDoc {
  readonly signals: readonly TraceSignal[];
  /** Indexed by `SignalId`, parallel to `signals`. */
  readonly tracks: readonly SignalTrack[];
  readonly firstTick: Tick;
  readonly lastTick: Tick;
}

export const EMPTY_TRACE: TraceDoc = {
  signals: [],
  tracks: [],
  firstTick: 0,
  lastTick: 0,
};

/* ------------------------------------------------------------------------ queries ---- */

/** First index whose tick is >= `t`, or `ticks.length`. */
export function lowerBound(ticks: Float64Array, t: Tick): number {
  let lo = 0;
  let hi = ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ticks[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose tick is > `t`, or `ticks.length`. */
export function upperBound(ticks: Float64Array, t: Tick): number {
  let lo = 0;
  let hi = ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ticks[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The half-open index range of records at exactly `tick`.
 *
 * A range rather than a count because same-tick records are what a merged flag is made of, and
 * the property panel needs the values themselves.
 */
export function runAt(track: SignalTrack, tick: Tick): { start: number; end: number } {
  const start = lowerBound(track.ticks, tick);
  const end = upperBound(track.ticks, tick);
  return { start, end };
}

/** The first tick strictly after `after` carrying a record, or null. */
export function nextEventTick(track: SignalTrack, after: Tick): Tick | null {
  const i = upperBound(track.ticks, after);
  return i < track.ticks.length ? track.ticks[i]! : null;
}

/** The last tick strictly before `before` carrying a record, or null. */
export function prevEventTick(track: SignalTrack, before: Tick): Tick | null {
  const i = lowerBound(track.ticks, before);
  return i > 0 ? track.ticks[i - 1]! : null;
}

export function firstEventTick(track: SignalTrack): Tick | null {
  return track.ticks.length > 0 ? track.ticks[0]! : null;
}

export function lastEventTick(track: SignalTrack): Tick | null {
  const n = track.ticks.length;
  return n > 0 ? track.ticks[n - 1]! : null;
}

/**
 * The owning entity's path: a signal name minus its last segment.
 *
 * `top.xu_0.primary_bus` -> `top.xu_0`. This is the half of a signal name that can name a block
 * in the diagram; the seam that will use it is `EditorSession.signalToShape`.
 */
export function entityPath(signalName: string): string {
  const i = signalName.lastIndexOf('.');
  return i < 0 ? '' : signalName.slice(0, i);
}

/** The last segment of a signal name, which is what the gutter shows when space is tight. */
export function localName(signalName: string): string {
  const i = signalName.lastIndexOf('.');
  return i < 0 ? signalName : signalName.slice(i + 1);
}

/* ---------------------------------------------------------------------- formatting ---- */

/** One leaf, as text. Applies `enumNames` so an enum reads by name rather than by number. */
export function formatLeaf(v: TraceLeaf, field?: TraceField): string {
  if (Array.isArray(v)) return `[${v.map((x) => formatLeaf(x as TraceLeaf, field)).join(', ')}]`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    const named = field?.enumNames?.[String(v)];
    return named ?? String(v);
  }
  return String(v);
}

export function isRecord(v: TraceValue): v is TraceRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The text drawn inside a flag.
 *
 * A struct shows its summary field (declared, else the first); a leaf shows itself. Long enough
 * to identify the event at a glance -- the full payload is what selecting it puts in the
 * property panel.
 */
export function summarize(signal: TraceSignal, value: TraceValue): string {
  if (!isRecord(value)) return formatLeaf(value, signal.fields[0]);
  const key = signal.summaryField ?? signal.fields[0]?.name;
  if (key === undefined) return '';
  const field = signal.fields.find((f) => f.name === key);
  const leaf = value[key];
  return leaf === undefined ? '' : formatLeaf(leaf, field);
}
