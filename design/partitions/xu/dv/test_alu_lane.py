from collections import deque

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ReadOnly, RisingEdge, Timer

LANE_LATENCY = 5

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

def pack_dsp_casc(*, PC=0, MULTSIGN=0, CARRYCASC=0):
   return (((PC & 0xFFFFFFFFFFFF) << 2) |
           ((MULTSIGN & 0x1) << 1) |
           ((CARRYCASC & 0x1) << 0))

def drive_all(value, *signals):
   for sig in signals:
      sig.value = value


def signal_int(signal):
   return int(signal.value)


def signal_text(signal):
   try:
      value = signal_int(signal)
   except ValueError:
      return str(signal.value)
   return f"0x{value:x} ({value})"


def assert_signal_eq(signal, expected, name):
   try:
      actual = signal_int(signal)
   except ValueError as err:
      raise AssertionError(f"{name}: expected 0x{expected:x}, got {signal.value}") from err
   assert actual == expected, f"{name}: expected 0x{expected:x}, got {signal_text(signal)}"


async def start_delayed_clock(signal, period_ns, delay_ns=0):
   if delay_ns:
      await Timer(delay_ns, unit="ns")
   await Clock(signal, period_ns, unit="ns").start()


def start_tdm_clocks(dut):
   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_in_clk, 10, unit="ns").start())
   cocotb.start_soon(start_delayed_clock(dut.fab_out_clk, 10))


def clear_datapath(dut):
   dut.X1.value = 0
   dut.X2.value = 0
   dut.AccIn1.value = 0
   dut.AccIn2.value = 0


def lane_snapshot(dut):
   return (f"X1={signal_text(dut.X1)} "
           f"X2={signal_text(dut.X2)} "
           f"AccIn1={signal_text(dut.AccIn1)} "
           f"AccIn2={signal_text(dut.AccIn2)} "
           f"Y1={signal_text(dut.Y1)} "
           f"Y2={signal_text(dut.Y2)}")


@cocotb.test()
async def test_18b_add(dut):
   cocotb.log.info(f"dut = {dut}")

   expected_y1 = deque()
   expected_y2 = deque()

   test_data = [
   #    X1       X2      AccIn1  AccIn2
       (0x000000, 0x00000, 0x00000, 0x00000),
       (0x000001, 0x00002, 0x00001, 0x00001),
       (0x000003, 0x00004, 0x00000, 0x00001),
       (0x000005, 0x00006, 0x00001, 0x00001),
       (0x000007, 0x00008, 0x00000, 0x00001),
       (0x000009, 0x0000A, 0x00001, 0x00001),
       (0x00000B, 0x0000C, 0x00000, 0x00001),
       (0x00000D, 0x0000E, 0x00000, 0x00001),
       (0x00000F, 0x00010, 0x00001, 0x00001),
   ]

   start_tdm_clocks(dut)

   dut.dsp_rst.value = 1
   dut.fab_in_rst.value = 1
   dut.fab_out_rst.value = 1
   dut.alu_ctl.value = 0
   dut.dsp_control.value = 0
   dut.dsp_casc_in.value = 0
   clear_datapath(dut)

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

   dut.dsp_rst.value = 0
   dut.fab_in_rst.value = 0
   dut.fab_out_rst.value = 0
   dut.dsp_control.value = pack_dsp_ctl(
       INMODE=0,
       ALUMODE=0,
       OPMODE=0b0001111,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )
   dut.dsp_casc_in.value = pack_dsp_casc(PC=51966)

   # prev_acc1 = 0
   # prev_acc2 = 0

   for cycle, test_input in enumerate(test_data):
      X1, X2, AccIn1, AccIn2 = test_input
      dut.X1.value = X1
      dut.X2.value = X2
      dut.AccIn1.value = AccIn1
      dut.AccIn2.value = AccIn2

      expected_y1.append((X1 + AccIn1) & 0x3FFFF)
      expected_y2.append((X2 + AccIn2) & 0x3FFFF)

      await RisingEdge(dut.fab_in_clk)
      await ReadOnly()

      if cycle >= LANE_LATENCY:
         exp_y1 = expected_y1.popleft()
         exp_y2 = expected_y2.popleft()
         try:
            assert_signal_eq(dut.Y1, exp_y1, "Y1")
            assert_signal_eq(dut.Y2, exp_y2, "Y2")
         except AssertionError as err:
            raise AssertionError(f"{err}\n{lane_snapshot(dut)}") from err
      await Timer(1, unit="step")

   for _ in range(LANE_LATENCY):
      await RisingEdge(dut.fab_in_clk)
      await ReadOnly()

      exp_y1 = expected_y1.popleft()
      exp_y2 = expected_y2.popleft()
      assert_signal_eq(dut.Y1, exp_y1, "Y1 (pipeline)") if exp_y1 is not None else None
      assert_signal_eq(dut.Y2, exp_y2, "Y2 (pipeline)") if exp_y2 is not None else None
      await Timer(1, unit="step")


