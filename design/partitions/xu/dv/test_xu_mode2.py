import cocotb
from cocotb.triggers import ReadOnly, RisingEdge, Timer
from dataclasses import dataclass

from design.partitions.xu.dv.test_xu_mode0 import (
    ACC_ADDR_SRL,
    HALF_MASK,
    WORD_MASK,
    drive_xu_ctl,
    load_18b_lines_to_bram,
    pack_bram_word,
    pack_dsp_ctl,
    reset_dut,
)


# -----------------------------------------------------------------------------
# Test configuration
# -----------------------------------------------------------------------------

CLK_NAME = "dsp_clk_div2"
BRAM_IDLE_ADDR = 0x3FF

VAL24_MASK = (1 << 24) - 1
BRAM36_MASK = (1 << 36) - 1

NUM_PRELOAD = 8
NUM_ADDS = 8
PIPELINE_DRAIN_CYCLES = 24
TEST_CYCLES = NUM_PRELOAD + NUM_ADDS + PIPELINE_DRAIN_CYCLES

# Two 36-bit BRAM reads are treated as one 72-bit gearbox word.
# For each logical 72-bit row:
#   ADDR_A reads the lower 36 bits
#   ADDR_B reads the upper 36 bits
PRELOAD_LO_BASE = 0
PRELOAD_HI_BASE = 64
ADD_LO_BASE = 128
ADD_HI_BASE = 192

# Leave as None during bring-up. Fill in once exact latency is stable.
EXPECTED_PRELOAD_LATENCY = None
EXPECTED_ADD_LATENCY = None


# -----------------------------------------------------------------------------
# Transaction objects
# -----------------------------------------------------------------------------

@dataclass
class AccInExpected:
    issue_cycle: int
    offset: int
    phase: str
    slice_sel_24bit: int
    expected_l0: int
    expected_l1: int
    l0_input: int
    l1_input: int
    l0_acc: int = 0
    l1_acc: int = 0


# -----------------------------------------------------------------------------
# Math / packing helpers
# -----------------------------------------------------------------------------

def add24(lhs, rhs):
    return (lhs + rhs) & VAL24_MASK


def pack72_from_slices(slice1, slice2, slice3):
    """
    Pack three 24-bit slices into the two 36-bit BRAM words expected by RTL.

    RTL gearbox:
        slice1_24b = pA_d1[35:12]
        slice2_24b = {pA_d1[11:0], pB_d1[11:0]}
        slice3_24b = pB_d1[35:12]

    Therefore inverse packing is:
        pA[35:12] = slice1[23:0]
        pA[11:0]  = slice2[23:12]
        pB[35:12] = slice3[23:0]
        pB[11:0]  = slice2[11:0]

    The return value is:
        low36  = pA
        high36 = pB
    """
    slice1 &= VAL24_MASK
    slice2 &= VAL24_MASK
    slice3 &= VAL24_MASK

    pA = (slice1 << 12) | ((slice2 >> 12) & 0xFFF)
    pB = (slice3 << 12) | (slice2 & 0xFFF)

    return pA & BRAM36_MASK, pB & BRAM36_MASK


def make_slices_for_lane_pair(l0_value, l1_value, slice_sel_24bit, *, dummy=0):
    """
    Create slice1/slice2/slice3 so lane_input_logic mode 2 selects:
      l0 = l0_value
      l1 = l1_value

    RTL mapping:
      sel 0: l0=slice1, l1=slice2
      sel 1: l0=slice2, l1=slice3
      sel 2: l0=slice3, l1=slice1
    """
    l0_value &= VAL24_MASK
    l1_value &= VAL24_MASK
    dummy &= VAL24_MASK

    if slice_sel_24bit == 0:
        return l0_value, l1_value, dummy
    if slice_sel_24bit == 1:
        return dummy, l0_value, l1_value
    if slice_sel_24bit == 2:
        return l1_value, dummy, l0_value

    raise ValueError(f"invalid slice_sel_24bit={slice_sel_24bit}")


def split24_for_debug(value):
    return ((value >> 18) & 0x3F, value & HALF_MASK)


