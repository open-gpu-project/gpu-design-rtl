function(add_cocotb_test executable_target test_module)
   cmake_parse_arguments(
      TEST
      ""
      "TESTCASE;TEST_FILTER"
      ""
      ${ARGN}
   )

   # Get the top level from the executable target properties
   get_target_property(TEST_TOPLEVEL ${executable_target} COCOTB_TOP_MODULE)
   if(NOT TEST_TOPLEVEL)
      message(FATAL_ERROR "Target ${executable_target} does not have a COCOTB_TOP_MODULE property. Make sure it was created with add_cocotb_verilator and that the TOP_MODULE argument was specified.")
   endif()

   set(
      ENVVARS
      LIBPYTHON_LOC=${COCOTB_LIBPYTHON_DIR}
      PYGPI_PYTHON_BIN=${COCOTB_PYTHON_BIN}
      COCOTB_TEST_MODULE=${test_module}
      TEST_EXECUTABLE=$<TARGET_FILE:${executable_target}>
      TEST_TOPLEVEL=${TEST_TOPLEVEL}
   )

   add_test(
      NAME "${executable_target}_${test_module}_test"
      COMMAND "${UV_EXECUTABLE}" run "${CMAKE_CURRENT_SOURCE_DIR}/cocotb-runner.py"
      WORKING_DIRECTORY ${CMAKE_CURRENT_LIST_DIR}
   )

   set_tests_properties(
      "${executable_target}_${test_module}_test"
      PROPERTIES ENVIRONMENT "${ENVVARS}"
   )
endfunction()
