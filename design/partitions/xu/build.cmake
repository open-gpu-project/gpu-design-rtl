add_verilog_library(
   svpart_xu
   SOURCES
      ${CMAKE_CURRENT_LIST_DIR}/rtl/alu_acc_reg.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/alu_dsp_wrapper.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/alu_lane.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/alu.sv
      ${CMAKE_CURRENT_LIST_DIR}/rtl/top.sv
   
   INCLUDE_DIRECTORIES
      ${CMAKE_CURRENT_LIST_DIR}/rtl
      
   LINK_LIBRARIES
      svlib_unisim
)

add_cocotb_verilator(
   simpart_xu
   TOP_MODULE alu_lane
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace
)

add_cocotb_test(simpart_xu design.partitions.xu.dv.test_alu_lane)

add_cocotb_verilator(
   simpart_xu_alu
   TOP_MODULE alu
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace
)

add_cocotb_test(simpart_xu_alu design.partitions.xu.dv.test_alu)
