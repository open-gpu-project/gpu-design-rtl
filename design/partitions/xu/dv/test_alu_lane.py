# This file is public domain, it can be freely copied without restrictions.
# SPDX-License-Identifier: CC0-1.0
# Simple tests for an adder module


import cocotb


@cocotb.test()
async def adder_basic_test(dut):
   """Test for 5 + 10"""

   # A = 5
   # B = 10

   # dut.A.value = A
   # dut.B.value = B

   # await Timer(2, unit="ns")
   # print(f"A={A} B={B} SUM={dut.SUM.value}")
   # assert dut.SUM.value == A + B, "Adder result is incorrect: {dut.SUM.value} != {A + B}"
