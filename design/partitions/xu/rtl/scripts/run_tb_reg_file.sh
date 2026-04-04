#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"
cd ..

iverilog -g2012 -o out/tb_reg_file.out \
  tb_reg_file.sv \
  reg_file.sv \
  bram_wrapper.sv \
  ../../../libraries/unisim/RAMB36E1.sv \
  ../../../libraries/unisim/glbl.v

vvp tb_reg_file.out
