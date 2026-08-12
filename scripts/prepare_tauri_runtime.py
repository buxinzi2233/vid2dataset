"""Stage the Python engine and a relocatable CPU runtime for Tauri bundles."""

from __future__ import annotations

import importlib.metadata
import os
import shutil
import stat
import sys
import sysconfig
from pathlib import Path

from packaging.requirements import Requirement

REPO_ROOT = Path(__file__).resolve().parents[1]
RESOURCE_ROOT = REPO_ROOT / "src-tauri" / "bundle-resources"
TAURI_TARGET_ROOT = REPO_ROOT / "src-tauri" / "target"
PYTHON_ROOT = RESOURCE_ROOT / "runtime" / "python"
SITE_PACKAGES = Path(sysconfig.get_paths()["purelib"]).resolve()

ROOT_DISTRIBUTIONS = (
    "ImageHash",
    "Pillow",
    "imageio-ffmpeg",
    "numpy",
    "onnxruntime-gpu",
    "opencv-python",
    "psutil",
    "pydantic",
    "scenedetect",
    "tomli-w",
)

# The development environment uses onnxruntime-gpu, but the Linux desktop
# bundle only needs the CPU provider for the WD tagger. Shipping the optional
# CUDA/TensorRT providers makes linuxdeploy chase host-specific CUDA libraries
# and adds roughly 270 MiB to every package. The core runtime and Python
# binding remain fully CPU-capable without these provider plug-ins.
BUNDLED_RUNTIME_EXCLUDES = {
    Path("onnxruntime/capi/libonnxruntime_providers_cuda.so"),
    Path("onnxruntime/capi/libonnxruntime_providers_tensorrt.so"),
}

SKIP_DISTRIBUTIONS: set[str] = set()
STDLIB_EXCLUDES = {
    "__pycache__",
    "ensurepip",
    "idlelib",
    "lib2to3",
    "site-packages",
    "test",
    "tkinter",
    "turtledemo",
    "venv",
}
ENGINE_MODULES = (
    "__init__.py",
    "async_writer.py",
    "auto_quality.py",
    "color_diversity.py",
    "completeness.py",
    "config.py",
    "crop.py",
    "dedup.py",
    "diversity.py",
    "extractor.py",
    "gallery.py",
    "gpu_filters.py",
    "gpu_runtime.py",
    "hardware.py",
    "io_utils.py",
    "keyframe_decoder.py",
    "quality.py",
    "report.py",
    "resize.py",
    "scene.py",
    "tagger.py",
    "tagger_runtime.py",
    "updater.py",
    "watermark.py",
)


def clear_stale_tauri_resources() -> None:
    """Remove generated resource mirrors that Tauri updates without pruning."""
    profiles = {
        TAURI_TARGET_ROOT / "debug",
        TAURI_TARGET_ROOT / "release",
        *TAURI_TARGET_ROOT.glob("*/debug"),
        *TAURI_TARGET_ROOT.glob("*/release"),
    }
    for profile in profiles:
        for name in ("bridge", "python", "runtime"):
            shutil.rmtree(profile / name, ignore_errors=True)
        (profile / "runtime-manifest.txt").unlink(missing_ok=True)

        bundle = profile / "bundle"
        for app_dir in (bundle / "appimage").glob("*.AppDir"):
            shutil.rmtree(app_dir, ignore_errors=True)
        shutil.rmtree(bundle / "appimage_deb", ignore_errors=True)
        for kind in ("deb", "rpm"):
            package_dir = bundle / kind
            if not package_dir.is_dir():
                continue
            for work_dir in package_dir.iterdir():
                if work_dir.is_dir():
                    shutil.rmtree(work_dir, ignore_errors=True)


def normalized(name: str) -> str:
    return name.lower().replace("_", "-").replace(".", "-")


