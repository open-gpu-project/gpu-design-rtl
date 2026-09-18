add_verilog_library(
   svpart_xu
   SOURCES
      ${CMAKE_CURRENT_LIST_DIR}/rtl/acc_reg_file.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/alu_dsp_wrapper.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/alu_lane.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/alu.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/lane_input_logic.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/bram_wrapper.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/lane_output_logic.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/xu_ctl_delay_tap.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/top.sv
   
   INCLUDE_DIRECTORIES
      ${CMAKE_CURRENT_LIST_DIR}/rtl
      
   LINK_LIBRARIES
      svlib_unisim
)

add_cocotb_verilator(
   simpart_alu_lane
   TOP_MODULE alu_lane
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(
   simpart_alu_lane
   design.partitions.xu.dv.test_alu_lane
   TESTCASES
      test_18b_add
      test_18b_fma
      test_24b_add
      test_18b_cmp
)

add_cocotb_verilator(
   simpart_alu
   TOP_MODULE alu
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(
   simpart_alu
   design.partitions.xu.dv.test_alu
   TESTCASES
      test_18b_add
      test_18b_fma
      test_24b_add
      test_24b_fma
)

add_cocotb_verilator(
   simpart_lane_input_logic
   TOP_MODULE lane_input_logic
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(
   simpart_lane_input_logic
   design.partitions.xu.dv.test_lane_input_logic
   TESTCASES
      test_lane_input_logic_all_modes
)

add_cocotb_verilator(
   simpart_acc_reg_file
   TOP_MODULE acc_reg_file
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(
   simpart_acc_reg_file
   design.partitions.xu.dv.test_acc_reg_file
   TESTCASES
      test_write_readback_all_slots
      test_read_during_write_returns_old_data
      test_we_low_holds_and_slots_independent
)

add_cocotb_verilator(
   simpart_xu
   TOP_MODULE top
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(
   simpart_xu
   design.partitions.xu.dv.test_xu_predicates
   TESTCASES
      test_predicate_writeback
      test_predicate_round_robin
      test_fma18_predicate_round_robin
)

add_cocotb_test(
   simpart_xu
   design.partitions.xu.dv.test_xu_programs
   TESTCASES
      my_own_test
      test_add18_stream_and_readback
      test_add18_accumulate_chains
      test_min_raw_distance
      test_add18_acc_to_bram_writeback
      test_fma18_acc_to_bram_writeback
      test_fma18_high_low_alternation
      test_fma18_accumulate_chain
      test_add24_slice_rotations
      test_fma24_rotations_and_consume
      test_add18_signed
      test_fma18_signed
      test_add24_signed
      test_fma24_signed
      test_random_programs
      test_eight_strand_round_robin
      test_acc_slots_are_registers
      test_latency_pin
      test_vector_roundtrip
      test_assembler_rejects_hazards
)
