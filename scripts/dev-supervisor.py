#!/usr/bin/env python3
"""Run the fixed-port development servers as owned process groups."""

from __future__ import annotations

import argparse
import os
import re
import shlex
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


def read_process_identity(pid: int) -> tuple[int, int, int] | None:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
        tail = raw[raw.rfind(")") + 2 :].split()
        # Fields after comm begin at field 3: pgrp=5, session=6, starttime=22.
        return int(tail[2]), int(tail[3]), int(tail[19])
    except (OSError, ValueError, IndexError):
        return None


def proc_info(pid: int) -> tuple[int, int, int, str] | None:
    identity = read_process_identity(pid)
    if identity is None:
        return None
    pgid, sid, start = identity
    try:
        raw_args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        args: list[str] = []
        redact_next = False
        for raw_arg in raw_args:
            if not raw_arg:
                continue
            arg = raw_arg.decode(errors="replace")
            if redact_next:
                args.append("<redacted>")
                redact_next = False
            elif re.search(r"(password|passwd|token|secret|api[-_]?key)", arg, re.IGNORECASE):
                if "=" in arg:
                    args.append(f"{arg.split('=', 1)[0]}=<redacted>")
                else:
                    args.append(arg)
                    redact_next = True
            else:
                args.append(arg)
        cmd = " ".join(args)
        name = Path(f"/proc/{pid}/comm").read_text().strip()
        cwd = os.readlink(f"/proc/{pid}/cwd")
        return pgid, sid, start, f"name={name} command={cmd} cwd={cwd}"
    except (OSError, ValueError, IndexError):
        return None


