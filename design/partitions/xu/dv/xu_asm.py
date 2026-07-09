"""XU program assembler.

Tests write a short program of high-level ops (one op == one issue cycle);
`assemble` lowers it into per-cycle xu_ctl control words and BRAM address
drives, and predicts the exact-cycle lane outputs with a small golden model
of the input gearbox, the DSP math and the accumulator register file.
`run_program` drives the DUT and checks every prediction on its exact cycle.

All pipeline-depth knowledge lives in xu_timing; all arithmetic reference
models live in xu_models.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from design.partitions.xu.dv import xu_timing as T
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
    dsp_fma_ctl,
    drive_bram_read,
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
   """Read the accumulator register-file slot written >= MIN_RAW_DISTANCE ago."""
   index: int


@dataclass(frozen=True)
class Fwd:
   """Forward the result of the op issued exactly FWD_DISTANCE cycles earlier."""


@dataclass
class Op:
   addr_a: int | None = None
   addr_b: int | None = None
   acc: Slot | Fwd | None = None
   dst: int | None = None


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


@dataclass
class NOP(Op):
   """Idle cycle: legal control, idle BRAM address, no acc write."""


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
   ctl_kwargs: dict
   addr_a: int
   addr_b: int


@dataclass
class Prediction:
   op_index: int
   observe_iter: int
   lanes: tuple[int, int, int, int]
   op_repr: str


class AsmError(Exception):
   pass


def _dsp_ctls(op: Op) -> tuple[int, int]:
   # Ops without an acc operand select 0 in the DSP's Y/Z mux instead of C,
   # so no register-file slot is consumed (acc_raddr is don't-care).
   zero_acc = op.acc is None
   if isinstance(op, FMA24):
      return (pack_dsp_ctl(INMODE=0b10001, ALUMODE=0, OPMODE=MODE3_HIGH_LANE_OPMODE,
                           CEA=0b11, CEB=0b11, CEC=1, CED=1, CEM=1, CEP=1, CEAD=1),
              dsp_fma_ctl(zero_acc=zero_acc))
   if isinstance(op, FMA18):
      ctl = dsp_fma_ctl(zero_acc=zero_acc)
      return ctl, ctl
   ctl = dsp_add_ctl(zero_acc=zero_acc)
   return ctl, ctl


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
   """Per-lane register-file model with commit-time tracking."""

   def __init__(self):
      # slot -> list of (writer_issue_index, (l0_word, l1_word))
      self.writes: dict[int, list[tuple[int, tuple[int, int]]]] = {}

   def write(self, slot: int, issue: int, words: tuple[int, int]):
      self.writes.setdefault(slot, []).append((issue, words))

   def read(self, slot: int, consumer_issue: int) -> tuple[int, int]:
      history = self.writes.get(slot)
      if not history:
         raise AsmError(f"op {consumer_issue} reads slot {slot} before any write")
      committed = [w for w in history if consumer_issue - w[0] >= T.MIN_RAW_DISTANCE]
      latest = history[-1]
      if consumer_issue - latest[0] < T.MIN_RAW_DISTANCE:
         if consumer_issue - latest[0] == T.FWD_DISTANCE:
            hint = " (use acc=Fwd())"
         else:
            hint = ""
         raise AsmError(f"op {consumer_issue} reads slot {slot} written by op "
                        f"{latest[0]}: RAW distance {consumer_issue - latest[0]} < "
                        f"{T.MIN_RAW_DISTANCE}{hint}")
      return committed[-1][1]


def assemble(prog: Program) -> tuple[list[CycleDrive], list[Prediction]]:
   ops = prog.ops
   n = len(ops)

   # Address stream over program + drain window (drain drives the idle addr).
   def addr_at(cycle: int) -> tuple[int, int]:
      if 0 <= cycle < n:
         op = ops[cycle]
         a = op.addr_a if op.addr_a is not None else BRAM_IDLE_ADDR
         b = op.addr_b if op.addr_b is not None else BRAM_IDLE_ADDR
         return a, b
      return BRAM_IDLE_ADDR, BRAM_IDLE_ADDR

   def bram_do(cycle: int) -> tuple[int, int]:
      """DO_A/DO_B during `cycle` (valid BRAM_ADDR_TO_DO after the address)."""
      a, b = addr_at(cycle - T.BRAM_ADDR_TO_DO)
      return prog.bram.get(a, 0), prog.bram.get(b, 0)

   drives: list[CycleDrive] = []
   predictions: list[Prediction] = []
   acc_model = _AccModel()
   result_words: dict[int, tuple[int, int]] = {}  # op index -> l0/l1 writeback

   for i, op in enumerate(ops):
      l0ctl, l1ctl = _dsp_ctls(op)
      ctl_kwargs = dict(
          l0dsp_control=l0ctl,
          l1dsp_control=l1ctl,
          mode=_mode_of(op),
          slice_sel_24bit=getattr(op, "slice_sel", 0),
          mode1_sel_low=getattr(op, "sel_low", 0),
          acc_raddr=op.acc.index if isinstance(op.acc, Slot) else 0,
          acc_waddr=op.dst if op.dst is not None else 0,
          acc_we=int(op.dst is not None),
          bypass_acc=int(isinstance(op.acc, Fwd)),
      )
      a, b = addr_at(i)
      drives.append(CycleDrive(ctl_kwargs=ctl_kwargs, addr_a=a, addr_b=b))

      if isinstance(op, NOP):
         continue

      # ---- golden model: lane inputs at the consume cycle ----
      t = i + T.ISSUE_TO_CONSUME
      do_a_d1, do_b_d1 = bram_do(t - T.GEARBOX_D1)
      do_a, do_b = bram_do(t)
      do_a_d2, do_b_d2 = bram_do(t - T.GEARBOX_D2)

      # ---- acc operand ----
      if isinstance(op.acc, Fwd):
         p = i - T.FWD_DISTANCE
         if p < 0 or isinstance(ops[p], NOP):
            raise AsmError(f"op {i} forwards from op {p}, which is not a computing op")
         acc_words = result_words.get(p)
         if acc_words is None:
            raise AsmError(f"op {i} forwards from op {p} which has no modeled result")
      elif isinstance(op.acc, Slot):
         acc_words = acc_model.read(op.acc.index, i)
      else:
         acc_words = (0, 0)

      # ---- DSP math per mode ----
      if isinstance(op, ADD18):
         y = (
             add18(do_a_d1 >> 18, acc_words[0] >> 18),
             add18(do_a_d1 & HALF_MASK, acc_words[0] & HALF_MASK),
             add18(do_b_d1 >> 18, acc_words[1] >> 18),
             add18(do_b_d1 & HALF_MASK, acc_words[1] & HALF_MASK),
         )
         wb = ((y[0] << 18) | y[1], (y[2] << 18) | y[3])
      elif isinstance(op, FMA18):
         if op.sel_low:
            l0x1 = sign_extend(do_a_d2 & HALF_MASK, 18) & VAL24_MASK
            l0x2 = do_a_d1 & HALF_MASK
            l1x1 = sign_extend(do_b_d2 & HALF_MASK, 18) & VAL24_MASK
            l1x2 = do_b_d1 & HALF_MASK
         else:
            l0x1 = sign_extend(do_a_d1 >> 18, 18) & VAL24_MASK
            l0x2 = do_a >> 18
            l1x1 = sign_extend(do_b_d1 >> 18, 18) & VAL24_MASK
            l1x2 = do_b >> 18
         y = (
             fma18_expected(l0x1, l0x2, acc_words[0] & HALF_MASK),
             0,
             fma18_expected(l1x1, l1x2, acc_words[1] & HALF_MASK),
             0,
         )
         wb = (y[0], y[2])  # result stored in the low half
      elif isinstance(op, ADD24):
         sl = _slices(do_a_d1, do_b_d1)
         l0in, l1in = _rotate(sl, op.slice_sel)
         res0 = add24(l0in, acc_words[0] & VAL24_MASK)
         res1 = add24(l1in, acc_words[1] & VAL24_MASK)
         y = (res0 >> 18, res0 & HALF_MASK, res1 >> 18, res1 & HALF_MASK)
         wb = (res0, res1)
      elif isinstance(op, FMA24):
         sl = _slices(do_a_d1, do_b_d1)
         a24, b24 = _rotate(sl, op.slice_sel)
         # Only the low lane (lane 1) adds C in mode 3; the high lane sums the
         # cascade. The acc operand therefore comes from lane 1's reg file.
         res = fma24_expected(a24, b24, acc_words[1] & VAL24_MASK)
         y = (0, (res >> 9) & 0x7FFF, 0, res & 0x1FF)
         wb = (res, res)  # lane_output_logic writes the result to both lanes
      else:
         raise AsmError(f"unhandled op type {type(op).__name__}")

      result_words[i] = wb
      if op.dst is not None:
         acc_model.write(op.dst, i, wb)

      predictions.append(
          Prediction(
              op_index=i,
              observe_iter=i + T.OBSERVE_ITER_OFFSET,
              lanes=y,
              op_repr=repr(op),
          ))

   return drives, predictions


async def load_bram(dut, bram: dict[int, int]):
   dut.EN_A.value = 1
   dut.WE_A.value = 1
   for addr, word in sorted(bram.items()):
      dut.ADDR_A.value = addr
      dut.DI_A.value = word & WORD_MASK
      await xu_edge(dut)
   dut.WE_A.value = 0
   dut.DI_A.value = 0
   dut.ADDR_A.value = BRAM_IDLE_ADDR


def _drive_nop(dut):
   ctl = dsp_add_ctl(zero_acc=True)
   drive_xu_ctl(dut, l0dsp_control=ctl, l1dsp_control=ctl, mode=0,
                acc_raddr=0, acc_we=0, bypass_acc=0)
   drive_bram_read(dut, BRAM_IDLE_ADDR, BRAM_IDLE_ADDR)


async def run_program(dut, prog: Program):
   """Reset, load BRAM, run the program and check every prediction exact-cycle."""
   drives, predictions = assemble(prog)
   by_iter = {p.observe_iter: p for p in predictions}

   await reset_dut(dut)
   await load_bram(dut, prog.bram)

   # Flush the gearbox and ctl pipe so the model's "idle before cycle 0"
   # assumption holds.
   for _ in range(T.CTL_OUTPUT_TAP + 1):
      _drive_nop(dut)
      await xu_edge(dut)

   total = len(drives) + T.ISSUE_TO_RESULT
   for it in range(total):
      if it < len(drives):
         d = drives[it]
         drive_xu_ctl(dut, **d.ctl_kwargs)
         drive_bram_read(dut, d.addr_a, d.addr_b)
      else:
         _drive_nop(dut)

      await xu_edge(dut)
      await ReadOnly()

      pred = by_iter.get(it)
      if pred is not None:
         actual = lane_outputs(dut)
         if actual != pred.lanes:
            raise AssertionError(
                f"op {pred.op_index} ({pred.op_repr}): output mismatch at iteration {it}\n"
                f"expected (l0y1,l0y2,l1y1,l1y2)={tuple(hex(v) for v in pred.lanes)}\n"
                f"actual   {tuple(hex(v) for v in actual)}\n"
                f"debug={snapshot_debug(dut, actual)}")

      await Timer(1, unit="step")

   return predictions
