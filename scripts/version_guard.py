#!/usr/bin/env python3
"""Check or bump project version across configured files.

Config format:
{
  "files": [
    {"path": "package.json", "type": "json", "key": "version"},
    {"path": "pyproject.toml", "type": "regex", "pattern": "version\\s*=\\s*\"([^\"]+)\""}
  ]
}
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].+)?$")


@dataclass
class VersionEntry:
    path: Path
    kind: str
    version: str
    spec: dict[str, Any]


def load_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Config not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    files = config.get("files")
    if not isinstance(files, list) or not files:
        raise SystemExit("Config must contain a non-empty 'files' list")
    return config


def get_json_value(data: Any, key: str) -> str:
    current = data
    for part in key.split("."):
        if not isinstance(current, dict) or part not in current:
            raise KeyError(key)
        current = current[part]
    if not isinstance(current, str):
        raise TypeError(f"{key} must be a string")
    return current


def set_json_value(data: Any, key: str, value: str) -> None:
    current = data
    parts = key.split(".")
    for part in parts[:-1]:
        current = current[part]
    current[parts[-1]] = value


def read_entry(root: Path, spec: dict[str, Any]) -> VersionEntry:
    rel_path = spec.get("path")
    if not isinstance(rel_path, str):
        raise SystemExit("Each file spec needs string 'path'")
    path = root / rel_path
    kind = spec.get("type", "json")

    if kind == "json":
        key = spec.get("key", "version")
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return VersionEntry(path=path, kind=kind, version=get_json_value(data, key), spec=spec)

    if kind == "regex":
        pattern = spec.get("pattern")
        if not isinstance(pattern, str):
            raise SystemExit(f"{rel_path}: regex spec needs string 'pattern'")
        text = path.read_text(encoding="utf-8")
        match = re.search(pattern, text, flags=re.MULTILINE)
        if not match:
            raise SystemExit(f"{rel_path}: pattern did not match")
        group = int(spec.get("versionGroup", 1))
        return VersionEntry(path=path, kind=kind, version=match.group(group), spec=spec)

    raise SystemExit(f"{rel_path}: unsupported type '{kind}'")


def write_entry(entry: VersionEntry, version: str) -> None:
    if entry.kind == "json":
        key = entry.spec.get("key", "version")
        with entry.path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        set_json_value(data, key, version)
        entry.path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return

    if entry.kind == "regex":
        pattern = entry.spec["pattern"]
        group = int(entry.spec.get("versionGroup", 1))
        text = entry.path.read_text(encoding="utf-8")
        match = re.search(pattern, text, flags=re.MULTILINE)
        if not match:
            raise SystemExit(f"{entry.path}: pattern did not match during write")
        start, end = match.span(group)
        entry.path.write_text(text[:start] + version + text[end:], encoding="utf-8")
        return

    raise SystemExit(f"{entry.path}: unsupported type '{entry.kind}'")


def parse_semver(version: str) -> tuple[int, int, int]:
    match = SEMVER_RE.match(version)
    if not match:
        raise SystemExit(f"Unsupported version '{version}'. Expected semver like 1.2.3")
    return tuple(int(part) for part in match.groups())


def bump_version(version: str, part: str) -> str:
    major, minor, patch = parse_semver(version)
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise SystemExit(f"Unsupported bump part: {part}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check or bump synced project version files.")
    parser.add_argument("--config", default=".version-sync.json", help="Version sync config path")
    parser.add_argument("--check", action="store_true", help="Check configured files have the same version")
    parser.add_argument("--bump", choices=["patch", "minor", "major"], help="Bump synced version")
    parser.add_argument("--set", dest="set_version", help="Set exact version")
    args = parser.parse_args()

    root = Path.cwd()
    config = load_config(root / args.config)
    entries = [read_entry(root, spec) for spec in config["files"]]
    versions = {entry.version for entry in entries}

    if len(versions) != 1:
        details = "\n".join(f"- {entry.path.relative_to(root)}: {entry.version}" for entry in entries)
        raise SystemExit(f"Version mismatch:\n{details}")

    current = entries[0].version
    next_version = args.set_version or (bump_version(current, args.bump) if args.bump else None)

    if next_version:
        parse_semver(next_version)
        for entry in entries:
            write_entry(entry, next_version)
        print(f"{current} -> {next_version}")
        return 0

    if args.check or not next_version:
        print(f"Version OK: {current}")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
