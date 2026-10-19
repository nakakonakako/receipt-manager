#!/usr/bin/env python3
"""Run the fixed-port development servers as owned process groups."""

from __future__ import annotations

import argparse
import glob
import os
import re
import shlex
import signal
import socket
import subprocess
import sys
import time
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
            elif re.search(r"(password|passwd|token|secret|api[-_]?key)", arg, re.I):
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


class OwnedGroup:
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

    def members_alive(self) -> bool:
        for stat_path in glob.glob("/proc/[0-9]*/stat"):
            try:
                raw = Path(stat_path).read_text()
                tail = raw[raw.rfind(")") + 2 :].split()
                if int(tail[2]) == self.pid and int(tail[3]) == self.pid and tail[0] != "Z":
                    return True
            except (OSError, ValueError, IndexError):
                continue
        return False

    def exit_info(self):
        # WNOWAIT preserves the group leader as a PID-reuse anchor until cleanup.
        return os.waitid(os.P_PID, self.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)

    def stop(self) -> None:
        if not self.still_owned():
            print(f"[dev] left {self.name} group alone: process identity changed", file=sys.stderr)
            return
        try:
            os.killpg(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if not self.members_alive():
                return
            time.sleep(0.05)
        if self.still_owned() and self.members_alive():
            try:
                os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


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
        for group in reversed(groups):
            group.stop()
        for group in groups:
            try:
                group.process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                print(f"[dev] {group.name} leader did not exit after cleanup", file=sys.stderr)

    if interrupted:
        return 128 + interrupted
    return failure_status or 1


if __name__ == "__main__":
    raise SystemExit(main())
