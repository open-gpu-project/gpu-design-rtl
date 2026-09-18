"""Program-based XU tests.

Each test writes a short program of high-level ops; xu_asm lowers it to
per-cycle control words and exact-cycle output predictions, so no timing
knowledge lives in this file (see xu_timing for the pipeline spec).
"""

import random
from pathlib import Path

import cocotb
import pytest

from design.partitions.xu.dv import xu_timing as T
from design.partitions.xu.dv import xu_vectors
from design.partitions.xu.dv.xu_asm import (
    ADD18,
    ADD24,
    FMA18,
    FMA24,
    NOP,
    AsmError,
    Program,
    Slot,
    assemble,
    run_program,
)
from design.partitions.xu.dv.xu_models import (
    make_mode2_slices,
    make_mode3_slices,
    pack18_pair,
    pack72_from_slices,
)

# BRAM layout bases shared by the tests below.
ACC_A = 0  # lane 0 acc rows
ACC_B = 8  # lane 1 acc rows
SRC_A = 16  # lane 0 operand rows
SRC_B = 24  # lane 1 operand rows
LO_72 = 32  # 72-bit gearbox rows, low words
HI_72 = 96  # 72-bit gearbox rows, high words

@cocotb.test()
async def my_own_test(dut):
   prog = Program()
   prog.set_bram_word(0, pack18_pair(1, 2))
   prog.set_bram_word(1, pack18_pair(3, 4))
   prog.ops.append(ADD18(addr_a=0, addr_b=1, dst=0))
   await run_program(dut, prog)

def program_with_18b_rows(acc_pairs, src_pairs):
   """Load acc rows at ACC_A/ACC_B and operand rows at SRC_A/SRC_B."""
   prog = Program()
   for k, (l0, l1) in enumerate(acc_pairs):
      prog.set_bram_word(ACC_A + k, pack18_pair(*l0))
      prog.set_bram_word(ACC_B + k, pack18_pair(*l1))
   for k, (l0, l1) in enumerate(src_pairs):
      prog.set_bram_word(SRC_A + k, pack18_pair(*l0))
      prog.set_bram_word(SRC_B + k, pack18_pair(*l1))
   return prog


def load_72_rows(prog, rows, *, base_index=0):
   for k, (s1, s2, s3) in enumerate(rows):
      lo, hi = pack72_from_slices(s1, s2, s3)
      prog.set_bram_word(LO_72 + base_index + k, lo)
      prog.set_bram_word(HI_72 + base_index + k, hi)


def writeback_acc_to_bram(slot, addr_a, addr_b):
   """Separate writeback instruction: compute 0 + acc, then commit to BRAM."""
   return ADD18(
      acc=Slot(slot),
      zero_bram_operands=1,
      l0_wb_valid=1,
      l1_wb_valid=1,
      wb_addr_a=addr_a,
      wb_addr_b=addr_b,
   )


@cocotb.test()
async def test_add18_stream_and_readback(dut):
   """Mode 0: preload 8 slots, then add against them from BRAM."""
   acc_pairs = [((0x00100 + k, 0x00010 + k), (0x00200 + k, 0x00020 + k)) for k in range(8)]
   src_pairs = [((0x01000 + k, 0x02000 + k), (0x03000 + k, 0x04000 + k)) for k in range(8)]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   for k in range(8):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=k))
   for k in range(8):
      prog.ops.append(ADD18(addr_a=SRC_A + k, addr_b=SRC_B + k, acc=Slot(k), dst=8 + k))

   await run_program(dut, prog)


