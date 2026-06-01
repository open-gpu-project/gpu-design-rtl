import cocotb
from cocotb.triggers import ReadOnly, RisingEdge, Timer
from dataclasses import dataclass

from design.partitions.xu.dv.test_xu_mode0 import (
    ACC_ADDR_SRL,
    HALF_MASK,
    WORD_MASK,
    check_parallel_bram_read_burst,
    drive_xu_ctl,
    lane_outputs,
    load_18b_lines_to_bram,
    pack_bram_word,
    pack_dsp_ctl,
    reset_dut,
    unpack_bram_word,
)


# -----------------------------------------------------------------------------
# Test configuration
# -----------------------------------------------------------------------------

CLK_NAME = "dsp_clk_div2"
BRAM_IDLE_ADDR = 0x3FF

# BRAM line layout used by this test:
#   lines[0:8]    = ACC preload stream for lane 0
#   lines[8:16]   = operand stream for lane 0
#   lines[16:24]  = ACC preload stream for lane 1
#   lines[24:32]  = operand stream for lane 1
ACC_A_BASE = 0
PORT_A_BASE = 8
ACC_B_BASE = 16
PORT_B_BASE = 24

NUM_ACC_PRELOAD = 8
NUM_MODE1_ISSUES = 8

# The first mode-1 issue happens immediately after the 8 preload issues.
# With addr_srl=11, this compensates for the 3-cycle address->ALU-input delay
# plus the 8-cycle ACC/result relationship.
FMA_START_CYCLE = NUM_ACC_PRELOAD

# Run long enough to drain the pipeline after the last issued mode-1 op.
PIPELINE_DRAIN_CYCLES = 20
TEST_CYCLES = FMA_START_CYCLE + NUM_MODE1_ISSUES + PIPELINE_DRAIN_CYCLES

# Leave as None during bring-up to only require constant latency.
# Fill in once exact latency is stable.
EXPECTED_HIGH_FMA_LATENCY = None
EXPECTED_LOW_FMA_LATENCY = None


# -----------------------------------------------------------------------------
# Transaction objects
# -----------------------------------------------------------------------------

@dataclass
class FmaExpected:
    issue_cycle: int
    offset: int
    mode1_sel_low: int
    expected_lanes: tuple[int, int, int, int]
    x_values: tuple[int, int, int, int]
    acc_values: tuple[int, int]

    @property
    def name(self) -> str:
        return "mode1-low" if self.mode1_sel_low else "mode1-high"


# -----------------------------------------------------------------------------
# Small math/model helpers
# -----------------------------------------------------------------------------

def sign_extend(value, bits):
    sign_bit = 1 << (bits - 1)
    return (value ^ sign_bit) - sign_bit


def expected_18b_fma(x1, x2, acc2):
    """
    Expected mode-1 FMA result.

    RTL intent:
      result = ((signed(x1) * signed(x2)) + (signed(acc2) << 8)) >> 8

    x1 is 24-bit sign-extended from an 18-bit source.
    x2 is 18-bit.
    acc2 is 18-bit.
    """
    product = sign_extend(x1, 24) * sign_extend(x2, 18)
    accum = sign_extend(acc2, 18) << 8
    return ((product + accum) >> 8) & HALF_MASK


# -----------------------------------------------------------------------------
# Clock / DUT access helpers
# -----------------------------------------------------------------------------

def xu_clk(dut):
    return getattr(dut, CLK_NAME)


async def xu_rising_edge(dut):
    await RisingEdge(xu_clk(dut))


def drive_bram_read(dut, addr_a, addr_b):
    dut.ADDR_A.value = addr_a
    dut.ADDR_B.value = addr_b
    dut.EN_A.value = 1
    dut.EN_B.value = 1
    dut.WE_A.value = 0
    dut.WE_B.value = 0


def drive_bram_idle(dut):
    drive_bram_read(dut, BRAM_IDLE_ADDR, BRAM_IDLE_ADDR)


# -----------------------------------------------------------------------------
# BRAM check helper
# -----------------------------------------------------------------------------

