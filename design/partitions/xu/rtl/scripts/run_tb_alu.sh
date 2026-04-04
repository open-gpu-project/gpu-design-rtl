#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
cd ..

iverilog -g2012 -I. -o out/tb_alu.out \
  tb_alu.sv alu.sv\
  alu_lane.sv alu_dsp_wrapper.sv ../../../libraries/unisim/DSP48E1.sv

vvp out/tb_alu.out