/**
 * A synthetic trace, until this branch can read a real `ARCHTRC` file.
 *
 * `framework-cpp` -- the producer -- lives on `kevin/archsim-v2` and is absent here, and no
 * sample trace is checked in anywhere in the repository. So the panel is developed against a
 * generated document shaped after the XBN model on `kevin/xbnsim`
 * (`xbnsim/components/xbntrace.py`), whose per-cycle `list[XuTraceEntry]` is where the
 * "several events on one row at one tick" case comes from.
 *
 * Generation is **seeded and deterministic**: `verify/trace.mjs` asserts against specific
 * ticks, so a document that changed between loads would make the browser checks useless.
 */

import type { SignalTrack, TraceDoc, TraceField, TraceSignal, TraceValue } from './model';

/** mulberry32. Small, fast, and good enough for placing fixture events. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Matches an `enum class Opcode : uint8_t` traced through `x-beve-enum`. */
const OPCODE_NAMES: Readonly<Record<string, string>> = {
  '0': 'nop',
  '1': 'send',
  '2': 'recv',
  '3': 'bcast',
  '4': 'halt',
};

const BUS_FIELDS: readonly TraceField[] = [
  {
    name: 'opcode',
    doc: 'The command carried on the bus this cycle. Decoded from the traced enumeration, so it reads by name rather than by its wire number.',
    enumNames: OPCODE_NAMES,
  },
  {
    name: 'src',
    doc: 'Index of the execution unit that drove this command onto the bus.',
  },
  {
    name: 'dst',
    doc: 'Index of the execution unit the command is addressed to. 255 is a broadcast.',
  },
  {
    name: 'payload',
    doc: 'The 32-bit word travelling with the command. Meaningless for a nop.',
  },
];

const ISSUE_FIELDS: readonly TraceField[] = [
  { name: 'warp', doc: 'The warp slot the instruction was issued from.' },
  { name: 'pc', doc: 'Program counter of the issued instruction, in bytes.' },
  { name: 'mnemonic', doc: 'Disassembled form of the issued instruction.' },
];

const XU_COUNT = 4;
const LAST_TICK = 2400;

/** `top.xu_0.primary_bus`. Signal 0 is the sequencer, so the first bus row is 1. */
export const COLLISION_SIGNAL = 1;

/** Where that row is given three records at once, for the merged-flag path. */
export const COLLISION_TICK = 640;

/** A deliberate hole, so level-of-detail and next/previous navigation meet a long empty span. */
const IDLE_FROM = 900;
const IDLE_TO = 1500;

function isIdle(t: number): boolean {
  return t > IDLE_FROM && t < IDLE_TO;
}

function track(signal: number, entries: readonly (readonly [number, TraceValue])[]): SignalTrack {
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const ticks = new Float64Array(sorted.length);
  const values: TraceValue[] = [];
  sorted.forEach(([t, v], i) => {
    ticks[i] = t;
    values.push(v);
  });
  return { signal, ticks, values };
}

const MNEMONICS = ['fma.f32', 'ld.global', 'st.shared', 'setp.lt', 'bra', 'mov.u32'];

export function demoTrace(seed = 0x5eed): TraceDoc {
  const rand = rng(seed);
  const signals: TraceSignal[] = [];
  const tracks: SignalTrack[] = [];

  const push = (
    s: Omit<TraceSignal, 'id'>,
    entries: readonly (readonly [number, TraceValue])[],
  ) => {
    const id = signals.length;
    signals.push({ ...s, id });
    tracks.push(track(id, entries));
  };

  // The sequencer issues roughly every third tick outside the idle window.
  const issue: (readonly [number, TraceValue])[] = [];
  for (let t = 1; t <= LAST_TICK; t++) {
    if (isIdle(t) || rand() > 0.32) continue;
    issue.push([
      t,
      {
        warp: Math.floor(rand() * 8),
        pc: 0x1000 + Math.floor(rand() * 256) * 4,
        mnemonic: MNEMONICS[Math.floor(rand() * MNEMONICS.length)]!,
      },
    ]);
  }
  push(
    {
      name: 'top.sequencer.issue',
      doc: 'Instruction issue. One record per instruction handed to an execution unit.',
      display: 'event',
      fields: ISSUE_FIELDS,
      summaryField: 'mnemonic',
    },
    issue,
  );

  for (let xu = 0; xu < XU_COUNT; xu++) {
    for (const bus of ['primary_bus', 'loopback_bus'] as const) {
      const entries: (readonly [number, TraceValue])[] = [];
      const density = bus === 'primary_bus' ? 0.09 : 0.05;
      for (let t = 1; t <= LAST_TICK; t++) {
        if (isIdle(t) || rand() > density) continue;
        const opcode = 1 + Math.floor(rand() * 4);
        entries.push([
          t,
          {
            opcode,
            src: xu,
            dst: opcode === 3 ? 255 : Math.floor(rand() * XU_COUNT),
            payload: Math.floor(rand() * 0xffff),
          },
        ]);
      }
      push(
        {
          name: `top.xu_${xu}.${bus}`,
          doc:
            bus === 'primary_bus'
              ? 'Commands this execution unit drove onto the shared primary bus.'
              : 'Commands this execution unit returned on its loopback bus.',
          display: 'event',
          fields: BUS_FIELDS,
          summaryField: 'opcode',
        },
        entries,
      );
    }
  }

  // Three records on one signal at one tick. The producer permits this -- several value
  // records can sit between two tick markers -- and the XBN model does it routinely, so the
  // merged-flag path must have a fixture that reaches it. Existing records at COLLISION_TICK
  // are dropped first, so the count there is exactly three whatever the seed produced.
  const collided = tracks[COLLISION_SIGNAL]!;
  const kept = Array.from(collided.ticks, (t, i) => [t, collided.values[i]!] as const).filter(
    ([t]) => t !== COLLISION_TICK,
  );
  tracks[COLLISION_SIGNAL] = track(COLLISION_SIGNAL, [
    ...kept,
    [COLLISION_TICK, { opcode: 1, src: 0, dst: 2, payload: 0x1111 }],
    [COLLISION_TICK, { opcode: 2, src: 0, dst: 3, payload: 0x2222 }],
    [COLLISION_TICK, { opcode: 3, src: 0, dst: 255, payload: 0x3333 }],
  ]);

  // Modelled, not drawn: `display: 'value'` rows are what a later iteration turns into spans.
  for (const [name, doc] of [
    ['top.alu.result', 'The ALU result register, sampled on every rising edge it changes.'],
    ['top.alu.busy', 'High while the ALU pipeline holds an instruction.'],
  ] as const) {
    const entries: (readonly [number, TraceValue])[] = [];
    for (let t = 1; t <= LAST_TICK; t++) {
      if (isIdle(t) || rand() > 0.05) continue;
      entries.push([t, name.endsWith('busy') ? rand() > 0.5 : Math.floor(rand() * 0xffffffff)]);
    }
    push({ name, doc, display: 'value', fields: [] }, entries);
  }

  return { signals, tracks, firstTick: 0, lastTick: LAST_TICK };
}
