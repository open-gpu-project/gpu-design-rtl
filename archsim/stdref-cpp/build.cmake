add_executable(
   stdref-cpp
   ${IMGUI_SOURCES}
   ${CMAKE_CURRENT_LIST_DIR}/glad.cc
   ${CMAKE_CURRENT_LIST_DIR}/main.cc
)

target_compile_definitions(
   stdref-cpp PRIVATE
   IMGUI_DEFINE_MATH_OPERATORS
   _CRT_SECURE_NO_WARNINGS
)

target_link_libraries(
   stdref-cpp
   PRIVATE
   glfw
)
