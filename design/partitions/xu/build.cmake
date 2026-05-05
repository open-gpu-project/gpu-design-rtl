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

add_verilator_executable(
   xu_sim
   TOP_MODULE xu_top
   LINK_LIBRARIES svpart_xu
   VERILATOR_ARGS --trace
)
