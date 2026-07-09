import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ReadOnly, RisingEdge, Timer

HALF_MASK = (1 << 18) - 1
WORD_MASK = (1 << 36) - 1
MODE2_MASK = (1 << 24) - 1


def pack_word(high18, low18):
   return (((high18 & HALF_MASK) << 18) | (low18 & HALF_MASK)) & WORD_MASK


def sign_extend_18b(value):
   value &= HALF_MASK
   return value | (0xFC0000 if value & (1 << 17) else 0)


def sign_extend_mode4_upper(value):
   value &= MODE2_MASK
   upper = (value >> 17) & 0x7F
   return upper | (0x3FF80 if value & (1 << 23) else 0)


def mode2_slices(p_a, p_b):
   return (
      (p_a >> 12) & MODE2_MASK,
      ((p_a & 0xFFF) << 12) | (p_b & 0xFFF),
      (p_b >> 12) & MODE2_MASK,
   )


def mode0_expected(p_a, p_b):
   return (
      (p_a >> 18) & HALF_MASK,
      p_a & HALF_MASK,
      (p_b >> 18) & HALF_MASK,
      p_b & HALF_MASK,
   )


def mode1_high_expected(p_a, p_b):
   return (
      sign_extend_18b(p_a >> 18),
      (p_a >> 18) & HALF_MASK,
      sign_extend_18b(p_b >> 18),
      (p_b >> 18) & HALF_MASK,
   )


def mode1_low_expected(previous_p_a, current_p_a, previous_p_b, current_p_b):
   return (
      sign_extend_18b(previous_p_a),
      current_p_a & HALF_MASK,
      sign_extend_18b(previous_p_b),
      current_p_b & HALF_MASK,
   )


def mode2_expected(p_a, p_b, slice_sel):
   slice1, slice2, slice3 = mode2_slices(p_a, p_b)
   if slice_sel == 0:
      l0, l1 = slice1, slice2
   elif slice_sel == 1:
      l0, l1 = slice2, slice3
   else:
      l0, l1 = slice3, slice1
   return (
      (l0 >> 18) & 0x3F,
      l0 & HALF_MASK,
      (l1 >> 18) & 0x3F,
      l1 & HALF_MASK,
   )


def mode3_expected(p_a, p_b, slice_sel):
   slice1, slice2, slice3 = mode2_slices(p_a, p_b)
   if slice_sel == 0:
      l0x1 = slice1
      l0x2 = sign_extend_mode4_upper(slice2)
      l1x1 = slice1
      l1x2 = slice2 & HALF_MASK
   elif slice_sel == 1:
      l0x1 = slice2
      l0x2 = sign_extend_mode4_upper(slice3)
      l1x1 = slice2
      l1x2 = slice3 & HALF_MASK
   else:
      l0x1 = slice3
      l0x2 = sign_extend_mode4_upper(slice1)
      l1x1 = slice3
      l1x2 = slice1 & HALF_MASK
   return (l0x1, l0x2, l1x1, l1x2)


async def reset_dut(dut):
   cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
   dut.rst.value = 1
   dut.pA.value = 0
   dut.pB.value = 0
   dut.mode.value = 0
   dut.mode1_sel_low.value = 0
   dut.slice_sel_24bit.value = 0
   for _ in range(2):
      await RisingEdge(dut.clk)
   dut.rst.value = 0
   await RisingEdge(dut.clk)
   await ReadOnly()
   assert_outputs(dut, (0, 0, 0, 0), "reset")
   await Timer(1, unit="step")


async def drive_and_check(dut, *, p_a, p_b, mode, mode1_low, slice_sel, expected, name):
   dut.pA.value = p_a
   dut.pB.value = p_b
   dut.mode.value = mode
   dut.mode1_sel_low.value = mode1_low
   dut.slice_sel_24bit.value = slice_sel
   await RisingEdge(dut.clk)
   await ReadOnly()
   assert_outputs(dut, expected, name)
   await Timer(1, unit="step")


def assert_outputs(dut, expected, name):
   actual = (
      int(dut.l0x1.value),
      int(dut.l0x2.value),
      int(dut.l1x1.value),
      int(dut.l1x2.value),
   )
   if actual != expected:
      raise AssertionError(
         f"{name}: lane input mismatch\n"
         f"expected l0x1=0x{expected[0]:06x} l0x2=0x{expected[1]:05x} "
         f"l1x1=0x{expected[2]:06x} l1x2=0x{expected[3]:05x}\n"
         f"actual   l0x1=0x{actual[0]:06x} l0x2=0x{actual[1]:05x} "
         f"l1x1=0x{actual[2]:06x} l1x2=0x{actual[3]:05x}"
      )


@cocotb.test()
async def test_lane_input_logic_all_modes(dut):
   await reset_dut(dut)

   p_a0 = pack_word(0x01234, 0x05678)
   p_b0 = pack_word(0x2abcd, 0x1fedc)
   await drive_and_check(
      dut,
      p_a=p_a0,
      p_b=p_b0,
      mode=0,
      mode1_low=0,
      slice_sel=0,
      expected=mode0_expected(p_a0, p_b0),
      name="mode 0 18-bit pass",
   )

   p_a1 = pack_word(0x3ff00, 0x00022)
   p_b1 = pack_word(0x00180, 0x3fedd)
   await drive_and_check(
      dut,
      p_a=p_a1,
      p_b=p_b1,
      mode=1,
      mode1_low=0,
      slice_sel=0,
      expected=mode1_high_expected(p_a1, p_b1),
      name="mode 1 high-half signed pair",
   )

   p_a2 = pack_word(0x00044, 0x3ff55)
   p_b2 = pack_word(0x3fc00, 0x00066)
   await drive_and_check(
      dut,
      p_a=p_a2,
      p_b=p_b2,
      mode=1,
      mode1_low=1,
      slice_sel=0,
      expected=mode1_low_expected(p_a1 & HALF_MASK, p_a2 & HALF_MASK, p_b1 & HALF_MASK, p_b2 & HALF_MASK),
      name="mode 1 low-half signed pair",
   )

   mode2_cases = [
      (0, 0x123456789, 0x0abcdef01),
      (1, 0x001002003, 0x004005006),
      (2, 0x3fffffffe, 0x000000001),
   ]
   for slice_sel, p_a, p_b in mode2_cases:
      await drive_and_check(
         dut,
         p_a=p_a,
         p_b=p_b,
         mode=2,
         mode1_low=0,
         slice_sel=slice_sel,
         expected=mode2_expected(p_a, p_b, slice_sel),
         name=f"mode 2 24-bit slice {slice_sel}",
      )

   mode3_cases = [
      (0, 0x100001234, 0x000abcdef),
      (1, 0x00f0e0d0c, 0x3f0001000),
      (2, 0x3aa55aa55, 0x055aa55aa),
   ]
   for slice_sel, p_a, p_b in mode3_cases:
      await drive_and_check(
         dut,
         p_a=p_a,
         p_b=p_b,
         mode=3,
         mode1_low=0,
         slice_sel=slice_sel,
         expected=mode3_expected(p_a, p_b, slice_sel),
         name=f"mode 3 24-bit fma split {slice_sel}",
      )
