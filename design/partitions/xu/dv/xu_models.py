"""Pure Python reference models and packing helpers for XU tests."""

from design.partitions.xu.dv.xu_tb import BRAM36_MASK, HALF_MASK, VAL24_MASK, WORD_MASK


def sign_extend(value: int, bits: int) -> int:
   sign_bit = 1 << (bits - 1)
   return (value ^ sign_bit) - sign_bit


def add18(a: int, b: int) -> int:
   return (a + b) & HALF_MASK


def add24(a: int, b: int) -> int:
   return (a + b) & VAL24_MASK


def fma18_expected(x1: int, x2: int, acc: int, *, fxp_loc=8) -> int:
   product = sign_extend(x1, 24) * sign_extend(x2, 18)
   accum = sign_extend(acc, 18) << fxp_loc
   return ((product + accum) >> fxp_loc) & HALF_MASK


def fma24_expected(a: int, b: int, acc: int, *, fxp_loc=8) -> int:
   product = sign_extend(a, 24) * sign_extend(b, 24)
   accum = sign_extend(acc, 24) << fxp_loc
   return ((product + accum) >> fxp_loc) & VAL24_MASK


def pack18_pair(high18: int, low18: int) -> int:
   return (((high18 & HALF_MASK) << 18) | (low18 & HALF_MASK)) & WORD_MASK


def unpack18_pair(word: int) -> tuple[int, int]:
   return ((word >> 18) & HALF_MASK, word & HALF_MASK)


def pack72_from_slices(slice1: int, slice2: int, slice3: int) -> tuple[int, int]:
   """Inverse of RTL gearbox.

    RTL:
      slice1 = pA[35:12]
      slice2 = {pA[11:0], pB[11:0]}
      slice3 = pB[35:12]
    """
   slice1 &= VAL24_MASK
   slice2 &= VAL24_MASK
   slice3 &= VAL24_MASK

   pA = (slice1 << 12) | ((slice2 >> 12) & 0xFFF)
   pB = (slice3 << 12) | (slice2 & 0xFFF)
   return pA & BRAM36_MASK, pB & BRAM36_MASK


def make_mode2_slices(l0: int, l1: int, sel: int, *, dummy=0) -> tuple[int, int, int]:
   l0 &= VAL24_MASK
   l1 &= VAL24_MASK
   dummy &= VAL24_MASK
   if sel == 0:
      return l0, l1, dummy
   if sel == 1:
      return dummy, l0, l1
   if sel == 2:
      return l1, dummy, l0
   raise ValueError(sel)


def make_mode3_slices(a: int, b: int, sel: int, *, dummy=0) -> tuple[int, int, int]:
   a &= VAL24_MASK
   b &= VAL24_MASK
   dummy &= VAL24_MASK
   if sel == 0:
      return a, b, dummy
   if sel == 1:
      return dummy, a, b
   if sel == 2:
      return b, dummy, a
   raise ValueError(sel)