@cocotb.test()
async def test_add18_accumulate_chains(dut):
   """Six interleaved same-slot accumulation chains at full issue rate.

    Op j reads the slot written by op j-6, exactly MIN_RAW_DISTANCE.
    """
   acc_pairs = [((0x00001 + k, 0x00002 + k), (0x00003 + k, 0x00004 + k)) for k in range(8)]
   src_pairs = [((0x00010 * (k + 1), 0x00007 + k), (0x00020 * (k + 1), 0x00009 + k))
                for k in range(8)]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   n_chains = T.MIN_RAW_DISTANCE
   rounds = 3
   for k in range(n_chains):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=k))
   for r in range(rounds):
      for k in range(n_chains):
         src = (r + k) % 8
         prog.ops.append(
             ADD18(addr_a=SRC_A + src, addr_b=SRC_B + src, acc=Slot(k), dst=k))

   await run_program(dut, prog)


@cocotb.test()
async def test_min_raw_distance(dut):
   """A consumer at exactly MIN_RAW_DISTANCE reads the committed slot."""
   acc_pairs = [((0x00111, 0x00222), (0x00333, 0x00444))]
   src_pairs = [((0x01111, 0x02222), (0x03333, 0x01234))]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   prog.ops.append(ADD18(addr_a=ACC_A, addr_b=ACC_B, dst=0))
   for _ in range(T.MIN_RAW_DISTANCE - 1):
      prog.ops.append(NOP())
   prog.ops.append(ADD18(addr_a=SRC_A, addr_b=SRC_B, acc=Slot(0), dst=1))

   await run_program(dut, prog)


@cocotb.test()
async def test_add18_acc_to_bram_writeback(dut):
   """Write an ADD18 result to acc, then write that acc value back to BRAM.

   The second op zeros the BRAM operand path and computes 0 + acc. Its lane
   results are written to BRAM through the delayed writeback controls, and a
   final ADD18 reads those destination rows back through the normal BRAM path.
   """
   wb_a = 48
   wb_b = 64
   prog = Program()
   for k in range(8):
      prog.set_bram_word(ACC_A + k, pack18_pair(0x00123 + k, 0x00045 + k))
      prog.set_bram_word(ACC_B + k, pack18_pair(0x00234 + k, 0x00056 + k))

   for k in range(8):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=k))
   for k in range(8):
      prog.ops.append(writeback_acc_to_bram(k, wb_a + k, wb_b + k))
   for _ in range(8):
      prog.ops.append(NOP())
   for k in range(8):
      prog.ops.append(ADD18(addr_a=wb_a + k, addr_b=wb_b + k, dst=k))

   await run_program(dut, prog)


@cocotb.test()
async def test_fma18_acc_to_bram_writeback(dut):
   """Compute both FMA18 banks, then commit full acc rows back to BRAM."""
   wb_a = 80
   wb_b = 96
   acc_pairs = [
       ((0x00110 + k, 0x00021 + k), (0x00220 + k, 0x00041 + k))
       for k in range(8)
   ]
   src_pairs = [
       ((0x00030 + k, 0x00050 + k), (0x00070 + k, 0x00090 + k))
       for k in range(8)
   ]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   for k in range(8):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=k))
   # High FMA uses high(current row) * high(next row).
   for k in range(8):
      prog.ops.append(
          FMA18(
              addr_a=SRC_A + k,
              addr_b=SRC_B + k,
              acc=Slot(k),
              dst=k,
          ))
   # Low FMA uses low(previous row) * low(current row).
   for k in range(8):
      prog.ops.append(
          FMA18(
              addr_a=SRC_A + k,
              addr_b=SRC_B + k,
              acc=Slot(k),
              dst=k,
              sel_low=1,
          ))
   for k in range(8):
      prog.ops.append(writeback_acc_to_bram(k, wb_a + k, wb_b + k))
   for _ in range(8):
      prog.ops.append(NOP())
   for k in range(8):
      prog.ops.append(ADD18(addr_a=wb_a + k, addr_b=wb_b + k, dst=k))

   await run_program(dut, prog)


