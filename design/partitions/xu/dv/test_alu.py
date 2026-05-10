from collections import deque

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ReadOnly, RisingEdge, Timer


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


def alu_snapshot(dut):
   return (f"Lane 0 X1={signal_text(dut.l0x1)} "
           f"Lane 0 X2={signal_text(dut.l0x2)} "
           f"Lane 0 AccIn1={signal_text(dut.l0acc1)} "
           f"Lane 0 AccIn2={signal_text(dut.l0acc2)} "
           f"Lane 0 Y1={signal_text(dut.l0y1)} "
           f"Lane 0 Y2={signal_text(dut.l0y2)} "
           f"Lane 1 X1={signal_text(dut.l1x1)} "
           f"Lane 1 X2={signal_text(dut.l1x2)} "
           f"Lane 1 AccIn1={signal_text(dut.l1acc1)} "
           f"Lane 1 AccIn2={signal_text(dut.l1acc2)} "
           f"Lane 1 Y1={signal_text(dut.l1y1)} "
           f"Lane 1 Y2={signal_text(dut.l1y2)} ")


@cocotb.test()
async def test_18b_add(dut):
   cocotb.log.info(f"dut = {dut}")

   PIPELINE_LATENCY = 5
   expected_l0y1 = deque()
   expected_l0y2 = deque()
   expected_l1y1 = deque()
   expected_l1y2 = deque()

   test_data = [
   #    l0x1      l0x2     l0acc1   l0acc2    l1x1     l1x2    l1acc1    l1acc2
       (0x000000, 0x00000, 0x00000, 0x00000, 0x000000, 0x00000, 0x00000, 0x00000),
       (0x000001, 0x00002, 0x00001, 0x00001, 0x000001, 0x00000, 0x00001, 0x00000),
       (0x000003, 0x00004, 0x00000, 0x00001, 0x000002, 0x00000, 0x00002, 0x00000),
       (0x000005, 0x00006, 0x00001, 0x00001, 0x000003, 0x00000, 0x00003, 0x00000),
       (0x000007, 0x00008, 0x00000, 0x00001, 0x000000, 0x00001, 0x00000, 0x00003),
       (0x000009, 0x0000A, 0x00001, 0x00001, 0x000000, 0x00002, 0x00000, 0x00002),
       (0x00000B, 0x0000C, 0x00000, 0x00001, 0x000000, 0x00003, 0x00000, 0x00001),
       (0x00000D, 0x0000E, 0x00000, 0x00001, 0x000000, 0x00000, 0x00000, 0x00000),
       (0x00000F, 0x00010, 0x00001, 0x00001, 0x000000, 0x00000, 0x00000, 0x00000),
   ]

   # Create a clock signal
   cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 0
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0

   await RisingEdge(dut.clk)

   dut.rst.value = 0
   dut.l0dsp_control.value = pack_dsp_ctl(
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
   dut.l1dsp_control.value = pack_dsp_ctl(
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

   for cycle, test_input in enumerate(test_data):
      l0x1, l0x2, l0acc1, l0acc2, l1x1, l1x2, l1acc1, l1acc2 = test_input
      dut.l0x1.value = l0x1
      dut.l0x2.value = l0x2
      dut.l0acc1.value = l0acc1
      dut.l0acc2.value = l0acc2

      dut.l1x1.value = l1x1
      dut.l1x2.value = l1x2
      dut.l1acc1.value = l1acc1
      dut.l1acc2.value = l1acc2

      expected_l0y1.append((l0x1 + l0acc1) & 0x3FFFF)
      expected_l0y2.append((l0x2 + l0acc2) & 0x3FFFF)
      expected_l1y1.append((l1x1 + l1acc1) & 0x3FFFF)
      expected_l1y2.append((l1x2 + l1acc2) & 0x3FFFF)

      await RisingEdge(dut.clk)

      if cycle >= PIPELINE_LATENCY:
         exp_l0y1 = expected_l0y1.popleft()
         exp_l0y2 = expected_l0y2.popleft()
         exp_l1y1 = expected_l1y1.popleft()
         exp_l1y2 = expected_l1y2.popleft()
         try:
            assert_signal_eq(dut.l0y1, exp_l0y1, "l0y1")
            assert_signal_eq(dut.l0y2, exp_l0y2, "l0y2")
            assert_signal_eq(dut.l1y1, exp_l1y1, "l1y1")
            assert_signal_eq(dut.l1y2, exp_l1y2, "l1y2")
         except AssertionError as err:
            raise AssertionError(f"{err}\n{alu_snapshot(dut)}") from err

   for _ in range(PIPELINE_LATENCY):
      await ReadOnly()

      exp_l0y1 = expected_l0y1.popleft()
      exp_l0y2 = expected_l0y2.popleft()
      exp_l1y1 = expected_l1y1.popleft()
      exp_l1y2 = expected_l1y2.popleft()
      assert_signal_eq(dut.l0y1, exp_l0y1, "l0y1 (pipeline)") if exp_l0y1 is not None else None
      assert_signal_eq(dut.l0y2, exp_l0y2, "l0y2 (pipeline)") if exp_l0y2 is not None else None
      assert_signal_eq(dut.l1y1, exp_l1y1, "l1y1 (pipeline)") if exp_l1y1 is not None else None
      assert_signal_eq(dut.l1y2, exp_l1y2, "l1y2 (pipeline)") if exp_l1y2 is not None else None
      await RisingEdge(dut.clk)


@cocotb.test()
async def test_18b_fma(dut):
   cocotb.log.info(f"dut = {dut}")

   PIPELINE_LATENCY = 6
   expected_l0y1 = deque()
   expected_l1y1 = deque()

   test_data = [
   #    l0x1        l0x2   l0acc1   l0acc2    l1x1     l1x2     l1acc1   l1acc2
       (0x000000, 0x00000, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000100, 0x00002, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000300, 0x00004, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000500, 0x00006, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000700, 0x00008, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000900, 0x0000A, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000B00, 0x0000C, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000D00, 0x0000E, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000F00, 0x00010, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
   ]

   # Create a clock signal
   cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 1
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0

   await RisingEdge(dut.clk)

   dut.rst.value = 0
   dut.l0dsp_control.value = pack_dsp_ctl(
       INMODE=0,
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
   dut.l1dsp_control.value = pack_dsp_ctl(
       INMODE=0,
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

   for cycle, test_input in enumerate(test_data):
      l0x1, l0x2, _, l0acc2, l1x1, l1x2, _, l1acc2 = test_input
      dut.l0x1.value = l0x1
      dut.l0x2.value = l0x2
      dut.l0acc2.value = l0acc2

      dut.l1x1.value = l1x1
      dut.l1x2.value = l1x2
      dut.l1acc2.value = l1acc2

      expected_l0y1.append((((l0x1 * l0x2 >> 8) + l0acc2)) & 0x3FFFF)
      expected_l1y1.append((((l1x1 * l1x2 >> 8) + l1acc2)) & 0x3FFFF)

      await RisingEdge(dut.clk)

      if cycle >= PIPELINE_LATENCY:
         exp_l0y1 = expected_l0y1.popleft()
         exp_l1y1 = expected_l1y1.popleft()
         try:
            assert_signal_eq(dut.l0y1, exp_l0y1, "l0y1")
            assert_signal_eq(dut.l1y1, exp_l1y1, "l1y1")
         except AssertionError as err:
            raise AssertionError(f"{err}\n{alu_snapshot(dut)}") from err

   for _ in range(PIPELINE_LATENCY):
      await ReadOnly()

      exp_l0y1 = expected_l0y1.popleft()
      assert_signal_eq(dut.l0y1, exp_l0y1, "l0y1 (pipeline)") if exp_l0y1 is not None else None
      exp_l1y1 = expected_l1y1.popleft()
      assert_signal_eq(dut.l1y1, exp_l1y1, "l1y1 (pipeline)") if exp_l1y1 is not None else None
      await RisingEdge(dut.clk)


@cocotb.test()
async def test_24b_add(dut):
   cocotb.log.info(f"dut = {dut}")

   PIPELINE_LATENCY = 5
   expected_l0y = deque()
   expected_l1y = deque()

   test_data = [
   #    l0x1      l0x2     l0acc1   l0acc2    l1x1     l1x2    l1acc1    l1acc2
       (0x000001, 0x00000, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000100, 0x00002, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000301, 0x00004, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000500, 0x00006, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000701, 0x00008, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000900, 0x0000A, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000B01, 0x0000C, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000D00, 0x0000E, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000F01, 0x00010, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
   ]

   # Create a clock signal
   cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 2
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0

   await RisingEdge(dut.clk)

   dut.rst.value = 0
   dut.l0dsp_control.value = pack_dsp_ctl(
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
   dut.l1dsp_control.value = pack_dsp_ctl(
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

   for cycle, test_input in enumerate(test_data):
      l0x1, l0x2, l0acc1, l0acc2, l1x1, l1x2, l1acc1, l1acc2 = test_input
      dut.l0x1.value = l0x1
      dut.l0x2.value = l0x2
      dut.l0acc1.value = l0acc1
      dut.l0acc2.value = l0acc2

      dut.l1x1.value = l1x1
      dut.l1x2.value = l1x2
      dut.l1acc1.value = l1acc1
      dut.l1acc2.value = l1acc2

      expected_l0y.append(((l0x1 << 18) + l0x2 + (l0acc1 << 18) + (l0acc2)) & 0xFFFFFF)
      expected_l1y.append(((l1x1 << 18) + l1x2 + (l1acc1 << 18) + (l1acc2)) & 0xFFFFFF)

      await RisingEdge(dut.clk)

      if cycle >= PIPELINE_LATENCY:
         exp_l0y = expected_l0y.popleft() & 0xFFFFFF
         exp_l0y1 = exp_l0y >> 18
         exp_l0y2 = exp_l0y & 0x3FFFF

         exp_l1y = expected_l1y.popleft() & 0xFFFFFF
         exp_l1y1 = exp_l1y >> 18
         exp_l1y2 = exp_l1y & 0x3FFFF
         try:
            actual_l0y1 = int(dut.l0y1.value) & 0xFFFFFF
            actual_l0y2 = int(dut.l0y2.value) & 0xFFFFFF
            assert actual_l0y1 == exp_l0y1, f"Lane 0 Y1: expected 0x{exp_l0y1:x}, got 0x{actual_l0y1:x}"
            assert actual_l0y2 == exp_l0y2, f"Lane 0 Y2: expected 0x{exp_l0y2:x}, got 0x{actual_l0y2:x}"

            actual_l1y1 = int(dut.l1y1.value) & 0xFFFFFF
            actual_l1y2 = int(dut.l1y2.value) & 0xFFFFFF
            assert actual_l1y1 == exp_l1y1, f"Lane 1 Y1: expected 0x{exp_l1y1:x}, got 0x{actual_l1y1:x}"
            assert actual_l1y2 == exp_l1y2, f"Lane 1 Y2: expected 0x{exp_l1y2:x}, got 0x{actual_l1y2:x}"
         except AssertionError as err:
            raise AssertionError(f"{err}\n{alu_snapshot(dut)}") from err

   for _ in range(PIPELINE_LATENCY):
      await ReadOnly()

      exp_l0y = expected_l0y.popleft() & 0xFFFFFF
      exp_l0y1 = exp_l0y >> 18
      exp_l0y2 = exp_l0y & 0x3FFFF
      actual_l0y1 = int(dut.l0y1.value) & 0xFFFFFF
      actual_l0y2 = int(dut.l0y2.value) & 0xFFFFFF
      assert actual_l0y1 == exp_l0y1, f"Lane 0 Y1: expected 0x{exp_l0y1:x}, got 0x{actual_l0y1:x}"
      assert actual_l0y2 == exp_l0y2, f"Lane 0 Y2: expected 0x{exp_l0y2:x}, got 0x{actual_l0y2:x}"

      exp_l1y = expected_l1y.popleft() & 0xFFFFFF
      exp_l1y1 = exp_l1y >> 18
      exp_l1y2 = exp_l1y & 0x3FFFF
      actual_l1y1 = int(dut.l1y1.value) & 0xFFFFFF
      actual_l1y2 = int(dut.l1y2.value) & 0xFFFFFF
      assert actual_l1y1 == exp_l1y1, f"Lane 1 Y1: expected 0x{exp_l1y1:x}, got 0x{actual_l1y1:x}"
      assert actual_l1y2 == exp_l1y2, f"Lane 1 Y2: expected 0x{exp_l1y2:x}, got 0x{actual_l1y2:x}"
      await RisingEdge(dut.clk)


@cocotb.test()
async def test_24b_fma(dut):
   cocotb.log.info(f"dut = {dut}")

   PIPELINE_LATENCY = 6
   expected_y = deque()

   # (a * bhi) + (a * blo + acc1acc2)
   test_data = [
   #    l0x1           l0x2     l0acc1   l0acc2    l1x1     l1x2    l1acc1    l1acc2
       (0x000001 << 6, 0x00000, 0x00000, 0x00100, 0x000001, 0x00000, 0x00000, 0x00100),
       (0x000001 << 6, 0x00001, 0x00000, 0x00100, 0x000001, 0x00000, 0x00000, 0x00100),
       (0x000001 << 6, 0x00001, 0x00000, 0x00100, 0x000001, 0x00001, 0x00000, 0x00100),
       (0x020000 << 6, 0x00000, 0x00000, 0x00100, 0x020000, 0x00000, 0x00000, 0x00100),
       (0x000001 << 6, 0x00000, 0x00000, 0x00100, 0x000001, 0x00000, 0x00000, 0x00100),
       (0x000001 << 6, 0x00000, 0x00000, 0x00100, 0x000001, 0x00000, 0x00000, 0x00100),
       (0x000001 << 6, 0x00000, 0x00000, 0x00100, 0x000001, 0x00000, 0x00000, 0x00100),
   ]

   # Create a clock signal
   cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 3
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0

   await RisingEdge(dut.clk)

   dut.rst.value = 0
   dut.l0dsp_control.value = pack_dsp_ctl(
       INMODE=0,
       ALUMODE=0,
       OPMODE=0b0010101,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )
   dut.l1dsp_control.value = pack_dsp_ctl(
       INMODE=0,
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

   for cycle, test_input in enumerate(test_data):
      l0x1, l0x2, l0acc1, l0acc2, l1x1, l1x2, l1acc1, l1acc2 = test_input
      dut.l0x1.value = l0x1
      dut.l0x2.value = l0x2
      dut.l0acc1.value = l0acc1
      dut.l0acc2.value = l0acc2

      dut.l1x1.value = l1x1
      dut.l1x2.value = l1x2
      dut.l1acc1.value = l1acc1
      dut.l1acc2.value = l1acc2

      acc24 = ((l1acc1 << 18) + l1acc2) & 0xFFFFFF
      lane1_full = l1x1 * l1x2 + (acc24 << 8)
      lane0_full = l0x1 * l0x2 + lane1_full
      expected_y.append((lane0_full >> 8) & 0xFFFFFF)

      await RisingEdge(dut.clk)

      if cycle >= PIPELINE_LATENCY:
         exp_l0y = expected_y.popleft() & 0xFFFFFF
         exp_l0y1 = exp_l0y >> 18
         exp_l0y2 = exp_l0y & 0x3FFFF

         try:
            actual_l0y1 = int(dut.l0y1.value) & 0xFFFFFF
            actual_l0y2 = int(dut.l0y2.value) & 0xFFFFFF
            assert actual_l0y1 == exp_l0y1, f"Lane 0 Y1: expected 0x{exp_l0y1:x}, got 0x{actual_l0y1:x}"
            assert actual_l0y2 == exp_l0y2, f"Lane 0 Y2: expected 0x{exp_l0y2:x}, got 0x{actual_l0y2:x}"

         except AssertionError as err:
            raise AssertionError(f"{err}\n{alu_snapshot(dut)}") from err

   for _ in range(PIPELINE_LATENCY):
      await ReadOnly()

      exp_l0y = expected_y.popleft() & 0xFFFFFF
      exp_l0y1 = exp_l0y >> 18
      exp_l0y2 = exp_l0y & 0x3FFFF
      actual_l0y1 = int(dut.l0y1.value) & 0xFFFFFF
      actual_l0y2 = int(dut.l0y2.value) & 0xFFFFFF
      assert actual_l0y1 == exp_l0y1, f"Lane 0 Y1: expected 0x{exp_l0y1:x}, got 0x{actual_l0y1:x}"
      assert actual_l0y2 == exp_l0y2, f"Lane 0 Y2: expected 0x{exp_l0y2:x}, got 0x{actual_l0y2:x}"

      await RisingEdge(dut.clk)