@cocotb.test()
async def test_18b_fma(dut):
   cocotb.log.info(f"dut = {dut}")

   expected_y1 = deque()

   test_data = [
   #    X1       X2      AccIn1  AccIn2
       (0x000000, 0x00000, 0x00000, 0x00100),
       (0x000100, 0x00002, 0x00000, 0x00000),
       (0x000300, 0x00004, 0x00000, 0x00100),
       (0x000500, 0x00006, 0x00000, 0x00000),
       (0x000700, 0x00008, 0x00000, 0x00100),
       (0x000900, 0x0000A, 0x00000, 0x00000),
       (0x000B00, 0x0000C, 0x00000, 0x00100),
       (0x000D00, 0x0000E, 0x00000, 0x00000),
       (0x000F00, 0x00010, 0x00000, 0x00100),
   ]

   start_tdm_clocks(dut)

   dut.dsp_rst.value = 1
   dut.fab_in_rst.value = 1
   dut.fab_out_rst.value = 1
   dut.alu_ctl.value = 1
   dut.dsp_control.value = 0
   dut.dsp_casc_in.value = 0
   clear_datapath(dut)

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

   dut.dsp_rst.value = 0
   dut.fab_in_rst.value = 0
   dut.fab_out_rst.value = 0
   dut.dsp_control.value = pack_dsp_ctl(
       INMODE=0b10001,
       ALUMODE=0,
       OPMODE=0b0110101,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )
   dut.dsp_casc_in.value = pack_dsp_casc(PC=47806)

   for cycle, test_input in enumerate(test_data):
      X1, X2, AccIn1, AccIn2 = test_input
      dut.X1.value = X1
      dut.X2.value = X2
      dut.AccIn1.value = AccIn1
      dut.AccIn2.value = AccIn2

      expected_y1.append((((X1 * X2 >> 8) + AccIn2)) & 0x3FFFF)

      await RisingEdge(dut.fab_in_clk)
      await ReadOnly()

      if cycle >= LANE_LATENCY:
         exp_y1 = expected_y1.popleft()
         try:
            assert_signal_eq(dut.Y1, exp_y1, "Y1")
         except AssertionError as err:
            raise AssertionError(f"{err}\n{lane_snapshot(dut)}") from err
      await Timer(1, unit="step")

   for _ in range(LANE_LATENCY):
      await RisingEdge(dut.fab_in_clk)
      await ReadOnly()

      exp_y1 = expected_y1.popleft()
      assert_signal_eq(dut.Y1, exp_y1, "Y1 (pipeline)") if exp_y1 is not None else None
      await Timer(1, unit="step")


@cocotb.test()
async def test_24b_add(dut):
   cocotb.log.info(f"dut = {dut}")

   expected_y1 = deque()

   test_data = [
   #    X1       X2      AccIn1  AccIn2
       (0x00003F, 0x3FFFF, 0x0003F, 0x3FFFF),
       (0x000001, 0x00000, 0x00000, 0x00100),
       (0x000100, 0x00002, 0x00000, 0x00100),
       (0x000301, 0x00004, 0x00000, 0x00100),
       (0x000500, 0x00006, 0x00000, 0x00100),
       (0x000701, 0x00008, 0x00000, 0x00100),
       (0x000900, 0x0000A, 0x00000, 0x00100),
       (0x000B01, 0x0000C, 0x00000, 0x00100),
       (0x000D00, 0x0000E, 0x00000, 0x00100),
       (0x000F01, 0x00010, 0x00000, 0x00100),
   ]

   start_tdm_clocks(dut)

   dut.dsp_rst.value = 1
   dut.fab_in_rst.value = 1
   dut.fab_out_rst.value = 1
   dut.alu_ctl.value = 2
   dut.dsp_control.value = 0
   dut.dsp_casc_in.value = 0
   clear_datapath(dut)

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

   dut.dsp_rst.value = 0
   dut.fab_in_rst.value = 0
   dut.fab_out_rst.value = 0
   dut.dsp_control.value = pack_dsp_ctl(
       INMODE=0,
       ALUMODE=0,
       OPMODE=0b0001111,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )
   dut.dsp_casc_in.value = pack_dsp_casc(PC=48879)


   for cycle, test_input in enumerate(test_data):
      X1, X2, AccIn1, AccIn2 = test_input
      dut.X1.value = X1
      dut.X2.value = X2
      dut.AccIn1.value = AccIn1
      dut.AccIn2.value = AccIn2

      expected_y1.append(((X1 << 18) + X2 + (AccIn1 << 18) + (AccIn2)) & 0xFFFFFF)

      await RisingEdge(dut.fab_in_clk)
      await ReadOnly()

      if cycle >= LANE_LATENCY:
         exp_y1 = expected_y1.popleft() & 0xFFFFFF
         exp_y2 = exp_y1 & 0x3FFFF
         try:
            actual_y1 = int(dut.Y1.value) & 0xFFFFFF
            actual_y2 = int(dut.Y2.value) & 0xFFFFFF
            assert actual_y1 == exp_y1 >> 18, f"Y1: expected 0x{exp_y1:x}, got 0x{actual_y1:x}"
            assert actual_y2 == exp_y2, f"Y2: expected 0x{exp_y2:x}, got 0x{actual_y2:x}"
         except AssertionError as err:
            raise AssertionError(f"{err}\n{lane_snapshot(dut)}") from err
      await Timer(1, unit="step")

   while expected_y1:
      await RisingEdge(dut.fab_in_clk)
      await ReadOnly()

      exp_y1 = expected_y1.popleft() & 0xFFFFFF
      exp_y2 = exp_y1 & 0x3FFFF
      actual_y1 = int(dut.Y1.value) & 0xFFFFFF
      actual_y2 = int(dut.Y2.value) & 0xFFFFFF
      assert actual_y1 == exp_y1 >> 18, f"Y1: expected 0x{exp_y1:x}, got 0x{actual_y1:x}"
      assert actual_y2 == exp_y2, f"Y2: expected 0x{exp_y2:x}, got 0x{actual_y2:x}"
      await Timer(1, unit="step")
