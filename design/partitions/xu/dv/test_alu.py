from collections import deque

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, ReadOnly, RisingEdge, Timer

LANE_LATENCY = 4


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


def dsp_casc_pc(casc):
   return (signal_int(casc) >> 2) & 0xFFFFFFFFFFFF


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


async def wait_alu_cycle(dut):
   await RisingEdge(dut.fab_in_clk)
   # await FallingEdge(dut.fab_out_clk)
   await ReadOnly()


def sign_extend(value, bits):
   sign_bit = 1 << (bits - 1)
   return (value ^ sign_bit) - sign_bit


def expected_18b_fma(x1, x2, acc2):
   product = sign_extend(x1, 24) * sign_extend(x2, 18)
   accum = sign_extend(acc2, 18) << 8
   return ((product + accum) >> 8) & 0x3FFFF

def expected_24b_fma(a, b, c):
   product = sign_extend(a, 24) * sign_extend(b, 24)
   accum = sign_extend(c, 24) << 8
   return ((product + accum) >> 8) & 0xFFFFFF

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

   expected_l0y1 = deque()
   expected_l0y2 = deque()
   expected_l1y1 = deque()
   expected_l1y2 = deque()

   test_data = [
   #    l0x1      l0x2     l0acc1   l0acc2    l1x1     l1x2    l1acc1    l1acc2
       (0xFFFFFF, 0x3FFFF, 0x3FFFF, 0x3FFFF, 0xFFFFFF, 0x3FFFF, 0x3FFFF, 0x3FFFF),
       (0x000000, 0x00000, 0x00000, 0x00000, 0x000000, 0x00000, 0x00000, 0x00000),
       (0x000001, 0x00000, 0x00000, 0x00001, 0x000000, 0x00000, 0x00001, 0x00001),
       (0xFFFFFF, 0x00001, 0x00001, 0x3FFFF, 0x111111, 0x33333, 0x22222, 0x34444),
       (0x0F0F0F, 0x00001, 0x10101, 0x00001, 0xF0F0F0, 0x00001, 0x01010, 0x00003),
       (0x000009, 0x0000A, 0x00001, 0x00001, 0x000000, 0x00002, 0x00000, 0x00002),
       (0x00000B, 0x0000C, 0x00000, 0x00001, 0x000000, 0x00003, 0x00000, 0x00001),
       (0x00000D, 0x0000E, 0x00000, 0x00001, 0x000000, 0x00000, 0x00000, 0x00000),
       (0x00000F, 0x00010, 0x00001, 0x00001, 0x000000, 0x00000, 0x00000, 0x00000),
   ]

   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_in_clk, 10, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_out_clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 0
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0
   dut.l0x1.value = 0
   dut.l0x2.value = 0
   dut.l0acc1.value = 0
   dut.l0acc2.value = 0
   dut.l1x1.value = 0
   dut.l1x2.value = 0
   dut.l1acc1.value = 0
   dut.l1acc2.value = 0

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

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
   dut.l1dsp_casc_in.value = pack_dsp_casc(PC=223195676199678)


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

      await wait_alu_cycle(dut)

      if cycle >= LANE_LATENCY:
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
      await Timer(1, unit="step")

   for _ in range(LANE_LATENCY):
      await wait_alu_cycle(dut)

      exp_l0y1 = expected_l0y1.popleft()
      exp_l0y2 = expected_l0y2.popleft()
      exp_l1y1 = expected_l1y1.popleft()
      exp_l1y2 = expected_l1y2.popleft()
      assert_signal_eq(dut.l0y1, exp_l0y1, "l0y1 (pipeline)") if exp_l0y1 is not None else None
      assert_signal_eq(dut.l0y2, exp_l0y2, "l0y2 (pipeline)") if exp_l0y2 is not None else None
      assert_signal_eq(dut.l1y1, exp_l1y1, "l1y1 (pipeline)") if exp_l1y1 is not None else None
      assert_signal_eq(dut.l1y2, exp_l1y2, "l1y2 (pipeline)") if exp_l1y2 is not None else None
      await Timer(1, unit="step")


