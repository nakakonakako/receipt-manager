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


def read_env_values(
    path: Path, keys: set[str], *, allow_empty: bool = False
) -> dict[str, str]:
    """Read selected literal settings from dotenv without exposing their values."""
    if not path.is_file():
        fail(f"Backend environment file {path.name} is missing or is not a regular file.")
    values: dict[str, str] = {}
    key_pattern = re.compile(
        r"^\s*(?:export\s+)?(" + "|".join(re.escape(key) for key in keys) + r")\s*="
    )
    for line in path.read_text(encoding="utf-8", errors="strict").splitlines():
        match = key_pattern.match(line)
        if match is None:
            continue
        key = match.group(1)
        if key in values:
            fail(f"{key} must be defined at most once in {path.name}.")
        value = line[match.end() :].strip()
        if value.startswith(("'", '"')):
            quote = value[0]
            closing = value.find(quote, 1)
            if closing < 0:
                fail(f"{key} cannot be parsed safely from {path.name}.")
            suffix = value[closing + 1 :].strip()
            if suffix and not suffix.startswith("#"):
                fail(f"{key} cannot be parsed safely from {path.name}.")
            value = value[1:closing]
        else:
            value = value.split("#", 1)[0].strip()
        if (not value and not allow_empty) or "$" in value or "`" in value:
            fail(f"{key} must be a literal environment value without interpolation.")
        values[key] = value
    return values


def url_project_ref(raw_url: str, setting_name: str = "VITE_SUPABASE_URL") -> str:
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
            fail(f"{setting_name} is not a canonical Supabase project URL.")
    except ValueError:
        fail(f"{setting_name} is not a canonical Supabase project URL.")
    match = re.fullmatch(r"([a-z0-9]{20})\.supabase\.co", host)
    if match is None:
        fail(f"{setting_name} must use https://<project-ref>.supabase.co.")
    return match.group(1)


def validate_shared_development_frontend_env(config: Path) -> Path:
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
    return shared_env


def require_worktree_frontend_env_symlink(repo: Path, shared_env: Path) -> None:
    worktree_env = repo / "frontend" / ".env"
    if not worktree_env.is_symlink():
        fail(
            "frontend/.env must be a symlink to ~/.config/receipt-manager/development/frontend/.env."
        )
    if not worktree_env.exists():
        fail("Broken frontend/.env symlink; inspect it manually before running DB commands.")
    if worktree_env.resolve() != shared_env.resolve():
        fail(
            "frontend/.env must symlink to the shared development frontend/.env for this machine."
        )


def shared_frontend_env(repo: Path, config: Path) -> Path:
    shared_env = validate_shared_development_frontend_env(config)
    require_worktree_frontend_env_symlink(repo, shared_env)
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
    return url_project_ref(read_env_url(shared_frontend_env(repo, config)))


