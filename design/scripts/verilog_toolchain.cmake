# Find the Verilator binary
find_program(VERILATOR_EXECUTABLE verilator)
if(NOT VERILATOR_EXECUTABLE)
   message(FATAL_ERROR "Verilator executable not found. Please install Verilator and ensure it is in your PATH.")
else()
   message(STATUS "Found Verilator: ${VERILATOR_EXECUTABLE}")
endif()

include(${CMAKE_CURRENT_LIST_DIR}/add_verilog_library.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/add_verilator_executable.cmake)
