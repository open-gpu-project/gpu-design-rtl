add_executable(
    vertexsim-cpp
    ${CMAKE_CURRENT_LIST_DIR}/main.cc
)
target_link_libraries(vertexsim-cpp PRIVATE glm::glm-header-only)
