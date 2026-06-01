import cocotb
from cocotb.triggers import ReadOnly, RisingEdge, Timer
from dataclasses import dataclass

from design.partitions.xu.dv.test_xu_mode0 import (
    ACC_ADDR_SRL,
    HALF_MASK,
    WORD_MASK,
    drive_xu_ctl,
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
NUM_FMA = 8
PIPELINE_DRAIN_CYCLES = 32
TEST_CYCLES = NUM_PRELOAD + NUM_FMA + PIPELINE_DRAIN_CYCLES

# Logical 72-bit rows are stored as two 36-bit BRAM words.
PRELOAD_LO_BASE = 0
PRELOAD_HI_BASE = 64
FMA_LO_BASE = 128
FMA_HI_BASE = 192

# Leave as None during bring-up. Fill in once exact latency is stable.
EXPECTED_PRELOAD_LATENCY = None
EXPECTED_FMA_LATENCY = None


# -----------------------------------------------------------------------------
# Transaction objects
# -----------------------------------------------------------------------------

@dataclass
class Mode3Expected:
    issue_cycle: int
    offset: int
    phase: str
    slice_sel_24bit: int
    expected_l0: int
    expected_l1: int
    a_value: int = 0
    b_value: int = 0
    acc_value: int = 0


# -----------------------------------------------------------------------------
# Math / packing helpers
# -----------------------------------------------------------------------------

def sign_extend(value, bits):
    sign_bit = 1 << (bits - 1)
    return (value ^ sign_bit) - sign_bit


def fma24_expected(a, b, acc, *, fxp_loc=8):
    """
    Expected 24-bit fixed-point FMA:

        result = ((signed24(a) * signed24(b)) + (signed24(acc) << fxp_loc)) >> fxp_loc

    For positive test values this is simply:

        result = ((a * b) >> 8) + acc
    """
    product = sign_extend(a, 24) * sign_extend(b, 24)
    accum = sign_extend(acc, 24) << fxp_loc
    return ((product + accum) >> fxp_loc) & VAL24_MASK


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

    Return:
        low36  = pA
        high36 = pB
    """
    slice1 &= VAL24_MASK
    slice2 &= VAL24_MASK
    slice3 &= VAL24_MASK

    pA = (slice1 << 12) | ((slice2 >> 12) & 0xFFF)
    pB = (slice3 << 12) | (slice2 & 0xFFF)

    return pA & BRAM36_MASK, pB & BRAM36_MASK


def make_slices_for_mode2_lane_pair(l0_value, l1_value, slice_sel_24bit, *, dummy=0):
    """
    Build slices for mode 2 preload so lane_input_logic selects:
      l0 = l0_value
      l1 = l1_value

    Mode 2 mapping:
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


def make_slices_for_mode3_fma(a_value, b_value, slice_sel_24bit, *, dummy=0):
    """
    Build slices for mode 3 / RTL mode 2'b11 FMA.

    Mode 3 input mapping from lane_input_logic:
      sel 0: a=slice1, b=slice2
      sel 1: a=slice2, b=slice3
      sel 2: a=slice3, b=slice1

    The RTL then sends:
      l0: a and upper signed part of b
      l1: a and lower part of b
    so the two physical lanes cooperate on one 24-bit FMA.
    """
    a_value &= VAL24_MASK
    b_value &= VAL24_MASK
    dummy &= VAL24_MASK

    if slice_sel_24bit == 0:
        return a_value, b_value, dummy
    if slice_sel_24bit == 1:
        return dummy, a_value, b_value
    if slice_sel_24bit == 2:
        return b_value, dummy, a_value

    raise ValueError(f"invalid slice_sel_24bit={slice_sel_24bit}")


def acc_in_values(dut):
    """
    Read 24-bit result from l0acc_in/l1acc_in.

    Assumption: lane_output_logic stores the useful 24-bit result in low [23:0]
    of the 36-bit ACC input word. If your RTL packs mode 3 differently, adjust
    this function only.
    """
    return (
        int(dut.l0acc_in.value) & VAL24_MASK,
        int(dut.l1acc_in.value) & VAL24_MASK,
    )


# -----------------------------------------------------------------------------
# Control helpers
# -----------------------------------------------------------------------------

def dsp_add_ctl():
    """DSP48 control for add/pass-through style mode-2 preload."""
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
    """DSP48 control for multiply-add modes."""
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


def drive_mode2_preload(dut, *, slice_sel_24bit, acc_ce=1):
    ctl = dsp_add_ctl()
    drive_xu_ctl(
        dut,
        l0dsp_control=ctl,
        l1dsp_control=ctl,
        mode=2,
        slice_sel_24bit=slice_sel_24bit,
        addr_srl=ACC_ADDR_SRL,
        acc_ce=acc_ce,
        bypass_acc=0,
    )


def drive_mode3_fma(dut, *, slice_sel_24bit, bypass_acc=1, acc_ce=1):
    ctl = dsp_fma_ctl()
    drive_xu_ctl(
        dut,
        l0dsp_control=ctl,
        l1dsp_control=ctl,
        mode=3,
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
    dut.EN_A.value = 1
    dut.WE_A.value = 1

    for offset, word in enumerate(words):
        dut.ADDR_A.value = start_addr + offset
        dut.DI_A.value = word & BRAM36_MASK
        await xu_rising_edge(dut)

    dut.WE_A.value = 0
    dut.DI_A.value = 0


async def load_72_rows_to_bram(dut, rows, *, lo_base, hi_base):
    low_words = []
    high_words = []

    for slice1, slice2, slice3 in rows:
        low36, high36 = pack72_from_slices(slice1, slice2, slice3)
        low_words.append(low36)
        high_words.append(high36)

    await write_bram36_words_port_a(dut, low_words, start_addr=lo_base)
    await write_bram36_words_port_a(dut, high_words, start_addr=hi_base)


# Optional cascade bridge.
# If your top-level does not internally connect l0dsp_casc_out -> l1dsp_casc_in,
# mode-3 24-bit FMA may require a bridge like this. Enable it only if needed.
async def bridge_dsp_cascade(dut):
    while True:
        await RisingEdge(dut.dsp_clk)
        await ReadOnly()
        value = dut.l0dsp_casc_out.value
        await Timer(1, unit="step")
        dut.l1dsp_casc_in.value = value


# -----------------------------------------------------------------------------
# Test data / expected model
# -----------------------------------------------------------------------------

def make_mode3_values():
    # Keep values small/positive first. Add signed edge cases after basic timing
    # and cascade behavior are proven.
    acc_values = [
        0x000003, 0x000005, 0x000007, 0x00000B,
        0x00000D, 0x000011, 0x000013, 0x000017,
    ]

    a_values = [
        0x000100, 0x000120, 0x000140, 0x000160,
        0x000180, 0x0001A0, 0x0001C0, 0x0001E0,
    ]

    b_values = [
        0x000020, 0x000030, 0x000040, 0x000050,
        0x000060, 0x000070, 0x000080, 0x000090,
    ]

    assert len(acc_values) == NUM_PRELOAD
    assert len(a_values) == NUM_FMA
    assert len(b_values) == NUM_FMA

    return acc_values, a_values, b_values


def make_preload_rows(acc_values):
    """
    Preload the same 24-bit ACC value into both physical ACC paths.

    For mode-3 FMA the two physical lanes cooperate on one 24-bit result, so
    preloading both l0/l1 with the same value is a useful first sanity test.
    """
    rows = []
    sels = []

    for i, acc in enumerate(acc_values):
        sel = i % 3
        rows.append(make_slices_for_mode2_lane_pair(acc, acc, sel, dummy=0xA00000 | i))
        sels.append(sel)

    return rows, sels


def make_fma_rows(a_values, b_values):
    rows = []
    sels = []

    for i, (a, b) in enumerate(zip(a_values, b_values)):
        sel = i % 3
        rows.append(make_slices_for_mode3_fma(a, b, sel, dummy=0xB00000 | i))
        sels.append(sel)

    return rows, sels


def expected_preload_transaction(cycle, offset, sel, acc_values):
    acc = acc_values[offset] & VAL24_MASK
    return Mode3Expected(
        issue_cycle=cycle,
        offset=offset,
        phase="preload",
        slice_sel_24bit=sel,
        expected_l0=acc,
        expected_l1=acc,
        acc_value=acc,
    )


def expected_fma_transaction(cycle, offset, sel, acc_values, a_values, b_values):
    acc = acc_values[offset] & VAL24_MASK
    a = a_values[offset] & VAL24_MASK
    b = b_values[offset] & VAL24_MASK
    result = fma24_expected(a, b, acc)

    return Mode3Expected(
        issue_cycle=cycle,
        offset=offset,
        phase="fma",
        slice_sel_24bit=sel,
        expected_l0=result,
        expected_l1=result,
        a_value=a,
        b_value=b,
        acc_value=acc,
    )


# -----------------------------------------------------------------------------
# Pipeline drive / observe helpers
# -----------------------------------------------------------------------------

def drive_cycle(dut, cycle, *, preload_sels, fma_sels, acc_values, a_values, b_values):
    if cycle < NUM_PRELOAD:
        offset = cycle
        sel = preload_sels[offset]
        drive_mode2_preload(dut, slice_sel_24bit=sel, acc_ce=1)
        drive_bram_read(dut, PRELOAD_LO_BASE + offset, PRELOAD_HI_BASE + offset)
        return expected_preload_transaction(cycle, offset, sel, acc_values)

    if cycle < NUM_PRELOAD + NUM_FMA:
        offset = cycle - NUM_PRELOAD
        sel = fma_sels[offset]
        drive_mode3_fma(dut, slice_sel_24bit=sel, bypass_acc=1, acc_ce=1)
        drive_bram_read(dut, FMA_LO_BASE + offset, FMA_HI_BASE + offset)
        return expected_fma_transaction(cycle, offset, sel, acc_values, a_values, b_values)

    drive_mode3_fma(dut, slice_sel_24bit=0, bypass_acc=0, acc_ce=0)
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
        "l0acc_in_d3_raw": int(dut.l0acc_in_d3.value) & WORD_MASK,
        "l1acc_in_d3_raw": int(dut.l1acc_in_d3.value) & WORD_MASK,
        "l0acc_out_raw": int(dut.l0acc_out.value) & WORD_MASK,
        "l1acc_out_raw": int(dut.l1acc_out.value) & WORD_MASK,
        "l0dsp_casc_out": int(dut.l0dsp_casc_out.value),
        "l1dsp_casc_in": int(dut.l1dsp_casc_in.value),
    }


def observe_output(dut, *, cycle, pending_preload, pending_fma, observed_preload_latencies, observed_fma_latencies, observed_nonzero):
    actual = acc_in_values(dut)

    if actual != (0, 0):
        observed_nonzero.append(snapshot_debug(dut, cycle, actual))

    if pending_preload and actual == (pending_preload[0].expected_l0, pending_preload[0].expected_l1):
        expected = pending_preload.pop(0)
        observed_preload_latencies.append(cycle - expected.issue_cycle + 1)
        return

    if pending_fma and actual == (pending_fma[0].expected_l0, pending_fma[0].expected_l1):
        expected = pending_fma.pop(0)
        observed_fma_latencies.append(cycle - expected.issue_cycle + 1)
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
        f"a=0x{expected.a_value:06x} b=0x{expected.b_value:06x} "
        f"acc=0x{expected.acc_value:06x}\n"
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
async def test_mode3_24bit_fma_preload_then_fma(dut):
    await reset_dut(dut)

    # Uncomment this only if your top-level does not internally connect the DSP
    # cascade path required by mode-3 24-bit FMA.
    # cocotb.start_soon(bridge_dsp_cascade(dut))

    acc_values, a_values, b_values = make_mode3_values()

    preload_rows, preload_sels = make_preload_rows(acc_values)
    fma_rows, fma_sels = make_fma_rows(a_values, b_values)

    # -------------------------------------------------------------------------
    # 1. Load preload rows and FMA rows into BRAM
    # -------------------------------------------------------------------------
    await load_72_rows_to_bram(
        dut,
        preload_rows,
        lo_base=PRELOAD_LO_BASE,
        hi_base=PRELOAD_HI_BASE,
    )

    await load_72_rows_to_bram(
        dut,
        fma_rows,
        lo_base=FMA_LO_BASE,
        hi_base=FMA_HI_BASE,
    )

    # -------------------------------------------------------------------------
    # 2. Run preload + FMA phases
    # -------------------------------------------------------------------------
    pending_preload = []
    pending_fma = []
    observed_preload_latencies = []
    observed_fma_latencies = []
    observed_nonzero = []

    for cycle in range(TEST_CYCLES):
        expected = drive_cycle(
            dut,
            cycle,
            preload_sels=preload_sels,
            fma_sels=fma_sels,
            acc_values=acc_values,
            a_values=a_values,
            b_values=b_values,
        )

        if expected is not None:
            if expected.phase == "preload":
                pending_preload.append(expected)
            elif expected.phase == "fma":
                pending_fma.append(expected)
            else:
                raise RuntimeError(f"unknown phase {expected.phase!r}")

        await xu_rising_edge(dut)
        await ReadOnly()

        observe_output(
            dut,
            cycle=cycle,
            pending_preload=pending_preload,
            pending_fma=pending_fma,
            observed_preload_latencies=observed_preload_latencies,
            observed_fma_latencies=observed_fma_latencies,
            observed_nonzero=observed_nonzero,
        )

        await Timer(1, unit="step")

    # -------------------------------------------------------------------------
    # 3. Final checks
    # -------------------------------------------------------------------------
    assert_no_pending(dut, pending_preload, observed_nonzero, "mode 3 preload")
    assert_no_pending(dut, pending_fma, observed_nonzero, "mode 3 24-bit FMA")

    check_latency(
        "mode 3 preload",
        observed_preload_latencies,
        expected=EXPECTED_PRELOAD_LATENCY,
    )

    check_latency(
        "mode 3 24-bit FMA",
        observed_fma_latencies,
        expected=EXPECTED_FMA_LATENCY,
    )