async def check_bram_rows(dut, lines, *, start_addr, count, name):
    """Check sequential BRAM rows from port A."""
    for offset in range(count + 1):
        if offset < count:
            dut.ADDR_A.value = start_addr + offset
            dut.EN_A.value = 1
            dut.WE_A.value = 0
        else:
            dut.ADDR_A.value = BRAM_IDLE_ADDR

        await xu_rising_edge(dut)
        await ReadOnly()

        # BRAM read is checked as one-cycle latency here.
        if offset == 0:
            await Timer(1, unit="step")
            continue

        addr = start_addr + offset - 1
        actual = int(dut.DO_A.value) & WORD_MASK
        expected = pack_bram_word(*lines[addr])

        if actual != expected:
            actual_line = unpack_bram_word(actual)
            expected_line = lines[addr]
            raise AssertionError(
                f"{name} BRAM A[{addr}] mismatch\n"
                f"expected word=0x{expected:09x} "
                f"line=(0x{expected_line[0]:05x}, 0x{expected_line[1]:05x})\n"
                f"actual   word=0x{actual:09x} "
                f"line=(0x{actual_line[0]:05x}, 0x{actual_line[1]:05x})"
            )

        await Timer(1, unit="step")


# -----------------------------------------------------------------------------
# Control helpers
# -----------------------------------------------------------------------------

def dsp_pass_ctl():
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


