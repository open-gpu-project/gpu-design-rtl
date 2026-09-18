"""XU program assembler.

Tests write a short program of high-level ops (one op == one issue cycle);
`assemble` lowers it into per-cycle xu_ctl fields and BRAM address drives,
and predicts the exact-cycle lane outputs with a small golden model of the
input gearbox, the DSP math and the accumulator register file.

`run_program` emits the assembled program as a human-readable vector file
(see xu_vectors), reloads it, and drives the DUT from the loaded data, so
the file on disk is always exactly what was driven.

All pipeline-depth knowledge lives in xu_timing; all arithmetic reference
models live in xu_models.
"""

from __future__ import annotations

import inspect
import os
from dataclasses import dataclass, field
from pathlib import Path

from design.partitions.xu.dv import xu_timing as T
from design.partitions.xu.dv import xu_vectors
from design.partitions.xu.dv.xu_models import (
    add18,
    add24,
    fma18_expected,
    fma24_expected,
    sign_extend,
)
from design.partitions.xu.dv.xu_tb import (
    BRAM_IDLE_ADDR,
    HALF_MASK,
    VAL24_MASK,
    WORD_MASK,
    dsp_add_ctl,
    dsp_add_kwargs,
    dsp_fma_kwargs,
    drive_xu_ctl,
    lane_outputs,
    pack_dsp_ctl,
    reset_dut,
    snapshot_debug,
    xu_edge,
)
from cocotb.triggers import ReadOnly, Timer

# Mode-3 high lane sums the low lane's cascade instead of C (Z = PCIN>>17).
MODE3_HIGH_LANE_OPMODE = 0b1010101


@dataclass(frozen=True)
class Slot:
   """Read the accumulator register-file slot written >= MIN_RAW_DISTANCE ago.

    There is no forwarding path in the XU: the schedule must keep a consumer
    at least MIN_RAW_DISTANCE issue slots after its producer (trivially true
    under 8-strand round-robin issue). assemble() rejects closer reads.
    """
   index: int


@dataclass
class Op:
   addr_a: int | None = None
   addr_b: int | None = None
   acc: Slot | None = None
   dst: int | None = None
   zero_bram_operands: int = field(default=0, repr=False)
   l0_wb_valid: int = field(default=0, repr=False)
   l1_wb_valid: int = field(default=0, repr=False)
   wb_we_a: int = field(default=0xF, repr=False)
   wb_we_b: int = field(default=0xF, repr=False)
   wb_addr_a: int = field(default=0, repr=False)
   wb_addr_b: int = field(default=0, repr=False)


@dataclass
class ADD18(Op):
   """Mode 0: two independent 18-bit adds per lane (x + acc per half)."""


@dataclass
class FMA18(Op):
   """Mode 1: 18-bit FMA per lane, y1 = (x1*x2 + acc_lo<<8)>>8."""
   sel_low: int = 0


@dataclass
class ADD24(Op):
   """Mode 2: 24-bit add per lane through the 72-bit gearbox."""
   slice_sel: int = 0


@dataclass
class FMA24(Op):
   """Mode 3: one 24-bit FMA across both lanes (DSP cascade)."""
   slice_sel: int = 0


@dataclass(repr=False)
class NOP(Op):
   """Idle cycle: legal control, idle BRAM address, no acc write."""

   def __repr__(self):
      if self.addr_a is None and self.addr_b is None:
         return "NOP()"
      return f"NOP(addr_a={self.addr_a}, addr_b={self.addr_b})"


@dataclass
class Program:
   ops: list[Op] = field(default_factory=list)
   bram: dict[int, int] = field(default_factory=dict)

   def set_bram_word(self, addr: int, word: int):
      if addr == BRAM_IDLE_ADDR:
         raise ValueError(f"address 0x{addr:03x} is reserved as the idle address")
      self.bram[addr] = word & WORD_MASK


@dataclass
class CycleDrive:
   ctl: dict  # named xu_ctl fields; l0dsp/l1dsp are DSP kwargs dicts
   addr_a: int
   addr_b: int
   op_repr: str


@dataclass
class Prediction:
   op_index: int
   observe_iter: int
   lanes: tuple[int, int, int, int]
   op_repr: str
   acc_note: str  # where the acc operand came from
   notes: dict[str, str]  # lane output name -> operand math annotation


class AsmError(Exception):
   pass


def packed_ctl(ctl: dict) -> dict:
   """Convert a named ctl dict into drive_xu_ctl/pack_xu_ctl kwargs."""
   kw = dict(ctl)
   kw["l0dsp_control"] = pack_dsp_ctl(**kw.pop("l0dsp"))
   kw["l1dsp_control"] = pack_dsp_ctl(**kw.pop("l1dsp"))
   return kw


