# [GPU Name Here]

Repository will contain:
- Architecture models
- RTL design
- DV tests
- SoC integration design
- FPGA bringup code
- SiVal tests

## Getting Ready for Hardware Development

**Advice:**
- If you're using Windows, try setting up under WSL
- Set up an `eda/` folder to download all your software into
- Use VSCode if you can, otherwise you may need to configure things yourself
- Ask for help! Maybe your issue is very common :smile:

**Required:** Verilator, for Verilog simulation and linting
- On MacOS: `brew install verilator`
- On Linux: Download and install from source [verilator/verilator](https://github.com/verilator/verilator)

**Language Server Option 1:** Veridian (recommended)
1. Follow instructions to [install Cargo](https://doc.rust-lang.org/cargo/getting-started/installation.html).
2. Check you know where `cargo` is. It is installed typically under `~/.cargo/bin/` on MacOS and Linux.
2. Build and install [vivekmalneedi/veridian](https://github.com/vivekmalneedi/veridian?tab=readme-ov-file) via:
   ```bash
   /path/to/cargo install --git https://github.com/vivekmalneedi/veridian.git
   ```
3. You should find the binary under `~/.cargo/bin/veridian`

**Language Server Option 2:** Universal CTags
- On MacOS: `brew install universal-ctags`
- On Linux: Download and install from source: [universal-ctags/ctags](https://github.com/universal-ctags/ctags)

## Setting up your C++ Environment

1. Install Ninja and CMake. For CMake, try to install the latest version, you can grab the `.sh` install file for **Linux** here: https://cmake.org/download/ (and .msi for **Windows**). On **MacOS**, use brew.
1. Download and install LLVM-19. **On Linux**, this can be installed with the LLVM install script by running:
   ```bash
   wget https://apt.llvm.org/llvm.sh
   chmod +x llvm.sh
   sudo ./llvm.sh 19
   ```
   and **on Windows**, you will need to download the `*-win64.exe` install executable from the [Github releases page here](https://github.com/llvm/llvm-project/releases/tag/llvmorg-19.1.0). **On MacOS** you may need to download through brew:
   ```sh
   brew install llvm@19
   ```
2. Confirm by running `clang-19`
3. Set up VCPKG by cloning the repository and running:
   ```bash
   git clone https://github.com/microsoft/vcpkg.git
   cd vcpkg
   ./bootstrap-vcpkg.sh
   ```
   (on Windows this will be a `.bat` file instead and you may need to download Visual Studio). Note that the `vcpkg/` directory is now your `VCPKG_ROOT`. **Make sure you add it to your path.** For more information see [the official setup guide](https://learn.microsoft.com/en-gb/vcpkg/get_started/get-started).
4. Confirm by running `vcpkg --version`
5. Open this repository in VSCode and download the recommended workspace extensions (it should prompt you, or you can go to the extensions panel and install it).
6. Copy over `CMakeUserPresets.template.json` into `CMakeUserPresets.json` and fill in the required paths under the `"environment"` key.
7. Reload VSCode
8. Set the CMake preset to be `default`
9. Run the configure and build command from the VSCode command palette or the CMake tool sidebar
