function(add_cocotb_test executable_target test_module)
   cmake_parse_arguments(
      TEST
      ""
      "TESTCASE;TEST_FILTER"
      "TESTCASES"
      ${ARGN}
   )

   # Get the top level from the executable target properties
   get_target_property(TEST_TOPLEVEL ${executable_target} COCOTB_TOP_MODULE)
   if(NOT TEST_TOPLEVEL)
      message(FATAL_ERROR "Target ${executable_target} does not have a COCOTB_TOP_MODULE property. Make sure it was created with add_cocotb_verilator and that the TOP_MODULE argument was specified.")
   endif()

   set(_cocotb_testcases "")
   if(TEST_TESTCASE)
      list(APPEND _cocotb_testcases "${TEST_TESTCASE}")
   endif()
   if(TEST_TESTCASES)
      list(APPEND _cocotb_testcases ${TEST_TESTCASES})
   endif()

   if(_cocotb_testcases)
      foreach(_cocotb_testcase IN LISTS _cocotb_testcases)
         set(_test_name "${executable_target}.${_cocotb_testcase}")
         string(MAKE_C_IDENTIFIER "${_test_name}" _test_dir_name)
         set(_test_run_dir "${CMAKE_BINARY_DIR}/cocotb-runs/${_test_dir_name}")
         set(_test_results_xml "${_test_run_dir}/results.xml")

         set(
            ENVVARS
            LIBPYTHON_LOC=${COCOTB_LIBPYTHON_DIR}
            PYGPI_PYTHON_BIN=${COCOTB_PYTHON_BIN}
            COCOTB_TEST_MODULE=${test_module}
            COCOTB_TEST_FILTER=${_cocotb_testcase}
            COCOTB_RUN_DIR=${_test_run_dir}
            COCOTB_RESULTS_XML=${_test_results_xml}
            TEST_EXECUTABLE=$<TARGET_FILE:${executable_target}>
            TEST_TOPLEVEL=${TEST_TOPLEVEL}
         )

         add_test(
            NAME "${_test_name}"
            COMMAND "${UV_EXECUTABLE}" run "${CMAKE_CURRENT_SOURCE_DIR}/cocotb-runner.py"
            WORKING_DIRECTORY ${CMAKE_CURRENT_LIST_DIR}
         )

         set_tests_properties(
            "${_test_name}"
            PROPERTIES ENVIRONMENT "${ENVVARS}"
         )
      endforeach()
   else()
      set(_test_name "${executable_target}_${test_module}_test")
      string(MAKE_C_IDENTIFIER "${_test_name}" _test_dir_name)
      set(_test_run_dir "${CMAKE_BINARY_DIR}/cocotb-runs/${_test_dir_name}")
      set(_test_results_xml "${_test_run_dir}/results.xml")

      set(
         ENVVARS
         LIBPYTHON_LOC=${COCOTB_LIBPYTHON_DIR}
         PYGPI_PYTHON_BIN=${COCOTB_PYTHON_BIN}
         COCOTB_TEST_MODULE=${test_module}
         COCOTB_TEST_FILTER=${TEST_TEST_FILTER}
         COCOTB_RUN_DIR=${_test_run_dir}
         COCOTB_RESULTS_XML=${_test_results_xml}
         TEST_EXECUTABLE=$<TARGET_FILE:${executable_target}>
         TEST_TOPLEVEL=${TEST_TOPLEVEL}
      )

      add_test(
         NAME "${_test_name}"
         COMMAND "${UV_EXECUTABLE}" run "${CMAKE_CURRENT_SOURCE_DIR}/cocotb-runner.py"
         WORKING_DIRECTORY ${CMAKE_CURRENT_LIST_DIR}
      )

      set_tests_properties(
         "${_test_name}"
         PROPERTIES ENVIRONMENT "${ENVVARS}"
      )
   endif()
endfunction()