def _dsp_ctls(op: Op) -> tuple[dict, dict]:
   # Ops without an acc operand select 0 in the DSP's Y/Z mux instead of C,
   # so no register-file slot is consumed (acc_raddr is don't-care).
   zero_acc = op.acc is None
   if isinstance(op, FMA24):
      return (dict(dsp_fma_kwargs(), OPMODE=MODE3_HIGH_LANE_OPMODE),
              dsp_fma_kwargs(zero_acc=zero_acc))
   if isinstance(op, FMA18):
      return dsp_fma_kwargs(zero_acc=zero_acc), dsp_fma_kwargs(zero_acc=zero_acc)
   return dsp_add_kwargs(zero_acc=zero_acc), dsp_add_kwargs(zero_acc=zero_acc)


def _mode_of(op: Op) -> int:
   if isinstance(op, FMA18):
      return 1
   if isinstance(op, ADD24):
      return 2
   if isinstance(op, FMA24):
      return 3
   return 0  # ADD18, NOP


def _slices(pa_d1: int, pb_d1: int) -> tuple[int, int, int]:
   slice1 = (pa_d1 >> 12) & VAL24_MASK
   slice2 = (((pa_d1 & 0xFFF) << 12) | (pb_d1 & 0xFFF)) & VAL24_MASK
   slice3 = (pb_d1 >> 12) & VAL24_MASK
   return slice1, slice2, slice3


def _rotate(sl: tuple[int, int, int], sel: int) -> tuple[int, int]:
   """Return the (first, second) 24-bit operands lane_input_logic picks."""
   if sel == 0:
      return sl[0], sl[1]
   if sel == 1:
      return sl[1], sl[2]
   if sel == 2:
      return sl[2], sl[0]
   raise AsmError(f"invalid slice_sel {sel}")


class _AccModel:
   """Per-lane, per-bank register-file model with commit-time tracking."""

   def __init__(self):
      # slot -> lane -> bank -> list of (writer_issue_index, 18-bit value)
      self.writes: dict[int, list[list[tuple[int, int]]]] = {}

   def _slot(self, slot: int) -> list[list[tuple[int, int]]]:
      return self.writes.setdefault(slot, [[], [], [], []])

   def _read_bank(self, slot: int, bank: int, consumer_issue: int) -> tuple[int, int]:
      history = self.writes.get(slot, [[], [], [], []])[bank]
      if not history:
         raise AsmError(f"op {consumer_issue} reads slot {slot} before any write "
                        f"(uninitialized register)")
      committed = [w for w in history if consumer_issue - w[0] >= T.MIN_RAW_DISTANCE]
      latest = history[-1]
      if consumer_issue - latest[0] < T.MIN_RAW_DISTANCE:
         raise AsmError(f"op {consumer_issue} reads slot {slot} written by op "
                        f"{latest[0]}: RAW distance {consumer_issue - latest[0]} < "
                        f"{T.MIN_RAW_DISTANCE} and the XU has no forwarding path; "
                        f"schedule dependent ops >= {T.MIN_RAW_DISTANCE} apart "
                        f"(8-strand round-robin gives distance 8)")
      return committed[-1][1], committed[-1][0]

   def write_full(self, slot: int, issue: int, words: tuple[int, int]):
      banks = self._slot(slot)
      banks[0].append((issue, (words[0] >> 18) & HALF_MASK))
      banks[1].append((issue, words[0] & HALF_MASK))
      banks[2].append((issue, (words[1] >> 18) & HALF_MASK))
      banks[3].append((issue, words[1] & HALF_MASK))

   def write_fma18(self, slot: int, issue: int, y: tuple[int, int, int, int], sel_low: int):
      banks = self._slot(slot)
      if sel_low:
         banks[1].append((issue, y[0] & HALF_MASK))
         banks[3].append((issue, y[2] & HALF_MASK))
      else:
         banks[0].append((issue, y[0] & HALF_MASK))
         banks[2].append((issue, y[2] & HALF_MASK))

   def read_full(self, slot: int, consumer_issue: int) -> tuple[tuple[int, int], int]:
      l0_hi, w0 = self._read_bank(slot, 0, consumer_issue)
      l0_lo, w1 = self._read_bank(slot, 1, consumer_issue)
      l1_hi, w2 = self._read_bank(slot, 2, consumer_issue)
      l1_lo, w3 = self._read_bank(slot, 3, consumer_issue)
      return ((l0_hi << 18) | l0_lo, (l1_hi << 18) | l1_lo), max(w0, w1, w2, w3)

   def read_fma18(self, slot: int, consumer_issue: int, sel_low: int) -> tuple[tuple[int, int], int]:
      if sel_low:
         l0_lo, w0 = self._read_bank(slot, 1, consumer_issue)
         l1_lo, w1 = self._read_bank(slot, 3, consumer_issue)
         return (l0_lo, l1_lo), max(w0, w1)
      l0_hi, w0 = self._read_bank(slot, 0, consumer_issue)
      l1_hi, w1 = self._read_bank(slot, 2, consumer_issue)
      return (l0_hi << 18, l1_hi << 18), max(w0, w1)


