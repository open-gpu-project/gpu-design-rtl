add_verilog_library(
   svlib_unisim
   SOURCES
      ${CMAKE_CURRENT_LIST_DIR}/waiver.sim.vlt
      ${CMAKE_CURRENT_LIST_DIR}/DSP48E1.sv
      ${CMAKE_CURRENT_LIST_DIR}/RAMB36E1.sv
      ${CMAKE_CURRENT_LIST_DIR}/SRL16E.sv
)
