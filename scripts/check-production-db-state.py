#!/usr/bin/env python3
"""Compare main's migration versions with the connected database, fail closed."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

MIGRATION_NAME = re.compile(r"^(\d{14})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$")
VERSION = re.compile(r"^\d{14}$")
HISTORY_QUERY = (
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
)


class GateError(Exception):
    """Safe-to-print error with no database or credential details."""


def list_local_versions(migrations_dir: Path) -> set[str]:
    versions: set[str] = set()
    for path in sorted(migrations_dir.glob("*.sql")):
        match = MIGRATION_NAME.fullmatch(path.name)
        if match is None:
            raise GateError(f"invalid local migration filename: {path.name}")
        version = match.group(1)
        if version in versions:
            raise GateError(f"duplicate local migration version: {version}")
        versions.add(version)
    if not versions:
        raise GateError("no local SQL migrations found")
    return versions


def parse_remote_versions(output: str) -> set[str]:
    versions: set[str] = set()
    for line in output.splitlines():
        value = line.strip()
        if not VERSION.fullmatch(value):
            raise GateError("remote migration history contains a malformed version")
        if value in versions:
            raise GateError(f"remote migration history contains duplicate version: {value}")
        versions.add(value)
    return versions


def read_remote_versions() -> set[str]:
    try:
        result = subprocess.run(
            ["psql", "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", HISTORY_QUERY],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        raise GateError("database connection or migration-history query failed") from None
    return parse_remote_versions(result.stdout)


def ensure_migrations_immutable(repo: Path, base_ref: str) -> None:
    try:
        changed = subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "diff",
                "--name-status",
                "--no-renames",
                base_ref,
                "--",
                "supabase/migrations/",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        untracked = subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "ls-files",
                "--others",
                "--exclude-standard",
                "--",
                "supabase/migrations/",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        raise GateError("cannot compare migration files with the required base commit") from None

    if any(line and not line.startswith("A\t") for line in changed.stdout.splitlines()):
        raise GateError("existing migration files are immutable; only additions are allowed")
    for relative_path in untracked.stdout.splitlines():
        if not MIGRATION_NAME.fullmatch(Path(relative_path).name):
            raise GateError(f"invalid untracked migration filename: {Path(relative_path).name}")


def write_outputs(path: Path | None, values: dict[str, str]) -> None:
    if path is None:
        for key, value in values.items():
            print(f"{key}={value}")
        return
    with path.open("a", encoding="utf-8") as output:
        for key, value in values.items():
            if "\n" in value or "\r" in value:
                raise GateError("refusing to write multiline workflow output")
            output.write(f"{key}={value}\n")


def evaluate(
    local_versions: set[str], remote_versions: set[str], bootstrap_version: str | None
) -> dict[str, str]:
    local_only = sorted(local_versions - remote_versions)
    remote_only = sorted(remote_versions - local_versions)

    outputs = {
        "pending_versions": ",".join(local_only),
        "remote_only_versions": ",".join(remote_only),
        "migration_count": str(len(local_versions)),
        "bootstrap_action": "none",
    }
    if remote_only:
        outputs["state"] = "REMOTE_ONLY"
        return outputs

    if bootstrap_version is None:
        outputs["state"] = "PENDING" if local_only else "IN_SYNC"
        return outputs

    if not VERSION.fullmatch(bootstrap_version) or bootstrap_version not in local_versions:
        outputs["state"] = "ERROR"
        raise GateError("requested bootstrap migration is absent from local main")
    if local_only == [bootstrap_version]:
        outputs["state"] = "BOOTSTRAP_PENDING"
        outputs["bootstrap_action"] = "apply"
        return outputs
    if not local_only and bootstrap_version in remote_versions:
        outputs["state"] = "BOOTSTRAP_APPLIED"
        outputs["bootstrap_action"] = "verify"
        return outputs

    outputs["state"] = "ERROR"
    raise GateError("bootstrap requires the target version to be the only pending migration")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--migrations-dir", type=Path, default=Path("supabase/migrations"))
    parser.add_argument("--base-ref", required=True)
    parser.add_argument("--output", type=Path, help="GitHub Actions output file")
    parser.add_argument("--bootstrap-version")
    parser.add_argument("--remote-versions-file", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()

    try:
        ensure_migrations_immutable(args.repo.resolve(), args.base_ref)
        local = list_local_versions(args.migrations_dir)
        if args.remote_versions_file:
            remote = parse_remote_versions(
                args.remote_versions_file.read_text(encoding="utf-8")
            )
        else:
            remote = read_remote_versions()
        outputs = evaluate(local, remote, args.bootstrap_version)
        write_outputs(args.output, outputs)
    except (GateError, OSError) as error:
        message = str(error)
        print(f"production DB gate: ERROR: {message}", file=sys.stderr)
        if args.output:
            try:
                write_outputs(args.output, {"state": "ERROR", "bootstrap_action": "none"})
            except OSError:
                pass
        return 2

    state = outputs["state"]
    print(f"production DB gate: {state}")
    return 1 if state == "REMOTE_ONLY" else 0


if __name__ == "__main__":
    raise SystemExit(main())
