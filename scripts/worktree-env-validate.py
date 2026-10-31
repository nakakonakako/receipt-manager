#!/usr/bin/env python3
"""Validate managed worktree dotenv paths without reading their contents."""

from __future__ import annotations

import argparse
import os
import stat
import sys
from pathlib import Path

MANAGED = (".env", "frontend/.env", "frontend/.env.local", "backend/.env")
SCAN_DIRS = (
    ".",
    "frontend",
    "backend",
    "backend/app",
    "backend/app/services",
)


class ValidationError(Exception):
    """A safe, content-free validation failure."""


def fail(message: str) -> None:
    print(f"[worktree-env] {message}", file=sys.stderr)
    raise SystemExit(2)


def validate_real_directory_chain(
    path: Path,
    label: str,
    *,
    allow_missing: bool,
    base: Path | None = None,
) -> bool:
    """Reject symlink and non-directory components without following them."""
    absolute = Path(os.path.abspath(path))
    if base is None:
        current = Path(absolute.anchor)
        components = absolute.parts[1:]
    else:
        base = Path(os.path.abspath(base))
        if not absolute.is_relative_to(base):
            raise ValidationError(f"{label} path is outside its expected parent.")
        current = base
        components = absolute.relative_to(base).parts
    for component in components:
        current /= component
        try:
            info = current.lstat()
        except FileNotFoundError:
            if allow_missing:
                return False
            raise ValidationError(f"{label} directory is missing.") from None
        except OSError:
            raise ValidationError(f"Cannot inspect {label} directory.") from None
        if stat.S_ISLNK(info.st_mode):
            raise ValidationError(f"Unexpected symlink in {label} directory path.")
        if not stat.S_ISDIR(info.st_mode):
            raise ValidationError(f"{label} path component is not a directory.")
    return True


def validate_environment_config(home: Path, repository: str, environment: str) -> Path | None:
    config = home / ".config" / repository / environment
    if not validate_real_directory_chain(
        config, "Environment settings", allow_missing=True, base=home
    ):
        return None
    return config


def validate_workspace_directories(workspace: Path) -> list[Path]:
    directories: list[Path] = []
    for relative in SCAN_DIRS:
        directory = workspace if relative == "." else workspace / relative
        if not validate_real_directory_chain(
            directory,
            "Workspace dotenv lookup",
            allow_missing=True,
            base=workspace,
        ):
            continue
        directories.append(directory)
    return directories


def validate(mode: str, workspace_arg: Path, environment: str, repository: str) -> None:
    try:
        workspace = workspace_arg.resolve(strict=True)
    except (OSError, RuntimeError):
        raise ValidationError("Workspace path could not be resolved.") from None
    if not workspace.is_dir():
        raise ValidationError("Workspace path is not a directory.")

    home = Path(os.path.abspath(Path.home()))
    config = validate_environment_config(home, repository, environment)
    scan_directories = validate_workspace_directories(workspace)

    allowed = set(MANAGED)
    for directory in scan_directories:
        try:
            entries = tuple(directory.iterdir())
        except OSError:
            raise ValidationError("Cannot inspect workspace dotenv lookup directory.") from None
        for entry in entries:
            if not entry.name.startswith(".env"):
                continue
            relative = entry.relative_to(workspace).as_posix()
            if relative not in allowed:
                raise ValidationError(f"Unexpected .env-related path in workspace: {relative}")

    for relative in MANAGED:
        source = (config or (home / ".config" / repository / environment)) / relative
        target = workspace / relative

        if config is not None:
            source_parent = source.parent
            if source_parent != config:
                validate_real_directory_chain(
                    source_parent,
                    "Environment source",
                    allow_missing=True,
                    base=home,
                )

        try:
            source_info = source.lstat()
            source_exists = True
        except FileNotFoundError:
            source_info = None
            source_exists = False
        except OSError:
            raise ValidationError(f"Cannot inspect environment source: {relative}") from None

        if source_info is not None:
            if stat.S_ISLNK(source_info.st_mode) or not stat.S_ISREG(source_info.st_mode):
                raise ValidationError(f"Environment source must be a regular file: {relative}")

        try:
            target_info = target.lstat()
            target_exists = True
        except FileNotFoundError:
            target_info = None
            target_exists = False
        except OSError:
            raise ValidationError(f"Cannot inspect workspace environment path: {relative}") from None

        if target_info is not None and stat.S_ISLNK(target_info.st_mode):
            try:
                target.stat()
            except FileNotFoundError:
                raise ValidationError(f"Broken environment symlink: {relative}") from None
            except OSError:
                raise ValidationError(f"Cannot inspect environment symlink: {relative}") from None

        if not source_exists:
            if target_exists:
                raise ValidationError(f"Environment path has no configured source: {relative}")
            continue

        if not target_exists:
            if mode == "strict":
                raise ValidationError(f"Configured environment symlink is missing: {relative}")
            continue

        if target_info is None or not stat.S_ISLNK(target_info.st_mode):
            raise ValidationError(f"Environment path is not a symlink: {relative}")

        try:
            direct_target = os.readlink(target)
        except OSError:
            raise ValidationError(f"Cannot read environment symlink: {relative}") from None
        expected_target = str(source)
        if not os.path.isabs(expected_target) or direct_target != expected_target:
            raise ValidationError(f"Environment symlink does not directly target selected settings: {relative}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("pre", "strict"))
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--environment", default="development")
    parser.add_argument("--repository", default="")
    args = parser.parse_args()

    if not args.environment.replace("-", "").replace("_", "").isalnum():
        fail("Invalid environment name.")
    if not args.repository or not args.repository.replace("-", "").replace("_", "").isalnum():
        fail("Invalid repository name.")
    try:
        validate(args.mode, args.workspace, args.environment, args.repository)
    except ValidationError as error:
        fail(str(error))
    except OSError:
        fail("Environment paths could not be inspected safely.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
