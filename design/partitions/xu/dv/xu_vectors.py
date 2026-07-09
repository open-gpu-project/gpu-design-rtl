"""Human-readable per-cycle vector files for XU programs.

`emit` writes an assembled program as YAML: one block per issue cycle with
the named xu_ctl fields, BRAM addresses, and (for computing ops) the expected
lane outputs with the absolute cycle they must appear on. Comments carry the
operand provenance from the golden model so a block can be verified by eye.

`load` parses the file back with yaml.safe_load; comments are for humans
only, everything the runner needs is data. run_program drives the DUT from
the loaded data, never from the in-memory assemble() result, so the file is
always exactly what was driven.

The file is hand-formatted (pyyaml cannot write comments) but is strict YAML.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from design.partitions.xu.dv.xu_tb import HALF_MASK

# Scalar ctl fields in emission order; l0dsp/l1dsp are handled separately.
CTL_FIELDS = ("mode", "slice_sel_24bit", "mode1_sel_low", "acc_raddr", "acc_waddr",
              "acc_we", "bypass_acc")
LANE_NAMES = ("l0y1", "l0y2", "l1y1", "l1y2")

# Binary-formatted DSP fields (bit width); the rest print as plain ints.
_DSP_BIN = {"OPMODE": 7, "INMODE": 5, "ALUMODE": 4, "CEA": 2, "CEB": 2}


@dataclass
class LoadedCycle:
   cycle: int
   op: str
   addr_a: int
   addr_b: int
   ctl: dict
   check: dict | None  # {"at": int, "l0y1": int, ...} or None


def _dsp_val(key: str, val: int) -> str:
   width = _DSP_BIN.get(key)
   return f"0b{val:0{width}b}" if width else str(val)


def emit(name: str, bram: dict[int, int], drives, predictions, path: Path):
   pred_by_issue = {p.op_index: p for p in predictions}
   lines = [
       f"# xu program vectors v1 — {name}",
       "# One block per issue cycle. check.at is the absolute cycle (same",
       "# numbering as the drive loop) on which the lane outputs must match.",
   ]

   if bram:
      lines.append("bram:")
      for addr, word in sorted(bram.items()):
         lines.append(f"   0x{addr:03x}: 0x{word:09x}"
                      f"  # hi 0x{(word >> 18) & HALF_MASK:05x}, lo 0x{word & HALF_MASK:05x}")
   else:
      lines.append("bram: {}")

   lines.append("cycles:")
   dsp_anchors: dict[tuple, str] = {}
   for i, d in enumerate(drives):
      lines.append(f"   - cycle: {i}")
      lines.append(f"     op: '{d.op_repr}'")
      lines.append(f"     addr_a: 0x{d.addr_a:03x}")
      lines.append(f"     addr_b: 0x{d.addr_b:03x}")
      lines.append("     ctl:")
      for key in CTL_FIELDS:
         lines.append(f"        {key}: {d.ctl[key]}")
      for lane in ("l0dsp", "l1dsp"):
         kw = d.ctl[lane]
         sig = tuple(sorted(kw.items()))
         if sig in dsp_anchors:
            lines.append(f"        {lane}: *{dsp_anchors[sig]}")
         else:
            anchor = f"dsp{len(dsp_anchors)}"
            dsp_anchors[sig] = anchor
            body = ", ".join(f"{k}: {_dsp_val(k, v)}" for k, v in kw.items())
            lines.append(f"        {lane}: &{anchor} {{{body}}}")
      pred = pred_by_issue.get(i)
      if pred is not None:
         lines.append("     check:")
         lines.append(f"        at: {pred.observe_iter}  # {pred.acc_note}")
         for lane_name, val in zip(LANE_NAMES, pred.lanes):
            note = pred.notes.get(lane_name)
            comment = f"  # {note}" if note else ""
            lines.append(f"        {lane_name}: 0x{val:05x}{comment}")

   path.write_text("\n".join(lines) + "\n")


def load(path: Path) -> tuple[dict[int, int], list[LoadedCycle]]:
   doc = yaml.safe_load(path.read_text())
   bram = doc.get("bram") or {}
   cycles = [
       LoadedCycle(
           cycle=c["cycle"],
           op=c.get("op", ""),
           addr_a=c["addr_a"],
           addr_b=c["addr_b"],
           ctl=c["ctl"],
           check=c.get("check"),
       ) for c in doc["cycles"]
   ]
   return bram, cycles
