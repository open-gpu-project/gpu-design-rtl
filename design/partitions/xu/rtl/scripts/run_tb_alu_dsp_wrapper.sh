#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
cd ..

iverilog -g2012 -I. -o out/tb_alu_dsp_wrapper.out \
  tb_alu_dsp_wrapper.sv \
  alu_dsp_wrapper.sv ../../../libraries/unisim/DSP48E1.sv

vvp tb_alu_dsp_wrapper.out
