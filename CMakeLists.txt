cmake_minimum_required(VERSION 3.10)

project(gpu-monolith)
enable_testing()
include(CTest)

cmake_host_system_information(RESULT core_count QUERY NUMBER_OF_LOGICAL_CORES)
message(STATUS "Host has ${core_count} logical cores")

include(CheckIPOSupported)
check_ipo_supported(RESULT supported OUTPUT error)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(CMAKE_BUILD_TYPE STREQUAL "Release")
   set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)
   message(STATUS "Interprocedural optimization enabled for Release build")
else()
   message(STATUS "Interprocedural optimization disabled for non-Release build")
endif()

include(${CMAKE_CURRENT_LIST_DIR}/cmake/utilities.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/cmake/toolchain.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/archsim/build.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/design/build.cmake)
