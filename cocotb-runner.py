import os
from pathlib import Path
from typing import Any

from cocotb_tools.runner import Verilator, _Command

out_file = os.getenv("TEST_EXECUTABLE", None)
assert out_file is not None, "TEST_EXECUTABLE environment variable is not set"
toplevel = os.getenv("TEST_TOPLEVEL", None)
assert toplevel is not None, "TEST_TOPLEVEL environment variable is not set"
test_module = os.getenv("COCOTB_TEST_MODULE", None)
assert test_module is not None, "COCOTB_TEST_MODULE environment variable is not set"


class MyVerilatorRunner(Verilator):
   def __init__(self, *args: Any, **kwargs: Any):
      super().__init__(*args, **kwargs)

   def _test_command(self) -> list[_Command]:
      return [
         [str(out_file)]
         + (["--trace"] if self.waves or self.gui else [])
         + self.test_args
         + self.plusargs
      ]


cwd = Path(__file__).parent
build_dir = cwd / "build"
build_dir.mkdir(exist_ok=True)
results = build_dir / "results.xml"

if results.exists():
   results.unlink()

runner = MyVerilatorRunner()
runner.test(
   test_module,
   hdl_toplevel=toplevel,
   hdl_toplevel_lang="verilog",
   build_dir=build_dir,
   test_dir=build_dir,
)

if not results.exists():
   exit(1)
else:
   exit(0)
