"""Format and lint Python sources. Run with `uv run format.py`."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXCLUDES: frozenset[str] = frozenset({".venv", "third-party", "__pycache__", "build"})
MYPY_PACKAGES: frozenset[str] = frozenset({"archsim", "design"})


# Recursively search for .py files but ignore gitignore and third-party directories.
def existing_targets() -> list[str]:
   targets: list[str] = []
   for path in ROOT.rglob("*.py"):
      if any(part in EXCLUDES for part in path.parts):
         continue
      targets.append(str(path))
   return targets


# Run a command and print it out. Return the command's exit code.
def run(name: str, cmd: list[str]) -> int:
   print(f"\n>>> {name}: {' '.join(cmd)}", flush=True)
   if shutil.which(cmd[0]) is None:
      print(f"  error: '{cmd[0]}' not found on PATH", file=sys.stderr)
      return 127
   return subprocess.run(cmd, cwd=ROOT).returncode


def main() -> int:
   # Parse command-line arguments
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

   # Collect the list of files to check
   print("Collecting targets...")
   targets = existing_targets()
   if not targets:
      print("no targets found", file=sys.stderr)
      return 1

   # Build the mypy command args
   mypy_args = []
   for pkg in MYPY_PACKAGES:
      mypy_args += ["-p", pkg]

   # Build all the commands to run
   commands: dict[str, list[str]] = {
      "ruff_check": ["ruff", "check"],
      "ruff_check_fix": ["ruff", "check", "--fix"],
      "ruff_format": ["ruff", "format"],
      "mypy": ["mypy", *mypy_args],
   }

   # Remove commands based on flags
   if args.check:
      commands.pop("ruff_check_fix")
      commands.pop("ruff_format")
   if args.no_mypy:
      commands.pop("mypy")

   # Run through the commands
   failures: list[str] = []
   for name, cmd in commands.items():
      if (rc := run(name, cmd)) != 0:
         failures.append(f"{name} ({rc})")

   # Report results
   print()
   if failures:
      print("FAILED: " + ", ".join(failures), file=sys.stderr)
      return 1
   print("OK")
   return 0


if __name__ == "__main__":
   sys.exit(main())
