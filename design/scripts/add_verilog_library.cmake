function(add_verilog_library name)
   cmake_parse_arguments(ARG "" "" "SOURCES;INCLUDE_DIRECTORIES;LINK_LIBRARIES" ${ARGN})

   # Create a new INTERFACE library to hold the dependencies
   add_library(${name} INTERFACE)

   # Add sources & use absolute paths so they work when consumed from elsewhere
   if(ARG_SOURCES)
      set(_abs_sources)
      foreach(src ${ARG_SOURCES})
         get_filename_component(_abs "${src}" ABSOLUTE)
         list(APPEND _abs_sources "${_abs}")
      endforeach()
      target_sources(${name} INTERFACE ${_abs_sources})
   endif()

   # Add include directories
   if(ARG_INCLUDE_DIRECTORIES)
      set(_abs_includes)
      foreach(inc ${ARG_INCLUDE_DIRECTORIES})
         get_filename_component(_abs "${inc}" ABSOLUTE)
         list(APPEND _abs_includes "${_abs}")
      endforeach()
      target_include_directories(${name} INTERFACE ${_abs_includes})
   endif()

   # Add linked libraries
   if(ARG_LINK_LIBRARIES)
      target_link_libraries(${name} INTERFACE ${ARG_LINK_LIBRARIES})
   endif()
endfunction()
