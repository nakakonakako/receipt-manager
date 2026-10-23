#!/usr/bin/env python3
"""Exercise dev-supervisor process ownership using isolated loopback ports."""

from __future__ import annotations

import atexit
import contextlib
import importlib.util
import io
import os
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SUPERVISOR = ROOT / "scripts/dev-supervisor.py"
ACTIVE_SUPERVISORS: list[subprocess.Popen[str]] = []
ACTIVE_OWNED_GROUPS: list[object] = []
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


def start_owned_group(module, name: str, command: list[str], cwd: Path):
    owned = module.OwnedGroup(name, command, cwd)
    ACTIVE_OWNED_GROUPS.append(owned)
    return owned


def finish_owned_group(owned) -> None:
    owned.stop()
    owned.process.wait(timeout=5)
    if owned in ACTIVE_OWNED_GROUPS:
        ACTIVE_OWNED_GROUPS.remove(owned)


def cleanup_test_processes() -> None:
    for runner in ACTIVE_SUPERVISORS:
        if runner.poll() is None:
            runner.send_signal(15)
            try:
                runner.wait(timeout=8)
            except subprocess.TimeoutExpired:
                runner.kill()
                runner.wait(timeout=3)
    for owned in ACTIVE_OWNED_GROUPS:
        try:
            owned.stop()
            owned.process.wait(timeout=5)
        except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
            print(f"test cleanup could not confirm an owned group exit ({type(exc).__name__})", file=sys.stderr)
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
        "import signal, socket, subprocess, sys, time\n"
        "port = int(sys.argv[1])\n"
        "if len(sys.argv) > 2 and sys.argv[2] == '--serve-ignore-term':\n"
        " signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
        " s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen()\n"
        " while True: time.sleep(1)\n"
        "if len(sys.argv) > 2 and sys.argv[2] == '--spawn-ignore-child':\n"
        " child = subprocess.Popen([sys.executable, __file__, str(port), '--serve-ignore-term'])\n"
        " open(sys.argv[3], 'w').write(str(child.pid))\n"
        " while True: time.sleep(1)\n"
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
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def exiting_leader_command(fixture: Path, port: int, pid_file: Path, status: int) -> list[str]:
    return [sys.executable, str(fixture), str(port), "--exit", str(pid_file), str(status)]


