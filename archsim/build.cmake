find_package(glm CONFIG REQUIRED)
find_package(glfw3 CONFIG REQUIRED)

file(
   GLOB IMGUI_SOURCES
   ${CMAKE_CURRENT_LIST_DIR}/third-party/imgui/*.cpp
   ${CMAKE_CURRENT_LIST_DIR}/third-party/imgui/backends/imgui_impl_opengl3.cpp
   ${CMAKE_CURRENT_LIST_DIR}/third-party/imgui/backends/imgui_impl_glfw.cpp
)

include_directories(
   ${CMAKE_CURRENT_LIST_DIR}/third-party/imgui/
   ${CMAKE_CURRENT_LIST_DIR}/third-party/imgui/backends/
)

include(${CMAKE_CURRENT_LIST_DIR}/vertexsim-cpp/build.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/rastersim-cpp/build.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/stdref-cpp/build.cmake)