@cocotb.test()
async def test_fma18_high_low_alternation(dut):
   """Mode 1 with alternating high/low operand taps against preloaded slots."""
   acc_pairs = [((0, 0x00003 + 2 * k), (0, 0x00019 + 2 * k)) for k in range(8)]
   # Operand rows: high ops use the high halves of rows N and N+1; low ops use
   # the low halves of rows N-1 and N.
   src_pairs = [((0x00100 + 0x20 * k, 0x00020 + 0x10 * k),
                 (0x00200 + 0x20 * k, 0x000A0 + 0x10 * k)) for k in range(8)]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   for k in range(8):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=k))
   for k in range(8):
      prog.ops.append(
          FMA18(addr_a=SRC_A + k, addr_b=SRC_B + k, sel_low=k & 1, acc=Slot(k)))

   await run_program(dut, prog)


@cocotb.test()
async def test_fma18_accumulate_chain(dut):
   """Mode 1 result written back to a slot and consumed by a later FMA.

    Covers the lane_output_logic mode-1 low-half writeback on both lanes.
    """
   acc_pairs = [((0, 0x00002), (0, 0x00005))]
   src_pairs = [((0x00300, 0), (0x00500, 0)), ((0x00004, 0), (0x00006, 0)),
                ((0x00700, 0), (0x00900, 0)), ((0x00008, 0), (0x0000A, 0))]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   prog.ops.append(ADD18(addr_a=ACC_A, addr_b=ACC_B, dst=0))
   for _ in range(T.MIN_RAW_DISTANCE - 1):
      prog.ops.append(NOP())
   # High-tap FMA: x1 from row SRC_A (this cycle), x2 from row SRC_A+1
   # (next cycle's address), so issue the address-carrying NOP right after.
   prog.ops.append(FMA18(addr_a=SRC_A, addr_b=SRC_B, acc=Slot(0), dst=1))
   prog.ops.append(NOP(addr_a=SRC_A + 1, addr_b=SRC_B + 1))
   for _ in range(T.MIN_RAW_DISTANCE - 2):
      prog.ops.append(NOP())
   prog.ops.append(FMA18(addr_a=SRC_A + 2, addr_b=SRC_B + 2, acc=Slot(1), dst=2))
   prog.ops.append(NOP(addr_a=SRC_A + 3, addr_b=SRC_B + 3))

   await run_program(dut, prog)


@cocotb.test()
async def test_add24_slice_rotations(dut):
   """Mode 2 through all three gearbox rotations, preload then accumulate."""
   prog = Program()

   preload = [(0x000003 + k, 0x000019 + k) for k in range(8)]
   addend = [(0x000100 + 0x20 * k, 0x000200 + 0x20 * k) for k in range(8)]
   sels = [k % 3 for k in range(8)]

   load_72_rows(prog, [
       make_mode2_slices(l0, l1, sels[k], dummy=0xAB0000 + k)
       for k, (l0, l1) in enumerate(preload)
   ],
                base_index=0)
   load_72_rows(prog, [
       make_mode2_slices(l0, l1, sels[k], dummy=0xCD0000 + k)
       for k, (l0, l1) in enumerate(addend)
   ],
                base_index=8)

   for k in range(8):
      prog.ops.append(
          ADD24(addr_a=LO_72 + k, addr_b=HI_72 + k, slice_sel=sels[k], dst=k))
   for k in range(8):
      prog.ops.append(
          ADD24(addr_a=LO_72 + 8 + k, addr_b=HI_72 + 8 + k, slice_sel=sels[k],
                acc=Slot(k), dst=8 + k))

   await run_program(dut, prog)