def acc_in_values(dut):
    """
    Read mode-2 result from l0acc_in/l1acc_in.

    Assumption: lane_output_logic places the 24-bit value in the low 24 bits of
    the 36-bit ACC input word. If your RTL packs this differently, adjust here.
    """
    return (
        int(dut.l0acc_in.value) & VAL24_MASK,
        int(dut.l1acc_in.value) & VAL24_MASK,
    )


# -----------------------------------------------------------------------------
# Control helpers
# -----------------------------------------------------------------------------

def dsp_add_ctl():
    """DSP48 control word used by this test for add/pass-through style ops."""
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


def drive_mode2_add(dut, *, slice_sel_24bit, acc_ce, bypass_acc=0):
    ctl = dsp_add_ctl()
    drive_xu_ctl(
        dut,
        l0dsp_control=ctl,
        l1dsp_control=ctl,
        mode=2,
        slice_sel_24bit=slice_sel_24bit,
        addr_srl=ACC_ADDR_SRL,
        acc_ce=acc_ce,
        bypass_acc=bypass_acc,
    )


# -----------------------------------------------------------------------------
# Clock / DUT IO helpers
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


async def write_bram36_words_port_a(dut, words, *, start_addr):
    """Write a list of raw 36-bit words into BRAM using port A."""
    dut.EN_A.value = 1
    dut.WE_A.value = 1

    for offset, word in enumerate(words):
        dut.ADDR_A.value = start_addr + offset
        dut.DI_A.value = word & BRAM36_MASK
        await xu_rising_edge(dut)

    dut.WE_A.value = 0
    dut.DI_A.value = 0


async def load_72_rows_to_bram(dut, rows, *, lo_base, hi_base):
    """
    Load logical 72-bit rows into BRAM.

    Each row is a tuple:
      (slice1, slice2, slice3)

    The lower 36 bits are written to lo_base+index.
    The upper 36 bits are written to hi_base+index.
    """
    low_words = []
    high_words = []

    for slice1, slice2, slice3 in rows:
        low36, high36 = pack72_from_slices(slice1, slice2, slice3)
        low_words.append(low36)
        high_words.append(high36)

    await write_bram36_words_port_a(dut, low_words, start_addr=lo_base)
    await write_bram36_words_port_a(dut, high_words, start_addr=hi_base)


# -----------------------------------------------------------------------------
# Test data / expected model
# -----------------------------------------------------------------------------

def make_mode2_values():
    """Return preload and add streams for both lanes."""
    preload_l0 = [
        0x000003, 0x000005, 0x000007, 0x00000B,
        0x00000D, 0x000011, 0x000013, 0x000017,
    ]
    preload_l1 = [
        0x000019, 0x00001D, 0x00001F, 0x000025,
        0x000029, 0x00002B, 0x00002F, 0x000035,
    ]

    add_l0 = [
        0x000100, 0x000020, 0x000140, 0x000040,
        0x000180, 0x000060, 0x0001C0, 0x000080,
    ]
    add_l1 = [
        0x000200, 0x0000A0, 0x000240, 0x0000C0,
        0x000280, 0x0000E0, 0x0002C0, 0x000100,
    ]

    assert len(preload_l0) == NUM_PRELOAD
    assert len(preload_l1) == NUM_PRELOAD
    assert len(add_l0) == NUM_ADDS
    assert len(add_l1) == NUM_ADDS

    return preload_l0, preload_l1, add_l0, add_l1


def make_72_rows_for_lane_pairs(l0_values, l1_values):
    """
    Build 72-bit rows such that each cycle's slice_sel selects one l0/l1 pair.

    The slice select pattern is 0,1,2,0,1,2,... to exercise all three cases in
    lane_input_logic mode 2.
    """
    rows = []
    sels = []

    for i, (l0_value, l1_value) in enumerate(zip(l0_values, l1_values)):
        sel = i % 3
        dummy = 0xAB0000 | i
        rows.append(make_slices_for_lane_pair(l0_value, l1_value, sel, dummy=dummy))
        sels.append(sel)

    return rows, sels


def expected_preload_transaction(cycle, offset, sel, preload_l0, preload_l1):
    return AccInExpected(
        issue_cycle=cycle,
        offset=offset,
        phase="preload",
        slice_sel_24bit=sel,
        expected_l0=preload_l0[offset] & VAL24_MASK,
        expected_l1=preload_l1[offset] & VAL24_MASK,
        l0_input=preload_l0[offset] & VAL24_MASK,
        l1_input=preload_l1[offset] & VAL24_MASK,
    )


