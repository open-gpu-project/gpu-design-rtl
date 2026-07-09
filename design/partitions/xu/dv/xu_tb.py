"""Shared cocotb helpers for XU tests.

Tests (test_xu_programs.py and friends) should contain test intent only; this
file contains boring DUT IO, packing, clock/reset, scoreboard, and debug
helpers. run_stream_test remains available for exploratory bring-up.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Iterable

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ReadOnly, RisingEdge, Timer

HALF_W = 18
WORD_W = 36
HALF_MASK = (1 << HALF_W) - 1
WORD_MASK = (1 << WORD_W) - 1
VAL24_MASK = (1 << 24) - 1
BRAM36_MASK = (1 << 36) - 1

CLK_NAME = "dsp_clk_div2"
BRAM_IDLE_ADDR = 0x3FF
ACC_DEPTH = 32
BRAM_READ_LATENCY = 1


@dataclass
class Expected:
   issue_cycle: int
   phase: str
   expected: tuple[int, ...]
   meta: dict = field(default_factory=dict)


def pack_dsp_ctl(
    *,
    INMODE=0,
    ALUMODE=0,
    OPMODE=0,
    CEA=0,
    CEB=0,
    CEC=0,
    CED=0,
    CEM=0,
    CEP=0,
    CEAD=0,
):
   return (((INMODE & 0x1F) << 20) | ((ALUMODE & 0xF) << 16) | ((OPMODE & 0x7F) << 9) |
           ((CEA & 0x3) << 7) | ((CEB & 0x3) << 5) | ((CEC & 0x1) << 4) | ((CED & 0x1) << 3) |
           ((CEM & 0x1) << 2) | ((CEP & 0x1) << 1) | ((CEAD & 0x1) << 0))


def pack_xu_ctl(
    *,
    l0dsp_control=0,
    l1dsp_control=0,
    mode=0,
    slice_sel_24bit=0,
    mode1_sel_low=0,
    acc_raddr=0,
    acc_waddr=0,
    acc_we=0,
):
   """Pack the xu_priv::xu_ctl struct (66 bits, MSB-first field order):

    l0dsp_control[65:41] l1dsp_control[40:16] mode[15:14] slice_sel_24bit[13:12]
    mode1_sel_low[11] acc_raddr[10:6] acc_waddr[5:1] acc_we[0]
    """
   return (((l0dsp_control & ((1 << 25) - 1)) << 41) | ((l1dsp_control & ((1 << 25) - 1)) << 16) |
           ((mode & 0x3) << 14) | ((slice_sel_24bit & 0x3) << 12) | ((mode1_sel_low & 0x1) << 11) |
           ((acc_raddr & 0x1F) << 6) | ((acc_waddr & 0x1F) << 1) | (acc_we & 0x1))


def drive_xu_ctl(dut, **kwargs):
   dut.xu_ctl_in.value = pack_xu_ctl(**kwargs)


def dsp_add_kwargs(*, zero_acc=False):
   # zero_acc: Y mux selects 0 instead of C, so no register-file operand is
   # consumed (used for loads and NOPs; acc_raddr becomes don't-care).
   return dict(
       INMODE=0,
       ALUMODE=0,
       OPMODE=0b0000011 if zero_acc else 0b0001111,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )


def dsp_fma_kwargs(*, zero_acc=False):
   # zero_acc: Z mux selects 0 instead of C (multiply-only, no acc operand).
   return dict(
       INMODE=0b10001,
       ALUMODE=0,
       OPMODE=0b0000101 if zero_acc else 0b0110101,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )


def dsp_add_ctl(*, zero_acc=False):
   return pack_dsp_ctl(**dsp_add_kwargs(zero_acc=zero_acc))


def dsp_fma_ctl(*, zero_acc=False):
   return pack_dsp_ctl(**dsp_fma_kwargs(zero_acc=zero_acc))


def xu_clk(dut):
   return getattr(dut, CLK_NAME)


async def xu_edge(dut):
   await RisingEdge(xu_clk(dut))


def init_xu_inputs(dut):
   dut.rst.value = 1
   dut.xu_ctl_in.value = 0
   dut.l1dsp_casc_in.value = 0

   for port in ("A", "B"):
      getattr(dut, f"ADDR_{port}").value = 0
      getattr(dut, f"EN_{port}").value = 0
      getattr(dut, f"WE_{port}").value = 0
      getattr(dut, f"DI_{port}").value = 0


async def reset_dut(dut):
   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.dsp_clk_div2, 10, unit="ns").start())

   init_xu_inputs(dut)
   for _ in range(3):
      await xu_edge(dut)

   dut.rst.value = 0
   await xu_edge(dut)
   await Timer(1, unit="step")


def drive_bram_read(dut, addr_a: int, addr_b: int):
   dut.ADDR_A.value = addr_a
   dut.ADDR_B.value = addr_b
   dut.EN_A.value = 1
   dut.EN_B.value = 1
   dut.WE_A.value = 0
   dut.WE_B.value = 0


def drive_bram_idle(dut):
   drive_bram_read(dut, BRAM_IDLE_ADDR, BRAM_IDLE_ADDR)


async def write_bram36_words_port_a(dut, words: Iterable[int], *, start_addr: int):
   dut.EN_A.value = 1
   dut.WE_A.value = 1

   for offset, word in enumerate(words):
      dut.ADDR_A.value = start_addr + offset
      dut.DI_A.value = word & BRAM36_MASK
      await xu_edge(dut)

   dut.WE_A.value = 0
   dut.DI_A.value = 0


async def load_18b_lines_to_bram(dut, lines, *, start_addr=0, port="A"):
   from design.partitions.xu.dv.xu_models import pack18_pair

   port = port.upper()
   if port not in ("A", "B"):
      raise ValueError(f"port must be 'A' or 'B', got {port!r}")

   addr = getattr(dut, f"ADDR_{port}")
   en = getattr(dut, f"EN_{port}")
   we = getattr(dut, f"WE_{port}")
   data = getattr(dut, f"DI_{port}")

   en.value = 1
   we.value = 1

   for offset, (high18, low18) in enumerate(lines):
      addr.value = start_addr + offset
      data.value = pack18_pair(high18, low18)
      await xu_edge(dut)

   we.value = 0
   data.value = 0


async def load_72_rows_to_bram(dut, rows, *, lo_base: int, hi_base: int):
   from design.partitions.xu.dv.xu_models import pack72_from_slices

   low_words = []
   high_words = []
   for slice1, slice2, slice3 in rows:
      low36, high36 = pack72_from_slices(slice1, slice2, slice3)
      low_words.append(low36)
      high_words.append(high36)

   await write_bram36_words_port_a(dut, low_words, start_addr=lo_base)
   await write_bram36_words_port_a(dut, high_words, start_addr=hi_base)


async def check_parallel_bram_read_burst(dut, lines, *, base_addr: int, count: int, name: str):
   from design.partitions.xu.dv.xu_models import pack18_pair, unpack18_pair

   issued = []
   for cycle in range(count + BRAM_READ_LATENCY):
      if cycle < count:
         addr_a = base_addr + cycle
         addr_b = base_addr + cycle + count
         drive_bram_read(dut, addr_a, addr_b)
         issued.append((addr_a, addr_b))
      else:
         drive_bram_idle(dut)

      await xu_edge(dut)
      await ReadOnly()

      if cycle < BRAM_READ_LATENCY:
         await Timer(1, unit="step")
         continue

      addr_a, addr_b = issued[cycle - BRAM_READ_LATENCY]
      actual_a = int(dut.DO_A.value) & WORD_MASK
      actual_b = int(dut.DO_B.value) & WORD_MASK
      expected_a = pack18_pair(*lines[addr_a])
      expected_b = pack18_pair(*lines[addr_b])

      for port, addr, actual, expected in (
          ("A", addr_a, actual_a, expected_a),
          ("B", addr_b, actual_b, expected_b),
      ):
         if actual != expected:
            raise AssertionError(f"{name} BRAM {port}[{addr}] mismatch\n"
                                 f"expected word=0x{expected:09x} line={lines[addr]}\n"
                                 f"actual   word=0x{actual:09x} line={unpack18_pair(actual)}")

      await Timer(1, unit="step")


def lane_outputs(dut):
   return (
       int(dut.l0y1_o.value) & HALF_MASK,
       int(dut.l0y2_o.value) & HALF_MASK,
       int(dut.l1y1_o.value) & HALF_MASK,
       int(dut.l1y2_o.value) & HALF_MASK,
   )


def acc_in_values(dut):
   return (
       int(dut.l0acc_in.value) & VAL24_MASK,
       int(dut.l1acc_in.value) & VAL24_MASK,
   )


def acc_out_values(dut):
   return (
       int(dut.l0acc_out.value) & WORD_MASK,
       int(dut.l1acc_out.value) & WORD_MASK,
   )


def snapshot_debug(dut, actual):
   data = {"actual": actual}
   for name in (
       "l0x1",
       "l0x2",
       "l1x1",
       "l1x2",
       "l0acc_in",
       "l1acc_in",
       "l0acc_out",
       "l1acc_out",
       "l0dsp_casc_out",
       "l1dsp_casc_in",
   ):
      try:
         data[name] = int(getattr(dut, name).value)
      except AttributeError:
         pass
   return data


def is_nonzero_tuple(value: tuple[int, ...]) -> bool:
   return any(v != 0 for v in value)


def observe_queue(*, actual: tuple[int, ...], pending: list[Expected],
                  observed_latencies: list[int], cycle: int) -> bool:
   if pending and actual == pending[0].expected:
      exp = pending.pop(0)
      observed_latencies.append(cycle - exp.issue_cycle + 1)
      return True
   return False


async def run_stream_test(
    dut,
    *,
    cycles: int,
    drive_cycle: Callable[[int], Expected | None],
    read_actual: Callable[[object], tuple[int, ...]],
    queues: dict[str, list[Expected]],
    debug_name: str,
):
   observed = {name: [] for name in queues}
   debug_log = []
   last_actual = None

   for cycle in range(cycles):
      exp = drive_cycle(cycle)
      if exp is not None:
         if exp.phase not in queues:
            raise RuntimeError(f"{debug_name}: no queue for phase {exp.phase!r}")
         queues[exp.phase].append(exp)

      await xu_edge(dut)
      await ReadOnly()

      last_actual = read_actual(dut)
      if is_nonzero_tuple(last_actual):
         debug_log.append({"cycle": cycle, **snapshot_debug(dut, last_actual)})

      for phase, pending in queues.items():
         if observe_queue(
             actual=last_actual,
             pending=pending,
             observed_latencies=observed[phase],
             cycle=cycle,
         ):
            break

      await Timer(1, unit="step")

   for phase, pending in queues.items():
      assert_no_pending(f"{debug_name}:{phase}", pending, last_actual=last_actual, debug=debug_log)

   return observed


def check_latency(name: str, observed: list[int], expected: int | None = None):
   if not observed:
      raise AssertionError(f"{name}: no matching transactions observed")

   unique = sorted(set(observed))
   if len(unique) != 1:
      raise AssertionError(f"{name}: latency varied: {observed}")

   measured = unique[0]
   if expected is not None and measured != expected:
      raise AssertionError(f"{name}: expected latency {expected}, got {measured}")

   cocotb.log.info(f"{name}: observed latency = {measured} {CLK_NAME} cycles")


def assert_no_pending(name: str, pending: list[Expected], *, last_actual=None, debug=None):
   if not pending:
      return

   exp = pending[0]
   raise AssertionError(f"{name}: expected transaction not observed\n"
                        f"issue_cycle={exp.issue_cycle} phase={exp.phase}\n"
                        f"expected={exp.expected}\n"
                        f"last_actual={last_actual}\n"
                        f"meta={exp.meta}\n"
                        f"debug={debug}")