@cocotb.test()
async def test_fma24_rotations_and_consume(dut):
   """Mode 3 FMA through all rotations; ADD24 then consumes the FMA results.

    Covers the cascade, the both-lane result writeback, and reading a mode-3
    result back as a mode-2 operand.
    """
   prog = Program()

   acc_vals = [(0x000003 + k, 0x000003 + k) for k in range(8)]  # same both lanes
   ab_vals = [(0x000100 + 0x20 * k, 0x000020 + 0x10 * k) for k in range(8)]
   post_add = [(0x000700 + k, 0x000800 + k) for k in range(8)]
   sels = [k % 3 for k in range(8)]

   load_72_rows(prog, [
       make_mode2_slices(l0, l1, sels[k], dummy=0x110000 + k)
       for k, (l0, l1) in enumerate(acc_vals)
   ],
                base_index=0)
   load_72_rows(prog, [
       make_mode3_slices(a, b, sels[k], dummy=0x220000 + k)
       for k, (a, b) in enumerate(ab_vals)
   ],
                base_index=8)
   load_72_rows(prog, [
       make_mode2_slices(l0, l1, sels[k], dummy=0x330000 + k)
       for k, (l0, l1) in enumerate(post_add)
   ],
                base_index=16)

   for k in range(8):
      prog.ops.append(
          ADD24(addr_a=LO_72 + k, addr_b=HI_72 + k, slice_sel=sels[k], dst=k))
   for k in range(8):
      prog.ops.append(
          FMA24(addr_a=LO_72 + 8 + k, addr_b=HI_72 + 8 + k, slice_sel=sels[k],
                acc=Slot(k), dst=8 + k))
   for k in range(8):
      prog.ops.append(
          ADD24(addr_a=LO_72 + 16 + k, addr_b=HI_72 + 16 + k, slice_sel=sels[k],
                acc=Slot(8 + k), dst=16 + k))

   await run_program(dut, prog)


@cocotb.test()
async def test_add18_signed(dut):
   """Mode 0 with negative operands: two's-complement wrap in both halves.

    Covers -1 + 1 = 0, wrap at both 18-bit extremes, and negative results.
    """
   acc_pairs = [
       ((-1, -0x20000), (0x1FFFF, -5)),
       ((-0x20000, -1), (5, -0x1F000)),
       ((0x1FFFF, -0x100), (-1, -1)),
       ((-42, 42), (0x1F000, -0x20000)),
   ]
   src_pairs = [
       ((1, -1), (1, 5)),
       ((-1, 2), (-5, 0x1F000)),
       ((-0x20000, 0x100), (-1, 1)),
       ((-42, -43), (0x1000, -1)),
   ]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   for k in range(4):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=k))
   for _ in range(T.MIN_RAW_DISTANCE - 4):
      prog.ops.append(NOP())
   for k in range(4):
      prog.ops.append(ADD18(addr_a=SRC_A + k, addr_b=SRC_B + k, acc=Slot(k), dst=4 + k))

   await run_program(dut, prog)


@cocotb.test()
async def test_fma18_signed(dut):
   """Mode 1 with signed multiplicands and accumulators, both operand taps.

    Covers neg*pos, pos*neg, neg*neg, negative acc, and negative results
    (the >>8 must be an arithmetic shift).
    """
   acc_los = [(-2, -0x8000), (0x1FFFF, -1), (-0x100, 7), (3, -0x1F000),
              (-1, -1), (0x55, -0x55), (-0x4000, 0x4000), (1, 1)]
   acc_pairs = [((0, a), (0, b)) for a, b in acc_los]
   # High ops multiply hi(N) * hi(N+1); low ops multiply lo(N-1) * lo(N).
   src_pairs = [((-0x300 + 0x40 * k, 0x155 - 0x66 * k),
                 (0x2AA - 0x55 * k, -0x211 + 0x33 * k)) for k in range(8)]
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   for k in range(8):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=k))
   for k in range(8):
      prog.ops.append(
          FMA18(addr_a=SRC_A + k, addr_b=SRC_B + k, sel_low=k & 1, acc=Slot(k)))

   await run_program(dut, prog)


