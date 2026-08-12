"""Run the local Tauri CLI with Linux bundle compatibility settings."""

from __future__ import annotations

import os
import subprocess
import sys
import sysconfig
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TAURI_CLI = REPO_ROOT / "ui" / "node_modules" / ".bin" / "tauri"


def main() -> int:
    if not TAURI_CLI.is_file():
        raise SystemExit("Tauri CLI is not installed; run pnpm install in ui first")

    env = os.environ.copy()
    if sys.platform.startswith("linux"):
        site_packages = Path(sysconfig.get_paths()["purelib"])
        wheel_libs = [
            site_packages / "scipy.libs",
            site_packages / "opencv_python.libs",
            site_packages / "numpy.libs",
        ]
        existing = env.get("LD_LIBRARY_PATH")
        paths = [str(path) for path in wheel_libs if path.is_dir()]
        if existing:
            paths.append(existing)
        env["LD_LIBRARY_PATH"] = os.pathsep.join(paths)

        # Tauri's cached linuxdeploy currently embeds an older strip that does
        # not understand RELR sections emitted by rolling-release toolchains.
        env.setdefault("NO_STRIP", "1")

    return subprocess.call([str(TAURI_CLI), *sys.argv[1:]], cwd=REPO_ROOT, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
