# Catch2 test registration helper, provided by the Catch2 CONFIG package
include(Catch)

# Unit tests for the framework-cpp partition
add_executable(
   framework-cpp-tests
   ${CMAKE_CURRENT_LIST_DIR}/test_file_trace_sink.cc
   ${CMAKE_CURRENT_LIST_DIR}/test_reg.cc
   ${CMAKE_CURRENT_LIST_DIR}/test_simulation.cc
   ${CMAKE_CURRENT_LIST_DIR}/test_tracer.cc
   ${CMAKE_CURRENT_LIST_DIR}/test_tracer_codec.cc
)

# Declare test dependencies
target_link_libraries(
   framework-cpp-tests
   PRIVATE
   archsim::framework
   Catch2::Catch2WithMain
)

# Register each TEST_CASE with ctest
catch_discover_tests(framework-cpp-tests)
