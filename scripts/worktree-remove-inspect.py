#!/usr/bin/env python3
"""Refuse worktree removal while a live process uses it as its cwd."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

PROC = Path("/proc")


class InspectionError(RuntimeError):
    """The process scan could not safely determine whether removal is clear."""


@dataclass(frozen=True)
class ProcStat:
    state: str
    starttime: int


@dataclass(frozen=True)
class InspectOutcome:
    blocked_pids: tuple[int, ...] = ()
    errors: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return not self.blocked_pids and not self.errors


def _proc_pids() -> list[int]:
    try:
        with os.scandir(PROC) as entries:
            return sorted(
                int(entry.name) for entry in entries if entry.name.isdecimal()
            )
    except OSError as exc:
        raise InspectionError("/proc could not be enumerated") from exc


def _proc_stat(pid: int) -> ProcStat | None:
    try:
        raw = (PROC / str(pid) / "stat").read_text(encoding="ascii")
    except (FileNotFoundError, ProcessLookupError):
        return None
    except OSError as exc:
        raise InspectionError(f"PID {pid} stat data could not be read") from exc
    try:
        fields = raw[raw.rfind(")") + 2 :].split()
        return ProcStat(state=fields[0], starttime=int(fields[19]))
    except (IndexError, ValueError) as exc:
        raise InspectionError(f"PID {pid} stat data is invalid") from exc


def _proc_uid(pid: int) -> int | None:
    try:
        for line in (
            (PROC / str(pid) / "status").read_text(encoding="ascii").splitlines()
        ):
            if line.startswith("Uid:"):
                return int(line.split()[1])
    except (FileNotFoundError, ProcessLookupError):
        return None
    except (OSError, ValueError, IndexError) as exc:
        raise InspectionError(f"PID {pid} ownership could not be determined") from exc
    raise InspectionError(f"PID {pid} ownership data is missing")


def _proc_cwd(pid: int) -> Path | None:
    try:
        raw = os.readlink(PROC / str(pid) / "cwd")
    except (FileNotFoundError, ProcessLookupError):
        return None
    except OSError as exc:
        raise InspectionError(f"PID {pid} working directory could not be read") from exc
    try:
        return Path(raw).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise InspectionError(
            f"PID {pid} working directory could not be resolved"
        ) from exc


def _same_process(first: ProcStat | None, second: ProcStat | None) -> bool:
    return (
        first is not None
        and second is not None
        and first.state != "Z"
        and second.state != "Z"
        and first.starttime == second.starttime
    )


def inspect_worktree(worktree_path: Path) -> InspectOutcome:
    try:
        root = worktree_path.resolve(strict=True)
        if not root.is_dir():
            raise InspectionError("worktree path is not a directory")
        pids = _proc_pids()
    except (OSError, InspectionError, RuntimeError) as exc:
        return InspectOutcome(errors=(f"process inspection failed: {exc}",))

    blocked: set[int] = set()
    errors: list[str] = []
    own_uid = os.getuid()
    own_pid = os.getpid()

    for pid in pids:
        if pid == own_pid:
            continue
        try:
            before = _proc_stat(pid)
        except InspectionError as exc:
            try:
                uid = _proc_uid(pid)
            except InspectionError as owner_exc:
                errors.append(str(owner_exc))
                continue
            if uid is None:
                continue
            try:
                after = _proc_stat(pid)
            except InspectionError as stat_exc:
                errors.append(str(stat_exc))
                continue
            if after is None or after.state == "Z":
                continue
            if uid == own_uid:
                errors.append(str(exc))
            continue
        if before is None or before.state == "Z":
            continue

        try:
            cwd = _proc_cwd(pid)
        except InspectionError:
            try:
                after = _proc_stat(pid)
            except InspectionError as stat_exc:
                errors.append(str(stat_exc))
                continue
            # An inaccessible cwd cannot be linked to this worktree. Skip it
            # as an explicit detection limit; never signal the PID. The stat
            # reread above ensures a failure to inspect the PID itself still
            # fails closed.
            continue

        try:
            after = _proc_stat(pid)
        except InspectionError as exc:
            errors.append(str(exc))
            continue
        if not _same_process(before, after):
            continue  # Process exited or PID was reused during the scan.
        if cwd is None:
            try:
                uid = _proc_uid(pid)
                after_cwd_missing = _proc_stat(pid)
            except InspectionError as exc:
                errors.append(str(exc))
                continue
            if not _same_process(before, after_cwd_missing):
                continue
            if uid == own_uid or uid is None:
                errors.append(f"PID {pid} working directory is unavailable")
            continue
        if cwd == root or cwd.is_relative_to(root):
            blocked.add(pid)

    return InspectOutcome(tuple(sorted(blocked)), tuple(errors))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("worktree", type=Path)
    args = parser.parse_args()
    outcome = inspect_worktree(args.worktree)
    if outcome.errors:
        print("Worktree process inspection failed; removal refused.", file=sys.stderr)
        for error in outcome.errors[:5]:
            print(f"  {error}", file=sys.stderr)
        print(
            "Check /proc access and retry after resolving the inspection failure.",
            file=sys.stderr,
        )
        return 2
    if outcome.blocked_pids:
        pids = ", ".join(str(pid) for pid in outcome.blocked_pids[:8])
        extra = len(outcome.blocked_pids) - 8
        suffix = f" (and {extra} more)" if extra > 0 else ""
        print(
            f"Worktree process inspection found active PID(s): {pids}{suffix}. "
            "Stop those processes and retry removal.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
