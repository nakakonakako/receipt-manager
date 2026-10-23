#!/usr/bin/env python3
"""Regression tests for the worktree removal process guard."""

from __future__ import annotations

import importlib.util
import os
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "worktree_remove_inspect", ROOT / "scripts/worktree-remove-inspect.py"
)
assert SPEC and SPEC.loader
INSPECT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = INSPECT
SPEC.loader.exec_module(INSPECT)


class WorktreeRemoveGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="receipt-worktree-remove-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self._children: list[subprocess.Popen[bytes]] = []
        self.addCleanup(self._cleanup_children)
        self.home = self.base / "home"
        self.repo = self.base / "source" / "receipt-manager"
        (self.repo / "scripts").mkdir(parents=True)
        for name in ("worktree.sh", "worktree-remove-inspect.py"):
            source = ROOT / "scripts" / name
            target = self.repo / "scripts" / name
            target.write_bytes(source.read_bytes())
            target.chmod(0o755)
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(
            ["git", "init", "-b", "main", str(self.repo)],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.name", "Worktree Guard Test"],
            check=True,
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(self.repo),
                "config",
                "user.email",
                "guard@example.invalid",
            ],
            check=True,
        )
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "commit", "-qm", "fixture"], check=True
        )
        self.env = {**os.environ, "HOME": str(self.home)}

    @property
    def worktree_base(self) -> Path:
        return self.home / "worktrees" / "receipt-manager"

    def _create_worktree(self, task: str, branch: str) -> Path:
        subprocess.run(
            [
                str(self.repo / "scripts/worktree.sh"),
                "create",
                task,
                "--branch",
                branch,
                "--base",
                "main",
                "--no-setup",
            ],
            check=True,
            capture_output=True,
            text=True,
            env=self.env,
        )
        return self.worktree_base / task

    def _remove(self, path: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.repo / "scripts/worktree.sh"), "remove", str(path)],
            input="remove\n",
            capture_output=True,
            text=True,
            env=self.env,
            cwd=self.repo,
        )

    def _start_sleep(
        self, cwd: Path, *, subdir: str | None = None
    ) -> subprocess.Popen[bytes]:
        process_cwd = cwd / subdir if subdir else cwd
        process_cwd.mkdir(parents=True, exist_ok=True)
        child = subprocess.Popen(
            ["sleep", "300"], cwd=process_cwd, start_new_session=True
        )
        self._children.append(child)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if child.poll() is None:
                return child
            time.sleep(0.02)
        self.fail("test sleep process exited before inspection")

    def _stop_child(self, child: subprocess.Popen[bytes]) -> None:
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=3)
        self.assertIsNotNone(child.poll(), f"test process PID {child.pid} did not exit")
        self._children.remove(child)

    def _cleanup_children(self) -> None:
        failures: list[str] = []
        for child in list(self._children):
            if child.poll() is None:
                try:
                    child.send_signal(signal.SIGTERM)
                except ProcessLookupError:
                    pass
            try:
                child.communicate(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                try:
                    child.communicate(timeout=3)
                except subprocess.TimeoutExpired:
                    failures.append(f"PID {child.pid} did not exit after SIGKILL")
            if child.poll() is None:
                failures.append(f"PID {child.pid} is still running")
        self._children.clear()
        if failures:
            self.fail("Test process cleanup failed: " + "; ".join(failures))

    def test_clean_stopped_worktree_can_be_removed(self) -> None:
        path = self._create_worktree("clean", "feature/clean")
        result = self._remove(path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(path.exists())
        self.assertTrue((self.repo / ".git").exists())
        subprocess.run(
            [
                "git",
                "-C",
                str(self.repo),
                "show-ref",
                "--verify",
                "refs/heads/feature/clean",
            ],
            check=True,
            capture_output=True,
        )

    def test_dirty_worktree_is_refused(self) -> None:
        path = self._create_worktree("dirty", "feature/dirty")
        (path / "dirty.txt").write_text("dirty\n", encoding="utf-8")
        result = self._remove(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("staged, unstaged, or untracked", result.stderr)
        self.assertTrue(path.exists())

    def test_live_process_in_subdirectory_blocks_then_retry_succeeds(self) -> None:
        path = self._create_worktree("active", "feature/active")
        child = self._start_sleep(path, subdir="nested/task")
        result = self._remove(path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("active PID", result.stderr)
        self.assertIn(str(child.pid), result.stderr)
        self.assertTrue(path.exists())
        self.assertIsNone(child.poll(), "removal guard must not stop the process")
        self._stop_child(child)
        result = self._remove(path)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_other_worktree_process_is_not_affected(self) -> None:
        target = self._create_worktree("target", "feature/target")
        other = self._create_worktree("other", "feature/other")
        child = self._start_sleep(other)
        result = self._remove(target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(
            child.poll(), "guard must leave the other worktree process running"
        )

    def test_similar_path_prefix_is_not_matched(self) -> None:
        path = self._create_worktree("prefix", "feature/prefix")
        sibling = self.worktree_base / "prefix-similar"
        sibling.mkdir()
        child = self._start_sleep(sibling)
        result = self._remove(path)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIsNone(child.poll())

    def test_process_started_while_waiting_for_confirmation_blocks_second_scan(
        self,
    ) -> None:
        path = self._create_worktree("prompt-race", "feature/prompt-race")
        remover = subprocess.Popen(
            [str(self.repo / "scripts/worktree.sh"), "remove", str(path)],
            cwd=self.repo,
            env=self.env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._children.append(remover)
        assert remover.stdout is not None and remover.stdin is not None
        prompt = b""
        deadline = time.monotonic() + 10
        while b"Type remove to confirm" not in prompt and time.monotonic() < deadline:
            ready, _, _ = select.select([remover.stdout], [], [], 0.2)
            if ready:
                prompt += os.read(remover.stdout.fileno(), 4096)
        self.assertIn(b"Type remove to confirm", prompt)
        child = self._start_sleep(path)
        remover.stdin.write(b"remove\n")
        remover.stdin.flush()
        stdout, stderr = remover.communicate(timeout=10)
        self.assertNotEqual(remover.returncode, 0, stdout.decode() + stderr.decode())
        self.assertIn(b"active PID", stderr)
        self.assertTrue(path.exists())
        self.assertIsNone(child.poll())

    def test_proc_enumeration_failure_refuses(self) -> None:
        path = self._create_worktree("inspection-fail", "feature/inspection-fail")
        with patch.object(
            INSPECT, "_proc_pids", side_effect=INSPECT.InspectionError("denied")
        ):
            outcome = INSPECT.inspect_worktree(path)
        self.assertFalse(outcome.ok)
        self.assertTrue(
            any("process inspection failed" in error for error in outcome.errors)
        )
        self.assertTrue(path.exists())

    def test_inspector_failure_exit_refuses_removal(self) -> None:
        path = self._create_worktree("inspector-exit", "feature/inspector-exit")
        inspector = self.repo / "scripts/worktree-remove-inspect.py"
        original = inspector.read_bytes()
        try:
            inspector.write_text(
                "import sys\nprint('Process inspection failed; removal refused.', file=sys.stderr)\nsys.exit(2)\n",
                encoding="utf-8",
            )
            result = self._remove(path)
        finally:
            inspector.write_bytes(original)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Process inspection failed", result.stderr)
        self.assertIn("resolve inspection failure", result.stderr)
        self.assertTrue(path.exists())

    def test_zombie_is_not_reported_as_running(self) -> None:
        path = self._create_worktree("zombie", "feature/zombie")
        zombie = INSPECT.ProcStat(state="Z", starttime=10)
        with (
            patch.object(INSPECT, "_proc_pids", return_value=[987654]),
            patch.object(INSPECT, "_proc_stat", return_value=zombie),
            patch.object(INSPECT, "_proc_cwd") as cwd,
        ):
            outcome = INSPECT.inspect_worktree(path)
        self.assertTrue(outcome.ok, outcome.errors)
        cwd.assert_not_called()

    def test_pid_reuse_during_scan_is_ignored(self) -> None:
        path = self._create_worktree("pid-race", "feature/pid-race")
        with (
            patch.object(INSPECT, "_proc_pids", return_value=[987654]),
            patch.object(
                INSPECT,
                "_proc_stat",
                side_effect=[
                    INSPECT.ProcStat(state="S", starttime=10),
                    INSPECT.ProcStat(state="S", starttime=11),
                ],
            ),
            patch.object(INSPECT, "_proc_cwd", return_value=path),
        ):
            outcome = INSPECT.inspect_worktree(path)
        self.assertTrue(outcome.ok, outcome.errors)
        self.assertFalse(outcome.blocked_pids)

    def test_process_exit_during_scan_is_ignored(self) -> None:
        path = self._create_worktree("process-exit", "feature/process-exit")
        with (
            patch.object(INSPECT, "_proc_pids", return_value=[987654]),
            patch.object(
                INSPECT,
                "_proc_stat",
                side_effect=[INSPECT.ProcStat(state="S", starttime=10), None],
            ),
            patch.object(INSPECT, "_proc_cwd", return_value=path),
        ):
            outcome = INSPECT.inspect_worktree(path)
        self.assertTrue(outcome.ok, outcome.errors)
        self.assertFalse(outcome.blocked_pids)

    def test_created_process_is_reaped_when_test_body_raises(self) -> None:
        child = self._start_sleep(self.base)
        with self.assertRaisesRegex(RuntimeError, "simulated test failure"):
            try:
                raise RuntimeError("simulated test failure")
            finally:
                self._cleanup_children()
        self.assertIsNotNone(child.poll())

    def test_unreadable_cwd_is_skipped_after_identity_recheck(self) -> None:
        path = self._create_worktree("unknown-owner", "feature/unknown-owner")
        live = INSPECT.ProcStat(state="S", starttime=10)
        with (
            patch.object(INSPECT, "_proc_pids", return_value=[987654]),
            patch.object(INSPECT, "_proc_stat", return_value=live),
            patch.object(
                INSPECT, "_proc_cwd", side_effect=INSPECT.InspectionError("denied")
            ),
            patch.object(INSPECT, "_proc_uid", return_value=os.getuid()),
        ):
            outcome = INSPECT.inspect_worktree(path)
        self.assertTrue(outcome.ok, outcome.errors)
        self.assertFalse(outcome.blocked_pids)

    def test_unreadable_same_user_stat_fails_closed(self) -> None:
        path = self._create_worktree("unknown-stat", "feature/unknown-stat")
        with (
            patch.object(INSPECT, "_proc_pids", return_value=[987654]),
            patch.object(
                INSPECT, "_proc_stat", side_effect=INSPECT.InspectionError("denied")
            ),
            patch.object(INSPECT, "_proc_uid", return_value=os.getuid()),
        ):
            outcome = INSPECT.inspect_worktree(path)
        self.assertFalse(outcome.ok)
        self.assertTrue(outcome.errors)


if __name__ == "__main__":
    unittest.main()
