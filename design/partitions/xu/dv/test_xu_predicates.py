"""CMP18 predicates followed by separate masked accumulator-to-BRAM commits."""

import operator

import cocotb
from cocotb.triggers import ReadOnly, Timer

from design.partitions.xu.dv import xu_timing as T
from design.partitions.xu.dv.xu_asm import load_bram
from design.partitions.xu.dv.xu_models import fma18_expected, pack18_pair
from design.partitions.xu.dv.xu_tb import (
    HALF_MASK, drive_xu_ctl, dsp_add_ctl, dsp_add_kwargs, dsp_fma_ctl,
    pack_dsp_ctl, reset_dut, xu_edge,
)


class PredicateBench:
    """Drive one instruction per fabric cycle and check scheduled outputs."""

    def __init__(self, dut):
        self.dut = dut
        self.idle = dict(l0dsp_control=dsp_add_ctl(zero_acc=True),
                         l1dsp_control=dsp_add_ctl(zero_acc=True))
        self.iteration = 0
        self.checks = {}

    async def step(self, ctl=None, *, expected=None, delay=T.OBSERVE_ITER_OFFSET, label=""):
        if expected is not None:
            self.checks.setdefault(self.iteration + delay, []).append((expected, label))
        drive_xu_ctl(self.dut, **(self.idle if ctl is None else ctl))
        await xu_edge(self.dut)
        await ReadOnly()
        for values, context in self.checks.pop(self.iteration, []):
            for signal, value in values.items():
                actual = int(getattr(self.dut, signal).value)
                assert actual == value, (
                    f"cycle={self.iteration} {context}: {signal} expected=0x{value:x}, actual=0x{actual:x}")
        await Timer(1, unit="step")
        self.iteration += 1

    async def drain(self):
        for _ in range(T.ISSUE_TO_COMMIT):
            await self.step()


@cocotb.test()
async def test_predicate_writeback(dut):
    """Check signed conditions, predicate slots, inversion, and preserved bytes."""
    # Each tuple is {l0_hi, l0_lo, l1_hi, l1_lo}. CMP18 compares acc to X.
    operands = (
        ((-131072, -1, 0, 131071), (131071, -1, -1, -131072)),
        ((131071, 0, -1, -131072), (-131072, 1, -1, 0)),
        ((0, -131072, 131071, 1), (0, 131071, -131072, 2)),
        ((-1, 131071, -131072, 0), (-1, 131071, -131072, 0)),
    )
    conditions = (operator.eq, operator.ne, operator.lt,
                  operator.le, operator.gt, operator.ge)
    payload = (pack18_pair(0x2A955, 0x155AA), pack18_pair(0x36CC3, 0x0933C))
    sentinel = (pack18_pair(0x156AA, 0x2AA55), pack18_pair(0x0933C, 0x36CC3))
    bram = {40: payload[0], 41: payload[1]}
    predicates = []
    for row, (acc, x) in enumerate(operands):
        bram[2 * row] = pack18_pair(*acc[:2])
        bram[2 * row + 1] = pack18_pair(*acc[2:])
        bram[16 + 2 * row] = pack18_pair(*x[:2])
        bram[17 + 2 * row] = pack18_pair(*x[2:])
        for cond, compare in enumerate(conditions):
            mask = sum(int(compare(a, b)) << bit
                       for bit, (a, b) in enumerate(zip(acc, x)))
            predicates.append((row, cond, mask))

    # All enabled, individual half enables, and mixed 9-bit enables including
    # zero. Disabled predication must ignore even an inverted false predicate.
    variants = ((1, 0, 0xF, 0xF), (1, 1, 0xF, 0xF),
                (1, 0, 0x3, 0xC), (1, 1, 0x5, 0), (0, 1, 0xA, 0xF))
    commits = []
    for slot, (_, cond, mask) in enumerate(predicates):
        for enable, invert, we_a, we_b in variants:
            addr = 128 + 2 * len(commits)
            bram[addr], bram[addr + 1] = sentinel
            active = (mask ^ (0xF if invert else 0)) if enable else 0xF
            wes = (we_a & ((0xC if active & 1 else 0) | (0x3 if active & 2 else 0)),
                   we_b & ((0xC if active & 4 else 0) | (0x3 if active & 8 else 0)))
            expected = []
            for lane, we in enumerate(wes):
                bitmask = sum(0x1FF << (9 * group) for group in range(4) if we & (1 << group))
                expected.append((sentinel[lane] & ~bitmask) | (payload[lane] & bitmask))
            label = f"slot={slot} cond={cond} enable={enable} invert={invert} WE={we_a:x}/{we_b:x}"
            commits.append((slot, addr, enable, invert, we_a, we_b, active, wes, expected, label))

    await reset_dut(dut)
    await load_bram(dut, bram)
    bench = PredicateBench(dut)
    idle, step, drain = bench.idle, bench.step, bench.drain

    await drain()
    for row in range(len(operands)):
        await step(dict(idle, addr_a=2 * row, addr_b=2 * row + 1,
                        acc_we=1, acc_waddr=row))
    await step(dict(idle, addr_a=40, addr_b=41, acc_we=1, acc_waddr=31))
    await drain()

    cmp_ctl = pack_dsp_ctl(**dict(dsp_add_kwargs(), ALUMODE=0b0011, OPMODE=0b0110011))
    for slot, (row, cond, mask) in enumerate(predicates):
        await step(dict(mode=4, addr_a=16 + 2 * row, addr_b=17 + 2 * row,
                        l0dsp_control=cmp_ctl, l1dsp_control=cmp_ctl,
                        acc_raddr=row, pred_we=1, pred_waddr=slot, pred_cond=cond),
                   expected={"pred_write_data": mask}, label=f"CMP18 row={row} cond={cond}")
    await drain()

    # Keep all predicate slots unchanged until their commits have captured them.
    # Fetch addresses are idle while delayed commits own the BRAM ports.
    add_ctl = dsp_add_ctl()
    for slot, addr, enable, invert, wa, wb, active, wes, _, label in commits:
        await step(dict(l0dsp_control=add_ctl, l1dsp_control=add_ctl,
                        acc_raddr=31, zero_bram_operands=1,
                        pred_raddr=slot, pred_enable=enable, pred_invert=invert,
                        l0_wb_valid=1, l1_wb_valid=1, wb_addr_a=addr, wb_addr_b=addr + 1,
                        wb_we_a=wa, wb_we_b=wb),
                   expected={"exec_mask": active, "bram_we_a": wes[0], "bram_we_b": wes[1],
                             "bram_di_a": payload[0], "bram_di_b": payload[1]}, label=label)
    await drain()

    for _, addr, _, _, _, _, _, _, expected, label in commits:
        await step(dict(idle, addr_a=addr, addr_b=addr + 1),
                   expected={"DO_A": expected[0], "DO_B": expected[1]},
                   delay=T.BRAM_ADDR_TO_DO - 1, label=f"BRAM readback {label}")
    await drain()
    assert not bench.checks


