#!/usr/bin/env python3
"""Fixture tests for managed worktree environment link validation."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "worktree-env-validate.py"
FIXTURE_SECRET = "WORKTREE_ENV_FIXTURE_SECRET_MUST_NOT_BE_PRINTED"


class WorktreeEnvironmentValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="receipt-worktree-env-")
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.workspace = self.root / "workspace"
        for directory in (
            "frontend",
            "backend/app/services",
            "scripts",
        ):
            (self.workspace / directory).mkdir(parents=True, exist_ok=True)
        self.environment = "development"
        self.repository = "receipt-manager"
        self.config = self.home / ".config" / self.repository / self.environment
        self.config.mkdir(parents=True)
        (self.config / "frontend").mkdir()
        (self.config / "backend").mkdir()
        self.source = self.config / "frontend" / ".env"
        self.source.write_text(f"FIXTURE_KEY={FIXTURE_SECRET}\n", encoding="utf-8")
        self.env = {
            **os.environ,
            "HOME": str(self.home),
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_validator(
        self,
        mode: str = "strict",
        *,
        environment: str | None = None,
        repository: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(VALIDATOR),
                mode,
                str(self.workspace),
                "--environment",
                environment or self.environment,
                "--repository",
                repository or self.repository,
            ],
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
            timeout=5,
        )

    def expect_rejected(self, mode: str = "pre", **kwargs: str) -> str:
        result = self.run_validator(mode, **kwargs)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertNotIn(FIXTURE_SECRET, result.stdout + result.stderr)
        return result.stderr

    def link_source(self) -> Path:
        target = self.workspace / "frontend" / ".env"
        target.symlink_to(self.source)
        return target

    def test_valid_development_link_is_accepted(self) -> None:
        self.link_source()
        result = self.run_validator("strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_new_worktree_allows_missing_link_only_in_pre_mode(self) -> None:
        self.assertEqual(self.run_validator("pre").returncode, 0)
        self.expect_rejected("strict")

    def test_missing_environment_settings_are_allowed_without_workspace_links(self) -> None:
        self.config.rename(self.root / "unconfigured-environment")
        result = self.run_validator("strict")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_manual_environment_selection_is_supported(self) -> None:
        self.source.unlink()
        staging = self.home / ".config" / self.repository / "staging" / "frontend" / ".env"
        staging.parent.mkdir(parents=True)
        staging.touch()
        target = self.workspace / "frontend" / ".env"
        target.symlink_to(staging)
        result = self.run_validator("strict", environment="staging")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_other_environment_symlink_is_rejected(self) -> None:
        other = self.home / ".config" / self.repository / "production" / "frontend" / ".env"
        other.parent.mkdir(parents=True)
        other.touch()
        (self.workspace / "frontend" / ".env").symlink_to(other)
        self.expect_rejected()

    def test_broken_symlink_is_rejected(self) -> None:
        (self.workspace / "frontend" / ".env").symlink_to(self.config / "missing.env")
        self.assertIn("Broken environment symlink", self.expect_rejected())

    def test_symlink_with_missing_source_is_rejected(self) -> None:
        self.link_source()
        self.source.unlink()
        self.assertIn("Broken environment symlink", self.expect_rejected())

    def test_regular_file_at_managed_path_is_rejected_without_modification(self) -> None:
        target = self.workspace / "frontend" / ".env"
        target.write_text(FIXTURE_SECRET, encoding="utf-8")
        self.expect_rejected()
        self.assertEqual(target.read_text(encoding="utf-8"), FIXTURE_SECRET)

    def test_environment_settings_directory_symlink_is_rejected(self) -> None:
        replacement = self.root / "settings"
        config_root = self.home / ".config" / self.repository
        config_root.rename(replacement)
        config_root.symlink_to(replacement, target_is_directory=True)
        self.assertIn("symlink", self.expect_rejected().lower())

    def test_selected_environment_directory_symlink_is_rejected(self) -> None:
        replacement = self.root / "development-settings"
        self.config.rename(replacement)
        self.config.symlink_to(replacement, target_is_directory=True)
        self.assertIn("symlink", self.expect_rejected().lower())

    def test_config_root_symlink_is_rejected(self) -> None:
        config_root = self.home / ".config"
        replacement = self.root / "config-root"
        config_root.rename(replacement)
        config_root.symlink_to(replacement, target_is_directory=True)
        self.assertIn("symlink", self.expect_rejected().lower())

    def test_environment_source_parent_symlink_is_rejected(self) -> None:
        real_parent = self.root / "real-frontend-settings"
        source_parent = self.config / "frontend"
        source_parent.rename(real_parent)
        source_parent.symlink_to(real_parent, target_is_directory=True)
        self.assertIn("symlink", self.expect_rejected().lower())

    def test_workspace_dotenv_lookup_parent_symlink_is_rejected(self) -> None:
        services = self.workspace / "backend" / "app" / "services"
        services.rmdir()
        outside = self.root / "outside-services"
        outside.mkdir()
        services.symlink_to(outside, target_is_directory=True)
        self.assertIn("symlink", self.expect_rejected().lower())

    def test_indirect_absolute_symlink_is_rejected_even_when_resolve_matches(self) -> None:
        alias = self.root / "environment-alias"
        alias.symlink_to(self.source)
        target = self.workspace / "frontend" / ".env"
        target.symlink_to(alias)
        self.assertEqual(target.resolve(), self.source.resolve())
        self.assertIn("directly target", self.expect_rejected())

    def test_relative_symlink_is_rejected(self) -> None:
        target = self.workspace / "frontend" / ".env"
        target.symlink_to(os.path.relpath(self.source, target.parent))
        self.assertIn("directly target", self.expect_rejected())

    def test_receipt_services_dotenv_lookup_scope_is_scanned(self) -> None:
        extra = self.workspace / "backend" / "app" / "services" / ".env.local"
        extra.write_text(FIXTURE_SECRET, encoding="utf-8")
        self.assertIn("backend/app/services/.env.local", self.expect_rejected())

    def test_repository_name_selects_its_own_settings_directory(self) -> None:
        self.source.unlink()
        other = self.home / ".config" / "other-repo" / self.environment
        other.mkdir(parents=True)
        (other / "frontend").mkdir()
        other_source = other / "frontend" / ".env"
        other_source.touch()
        (self.workspace / "frontend" / ".env").symlink_to(other_source)
        result = self.run_validator("strict", repository="other-repo")
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
