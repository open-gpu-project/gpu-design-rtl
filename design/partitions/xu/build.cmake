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
      ${CMAKE_CURRENT_LIST_DIR}/rtl/xu_ctl_pipe.sv
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

add_cocotb_test(simpart_alu_lane design.partitions.xu.dv.test_alu_lane)

add_cocotb_verilator(
   simpart_alu
   TOP_MODULE alu
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(simpart_alu design.partitions.xu.dv.test_alu)

add_cocotb_verilator(
   simpart_lane_input_logic
   TOP_MODULE lane_input_logic
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(simpart_lane_input_logic design.partitions.xu.dv.test_lane_input_logic)

add_cocotb_verilator(
   simpart_acc_reg_file
   TOP_MODULE acc_reg_file
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(simpart_acc_reg_file design.partitions.xu.dv.test_acc_reg_file)

add_cocotb_verilator(
   simpart_xu
   TOP_MODULE top
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace --trace-structs
)

add_cocotb_test(simpart_xu design.partitions.xu.dv.test_xu_programs)

