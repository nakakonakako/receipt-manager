#!/usr/bin/env python3
"""Isolated regression tests for the production migration gate."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / "scripts/check-production-db-state.py"
LATEST = ROOT / "scripts/assert-latest-main.py"
DB_URL_WRITER = ROOT / "scripts/write-supabase-db-url.py"
INTEGRITY_RUNNER = ROOT / "scripts/verify-production-db-integrity.py"


class ProductionGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="production-db-gate-test-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.migrations = self.repo / "supabase/migrations"
        self.migrations.mkdir(parents=True)
        self.git("init", "-q")
        self.git("config", "user.email", "gate-test@example.invalid")
        self.git("config", "user.name", "Gate Test")
        self.migration("20261001000000_initial.sql")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        self.base = self.git("rev-parse", "HEAD").stdout.strip()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.fake_psql = self.bin / "psql"
        self.fake_psql.write_text(
            "#!/usr/bin/env python3\n"
            "import os, sys\n"
            "if os.environ.get('FAKE_PSQL_FAIL') == '1': sys.exit(7)\n"
            "sys.stdout.write(os.environ.get('FAKE_PSQL_VERSIONS', ''))\n",
            encoding="utf-8",
        )
        self.fake_psql.chmod(0o700)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(self.repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    def migration(self, name: str) -> Path:
        path = self.migrations / name
        path.write_text("-- isolated test migration\n", encoding="utf-8")
        return path

    def run_checker(
        self,
        remote: str,
        *extra: str,
        fail: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PATH"] = f"{self.bin}{os.pathsep}{env['PATH']}"
        env["FAKE_PSQL_VERSIONS"] = remote
        env["FAKE_PSQL_FAIL"] = "1" if fail else "0"
        return subprocess.run(
            [
                sys.executable,
                str(CHECKER),
                "--repo",
                str(self.repo),
                "--migrations-dir",
                str(self.migrations),
                "--base-ref",
                self.base,
                *extra,
            ],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_in_sync_and_pending_states(self) -> None:
        synced = self.run_checker("20261001000000\n")
        self.assertEqual(synced.returncode, 0, synced.stderr)
        self.assertIn("IN_SYNC", synced.stdout)

        self.migration("20261002000000_second.sql")
        pending = self.run_checker("20261001000000\n")
        self.assertEqual(pending.returncode, 0, pending.stderr)
        self.assertIn("state=PENDING", pending.stdout)
        self.assertIn("pending_versions=20261002000000", pending.stdout)

    def test_postflight_requires_exact_in_sync_state(self) -> None:
        self.migration("20261002000000_second.sql")

        pending_output = self.root / "postflight-pending"
        pending = self.run_checker(
            "20261001000000\n", "--output", str(pending_output)
        )
        self.assertEqual(pending.returncode, 0, pending.stderr)
        self.assertIn("state=PENDING\n", pending_output.read_text(encoding="utf-8"))
        pending_gate = subprocess.run(
            ["grep", "-Fxq", "state=IN_SYNC", str(pending_output)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(pending_gate.returncode, 0)

        in_sync_output = self.root / "postflight-in-sync"
        in_sync = self.run_checker(
            "20261001000000\n20261002000000\n", "--output", str(in_sync_output)
        )
        self.assertEqual(in_sync.returncode, 0, in_sync.stderr)
        self.assertIn("state=IN_SYNC\n", in_sync_output.read_text(encoding="utf-8"))
        in_sync_gate = subprocess.run(
            ["grep", "-Fxq", "state=IN_SYNC", str(in_sync_output)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(in_sync_gate.returncode, 0)

        for history in (
            "20261001000000\n20261009000000\n",
            "malformed\n",
        ):
            with self.subTest(history=history):
                output = self.root / f"postflight-invalid-{len(history)}"
                invalid = self.run_checker(history, "--output", str(output))
                self.assertNotEqual(invalid.returncode, 0)

    def test_remote_only_malformed_and_duplicate_history_fail_closed(self) -> None:
        remote_only = self.run_checker("20261001000000\n20261002000000\n")
        self.assertNotEqual(remote_only.returncode, 0)
        self.assertIn("state=REMOTE_ONLY", remote_only.stdout)

        for history in ("not-a-version\n", "20261001000000\n20261001000000\n"):
            with self.subTest(history=history):
                result = self.run_checker(history)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("ERROR", result.stderr)

    def test_connection_failure_is_generic_and_fail_closed(self) -> None:
        result = self.run_checker("", fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("connection or migration-history query failed", result.stderr)
        self.assertNotIn("password", result.stderr.lower())

    def test_existing_migration_edit_and_delete_are_rejected(self) -> None:
        existing = self.migrations / "20261001000000_initial.sql"
        existing.write_text("-- changed\n", encoding="utf-8")
        edited = self.run_checker("20261001000000\n")
        self.assertNotEqual(edited.returncode, 0)
        self.assertIn("immutable", edited.stderr)

        self.git("checkout", "--", "supabase/migrations/20261001000000_initial.sql")
        existing.unlink()
        deleted = self.run_checker("20261001000000\n")
        self.assertNotEqual(deleted.returncode, 0)
        self.assertIn("immutable", deleted.stderr)

    def test_bootstrap_allows_only_exact_pending_target_or_already_applied(self) -> None:
        version = "20261002000000_reader.sql"
        self.migration(version)
        pending = self.run_checker(
            "20261001000000\n", "--bootstrap-version", "20261002000000"
        )
        self.assertEqual(pending.returncode, 0, pending.stderr)
        self.assertIn("bootstrap_action=apply", pending.stdout)

        other = self.migration("20261003000000_other.sql")
        wrong = self.run_checker(
            "20261001000000\n", "--bootstrap-version", "20261002000000"
        )
        self.assertNotEqual(wrong.returncode, 0)
        other.unlink()

        applied = self.run_checker(
            "20261001000000\n20261002000000\n",
            "--bootstrap-version",
            "20261002000000",
        )
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertIn("bootstrap_action=verify", applied.stdout)

    def test_workflows_fail_closed_and_share_a_non_cancelling_queue(self) -> None:
        deploy = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        bootstrap = (ROOT / ".github/workflows/bootstrap-production-db-reader.yml").read_text(
            encoding="utf-8"
        )
        verifier = (ROOT / ".github/workflows/verify-production-rpcs.yml").read_text(
            encoding="utf-8"
        )
        for workflow in (deploy, bootstrap):
            self.assertIn("group: receipt-manager-production-db", workflow)
            self.assertIn("cancel-in-progress: false", workflow)
            self.assertIn("queue: max", workflow)
        self.assertIn("name: production-db-check", deploy)
        self.assertIn("name: production-db-apply", deploy)
        self.assertIn("MIGRATION_READER_PASSWORD", deploy)
        self.assertIn("PROD_SUPABASE_PROJECT_REF", deploy)
        self.assertIn("MIGRATION_SUPABASE_DB_PASSWORD", deploy)
        self.assertIn("supabase db push --db-url", deploy)
        self.assertNotIn("MIGRATION_SUPABASE_ACCESS_TOKEN", deploy + bootstrap)
        self.assertIn("needs.apply.result == 'skipped' && needs.postflight.result == 'skipped'", deploy)
        self.assertIn("needs.preflight.result == 'success'", deploy)
        self.assertIn("needs.postflight.result == 'success'", deploy)
        self.assertIn("needs.preflight.outputs.state == 'PENDING' && needs.integrity.result == 'success'", deploy)
        self.assertIn("needs.integrity.outputs.result == 'MISMATCH'", deploy)
        self.assertIn("needs.integrity.outputs.result == 'PASS'", deploy)
        self.assertIn("needs.preflight.outputs.state == 'IN_SYNC'", deploy)
        self.assertIn("needs.apply.result == 'success' && needs.postflight.result == 'success'", deploy)
        self.assertIn("verify_migration_reader_bootstrap.sql", deploy)
        self.assertNotIn("verify_s1_08_rpc_integrity.sql", deploy.split("  integrity:", 1)[0])
        self.assertIn("verify-production-db-integrity.py", deploy)
        self.assertIn("grep -qx 'state=PENDING'", deploy)
        self.assertIn("--bootstrap-version 20261027150000", bootstrap)
        self.assertIn("name: production-db-apply", bootstrap)
        self.assertIn("Classify existing RPC and ACL integrity", bootstrap)
        self.assertIn("verify-production-db-integrity.py --output", bootstrap)
        self.assertIn("result=MISMATCH", bootstrap)
        self.assertIn("preflight_migration_reader_bootstrap.sql", bootstrap)
        self.assertNotIn("Restore the preflighted ADMIN-only executor membership", bootstrap)
        self.assertNotIn("GRANT ai_quota_owner TO postgres", bootstrap)
        self.assertIn("grep -qx 'state=BOOTSTRAP_APPLIED'", bootstrap)
        self.assertIn("grep -qx 'bootstrap_action=verify'", bootstrap)
        self.assertIn("verify_migration_reader_bootstrap.sql", bootstrap)
        self.assertIn("Record remaining RPC and ACL integrity", bootstrap)
        self.assertNotIn("build-and-push:", bootstrap)
        self.assertNotIn("deploy:", bootstrap)
        self.assertNotIn("workflow_dispatch", verifier)
        self.assertIn("MIGRATION_READER_PASSWORD", verifier)
        self.assertNotIn("PROD_SUPABASE_DB_PASSWORD", deploy + verifier)

    @staticmethod
    def workflow_step(workflow: str, name: str) -> str:
        steps = re.split(r"(?m)^      - name: ", workflow)[1:]
        return next((step for step in steps if step.startswith(name + "\n")), "")

    def test_workflows_export_db_url_for_the_following_apply_step(self) -> None:
        for workflow_path, prepare_name, apply_name in (
            (
                ROOT / ".github/workflows/deploy.yml",
                "Prepare pending migration database URL",
                "Apply pending main migrations",
            ),
            (
                ROOT / ".github/workflows/bootstrap-production-db-reader.yml",
                "Prepare bootstrap database URL",
                "Apply the reader bootstrap migration",
            ),
        ):
            with self.subTest(workflow=workflow_path.name):
                workflow = workflow_path.read_text(encoding="utf-8")
                prepare = self.workflow_step(workflow, prepare_name)
                apply = self.workflow_step(workflow, apply_name)
                self.assertTrue(prepare)
                self.assertTrue(apply)
                self.assertIn('write-supabase-db-url.py --output "$GITHUB_ENV"', prepare)
                self.assertNotIn("supabase db push", prepare)
                self.assertIn('test -n "$SUPABASE_DB_URL"', apply)
                self.assertIn('supabase db push --db-url "$SUPABASE_DB_URL" --yes', apply)
                self.assertNotIn("write-supabase-db-url.py", apply)
                self.assertLess(workflow.index(prepare_name), workflow.index(apply_name))
                if workflow_path.name == "bootstrap-production-db-reader.yml":
                    self.assertIn("steps.state.outputs.bootstrap_action == 'apply'", prepare)
                    self.assertIn("steps.state.outputs.bootstrap_action == 'apply'", apply)

    def test_database_url_crosses_step_boundary_without_printing_the_url(self) -> None:
        output = self.root / "github-env"
        fake_supabase = self.bin / "supabase"
        captured_args = self.root / "supabase-args"
        fake_supabase.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "open(os.environ['CAPTURE_ARGS'], 'w', encoding='utf-8').write(json.dumps(sys.argv[1:]))\n"
            "print('mock migration apply')\n",
            encoding="utf-8",
        )
        fake_supabase.chmod(0o700)

        first_step_env = os.environ.copy()
        first_step_env.update(
            {
                "GITHUB_ACTIONS": "true",
                "PGHOST": "aws-1-test.pooler.supabase.com",
                "PGPORT": "5432",
                "PGDATABASE": "postgres",
                "PGUSER": "postgres.testref",
                "PGPASSWORD": "dummy secret:/?#&",
                "PGSSLMODE": "require",
            }
        )
        prepared = subprocess.run(
            [sys.executable, str(DB_URL_WRITER), "--output", str(output)],
            env=first_step_env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(prepared.returncode, 0, prepared.stderr)
        self.assertNotIn("dummy secret:/?#&", prepared.stdout + prepared.stderr)
        self.assertNotIn("postgresql://", prepared.stdout + prepared.stderr)
        self.assertIn("::add-mask::", prepared.stdout)

        exported = output.read_text(encoding="utf-8").strip().split("=", 1)[1]
        next_step_env = os.environ.copy()
        next_step_env.update(
            {
                "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
                "SUPABASE_DB_URL": exported,
                "CAPTURE_ARGS": str(captured_args),
            }
        )
        applied = subprocess.run(
            ["supabase", "db", "push", "--db-url", next_step_env["SUPABASE_DB_URL"], "--yes"],
            env=next_step_env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertEqual(
            json.loads(captured_args.read_text(encoding="utf-8")),
            ["db", "push", "--db-url", exported, "--yes"],
        )
        self.assertNotIn(exported, applied.stdout + applied.stderr)
        self.assertNotIn("dummy secret:/?#&", applied.stdout + applied.stderr)

    def test_integrity_runner_separates_assertion_mismatch_from_execution_failure(self) -> None:
        fake = self.bin / "psql"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import os, sys\n"
            "state = os.environ.get('FAKE_SQLSTATE', '')\n"
            "if state:\n"
            " sys.stderr.write(f'ERROR:  {state}: diagnostic failed\\n')\n"
            " sys.exit(1)\n",
            encoding="utf-8",
        )
        fake.chmod(0o700)
        output = self.root / "integrity-output"
        env = os.environ.copy()
        env["PATH"] = f"{self.bin}{os.pathsep}{env['PATH']}"

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
                self.assertNotIn(state, failed.stderr)

        env.pop("FAKE_SQLSTATE")
        passed = subprocess.run(
            [sys.executable, str(INTEGRITY_RUNNER), "--output", str(output)],
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertEqual(output.read_text(encoding="utf-8"), "result=PASS\n")

    def test_gate_routes_require_approval_and_postflight_for_pending_repairs(self) -> None:
        deploy = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        apply_block = deploy.split("  apply:", 1)[1].split("  postflight:", 1)[0]
        postflight_block = deploy.split("  postflight:", 1)[1].split("  build-and-push:", 1)[0]
        build_block = deploy.split("  build-and-push:", 1)[1].split("  deploy:", 1)[0]
        postflight_workflow = (ROOT / ".github/workflows/verify-production-rpcs.yml").read_text(
            encoding="utf-8"
        )
        history_gate = postflight_workflow.split(
            "      - name: Require migration history in sync\n", 1
        )[1].split("      - name: Verify reader and database integrity\n", 1)[0]
        self.assertIn("environment:\n      name: production-db-apply", apply_block)
        self.assertIn("needs.preflight.outputs.state == 'PENDING'", apply_block)
        self.assertIn("needs.preflight.outputs.state == 'PENDING'", postflight_block)
        self.assertIn("needs.apply.result == 'success'", postflight_block)
        self.assertIn("needs.integrity.outputs.result == 'PASS'", build_block)
        self.assertIn("needs.integrity.outputs.result == 'MISMATCH'", build_block)
        self.assertIn("needs.postflight.result == 'success'", build_block)
        self.assertIn('--output "$GITHUB_OUTPUT"', history_gate)
        self.assertIn("grep -Fxq 'state=IN_SYNC' \"$GITHUB_OUTPUT\"", history_gate)
        self.assertIn("state=PENDING", deploy)

    def test_bootstrap_integrity_mismatch_is_recorded_but_execution_errors_stop(self) -> None:
        bootstrap = (ROOT / ".github/workflows/bootstrap-production-db-reader.yml").read_text(
            encoding="utf-8"
        )
        classification = bootstrap.split("      - name: Classify existing RPC and ACL integrity", 1)[1].split(
            "      - name: Apply the reader bootstrap migration", 1
        )[0]
        approval_apply = bootstrap.split("      - name: Apply the reader bootstrap migration", 1)[1].split(
            "      - name: Recheck exact bootstrap migration history", 1
        )[0]
        post_history = bootstrap.split("      - name: Recheck exact bootstrap migration history", 1)[1]
        self.assertIn("verify-production-db-integrity.py", classification)
        self.assertIn("grep -qx 'result=MISMATCH'", classification)
        self.assertIn("if: ${{ steps.state.outputs.bootstrap_action == 'apply' }}", approval_apply)
        self.assertIn("environment:\n      name: production-db-apply", bootstrap)
        self.assertIn("preflight_migration_reader_bootstrap.sql", bootstrap)
        self.assertIn("check-production-db-state.py --base-ref \"$GITHUB_SHA\" --bootstrap-version 20261027150000", post_history)
        self.assertIn("verify_migration_reader_bootstrap.sql", post_history)
        self.assertIn("verify-production-db-integrity.py", post_history)
        self.assertIn("MISMATCH", post_history)

    def test_database_url_builder_encodes_password_without_printing_it(self) -> None:
        output = self.root / "runner-env"
        env = os.environ.copy()
        env.update(
            {
                "PGHOST": "aws-1-test.pooler.supabase.com",
                "PGPORT": "5432",
                "PGDATABASE": "postgres",
                "PGUSER": "postgres.testref",
                "PGPASSWORD": "dummy secret:/?#&",
                "PGSSLMODE": "require",
            }
        )
        result = subprocess.run(
            [sys.executable, str(DB_URL_WRITER), "--output", str(output)],
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(env["PGPASSWORD"], result.stdout + result.stderr)
        self.assertIn("dummy%20secret%3A%2F%3F%23%26", output.read_text(encoding="utf-8"))

    def test_bootstrap_verification_preserves_admin_without_set_or_inherit(self) -> None:
        sql = (ROOT / "supabase/diagnostics/verify_migration_reader_bootstrap.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("v_admin IS DISTINCT FROM true", sql)
        self.assertIn("v_set IS DISTINCT FROM false OR v_inherit IS DISTINCT FROM false", sql)
        self.assertIn("WHERE rolname = 'postgres'", sql)
        self.assertIn("'migration_preflight_reader', 'supabase_migrations', 'USAGE'", sql)
        self.assertIn("'migration_preflight_reader', 'ai_quota', 'USAGE'", sql)
        self.assertIn("'migration_preflight_reader', pg_catalog.current_database(), 'CREATE'", sql)
        self.assertIn("m.member = v_executor", sql)
        reader_preflight = (ROOT / "supabase/diagnostics/preflight_migration_reader_bootstrap.sql").read_text(encoding="utf-8")
        self.assertIn("to_regclass('ai_quota.settings') IS NULL", reader_preflight)
        self.assertIn("v_admin IS DISTINCT FROM true", reader_preflight)
        self.assertIn("v_set IS DISTINCT FROM false OR v_inherit IS DISTINCT FROM false", reader_preflight)
        self.assertNotIn("WHERE id = 1", reader_preflight)
        reader = (ROOT / "supabase/diagnostics/verify_production_db_reader.sql").read_text(encoding="utf-8")
        self.assertIn("v_role IS DISTINCT FROM 'migration_preflight_login'", reader)
        self.assertIn("AND NOT m.set_option", reader)
        self.assertIn("AND NOT m.admin_option", reader)
        self.assertIn("BOOTSTRAP_CONFIRMATION: ${{ inputs.confirmation }}", (ROOT / ".github/workflows/bootstrap-production-db-reader.yml").read_text(encoding="utf-8"))

    def test_latest_main_check_accepts_only_advertised_remote_sha(self) -> None:
        fake_git = self.bin / "git"
        fake_git.write_text(
            "#!/usr/bin/env python3\n"
            "import os, sys\n"
            "if sys.argv[1:] != ['ls-remote', 'origin', 'refs/heads/main']: sys.exit(2)\n"
            "print(os.environ.get('FAKE_MAIN_SHA', '') + '\\trefs/heads/main')\n",
            encoding="utf-8",
        )
        fake_git.chmod(0o700)
        sha = "a" * 40
        env = os.environ.copy()
        env["PATH"] = f"{self.bin}{os.pathsep}{env['PATH']}"
        env["FAKE_MAIN_SHA"] = sha
        current = subprocess.run(
            [sys.executable, str(LATEST), sha], env=env, capture_output=True, text=True
        )
        stale = subprocess.run(
            [sys.executable, str(LATEST), "b" * 40], env=env, capture_output=True, text=True
        )
        self.assertEqual(current.returncode, 0, current.stderr)
        self.assertNotEqual(stale.returncode, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
