#!/usr/bin/env python3
"""Exercise dev-supervisor process ownership using isolated loopback ports."""

from __future__ import annotations

import atexit
import importlib.util
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
ACTIVE_SUPERVISORS: list[subprocess.Popen[str]] = []
TEST_CHILD_PIDS: set[int] = set()


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


def start_supervisor(args: list[str], **kwargs) -> subprocess.Popen[str]:
    runner = subprocess.Popen(args, **kwargs)
    ACTIVE_SUPERVISORS.append(runner)
    return runner


def read_child_pid(path: Path) -> int:
    pid = int(path.read_text())
    TEST_CHILD_PIDS.add(pid)
    return pid


def cleanup_test_processes() -> None:
    for runner in ACTIVE_SUPERVISORS:
        if runner.poll() is None:
            runner.send_signal(15)
            try:
                runner.wait(timeout=8)
            except subprocess.TimeoutExpired:
                runner.kill()
                runner.wait(timeout=3)
    for pid in TEST_CHILD_PIDS:
        if is_alive(pid):
            try:
                os.kill(pid, 15)
            except ProcessLookupError:
                pass


atexit.register(cleanup_test_processes)


def make_fixture(path: Path) -> Path:
    fixture = path / "server.py"
    fixture.write_text(
        "import socket, subprocess, sys, time\n"
        "port = int(sys.argv[1])\n"
        "if len(sys.argv) > 2 and sys.argv[2] == '--serve':\n"
        " s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen()\n"
        " while True: time.sleep(1)\n"
        "if len(sys.argv) > 2 and sys.argv[2] == '--exit':\n"
        " child = subprocess.Popen([sys.executable, __file__, str(port), '--serve'])\n"
        " open(sys.argv[3], 'w').write(str(child.pid))\n"
        " deadline = time.monotonic() + 5\n"
        " while time.monotonic() < deadline:\n"
        "  try: socket.create_connection(('127.0.0.1', port), timeout=.1).close(); break\n"
        "  except OSError: time.sleep(.02)\n"
        " sys.exit(int(sys.argv[4]))\n"
        "if len(sys.argv) > 2:\n"
        " child = subprocess.Popen([sys.executable, __file__, str(port), '--serve'])\n"
        " open(sys.argv[2], 'w').write(str(child.pid))\n"
        " while True: time.sleep(1)\n"
        "s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen()\n"
        "while True: time.sleep(1)\n"
    )
    return fixture


def command(front_port: int, back_port: int, fixture: Path, backend_cwd: Path, child_pid_file: Path | None = None, front_command: list[str] | None = None, back_command: list[str] | None = None) -> list[str]:
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
        "--frontend-command", shlex.join(front_command or front),
        "--backend-command", shlex.join(back_command or back),
        "--backend-cwd", str(backend_cwd),
    ]


def import_supervisor():
    spec = importlib.util.spec_from_file_location("dev_supervisor", SUPERVISOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def exiting_leader_command(fixture: Path, port: int, pid_file: Path, status: int) -> list[str]:
    return [sys.executable, str(fixture), str(port), "--exit", str(pid_file), str(status)]


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
            runner = start_supervisor(command(front_port, back_port, fixture, backend_cwd, child_file), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert wait_listening(front_port, True) and wait_listening(back_port, True), "servers did not start"
            assert child_file.exists(), "descendant was not started"
            child_pid = read_child_pid(child_file)
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

        # A normally exiting frontend leader leaves its child server holding the port.
        front_port, back_port = free_port(), free_port()
        child_file = temp_path / "frontend-normal-child.pid"
        front_leader = exiting_leader_command(fixture, front_port, child_file, 0)
        runner = start_supervisor(command(front_port, back_port, fixture, backend_cwd, front_command=front_leader), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert wait_listening(front_port, True) and wait_listening(back_port, True), "normal-exit fixture did not start"
        child_pid = read_child_pid(child_file)
        assert runner.wait(timeout=8) == 1, "unexpected normal leader exit should stop supervisor"
        assert wait_listening(front_port, False) and wait_listening(back_port, False), "normal-exit cleanup left a server port occupied"
        assert wait_dead(child_pid), "normal-exit child server survived cleanup"

        # An abnormally exiting frontend leader also leaves a child-only group.
        front_port, back_port = free_port(), free_port()
        child_file = temp_path / "frontend-failed-child.pid"
        front_leader = exiting_leader_command(fixture, front_port, child_file, 7)
        runner = start_supervisor(command(front_port, back_port, fixture, backend_cwd, front_command=front_leader), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert wait_listening(front_port, True) and wait_listening(back_port, True), "frontend failure fixture did not start"
        child_pid = read_child_pid(child_file)
        assert runner.wait(timeout=8) == 7, "frontend failure status changed"
        assert wait_listening(front_port, False) and wait_listening(back_port, False), "frontend failure cleanup left a port occupied"
        assert wait_dead(child_pid), "frontend failure child server survived cleanup"

        # An abnormally exiting backend leader stops the frontend and its own child.
        front_port, back_port = free_port(), free_port()
        child_file = temp_path / "backend-failed-child.pid"
        back_leader = exiting_leader_command(fixture, back_port, child_file, 7)
        runner = start_supervisor(command(front_port, back_port, fixture, backend_cwd, back_command=back_leader), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert wait_listening(front_port, True) and wait_listening(back_port, True), "backend failure fixture did not start"
        child_pid = read_child_pid(child_file)
        assert runner.wait(timeout=8) == 7, "backend failure status changed"
        assert wait_listening(front_port, False) and wait_listening(back_port, False), "backend failure cleanup left a port occupied"
        assert wait_dead(child_pid), "backend failure child server survived cleanup"

        # If ownership verification fails after Popen, its child listener is still cleaned safely.
        front_port = free_port()
        child_file = temp_path / "verification-failed-child.pid"
        module = import_supervisor()
        owned = module.OwnedGroup("verification-failure", [sys.executable, str(fixture), str(front_port), str(child_file)], backend_cwd)
        assert wait_listening(front_port, True) and child_file.exists(), "verification fixture did not start"
        child_pid = read_child_pid(child_file)
        read_identity = module.read_process_identity
        module.read_process_identity = lambda pid: (pid + 1, pid + 1, 0)
        try:
            try:
                owned.verify_identity()
                raise AssertionError("ownership verification unexpectedly succeeded")
            except RuntimeError:
                pass
        finally:
            module.read_process_identity = read_identity
            owned.stop()
            owned.process.wait(timeout=5)
        assert wait_listening(front_port, False), "identity failure cleanup left the child listener alive"
        assert wait_dead(child_pid), "identity failure child server survived cleanup"

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
        runner = start_supervisor(command(front_port, back_port, fixture, backend_cwd), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        assert wait_listening(front_port, True) and wait_listening(back_port, True), "restart failed"
        runner.terminate()
        runner.wait(timeout=8)
        assert wait_listening(front_port, False) and wait_listening(back_port, False), "restart cleanup failed"

    print("dev-supervisor lifecycle checks passed")


if __name__ == "__main__":
    main()
