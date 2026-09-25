add_library(
   partitions-cpp STATIC
   ${CMAKE_CURRENT_LIST_DIR}/fabric.cc
   ${CMAKE_CURRENT_LIST_DIR}/tdsu.cc
   ${CMAKE_CURRENT_LIST_DIR}/gce.cc
)

add_library(archsim::partitions ALIAS partitions-cpp)

target_link_libraries(
   partitions-cpp
   PUBLIC
   archsim::framework
)

# Enable first-party warnings
archsim_enable_warnings(partitions-cpp)

# Include the test directory
include(${CMAKE_CURRENT_LIST_DIR}/tests/build.cmake)
