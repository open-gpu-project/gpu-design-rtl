"""Control-word ABI checks; run with pytest without a simulator."""

import pytest

from design.partitions.xu.dv.xu_tb import BRAM_IDLE_ADDR, pack_xu_ctl


# Bit ranges of xu_priv::xu_ctl, including reserved enum encodings.
FIELDS = (
    ("addr_a", 143, 134), ("en_a", 133, 133), ("we_a", 132, 129),
    ("addr_b", 128, 119), ("en_b", 118, 118), ("we_b", 117, 114),
    ("l0dsp_control", 113, 89), ("l1dsp_control", 88, 64),
    ("mode", 63, 61), ("slice_sel_24bit", 60, 59),
    ("mode1_sel_low", 58, 58), ("acc_raddr", 57, 53),
    ("acc_waddr", 52, 48), ("acc_we", 47, 47),
    ("pred_raddr", 46, 42), ("pred_waddr", 41, 37),
    ("pred_we", 36, 36), ("pred_enable", 35, 35),
    ("pred_invert", 34, 34), ("pred_cond", 33, 31),
    ("zero_bram_operands", 30, 30),
    ("l0_wb_valid", 29, 29), ("l1_wb_valid", 28, 28),
    ("wb_we_a", 27, 24), ("wb_we_b", 23, 20),
    ("wb_addr_a", 19, 10), ("wb_addr_b", 9, 0),
)


@pytest.mark.parametrize("name,msb,lsb", FIELDS)
def test_field_boundaries(name, msb, lsb):
    fields = dict.fromkeys((field[0] for field in FIELDS), 0)
    width = msb - lsb + 1
    for bit in range(width):
        fields[name] = 1 << bit
        assert pack_xu_ctl(**fields) == 1 << (lsb + bit)
    fields[name] = 1 << width
    assert pack_xu_ctl(**fields) == 0


def test_full_word_and_defaults():
    fields = {name: (1 << (msb - lsb + 1)) - 1 for name, msb, lsb in FIELDS}
    assert pack_xu_ctl(**fields) == (1 << 144) - 1
    assert pack_xu_ctl() == (
        (BRAM_IDLE_ADDR << 134) | (1 << 133)
        | (BRAM_IDLE_ADDR << 119) | (1 << 118)
    )


def test_cmp18_with_predicate_controls():
    word = pack_xu_ctl(mode=4, pred_raddr=17, pred_waddr=23,
                       pred_we=1, pred_enable=1, pred_invert=1, pred_cond=5)
    assert word == (pack_xu_ctl() | (4 << 61) | (17 << 42) | (23 << 37)
                    | (1 << 36) | (1 << 35) | (1 << 34) | (5 << 31))