def test_cleanup_results(module, fixture: Path, backend_cwd: Path, temp_path: Path) -> None:
    # A TERM-ignoring descendant remains after its leader exits; SIGKILL must
    # be followed by an observed group scan before cleanup can succeed.
    port = free_port()
    child_file = temp_path / "term-ignored-child.pid"
    owned = start_owned_group(
        module,
        "term-ignored-child",
        [sys.executable, str(fixture), str(port), "--spawn-ignore-child", str(child_file)],
        backend_cwd,
    )
    owned.verify_identity()
    assert wait_listening(port, True) and child_file.exists(), "TERM-ignore fixture did not start"
    child_pid = read_child_pid(child_file)
    result = owned.stop()
    assert result.success, f"SIGKILL cleanup was not confirmed: {result.detail}"
    finish_owned_group(owned)
    assert wait_dead(child_pid), "SIGKILL did not stop the TERM-ignoring child"
    assert wait_listening(port, False), "SIGKILL cleanup left its listener active"

    # A still-present process after the KILL grace period is a cleanup failure.
    port = free_port()
    owned = start_owned_group(module, "kill-residual", [sys.executable, str(fixture), str(port)], backend_cwd)
    owned.verify_identity()
    assert wait_listening(port, True), "residual fixture did not start"
    alive = module.GroupMembers((owned.pid,), ())
    with patch.object(module.OwnedGroup, "TERM_TIMEOUT", 0), patch.object(
        module.OwnedGroup, "KILL_VERIFY_TIMEOUT", 0
    ), patch.object(owned, "members_status", side_effect=[alive, alive]), patch.object(
        module.os, "killpg", return_value=None
    ):
        result = owned.stop()
    assert not result.success and "SIGKILL verification" in result.detail, "residual process was reported as stopped"
    finish_owned_group(owned)

    # An unreadable /proc entry is not an empty group and must not be success.
    port = free_port()
    owned = start_owned_group(module, "unverified-members", [sys.executable, str(fixture), str(port)], backend_cwd)
    owned.verify_identity()
    assert wait_listening(port, True), "unverified fixture did not start"
    with patch.object(module.os, "scandir", side_effect=PermissionError(13, "Permission denied")):
        scan_failure = owned.members_status()
    assert not scan_failure.confirmed_stopped and "/proc scan failed" in scan_failure.describe(), "/proc scan failure was treated as empty"
    unknown = module.GroupMembers((), (f"PID {owned.pid} stat unavailable (permission denied)",))
    with patch.object(module.OwnedGroup, "TERM_TIMEOUT", 0), patch.object(
        module.OwnedGroup, "KILL_VERIFY_TIMEOUT", 0
    ), patch.object(owned, "members_status", side_effect=[unknown, unknown]), patch.object(
        module.os, "killpg", return_value=None
    ):
        result = owned.stop()
    assert not result.success and "could not inspect" in result.detail, "unreadable /proc was treated as stopped"
    finish_owned_group(owned)

    # Signal delivery errors are reported when the owned group remains alive.
    port = free_port()
    owned = start_owned_group(module, "signal-failure", [sys.executable, str(fixture), str(port)], backend_cwd)
    owned.verify_identity()
    assert wait_listening(port, True), "signal-failure fixture did not start"
    with patch.object(module.OwnedGroup, "TERM_TIMEOUT", 0), patch.object(
        module.OwnedGroup, "KILL_VERIFY_TIMEOUT", 0
    ), patch.object(
        module.os, "killpg", side_effect=PermissionError(1, "Operation not permitted")
    ) as send_signal:
        result = owned.stop()
    assert send_signal.call_count == 2, "cleanup did not attempt both TERM and KILL"
    assert not result.success and "SIGTERM failed" in result.detail and "SIGKILL failed" in result.detail
    finish_owned_group(owned)

    # A changed PID/PGID/SID/start-time identity must never be signalled.
    port = free_port()
    owned = start_owned_group(module, "changed-identity", [sys.executable, str(fixture), str(port)], backend_cwd)
    owned.verify_identity()
    assert wait_listening(port, True), "identity-change fixture did not start"
    with patch.object(module, "read_process_identity", return_value=(owned.pid + 1, owned.pid + 1, 1)), patch.object(
        module.os, "killpg"
    ) as send_signal:
        result = owned.stop()
    assert not result.success and "identity changed" in result.detail
    send_signal.assert_not_called()
    finish_owned_group(owned)

    # If the anchor changes after TERM, escalation must not send SIGKILL.
    port = free_port()
    owned = start_owned_group(
        module, "identity-changed-before-kill", [sys.executable, str(fixture), str(port)], backend_cwd
    )
    owned.verify_identity()
    assert wait_listening(port, True), "escalation identity fixture did not start"
    with patch.object(module.OwnedGroup, "TERM_TIMEOUT", 0), patch.object(
        owned, "members_status", return_value=module.GroupMembers((owned.pid,), ())
    ), patch.object(owned, "still_owned", side_effect=[True, False]), patch.object(
        module.os, "killpg"
    ) as send_signal:
        result = owned.stop()
    assert not result.success and "ownership changed before SIGKILL" in result.detail
    assert send_signal.call_count == 1 and send_signal.call_args.args[1] == module.signal.SIGTERM
    finish_owned_group(owned)

    # Cleanup tries the other group even when one stop fails; leader waits are bounded.
    events: list[str] = []

    class FakeProcess:
        def wait(self, timeout: float) -> None:
            events.append(f"wait:{timeout}")

    class FakeGroup:
        def __init__(self, name: str, result):
            self.name = name
            self.result = result
            self.process = FakeProcess()

        def stop(self):
            events.append(f"stop:{self.name}")
            return self.result

    groups = [
        FakeGroup("frontend", module.CleanupResult(False, "simulated cleanup failure")),
        FakeGroup("backend", module.CleanupResult(True)),
    ]
    stderr = io.StringIO()
    with contextlib.redirect_stderr(stderr):
        succeeded = module.cleanup_groups(groups)
    assert not succeeded, "one failed cleanup was not propagated"
    assert events[:2] == ["stop:backend", "stop:frontend"], "cleanup skipped one process group"
    assert events[2:] == ["wait:4", "wait:4"], "leaders were not waited with a bounded timeout"
    assert "cleanup failed for frontend" in stderr.getvalue(), "cleanup failure diagnostic was omitted"