@cocotb.test()
async def test_add24_signed(dut):
   """Mode 2 with negative 24-bit operands through all slice rotations."""
   prog = Program()

   preload = [(-1, -0x800000), (0x7FFFFF, -1), (-0x1234, 0x7FFFFF),
              (-0x800000, -0x800000), (100, -100), (-0x400000, 0x3FFFFF)]
   addend = [(1, -1), (1, 0x7FFFFF), (0x1234, 1), (-1, -0x800000), (-200, 100),
             (-0x400000, 0x400000)]
   sels = [k % 3 for k in range(6)]

   load_72_rows(prog, [
       make_mode2_slices(l0, l1, sels[k], dummy=0xAB0000 + k)
       for k, (l0, l1) in enumerate(preload)
   ],
                base_index=0)
   load_72_rows(prog, [
       make_mode2_slices(l0, l1, sels[k], dummy=0xCD0000 + k)
       for k, (l0, l1) in enumerate(addend)
   ],
                base_index=8)

   for k in range(6):
      prog.ops.append(
          ADD24(addr_a=LO_72 + k, addr_b=HI_72 + k, slice_sel=sels[k], dst=k))
   for k in range(6):
      prog.ops.append(
          ADD24(addr_a=LO_72 + 8 + k, addr_b=HI_72 + 8 + k, slice_sel=sels[k],
                acc=Slot(k), dst=8 + k))

   await run_program(dut, prog)


@cocotb.test()
async def test_fma24_signed(dut):
   """Mode 3 with signed a, b and acc through all rotations.

    Covers sign extension into the DSP cascade and negative results split
    across the two lanes' Y2 packing.
    """
   prog = Program()

   acc_vals = [(-3, -3), (0x7FFFFF, 0x7FFFFF), (-0x800000, -0x800000), (1, 1),
               (-0x1000, -0x1000), (0, 0)]
   ab_vals = [(-0x1000, 0x14), (0x100, -0x20), (-0x40, -0x30), (0x7FFFFF, 2),
              (-1, -1), (0x400, -0x400)]
   sels = [k % 3 for k in range(6)]

   load_72_rows(prog, [
       make_mode2_slices(l0, l1, sels[k], dummy=0x110000 + k)
       for k, (l0, l1) in enumerate(acc_vals)
   ],
                base_index=0)
   load_72_rows(prog, [
       make_mode3_slices(a, b, sels[k], dummy=0x220000 + k)
       for k, (a, b) in enumerate(ab_vals)
   ],
                base_index=8)

   for k in range(6):
      prog.ops.append(
          ADD24(addr_a=LO_72 + k, addr_b=HI_72 + k, slice_sel=sels[k], dst=k))
   for k in range(6):
      prog.ops.append(
          FMA24(addr_a=LO_72 + 8 + k, addr_b=HI_72 + 8 + k, slice_sel=sels[k],
                acc=Slot(k), dst=8 + k))

   await run_program(dut, prog)


def random_program(rng: random.Random, *, n_ops=48, n_rows=48, n_slots=32) -> Program:
   """Constrained-random legal program: random ops, operands, slots and BRAM.

    Random 36-bit BRAM contents cover the signed value space of every mode.
    Register reads are only generated at legal RAW distances; the assembler
    re-checks legality when the program is lowered.
    """
   prog = Program()
   for addr in range(n_rows):
      prog.set_bram_word(addr, rng.getrandbits(36))

   # slot -> [l0_hi, l0_lo, l1_hi, l1_lo] last writer issue cycle.
   bank_writes: dict[int, list[int | None]] = {}

   def ready_slots(*banks):
      ready = []
      for slot, writes in bank_writes.items():
         if all(writes[b] is not None and i - writes[b] >= T.MIN_RAW_DISTANCE for b in banks):
            ready.append(slot)
      return ready

   for i in range(n_ops):
      kind = rng.choice(("add18", "fma18", "add24", "fma24", "nop"))
      if kind == "nop":
         prog.ops.append(NOP())
         continue
      sel_low = rng.randint(0, 1)
      if kind == "fma18":
         ready = ready_slots(1, 3) if sel_low else ready_slots(0, 2)
      else:
         ready = ready_slots(0, 1, 2, 3)
      kwargs = dict(
          addr_a=rng.randrange(n_rows),
          addr_b=rng.randrange(n_rows),
          acc=Slot(rng.choice(ready)) if ready and rng.random() < 0.7 else None,
          dst=rng.randrange(n_slots) if rng.random() < 0.8 else None,
      )
      if kind == "add18":
         op = ADD18(**kwargs)
      elif kind == "fma18":
         op = FMA18(**kwargs, sel_low=sel_low)
      elif kind == "add24":
         op = ADD24(**kwargs, slice_sel=rng.randrange(3))
      else:
         op = FMA24(**kwargs, slice_sel=rng.randrange(3))
      prog.ops.append(op)
      if op.dst is not None:
         writes = bank_writes.setdefault(op.dst, [None, None, None, None])
         if isinstance(op, FMA18):
            for b in ((1, 3) if op.sel_low else (0, 2)):
               writes[b] = i
         else:
            for b in range(4):
               writes[b] = i
   return prog


