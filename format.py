"""Format and lint Python sources. Run with `uv run format.py`."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def existing_targets() -> list[str]:
   # Recursively search for .py files but ignore gitignore and third-party directories.
   targets: list[str] = []
   for path in ROOT.rglob("*.py"):
      if any(part in {".venv", "third-party", "__pycache__"} for part in path.parts):
         continue
      targets.append(str(path))
   return targets


def run(name: str, cmd: list[str]) -> int:
   print(f"\n>>> {name}: {' '.join(cmd)}", flush=True)
   if shutil.which(cmd[0]) is None:
      print(f"  error: '{cmd[0]}' not found on PATH", file=sys.stderr)
      return 127
   return subprocess.run(cmd, cwd=ROOT).returncode


def main() -> int:
   parser = argparse.ArgumentParser(description=__doc__)
   parser.add_argument(
       "--check",
       action="store_true",
       help="Don't modify files; exit non-zero if formatting would change.",
   )
   parser.add_argument(
       "--no-mypy",
       action="store_true",
       help="Skip the mypy type-check step.",
   )
   args = parser.parse_args()

   targets = existing_targets()
   if not targets:
      print("no targets found", file=sys.stderr)
      return 1

   isort_cmd = ["isort", *targets]
   yapf_cmd = ["yapf", *targets]
   if args.check:
      isort_cmd.insert(1, "--check-only")
      yapf_cmd += ["--diff", "--exit-code"]
   else:
      yapf_cmd.append("--in-place")

   failures: list[str] = []
   if (rc := run("isort", isort_cmd)) != 0:
      failures.append(f"isort ({rc})")
   if (rc := run("yapf", yapf_cmd)) != 0:
      failures.append(f"yapf ({rc})")
   if not args.no_mypy:
      if (rc := run("mypy", ["mypy"])) != 0:
         failures.append(f"mypy ({rc})")

   print()
   if failures:
      print("FAILED: " + ", ".join(failures), file=sys.stderr)
      return 1
   print("OK")
   return 0


if __name__ == "__main__":
   sys.exit(main())
