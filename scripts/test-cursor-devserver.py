#!/usr/bin/env python3
"""Integration tests for Cursor devserver ownership using disposable child servers."""

from __future__ import annotations

import errno
import importlib.util
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SAFE_FINGERPRINT = "a" * 64
SPEC = importlib.util.spec_from_file_location(
    "cursor_devserver", ROOT / "scripts/cursor-devserver.py"
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_port(port: int, expected: bool, timeout: float = 5) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.1)
            listening = sock.connect_ex(("127.0.0.1", port)) == 0
        if listening == expected:
            return True
        time.sleep(0.03)
    return False


SERVER = """import http.server, sys
port = int(sys.argv[1]); kind = sys.argv[2]
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if kind == 'backend': body = b'{\"message\":\"Receipt Manager API is running.\"}'
  else: body = '<html><head><title>frontend</title></head><body>/src/main.tsx</body></html>'.encode()
  self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
 def log_message(self, *_): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
"""


class CursorDevserverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="cursor-devserver-test-")
        self.base = Path(self.temp.name)
        self.root = self.base / "repo"
        (self.root / "backend").mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(
            ["git", "-C", str(self.root), "config", "user.name", "Test"], check=True
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(self.root),
                "config",
                "user.email",
                "test@example.invalid",
            ],
            check=True,
        )
        (self.root / "README").write_text("fixture\n")
        subprocess.run(["git", "-C", str(self.root), "add", "README"], check=True)
        subprocess.run(
            ["git", "-C", str(self.root), "commit", "-qm", "fixture"], check=True
        )
        self.state = self.base / "state"
        self.ports = {"backend": free_port(), "frontend": free_port()}
        while len(set(self.ports.values())) < 2:
            self.ports["frontend"] = free_port()
        self.server_script = self.base / "server.py"
        self.server_script.write_text(SERVER)
        self.commands = {
            name: [sys.executable, str(self.server_script), str(port), name]
            for name, port in self.ports.items()
        }
        self.guard = patch.object(
            MODULE, "validate_dev_target", return_value=SAFE_FINGERPRINT
        )
        self.guard.start()
        self.addCleanup(self.guard.stop)
        self.servers: list[MODULE.Devserver] = []

    def tearDown(self) -> None:
        try:
            for server in self.servers:
                session = server.load_session()
                if session:
                    server.stop_session(session)
            for server in self.servers:
                for child in server.children.values():
                    if child.poll() is None:
                        child.wait(timeout=3)
        finally:
            self.temp.cleanup()

    def server(
        self,
        root: Path | None = None,
        ports: dict[str, int] | None = None,
        commands=None,
    ):
        server = MODULE.Devserver(
            root or self.root,
            self.state,
            ports or self.ports,
            commands or self.commands,
        )
        self.servers.append(server)
        return server

    def test_same_worktree_session_is_reused_and_stop_owns_it(self) -> None:
        server = self.server()
        self.assertEqual(server.ensure(), 0)
        session = server.load_session()
        self.assertTrue(server.session_reusable(session, SAFE_FINGERPRINT))
        pids = {name: proc["pid"] for name, proc in session["processes"].items()}
        self.assertEqual(server.ensure(), 0)
        self.assertEqual(
            {
                name: proc["pid"]
                for name, proc in server.load_session()["processes"].items()
            },
            pids,
        )
        self.assertEqual(server.stop(), 0)
        self.assertTrue(wait_port(self.ports["backend"], False))
        self.assertTrue(wait_port(self.ports["frontend"], False))

    def test_other_worktree_occupant_is_never_reused_or_stopped(self) -> None:
        other = self.base / "other"
        other.mkdir()
        subprocess.run(["git", "init", "-q", str(other)], check=True)
        subprocess.run(
            ["git", "-C", str(other), "config", "user.name", "Test"], check=True
        )
        subprocess.run(
            ["git", "-C", str(other), "config", "user.email", "test@example.invalid"],
            check=True,
        )
        (other / "README").write_text("other\n")
        subprocess.run(["git", "-C", str(other), "add", "README"], check=True)
        subprocess.run(
            ["git", "-C", str(other), "commit", "-qm", "fixture"], check=True
        )
        blocker = subprocess.Popen(
            self.commands["backend"], cwd=other, start_new_session=True
        )
        try:
            self.assertTrue(wait_port(self.ports["backend"], True))
            with self.assertRaisesRegex(MODULE.DevserverError, "owner is not proven"):
                self.server().ensure()
            self.assertIsNone(blocker.poll())
            self.assertTrue(wait_port(self.ports["backend"], True))
        finally:
            blocker.terminate()
            blocker.wait(timeout=3)

    def test_unknown_server_with_matching_http_response_is_not_reused(self) -> None:
        blocker = subprocess.Popen(
            self.commands["backend"], cwd=self.root, start_new_session=True
        )
        try:
            self.assertTrue(wait_port(self.ports["backend"], True))
            with self.assertRaises(MODULE.DevserverError):
                self.server().ensure()
            self.assertIsNone(blocker.poll())
        finally:
            blocker.terminate()
            blocker.wait(timeout=3)

    def test_frontend_backend_from_different_owners_are_rejected(self) -> None:
        other = self.base / "other-worktree"
        other.mkdir()
        subprocess.run(["git", "init", "-q", str(other)], check=True)
        subprocess.run(
            ["git", "-C", str(other), "config", "user.name", "Test"], check=True
        )
        subprocess.run(
            ["git", "-C", str(other), "config", "user.email", "test@example.invalid"],
            check=True,
        )
        (other / "README").write_text("other\n")
        subprocess.run(["git", "-C", str(other), "add", "README"], check=True)
        subprocess.run(
            ["git", "-C", str(other), "commit", "-qm", "fixture"], check=True
        )
        frontend = subprocess.Popen(
            self.commands["frontend"], cwd=other, start_new_session=True
        )
        backend = subprocess.Popen(
            self.commands["backend"], cwd=self.root, start_new_session=True
        )
        try:
            self.assertTrue(wait_port(self.ports["frontend"], True))
            self.assertTrue(wait_port(self.ports["backend"], True))
            with self.assertRaises(MODULE.DevserverError):
                self.server().ensure()
            self.assertIsNone(frontend.poll())
            self.assertIsNone(backend.poll())
        finally:
            frontend.terminate()
            backend.terminate()
            frontend.wait(timeout=3)
            backend.wait(timeout=3)

    def test_process_identity_mismatch_blocks_reuse(self) -> None:
        server = self.server()
        server.ensure()
        original = json.loads(server.session_file.read_text())
        changed = json.loads(json.dumps(original))
        changed["processes"]["backend"]["starttime"] += 1
        changed["listeners"]["backend"][0]["starttime"] += 1
        server.save_session(changed)
        with self.assertRaisesRegex(MODULE.DevserverError, "cannot be proven"):
            server.ensure()
        self.assertTrue(wait_port(self.ports["backend"], True))
        server.save_session(original)

    def test_changed_current_dev_configuration_blocks_reuse(self) -> None:
        server = self.server()
        server.ensure()
        with (
            patch.object(MODULE, "validate_dev_target", return_value="b" * 64),
            self.assertRaisesRegex(MODULE.DevserverError, "cannot be proven"),
        ):
            server.ensure()
        self.assertTrue(wait_port(self.ports["backend"], True))

    def test_stop_with_mismatched_session_marker_leaves_processes_running(self) -> None:
        server = self.server()
        server.ensure()
        original = json.loads(server.session_file.read_text())
        changed = json.loads(json.dumps(original))
        changed["nonce"] = "00000000-0000-0000-0000-000000000000"
        server.save_session(changed)
        with self.assertRaisesRegex(MODULE.DevserverError, "could not be proven"):
            server.stop()
        self.assertTrue(wait_port(self.ports["backend"], True))
        self.assertTrue(wait_port(self.ports["frontend"], True))
        server.save_session(original)

    def test_stale_session_without_processes_is_replaced(self) -> None:
        server = self.server()
        stale = {
            "version": MODULE.VERSION,
            "nonce": "00000000-0000-0000-0000-000000000000",
            "worktree": server.identity,
            "verified_project_ref": MODULE.APPROVED_REF,
            "config_fingerprint": "old",
            "ports": self.ports,
            "processes": {
                "backend": {
                    "pid": 99999999,
                    "pgid": 99999999,
                    "sid": 99999999,
                    "starttime": 1,
                },
                "frontend": {
                    "pid": 99999998,
                    "pgid": 99999998,
                    "sid": 99999998,
                    "starttime": 1,
                },
            },
        }
        server.save_session(stale)
        self.assertEqual(server.ensure(), 0)
        self.assertTrue(
            server.session_reusable(server.load_session(), SAFE_FINGERPRINT)
        )

    def test_frontend_start_failure_cleans_owned_backend(self) -> None:
        commands = {
            **self.commands,
            "frontend": [sys.executable, "-c", "raise SystemExit(9)"],
        }
        server = self.server(commands=commands)
        with self.assertRaisesRegex(
            MODULE.DevserverError, "Frontend did not become ready"
        ):
            server.ensure()
        self.assertTrue(wait_port(self.ports["backend"], False))
        self.assertIsNone(server.load_session())

    def test_immediate_child_exit_after_popen_leaves_no_session(self) -> None:
        commands = {
            **self.commands,
            "backend": [sys.executable, "-c", "raise SystemExit(9)"],
        }
        server = self.server(commands=commands)
        with self.assertRaisesRegex(
            MODULE.DevserverError, "Backend did not become ready"
        ):
            server.ensure()
        session = server.load_session()
        self.assertIsNone(session)
        child = server.children["backend"]
        self.assertIsNotNone(child.poll())

    def test_identity_mismatch_after_popen_cleans_only_verified_child(self) -> None:
        server = self.server()
        original_identity = MODULE.process_identity
        first_pid = None
        first = True

        def mismatch_once(pid):
            nonlocal first, first_pid
            identity = original_identity(pid)
            if first and identity is not None:
                first = False
                first_pid = pid
                return {**identity, "pgid": identity["pgid"] + 1}
            return identity

        with patch.object(MODULE, "process_identity", side_effect=mismatch_once):
            with self.assertRaisesRegex(
                MODULE.DevserverError, "Could not verify the started backend"
            ):
                server.ensure()
        self.assertIsNotNone(first_pid)
        self.assertTrue(wait_port(self.ports["backend"], False))
        self.assertIsNone(server.load_session())
        self.assertIsNotNone(server.children["backend"].poll())

    def test_unverifiable_popen_child_is_left_running_and_recorded(self) -> None:
        server = self.server()
        original_identity = MODULE.process_identity
        child_pid = None

        def mismatched_identity(pid):
            nonlocal child_pid
            identity = original_identity(pid)
            if identity is not None and child_pid is None:
                child_pid = pid
            if pid == child_pid and identity is not None:
                return {**identity, "pgid": identity["pgid"] + 1}
            return identity

        with patch.object(MODULE, "process_identity", side_effect=mismatched_identity):
            with self.assertRaisesRegex(
                MODULE.DevserverError, "Could not verify the started backend"
            ):
                server.ensure()
        self.assertIsNotNone(child_pid)
        self.assertIsNone(server.children["backend"].poll())
        self.assertTrue(wait_port(self.ports["backend"], True))
        session = server.load_session()
        self.assertEqual(session["launches"]["backend"], {"pid": child_pid})
        self.assertNotIn("backend", session["processes"])

    def test_pidfd_open_failure_does_not_signal_or_remove_session(self) -> None:
        child_server_script = self.base / "server-with-child.py"
        child_server_script.write_text(
            SERVER.replace(
                "port = int(sys.argv[1]); kind = sys.argv[2]",
                "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
                "port = int(sys.argv[1]); kind = sys.argv[2]",
            ).replace("import http.server, sys", "import http.server, subprocess, sys")
        )
        commands = {
            **self.commands,
            "backend": [
                sys.executable,
                str(child_server_script),
                str(self.ports["backend"]),
                "backend",
            ],
        }
        server = self.server(commands=commands)
        server.ensure()
        session = server.load_session()
        self.assertTrue(wait_port(self.ports["backend"], True))
        backend_pgid = session["processes"]["backend"]["pgid"]
        members = MODULE.group_members(backend_pgid)
        self.assertGreaterEqual(len(members), 2)
        real_pidfd_open = MODULE.os.pidfd_open
        backend_opened: list[int] = []

        def fail_after_one(pid):
            if pid in members and backend_opened:
                raise OSError(errno.EMFILE, "fd limit")
            fd = real_pidfd_open(pid)
            if pid in members:
                backend_opened.append(pid)
            return fd

        with patch.object(MODULE.os, "pidfd_open", side_effect=fail_after_one):
            self.assertFalse(server.stop_session(session))
        self.assertTrue(server.session_file.exists())
        self.assertTrue(wait_port(self.ports["backend"], True))
        self.assertTrue(all(MODULE.process_identity(pid) for pid in members))

    def test_concurrent_ensure_launches_one_pair(self) -> None:
        servers = [self.server(), self.server()]
        results: list[int | Exception] = []

        def run(server):
            try:
                results.append(server.ensure())
            except MODULE.DevserverError as exc:  # returned to the main test thread
                results.append(exc)

        threads = [threading.Thread(target=run, args=(server,)) for server in servers]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=40)
        self.assertTrue(
            all(not thread.is_alive() for thread in threads), "ensure lock deadlocked"
        )
        self.assertEqual(results, [0, 0])
        session = servers[0].load_session()
        self.assertTrue(servers[0].session_reusable(session, SAFE_FINGERPRINT))

    def test_stop_without_session_leaves_external_listener_running(self) -> None:
        blocker = subprocess.Popen(
            self.commands["backend"], cwd=self.root, start_new_session=True
        )
        try:
            self.assertTrue(wait_port(self.ports["backend"], True))
            with self.assertRaisesRegex(MODULE.DevserverError, "No session record"):
                self.server().stop()
            self.assertIsNone(blocker.poll())
            self.assertTrue(wait_port(self.ports["backend"], True))
        finally:
            blocker.terminate()
            blocker.wait(timeout=3)

    def test_stop_retains_partial_session_when_unrecorded_port_is_occupied(
        self,
    ) -> None:
        server = self.server()
        session = {
            "version": MODULE.VERSION,
            "session_id": "partial-test",
            "nonce": "00000000-0000-0000-0000-000000000000",
            "worktree": server.identity,
            "verified_project_ref": MODULE.APPROVED_REF,
            "config_fingerprint": SAFE_FINGERPRINT,
            "ports": self.ports,
            "processes": {},
            "listeners": {},
        }
        server.save_session(session)
        blocker = subprocess.Popen(
            self.commands["backend"], cwd=self.root, start_new_session=True
        )
        try:
            self.assertTrue(wait_port(self.ports["backend"], True))
            with self.assertRaisesRegex(MODULE.DevserverError, "could not be proven"):
                server.stop()
            self.assertTrue(server.session_file.exists())
            self.assertIsNone(blocker.poll())
        finally:
            blocker.terminate()
            blocker.wait(timeout=3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
