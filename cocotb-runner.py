import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from cocotb_tools.runner import Verilator, _Command

out_file = os.getenv("TEST_EXECUTABLE", None)
assert out_file is not None, "TEST_EXECUTABLE environment variable is not set"
toplevel = os.getenv("TEST_TOPLEVEL", None)
assert toplevel is not None, "TEST_TOPLEVEL environment variable is not set"
test_module = os.getenv("COCOTB_TEST_MODULE", None)
assert test_module is not None, "COCOTB_TEST_MODULE environment variable is not set"
testcase = os.getenv("COCOTB_TESTCASE", None)
test_filter = os.getenv("COCOTB_TEST_FILTER", None)
run_dir = os.getenv("COCOTB_RUN_DIR", None)
results_xml = os.getenv("COCOTB_RESULTS_XML", None)


def optional_env(value: str | None) -> str | None:
   if value is None or value == "":
      return None
   return value


def format_testcase(testcase_elem: ET.Element) -> str:
   classname = testcase_elem.attrib.get("classname", test_module)
   name = testcase_elem.attrib.get("name", "<unknown>")
   file_name = testcase_elem.attrib.get("file")
   line_no = testcase_elem.attrib.get("lineno")

   if file_name and line_no:
      return f"{classname}.{name} ({file_name}:{line_no})"
   if file_name:
      return f"{classname}.{name} ({file_name})"
   return f"{classname}.{name}"


def failure_message(node: ET.Element) -> str:
   message = (node.attrib.get("error_msg") or node.attrib.get("message") or "").strip()
   text = (node.text or "").strip()
   if message and text:
      return f"{message}\n{text}"
   return message or text


def print_results_summary(results_path: Path, results_tree: ET.ElementTree) -> int:
   total = 0
   failed = 0
   errored = 0
   skipped = 0
   failing_cases: list[tuple[str, str, str]] = []

   for testcase_elem in results_tree.iter("testcase"):
      total += 1
      for failure_elem in testcase_elem.findall("failure"):
         failed += 1
         failing_cases.append(("FAIL", format_testcase(testcase_elem),
                               failure_message(failure_elem)))
      for error_elem in testcase_elem.findall("error"):
         errored += 1
         failing_cases.append(("ERROR", format_testcase(testcase_elem),
                               failure_message(error_elem)))
      skipped += len(testcase_elem.findall("skipped"))

   if failing_cases:
      print("", file=sys.stderr)
      print(f"cocotb failed tests from {results_path}:", file=sys.stderr)
      for kind, test_name, message in failing_cases:
         print(f"  {kind}: {test_name}", file=sys.stderr)
         if message:
            for line in message.splitlines()[:20]:
               print(f"    {line}", file=sys.stderr)
      passed = total - failed - errored - skipped
      print(f"cocotb summary: {passed} passed, {failed} failures, {errored} errors, "
            f"{skipped} skipped, {total} total", file=sys.stderr)
   else:
      passed = total - skipped
      print(f"cocotb summary: {passed} passed, {skipped} skipped, {total} total "
            f"({results_path})")

   return failed + errored


class MyVerilatorRunner(Verilator):

   def __init__(self, *args, **kwargs):
      super().__init__(*args, **kwargs)

   def _test_command(self) -> list[_Command]:
      return [[str(out_file)] + (["--trace"] if self.waves or self.gui else []) + self.test_args +
              self.plusargs]


cwd = Path(__file__).parent
build_dir = Path(run_dir) if run_dir else cwd / "build"
if not build_dir.is_absolute():
   build_dir = cwd / build_dir
build_dir.mkdir(parents=True, exist_ok=True)

results = Path(results_xml) if results_xml else build_dir / "results.xml"
if not results.is_absolute():
   results = cwd / results
results.parent.mkdir(parents=True, exist_ok=True)

if results.exists():
   results.unlink()

runner = MyVerilatorRunner()
simulator_exit_code = 0
try:
   runner.test(
       test_module,
       hdl_toplevel=toplevel,
       hdl_toplevel_lang="verilog",
       build_dir=build_dir,
       test_dir=build_dir,
       testcase=None,
       test_filter=optional_env(test_filter) or optional_env(testcase),
       results_xml=str(results),
       waves=True,
   )
except SystemExit as err:
   simulator_exit_code = err.code if isinstance(err.code, int) else 1

if not results.exists():
   print(f"cocotb did not write results XML: {results}", file=sys.stderr)
   print(f"cocotb run directory: {build_dir}", file=sys.stderr)
   sys.exit(simulator_exit_code or 1)

try:
   results_tree = ET.parse(results)
except ET.ParseError as err:
   print(f"Failed to parse cocotb results XML '{results}': {err}", file=sys.stderr)
   sys.exit(simulator_exit_code or 1)

failed_count = print_results_summary(results, results_tree)
print(f"cocotb run directory: {build_dir}")

if failed_count:
   sys.exit(1)

if simulator_exit_code:
   print(f"cocotb simulator exited with code {simulator_exit_code}", file=sys.stderr)
   sys.exit(simulator_exit_code)

sys.exit(0)
