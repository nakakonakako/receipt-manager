#!/usr/bin/env python3
"""State-directory and file-operation security fixtures for the Cursor monitor."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MONITOR_PATH = ROOT / "scripts/delegate-cursor-monitor.py"
SPEC = importlib.util.spec_from_file_location("delegate_cursor_monitor", MONITOR_PATH)
assert SPEC is not None and SPEC.loader is not None
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)


class MonitorStateDirectoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="receipt-cursor-state-")
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.state_root = self.home / ".local/state"
        self.state_dir = self.state_root / "receipt-manager/delegate-cursor"
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.worker = self.root / "mock-worker.py"
        self.worker.write_text(
            "import json, os, sys, time\n"
            "from pathlib import Path\n"
            "marker = os.environ.get('WORKER_STARTED')\n"
            "if marker: Path(marker).write_text('started', encoding='utf-8')\n"
            "mode = sys.argv[1] if len(sys.argv) > 1 else 'success'\n"
            "if mode == 'hold': time.sleep(float(sys.argv[2]))\n"
            "if mode == 'failure':\n"
            " print('network connection failed API_KEY=fixture-secret-value', file=sys.stderr, flush=True)\n"
            " print(json.dumps({'type':'result','subtype':'error','is_error':True}), flush=True)\n"
            " raise SystemExit(1)\n"
            "print(json.dumps({'type':'system','subtype':'init','session_id':'fixture-session'}), flush=True)\n"
            "print(json.dumps({'type':'result','subtype':'success','is_error':False}), flush=True)\n",
            encoding="utf-8",
        )
        self.environment = {
            **os.environ,
            "HOME": str(self.home),
            "XDG_STATE_HOME": str(self.state_root),
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def open_state(self, path: Path | None = None) -> int:
        return MONITOR._open_state_directory(path or self.state_dir)

    def close_state(self, descriptor: int) -> None:
        os.close(descriptor)

    def monitor_command(self, workspace: Path | None = None, mode: str = "success", *mode_args: str) -> list[str]:
        return [
            sys.executable,
            str(MONITOR_PATH),
            "--checkout",
            str(workspace or self.workspace),
            "--route",
            "cursor",
            "--tier",
            "light",
            "--model",
            "composer-2.5",
            "--heartbeat-seconds",
            "1",
            "--",
            sys.executable,
            str(self.worker),
            mode,
            *mode_args,
        ]

    def run_monitor(
        self,
        workspace: Path | None = None,
        mode: str = "success",
        *mode_args: str,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            self.monitor_command(workspace, mode, *mode_args),
            env=env or self.environment,
            capture_output=True,
            text=True,
            check=False,
            timeout=15,
        )

    def status_file(self, workspace: Path | None = None) -> Path:
        canonical = (workspace or self.workspace).resolve(strict=True)
        key = hashlib.sha256(os.fsencode(canonical)).hexdigest()
        return self.state_dir / f"{key}.json"

    def test_existing_and_missing_private_state_directories_are_reused(self) -> None:
        descriptor = self.open_state()
        try:
            info = os.fstat(descriptor)
            self.assertTrue(stat.S_ISDIR(info.st_mode))
            self.assertEqual(info.st_uid, os.getuid())
            self.assertEqual(stat.S_IMODE(info.st_mode), 0o700)
        finally:
            self.close_state(descriptor)
        descriptor = self.open_state()
        self.close_state(descriptor)
        self.assertEqual(stat.S_IMODE(self.state_dir.stat().st_mode), 0o700)

    def test_intermediate_and_final_directory_symlinks_fail_without_repair(self) -> None:
        self.state_root.parent.mkdir(parents=True)
        outside = self.root / "outside"
        outside.mkdir(mode=0o700)
        self.state_root.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            self.open_state()
        self.assertTrue(self.state_root.is_symlink())

        self.state_root.unlink()
        parent = self.state_root / "receipt-manager"
        parent.mkdir(parents=True, mode=0o700)
        destination = self.root / "outside-final"
        destination.mkdir(mode=0o700)
        (parent / "delegate-cursor").symlink_to(destination, target_is_directory=True)
        with self.assertRaises(OSError):
            self.open_state()
        self.assertTrue((parent / "delegate-cursor").is_symlink())

    def test_parent_traversal_is_rejected_before_normalization(self) -> None:
        linked_parent = self.root / "linked-parent"
        linked_parent.symlink_to(self.root / "home", target_is_directory=True)
        with self.assertRaises(OSError):
            self.open_state(linked_parent / ".." / "state" / "delegate-cursor")

    def test_unsafe_parent_or_final_directory_modes_are_rejected_without_chmod(self) -> None:
        self.state_root.mkdir(parents=True, mode=0o700)
        self.state_root.chmod(0o777)
        with self.assertRaises(OSError):
            self.open_state()
        self.assertEqual(stat.S_IMODE(self.state_root.stat().st_mode), 0o777)

        self.state_root.chmod(0o700)
        self.state_dir.mkdir(parents=True, mode=0o700)
        self.state_dir.chmod(0o755)
        with self.assertRaises(OSError):
            self.open_state()
        self.assertEqual(stat.S_IMODE(self.state_dir.stat().st_mode), 0o755)

    def test_foreign_directory_owner_is_rejected(self) -> None:
        fake_stat = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=os.getuid() + 1)
        with patch.object(MONITOR.os, "fstat", return_value=fake_stat):
            with self.assertRaises(OSError):
                self.open_state()

    def test_relative_xdg_state_home_stops_before_worker(self) -> None:
        marker = self.root / "worker-started"
        result = self.run_monitor(env={**self.environment, "XDG_STATE_HOME": "relative-state", "WORKER_STARTED": str(marker)})
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertFalse(marker.exists())

    def test_lock_file_requires_private_regular_single_link_file(self) -> None:
        descriptor = self.open_state()
        try:
            lock = MONITOR.acquire_file_lock(descriptor, "workspace.lock", nonblocking=True)
            self.assertEqual(stat.S_IMODE(os.fstat(lock).st_mode), 0o600)
            os.close(lock)

            (self.state_dir / "unsafe.lock").write_text("", encoding="utf-8")
            (self.state_dir / "unsafe.lock").chmod(0o644)
            with self.assertRaises(OSError):
                MONITOR.acquire_file_lock(descriptor, "unsafe.lock", nonblocking=True)
            self.assertEqual(stat.S_IMODE((self.state_dir / "unsafe.lock").stat().st_mode), 0o644)

            foreign_stat = SimpleNamespace(
                st_mode=stat.S_IFREG | 0o600, st_uid=os.getuid() + 1, st_nlink=1
            )
            with patch.object(MONITOR.os, "fstat", return_value=foreign_stat):
                with self.assertRaises(OSError):
                    MONITOR.acquire_file_lock(descriptor, "workspace.lock", nonblocking=True)

            outside = self.root / "outside-lock"
            outside.write_text("preserve", encoding="utf-8")
            (self.state_dir / "symlink.lock").symlink_to(outside)
            with self.assertRaises(OSError):
                MONITOR.acquire_file_lock(descriptor, "symlink.lock", nonblocking=True)
            self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")

            (self.state_dir / "directory.lock").mkdir()
            with self.assertRaises(OSError):
                MONITOR.acquire_file_lock(descriptor, "directory.lock", nonblocking=True)

            source = self.state_dir / "hardlink-source"
            source.write_text("", encoding="utf-8")
            source.chmod(0o600)
            os.link(source, self.state_dir / "hardlink.lock")
            with self.assertRaises(OSError):
                MONITOR.acquire_file_lock(descriptor, "hardlink.lock", nonblocking=True)
        finally:
            self.close_state(descriptor)

    def test_status_replace_refuses_destination_and_temporary_symlinks(self) -> None:
        descriptor = self.open_state()
        try:
            outside = self.root / "outside-status"
            outside.write_text("preserve", encoding="utf-8")
            (self.state_dir / "status.json").symlink_to(outside)
            with self.assertRaises(OSError):
                MONITOR.set_status(descriptor, "status.json", {"outcome": "running"})
            self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")
            (self.state_dir / "status.json").unlink()

            (self.state_dir / "status.json").write_text("{}", encoding="utf-8")
            (self.state_dir / "status.json").chmod(0o600)
            foreign_stat = SimpleNamespace(
                st_mode=stat.S_IFREG | 0o600, st_uid=os.getuid() + 1, st_nlink=1
            )
            with patch.object(MONITOR.os, "stat", return_value=foreign_stat):
                with self.assertRaises(OSError):
                    MONITOR.set_status(descriptor, "status.json", {"outcome": "running"})
            (self.state_dir / "status.json").unlink()

            temporary = self.state_dir / ".status.json.deadbeef.tmp"
            temporary.symlink_to(outside)
            with patch.object(MONITOR.uuid, "uuid4", return_value=SimpleNamespace(hex="deadbeef")):
                with self.assertRaises(FileExistsError):
                    MONITOR.set_status(descriptor, "status.json", {"outcome": "running"})
            self.assertFalse((self.state_dir / "status.json").exists())
            self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")
        finally:
            self.close_state(descriptor)

    def test_diagnostic_lock_and_log_symlinks_are_rejected_without_following(self) -> None:
        descriptor = self.open_state()
        try:
            outside = self.root / "outside-diagnostic"
            outside.write_text("preserve", encoding="utf-8")
            (self.state_dir / "diagnostics.lock").symlink_to(outside)
            with self.assertRaises(OSError):
                MONITOR.prune_diagnostics_safely(descriptor, required=True)
            (self.state_dir / "diagnostics.lock").unlink()
            (self.state_dir / "diagnostics.lock").touch(mode=0o600)

            log = self.state_dir / "cursor-stderr-20260101T000000Z-123.log"
            log.symlink_to(outside)
            with self.assertRaises(OSError):
                MONITOR.prune_diagnostics_safely(descriptor, required=True)
            self.assertTrue(log.is_symlink())
            self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")
        finally:
            self.close_state(descriptor)

    def test_diagnostic_retention_removes_only_owned_safe_logs(self) -> None:
        descriptor = self.open_state()
        try:
            lock = MONITOR.acquire_file_lock(descriptor, "diagnostics.lock", nonblocking=True)
            os.close(lock)
            for index in range(MONITOR.MAX_DIAGNOSTIC_FILES + 3):
                path = self.state_dir / f"cursor-stderr-20260101T0000{index:02d}Z-{index}.log"
                path.write_text("fixture diagnostic\n", encoding="utf-8")
                path.chmod(0o600)
                os.utime(path, (time.time() + index, time.time() + index))
            MONITOR.prune_diagnostic_logs(descriptor)
            remaining = list(self.state_dir.glob("cursor-stderr-*.log"))
            self.assertEqual(len(remaining), MONITOR.MAX_DIAGNOSTIC_FILES)
        finally:
            self.close_state(descriptor)

    def test_bad_state_paths_and_files_stop_before_worker_start(self) -> None:
        marker = self.root / "worker-started"
        outside = self.root / "outside"
        outside.mkdir(mode=0o700)
        linked_state = self.root / "state-link"
        linked_state.symlink_to(outside, target_is_directory=True)
        result = self.run_monitor(env={**self.environment, "XDG_STATE_HOME": str(linked_state), "WORKER_STARTED": str(marker)})
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertFalse(marker.exists())

        self.state_root.mkdir(parents=True, mode=0o700)
        (self.state_root / "receipt-manager").mkdir(mode=0o700)
        final = self.state_root / "receipt-manager/delegate-cursor"
        final.symlink_to(outside, target_is_directory=True)
        result = self.run_monitor(env={**self.environment, "WORKER_STARTED": str(marker)})
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertFalse(marker.exists())
        final.unlink()
        final.mkdir(mode=0o700)

        lock_key = hashlib.sha256(os.fsencode(self.workspace.resolve())).hexdigest()
        lock_outside = self.root / "outside-lock-target"
        lock_outside.write_text("preserve", encoding="utf-8")
        (final / f"{lock_key}.lock").symlink_to(lock_outside)
        result = self.run_monitor(env={**self.environment, "WORKER_STARTED": str(marker)})
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertFalse(marker.exists())
        self.assertEqual(lock_outside.read_text(encoding="utf-8"), "preserve")

    def test_status_and_diagnostic_log_anomalies_stop_before_worker(self) -> None:
        self.state_dir.mkdir(parents=True, mode=0o700)
        outside = self.root / "outside-file"
        outside.write_text("preserve", encoding="utf-8")
        status = self.status_file()
        status.symlink_to(outside)
        marker = self.root / "worker-started"
        result = self.run_monitor(env={**self.environment, "WORKER_STARTED": str(marker)})
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertFalse(marker.exists())
        self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")
        status.unlink()

        diagnostic = self.state_dir / "cursor-stderr-20260101T000000Z-123.log"
        diagnostic.symlink_to(outside)
        result = self.run_monitor(env={**self.environment, "WORKER_STARTED": str(marker)})
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertFalse(marker.exists())
        self.assertTrue(diagnostic.is_symlink())
        self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")

    def test_unexpected_diagnostic_filename_stops_before_worker(self) -> None:
        self.state_dir.mkdir(parents=True, mode=0o700)
        (self.state_dir / "cursor-stderr-unexpected.log").write_text(
            "fixture", encoding="utf-8"
        )
        (self.state_dir / "cursor-stderr-unexpected.log").chmod(0o600)
        marker = self.root / "worker-started"
        result = self.run_monitor(env={**self.environment, "WORKER_STARTED": str(marker)})
        self.assertEqual(result.returncode, 5, result.stdout + result.stderr)
        self.assertFalse(marker.exists())

    def test_status_heartbeat_and_sanitized_failure_diagnostics_are_preserved(self) -> None:
        result = self.run_monitor(self.workspace, "hold", "1.3")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("稼働中", result.stdout)
        status = json.loads(self.status_file().read_text(encoding="utf-8"))
        self.assertEqual((status["route"], status["tier"], status["model"]), ("cursor", "light", "composer-2.5"))
        self.assertEqual(status["outcome"], "succeeded")
        self.assertEqual(stat.S_IMODE(self.status_file().stat().st_mode), 0o600)

        failed = self.run_monitor(mode="failure")
        self.assertNotEqual(failed.returncode, 0)
        status = json.loads(self.status_file().read_text(encoding="utf-8"))
        diagnostic_path = Path(str(status["stderr_diagnostic_log"]))
        self.assertTrue(diagnostic_path.is_file())
        content = diagnostic_path.read_text(encoding="utf-8")
        self.assertNotIn("fixture-secret-value", content)
        self.assertIn("[REDACTED]", content)

    def test_status_write_failure_after_worker_start_does_not_orphan_worker(self) -> None:
        marker = self.root / "worker-started"
        running = subprocess.Popen(
            self.monitor_command(self.workspace, "hold", "1.4"),
            env={**self.environment, "WORKER_STARTED": str(marker)},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(marker.exists(), "mock worker did not start")
        outside = self.root / "outside-status"
        outside.write_text("preserve", encoding="utf-8")
        status = self.status_file()
        status.unlink()
        status.symlink_to(outside)
        stdout, stderr = running.communicate(timeout=10)
        self.assertEqual(running.returncode, 0, stdout + stderr)
        self.assertIn("status storage became unavailable", stdout)
        self.assertEqual(outside.read_text(encoding="utf-8"), "preserve")

    def test_same_workspace_is_exclusive_and_different_workspaces_run_in_parallel(self) -> None:
        marker_one = self.root / "worker-one"
        first = subprocess.Popen(
            self.monitor_command(self.workspace, "hold", "2"),
            env={**self.environment, "WORKER_STARTED": str(marker_one)},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.monotonic() + 5
        while not marker_one.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(marker_one.exists(), "first mock worker did not start")

        marker_duplicate = self.root / "worker-duplicate"
        duplicate = self.run_monitor(env={**self.environment, "WORKER_STARTED": str(marker_duplicate)})
        self.assertEqual(duplicate.returncode, 4, duplicate.stdout + duplicate.stderr)
        self.assertFalse(marker_duplicate.exists())

        other_workspace = self.root / "other-workspace"
        other_workspace.mkdir()
        marker_other = self.root / "worker-other"
        parallel = self.run_monitor(other_workspace, "hold", "0.2", env={**self.environment, "WORKER_STARTED": str(marker_other)})
        self.assertEqual(parallel.returncode, 0, parallel.stdout + parallel.stderr)
        self.assertTrue(marker_other.exists())
        stdout, stderr = first.communicate(timeout=10)
        self.assertEqual(first.returncode, 0, stdout + stderr)

    def test_interruption_and_worker_failure_release_lock_for_retry(self) -> None:
        marker = self.root / "worker-started"
        running = subprocess.Popen(
            self.monitor_command(self.workspace, "hold", "30"),
            env={**self.environment, "WORKER_STARTED": str(marker)},
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(marker.exists(), "mock worker did not start")
        running.send_signal(signal.SIGTERM)
        stdout, stderr = running.communicate(timeout=10)
        self.assertEqual(running.returncode, 128 + signal.SIGTERM, stdout + stderr)
        retried = self.run_monitor()
        self.assertEqual(retried.returncode, 0, retried.stdout + retried.stderr)

        failed = self.run_monitor(mode="failure")
        self.assertNotEqual(failed.returncode, 0)
        retried_after_failure = self.run_monitor()
        self.assertEqual(retried_after_failure.returncode, 0, retried_after_failure.stdout + retried_after_failure.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