def dsp_fma_ctl():
    return pack_dsp_ctl(
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


def drive_pass_mode0(dut):
    ctl = dsp_pass_ctl()
    drive_xu_ctl(
        dut,
        l0dsp_control=ctl,
        l1dsp_control=ctl,
        mode=0,
        addr_srl=ACC_ADDR_SRL,
        acc_ce=0,
        bypass_acc=0,
    )


def drive_mode1_fma(dut, *, mode1_sel_low, bypass_acc):
    ctl = dsp_fma_ctl()
    drive_xu_ctl(
        dut,
        l0dsp_control=ctl,
        l1dsp_control=ctl,
        mode=1,
        mode1_sel_low=mode1_sel_low,
        addr_srl=ACC_ADDR_SRL,
        acc_ce=0,
        bypass_acc=bypass_acc,
    )


# -----------------------------------------------------------------------------
# Test data / expected model
# -----------------------------------------------------------------------------

def make_mode1_test_lines():
    acc_a_values = [
        0x00000, 0x00003, 0x00000, 0x00005,
        0x00000, 0x00007, 0x00000, 0x0000B,
        0x00000, 0x0000D, 0x00000, 0x00011,
        0x00000, 0x00013, 0x00000, 0x00017,
    ]

    acc_b_values = [
        0x00000, 0x00019, 0x00000, 0x0001D,
        0x00000, 0x0001F, 0x00000, 0x00025,
        0x00000, 0x00029, 0x00000, 0x0002B,
        0x00000, 0x0002F, 0x00000, 0x00035,
    ]

    # Operand stream layout is deliberately arranged as alternating high/low rows.
    # Mode-1 high uses previous-row high and current-row high.
    # Mode-1 low uses two-rows-ago low and previous-row low.
    port_a_values = [
        0x00100, 0x00120, 0x00020, 0x00030,
        0x00140, 0x00160, 0x00040, 0x00050,
        0x00180, 0x001A0, 0x00060, 0x00070,
        0x001C0, 0x001E0, 0x00080, 0x00090,
    ]

    port_b_values = [
        0x00200, 0x00220, 0x000A0, 0x000B0,
        0x00240, 0x00260, 0x000C0, 0x000D0,
        0x00280, 0x002A0, 0x000E0, 0x000F0,
        0x002C0, 0x002E0, 0x00100, 0x00110,
    ]

    values = acc_a_values + port_a_values + acc_b_values + port_b_values
    assert len(values) == 64
    return list(zip(values[0::2], values[1::2]))


def mode1_operands_from_lines(lines, offset, mode1_sel_low):
    """
    Model the operand rows that actually align with one issued mode-1 operation.

    Important timing point:
      The RTL expression uses pA/pA_d1/pA_d2 at the ALU-input stage, not at
      the BRAM-address issue stage. Because the BRAM/address path has pipeline
      delay before lane_input_logic, the transaction offset maps like this:

        mode1 high issue offset N:
            x1 = operand row N high
            x2 = operand row N+1 high

        mode1 low issue offset N:
            x1 = operand row N-1 low
            x2 = operand row N low

    This matches the observed debug snapshots, e.g. offset 0 high uses
    0x00100 * 0x00020, and offset 1 low uses 0x00120 * 0x00030.
    """
    if mode1_sel_low:
        # Low-half mode is used on odd offsets in this test. It uses the low
        # half from the previous row and current row.
        if offset < 1:
            return None

        l0_x1_18 = lines[PORT_A_BASE + offset - 1][1]
        l0_x2 = lines[PORT_A_BASE + offset][1]
        l1_x1_18 = lines[PORT_B_BASE + offset - 1][1]
        l1_x2 = lines[PORT_B_BASE + offset][1]

    else:
        # High-half mode is used on even offsets in this test. It uses the high
        # half from the current row and the next row.
        if offset + 1 >= NUM_MODE1_ISSUES:
            return None

        l0_x1_18 = lines[PORT_A_BASE + offset][0]
        l0_x2 = lines[PORT_A_BASE + offset + 1][0]
        l1_x1_18 = lines[PORT_B_BASE + offset][0]
        l1_x2 = lines[PORT_B_BASE + offset + 1][0]

    # RTL sign-extends x1 to 24 bits before feeding the DSP A path.
    l0_x1 = sign_extend(l0_x1_18, 18) & ((1 << 24) - 1)
    l1_x1 = sign_extend(l1_x1_18, 18) & ((1 << 24) - 1)

    return l0_x1, l0_x2, l1_x1, l1_x2


def acc_values_from_lines(lines, offset):
    """
    Model the ACC/bypass source selected by addr_srl=11.

    In this test, preload cycles 0..7 produce low-half y2 values. The RTL delay
    is arranged so FMA offset N should see preload offset N at the ALU input.
    """
    l0_acc = lines[ACC_A_BASE + offset][1]
    l1_acc = lines[ACC_B_BASE + offset][1]
    return l0_acc, l1_acc


def expected_fma_transaction(cycle, lines):
    """
    Create expected transaction for a mode-1 issue.

    Returns None for warm-up cycles where lane_input_logic delay taps are not
    valid yet for the selected high/low mode.
    """
    offset = cycle - FMA_START_CYCLE
    mode1_sel_low = offset & 1

    operands = mode1_operands_from_lines(lines, offset, mode1_sel_low)
    if operands is None:
        return None

    l0_x1, l0_x2, l1_x1, l1_x2 = operands
    l0_acc, l1_acc = acc_values_from_lines(lines, offset)

    expected = (
        expected_18b_fma(l0_x1, l0_x2, l0_acc),
        0,
        expected_18b_fma(l1_x1, l1_x2, l1_acc),
        0,
    )

    return FmaExpected(
        issue_cycle=cycle,
        offset=offset,
        mode1_sel_low=mode1_sel_low,
        expected_lanes=expected,
        x_values=(l0_x1, l0_x2, l1_x1, l1_x2),
        acc_values=(l0_acc, l1_acc),
    )


# -----------------------------------------------------------------------------
# Pipeline drive / observe helpers
# -----------------------------------------------------------------------------

def drive_cycle(dut, cycle, lines):
    """
    Drive one cycle of the mode-1 FMA test.

    Returns an FmaExpected transaction if this cycle issued a checkable FMA.
    Warm-up mode-1 cycles still drive RTL, but return None because d1/d2 taps
    are not valid yet for the selected high/low mode.
    """
    if cycle < NUM_ACC_PRELOAD:
        # Preload/prime the bypass path with pass-through mode-0 data.
        drive_pass_mode0(dut)
        drive_bram_read(dut, ACC_A_BASE + cycle, ACC_B_BASE + cycle)
        return None

    if cycle < FMA_START_CYCLE + NUM_MODE1_ISSUES:
        offset = cycle - FMA_START_CYCLE
        mode1_sel_low = offset & 1

        drive_mode1_fma(
            dut,
            mode1_sel_low=mode1_sel_low,
            bypass_acc=1,
        )
        drive_bram_read(dut, PORT_A_BASE + offset, PORT_B_BASE + offset)
        return expected_fma_transaction(cycle, lines)

    # Drain the pipeline. Keep legal control values but stop issuing useful data.
    drive_mode1_fma(dut, mode1_sel_low=1, bypass_acc=0)
    drive_bram_idle(dut)
    return None


def snapshot_debug(dut, cycle, actual):
    """Capture useful debug state when outputs are nonzero or a failure occurs."""
    return {
        "cycle": cycle,
        "actual": actual,
        "l0x1": int(dut.l0x1.value),
        "l0x2": int(dut.l0x2.value),
        "l1x1": int(dut.l1x1.value),
        "l1x2": int(dut.l1x2.value),
        "l0acc_in_d3": int(dut.l0acc_in_d3.value) & WORD_MASK,
        "l1acc_in_d3": int(dut.l1acc_in_d3.value) & WORD_MASK,
        "l0acc2_d3": int(dut.l0acc_in_d3.value) & HALF_MASK,
        "l1acc2_d3": int(dut.l1acc_in_d3.value) & HALF_MASK,
    }


def observe_fma_output(dut, *, cycle, pending_high, pending_low, observed_high_latencies, observed_low_latencies, observed_nonzero):
    actual = lane_outputs(dut)

    if actual != (0, 0, 0, 0):
        observed_nonzero.append(snapshot_debug(dut, cycle, actual))

    # Ordered matching within each mode. Because high/low alternate, keep two
    # queues so a low result does not block a later high result or vice versa.
    if pending_high and actual == pending_high[0].expected_lanes:
        expected = pending_high.pop(0)
        observed_high_latencies.append(cycle - expected.issue_cycle + 1)
        return

    if pending_low and actual == pending_low[0].expected_lanes:
        expected = pending_low.pop(0)
        observed_low_latencies.append(cycle - expected.issue_cycle + 1)
        return


# -----------------------------------------------------------------------------
# Assertion helpers
# -----------------------------------------------------------------------------

def format_lanes(values):
    return (
        f"l0=(0x{values[0]:05x}, 0x{values[1]:05x}) "
        f"l1=(0x{values[2]:05x}, 0x{values[3]:05x})"
    )


def assert_no_pending_fma(dut, pending, observed_nonzero, name):
    if not pending:
        return

    expected = pending[0]
    actual = lane_outputs(dut)

    raise AssertionError(
        f"{name} output not observed for issue cycle {expected.issue_cycle}\n"
        f"offset={expected.offset} mode1_sel_low={expected.mode1_sel_low}\n"
        f"expected {format_lanes(expected.expected_lanes)}\n"
        f"last actual {format_lanes(actual)}\n"
        f"x_values=(l0x1=0x{expected.x_values[0]:06x}, "
        f"l0x2=0x{expected.x_values[1]:05x}, "
        f"l1x1=0x{expected.x_values[2]:06x}, "
        f"l1x2=0x{expected.x_values[3]:05x})\n"
        f"acc_values=(l0acc=0x{expected.acc_values[0]:05x}, "
        f"l1acc=0x{expected.acc_values[1]:05x})\n"
        f"observed nonzero outputs/debug snapshots: {observed_nonzero}"
    )


def check_latency(name, observed, expected=None):
    if not observed:
        raise AssertionError(f"{name}: no matching outputs observed")

    unique = sorted(set(observed))
    if len(unique) != 1:
        raise AssertionError(f"{name}: latency varied: {observed}")

    measured = unique[0]
    if expected is not None and measured != expected:
        raise AssertionError(f"{name}: expected latency {expected}, got {measured}")

    cocotb.log.info(f"{name}: observed latency = {measured} {CLK_NAME} cycles")


# -----------------------------------------------------------------------------
# Main test
# -----------------------------------------------------------------------------

@cocotb.test()
async def test_mode1_bypass_fma_from_bram_48_18b_values(dut):
    await reset_dut(dut)

    lines = make_mode1_test_lines()

    # -------------------------------------------------------------------------
    # 1. Load and sanity-check BRAM contents
    # -------------------------------------------------------------------------
    await load_18b_lines_to_bram(dut, lines, start_addr=0, port="A")

    await check_parallel_bram_read_burst(
        dut,
        lines,
        base_addr=0,
        count=NUM_ACC_PRELOAD,
        name="ACC preload streams",
    )

    await check_bram_rows(
        dut,
        lines,
        start_addr=ACC_B_BASE,
        count=16,
        name="lane 1 ACC/operand stream",
    )

    # -------------------------------------------------------------------------
    # 2. Issue mode-1 FMA operations and observe output
    # -------------------------------------------------------------------------
    pending_high = []
    pending_low = []
    observed_high_latencies = []
    observed_low_latencies = []
    observed_nonzero = []

    for cycle in range(TEST_CYCLES):
        expected = drive_cycle(dut, cycle, lines)
        if expected is not None:
            if expected.mode1_sel_low:
                pending_low.append(expected)
            else:
                pending_high.append(expected)

        await xu_rising_edge(dut)
        await ReadOnly()

        observe_fma_output(
            dut,
            cycle=cycle,
            pending_high=pending_high,
            pending_low=pending_low,
            observed_high_latencies=observed_high_latencies,
            observed_low_latencies=observed_low_latencies,
            observed_nonzero=observed_nonzero,
        )

        await Timer(1, unit="step")

    # -------------------------------------------------------------------------
    # 3. Final checks
    # -------------------------------------------------------------------------
    assert_no_pending_fma(dut, pending_high, observed_nonzero, "mode 1 high FMA")
    assert_no_pending_fma(dut, pending_low, observed_nonzero, "mode 1 low FMA")

    check_latency(
        "mode 1 high FMA",
        observed_high_latencies,
        expected=EXPECTED_HIGH_FMA_LATENCY,
    )

    check_latency(
        "mode 1 low FMA",
        observed_low_latencies,
        expected=EXPECTED_LOW_FMA_LATENCY,
    )