def assemble(prog: Program) -> tuple[list[CycleDrive], list[Prediction]]:
   ops = prog.ops
   n = len(ops)
   bram_writes: dict[int, list[tuple[int, int]]] = {
       addr: [(-1, word & WORD_MASK)] for addr, word in prog.bram.items()
   }

   def bram_word_at(addr: int, cycle: int) -> int:
      history = bram_writes.get(addr)
      if not history:
         return 0
      visible = [w for w in history if w[0] <= cycle]
      return visible[-1][1] if visible else 0

   def issued_addr_at(cycle: int) -> tuple[int, int]:
      if 0 <= cycle < n:
         op = ops[cycle]
         a = op.addr_a if op.addr_a is not None else BRAM_IDLE_ADDR
         b = op.addr_b if op.addr_b is not None else BRAM_IDLE_ADDR
         return a, b
      return BRAM_IDLE_ADDR, BRAM_IDLE_ADDR

   # Effective address stream after the same arbitration used by top.sv. A
   # writeback reaching output tap 7 owns its port over the newly issued op.
   def bram_addr_at(cycle: int) -> tuple[int, int]:
      a, b = issued_addr_at(cycle)
      wb_issue = cycle - T.ISSUE_TO_RESULT
      if 0 <= wb_issue < n:
         wb_op = ops[wb_issue]
         if wb_op.l0_wb_valid:
            a = wb_op.wb_addr_a
         if wb_op.l1_wb_valid:
            b = wb_op.wb_addr_b
      return a, b

   def bram_do(cycle: int) -> tuple[int, int]:
      """DO_A/DO_B during `cycle` (valid BRAM_ADDR_TO_DO after the address)."""
      a, b = bram_addr_at(cycle - T.BRAM_ADDR_TO_DO)
      return bram_word_at(a, cycle), bram_word_at(b, cycle)

   drives: list[CycleDrive] = []
   predictions: list[Prediction] = []
   acc_model = _AccModel()

   for i, op in enumerate(ops):
      l0dsp, l1dsp = _dsp_ctls(op)
      ctl = dict(
          mode=_mode_of(op),
          slice_sel_24bit=getattr(op, "slice_sel", 0),
          mode1_sel_low=getattr(op, "sel_low", 0),
          acc_raddr=op.acc.index if isinstance(op.acc, Slot) else 0,
          acc_waddr=op.dst if op.dst is not None else 0,
          acc_we=int(op.dst is not None),
          zero_bram_operands=int(op.zero_bram_operands),
          l0_wb_valid=int(op.l0_wb_valid),
          l1_wb_valid=int(op.l1_wb_valid),
          wb_we_a=op.wb_we_a,
          wb_we_b=op.wb_we_b,
          wb_addr_a=op.wb_addr_a,
          wb_addr_b=op.wb_addr_b,
          l0dsp=l0dsp,
          l1dsp=l1dsp,
      )
      a, b = issued_addr_at(i)
      drives.append(CycleDrive(ctl=ctl, addr_a=a, addr_b=b, op_repr=repr(op)))

      if isinstance(op, NOP):
         continue

      # ---- golden model: lane inputs at the consume cycle ----
      t = i + T.ISSUE_TO_CONSUME
      do_a_d1, do_b_d1 = bram_do(t - T.GEARBOX_D1)
      do_a, do_b = bram_do(t)
      do_a_d2, do_b_d2 = bram_do(t - T.GEARBOX_D2)
      if op.zero_bram_operands:
         do_a_d1 = do_b_d1 = 0
         do_a = do_b = 0
         do_a_d2 = do_b_d2 = 0

      # ---- acc operand ----
      if isinstance(op.acc, Slot):
         if isinstance(op, FMA18):
            acc_words, writer = acc_model.read_fma18(op.acc.index, i, op.sel_low)
         else:
            acc_words, writer = acc_model.read_full(op.acc.index, i)
         acc_note = f"acc = slot {op.acc.index} (written by op {writer})"
      else:
         acc_words = (0, 0)
         acc_note = "no acc operand (OPMODE selects 0)"

      # ---- DSP math per mode ----
      if isinstance(op, ADD18):
         y = (
             add18(do_a_d1 >> 18, acc_words[0] >> 18),
             add18(do_a_d1 & HALF_MASK, acc_words[0] & HALF_MASK),
             add18(do_b_d1 >> 18, acc_words[1] >> 18),
             add18(do_b_d1 & HALF_MASK, acc_words[1] & HALF_MASK),
         )
         wb = ((y[0] << 18) | y[1], (y[2] << 18) | y[3])
         bram_wb = wb
         notes = {
             "l0y1": f"0x{do_a_d1 >> 18:05x} + 0x{acc_words[0] >> 18:05x}",
             "l0y2": f"0x{do_a_d1 & HALF_MASK:05x} + 0x{acc_words[0] & HALF_MASK:05x}",
             "l1y1": f"0x{do_b_d1 >> 18:05x} + 0x{acc_words[1] >> 18:05x}",
             "l1y2": f"0x{do_b_d1 & HALF_MASK:05x} + 0x{acc_words[1] & HALF_MASK:05x}",
         }
      elif isinstance(op, FMA18):
         if op.sel_low:
            l0x1 = sign_extend(do_a_d2 & HALF_MASK, 18) & VAL24_MASK
            l0x2 = do_a_d1 & HALF_MASK
            l1x1 = sign_extend(do_b_d2 & HALF_MASK, 18) & VAL24_MASK
            l1x2 = do_b_d1 & HALF_MASK
            l0_acc18 = acc_words[0] & HALF_MASK
            l1_acc18 = acc_words[1] & HALF_MASK
         else:
            l0x1 = sign_extend(do_a_d1 >> 18, 18) & VAL24_MASK
            l0x2 = do_a >> 18
            l1x1 = sign_extend(do_b_d1 >> 18, 18) & VAL24_MASK
            l1x2 = do_b >> 18
            l0_acc18 = (acc_words[0] >> 18) & HALF_MASK
            l1_acc18 = (acc_words[1] >> 18) & HALF_MASK
         y = (
             fma18_expected(l0x1, l0x2, l0_acc18),
             0,
             fma18_expected(l1x1, l1x2, l1_acc18),
             0,
         )
         if op.sel_low:
            l0_wb = ((acc_words[0] & ~HALF_MASK) | y[0]) & WORD_MASK
            l1_wb = ((acc_words[1] & ~HALF_MASK) | y[2]) & WORD_MASK
         else:
            l0_wb = ((y[0] << 18) | (acc_words[0] & HALF_MASK)) & WORD_MASK
            l1_wb = ((y[2] << 18) | (acc_words[1] & HALF_MASK)) & WORD_MASK
         wb = (l0_wb, l1_wb)  # FMA18 acc writes the selected 18-bit bank.
         bram_wb = (y[0], y[2])
         notes = {
             "l0y1": f"(0x{l0x1:06x} * 0x{l0x2:05x} + "
                     f"0x{l0_acc18:05x}<<8) >> 8",
             "l1y1": f"(0x{l1x1:06x} * 0x{l1x2:05x} + "
                     f"0x{l1_acc18:05x}<<8) >> 8",
         }
      elif isinstance(op, ADD24):
         sl = _slices(do_a_d1, do_b_d1)
         l0in, l1in = _rotate(sl, op.slice_sel)
         res0 = add24(l0in, acc_words[0] & VAL24_MASK)
         res1 = add24(l1in, acc_words[1] & VAL24_MASK)
         y = (res0 >> 18, res0 & HALF_MASK, res1 >> 18, res1 & HALF_MASK)
         wb = (res0, res1)
         bram_wb = wb
         notes = {
             "l0y1": f"(0x{l0in:06x} + 0x{acc_words[0] & VAL24_MASK:06x}) >> 18",
             "l0y2": f"(0x{l0in:06x} + 0x{acc_words[0] & VAL24_MASK:06x}) & 0x3ffff",
             "l1y1": f"(0x{l1in:06x} + 0x{acc_words[1] & VAL24_MASK:06x}) >> 18",
             "l1y2": f"(0x{l1in:06x} + 0x{acc_words[1] & VAL24_MASK:06x}) & 0x3ffff",
         }
      elif isinstance(op, FMA24):
         sl = _slices(do_a_d1, do_b_d1)
         a24, b24 = _rotate(sl, op.slice_sel)
         # Only the low lane (lane 1) adds C in mode 3; the high lane sums the
         # cascade. The acc operand therefore comes from lane 1's reg file.
         res = fma24_expected(a24, b24, acc_words[1] & VAL24_MASK)
         y = (0, (res >> 9) & 0x7FFF, 0, res & 0x1FF)
         wb = (res, res)  # lane_output_logic writes the result to both lanes
         bram_wb = wb
         fma24_note = f"0x{a24:06x} * 0x{b24:06x} + 0x{acc_words[1] & VAL24_MASK:06x}"
         notes = {
             "l0y2": f"({fma24_note}) >> 9",
             "l1y2": f"({fma24_note}) & 0x1ff",
         }
      else:
         raise AsmError(f"unhandled op type {type(op).__name__}")

      if op.dst is not None:
         if isinstance(op, FMA18):
            acc_model.write_fma18(op.dst, i, y, op.sel_low)
         else:
            acc_model.write_full(op.dst, i, wb)
      if op.l0_wb_valid:
         bram_writes.setdefault(op.wb_addr_a, []).append(
             (i + T.ISSUE_TO_COMMIT, bram_wb[0] & WORD_MASK))
      if op.l1_wb_valid:
         bram_writes.setdefault(op.wb_addr_b, []).append(
             (i + T.ISSUE_TO_COMMIT, bram_wb[1] & WORD_MASK))

      predictions.append(
          Prediction(
              op_index=i,
              observe_iter=i + T.OBSERVE_ITER_OFFSET,
              lanes=y,
              op_repr=repr(op),
              acc_note=acc_note,
              notes=notes,
          ))

   return drives, predictions


