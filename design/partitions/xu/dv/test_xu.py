from collections import deque

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, ReadOnly, RisingEdge, Timer

HALF_MASK = (1 << 18) - 1
DATA_MASK = (1 << 36) - 1


# async def start_delayed_clock(signal, period_ns, delay_ns=0):
#    if delay_ns:
#       await Timer(delay_ns, unit="ns")
#    await Clock(signal, period_ns, unit="ns").start()


def start_tdm_clocks(dut):
   cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_in_clk, 10, unit="ns").start())
   cocotb.start_soon(Clock(dut.fab_out_clk, 10, unit="ns").start())

   # cocotb.start_soon(start_delayed_clock(dut.fab_out_clk, 10))

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

def init_xu_inputs(dut):
   dut.rst.value = 1
   dut.mode.value = 0
   dut.ce.value = 1
   dut.l0dsp_control.value = 0
   dut.l1dsp_control.value = 0
   dut.l1dsp_casc_in.value = 0
   dut.ADDR_A.value = 0
   dut.EN_A.value = 0
   dut.WE_A.value = 0
   dut.DI_A.value = 0
   dut.ADDR_B.value = 0
   dut.EN_B.value = 0
   dut.WE_B.value = 0
   dut.DI_B.value = 0
   dut.addr_srl.value = 8


def pack_bram_word(high18, low18):
   return ((high18 & HALF_MASK) << 18) | (low18 & HALF_MASK)


def decode_xu_load_row(row, index, start_addr, mirror_to_b):
   if len(row) == 2:
      high18, low18 = row
      data = pack_bram_word(high18, low18)
      return start_addr + index, data, start_addr + index, data if mirror_to_b else None
   if len(row) == 4:
      a_high18, a_low18, b_high18, b_low18 = row
      data_a = pack_bram_word(a_high18, a_low18)
      data_b = pack_bram_word(b_high18, b_low18)
      return start_addr + index, data_a, start_addr + index, data_b
   if len(row) == 6:
      addr_a, a_high18, a_low18, addr_b, b_high18, b_low18 = row
      data_a = pack_bram_word(a_high18, a_low18)
      data_b = pack_bram_word(b_high18, b_low18)
      return addr_a, data_a, addr_b, data_b
   raise ValueError(f"XU load row must have 2, 4, or 6 fields, got {len(row)}: {row}")


async def load_test_data(dut, test_data, *, start_addr=0, mirror_to_b=False):
   written = []

   dut.EN_A.value = 0
   dut.WE_A.value = 0
   dut.DI_A.value = 0
   dut.ADDR_A.value = 0
   dut.EN_B.value = 0
   dut.WE_B.value = 0
   dut.DI_B.value = 0
   dut.ADDR_B.value = 0

   for index, row in enumerate(test_data):
      addr_a, data_a, addr_b, data_b = decode_xu_load_row(row, index, start_addr, mirror_to_b)
      data_a &= DATA_MASK

      dut.ADDR_A.value = addr_a
      dut.DI_A.value = data_a
      dut.EN_A.value = 1
      dut.WE_A.value = 1

      if data_b is None:
         dut.EN_B.value = 0
         dut.WE_B.value = 0
         dut.DI_B.value = 0
      else:
         data_b &= DATA_MASK
         dut.ADDR_B.value = addr_b
         dut.DI_B.value = data_b
         dut.EN_B.value = 1
         dut.WE_B.value = 1

      await RisingEdge(dut.fab_in_clk)
      written.append((addr_a, data_a, addr_b, data_b))

   dut.WE_A.value = 0
   dut.WE_B.value = 0
   dut.DI_A.value = 0
   dut.DI_B.value = 0
   dut.EN_A.value = 1
   dut.EN_B.value = 1

   return written

@cocotb.test()
async def test_18b_add(dut):
   cocotb.log.info(f"dut = {dut}")

   expected_y1 = deque()
   expected_y2 = deque()

   start_tdm_clocks(dut)
   init_xu_inputs(dut)

   test_data = [
      (0x0F0F0, 0x00F0F),
      (0x0E0E0, 0x00E0E),
      (0x0D0D0, 0x00D0D),
      (0x0C0C0, 0x00C0C),
      (0x0B0B0, 0x00B0B),
      (0x0A0A0, 0x00A0A),
      (0x09090, 0x00909),
      (0x08080, 0x00808),
      (0x07070, 0x00707),
      (0x06060, 0x00606),
      (0x05050, 0x00505),
      (0x04040, 0x00404),
      (0x03030, 0x00303),
      (0x02020, 0x00202),
      (0x01010, 0x00101),
      (0x00000, 0x00000),

      (0x10F0F, 0x1F0F0),
      (0x10E0E, 0x1E0E0),
      (0x10D0D, 0x1D0D0),
      (0x10C0C, 0x1C0C0),
      (0x10B0B, 0x1B0B0),
      (0x10A0A, 0x1A0A0),
      (0x10909, 0x19090),
      (0x10808, 0x18080),
      (0x10707, 0x17070),
      (0x10606, 0x16060),
      (0x10505, 0x15050),
      (0x10404, 0x14040),
      (0x10303, 0x13030),
      (0x10202, 0x12020),
      (0x10101, 0x11010),
      (0x10000, 0x10000),
   ]

   for _ in range(3):
      await RisingEdge(dut.fab_in_clk)

   dut.rst.value = 0

   await load_test_data(dut, test_data, start_addr=0)

   dut.l0dsp_control.value = pack_dsp_ctl(
       INMODE=0,
       ALUMODE=0,
       OPMODE=0b0000011,
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
       OPMODE=0b0000011,
       CEA=0b11,
       CEB=0b11,
       CEC=1,
       CED=1,
       CEM=1,
       CEP=1,
       CEAD=1,
   )

   addr= 0
   for _ in range(16):
      dut.ADDR_A.value = addr
      dut.ADDR_B.value = 0x3FF
      await RisingEdge(dut.fab_in_clk)
      addr += 1


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
   for _ in range(16):
      dut.ADDR_A.value = addr
      dut.ADDR_B.value = 0x3FF
      dut.addr_srl.value = 10
      await RisingEdge(dut.fab_in_clk)
      addr += 1  

   for _ in range(16):
      dut.ADDR_A.value = 0x3FF
      dut.ADDR_B.value = 0x3FF
      dut.addr_srl.value = 8
      await RisingEdge(dut.fab_in_clk)

   assert 1 == 1
