# logpp (https://github.com/oktal/logpp) is vendored as a git submodule. Upstream builds with
# conan; we drive its plain-CMake path instead by handing it the dependency targets it expects
# via LOGPP_DEPS_*, and by adding only its src/ subdirectory. Adding logpp's root CMakeLists.txt
# would also pull in its examples, CPack and `format`/`version` custom targets.

set(LOGPP_SOURCE_DIR ${CMAKE_CURRENT_LIST_DIR}/logpp)

find_package(fmt CONFIG REQUIRED)
find_package(tomlplusplus CONFIG REQUIRED)

# logpp includes <toml.hpp>, the layout conan's tomlplusplus package provides. vcpkg installs the
# multi-header tree under include/toml++/, so bridge the two with a shim header.
add_library(logpp-toml-compat INTERFACE)

target_link_libraries(
   logpp-toml-compat
   INTERFACE
   tomlplusplus::tomlplusplus
)

target_include_directories(
   logpp-toml-compat SYSTEM
   INTERFACE
   ${CMAKE_CURRENT_LIST_DIR}/logpp-compat
)

# Dependency hooks read by logpp/src/CMakeLists.txt. Upstream's root CMakeLists.txt is what
# normally populates these, either from conan or from LOGPP_DEPS_*; since we skip it, set them here.
set(LOGPP_LIBS_FMT fmt::fmt)
set(LOGPP_LIBS_TOMLPLUSPLUS logpp-toml-compat)

# logpp/src/CMakeLists.txt sets VERSION/SOVERSION from PROJECT_VERSION*, which would otherwise come
# from `project(gpu-monolith)` and be empty
set(PROJECT_VERSION 0.1.3)
set(PROJECT_VERSION_MAJOR 0)

# logpp/src/CMakeLists.txt calls find_package(Filesystem), satisfied by logpp's bundled module.
# Note that module leaks `set(CMAKE_CXX_STANDARD 17)` into its caller's scope, so the call has to
# stay inside the add_subdirectory() below rather than being hoisted up here.
list(APPEND CMAKE_MODULE_PATH ${LOGPP_SOURCE_DIR}/cmake)

add_subdirectory(${LOGPP_SOURCE_DIR}/src ${CMAKE_BINARY_DIR}/archsim/third-party/logpp)

# Upstream forces `-pipe -march=native` on Clang/GCC, which defeats reproducible builds
set_property(TARGET logpp PROPERTY COMPILE_OPTIONS "")