@cocotb.test()
async def test_18b_fma(dut):
   cocotb.log.info(f"dut = {dut}")

   expected_l0y1 = deque()
   expected_l1y1 = deque()

   test_data = [
   #    l0x1        l0x2   l0acc1   l0acc2    l1x1     l1x2     l1acc1   l1acc2
       (0xFFFFFF, 0x3FFFF, 0x00000, 0x3FFFF, 0xFFFFFF, 0x3FFFF, 0x00000, 0x3FFFF),
       (0x000000, 0x00000, 0x00000, 0x00000, 0x0F0F0F, 0x10101, 0x00000, 0x10101),
       (0x00BEEF, 0x0CAFE, 0x00000, 0x0DEAD, 0x00DEED, 0x3FEED, 0x00000, 0x1DEAF),
       (0x000300, 0x00004, 0x00001, 0x00100, 0x000000, 0x00000, 0x3FFFF, 0x00100),
       (0x000500, 0x00006, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000700, 0x00008, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000900, 0x0000A, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000B00, 0x0000C, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000D00, 0x0000E, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
   ]

   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_in_clk, 10, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_out_clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 1
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0
   dut.l0x1.value = 0
   dut.l0x2.value = 0
   dut.l0acc1.value = 0
   dut.l0acc2.value = 0
   dut.l1x1.value = 0
   dut.l1x2.value = 0
   dut.l1acc1.value = 0
   dut.l1acc2.value = 0

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

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
   dut.l1dsp_casc_in.value = pack_dsp_casc(PC=209936909844207)


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

      expected_l0y1.append(expected_18b_fma(l0x1, l0x2, l0acc2))
      expected_l1y1.append(expected_18b_fma(l1x1, l1x2, l1acc2))

      await wait_alu_cycle(dut)

      if cycle >= LANE_LATENCY:
         exp_l0y1 = expected_l0y1.popleft()
         exp_l1y1 = expected_l1y1.popleft()
         try:
            assert_signal_eq(dut.l0y1, exp_l0y1, "l0y1")
            assert_signal_eq(dut.l1y1, exp_l1y1, "l1y1")
         except AssertionError as err:
            raise AssertionError(f"{err}\n{alu_snapshot(dut)}") from err
      await Timer(1, unit="step")

   for _ in range(LANE_LATENCY):
      await wait_alu_cycle(dut)

      exp_l0y1 = expected_l0y1.popleft()
      assert_signal_eq(dut.l0y1, exp_l0y1, "l0y1 (pipeline)") if exp_l0y1 is not None else None
      exp_l1y1 = expected_l1y1.popleft()
      assert_signal_eq(dut.l1y1, exp_l1y1, "l1y1 (pipeline)") if exp_l1y1 is not None else None
      await Timer(1, unit="step")


@cocotb.test()
async def test_24b_add(dut):
   cocotb.log.info(f"dut = {dut}")

   expected_l0y = deque()
   expected_l1y = deque()

   test_data = [
   #    l0x1      l0x2     l0acc1   l0acc2    l1x1     l1x2    l1acc1    l1acc2
       (0xFFFFFF, 0x00000, 0x0003F, 0x3FFFF, 0xFFFFFF, 0x00000, 0x0003F, 0x3FFFF),
       (0x000000, 0x00000, 0x00000, 0x00000, 0x000000, 0x00000, 0x00000, 0x00000),
       (0x000301, 0x00004, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000500, 0x00006, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000701, 0x00008, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000900, 0x0000A, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000B01, 0x0000C, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000D00, 0x0000E, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
       (0x000F01, 0x00010, 0x00000, 0x00100, 0x000000, 0x00000, 0x00000, 0x00100),
   ]

   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_in_clk, 10, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_out_clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 2
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0
   dut.l0x1.value = 0
   dut.l0x2.value = 0
   dut.l0acc1.value = 0
   dut.l0acc2.value = 0
   dut.l1x1.value = 0
   dut.l1x2.value = 0
   dut.l1acc1.value = 0
   dut.l1acc2.value = 0

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

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

      await wait_alu_cycle(dut)

      if cycle >= LANE_LATENCY:
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
      await Timer(1, unit="step")

   while expected_l0y:
      await wait_alu_cycle(dut)

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
      await Timer(1, unit="step")


@cocotb.test()
async def test_24b_fma(dut):
   cocotb.log.info(f"dut = {dut}")

   PIPELINE_LATENCY = LANE_LATENCY
   expected_y = deque()

   test_data = [
   #    a,       b,       c
       (0x000200,0x000300,0x000004),
       (0x000400,0x000500,0x000004),
       (0x000400,0x000500,0x000004),
       (0x000200,0x030000,0x000004),
       (0xFFFFFF,0xFFFFFF,0xFFFFFF)
   ]

   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_in_clk, 10, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_out_clk, 10, unit="ns").start())

   dut.rst.value = 1
   dut.mode.value = 3
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0
   dut.l0x1.value = 0
   dut.l0x2.value = 0
   dut.l0acc1.value = 0
   dut.l0acc2.value = 0
   dut.l1x1.value = 0
   dut.l1x2.value = 0
   dut.l1acc1.value = 0
   dut.l1acc2.value = 0

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

   dut.rst.value = 0
   dut.l0dsp_control.value = pack_dsp_ctl(
       INMODE=0,
       ALUMODE=0,
       OPMODE=0b1010101,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )
   dut.l1dsp_control.value = pack_dsp_ctl(
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
   dut.l1dsp_casc_in.value = pack_dsp_casc(PC=223195676199678)


   for cycle, test_input in enumerate(test_data):
      a,b,c= test_input
      l0x1 = a
      l0x2 = (sign_extend(b, 24) >> 17) & 0x3FFFF
      l0acc1 = 0
      l0acc2 = 0
      l1x1 = a
      l1x2 = b & 0x1FFFF
      l1acc1 = c >> 18
      l1acc2 = c & 0x3FFFF

      dut.l0x1.value = l0x1
      dut.l0x2.value = l0x2
      dut.l0acc1.value = l0acc1
      dut.l0acc2.value = l0acc2

      dut.l1x1.value = l1x1
      dut.l1x2.value = l1x2
      dut.l1acc1.value = l1acc1
      dut.l1acc2.value = l1acc2

      expected_y.append(expected_24b_fma(a,b,c))

      await wait_alu_cycle(dut)

      if cycle >= PIPELINE_LATENCY:
         exp_y = expected_y.popleft() & 0xFFFFFF
         exp_l0y2 = exp_y >> 9
         exp_l1y2 = exp_y & 0x1FF

         try:
            actual_l0y2 = int(dut.l0y2.value) & 0xFFFFFF
            actual_l1y2 = int(dut.l1y2.value) & 0xFFFFFF
            assert actual_l0y2 == exp_l0y2, f"Lane 0 Y1: expected 0x{exp_l0y2:x}, got 0x{actual_l0y2:x}"
            assert actual_l1y2 == exp_l1y2, f"Lane 0 Y2: expected 0x{exp_l1y2:x}, got 0x{actual_l1y2:x}"

            # actual_l1y1 = int(dut.l1y1.value) & 0xFFFFFF
            # actual_l1y2 = int(dut.l1y2.value) & 0xFFFFFF
            # assert actual_l1y1 == exp_l1y1, f"Lane 1 Y1: expected 0x{exp_l1y1:x}, got 0x{actual_l1y1:x}"
            # assert actual_l1y2 == exp_l1y2, f"Lane 1 Y2: expected 0x{exp_l1y2:x}, got 0x{actual_l1y2:x}"

         except AssertionError as err:
            raise AssertionError(f"{err}\n{alu_snapshot(dut)}") from err
      await Timer(1, unit="step")

   while expected_y:
      await wait_alu_cycle(dut)

      exp_y = expected_y.popleft() & 0xFFFFFF
      exp_l0y2 = exp_y >> 9
      exp_l1y2 = exp_y & 0x1FF
      actual_l0y2 = int(dut.l0y2.value) & 0xFFFFFF
      actual_l1y2 = int(dut.l1y2.value) & 0xFFFFFF
      assert actual_l0y2 == exp_l0y2, f"Lane 0 Y2: expected 0x{exp_l0y2:x}, got 0x{actual_l0y2:x}"
      assert actual_l1y2 == exp_l1y2, f"Lane 1 Y2: expected 0x{exp_l1y2:x}, got 0x{actual_l1y2:x}"

      # exp_l1y = expected_l1y.popleft() & 0xFFFFFF
      # exp_l1y1 = exp_l1y >> 18
      # exp_l1y2 = exp_l1y & 0x3FFFF
      # actual_l1y1 = int(dut.l1y1.value) & 0xFFFFFF
      # actual_l1y2 = int(dut.l1y2.value) & 0xFFFFFF
      # assert actual_l1y1 == exp_l1y1, f"Lane 1 Y1: expected 0x{exp_l1y1:x}, got 0x{actual_l1y1:x}"
      # assert actual_l1y2 == exp_l1y2, f"Lane 1 Y2: expected 0x{exp_l1y2:x}, got 0x{actual_l1y2:x}"

      await Timer(1, unit="step")
