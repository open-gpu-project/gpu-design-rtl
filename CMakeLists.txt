cmake_minimum_required(VERSION 3.10)

project(gpu-monolith)

include(CheckIPOSupported)
check_ipo_supported(RESULT supported OUTPUT error)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)

include(${CMAKE_CURRENT_LIST_DIR}/design/scripts/verilog_toolchain.cmake)

include(${CMAKE_CURRENT_LIST_DIR}/archsim/build.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/design/build.cmake)
