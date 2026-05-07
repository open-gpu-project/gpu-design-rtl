function(_make_absolute_paths out_var paths)
   if(NOT paths)
      return()
   endif()
   set(_result ${${out_var}})
   foreach(item ${paths})
      get_filename_component(_abs "${item}" ABSOLUTE)
      list(APPEND _result "${_abs}")
   endforeach()
   set(${out_var} "${_result}" PARENT_SCOPE)
endfunction()

function(add_verilog_library name)
   cmake_parse_arguments(ARG "" "" "SOURCES;INCLUDE_DIRECTORIES;LINK_LIBRARIES" ${ARGN})

   # Create a new INTERFACE library to hold the dependencies
   add_library(${name} INTERFACE)

   set(_abs_sources)
   set(_abs_includes)

   # Add sources & use absolute paths so they work when consumed from elsewhere
   _make_absolute_paths(_abs_sources "${ARG_SOURCES}")

   # Add include directories
   _make_absolute_paths(_abs_includes "${ARG_INCLUDE_DIRECTORIES}")

   # Add linked libraries by appending their sources and include dirs
   if(ARG_LINK_LIBRARIES)
      foreach(lib ${ARG_LINK_LIBRARIES})
         # Check the library exists and is an INTERFACE library
         if(NOT TARGET ${lib})
            message(FATAL_ERROR "Library ${lib} not found for linking in ${name}")
         endif()
         get_target_property(_type ${lib} TYPE)
         if(NOT _type STREQUAL "INTERFACE_LIBRARY")
            message(FATAL_ERROR "Library ${lib} linked from ${name} must be an INTERFACE library")
         endif()
         get_target_property(_lib_sources ${lib} INTERFACE_SOURCES)
         get_target_property(_lib_includes ${lib} INTERFACE_INCLUDE_DIRECTORIES)
         _make_absolute_paths(_abs_sources "${_lib_sources}")
         _make_absolute_paths(_abs_includes "${_lib_includes}")
      endforeach()
   endif()

   # Store the sources and includes
   target_sources(${name} INTERFACE ${_abs_sources})
   target_include_directories(${name} INTERFACE ${_abs_includes})
endfunction()
