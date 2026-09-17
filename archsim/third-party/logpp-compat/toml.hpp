#pragma once

// logpp's TomlConfigurator.h includes <toml.hpp>, which is the layout conan's tomlplusplus
// package provides (a single-header amalgamation). vcpkg installs the multi-header tree under
// include/toml++/ instead, so forward to it rather than patching the submodule.
#include <toml++/toml.h>
