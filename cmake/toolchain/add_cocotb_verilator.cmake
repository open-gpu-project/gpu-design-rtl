function(add_cocotb_verilator name)
   cmake_parse_arguments(
      ARG
      "TRACE"
      "TOP_MODULE;TIMESCALE"
      "CPP_SOURCES;LINK_LIBRARIES;VERILATOR_ARGS"
      ${ARGN}
   )

   # User must specify the top module to verilate
   if(NOT ARG_TOP_MODULE)
      message(FATAL_ERROR "add_cocotb_verilator requires a TOP_MODULE argument")
   endif()
   if(NOT ARG_TIMESCALE)
      set(ARG_TIMESCALE "1ns/1ps")
   endif()

   # Create a new executable target, including any extra C++ sources
   add_executable(${name} ${ARG_CPP_SOURCES})

   # Store the top level module as a property for later use by the test runner
   set_target_properties(${name} PROPERTIES COCOTB_TOP_MODULE ${ARG_TOP_MODULE})
   set_target_properties(${name} PROPERTIES COCOTB_TIMESCALE ${ARG_TIMESCALE})

   # Collect transitive Verilog sources/includes from linked INTERFACE libs
   set(_v_sources)
   set(_v_incdirs)
   foreach(dep ${ARG_LINK_LIBRARIES})
      get_target_property(_srcs ${dep} INTERFACE_SOURCES)
      get_target_property(_incs ${dep} INTERFACE_INCLUDE_DIRECTORIES)
      if(_srcs)
         list(APPEND _v_sources ${_srcs})
      endif()
      if(_incs)
         list(APPEND _v_incdirs ${_incs})
      endif()
   endforeach()
   list(REMOVE_DUPLICATES _v_sources)
   list(REMOVE_DUPLICATES _v_incdirs)

   # For debugging, print out what we would verilate with
   message(STATUS "Adding Verilator executable ${name}")
   message(DEBUG "   top module ${ARG_TOP_MODULE}")
   message(DEBUG "   sources:")
   foreach(_src ${_v_sources})
      message(DEBUG "     ${_src}")
   endforeach()
   message(DEBUG "   include directories:")
   foreach(_inc ${_v_incdirs})
      message(DEBUG "     ${_inc}")
   endforeach()

   # Output directory for Verilator-generated C++ sources
   set(_outdir "${CMAKE_CURRENT_BINARY_DIR}/${name}_verilated")
   file(MAKE_DIRECTORY "${_outdir}")

   # Hard-coded for cocotb support
   set(ARG_PREFIX "Vtop")

   # Build the full Verilator invocation
   set(_vargs
      --cc
      --Mdir "${_outdir}"
      --top-module "${ARG_TOP_MODULE}"
      --prefix "${ARG_PREFIX}"
      --timescale "${ARG_TIMESCALE}"
      --timing
      --make json

      # cocotb-specific flags
      --vpi
      --public-flat-rw
   )
   if(ARG_TRACE)
      list(APPEND _vargs --trace)
   endif()
   foreach(_inc ${_v_incdirs})
      list(APPEND _vargs "-I${_inc}")
   endforeach()
   list(APPEND _vargs ${ARG_VERILATOR_ARGS} ${_v_sources})

   # Run Verilator at configure time so we can discover the generated file list
   execute_process(
      COMMAND "${VERILATOR_EXECUTABLE}" ${_vargs}
      RESULT_VARIABLE _vret
      ERROR_VARIABLE _verr
      OUTPUT_QUIET
   )
   if(_vret)
      message(FATAL_ERROR "Verilator failed for target '${name}':\n${_verr}")
   endif()

   # The result is a JSON file describing the generated sources and their dependencies. Parse it to extract the generated source list and dependency list.
   file(READ "${_outdir}/${ARG_PREFIX}.json" _json_contents)
   string_json_array_get(${ARG_PREFIX}_CLASSES_FAST "${_json_contents}" "sources" "classes_fast")
   string_json_array_get(${ARG_PREFIX}_CLASSES_SLOW "${_json_contents}" "sources" "classes_slow")
   string_json_array_get(${ARG_PREFIX}_SUPPORT_FAST "${_json_contents}" "sources" "support_fast")
   string_json_array_get(${ARG_PREFIX}_SUPPORT_SLOW "${_json_contents}" "sources" "support_slow")
   string_json_array_get(${ARG_PREFIX}_GLOBAL "${_json_contents}" "sources" "global")
   string_json_array_get(${ARG_PREFIX}_DEPS "${_json_contents}" "sources" "deps")
   string(JSON VERILATOR_ROOT GET "${_json_contents}" "system" "verilator_root")

   # Collect all generated sources into a single list for the target
   set(_sim_srcs
      ${${ARG_PREFIX}_CLASSES_FAST}
      ${${ARG_PREFIX}_CLASSES_SLOW}
   )
   set(_support_srcs
      ${${ARG_PREFIX}_SUPPORT_FAST}
      ${${ARG_PREFIX}_SUPPORT_SLOW}
      ${${ARG_PREFIX}_GLOBAL}
      ${COCOTB_SHARE_DIR}/lib/verilator/verilator.cpp
   )

   # Teach the build system to re-invoke Verilator when RTL sources change
   add_custom_command(
      OUTPUT ${_sim_srcs}
      COMMAND "${VERILATOR_EXECUTABLE}" ${_vargs}
      DEPENDS ${${ARG_PREFIX}_DEPS}
      COMMENT "Verilating ${ARG_TOP_MODULE} -> ${name}"
      VERBATIM
   )

   # Add generated module sources to the executable
   target_sources(${name} PRIVATE ${_sim_srcs} ${_support_srcs})

   # Expose the output dir (for generated headers) and Verilator's include dir
   target_include_directories(
      ${name}
      PRIVATE
      "${_outdir}"
      "${VERILATOR_ROOT}/include"
      "${VERILATOR_ROOT}/include/vltstd"
   )

   # Link against cocotbvpi_verilator in ${COCOTB_LIB_DIR} for cocotb support
   target_link_libraries(
      ${name}
      PRIVATE
      "${COCOTB_LIB_DIR}/libcocotbvpi_verilator.so"
   )
endfunction()