@cocotb.test()
async def test_random_programs(dut):
   """Constrained-random programs checked exact-cycle against the golden model."""
   for seed in range(8):
      prog = random_program(random.Random(seed))
      await run_program(dut, prog, name=f"test_random_programs_seed{seed}")


@cocotb.test()
async def test_eight_strand_round_robin(dut):
   """8 strands issued round-robin, each running ADD18 -> FMA18 -> ADD18.

    Strand s owns register slots {4s .. 4s+3} (slot = {strand[2:0], reg[1:0]})
    and issues in cycle 8*round + s, so every same-strand dependency is
    distance 8 > MIN_RAW_DISTANCE and needs no scheduling knowledge.

    This schedule also exposes the FMA18 high-tap coupling: x2 comes from the
    row addressed one cycle later, i.e. the *next strand's* fetch (strand 7
    takes the first row of the following round). The golden model follows the
    address stream, so the check verifies the hardware does exactly that.
    """
   n = 8
   # Round 0 rows: accumulator seeds. Round 1 rows: FMA multiplicands in the
   # high halves. Round 2 rows: final addend.
   acc_pairs = [((0x00100 + s, 0x00010 + s), (0x00200 + s, 0x00020 + s)) for s in range(n)]
   fma_pairs = [((0x00300 + 0x10 * s, 0), (0x00500 + 0x10 * s, 0)) for s in range(n)]
   prog = program_with_18b_rows(acc_pairs, fma_pairs)
   R2_A, R2_B = 32, 40
   for s in range(n):
      prog.set_bram_word(R2_A + s, pack18_pair(0x00050 + s, 0x00060 + s))
      prog.set_bram_word(R2_B + s, pack18_pair(0x00070 + s, 0x00080 + s))

   # Round 0: s.r0 = load(seed row)
   for s in range(n):
      prog.ops.append(ADD18(addr_a=ACC_A + s, addr_b=ACC_B + s, dst=4 * s))
   # Round 1: s.r0 = fma(own row, next fetch's row, s.r0), updating only the
   # selected 18-bit bank while preserving the other initialized bank.
   for s in range(n):
      prog.ops.append(FMA18(addr_a=SRC_A + s, addr_b=SRC_B + s, acc=Slot(4 * s),
                            dst=4 * s))
   # Round 2: s.r2 = add(addend row, s.r0) -- consumes the FMA writeback
   for s in range(n):
      prog.ops.append(ADD18(addr_a=R2_A + s, addr_b=R2_B + s, acc=Slot(4 * s),
                            dst=4 * s + 2))

   await run_program(dut, prog)