def listener_details(port: int) -> list[str]:
    # Use `ss` for the socket inode and owner PID; never signal a PID from this lookup.
    try:
        result = subprocess.run(
            ["ss", "-H", "-ltnp", f"sport = :{port}"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    details: list[str] = []
    for line in result.stdout.splitlines():
        import re

        pids = sorted({int(value) for value in re.findall(r"pid=(\d+)", line)})
        for pid in pids:
            info = proc_info(pid)
            if info:
                details.append(f"PID {pid}: {info[3]}")
            else:
                details.append(f"PID {pid}: owner details unavailable")
    return details


def port_is_free(port: int) -> bool:
    for family, address in (
        (socket.AF_INET, ("127.0.0.1", port)),
        (socket.AF_INET6, ("::1", port, 0, 0)),
    ):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                if family == socket.AF_INET6:
                    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
                sock.bind(address)
        except OSError as exc:
            if family == socket.AF_INET6 and exc.errno == 97:  # IPv6 disabled on host.
                continue
            return False
    return True


def preflight(ports: list[tuple[str, int]]) -> bool:
    occupied = False
    for name, port in ports:
        if port_is_free(port):
            print(f"[dev] {name} port :{port} available")
            continue
        occupied = True
        print(f"[dev] ERROR: {name} port :{port} is already in use; fixed ports are not reassigned", file=sys.stderr)
        details = listener_details(port)
        for detail in details:
            print(f"[dev]   {detail}", file=sys.stderr)
        if not details:
            print("[dev]   listener owner unavailable (possibly another user or platform)", file=sys.stderr)
    return not occupied


@dataclass(frozen=True)
class GroupMembers:
    alive_pids: tuple[int, ...] = ()
    inspection_errors: tuple[str, ...] = ()

    @property
    def confirmed_stopped(self) -> bool:
        return not self.alive_pids and not self.inspection_errors

    def describe(self) -> str:
        details: list[str] = []
        if self.alive_pids:
            details.append(f"active member PIDs: {', '.join(map(str, self.alive_pids))}")
        if self.inspection_errors:
            shown = self.inspection_errors[:5]
            details.append(f"could not inspect: {'; '.join(shown)}")
            if len(self.inspection_errors) > len(shown):
                details.append(f"and {len(self.inspection_errors) - len(shown)} more inspection errors")
        return "; ".join(details) or "process group state was not confirmed"


@dataclass(frozen=True)
class CleanupResult:
    success: bool
    detail: str = ""


class OwnedGroup:
    TERM_TIMEOUT = 3.0
    KILL_VERIFY_TIMEOUT = 2.0
    POLL_INTERVAL = 0.05

    def __init__(self, name: str, command: list[str], cwd: Path):
        self.name = name
        self.process = subprocess.Popen(command, cwd=cwd, start_new_session=True)
        self.pid = self.process.pid
        # Keep the unreaped Popen child as the PID-reuse anchor until stop() completes.
        self.identity: tuple[int, int, int] | None = None
        self.starttime: int | None = None

    def verify_identity(self) -> None:
        identity = read_process_identity(self.pid)
        if identity is None or identity[0] != self.pid or identity[1] != self.pid:
            raise RuntimeError(f"Could not verify isolated process group for {self.name}")
        self.identity = identity
        self.starttime = identity[2]

    def still_owned(self) -> bool:
        current = read_process_identity(self.pid)
        if self.identity is not None:
            return bool(current and current == self.identity)
        # Verification may fail after Popen. Its unreaped child PID is reserved,
        # and start_new_session guarantees this PID's own group/session identity.
        return self.process.returncode is None and (current is None or (current[0] == self.pid and current[1] == self.pid))

    def members_status(self) -> GroupMembers:
        alive_pids: list[int] = []
        inspection_errors: list[str] = []
        try:
            with os.scandir("/proc") as entries:
                proc_entries = list(entries)
        except OSError as exc:
            reason = exc.strerror or type(exc).__name__
            return GroupMembers(inspection_errors=(f"/proc scan failed ({reason})",))

        found_supervisor = False
        for entry in proc_entries:
            if not entry.name.isdecimal():
                continue
            pid = int(entry.name)
            if pid == os.getpid():
                found_supervisor = True
            try:
                raw = Path(entry.path, "stat").read_text()
                tail = raw[raw.rfind(")") + 2 :].split()
                if int(tail[2]) == self.pid and int(tail[3]) == self.pid and tail[0] != "Z":
                    alive_pids.append(pid)
            except FileNotFoundError:
                # The process exited between /proc enumeration and stat access.
                continue
            except (OSError, ValueError, IndexError) as exc:
                reason = exc.strerror if isinstance(exc, OSError) else "invalid process stat"
                inspection_errors.append(f"PID {pid} stat unavailable ({reason or type(exc).__name__})")
        if not found_supervisor:
            inspection_errors.append("current supervisor process missing from /proc scan")
        return GroupMembers(tuple(alive_pids), tuple(inspection_errors))

    def wait_until_stopped(self, timeout: float) -> tuple[bool, GroupMembers]:
        deadline = time.monotonic() + timeout
        while True:
            status = self.members_status()
            if status.confirmed_stopped:
                return True, status
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False, status
            time.sleep(min(self.POLL_INTERVAL, remaining))

    def exit_info(self):
        # WNOWAIT preserves the group leader as a PID-reuse anchor until cleanup.
        return os.waitid(os.P_PID, self.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)

    def stop(self) -> CleanupResult:
        if not self.still_owned():
            return CleanupResult(False, "process identity changed; no signal was sent")

        signal_errors: list[str] = []
        try:
            os.killpg(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError as exc:
            signal_errors.append(f"SIGTERM failed ({exc.strerror or type(exc).__name__})")

        stopped, status = self.wait_until_stopped(self.TERM_TIMEOUT)
        if stopped:
            return CleanupResult(True)

        # The unreaped leader remains the PID-reuse anchor. Never escalate if
        # its PID/PGID/SID/start time can no longer prove this is our group.
        if not self.still_owned():
            detail = f"ownership changed before SIGKILL; {status.describe()}"
            return CleanupResult(False, "; ".join([*signal_errors, detail]))

        try:
            os.killpg(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError as exc:
            signal_errors.append(f"SIGKILL failed ({exc.strerror or type(exc).__name__})")

        stopped, status = self.wait_until_stopped(self.KILL_VERIFY_TIMEOUT)
        if stopped:
            return CleanupResult(True)

        detail = f"process group did not stop after SIGKILL verification: {status.describe()}"
        return CleanupResult(False, "; ".join([*signal_errors, detail]))


def cleanup_groups(groups: list[OwnedGroup]) -> bool:
    succeeded = True
    for group in reversed(groups):
        try:
            result = group.stop()
        except Exception as exc:  # noqa: BLE001 - continue cleanup of the other owned group
            result = CleanupResult(False, f"stop raised {type(exc).__name__}")
        if not result.success:
            succeeded = False
            detail = f": {result.detail}" if result.detail else ""
            print(f"[dev] ERROR: cleanup failed for {group.name}{detail}", file=sys.stderr)

    # Reap each direct child even when another group's stop failed.
    for group in groups:
        try:
            group.process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            succeeded = False
            print(f"[dev] ERROR: {group.name} leader did not exit after cleanup", file=sys.stderr)
        except OSError as exc:
            succeeded = False
            print(f"[dev] ERROR: could not confirm {group.name} leader exit ({exc.strerror or type(exc).__name__})", file=sys.stderr)
    return succeeded


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frontend-port", required=True, type=int)
    parser.add_argument("--backend-port", required=True, type=int)
    parser.add_argument("--frontend-command", required=True)
    parser.add_argument("--backend-command", required=True)
    parser.add_argument("--backend-cwd", required=True, type=Path)
    args = parser.parse_args()

    if not preflight([("frontend", args.frontend_port), ("backend", args.backend_port)]):
        return 1

    groups: list[OwnedGroup] = []
    interrupted = 0
    failure_status: int | None = None
    cleanup_succeeded = True

    def on_signal(signum: int, _frame: object) -> None:
        nonlocal interrupted
        interrupted = signum

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    try:
        print(f"[dev] Starting frontend on :{args.frontend_port} and backend on :{args.backend_port}")
        frontend = OwnedGroup("frontend", shlex.split(args.frontend_command), Path.cwd())
        groups.append(frontend)
        frontend.verify_identity()
        backend = OwnedGroup("backend", shlex.split(args.backend_command), args.backend_cwd)
        groups.append(backend)
        backend.verify_identity()
        while not interrupted:
            for group in groups:
                exit_info = group.exit_info()
                if exit_info:
                    exit_status = exit_info.si_status if exit_info.si_code == os.CLD_EXITED else 128 + exit_info.si_status
                    print(f"[dev] {group.name} exited unexpectedly with status {exit_status}; stopping owned servers", file=sys.stderr)
                    failure_status = exit_status or 1
                    break
            else:
                time.sleep(0.1)
                continue
            break
    except (OSError, RuntimeError) as exc:
        print(f"[dev] ERROR: failed to start development servers: {exc}", file=sys.stderr)
        failure_status = 1
    finally:
        cleanup_succeeded = cleanup_groups(groups)

    if not cleanup_succeeded:
        return 1
    if interrupted:
        return 128 + interrupted
    return failure_status or 1


if __name__ == "__main__":
    raise SystemExit(main())