def development_endpoint_ref(repo: Path, config: Path) -> str:
    """Validate the effective frontend and backend URLs before local app startup."""
    if os.environ.get("PYTHON_DOTENV_DISABLED", "").casefold() in {
        "1",
        "true",
        "t",
        "yes",
        "y",
    }:
        fail("PYTHON_DOTENV_DISABLED prevents backend dotenv loading.")

    for key in ("VITE_SUPABASE_URL", "SUPABASE_URL"):
        if key in os.environ:
            fail(f"{key} process override is present; refusing an ambiguous development target.")

    shared_env = validate_shared_development_frontend_env(config)
    worktree_env = repo / "frontend" / ".env"
    if worktree_env.is_symlink():
        require_worktree_frontend_env_symlink(repo, shared_env)
    elif not worktree_env.is_file() or worktree_env.read_bytes() != shared_env.read_bytes():
        fail("frontend/.env must match the shared development frontend/.env.")

    frontend_ref = url_project_ref(read_env_url(worktree_env))
    if frontend_ref != DEVELOPMENT_PROJECT_REF:
        fail("Frontend Supabase URL does not match the allowed development project ref.")

    frontend_dir = repo / "frontend"
    for filename in OVERRIDE_FILES:
        override = frontend_dir / filename
        if not override.exists() and not override.is_symlink():
            continue
        if override.is_symlink() and not override.exists():
            fail(f"frontend/{filename} is a broken environment symlink.")
        if not override.is_file():
            fail(f"frontend/{filename} is not a regular environment file.")
        for line in override.read_text(encoding="utf-8", errors="strict").splitlines():
            if KEY_PATTERN.match(line):
                fail(f"VITE_SUPABASE_URL override exists in frontend/{filename}.")

    service_env = repo / "backend" / "app" / "services" / ".env"
    if service_env.exists() or service_env.is_symlink():
        fail("backend/app/services/.env is an ambiguous higher-priority dotenv source.")

    backend_env_candidates = (
        repo / "backend" / "app" / ".env",
        repo / "backend" / ".env",
        repo / ".env",
    )
    backend_env = next(
        (
            candidate
            for candidate in backend_env_candidates
            if candidate.exists() or candidate.is_symlink()
        ),
        None,
    )
    if backend_env is None:
        fail("Backend environment file is missing.")
    backend_values = read_env_values(
        backend_env,
        {"VITE_SUPABASE_URL", "SUPABASE_URL", "AI_QUOTA_ENV_FILE"},
        allow_empty=True,
    )
    if not any(
        key in backend_values for key in ("VITE_SUPABASE_URL", "SUPABASE_URL")
    ):
        fail("Backend environment must define VITE_SUPABASE_URL or SUPABASE_URL.")
    for key in ("VITE_SUPABASE_URL", "SUPABASE_URL"):
        if key not in backend_values:
            continue
        value = backend_values[key]
        if url_project_ref(value, key) != DEVELOPMENT_PROJECT_REF:
            fail(f"Backend {key} does not match the allowed development project ref.")

    if "AI_QUOTA_ENV_FILE" in os.environ:
        quota_override = os.environ["AI_QUOTA_ENV_FILE"]
    else:
        quota_override = backend_values.get("AI_QUOTA_ENV_FILE", "")
    quota_env_candidates = ([Path(quota_override)] if quota_override else []) + [
        Path("/app/.env.ai-quota"),
        Path(".env.ai-quota"),
    ]
    for quota_env in quota_env_candidates:
        if not quota_env.is_absolute():
            quota_env = repo / "backend" / quota_env
        if not quota_env.is_file():
            continue
        quota_values = read_env_values(quota_env, {"VITE_SUPABASE_URL", "SUPABASE_URL"})
        if quota_values:
            fail("AI quota dotenv must not define Supabase URL settings.")
        break
    return DEVELOPMENT_PROJECT_REF


def prepare(repo: Path, config: Path) -> None:
    shared_env = validate_shared_development_frontend_env(config)
    if url_project_ref(read_env_url(shared_env)) != DEVELOPMENT_PROJECT_REF:
        fail("Frontend Supabase URL does not match the allowed development project ref.")
    frontend_dir = repo / "frontend"
    if frontend_dir.is_symlink():
        fail("Worktree frontend directory must not be a symlink.")
    if not frontend_dir.is_dir():
        fail("Worktree frontend directory is missing.")
    worktree_env = repo / "frontend" / ".env"
    if worktree_env.is_symlink():
        if not worktree_env.exists():
            fail("Broken frontend/.env symlink; inspect it manually before running DB commands.")
        if worktree_env.resolve() != shared_env.resolve():
            fail(
                "frontend/.env must symlink to the shared development frontend/.env for this machine."
            )
        return
    if worktree_env.exists():
        fail(
            "frontend/.env must be a symlink to ~/.config/receipt-manager/development/frontend/.env."
        )
    worktree_env.parent.mkdir(parents=True, exist_ok=True)
    worktree_env.symlink_to(shared_env.resolve())


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
        elif command == "prepare" and len(argv) == 4:
            prepare(Path(argv[2]).resolve(), Path(argv[3]))
        elif command == "validate-dev" and len(argv) == 4:
            print(development_endpoint_ref(Path(argv[2]).resolve(), Path(argv[3])))
        else:
            fail("Invalid Supabase target helper invocation.")
    except (TargetError, OSError, UnicodeError) as exc:
        print(f"[supabase-target] {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
