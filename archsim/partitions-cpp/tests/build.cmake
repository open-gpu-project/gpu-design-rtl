# Catch2 test registration helper, provided by the Catch2 CONFIG package
include(Catch)

# Unit tests for the partitions-cpp partition
add_executable(
   partitions-cpp-tests
   ${CMAKE_CURRENT_LIST_DIR}/test_fabric.cc
)

# Declare test dependencies
target_link_libraries(
   partitions-cpp-tests
   PRIVATE
   archsim::partitions
   Catch2::Catch2WithMain
)

# Enable first-party warnings
archsim_enable_warnings(partitions-cpp-tests)

# Register each TEST_CASE with ctest
catch_discover_tests(partitions-cpp-tests)
