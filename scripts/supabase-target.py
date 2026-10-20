#!/usr/bin/env python3
"""Validate the local development Supabase target without printing credentials."""

from __future__ import annotations

import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlsplit

DEVELOPMENT_PROJECT_REF = "irgahixsuvtopiwmtkku"
REF_PATTERN = re.compile(r"^[a-z0-9]{20}$")
KEY_PATTERN = re.compile(r"^\s*(?:export\s+)?VITE_SUPABASE_URL\s*=")
OVERRIDE_FILES = (
    ".env.local",
    ".env.development",
    ".env.development.local",
)


class TargetError(Exception):
    pass


def fail(message: str) -> None:
    raise TargetError(message)


def read_env_url(path: Path) -> str:
    if not path.is_file():
        fail("Shared development frontend/.env is missing or is not a regular file.")
    values: list[str] = []
    for line in path.read_text(encoding="utf-8", errors="strict").splitlines():
        if not KEY_PATTERN.match(line):
            continue
        value = line.split("=", 1)[1].strip()
        if value.startswith(("'", '"')):
            quote = value[0]
            if len(value) < 2 or value[-1] != quote:
                fail("VITE_SUPABASE_URL cannot be parsed safely from frontend/.env.")
            value = value[1:-1]
        else:
            value = value.split("#", 1)[0].strip()
        if not value or "$" in value or "`" in value:
            fail("VITE_SUPABASE_URL must be a literal URL without interpolation.")
        values.append(value)
    if len(values) != 1:
        fail("frontend/.env must define VITE_SUPABASE_URL exactly once.")
    return values[0]


def shared_frontend_env(repo: Path, config: Path) -> Path:
    if any(parent.is_symlink() for parent in (config, config.parent, config.parent.parent)):
        fail("Common development settings directory must not be a symlink.")
    if not config.is_dir():
        fail("Shared development settings directory is missing.")
    if stat.S_IMODE(config.stat().st_mode) & 0o077:
        fail("Shared development settings directory must have mode 0700 or stricter.")
    frontend_dir = config / "frontend"
    if frontend_dir.is_symlink():
        fail("Shared development frontend directory must not be a symlink.")
    if not frontend_dir.is_dir():
        fail("Shared development frontend directory is missing.")
    shared_env = frontend_dir / ".env"
    if shared_env.is_symlink() or not shared_env.is_file():
        fail("Shared development frontend/.env must be a regular file.")
    if stat.S_IMODE(shared_env.stat().st_mode) & 0o077:
        fail("Shared development frontend/.env must have mode 0600 or stricter.")
    worktree_env = repo / "frontend" / ".env"
    if not worktree_env.is_symlink():
        fail(
            "frontend/.env must be a symlink to ~/.config/receipt-manager/development/frontend/.env."
        )
    if worktree_env.resolve() != shared_env.resolve():
        fail(
            "frontend/.env must symlink to the shared development frontend/.env for this machine."
        )
    return shared_env


def endpoint_ref(repo: Path, config: Path) -> str:
    if "VITE_SUPABASE_URL" in os.environ:
        fail("VITE_SUPABASE_URL process override is present; refusing an ambiguous target.")
    frontend = repo / "frontend"
    for filename in OVERRIDE_FILES:
        override = frontend / filename
        if not override.is_file():
            continue
        for line in override.read_text(encoding="utf-8", errors="strict").splitlines():
            if KEY_PATTERN.match(line):
                fail(f"VITE_SUPABASE_URL override exists in frontend/{filename}.")
    raw_url = read_env_url(shared_frontend_env(repo, config))
    try:
        parsed = urlsplit(raw_url)
        host = parsed.hostname or ""
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            fail("VITE_SUPABASE_URL is not a canonical Supabase project URL.")
    except ValueError:
        fail("VITE_SUPABASE_URL is not a canonical Supabase project URL.")
    match = re.fullmatch(r"([a-z0-9]{20})\.supabase\.co", host)
    if match is None:
        fail("VITE_SUPABASE_URL must use https://<project-ref>.supabase.co.")
    return match.group(1)


def validate(repo: Path, config: Path, allow_unlinked: bool) -> str:
    for key in ("SUPABASE_PROJECT_ID", "SUPABASE_DB_URL", "SUPABASE_WORKDIR"):
        if key in os.environ:
            fail(f"{key} override is present; refusing an ambiguous DB target.")
    if not REF_PATTERN.fullmatch(DEVELOPMENT_PROJECT_REF):
        fail("Configured development project ref is invalid.")
    url_ref = endpoint_ref(repo, config)
    if url_ref != DEVELOPMENT_PROJECT_REF:
        fail("Frontend Supabase URL does not match the allowed development project ref.")
    linked_path = repo / "supabase" / ".temp" / "project-ref"
    if linked_path.is_symlink() or linked_path.parent.is_symlink():
        fail("Supabase CLI link metadata must be stored inside this worktree.")
    if not linked_path.is_file():
        temp_dir = linked_path.parent
        if temp_dir.is_dir() and any(temp_dir.iterdir()):
            fail("Supabase link metadata is incomplete; inspect it manually.")
        if allow_unlinked:
            return DEVELOPMENT_PROJECT_REF
        fail("This worktree is not linked to a Supabase project; refusing the DB operation.")
    linked_ref = linked_path.read_text(encoding="ascii").strip()
    if not REF_PATTERN.fullmatch(linked_ref):
        fail("This worktree has an invalid Supabase CLI link ref.")
    if linked_ref != DEVELOPMENT_PROJECT_REF:
        fail("This worktree's Supabase CLI link does not match the allowed development target.")
    return DEVELOPMENT_PROJECT_REF


def main(argv: list[str]) -> int:
    try:
        command = argv[1]
        if command == "validate" and len(argv) == 5:
            result = validate(Path(argv[2]).resolve(), Path(argv[3]), argv[4] == "allow-unlinked")
            print(result)
        else:
            fail("Invalid Supabase target helper invocation.")
    except (TargetError, OSError, UnicodeError) as exc:
        print(f"[supabase-target] {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