def expected_add_transaction(cycle, offset, sel, preload_l0, preload_l1, add_l0, add_l1):
    return AccInExpected(
        issue_cycle=cycle,
        offset=offset,
        phase="add",
        slice_sel_24bit=sel,
        expected_l0=add24(preload_l0[offset], add_l0[offset]),
        expected_l1=add24(preload_l1[offset], add_l1[offset]),
        l0_input=add_l0[offset] & VAL24_MASK,
        l1_input=add_l1[offset] & VAL24_MASK,
        l0_acc=preload_l0[offset] & VAL24_MASK,
        l1_acc=preload_l1[offset] & VAL24_MASK,
    )


# -----------------------------------------------------------------------------
# Pipeline drive / observe helpers
# -----------------------------------------------------------------------------

def drive_cycle(dut, cycle, *, preload_sels, add_sels, preload_l0, preload_l1, add_l0, add_l1):
    """
    Drive one test cycle.

    Phase 1: preload 8 24-bit ACC values per lane.
    Phase 2: add 8 new 24-bit values per lane against the preloaded ACC values.
    """
    if cycle < NUM_PRELOAD:
        offset = cycle
        sel = preload_sels[offset]
        drive_mode2_add(dut, slice_sel_24bit=sel, acc_ce=1, bypass_acc=0)
        drive_bram_read(dut, PRELOAD_LO_BASE + offset, PRELOAD_HI_BASE + offset)
        return expected_preload_transaction(cycle, offset, sel, preload_l0, preload_l1)

    if cycle < NUM_PRELOAD + NUM_ADDS:
        offset = cycle - NUM_PRELOAD
        sel = add_sels[offset]
        # Use bypass for the add phase. The preloaded mode-2 outputs are visible
        # on l*acc_in_d3 at the ALU-input stage before they are available from
        # l*acc_out. This allows the add burst to start immediately after the
        # preload burst instead of waiting for the ACC SRL/register read path.
        drive_mode2_add(dut, slice_sel_24bit=sel, acc_ce=1, bypass_acc=1)
        drive_bram_read(dut, ADD_LO_BASE + offset, ADD_HI_BASE + offset)
        return expected_add_transaction(cycle, offset, sel, preload_l0, preload_l1, add_l0, add_l1)

    drive_mode2_add(dut, slice_sel_24bit=0, acc_ce=0, bypass_acc=0)
    drive_bram_idle(dut)
    return None


def snapshot_debug(dut, cycle, actual):
    return {
        "cycle": cycle,
        "actual_l0acc_in": actual[0],
        "actual_l1acc_in": actual[1],
        "l0x1": int(dut.l0x1.value),
        "l0x2": int(dut.l0x2.value),
        "l1x1": int(dut.l1x1.value),
        "l1x2": int(dut.l1x2.value),
        "l0acc_in_raw": int(dut.l0acc_in.value) & WORD_MASK,
        "l1acc_in_raw": int(dut.l1acc_in.value) & WORD_MASK,
        "l0acc_out_raw": int(dut.l0acc_out.value) & WORD_MASK,
        "l1acc_out_raw": int(dut.l1acc_out.value) & WORD_MASK,
        "l0acc_in_d3_raw": int(dut.l0acc_in_d3.value) & WORD_MASK,
        "l1acc_in_d3_raw": int(dut.l1acc_in_d3.value) & WORD_MASK,
        "l0acc_in_d3_24": int(dut.l0acc_in_d3.value) & VAL24_MASK,
        "l1acc_in_d3_24": int(dut.l1acc_in_d3.value) & VAL24_MASK,
    }


