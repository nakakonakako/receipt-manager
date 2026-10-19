#!/usr/bin/env python3
"""Validate the local development Supabase target without printing credentials."""

from __future__ import annotations

import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import urlsplit

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
        fail("frontend/.env is missing or is not a regular file.")
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


def endpoint_ref(repo: Path) -> str:
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
    raw_url = read_env_url(frontend / ".env")
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


def read_registration(path: Path) -> tuple[str, str]:
    if not path.exists():
        fail("Development and production Supabase refs are not registered.")
    if path.is_symlink() or not path.is_file():
        fail("Development and production Supabase refs must be stored in a regular file.")
    if any(parent.is_symlink() for parent in (path.parent, path.parent.parent, path.parent.parent.parent)):
        fail("Common Supabase settings directories must not be symlinks.")
    if stat.S_IMODE(path.parent.stat().st_mode) & 0o077:
        fail("Supabase project ref settings directory must have mode 0700 or stricter.")
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        fail("Supabase project ref settings must have mode 0600 or stricter.")
    values: dict[str, str] = {}
    for line in path.read_text(encoding="ascii").splitlines():
        if "=" not in line:
            fail("Supabase project ref settings are malformed.")
        key, value = line.split("=", 1)
        if key in values or key not in {"development", "production"}:
            fail("Supabase project ref settings are malformed.")
        values[key] = value
    dev_ref = values.get("development", "")
    prod_ref = values.get("production", "")
    if not REF_PATTERN.fullmatch(dev_ref) or not REF_PATTERN.fullmatch(prod_ref):
        fail("Registered Supabase refs must each be 20 lowercase letters or digits.")
    if dev_ref == prod_ref:
        fail("Development and production Supabase refs must be different.")
    return dev_ref, prod_ref


def validate(repo: Path, config: Path, allow_unlinked: bool) -> str:
    for key in ("SUPABASE_PROJECT_ID", "SUPABASE_DB_URL", "SUPABASE_WORKDIR"):
        if key in os.environ:
            fail(f"{key} override is present; refusing an ambiguous DB target.")
    legacy_registration = config / "supabase-development-project-ref"
    if legacy_registration.exists() or legacy_registration.is_symlink():
        fail("A legacy single-ref registration exists; review it manually before DB operations.")
    registration = config / "supabase-project-refs"
    dev_ref, prod_ref = read_registration(registration)
    configured_prod_ref = os.environ.get("PROD_SUPABASE_PROJECT_ID")
    if configured_prod_ref is not None and configured_prod_ref != prod_ref:
        fail("PROD_SUPABASE_PROJECT_ID does not match the registered production ref.")
    url_ref = endpoint_ref(repo)
    if dev_ref == prod_ref:
        fail("Development ref matches the registered production ref.")
    if url_ref != dev_ref:
        fail("Frontend Supabase URL does not match the registered development ref.")
    linked_path = repo / "supabase" / ".temp" / "project-ref"
    if linked_path.is_symlink() or linked_path.parent.is_symlink():
        fail("Supabase CLI link metadata must be stored inside this worktree.")
    if not linked_path.is_file():
        temp_dir = linked_path.parent
        if temp_dir.is_dir() and any(temp_dir.iterdir()):
            fail("Supabase link metadata is incomplete; inspect it manually.")
        if allow_unlinked:
            return dev_ref
        fail("This worktree is not linked to a Supabase project; refusing the DB operation.")
    linked_ref = linked_path.read_text(encoding="ascii").strip()
    if not REF_PATTERN.fullmatch(linked_ref):
        fail("This worktree has an invalid Supabase CLI link ref.")
    if linked_ref != dev_ref or linked_ref == prod_ref:
        fail("This worktree's Supabase CLI link does not match the registered development target.")
    return dev_ref


def register(repo: Path, config: Path, dev_ref: str, prod_ref: str) -> None:
    if not REF_PATTERN.fullmatch(dev_ref) or not REF_PATTERN.fullmatch(prod_ref):
        fail("Project refs must each be 20 lowercase letters or digits.")
    if dev_ref == prod_ref:
        fail("Development and production Supabase refs must be different.")
    if endpoint_ref(repo) != dev_ref:
        fail("Development ref does not match the frontend Supabase URL.")
    if any(parent.is_symlink() for parent in (config, config.parent, config.parent.parent)):
        fail("Common Supabase settings directory must not be a symlink.")
    legacy_registration = config / "supabase-development-project-ref"
    if legacy_registration.exists() or legacy_registration.is_symlink():
        fail("A legacy single-ref registration exists; review it manually before registering both refs.")
    config.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(config, 0o700)
    path = config / "supabase-project-refs"
    if path.exists() or path.is_symlink():
        fail("Supabase project refs are already registered; refusing to overwrite.")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as stream:
        stream.write(f"development={dev_ref}\nproduction={prod_ref}\n")
    os.chmod(path, 0o600)


def main(argv: list[str]) -> int:
    try:
        command = argv[1]
        if command == "validate" and len(argv) == 5:
            result = validate(Path(argv[2]).resolve(), Path(argv[3]), argv[4] == "allow-unlinked")
            print(result)
        elif command == "register" and len(argv) == 6:
            register(Path(argv[2]).resolve(), Path(argv[3]), argv[4], argv[5])
        else:
            fail("Invalid Supabase target helper invocation.")
    except (TargetError, OSError, UnicodeError) as exc:
        print(f"[supabase-target] {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
