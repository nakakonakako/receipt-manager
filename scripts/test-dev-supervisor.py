#!/usr/bin/env python3
"""Exercise dev-supervisor process ownership using isolated loopback ports."""

from __future__ import annotations

import os
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUPERVISOR = ROOT / "scripts/dev-supervisor.py"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_listening(port: int, expected: bool, timeout: float = 5) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.1)
            result = sock.connect_ex(("127.0.0.1", port)) == 0
        if result == expected:
            return True
        time.sleep(0.05)
    return False


def is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def wait_dead(pid: int, timeout: float = 5) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not is_alive(pid):
            return True
        time.sleep(0.05)
    return False


def make_fixture(path: Path) -> Path:
    fixture = path / "server.py"
    fixture.write_text(
        "import socket, subprocess, sys, time\n"
        "port = int(sys.argv[1])\n"
        "if len(sys.argv) > 2: open(sys.argv[2], 'w').write(str(subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']).pid))\n"
        "s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen()\n"
        "while True: time.sleep(1)\n"
    )
    return fixture


def command(front_port: int, back_port: int, fixture: Path, backend_cwd: Path, child_pid_file: Path | None = None) -> list[str]:
    base = [sys.executable, str(fixture)]
    front = [*base, str(front_port)]
    if child_pid_file:
        front.append(str(child_pid_file))
    back = [*base, str(back_port)]
    return [
        sys.executable,
        str(SUPERVISOR),
        "--frontend-port", str(front_port),
        "--backend-port", str(back_port),
        "--frontend-command", shlex.join(front),
        "--backend-command", shlex.join(back),
        "--backend-cwd", str(backend_cwd),
    ]


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-supervisor-test-") as temp:
        temp_path = Path(temp)
        fixture = make_fixture(temp_path)
        backend_cwd = temp_path / "backend"
        backend_cwd.mkdir()

        # Normal startup, Ctrl+C and SIGTERM both release own frontend/backend and reload-like descendants.
        for signum in (2, 15):
            front_port, back_port = free_port(), free_port()
            child_file = temp_path / f"child-{signum}.pid"
            runner = subprocess.Popen(command(front_port, back_port, fixture, backend_cwd, child_file), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert wait_listening(front_port, True) and wait_listening(back_port, True), "servers did not start"
            assert child_file.exists(), "descendant was not started"
            child_pid = int(child_file.read_text())
            runner.send_signal(signum)
            assert runner.wait(timeout=8) in (128 + signum, -signum)
            assert wait_listening(front_port, False) and wait_listening(back_port, False), "ports remain occupied after signal"
            assert wait_dead(child_pid), "child/reload-like process survived cleanup"

        # A port occupied by a different worktree is reported and left running.
        occupied_port, free = free_port(), free_port()
        blocker = subprocess.Popen([sys.executable, str(fixture), str(occupied_port)], cwd=temp_path)
        try:
            assert wait_listening(occupied_port, True), "unrelated worktree server did not start"
            result = subprocess.run(command(occupied_port, free, fixture, backend_cwd), capture_output=True, text=True, timeout=5)
            assert result.returncode != 0 and "already in use" in result.stderr
            assert "PID" in result.stderr and str(temp_path) in result.stderr, "listener owner/worktree was not shown"
            assert blocker.poll() is None and wait_listening(occupied_port, True), "unrelated worktree process was terminated"
        finally:
            blocker.terminate()
            blocker.wait(timeout=3)

        # Backend startup failure shuts down an already started frontend.
        front_port, back_port = free_port(), free_port()
        failing = command(front_port, back_port, fixture, backend_cwd)
        backend_option = failing.index("--backend-command")
        cwd_option = failing.index("--backend-cwd")
        failing[backend_option + 1 : cwd_option] = [shlex.join([sys.executable, "-c", "raise SystemExit(7)"])]
        result = subprocess.run(failing, capture_output=True, text=True, timeout=8)
        assert result.returncode == 7, f"backend failure was not reported: {result.stderr}"
        assert wait_listening(front_port, False), "frontend survived backend startup failure"

        # Ports can be started again after cleanup.
        front_port, back_port = free_port(), free_port()
        runner = subprocess.Popen(command(front_port, back_port, fixture, backend_cwd), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        assert wait_listening(front_port, True) and wait_listening(back_port, True), "restart failed"
        runner.terminate()
        runner.wait(timeout=8)
        assert wait_listening(front_port, False) and wait_listening(back_port, False), "restart cleanup failed"

    print("dev-supervisor lifecycle checks passed")


if __name__ == "__main__":
    main()
