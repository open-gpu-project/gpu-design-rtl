get_filename_component(ARCHSIM_ROOT ${CMAKE_CURRENT_LIST_DIR} DIRECTORY)

# C++ library for the framework-cpp partition
add_library(
   framework-cpp STATIC
   ${CMAKE_CURRENT_LIST_DIR}/axi3.h
   ${CMAKE_CURRENT_LIST_DIR}/concepts.h
   ${CMAKE_CURRENT_LIST_DIR}/exceptions.h
   ${CMAKE_CURRENT_LIST_DIR}/fifo.h
   ${CMAKE_CURRENT_LIST_DIR}/reg.h
   ${CMAKE_CURRENT_LIST_DIR}/simulation.cc
)

# Create an alias for the library to be used by consumers
add_library(archsim::framework ALIAS framework-cpp)

# Declare library dependencies
target_link_libraries(
   framework-cpp
   PUBLIC
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
