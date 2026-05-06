# Find the uv binary
find_program(UV_EXECUTABLE uv)
if(NOT UV_EXECUTABLE)
   message(FATAL_ERROR "uv executable not found. Please install uv and ensure it is in your PATH.")
else()
   message(STATUS "Found uv: ${UV_EXECUTABLE}")
endif()

# Run a command via "uv run" and store stdout in the specified variable
# Usage: uv_run(OUTPUT_VAR <var> COMMAND <cmd> [args...])
macro(uv_run)
   cmake_parse_arguments(_UV_RUN "" "OUTPUT_VAR" "COMMAND" ${ARGN})
   run_cmd(
      OUTPUT_VAR ${_UV_RUN_OUTPUT_VAR}
      COMMAND ${UV_EXECUTABLE} run ${_UV_RUN_COMMAND}
   )
endmacro()