@cocotb.test()
async def test_predicate_round_robin(dut):
    """Eight strands, six batches, same-strand instructions eight cycles apart."""
    await _run_predicate_round_robin(dut, fma18=False)


@cocotb.test()
async def test_fma18_predicate_round_robin(dut):
    """Eight strands update both FMA18 banks before predicated BRAM commits."""
    await _run_predicate_round_robin(dut, fma18=True)


async def _run_predicate_round_robin(dut, *, fma18):
    conditions = (operator.eq, operator.ne, operator.lt,
                  operator.le, operator.gt, operator.ge)
    signed_values = (-131072, -1, 0, 131071)
    multiplicands = (-131072, -769, -257, -1, 1, 255, 513, 131071)
    commit_round = 4 if fma18 else 3
    idle_round = commit_round + 2
    read_round = idle_round + 1
    n_rounds = read_round + 2
    batches = []
    bram = {}
    for batch in range(6):
        strands = []
        operand_rows = [
            tuple(multiplicands[(strand + 3 * bit + batch) % 8] if fma18
                  else 0x123 + 53 * strand + 97 * batch + 0x501 * bit
                  for bit in range(4))
            for strand in range(8)
        ]
        for strand in range(8):
            base = 10 * (8 * batch + strand)
            acc = tuple(signed_values[(strand + bit + batch) % 4] for bit in range(4))
            x = tuple(signed_values[(strand + 2 * bit + batch) % 4] for bit in range(4))
            operands = operand_rows[strand]
            if fma18:
                # High: current * next. Low: previous * current. Both rounds
                # fetch the same eight rows, so the round boundary wraps 7->0.
                previous = operand_rows[(strand - 1) % 8]
                following = operand_rows[(strand + 1) % 8]
                result = tuple(
                    fma18_expected(
                        (previous[bit] if bit & 1 else operands[bit]) & 0xFFFFFF,
                        (operands[bit] if bit & 1 else following[bit]) & HALF_MASK,
                        acc[bit] & HALF_MASK)
                    for bit in range(4)
                )
            else:
                result = tuple((a + b) & HALF_MASK for a, b in zip(acc, operands))
            old = tuple((0x35A96 ^ (strand << 10) ^ (batch << 6) ^ (bit * 0x7139)) & HALF_MASK
                        for bit in range(4))
            for offset, values in ((0, acc), (2, x), (4, operands), (6, old), (8, old)):
                bram[base + offset] = pack18_pair(*values[:2])
                bram[base + offset + 1] = pack18_pair(*values[2:])
            cond = (batch + strand) % 6
            mask = sum(int(conditions[cond](a, b)) << bit
                       for bit, (a, b) in enumerate(zip(acc, x)))
            strands.append((base, cond, mask, result, old))
        batches.append(strands)

    await reset_dut(dut)
    await load_bram(dut, bram)
    bench = PredicateBench(dut)
    await bench.drain()
    start = bench.iteration
    add_ctl = dsp_add_ctl()
    fma_ctl = dsp_fma_ctl()
    cmp_ctl = pack_dsp_ctl(**dict(dsp_add_kwargs(), ALUMODE=0b0011, OPMODE=0b0110011))

    # ADD writes acc[4*s+1]; FMA updates acc[4*s] in place, preserving the
    # unselected bank. pred[4*s+3] stays unchanged until both commits capture it.
    for batch, strands in enumerate(batches):
        for round_index in range(n_rounds):
            for strand, (base, cond, mask, result, old) in enumerate(strands):
                assert bench.iteration - start == batch * n_rounds * 8 + round_index * 8 + strand
                label = f"fma18={fma18} batch={batch} round={round_index} strand={strand} cond={cond}"
                ctl = dict(bench.idle)
                expected = None
                delay = T.OBSERVE_ITER_OFFSET
                if round_index == 0:
                    ctl.update(addr_a=base, addr_b=base + 1, acc_we=1, acc_waddr=4 * strand)
                elif round_index == 1:
                    ctl.update(mode=4, addr_a=base + 2, addr_b=base + 3,
                               l0dsp_control=cmp_ctl, l1dsp_control=cmp_ctl,
                               acc_raddr=4 * strand, pred_we=1,
                               pred_waddr=4 * strand + 3, pred_cond=cond)
                    expected = {"pred_write_data": mask}
                elif fma18 and round_index in (2, 3):
                    low = round_index - 2
                    ctl.update(mode=1, mode1_sel_low=low,
                               addr_a=base + 4, addr_b=base + 5,
                               l0dsp_control=fma_ctl, l1dsp_control=fma_ctl,
                               acc_raddr=4 * strand, acc_we=1, acc_waddr=4 * strand)
                    expected = {"l0y1": result[low], "l0y2": 0,
                                "l1y1": result[2 + low], "l1y2": 0}
                elif round_index == 2:
                    ctl.update(addr_a=base + 4, addr_b=base + 5,
                               l0dsp_control=add_ctl, l1dsp_control=add_ctl,
                               acc_raddr=4 * strand, acc_we=1, acc_waddr=4 * strand + 1)
                    expected = dict(zip(("l0y1", "l0y2", "l1y1", "l1y2"), result))
                elif round_index in (commit_round, commit_round + 1):
                    invert = (strand & 1) ^ (round_index - commit_round)
                    active = mask ^ (0xF if invert else 0)
                    addr = base + 6 + 2 * (round_index - commit_round)
                    ctl.update(l0dsp_control=add_ctl, l1dsp_control=add_ctl,
                               acc_raddr=4 * strand + (0 if fma18 else 1), zero_bram_operands=1,
                               pred_raddr=4 * strand + 3, pred_enable=1, pred_invert=invert,
                               l0_wb_valid=1, l1_wb_valid=1,
                               wb_addr_a=addr, wb_addr_b=addr + 1, wb_we_a=0xF, wb_we_b=0xF)
                    expected = {
                        "exec_mask": active,
                        "bram_addr_a": addr, "bram_addr_b": addr + 1,
                        "bram_we_a": (0xC if active & 1 else 0) | (0x3 if active & 2 else 0),
                        "bram_we_b": (0xC if active & 4 else 0) | (0x3 if active & 8 else 0),
                        "bram_di_a": pack18_pair(*result[:2]),
                        "bram_di_b": pack18_pair(*result[2:]),
                    }
                elif round_index == idle_round:
                    # The preceding round's delayed commits occupy both ports.
                    pass
                else:
                    invert = (strand & 1) ^ (round_index - read_round)
                    active = mask ^ (0xF if invert else 0)
                    final = tuple(result[bit] if active & (1 << bit) else old[bit] for bit in range(4))
                    addr = base + 6 + 2 * (round_index - read_round)
                    ctl.update(addr_a=addr, addr_b=addr + 1)
                    expected = {"DO_A": pack18_pair(*final[:2]), "DO_B": pack18_pair(*final[2:])}
                    delay = T.BRAM_ADDR_TO_DO - 1
                await bench.step(ctl, expected=expected, delay=delay, label=label)
    await bench.drain()
    assert not bench.checks