def test_main_cleanup_failure_propagation(module, backend_cwd: Path) -> None:
    events: list[str] = []

    class FakeProcess:
        def wait(self, timeout: float) -> None:
            events.append(f"wait:{timeout}")

    class FakeGroup:
        def __init__(self, name: str, command: list[str], cwd: Path):
            self.name = name
            self.process = FakeProcess()

        def verify_identity(self) -> None:
            pass

        def exit_info(self):
            if self.name == "frontend":
                return SimpleNamespace(si_code=os.CLD_EXITED, si_status=7)
            return None

        def stop(self):
            events.append(f"stop:{self.name}")
            return module.CleanupResult(self.name != "frontend", "simulated cleanup failure")

    argv = [
        "dev-supervisor.py",
        "--frontend-port", "10001",
        "--backend-port", "10002",
        "--frontend-command", "fake-frontend",
        "--backend-command", "fake-backend",
        "--backend-cwd", str(backend_cwd),
    ]
    stderr = io.StringIO()
    with patch.object(module, "preflight", return_value=True), patch.object(
        module, "OwnedGroup", FakeGroup
    ), patch.object(module.sys, "argv", argv), patch.object(module.signal, "signal"), contextlib.redirect_stderr(stderr):
        status = module.main()
    assert status == 1, "main did not return failure for unsuccessful cleanup"
    assert events[:2] == ["stop:backend", "stop:frontend"], "main abandoned one group's cleanup"
    assert events[2:] == ["wait:4", "wait:4"], "main did not bound both leader waits"
    assert "cleanup failed for frontend" in stderr.getvalue(), "main omitted cleanup failure diagnostic"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="dev-supervisor-test-") as temp:
        temp_path = Path(temp)
        fixture = make_fixture(temp_path)
        backend_cwd = temp_path / "backend"
        backend_cwd.mkdir()
        module = import_supervisor()
        test_cleanup_results(module, fixture, backend_cwd, temp_path)
        test_main_cleanup_failure_propagation(module, backend_cwd)

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
            result = subprocess.run(command(occupied_port, free, fixture, backend_cwd), capture_output=True, text=True, timeout=5, check=False)
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
        owned = start_owned_group(
            module,
            "verification-failure",
            [sys.executable, str(fixture), str(front_port), str(child_file)],
            backend_cwd,
        )
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
            finish_owned_group(owned)
        assert wait_listening(front_port, False), "identity failure cleanup left the child listener alive"
        assert wait_dead(child_pid), "identity failure child server survived cleanup"

        # Backend startup failure shuts down an already started frontend.
        front_port, back_port = free_port(), free_port()
        failing = command(front_port, back_port, fixture, backend_cwd)
        backend_option = failing.index("--backend-command")
        cwd_option = failing.index("--backend-cwd")
        failing[backend_option + 1 : cwd_option] = [shlex.join([sys.executable, "-c", "raise SystemExit(7)"])]
        result = subprocess.run(failing, capture_output=True, text=True, timeout=8, check=False)
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
