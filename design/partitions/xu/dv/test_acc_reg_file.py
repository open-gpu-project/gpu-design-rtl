"""Unit test for the accumulator LUTRAM register file."""

import random

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ReadOnly, RisingEdge, Timer

DEPTH = 32
WIDTH = 36
MASK = (1 << WIDTH) - 1


async def setup(dut):
   cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
   dut.we.value = 0
   dut.waddr.value = 0
   dut.wdata.value = 0
   dut.raddr.value = 0
   await RisingEdge(dut.clk)


async def write_slot(dut, addr, value):
   dut.we.value = 1
   dut.waddr.value = addr
   dut.wdata.value = value & MASK
   await RisingEdge(dut.clk)
   dut.we.value = 0


async def read_slot(dut, addr):
   dut.raddr.value = addr
   await Timer(1, unit="ns")
   return int(dut.rdata.value) & MASK


@cocotb.test()
async def test_write_readback_all_slots(dut):
   await setup(dut)

   rng = random.Random(0)
   values = [rng.getrandbits(WIDTH) for _ in range(DEPTH)]

   for addr, value in enumerate(values):
      await write_slot(dut, addr, value)

   for addr in rng.sample(range(DEPTH), DEPTH):
      actual = await read_slot(dut, addr)
      assert actual == values[addr], (f"slot {addr}: expected 0x{values[addr]:09x}, "
                                      f"got 0x{actual:09x}")


@cocotb.test()
async def test_read_during_write_returns_old_data(dut):
   await setup(dut)

   await write_slot(dut, 5, 0xAAAAAAAAA)

   dut.raddr.value = 5
   dut.we.value = 1
   dut.waddr.value = 5
   dut.wdata.value = 0x555555555
   await ReadOnly()
   assert int(dut.rdata.value) == 0xAAAAAAAAA, "async read must show pre-write data"

   await RisingEdge(dut.clk)
   dut.we.value = 0
   actual = await read_slot(dut, 5)
   assert actual == 0x555555555, f"expected new data after the edge, got 0x{actual:09x}"


@cocotb.test()
async def test_we_low_holds_and_slots_independent(dut):
   await setup(dut)

   await write_slot(dut, 3, 0x123456789)
   await write_slot(dut, 4, 0xFEDCBA987)

   dut.waddr.value = 3
   dut.wdata.value = 0xDEADBEEF0
   for _ in range(3):
      await RisingEdge(dut.clk)

   assert await read_slot(dut, 3) == 0x123456789, "we=0 must hold slot contents"
   assert await read_slot(dut, 4) == 0xFEDCBA987, "neighbouring slot must be unaffected"