async def load_bram(dut, bram: dict[int, int]):
   # BRAM writes go through xu_ctl too; only the write data is a real port.
   for addr, word in sorted(bram.items()):
      drive_xu_ctl(dut, addr_a=addr, we_a=0xF)
      dut.DI_A.value = word & WORD_MASK
      await xu_edge(dut)
   drive_xu_ctl(dut)  # idle: addr defaults to BRAM_IDLE_ADDR, we=0
   dut.DI_A.value = 0


def _drive_nop(dut):
   ctl = dsp_add_ctl(zero_acc=True)
   drive_xu_ctl(dut, l0dsp_control=ctl, l1dsp_control=ctl, mode=0,
                acc_raddr=0, acc_we=0)


def emit_program(prog: Program, name: str) -> Path:
   """Assemble prog and write its vector file; return the file path."""
   drives, predictions = assemble(prog)
   vec_dir = Path(os.environ.get("XU_VECTOR_DIR", os.getcwd()))
   path = vec_dir / f"{name}.vectors.yaml"
   xu_vectors.emit(name, prog.bram, drives, predictions, path)
   return path


async def run_program(dut, prog: Program, name: str | None = None):
   """Emit prog's vector file, reload it, and drive/check the DUT from it.

    Driving from the loaded file (not the in-memory assemble() result)
    guarantees the file is exactly what was driven.
    """
   name = name or inspect.stack()[1].function
   path = emit_program(prog, name)
   bram, cycles = xu_vectors.load(path)

   await reset_dut(dut)
   await load_bram(dut, bram)

   # Flush the gearbox and ctl pipe so the model's "idle before cycle 0"
   # assumption holds.
   for _ in range(T.CTL_OUTPUT_TAP + 1):
      _drive_nop(dut)
      await xu_edge(dut)

   checks = {c.check["at"]: c for c in cycles if c.check is not None}
   total = len(cycles) + T.ISSUE_TO_RESULT
   for it in range(total):
      if it < len(cycles):
         c = cycles[it]
         drive_xu_ctl(dut, addr_a=c.addr_a, addr_b=c.addr_b, **packed_ctl(c.ctl))
      else:
         _drive_nop(dut)

      await xu_edge(dut)
      await ReadOnly()

      chk = checks.get(it)
      if chk is not None:
         expected = tuple(chk.check[lane] for lane in xu_vectors.LANE_NAMES)
         actual = lane_outputs(dut)
         if actual != expected:
            raise AssertionError(
                f"cycle {chk.cycle} ({chk.op}): output mismatch at check cycle {it}\n"
                f"expected (l0y1,l0y2,l1y1,l1y2)={tuple(hex(v) for v in expected)}\n"
                f"actual   {tuple(hex(v) for v in actual)}\n"
                f"vectors: {path}\n"
                f"debug={snapshot_debug(dut, actual)}")

      await Timer(1, unit="step")

   return path