def observe_acc_in_output(dut, *, cycle, pending_preload, pending_add, observed_preload_latencies, observed_add_latencies, observed_nonzero):
    actual = acc_in_values(dut)

    if actual != (0, 0):
        observed_nonzero.append(snapshot_debug(dut, cycle, actual))

    # Check preload and add queues separately. This avoids a later add result
    # being blocked by an earlier preload value with different latency.
    if pending_preload and actual == (pending_preload[0].expected_l0, pending_preload[0].expected_l1):
        expected = pending_preload.pop(0)
        observed_preload_latencies.append(cycle - expected.issue_cycle + 1)
        return

    if pending_add and actual == (pending_add[0].expected_l0, pending_add[0].expected_l1):
        expected = pending_add.pop(0)
        observed_add_latencies.append(cycle - expected.issue_cycle + 1)
        return


# -----------------------------------------------------------------------------
# Assertion helpers
# -----------------------------------------------------------------------------

def assert_no_pending(dut, pending, observed_nonzero, name):
    if not pending:
        return

    expected = pending[0]
    actual = acc_in_values(dut)

    raise AssertionError(
        f"{name} result not observed\n"
        f"issue_cycle={expected.issue_cycle} offset={expected.offset} "
        f"phase={expected.phase} slice_sel={expected.slice_sel_24bit}\n"
        f"expected l0=0x{expected.expected_l0:06x} "
        f"l1=0x{expected.expected_l1:06x}\n"
        f"last actual l0=0x{actual[0]:06x} l1=0x{actual[1]:06x}\n"
        f"inputs l0=0x{expected.l0_input:06x} l1=0x{expected.l1_input:06x}\n"
        f"accs   l0=0x{expected.l0_acc:06x} l1=0x{expected.l1_acc:06x}\n"
        f"observed nonzero/debug snapshots: {observed_nonzero}"
    )


def check_latency(name, observed, expected=None):
    if not observed:
        raise AssertionError(f"{name}: no matching transactions observed")

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
async def test_mode2_preload_then_add_8x24b_per_lane(dut):
    await reset_dut(dut)

    preload_l0, preload_l1, add_l0, add_l1 = make_mode2_values()

    preload_rows, preload_sels = make_72_rows_for_lane_pairs(preload_l0, preload_l1)
    add_rows, add_sels = make_72_rows_for_lane_pairs(add_l0, add_l1)

    # -------------------------------------------------------------------------
    # 1. Load logical 72-bit rows into BRAM
    # -------------------------------------------------------------------------
    await load_72_rows_to_bram(
        dut,
        preload_rows,
        lo_base=PRELOAD_LO_BASE,
        hi_base=PRELOAD_HI_BASE,
    )

    await load_72_rows_to_bram(
        dut,
        add_rows,
        lo_base=ADD_LO_BASE,
        hi_base=ADD_HI_BASE,
    )

    # -------------------------------------------------------------------------
    # 2. Run preload + add phases
    # -------------------------------------------------------------------------
    pending_preload = []
    pending_add = []
    observed_preload_latencies = []
    observed_add_latencies = []
    observed_nonzero = []

    for cycle in range(TEST_CYCLES):
        expected = drive_cycle(
            dut,
            cycle,
            preload_sels=preload_sels,
            add_sels=add_sels,
            preload_l0=preload_l0,
            preload_l1=preload_l1,
            add_l0=add_l0,
            add_l1=add_l1,
        )

        if expected is not None:
            if expected.phase == "preload":
                pending_preload.append(expected)
            elif expected.phase == "add":
                pending_add.append(expected)
            else:
                raise RuntimeError(f"unknown phase {expected.phase!r}")

        await xu_rising_edge(dut)
        await ReadOnly()

        observe_acc_in_output(
            dut,
            cycle=cycle,
            pending_preload=pending_preload,
            pending_add=pending_add,
            observed_preload_latencies=observed_preload_latencies,
            observed_add_latencies=observed_add_latencies,
            observed_nonzero=observed_nonzero,
        )

        await Timer(1, unit="step")

    # -------------------------------------------------------------------------
    # 3. Final checks
    # -------------------------------------------------------------------------
    assert_no_pending(dut, pending_preload, observed_nonzero, "mode 2 preload")
    assert_no_pending(dut, pending_add, observed_nonzero, "mode 2 add")

    check_latency(
        "mode 2 preload",
        observed_preload_latencies,
        expected=EXPECTED_PRELOAD_LATENCY,
    )

    check_latency(
        "mode 2 add",
        observed_add_latencies,
        expected=EXPECTED_ADD_LATENCY,
    )