def dependency_closure(roots: tuple[str, ...]) -> list[importlib.metadata.Distribution]:
    pending = list(roots)
    found: dict[str, importlib.metadata.Distribution] = {}
    while pending:
        name = pending.pop()
        key = normalized(name)
        if key in found or key in SKIP_DISTRIBUTIONS:
            continue
        dist = importlib.metadata.distribution(name)
        found[key] = dist
        for raw in dist.requires or ():
            requirement = Requirement(raw)
            if requirement.marker is None or requirement.marker.evaluate():
                pending.append(requirement.name)
    return [found[key] for key in sorted(found)]


def copy_distribution(dist: importlib.metadata.Distribution, destination: Path) -> None:
    for entry in dist.files or ():
        source = Path(dist.locate_file(entry)).resolve()
        try:
            relative = source.relative_to(SITE_PACKAGES)
        except ValueError:
            continue
        if relative in BUNDLED_RUNTIME_EXCLUDES:
            continue
        if not source.is_file():
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def copy_python_runtime() -> None:
    version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    base_prefix = Path(sys.base_prefix).resolve()
    interpreter = Path(sys._base_executable).resolve()
    stdlib = base_prefix / "lib" / version
    runtime_stdlib = PYTHON_ROOT / "lib" / version

    (PYTHON_ROOT / "bin").mkdir(parents=True, exist_ok=True)
    (PYTHON_ROOT / "lib").mkdir(parents=True, exist_ok=True)
    runtime_stdlib.mkdir(parents=True, exist_ok=True)
    shutil.copy2(interpreter, PYTHON_ROOT / "bin" / interpreter.name)

    ld_library = sysconfig.get_config_var("LDLIBRARY")
    library_dir = Path(sysconfig.get_config_var("LIBDIR") or base_prefix / "lib")
    if ld_library:
        shutil.copy2(library_dir / ld_library, PYTHON_ROOT / "lib" / ld_library)

    for source in stdlib.iterdir():
        if source.name in STDLIB_EXCLUDES or source.name.startswith("config-"):
            continue
        target = runtime_stdlib / source.name
        if source.is_dir():
            shutil.copytree(
                source,
                target,
                symlinks=True,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
            )
        elif source.suffix not in {".pyc", ".pyo"}:
            shutil.copy2(source, target)

    runtime_site = runtime_stdlib / "site-packages"
    runtime_site.mkdir(parents=True, exist_ok=True)
    distributions = dependency_closure(ROOT_DISTRIBUTIONS)
    for dist in distributions:
        copy_distribution(dist, runtime_site)

    executable = PYTHON_ROOT / "bin" / interpreter.name
    executable.chmod(executable.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    manifest = RESOURCE_ROOT / "runtime-manifest.txt"
    manifest.write_text(
        "\n".join(
            [
                f"python={sys.version.split()[0]}",
                f"executable={interpreter.name}",
                "onnxruntime_mode=cpu-only",
                *(f"distribution={dist.metadata['Name']}=={dist.version}" for dist in distributions),
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def stage_sources() -> None:
    shutil.copytree(
        REPO_ROOT / "bridge",
        RESOURCE_ROOT / "bridge",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )
    source_package = REPO_ROOT / "src" / "vid2dataset"
    target_package = RESOURCE_ROOT / "python" / "vid2dataset"
    target_package.mkdir(parents=True)
    for name in ENGINE_MODULES:
        shutil.copy2(source_package / name, target_package / name)
    shutil.copytree(
        source_package / "presets",
        target_package / "presets",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )


def main() -> None:
    if os.name != "posix":
        raise SystemExit("The bundled Python runtime staging script currently supports POSIX builds")
    if not str(SITE_PACKAGES).startswith(str((REPO_ROOT / "venv").resolve())):
        raise SystemExit(f"Run with the project venv Python, got site-packages at {SITE_PACKAGES}")
    clear_stale_tauri_resources()
    shutil.rmtree(RESOURCE_ROOT, ignore_errors=True)
    RESOURCE_ROOT.mkdir(parents=True)
    stage_sources()
    copy_python_runtime()
    print(f"Staged Tauri resources at {RESOURCE_ROOT}")


if __name__ == "__main__":
    main()
