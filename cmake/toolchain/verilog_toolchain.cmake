# Find the Verilator binary
find_program(VERILATOR_EXECUTABLE verilator)
if(NOT VERILATOR_EXECUTABLE)
   message(FATAL_ERROR "Verilator executable not found. Please install Verilator and ensure it is in your PATH.")
else()
   message(STATUS "Found Verilator: ${VERILATOR_EXECUTABLE}")
endif()

# Run "uv run cocotb-config --share" and grab the output and store it in COCOTB_SHARE_DIR
uv_run(OUTPUT_VAR COCOTB_SHARE_DIR COMMAND cocotb-config --share)
uv_run(OUTPUT_VAR COCOTB_LIB_DIR COMMAND cocotb-config --lib-dir)
uv_run(OUTPUT_VAR COCOTB_MAKEFILES_DIR COMMAND cocotb-config --makefiles)
uv_run(OUTPUT_VAR COCOTB_LIBPYTHON_DIR COMMAND cocotb-config --libpython)
uv_run(OUTPUT_VAR COCOTB_PYTHON_BIN COMMAND cocotb-config --python-bin)

# Grab the Makefile.verilator and extract VLT_MIN := <value> from it
file(READ "${COCOTB_MAKEFILES_DIR}/simulators/Makefile.verilator" MAKEFILE_VERILATOR_CONTENTS)
string(REGEX MATCH "VLT_MIN := ([0-9.]+)" _match "${MAKEFILE_VERILATOR_CONTENTS}")
set(VLT_MIN "${CMAKE_MATCH_1}")

# Check that the installed Verilator version meets the minimum required by cocotb
run_cmd(
   OUTPUT_VAR VERILATOR_VERSION
   COMMAND "${VERILATOR_EXECUTABLE}" --version
)
string(REGEX MATCH "Verilator ([0-9.]+)" _match "${VERILATOR_VERSION}")
set(VERILATOR_VERSION_NUMBER "${CMAKE_MATCH_1}")
if(VERILATOR_VERSION_NUMBER VERSION_LESS VLT_MIN)
   message(FATAL_ERROR "Installed Verilator version ${VERILATOR_VERSION_NUMBER} does not meet the minimum required by cocotb (${VLT_MIN}). Please upgrade Verilator.")
else()
   message(STATUS "Verilator version ${VERILATOR_VERSION_NUMBER} meets the minimum required by cocotb (${VLT_MIN}).")
endif()
