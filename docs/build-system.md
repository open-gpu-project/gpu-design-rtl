# Build System: Verilog Libraries & Cocotb/Verilator Testbenches

This document describes the CMake-based build system used for RTL design and simulation in this repository. It covers the custom CMake functions, directory conventions, and a step-by-step guide for adding a new design partition.


## Overview

The build system is implemented as a set of custom CMake functions defined under `cmake/toolchain/`. These functions wrap Verilator and cocotb to provide a clean, declarative build API:

| Function | Purpose |
|---|---|
| `add_verilog_library` | Declare a reusable set of SystemVerilog/Verilog sources as a named CMake target |
| `add_cocotb_verilator` | Verilate a design and build a simulation executable linked against cocotb |
| `add_cocotb_test` | Register a cocotb Python test module as a CTest test case |

The build graph looks like:

```
add_verilog_library (svlib_*)      <-- shared IP / stubs
        |
        | LINK_LIBRARIES
        v
add_verilog_library (svpart_*)     <-- partition RTL
        |
        | LINK_LIBRARIES
        v
add_cocotb_verilator (sim*)        <-- simulation executable
        |
        | executable_target
        v
add_cocotb_test                    <-- CTest entry
```

---

## Prerequisites

The following tools must be on your `PATH` before running CMake:

| Tool | Purpose |
|---|---|
| `verilator` | Verilog-to-C++ transpiler; version is checked against cocotb's minimum at configure time |
| `uv` | Python package/environment manager; used to run cocotb tooling at configure and test time |
| `ninja` | Build backend (specified in `CMakePresets.json`) |

Python dependencies (including `cocotb`) are declared in `pyproject.toml` and are managed by `uv`. Run `uv sync` once after cloning.

---

## Building the Project

```sh
# Configure (from repo root)
cmake --preset vcpkg-template-preset

# Build everything
cmake --build build

# Or build a specific target
cmake --build build --target simpart_xu
```

> **Note:** Verilator runs at **CMake configure time** to discover the set of generated C++ source files. This means you must re-run `cmake --preset ...` (or trigger a reconfigure) when RTL sources are added or removed — not just when they are modified. Modifications to existing RTL files are handled automatically by the incremental build.

---

## Directory Conventions

```
design/
├── build.cmake               # Includes libraries/ and partitions/ build files
├── libraries/
│   ├── build.cmake           # Includes each library's build.cmake
│   └── <lib-name>/
│       ├── build.cmake
│       └── *.sv / *.svh
└── partitions/
    ├── build.cmake           # Includes each partition's build.cmake
    └── <partition-name>/
        ├── build.cmake       # Calls add_verilog_library, add_cocotb_verilator, add_cocotb_test
        ├── rtl/              # RTL source files (*.sv, *.svh)
        └── dv/               # Verification (cocotb Python test files)
```

**Target naming rules** (enforced by convention):
- Shared library targets: must be prefixed `svlib_` (e.g., `svlib_unisim`)
- Partition RTL targets: must be prefixed `svpart_` (e.g., `svpart_xu`)
- Simulation executable targets: no enforced prefix, but use a descriptive name (e.g., `simpart_xu`)

---

## Running Tests

```sh
# Build first
cmake --build build

# Run all tests
ctest --test-dir build

# Run a specific test by name (supports wildcards)
ctest --test-dir build -R simpart_xu

# Run with verbose output (see cocotb logs)
ctest --test-dir build -V

# Run in parallel
ctest --test-dir build -j4
```

Test results are written to `results.xml` inside the partition's `dv/` directory.

---

## How to Add a New Design Partition

This example creates a new partition called `my_block`.

### 1. Create the directory structure

```sh
mkdir -p design/partitions/my_block/rtl
mkdir -p design/partitions/my_block/dv
```

### 2. Add RTL source files

Place your SystemVerilog files under `design/partitions/my_block/rtl/`. Create a top-level module that will be the DUT:

```
design/partitions/my_block/rtl/
├── my_block_pkg.svh      # optional package/header
├── my_submodule.sv
└── top.sv                # top-level module (name must match TOP_MODULE below)
```

