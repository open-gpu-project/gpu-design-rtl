"""Single source of truth for XU pipeline timing.

All constants are in dsp_clk_div2 cycles and were verified against waveforms
of the passing mode tests (see git history for the bring-up measurements).

Cycle convention: "cycle k" is the interval following rising edge k. An op's
xu_ctl word and BRAM addresses are driven during its issue cycle i and
captured at edge i+1.

Verified event table for an op issued in cycle i:

  event                                          | cycle
  -----------------------------------------------|------------------
  ctl + BRAM addr captured                       | edge i+1
  BRAM DO_A/DO_B valid (RAMB36E1, DOA_REG=1)     | cycle i+2
  gearbox pA_d1 tap valid                        | cycle i+3
  gearbox pA_d2 tap valid                        | cycle i+4
  ALU consumes lane x + acc inputs (ctl tap[2])  | cycle i+3 (edge i+4)
  y outputs / l*acc_in valid, acc_we (ctl tap[7])| cycle i+8
  acc reg file slot committed                    | edge i+9

Dependency distances between a producer issued at i and a consumer at j:

  j - i >= MIN_RAW_DISTANCE (6): consumer reads the committed reg-file slot.
  j - i == FWD_DISTANCE (5): the result is on the combinational l*acc_in
      exactly when the consumer reads; assert bypass_acc to forward it.
  j - i < 5: impossible, the result does not exist yet.

Mode-1 operand taps (relative to FMA issue cycle i):
  sel_low=0 (high): x1 = row addressed at i (d1 tap, high half),
                    x2 = row addressed at i+1 (combinational, high half).
  sel_low=1 (low):  x1 = row addressed at i-1 (d2 tap, low half),
                    x2 = row addressed at i (d1 tap, low half).
"""

# Physical stage depths
BRAM_ADDR_TO_DO = 2  # addr driven cycle k -> DO valid cycle k+2
GEARBOX_D1 = 1  # pA_d1/pB_d1 delay behind DO
GEARBOX_D2 = 2  # pA_d2/pB_d2 low-half delay behind DO
CTL_INPUT_TAP = 2  # xu_ctl_pipe tap feeding lane_input_logic/alu/acc read
CTL_OUTPUT_TAP = 7  # xu_ctl_pipe tap feeding lane_output_logic/acc write

# Derived op timing (issue cycle i)
ISSUE_TO_CONSUME = CTL_INPUT_TAP + 1  # acc + lane inputs read in cycle i+3
ISSUE_TO_RESULT = CTL_OUTPUT_TAP + 1  # y / l*acc_in valid in cycle i+8
ISSUE_TO_COMMIT = ISSUE_TO_RESULT + 1  # reg-file slot readable from edge i+9

# Dependency distances
FWD_DISTANCE = ISSUE_TO_RESULT - ISSUE_TO_CONSUME  # == 5
MIN_RAW_DISTANCE = ISSUE_TO_COMMIT - ISSUE_TO_CONSUME  # == 6

# In the scoreboard loop convention (drive during iteration c, sample just
# after edge c+1), an op issued at iteration i is observed at iteration
# i + OBSERVE_ITER_OFFSET.
OBSERVE_ITER_OFFSET = ISSUE_TO_RESULT - 1  # == 7