@cocotb.test()
async def test_acc_slots_are_registers(dut):
   """Slots written in one order and read back in a scrambled order."""
   acc_pairs = [((0x00100 * (k + 1) & 0x3FFFF, 0x00011 * (k + 1) & 0x3FFFF),
                 (0x00101 * (k + 1) & 0x3FFFF, 0x00013 * (k + 1) & 0x3FFFF))
                for k in range(8)]
   src_pairs = [((0x00001, 0x00002), (0x00003, 0x00004))] * 8
   prog = program_with_18b_rows(acc_pairs, src_pairs)

   # Slots spread over the whole file, including 31 (no reserved zero slot).
   slots = [0, 5, 9, 13, 18, 22, 27, 31]
   read_order = [5, 2, 7, 0, 6, 3, 1, 4]

   for k in range(8):
      prog.ops.append(ADD18(addr_a=ACC_A + k, addr_b=ACC_B + k, dst=slots[k]))
   # Space the reads so even the last-written slot is MIN_RAW_DISTANCE away,
   # leaving the read order free to scramble.
   for _ in range(T.MIN_RAW_DISTANCE - 1):
      prog.ops.append(NOP())
   for j, k in enumerate(read_order):
      prog.ops.append(ADD18(addr_a=SRC_A + j, addr_b=SRC_B + j, acc=Slot(slots[k])))

   await run_program(dut, prog)


@cocotb.test()
async def test_latency_pin(dut):
   """Lock the pipeline spec: one op, checked on its exact cycle.

    run_program compares on iteration issue + OBSERVE_ITER_OFFSET only, so any
    drift in the RTL pipeline depth fails this immediately.
    """
   assert T.ISSUE_TO_RESULT == 8
   assert T.ISSUE_TO_COMMIT == 9
   assert T.MIN_RAW_DISTANCE == 6

   acc_pairs = [((0x12345, 0x0BEEF), (0x1CAFE, 0x0DEAD))]
   prog = program_with_18b_rows(acc_pairs, [])
   prog.ops.append(ADD18(addr_a=ACC_A, addr_b=ACC_B, dst=0))
   await run_program(dut, prog)


@cocotb.test()
async def test_vector_roundtrip(dut):
   """emit() -> load() reproduces exactly what assemble() produced.

    Guards the vector-file emitter/loader pair against drift (a field
    forgotten in the loader, a formatting mistake in the emitter).
    """
   acc_pairs = [((0x12345, 0x0BEEF), (0x1CAFE, 0x0DEAD))]
   src_pairs = [((0x01111, 0x02222), (0x03333, 0x01234))]
   prog = program_with_18b_rows(acc_pairs, src_pairs)
   prog.ops.append(ADD18(addr_a=ACC_A, addr_b=ACC_B, dst=3))
   for _ in range(T.MIN_RAW_DISTANCE - 1):
      prog.ops.append(NOP())
   prog.ops.append(ADD18(addr_a=SRC_A, addr_b=SRC_B, acc=Slot(3), dst=7))
   prog.ops.append(FMA18(addr_a=SRC_A, addr_b=SRC_B, acc=Slot(3)))

   drives, predictions = assemble(prog)
   path = Path("roundtrip.vectors.yaml")
   xu_vectors.emit("roundtrip", prog.bram, drives, predictions, path)
   bram, cycles = xu_vectors.load(path)

   assert bram == prog.bram
   assert len(cycles) == len(drives)
   for c, d in zip(cycles, drives):
      assert c.addr_a == d.addr_a and c.addr_b == d.addr_b
      assert c.ctl == d.ctl
      assert c.op == d.op_repr
   checks = {c.cycle: c.check for c in cycles if c.check is not None}
   assert sorted(checks) == [p.op_index for p in predictions]
   for p in predictions:
      chk = checks[p.op_index]
      assert chk["at"] == p.observe_iter
      assert tuple(chk[lane] for lane in xu_vectors.LANE_NAMES) == p.lanes


@cocotb.test()
async def test_assembler_rejects_hazards(dut):
   """Assemble-time legality: RAW too close, read of an unwritten register."""
   # RAW distance 5 must be rejected: the result is still in flight and the
   # XU has no forwarding path.
   prog = Program()
   prog.ops = [ADD18(dst=0)] + [NOP()] * 4 + [ADD18(acc=Slot(0))]
   with pytest.raises(AsmError, match="no forwarding path"):
      assemble(prog)

   # Reading a never-written slot must be rejected.
   prog = Program()
   prog.ops = [ADD18(acc=Slot(3))]
   with pytest.raises(AsmError, match="before any write"):
      assemble(prog)