### 3. Create `build.cmake`

```cmake
# design/partitions/my_block/build.cmake

add_verilog_library(
    svpart_my_block
    SOURCES
        ${CMAKE_CURRENT_LIST_DIR}/rtl/my_submodule.sv
        ${CMAKE_CURRENT_LIST_DIR}/rtl/top.sv
    INCLUDE_DIRECTORIES
        ${CMAKE_CURRENT_LIST_DIR}/rtl
    LINK_LIBRARIES
        svlib_unisim        # add any shared libraries you depend on
)

add_cocotb_verilator(
    simpart_my_block
    TOP_MODULE my_top_module_name   # must match the SystemVerilog module name
    LINK_LIBRARIES svpart_my_block
    VERILATOR_ARGS --trace          # optional: enable waveform tracing
)

add_cocotb_test(simpart_my_block design.partitions.my_block.dv.test_my_block)
```

### 4. Create the cocotb test file

```python
# design/partitions/my_block/dv/test_my_block.py

import cocotb
from cocotb.triggers import Timer

@cocotb.test()
async def basic_test(dut):
    """Smoke test: verify reset state."""
    dut.rst.value = 1
    await Timer(10, unit="ns")
    dut.rst.value = 0
    await Timer(10, unit="ns")
    assert dut.out.value == 0
```

The module path passed to `add_cocotb_test` (`design.partitions.my_block.dv.test_my_block`) must be the Python import path of this file relative to the repository root. Each directory in the path needs an `__init__.py` **only if** Python cannot find the module otherwise — cocotb resolves modules by path, so this is typically not required.

### 5. Register the partition in the build

Edit `design/partitions/build.cmake` to include your new partition:

```cmake
include(${CMAKE_CURRENT_LIST_DIR}/xu/build.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/my_block/build.cmake)   # add this line
```

### 6. Reconfigure and build

```sh
cmake --preset vcpkg-template-preset
cmake --build build --target simpart_my_block
ctest --test-dir build -R simpart_my_block -V
```

---

## How to Add a New Shared Library

Shared libraries live under `design/libraries/` and are used for shared stubs, vendor primitives, or common headers used across multiple partitions.

### 1. Create the directory

```sh
mkdir -p design/libraries/my_lib
```

### 2. Create `build.cmake`

```cmake
# design/libraries/my_lib/build.cmake

add_verilog_library(
    svlib_my_lib
    SOURCES
        ${CMAKE_CURRENT_LIST_DIR}/my_stub.sv
    INCLUDE_DIRECTORIES
        ${CMAKE_CURRENT_LIST_DIR}
)
```

Target name must start with `svlib_`.

### 3. Register it

Edit `design/libraries/build.cmake`:

```cmake
include(${CMAKE_CURRENT_LIST_DIR}/unisim/build.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/my_lib/build.cmake)   # add this line
```

Then reference it in any partition or other library via `LINK_LIBRARIES svlib_my_lib`.

---

## How It All Fits Together

```
CMakeLists.txt
└── cmake/toolchain.cmake
    ├── python_toolchain.cmake   # finds uv; defines uv_run macro
    ├── verilog_toolchain.cmake  # finds verilator; queries cocotb config paths
    ├── add_verilog_library.cmake
    ├── add_cocotb_verilator.cmake
    └── add_cocotb_test.cmake
design/build.cmake
├── libraries/build.cmake
│   └── unisim/build.cmake      → svlib_unisim (INTERFACE target)
└── partitions/build.cmake
    └── xu/build.cmake
        ├── svpart_xu            (INTERFACE target: RTL sources + includes)
        ├── simpart_xu           (EXECUTABLE target: verilated sim + cocotb)
        └── CTest entry: simpart_xu_design.partitions.xu.dv.test_alu_lane_test
```

At test time, CTest invokes `cocotb-runner.py` via `uv run`, passing the simulation binary, top module, and test module as environment variables. The runner uses cocotb's `Verilator` runner class to execute the pre-built binary and collect results from `results.xml`.
