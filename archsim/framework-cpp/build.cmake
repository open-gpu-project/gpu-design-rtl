get_filename_component(ARCHSIM_ROOT ${CMAKE_CURRENT_LIST_DIR} DIRECTORY)

# C++ library for the framework-cpp partition
add_library(
   framework-cpp STATIC
   ${CMAKE_CURRENT_LIST_DIR}/axi3.h
   ${CMAKE_CURRENT_LIST_DIR}/concepts.h
   ${CMAKE_CURRENT_LIST_DIR}/exceptions.h
   ${CMAKE_CURRENT_LIST_DIR}/fifo.h
   ${CMAKE_CURRENT_LIST_DIR}/file_trace_sink.cc
   ${CMAKE_CURRENT_LIST_DIR}/file_trace_sink.h
   ${CMAKE_CURRENT_LIST_DIR}/reg.h
   ${CMAKE_CURRENT_LIST_DIR}/simulation.cc
   ${CMAKE_CURRENT_LIST_DIR}/tracer.cc
   ${CMAKE_CURRENT_LIST_DIR}/tracer.h
   ${CMAKE_CURRENT_LIST_DIR}/tracer_codec.cc
   ${CMAKE_CURRENT_LIST_DIR}/tracer_codec.h
)

# Create an alias for the library to be used by consumers
add_library(archsim::framework ALIAS framework-cpp)

# Declare library dependencies
target_link_libraries(
   framework-cpp
   PUBLIC
   glaze::glaze
   magic_enum::magic_enum
   cpptrace::cpptrace
   logpp::logpp
)

# Include directories for this library
target_include_directories(
   framework-cpp
   PUBLIC
   ${ARCHSIM_ROOT}
)

# Flag that the consumer of this library requires C++23
target_compile_features(
   framework-cpp
   PUBLIC
   cxx_std_23
)

# Enable first-party warnings
archsim_enable_warnings(framework-cpp)

# Include the test directory
include(${CMAKE_CURRENT_LIST_DIR}/tests/build.cmake)
