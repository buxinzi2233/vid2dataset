"""Built-in presets bundled with the wheel."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import tomli_w

from vid2dataset.config import ExtractConfig

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover
    import tomli as tomllib

PRESETS_PACKAGE = "vid2dataset.presets"
_PRESET_NAME = re.compile(r"[^a-z0-9_-]+")


def _preset_dir() -> Path:
    """Return the on-disk directory containing preset TOMLs.

    Handles normal installs, editable installs, and PyInstaller bundles.
    """
    # PyInstaller: check sys._MEIPASS first
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        p = Path(meipass) / "vid2dataset" / "presets"
        if p.exists() and any(p.glob("*.toml")):
            return p

    # importlib.resources (normal install)
    try:
        from importlib import resources
        p = Path(str(resources.files(PRESETS_PACKAGE)))
        if p.exists() and any(p.glob("*.toml")):
            return p
    except Exception:
        pass

    # Fallback: relative to this file
    p = Path(__file__).parent
    if any(p.glob("*.toml")):
        return p

    raise FileNotFoundError("Cannot locate preset TOML files")


def _user_preset_dir() -> Path:
    override = os.environ.get("VID2DATASET_PRESET_DIR")
    if override:
        return Path(override).expanduser()
    if sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return root / "vid2dataset" / "presets"


def _read_preset(path: Path) -> dict:
    with path.open("rb") as f:
        return tomllib.load(f)


def _preset_path(name: str) -> Path | None:
    user = _user_preset_dir() / f"{name}.toml"
    if user.is_file():
        return user
    built_in = _preset_dir() / f"{name}.toml"
    return built_in if built_in.is_file() else None


def list_presets() -> list[tuple[str, str]]:
    """Return ``(name, description)`` for built-in and user presets."""
    return [(name, description) for name, description, _user in list_preset_info()]


def list_preset_info() -> list[tuple[str, str, bool]]:
    """Return ``(name, description, user)`` for all visible presets."""
    out: dict[str, tuple[str, str, bool]] = {}
    for p in sorted(_preset_dir().glob("*.toml")):
        data = _read_preset(p)
        desc = str(data.get("description", "")).strip()
        out[p.stem] = (p.stem, desc, False)
    user_dir = _user_preset_dir()
    if user_dir.is_dir():
        for p in sorted(user_dir.glob("*.toml")):
            data = _read_preset(p)
            desc = str(data.get("description", "")).strip()
            out[p.stem] = (p.stem, desc, True)
    return [out[name] for name in sorted(out)]


def load_preset(name: str) -> dict:
    """Return the merged config dict from a named preset.

    The preset's ``description`` field is stripped — it's metadata only.
    Anything else is treated as ``ExtractConfig`` overrides.
    """
    path = _preset_path(name)
    if path is None:
        available = ", ".join(n for n, _ in list_presets())
        raise FileNotFoundError(
            f"Preset '{name}' not found. Available: {available}"
        )
    data = _read_preset(path)
    data.pop("description", None)
    return data


def save_preset(name: str, description: str, config: dict) -> tuple[str, Path]:
    """Validate and atomically persist a user preset."""
    normalized = _PRESET_NAME.sub("-", name.strip().lower()).strip("-_")
    if not normalized:
        raise ValueError("Preset name must contain letters or numbers")
    if (_preset_dir() / f"{normalized}.toml").exists():
        raise ValueError(f"Built-in preset '{normalized}' cannot be overwritten")

    excluded = {"input", "output", "segments", "dedup_index"}
    allowed = set(ExtractConfig.model_fields) - excluded
    unknown = sorted(set(config) - allowed - excluded)
    if unknown:
        raise ValueError(f"Unknown preset fields: {', '.join(unknown)}")
    values = {key: value for key, value in config.items() if key in allowed}
    validated = ExtractConfig(input=Path("."), **values)
    serialized = validated.to_toml_dict()
    saved = {key: serialized[key] for key in values if key in serialized}
    document = {"description": description.strip(), **saved}

    target = _user_preset_dir() / f"{normalized}.toml"
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".toml.tmp")
    tmp.write_text(tomli_w.dumps(document), encoding="utf-8")
    tmp.replace(target)
    return normalized, target
