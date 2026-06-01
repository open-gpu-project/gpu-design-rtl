import cocotb
from cocotb.clock import Clock
from cocotb.triggers import ReadOnly, RisingEdge, Timer
from dataclasses import dataclass


# -----------------------------------------------------------------------------
# Test configuration
# -----------------------------------------------------------------------------

HALF_W = 18
WORD_W = 36

HALF_MASK = (1 << HALF_W) - 1
WORD_MASK = (1 << WORD_W) - 1

BRAM_ADDR_IDLE = 0x3FF
ACC_ADDR_SRL = 11

NUM_PRELOAD_ISSUES = 8
NUM_ADD_ISSUES = 8
TEST_CYCLES = 40
BRAM_READ_LATENCY = 1

BYPASS_START_CYCLE = NUM_PRELOAD_ISSUES

# These are not strictly checked unless you fill them in after bring-up.
# During early bring-up, leave as None to only check that latency is constant.
EXPECTED_PASS_LATENCY = None
EXPECTED_ADD_LATENCY = None
EXPECTED_ACC_LATENCY_AFTER_LANE = None
EXPECTED_READ_TO_ACC_LATENCY = None


# -----------------------------------------------------------------------------
# Small transaction objects
# -----------------------------------------------------------------------------

@dataclass
class LaneExpected:
    issue_cycle: int
    values: tuple[int, int, int, int]
    name: str

    @property
    def l0_word(self) -> int:
        return pack_bram_word(self.values[0], self.values[1])

    @property
    def l1_word(self) -> int:
        return pack_bram_word(self.values[2], self.values[3])


@dataclass
class AccExpected:
    issue_cycle: int
    lane_cycle: int
    l0_word: int
    l1_word: int
    name: str


# -----------------------------------------------------------------------------
# Packing helpers
# -----------------------------------------------------------------------------

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
    return (
        ((INMODE & 0x1F) << 20)
        | ((ALUMODE & 0xF) << 16)
        | ((OPMODE & 0x7F) << 9)
        | ((CEA & 0x3) << 7)
        | ((CEB & 0x3) << 5)
        | ((CEC & 0x1) << 4)
        | ((CED & 0x1) << 3)
        | ((CEM & 0x1) << 2)
        | ((CEP & 0x1) << 1)
        | ((CEAD & 0x1) << 0)
    )


def pack_xu_ctl(
    *,
    l0dsp_control=0,
    l1dsp_control=0,
    mode=0,
    slice_sel_24bit=0,
    mode1_sel_low=0,
    addr_srl=8,
    acc_ce=0,
    bypass_acc=0,
):
    return (
        ((l0dsp_control & ((1 << 25) - 1)) << 38)
        | ((l1dsp_control & ((1 << 25) - 1)) << 13)
        | ((mode & 0x3) << 11)
        | ((slice_sel_24bit & 0x3) << 9)
        | ((mode1_sel_low & 0x1) << 8)
        | ((addr_srl & 0x3F) << 2)
        | ((acc_ce & 0x1) << 1)
        | (bypass_acc & 0x1)
    )


def pack_bram_word(high18, low18):
    return (((high18 & HALF_MASK) << HALF_W) | (low18 & HALF_MASK)) & WORD_MASK


def unpack_bram_word(word):
    return ((word >> HALF_W) & HALF_MASK, word & HALF_MASK)


def add18(lhs, rhs):
    return (lhs + rhs) & HALF_MASK


# -----------------------------------------------------------------------------
# Control helpers
# -----------------------------------------------------------------------------

