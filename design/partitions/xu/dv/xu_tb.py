"""Shared cocotb helpers for XU tests.

Tests (test_xu_programs.py and friends) should contain test intent only; this
file contains boring DUT IO, packing, clock/reset, and debug helpers.

All XU control -- including the BRAM addresses and enables -- travels in the
single xu_ctl struct driven on xu_ctl_in; only the BRAM write data (DI_A/DI_B)
is a separate port.
"""

from __future__ import annotations

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, Timer

HALF_W = 18
WORD_W = 36
HALF_MASK = (1 << HALF_W) - 1
WORD_MASK = (1 << WORD_W) - 1
VAL24_MASK = (1 << 24) - 1
BRAM36_MASK = (1 << 36) - 1

CLK_NAME = "dsp_clk_div2"
BRAM_IDLE_ADDR = 0x3FF
ACC_DEPTH = 32


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
    addr_a=BRAM_IDLE_ADDR,
    en_a=1,
    we_a=0,
    addr_b=BRAM_IDLE_ADDR,
    en_b=1,
    we_b=0,
    l0dsp_control=0,
    l1dsp_control=0,
    mode=0,
    slice_sel_24bit=0,
    mode1_sel_low=0,
    acc_raddr=0,
    acc_waddr=0,
    acc_we=0,
    pred_raddr=0,
    pred_waddr=0,
    pred_we=0,
    pred_enable=0,
    pred_invert=0,
    pred_cond=0,
    zero_bram_operands=0,
    l0_wb_valid=0,
    l1_wb_valid=0,
    wb_we_a=0,
    wb_we_b=0,
    wb_addr_a=0,
    wb_addr_b=0,
):
   """Pack the xu_priv::xu_ctl struct (144 bits, MSB-first field order):

    ADDR_A[143:134] EN_A[133] WE_A[132:129]
    ADDR_B[128:119] EN_B[118] WE_B[117:114]
    l0dsp_control[113:89] l1dsp_control[88:64] mode[63:61]
    slice_sel_24bit[60:59] mode1_sel_low[58] acc_raddr[57:53]
    acc_waddr[52:48] acc_we[47]
    pred_raddr[46:42] pred_waddr[41:37] pred_we[36]
    pred_enable[35] pred_invert[34] pred_cond[33:31]
    zero_bram_operands[30]
    l0_wb_valid[29] l1_wb_valid[28] WB_WE_A[27:24] WB_WE_B[23:20]
    WB_ADDR_A[19:10] WB_ADDR_B[9:0]
    """
   return (((addr_a & 0x3FF) << 134) | ((en_a & 0x1) << 133) | ((we_a & 0xF) << 129) |
           ((addr_b & 0x3FF) << 119) | ((en_b & 0x1) << 118) | ((we_b & 0xF) << 114) |
           ((l0dsp_control & ((1 << 25) - 1)) << 89) | ((l1dsp_control & ((1 << 25) - 1)) << 64) |
           ((mode & 0x7) << 61) | ((slice_sel_24bit & 0x3) << 59) | ((mode1_sel_low & 0x1) << 58) |
           ((acc_raddr & 0x1F) << 53) | ((acc_waddr & 0x1F) << 48) | ((acc_we & 0x1) << 47) |
           ((pred_raddr & 0x1F) << 42) | ((pred_waddr & 0x1F) << 37) | ((pred_we & 0x1) << 36) |
           ((pred_enable & 0x1) << 35) | ((pred_invert & 0x1) << 34) | ((pred_cond & 0x7) << 31) |
           ((zero_bram_operands & 0x1) << 30) | ((l0_wb_valid & 0x1) << 29) |
           ((l1_wb_valid & 0x1) << 28) | ((wb_we_a & 0xF) << 24) |
           ((wb_we_b & 0xF) << 20) | ((wb_addr_a & 0x3FF) << 10) |
           (wb_addr_b & 0x3FF))


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
   dut.DI_A.value = 0
   dut.DI_B.value = 0


async def reset_dut(dut):
   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.dsp_clk_div2, 10, unit="ns").start())

   init_xu_inputs(dut)
   for _ in range(3):
      await xu_edge(dut)

   dut.rst.value = 0
   await xu_edge(dut)
   await Timer(1, unit="step")


def lane_outputs(dut):
   return (
       int(dut.l0y1.value) & HALF_MASK,
       int(dut.l0y2.value) & HALF_MASK,
       int(dut.l1y1.value) & HALF_MASK,
       int(dut.l1y2.value) & HALF_MASK,
   )


def acc_in_values(dut):
   return (
       ((int(dut.l0acc_in_hi.value) & HALF_MASK) << 18) |
       (int(dut.l0acc_in_lo.value) & HALF_MASK),
       ((int(dut.l1acc_in_hi.value) & HALF_MASK) << 18) |
       (int(dut.l1acc_in_lo.value) & HALF_MASK),
   )


def acc_out_values(dut):
   return (
       ((int(dut.l0acc_out_hi.value) & HALF_MASK) << 18) |
       (int(dut.l0acc_out_lo.value) & HALF_MASK),
       ((int(dut.l1acc_out_hi.value) & HALF_MASK) << 18) |
       (int(dut.l1acc_out_lo.value) & HALF_MASK),
   )


def snapshot_debug(dut, actual):
   data = {"actual": actual}
   for name in (
       "l0x1",
       "l0x2",
       "l1x1",
       "l1x2",
       "l0acc_in_hi",
       "l0acc_in_lo",
       "l1acc_in_hi",
       "l1acc_in_lo",
       "l0acc_out_hi",
       "l0acc_out_lo",
       "l1acc_out_hi",
       "l1acc_out_lo",
       "l0dsp_casc_out",
       "l1dsp_casc_in",
   ):
      try:
         data[name] = int(getattr(dut, name).value)
      except AttributeError:
         pass
   return data
