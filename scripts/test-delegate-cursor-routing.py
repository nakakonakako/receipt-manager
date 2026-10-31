#!/usr/bin/env python3
"""Offline fixtures for explicit Cursor route selection and monitoring."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


class DelegateCursorRoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="receipt-model-routing-")
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.repo = self.root / "receipt-manager"
        scripts = self.repo / "scripts"
        scripts.mkdir(parents=True)
        for name in (
            "delegate-cursor.sh",
            "delegate-cursor-monitor.py",
            "worktree.sh",
            "worktree-env-validate.py",
        ):
            shutil.copy2(SCRIPTS / name, scripts / name)
        subprocess.run(["git", "init", "-q", "-b", "main", str(self.repo)], check=True)
        subprocess.run(["git", "-C", str(self.repo), "config", "user.name", "Fixture"], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.email", "fixture@example.invalid"],
            check=True,
        )
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-qm", "fixture"], check=True)

        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.calls = self.root / "agent-calls.jsonl"
        agent = self.bin / "agent"
        agent.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "with open(os.environ['ROUTING_CALLS'], 'a', encoding='utf-8') as out:\n"
            " out.write(json.dumps(sys.argv[1:]) + '\\n')\n"
            "if os.environ.get('ROUTING_FAIL'):\n"
            " print('network connection failed', file=sys.stderr, flush=True)\n"
            " raise SystemExit(1)\n"
            "print(json.dumps({'type':'result','subtype':'success','is_error':False}), flush=True)\n",
            encoding="utf-8",
        )
        agent.chmod(0o755)
        self.env = {
            **os.environ,
            "HOME": str(self.home),
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "ROUTING_CALLS": str(self.calls),
            "XDG_STATE_HOME": str(self.home / ".local/state"),
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_delegate(self, *options: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.repo / "scripts/delegate-cursor.sh"), *options, "--prompt", "fixture task"],
            cwd=self.repo,
            env=env or self.env,
            capture_output=True,
            text=True,
            check=False,
            timeout=15,
        )

    def calls_read(self) -> list[list[str]]:
        if not self.calls.exists():
            return []
        return [json.loads(line) for line in self.calls.read_text(encoding="utf-8").splitlines()]

    def test_every_supported_model_route_is_explicit_and_recorded(self) -> None:
        routes = (
            ((), "cursor", "light", "composer-2.5"),
            (("--tier", "normal"), "cursor", "normal", "grok-4.7-medium"),
            (("--tier", "hard"), "cursor", "hard", "grok-4.7-high"),
            (("--fallback-tier", "light"), "other-models", "fallback-light", "gemini-3.8-flash-low"),
            (("--fallback-tier", "normal"), "other-models", "fallback-normal", "claude-sonnet-5-5-medium"),
            (("--model-override", "gpt-5.6-luna-medium"), "other-models-reserve", "model-override", "gpt-5.6-luna-medium"),
        )
        for options, route, tier, model in routes:
            with self.subTest(route=route, tier=tier):
                result = self.run_delegate(*options)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(f"[delegate-cursor] route: {route}", result.stderr)
                self.assertIn(f"[delegate-cursor] route: {route}", result.stdout)
                self.assertIn(f"[delegate-cursor] tier/model: {tier}/{model}", result.stdout)
                args = self.calls_read()[-1]
                self.assertEqual(args[args.index("--model") + 1], model)
                self.assertNotIn("--approve-mcps", args)
                status_line = next(line for line in result.stdout.splitlines() if line.startswith("[delegate-cursor] status: "))
                status = json.loads(Path(status_line.split(": ", 1)[1]).read_text(encoding="utf-8"))
                self.assertEqual((status["route"], status["tier"], status["model"]), (route, tier, model))

    def test_invalid_combinations_fail_before_worker_start(self) -> None:
        invalid = (
            ("--fallback-tier", "unknown"),
            ("--model-override", "unlisted-model"),
            ("--fallback-tier", "light", "--tier", "normal"),
            ("--fallback-tier", "normal", "--model-override", "gpt-5.6-luna-medium"),
            ("--model-override", "gpt-5.6-luna-medium", "--tier", "hard"),
            ("--fallback-tier", "light", "--fallback-tier", "normal"),
            ("--model-override", "gpt-5.6-luna-medium", "--model-override", "gpt-5.6-luna-medium"),
        )
        for options in invalid:
            with self.subTest(options=options):
                result = self.run_delegate(*options)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls_read(), [])

    def test_model_side_failure_does_not_trigger_an_automatic_route_retry(self) -> None:
        result = self.run_delegate(
            "--tier", "normal", env={**self.env, "ROUTING_FAIL": "1"}
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.calls_read()), 1)
        self.assertEqual(self.calls_read()[0][self.calls_read()[0].index("--model") + 1], "grok-4.7-medium")
        self.assertIn("[delegate-cursor] route: cursor", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
