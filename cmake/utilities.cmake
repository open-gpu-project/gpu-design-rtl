macro(run_cmd)
   cmake_parse_arguments(
      ARG
      ""
      "OUTPUT_VAR"
      "COMMAND"
      ${ARGN}
   )
   if(NOT ARG_COMMAND)
      message(FATAL_ERROR "run_cmd requires a COMMAND argument")
   endif()
   execute_process(
      COMMAND ${ARG_COMMAND}
      RESULT_VARIABLE _cmd_result
      OUTPUT_VARIABLE ${ARG_OUTPUT_VAR}
      ERROR_VARIABLE _cmd_error
      OUTPUT_STRIP_TRAILING_WHITESPACE
   )
   if(_cmd_result)
      message(FATAL_ERROR "Failed to run command '${ARG_COMMAND}': ${_cmd_error}")
   endif()
endmacro()

# Create a function that extracts the JSON array for a given JSON content and keys and output variable/
# Then convert the array to CMake list format and set it to the output variable
function(string_json_array_get OUTPUT_VAR JSON_CONTENT)
   set(KEYS ${ARGN})
   string(JSON _n LENGTH "${JSON_CONTENT}" ${KEYS})
   set(_array_items "")
   math(EXPR _n "${_n} - 1") # Convert to 0-based index
   foreach(i RANGE 0 ${_n})
      string(JSON _item GET "${JSON_CONTENT}" ${KEYS} ${i})
      list(APPEND _array_items "${_item}")
   endforeach()
   set(${OUTPUT_VAR} "${_array_items}" PARENT_SCOPE)
endfunction()
