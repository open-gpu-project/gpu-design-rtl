add_library(
   partitions-cpp STATIC
   ${CMAKE_CURRENT_LIST_DIR}/fabric.cc
)

add_library(archsim::partitions ALIAS partitions-cpp)

target_link_libraries(
   partitions-cpp
   PUBLIC
   archsim::framework
)

# Enable first-party warnings
archsim_enable_warnings(partitions-cpp)
