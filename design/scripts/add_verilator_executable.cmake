function(add_verilator_executable name)
   cmake_parse_arguments(
      ARG
      "TRACE"
      "TOP_MODULE;PREFIX"
      "CPP_SOURCES;LINK_LIBRARIES;VERILATOR_ARGS"
      ${ARGN}
   )

   # Create a new executable target, including any extra C++ sources
   add_executable(${name} ${ARG_CPP_SOURCES})

   # Link against any libraries
   if(ARG_LINK_LIBRARIES)
      target_link_libraries(${name} PRIVATE ${ARG_LINK_LIBRARIES})
   endif()

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

   # Enable tracing if requested
   set(_trace_arg "")
   if(ARG_TRACE)
      set(_trace_arg TRACE)
   endif()

   # For debugging, print out what we would verilate with
   message(DEBUG "Adding Verilator executable ${name}")
   message(DEBUG "   top module ${ARG_TOP_MODULE}")
   message(DEBUG "   sources ${_v_sources}")
   message(DEBUG "   include directories ${_v_incdirs}")

   # verilate(${name}
   #    SOURCES ${_v_sources}
   #    INCLUDE_DIRS ${_v_incdirs}
   #    TOP_MODULE ${ARG_TOP_MODULE}
   #    PREFIX ${ARG_PREFIX}
   #    VERILATOR_ARGS ${ARG_VERILATOR_ARGS}
   #    ${_trace_arg}
   # )
endfunction()
