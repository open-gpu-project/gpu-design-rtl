# Register a pytest run as a CTest test.
#
# Usage:
#   pytest_test(
#      NAME      <ctest-name>
#      TESTS     <test-dir-or-file> [<more>...]
#      PYTHONPATH <src-root> [<more-src-roots>...]
#      [LABELS    <label> [<label>...]]
#      [ARGS      <pytest-arg> [<pytest-arg>...]]
#   )
#
# Each PYTHONPATH entry is resolved relative to ${CMAKE_SOURCE_DIR} if it
# isn't already absolute, then joined with `:` and exposed to pytest via the
# test's ENVIRONMENT property. WORKING_DIRECTORY is fixed to the source root
# so test paths are stable.
function(pytest_test)
   cmake_parse_arguments(
      _PT
      ""
      "NAME"
      "TESTS;PYTHONPATH;LABELS;ARGS"
      ${ARGN}
   )
   if(NOT _PT_NAME)
      message(FATAL_ERROR "pytest_test: NAME is required")
   endif()
   if(NOT _PT_TESTS)
      message(FATAL_ERROR "pytest_test(${_PT_NAME}): TESTS is required")
   endif()

   set(_resolved_paths "")
   foreach(_p IN LISTS _PT_PYTHONPATH)
      if(IS_ABSOLUTE "${_p}")
         list(APPEND _resolved_paths "${_p}")
      else()
         list(APPEND _resolved_paths "${CMAKE_SOURCE_DIR}/${_p}")
      endif()
   endforeach()
   list(JOIN _resolved_paths ":" _pythonpath_value)

   # Add the current source directory to PYTHONPATH too
   if(_pythonpath_value)
      set(_pythonpath_value "${_pythonpath_value}:${CMAKE_SOURCE_DIR}")
   else()
      set(_pythonpath_value "${CMAKE_SOURCE_DIR}")
   endif()

   add_test(
      NAME ${_PT_NAME}
      COMMAND ${UV_EXECUTABLE} run pytest ${_PT_ARGS} ${_PT_TESTS}
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
   )
   set_tests_properties(${_PT_NAME} PROPERTIES
      ENVIRONMENT "PYTHONPATH=${_pythonpath_value}"
   )
   if(_PT_LABELS)
      list(JOIN _PT_LABELS ";" _label_value)
      set_tests_properties(${_PT_NAME} PROPERTIES LABELS "${_label_value}")
   endif()
endfunction()
