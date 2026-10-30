#!/usr/bin/env python3
"""Isolated regression tests for production DB deployment gates."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRITY_RUNNER = ROOT / "scripts/verify-production-db-integrity.py"
DEPLOY = ROOT / ".github/workflows/deploy.yml"
SHARED_ACTION_SHA = "c06454f78cc3db27964829fd0e357cbb0d3536f8"


class ProductionGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="production-db-gate-test-")
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_integrity_runner_requires_all_diagnostics_and_separates_failures(self) -> None:
        fake = self.bin / "psql"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import os\n"
            "state = os.environ.get('FAKE_SQLSTATE', '')\n"
            "if state: print(f'ERROR:  {state}: diagnostic failed', file=__import__('sys').stderr); raise SystemExit(1)\n",
            encoding="utf-8",
        )
        fake.chmod(0o700)
        output = self.root / "integrity-output"
        env = os.environ.copy()
        env["PATH"] = f"{self.bin}{os.pathsep}{env['PATH']}"

        passed = subprocess.run(
            [sys.executable, str(INTEGRITY_RUNNER), "--output", str(output)],
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertEqual(output.read_text(encoding="utf-8"), "result=PASS\n")

        env["FAKE_SQLSTATE"] = "P0001"
        mismatch = subprocess.run(
            [sys.executable, str(INTEGRITY_RUNNER), "--output", str(output)],
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(mismatch.returncode, 0, mismatch.stderr)
        self.assertEqual(output.read_text(encoding="utf-8"), "result=MISMATCH\n")

        for state in ("42501", "57014", "08006"):
            with self.subTest(state=state):
                env["FAKE_SQLSTATE"] = state
                failed = subprocess.run(
                    [sys.executable, str(INTEGRITY_RUNNER), "--output", str(output)],
                    env=env,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(failed.returncode, 2)
                self.assertIn("execution failed", failed.stderr)

        runner_source = INTEGRITY_RUNNER.read_text(encoding="utf-8")
        for diagnostic in (
            "verify_s1_08_rpc_integrity.sql",
            "verify_s1_06_ai_quota_integrity.sql",
            "verify_s1_f01_acl_integrity.sql",
        ):
            self.assertIn(diagnostic, runner_source)

    def test_deploy_uses_pinned_shared_reader_and_receipt_manager_contract(self) -> None:
        deploy = DEPLOY.read_text(encoding="utf-8")
        action = (
            "nakakonakako/shared-supabase-db/.github/actions/"
            f"consumer-production-db-check@{SHARED_ACTION_SHA}"
        )
        self.assertIn(action, deploy)
        self.assertIn("app-id: receipt-manager", deploy)
        self.assertIn("app-commit-sha: ${{ github.sha }}", deploy)
        self.assertIn("name: production-db-check", deploy)
        self.assertIn("reader-pooler-host: ${{ vars.PROD_SUPABASE_POOLER_HOST }}", deploy)
        self.assertIn("reader-project-ref: ${{ vars.PROD_SUPABASE_PROJECT_REF }}", deploy)
        self.assertIn(
            "reader-username: migration_preflight_login.${{ vars.PROD_SUPABASE_PROJECT_REF }}",
            deploy,
        )
        self.assertIn("reader-password: ${{ secrets.MIGRATION_READER_PASSWORD }}", deploy)
        self.assertEqual(len(SHARED_ACTION_SHA), 40)

    def test_reader_gate_and_integrity_are_required_before_build_and_deploy(self) -> None:
        deploy = DEPLOY.read_text(encoding="utf-8")
        quality = deploy.split("  quality:\n", 1)[1].split("  preflight:\n", 1)[0]
        preflight = deploy.split("  preflight:\n", 1)[1].split("  integrity:\n", 1)[0]
        integrity = deploy.split("  integrity:\n", 1)[1].split("  build-and-push:\n", 1)[0]
        build = deploy.split("  build-and-push:\n", 1)[1].split("  deploy:\n", 1)[0]
        delivery = deploy.split("  deploy:\n", 1)[1]

        self.assertIn("npm run check", quality)
        self.assertIn("needs: quality", preflight)
        self.assertIn("needs: [quality, preflight]", integrity)
        self.assertIn("result=PASS", integrity)
        self.assertIn("grep -Fxq 'result=PASS'", integrity)
        self.assertIn("needs: [quality, preflight, integrity]", build)
        self.assertIn("needs: [quality, preflight, integrity, build-and-push]", delivery)
        for job in (preflight, integrity, build, delivery):
            self.assertNotIn("\n    if:", job)
        self.assertNotIn("MISMATCH", build + delivery)
        self.assertNotIn("always()", build + delivery)

    def test_writer_execution_routes_are_removed_and_reader_only_for_db_jobs(self) -> None:
        deploy = DEPLOY.read_text(encoding="utf-8")
        workflows = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / ".github/workflows").glob("*.yml")
        )
        self.assertNotIn("  apply:\n", deploy)
        self.assertNotIn("  postflight:\n", deploy)
        self.assertNotIn("MIGRATION_SUPABASE_DB_PASSWORD", workflows)
        self.assertNotIn("supabase db push", workflows)
        self.assertNotIn("supabase/setup-cli", workflows)
        self.assertNotIn("PROD_SUPABASE_DB_PASSWORD", deploy)
        self.assertNotIn("check-production-db-state.py", deploy)
        self.assertFalse((ROOT / ".github/workflows/bootstrap-production-db-reader.yml").exists())
        self.assertFalse((ROOT / ".github/workflows/verify-production-rpcs.yml").exists())

        preflight = deploy.split("  preflight:\n", 1)[1].split("  integrity:\n", 1)[0]
        integrity = deploy.split("  integrity:\n", 1)[1].split("  build-and-push:\n", 1)[0]
        self.assertIn("secrets.MIGRATION_READER_PASSWORD", preflight)
        self.assertNotIn("secrets.", preflight.replace("secrets.MIGRATION_READER_PASSWORD", ""))
        self.assertIn("PGPASSWORD: ${{ secrets.MIGRATION_READER_PASSWORD }}", integrity)
        self.assertNotIn("production-db-apply", deploy)

    def test_dispatch_concurrency_and_delivery_steps_are_preserved(self) -> None:
        deploy = DEPLOY.read_text(encoding="utf-8")
        self.assertIn("branches: [main]", deploy)
        self.assertIn("workflow_dispatch:", deploy)
        self.assertIn("group: receipt-manager-production-db", deploy)
        self.assertIn("cancel-in-progress: false", deploy)
        self.assertIn("queue: max", deploy)
        self.assertIn('python3 scripts/assert-latest-main.py "$GITHUB_SHA"', deploy)
        self.assertIn("docker/build-push-action@v7", deploy)
        self.assertIn("appleboy/scp-action@v0.1.7", deploy)
        self.assertIn("appleboy/ssh-action@v1.0.3", deploy)
        self.assertIn("docker compose -f docker-compose.production.yml up -d", deploy)
        self.assertIn("umask 077", deploy)
        self.assertIn('stat -c \'%a\' -- .env', deploy)


if __name__ == "__main__":
    unittest.main(verbosity=2)