def dsp_add_ctl():
    """DSP48 control word used by this test for 18-bit lane add mode."""
    return pack_dsp_ctl(
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


def drive_xu_ctl(
    dut,
    *,
    l0dsp_control=0,
    l1dsp_control=0,
    mode=0,
    slice_sel_24bit=0,
    mode1_sel_low=0,
    addr_srl=8,
    acc_ce=0,
    bypass_acc=0,
):
    dut.xu_ctl_in.value = pack_xu_ctl(
        l0dsp_control=l0dsp_control,
        l1dsp_control=l1dsp_control,
        mode=mode,
        slice_sel_24bit=slice_sel_24bit,
        mode1_sel_low=mode1_sel_low,
        addr_srl=addr_srl,
        acc_ce=acc_ce,
        bypass_acc=bypass_acc,
    )


def drive_add_mode(dut, *, acc_ce=1, bypass_acc=0):
    add_ctl = dsp_add_ctl()
    drive_xu_ctl(
        dut,
        l0dsp_control=add_ctl,
        l1dsp_control=add_ctl,
        mode=0,
        addr_srl=ACC_ADDR_SRL,
        acc_ce=acc_ce,
        bypass_acc=bypass_acc,
    )


# -----------------------------------------------------------------------------
# DUT IO helpers
# -----------------------------------------------------------------------------

def init_xu_inputs(dut):
    dut.rst.value = 1
    dut.xu_ctl_in.value = 0
    dut.l1dsp_casc_in.value = 0

    dut.ADDR_A.value = 0
    dut.EN_A.value = 0
    dut.WE_A.value = 0
    dut.DI_A.value = 0

    dut.ADDR_B.value = 0
    dut.EN_B.value = 0
    dut.WE_B.value = 0
    dut.DI_B.value = 0


def drive_bram_read(dut, addr_a, addr_b):
    dut.ADDR_A.value = addr_a
    dut.ADDR_B.value = addr_b
    dut.EN_A.value = 1
    dut.EN_B.value = 1
    dut.WE_A.value = 0
    dut.WE_B.value = 0


def drive_bram_idle(dut):
    drive_bram_read(dut, BRAM_ADDR_IDLE, BRAM_ADDR_IDLE)


def lane_outputs(dut):
    return (
        int(dut.l0y1_o.value) & HALF_MASK,
        int(dut.l0y2_o.value) & HALF_MASK,
        int(dut.l1y1_o.value) & HALF_MASK,
        int(dut.l1y2_o.value) & HALF_MASK,
    )


def acc_outputs(dut):
    return (
        int(dut.l0acc_out.value) & WORD_MASK,
        int(dut.l1acc_out.value) & WORD_MASK,
    )


# -----------------------------------------------------------------------------
# Clock/reset helpers
# -----------------------------------------------------------------------------

async def reset_dut(dut):
    cocotb.start_soon(Clock(dut.dsp_clk, 5, unit="ns").start())
    cocotb.start_soon(Clock(dut.dsp_clk_div2, 10, unit="ns").start())

    init_xu_inputs(dut)

    for _ in range(3):
        await RisingEdge(dut.dsp_clk_div2)

    dut.rst.value = 0
    await RisingEdge(dut.dsp_clk_div2)
    await Timer(1, unit="step")


# -----------------------------------------------------------------------------
# BRAM helpers
# -----------------------------------------------------------------------------

async def load_18b_lines_to_bram(dut, lines, *, start_addr=0, port="A"):
    """Load rows of two 18-bit values into one XU BRAM port."""
    port = port.upper()
    if port not in ("A", "B"):
        raise ValueError(f"port must be 'A' or 'B', got {port!r}")

    addr = getattr(dut, f"ADDR_{port}")
    en = getattr(dut, f"EN_{port}")
    we = getattr(dut, f"WE_{port}")
    data = getattr(dut, f"DI_{port}")

    en.value = 1
    we.value = 1

    for offset, line in enumerate(lines):
        if len(line) != 2:
            raise ValueError(f"line must contain two 18-bit values, got {line!r}")

        high18, low18 = line
        addr.value = start_addr + offset
        data.value = pack_bram_word(high18, low18)
        await RisingEdge(dut.dsp_clk_div2)

    we.value = 0
    data.value = 0


async def check_parallel_bram_read_burst(dut, lines, *, base_addr, count, name):
    """Check fixed-latency parallel reads from both BRAM ports."""
    issued = []

    for cycle in range(count + BRAM_READ_LATENCY):
        if cycle < count:
            addr_a = base_addr + cycle
            addr_b = base_addr + cycle + count
            drive_bram_read(dut, addr_a, addr_b)
            issued.append((addr_a, addr_b))
        else:
            drive_bram_idle(dut)

        await RisingEdge(dut.dsp_clk_div2)
        await ReadOnly()

        if cycle < BRAM_READ_LATENCY:
            await Timer(1, unit="step")
            continue

        addr_a, addr_b = issued[cycle - BRAM_READ_LATENCY]
        actual_a = int(dut.DO_A.value) & WORD_MASK
        actual_b = int(dut.DO_B.value) & WORD_MASK
        expected_a = pack_bram_word(*lines[addr_a])
        expected_b = pack_bram_word(*lines[addr_b])

        assert_bram_word_equal(name, "A", addr_a, actual_a, expected_a, lines[addr_a])
        assert_bram_word_equal(name, "B", addr_b, actual_b, expected_b, lines[addr_b])

        await Timer(1, unit="step")


def assert_bram_word_equal(name, port, addr, actual_word, expected_word, expected_line):
    if actual_word == expected_word:
        return

    actual_line = unpack_bram_word(actual_word)
    raise AssertionError(
        f"{name} BRAM {port}[{addr}] mismatch\n"
        f"expected word=0x{expected_word:09x} "
        f"line=(0x{expected_line[0]:05x}, 0x{expected_line[1]:05x})\n"
        f"actual   word=0x{actual_word:09x} "
        f"line=(0x{actual_line[0]:05x}, 0x{actual_line[1]:05x})"
    )


# -----------------------------------------------------------------------------
# Test data / expected model
# -----------------------------------------------------------------------------

def make_test_lines():
    test_values = [
        0x00000, 0x00001, 0x00002, 0x00003,
        0x01234, 0x05678, 0x0ABCD, 0x0DEF0,
        0x10000, 0x15555, 0x1AAAA, 0x1FFFF,
        0x20000, 0x25555, 0x2AAAA, 0x2FFFF,
        0x30000, 0x33333, 0x35555, 0x3AAAA,
        0x3FFFC, 0x3FFFD, 0x3FFFE, 0x3FFFF,
        0x00010, 0x00020, 0x00040, 0x00080,
        0x00100, 0x00200, 0x00400, 0x00800,
    ]

    constant_values = [
        0x00011, 0x00022, 0x00044, 0x00088,
        0x00111, 0x00222, 0x00444, 0x00888,
        0x01111, 0x02222, 0x04444, 0x08888,
        0x0AAAA, 0x0CCCC, 0x0EEEE, 0x0FFFF,
        0x11111, 0x12222, 0x14444, 0x18888,
        0x21111, 0x24444, 0x28888, 0x2CCCC,
        0x31111, 0x32222, 0x34444, 0x38888,
        0x3AAAA, 0x3BBBB, 0x3CCCC, 0x3DDDD,
    ]

    values = test_values + constant_values
    return list(zip(values[0::2], values[1::2]))


def expected_preload_transaction(cycle, lines):
    return LaneExpected(
        issue_cycle=cycle,
        values=(
            lines[cycle][0],
            lines[cycle][1],
            lines[cycle + NUM_PRELOAD_ISSUES][0],
            lines[cycle + NUM_PRELOAD_ISSUES][1],
        ),
        name="preload/pass-through",
    )


def expected_add_transaction(cycle, lines):
    offset = cycle - NUM_PRELOAD_ISSUES

    l0acc = lines[offset]
    l1acc = lines[offset + NUM_PRELOAD_ISSUES]
    l0const = lines[offset + 2 * NUM_PRELOAD_ISSUES]
    l1const = lines[offset + 3 * NUM_PRELOAD_ISSUES]

    return LaneExpected(
        issue_cycle=cycle,
        values=(
            add18(l0const[0], l0acc[0]),
            add18(l0const[1], l0acc[1]),
            add18(l1const[0], l1acc[0]),
            add18(l1const[1], l1acc[1]),
        ),
        name="bypass/add",
    )


# -----------------------------------------------------------------------------
# Pipeline driver / observer helpers
# -----------------------------------------------------------------------------

def drive_issue_for_cycle(dut, cycle, lines):
    """
    Drive one cycle of BRAM addresses and return the expected lane output
    transaction, if this cycle issued a useful operation.
    """
    if cycle < NUM_PRELOAD_ISSUES:
        drive_bram_read(dut, cycle, cycle + NUM_PRELOAD_ISSUES)
        return expected_preload_transaction(cycle, lines)

    if cycle < NUM_PRELOAD_ISSUES + NUM_ADD_ISSUES:
        offset = cycle - NUM_PRELOAD_ISSUES
        drive_bram_read(
            dut,
            2 * NUM_PRELOAD_ISSUES + offset,
            3 * NUM_PRELOAD_ISSUES + offset,
        )
        return expected_add_transaction(cycle, lines)

    drive_bram_idle(dut)
    return None


def observe_lane_output(
    dut,
    *,
    cycle,
    pending_pass,
    pending_add,
    pending_acc,
    observed_pass_latencies,
    observed_add_latencies,
):
    actual = lane_outputs(dut)

    if pending_pass and actual == pending_pass[0].values:
        expected = pending_pass.pop(0)
        latency = cycle - expected.issue_cycle + 1
        observed_pass_latencies.append(latency)
        pending_acc.append(
            AccExpected(
                issue_cycle=expected.issue_cycle,
                lane_cycle=cycle,
                l0_word=expected.l0_word,
                l1_word=expected.l1_word,
                name=expected.name,
            )
        )
        return

    if pending_add and actual == pending_add[0].values:
        expected = pending_add.pop(0)
        latency = cycle - expected.issue_cycle + 1
        observed_add_latencies.append(latency)
        return


def observe_acc_output(
    dut,
    *,
    cycle,
    pending_acc,
    observed_acc_latencies,
    observed_read_to_acc_latencies,
):
    if not pending_acc:
        return

    actual = acc_outputs(dut)
    expected = pending_acc[0]

    if actual != (expected.l0_word, expected.l1_word):
        return

    observed_acc_latencies.append(cycle - expected.lane_cycle + 1)
    observed_read_to_acc_latencies.append(cycle - expected.issue_cycle + 1)
    pending_acc.pop(0)


# -----------------------------------------------------------------------------
# Assertion helpers
# -----------------------------------------------------------------------------

def assert_no_pending_lane(name, pending, dut):
    if not pending:
        return

    expected = pending[0]
    actual = lane_outputs(dut)
    raise AssertionError(
        f"{name}: output not observed for issue cycle {expected.issue_cycle}\n"
        f"expected l0=(0x{expected.values[0]:05x}, 0x{expected.values[1]:05x}) "
        f"l1=(0x{expected.values[2]:05x}, 0x{expected.values[3]:05x})\n"
        f"last actual l0=(0x{actual[0]:05x}, 0x{actual[1]:05x}) "
        f"l1=(0x{actual[2]:05x}, 0x{actual[3]:05x})"
    )


def assert_no_pending_acc(pending_acc, dut):
    if not pending_acc:
        return

    expected = pending_acc[0]
    actual_l0, actual_l1 = acc_outputs(dut)
    raise AssertionError(
        f"ACC output not observed for {expected.name} output from lane cycle {expected.lane_cycle}\n"
        f"expected l0acc=0x{expected.l0_word:09x} "
        f"l1acc=0x{expected.l1_word:09x}\n"
        f"last actual l0acc=0x{actual_l0:09x} "
        f"l1acc=0x{actual_l1:09x}"
    )


def check_latency(name, observed, expected=None):
    if not observed:
        raise AssertionError(f"{name}: no transactions observed")

    unique = sorted(set(observed))
    if len(unique) != 1:
        raise AssertionError(f"{name}: latency varied: {observed}")

    measured = unique[0]
    if expected is not None and measured != expected:
        raise AssertionError(f"{name}: expected latency {expected}, got {measured}")

    cocotb.log.info(f"{name}: observed latency = {measured} dsp_clk_div2 cycles")


# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------

@cocotb.test()
async def test_bram_dual_port_load_read(dut):
    await reset_dut(dut)

    lines = make_test_lines()

    # Load through port A only. Later reads use both ports to check that this is
    # truly one shared dual-port memory, not two unrelated memories.
    await load_18b_lines_to_bram(dut, lines, start_addr=0, port="A")

    await check_parallel_bram_read_burst(
        dut,
        lines,
        base_addr=0,
        count=NUM_PRELOAD_ISSUES,
        name="test values",
    )

    await check_parallel_bram_read_burst(
        dut,
        lines,
        base_addr=2 * NUM_PRELOAD_ISSUES,
        count=NUM_ADD_ISSUES,
        name="constant values",
    )


@cocotb.test()
async def test_xu_bram_lane_acc_integration(dut):
    await reset_dut(dut)

    lines = make_test_lines()

    # -------------------------------------------------------------------------
    # 1. Load and sanity-check BRAM contents
    # -------------------------------------------------------------------------
    await load_18b_lines_to_bram(dut, lines, start_addr=0, port="A")

    await check_parallel_bram_read_burst(
        dut,
        lines,
        base_addr=0,
        count=NUM_PRELOAD_ISSUES,
        name="test values",
    )

    await check_parallel_bram_read_burst(
        dut,
        lines,
        base_addr=2 * NUM_PRELOAD_ISSUES,
        count=NUM_ADD_ISSUES,
        name="constant values",
    )

    # -------------------------------------------------------------------------
    # 2. Run pipeline
    # -------------------------------------------------------------------------
    pending_pass = []
    pending_add = []
    pending_acc = []

    observed_pass_latencies = []
    observed_add_latencies = []
    observed_acc_latencies = []
    observed_read_to_acc_latencies = []

    for cycle in range(TEST_CYCLES):
        drive_add_mode(dut, bypass_acc=(cycle >= BYPASS_START_CYCLE))

        expected = drive_issue_for_cycle(dut, cycle, lines)
        if expected is not None:
            if expected.name == "preload/pass-through":
                pending_pass.append(expected)
            elif expected.name == "bypass/add":
                pending_add.append(expected)
            else:
                raise RuntimeError(f"unknown transaction type {expected.name!r}")

        await RisingEdge(dut.dsp_clk_div2)
        await ReadOnly()

        observe_lane_output(
            dut,
            cycle=cycle,
            pending_pass=pending_pass,
            pending_add=pending_add,
            pending_acc=pending_acc,
            observed_pass_latencies=observed_pass_latencies,
            observed_add_latencies=observed_add_latencies,
        )

        observe_acc_output(
            dut,
            cycle=cycle,
            pending_acc=pending_acc,
            observed_acc_latencies=observed_acc_latencies,
            observed_read_to_acc_latencies=observed_read_to_acc_latencies,
        )

        await Timer(1, unit="step")

    # -------------------------------------------------------------------------
    # 3. Final checks
    # -------------------------------------------------------------------------
    assert_no_pending_lane("lane pass-through", pending_pass, dut)
    assert_no_pending_lane("lane add", pending_add, dut)
    assert_no_pending_acc(pending_acc, dut)

    check_latency(
        "lane pass-through",
        observed_pass_latencies,
        expected=EXPECTED_PASS_LATENCY,
    )

    check_latency(
        "lane add",
        observed_add_latencies,
        expected=EXPECTED_ADD_LATENCY,
    )

    check_latency(
        "ACC update after lane output",
        observed_acc_latencies,
        expected=EXPECTED_ACC_LATENCY_AFTER_LANE,
    )

    check_latency(
        "read command to ACC output",
        observed_read_to_acc_latencies,
        expected=EXPECTED_READ_TO_ACC_LATENCY,
    )
