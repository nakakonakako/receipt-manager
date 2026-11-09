#!/usr/bin/env python3
"""Exercise receipt-manager-codex against disposable local Git remotes."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "scripts" / "receipt-manager-codex"


def run(args: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None,
        check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True)
    if check and result.returncode:
        raise AssertionError(f"Command failed: {args}\n{result.stdout}\n{result.stderr}")
    return result


def git(path: Path, *args: str) -> str:
    return run(["git", "-C", str(path), *args]).stdout.strip()


def commit(path: Path, name: str) -> str:
    (path / "tracked.txt").write_text(name + "\n", encoding="utf-8")
    run(["git", "-C", str(path), "add", "-A"])
    run(["git", "-C", str(path), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
         "commit", "-m", name])
    return git(path, "rev-parse", "HEAD")


def fixture(base: Path, label: str) -> tuple[Path, Path, Path]:
    bare = base / f"{label}.git"
    source = base / f"{label}-source"
    checkout = base / f"{label}-checkout"
    run(["git", "init", "--bare", "--initial-branch=main", str(bare)])
    run(["git", "init", "--initial-branch=main", str(source)])
    setup_script = source / "scripts" / "worktree.sh"
    setup_script.parent.mkdir()
    setup_script.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$@\" > \"$SETUP_MARKER\"\n"
        "[[ \"${SETUP_SHOULD_FAIL:-0}\" != 1 ]]\n",
        encoding="utf-8",
    )
    setup_script.chmod(0o755)
    commit(source, "initial")
    run(["git", "-C", str(source), "remote", "add", "origin", str(bare)])
    run(["git", "-C", str(source), "push", "-u", "origin", "main"])
    run(["git", "clone", str(bare), str(checkout)])
    return bare, source, checkout


def execute_case(base: Path, label: str, state: str) -> None:
    _, source, checkout = fixture(base, label)
    if state == "behind":
        remote_head = commit(source, "remote update")
        run(["git", "-C", str(source), "push", "origin", "main"])
    elif state == "dirty":
        remote_head = git(source, "rev-parse", "HEAD")
        (checkout / "uncommitted.txt").write_text("keep\n", encoding="utf-8")
    elif state == "diverged":
        remote_head = commit(source, "remote update")
        run(["git", "-C", str(source), "push", "origin", "main"])
        (checkout / "tracked.txt").write_text("local change\n", encoding="utf-8")
        run(["git", "-C", str(checkout), "add", "tracked.txt"])
        run(["git", "-C", str(checkout), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
             "commit", "-m", "local divergence"])
    elif state == "feature":
        remote_head = git(source, "rev-parse", "HEAD")
        run(["git", "-C", str(checkout), "switch", "-c", "feature/test"])
    else:
        remote_head = git(source, "rev-parse", "HEAD")

    original_head = git(checkout, "rev-parse", "HEAD")
    original_branch = git(checkout, "branch", "--show-current")
    home = base / f"home-{label}"
    fake_bin = base / f"bin-{label}"
    home.mkdir()
    fake_bin.mkdir()
    marker = base / f"called-{label}"
    stub = fake_bin / "codex"
    stub.write_text("#!/usr/bin/env bash\nprintf '%s\\n' \"$@\" > \"$CODEX_MARKER\"\n", encoding="utf-8")
    stub.chmod(0o755)
    env = os.environ | {
        "HOME": str(home), "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "RECEIPT_MANAGER_CHECKOUT": str(checkout), "RECEIPT_MANAGER_SESSION_ID": label,
        "CODEX_MARKER": str(marker),
        "SETUP_MARKER": str(base / f"setup-{label}"),
    }
    result = run([str(LAUNCHER), "--version"], env=env)
    lines = marker.read_text(encoding="utf-8").splitlines()
    workspace = Path(lines[1])
    assert lines[0] == "-C", lines
    assert git(workspace, "rev-parse", "HEAD") == remote_head
    assert git(workspace, "status", "--porcelain=v1") == ""
    setup_args = Path(env["SETUP_MARKER"]).read_text(encoding="utf-8").splitlines()
    assert setup_args == ["setup", str(workspace), "--environment", "development"], setup_args
    assert git(checkout, "rev-parse", "HEAD") == original_head
    assert git(checkout, "branch", "--show-current") == original_branch
    if state == "dirty":
        assert (checkout / "uncommitted.txt").read_text(encoding="utf-8") == "keep\n"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="receipt-manager-codex-freshness-") as temp:
        base = Path(temp)
        for label, state in [("latest", "latest"), ("behind", "behind"), ("dirty", "dirty"),
                             ("diverged", "diverged"), ("feature", "feature")]:
            execute_case(base, label, state)

        _, _, checkout = fixture(base, "fetch-failure")
        git(checkout, "remote", "set-url", "origin", str(base / "missing-remote.git"))
        home = base / "home-fetch-failure"
        fake_bin = base / "bin-fetch-failure"
        home.mkdir()
        fake_bin.mkdir()
        marker = base / "called-fetch-failure"
        stub = fake_bin / "codex"
        stub.write_text("#!/usr/bin/env bash\ntouch \"$CODEX_MARKER\"\n", encoding="utf-8")
        stub.chmod(0o755)
        env = os.environ | {"HOME": str(home), "PATH": f"{fake_bin}:{os.environ['PATH']}",
                            "RECEIPT_MANAGER_CHECKOUT": str(checkout),
                            "RECEIPT_MANAGER_SESSION_ID": "fetch-failure", "CODEX_MARKER": str(marker)}
        result = run([str(LAUNCHER)], env=env, check=False)
        assert result.returncode != 0 and "Could not fetch origin/main" in result.stderr
        assert not marker.exists()

        _, _, checkout = fixture(base, "setup-failure")
        home = base / "home-setup-failure"
        fake_bin = base / "bin-setup-failure"
        home.mkdir()
        fake_bin.mkdir()
        marker = base / "called-setup-failure"
        setup_marker = base / "setup-called-setup-failure"
        stub = fake_bin / "codex"
        stub.write_text("#!/usr/bin/env bash\ntouch \"$CODEX_MARKER\"\n", encoding="utf-8")
        stub.chmod(0o755)
        env = os.environ | {
            "HOME": str(home), "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "RECEIPT_MANAGER_CHECKOUT": str(checkout), "RECEIPT_MANAGER_SESSION_ID": "setup-failure",
            "CODEX_MARKER": str(marker), "SETUP_MARKER": str(setup_marker), "SETUP_SHOULD_FAIL": "1",
        }
        result = run([str(LAUNCHER)], env=env, check=False)
        workspace = home / "worktrees" / "receipt-manager" / "codex-session-setup-failure"
        assert result.returncode != 0 and "Development worktree setup failed" in result.stderr
        assert setup_marker.is_file() and not marker.exists()
        assert workspace.is_dir() and git(workspace, "rev-parse", "HEAD") == git(checkout, "rev-parse", "origin/main")

        _, _, checkout = fixture(base, "collision")
        collision_home = base / "home-collision"
        collision_home.mkdir()
        collision_bin = base / "bin-collision"
        collision_bin.mkdir()
        collision_codex = collision_bin / "codex"
        collision_codex.write_text("#!/usr/bin/env bash\nexit 99\n", encoding="utf-8")
        collision_codex.chmod(0o755)
        task = "codex-session-collision"
        run(["git", "-C", str(checkout), "branch", f"codex/{task}"])
        result = run([str(LAUNCHER)], env=os.environ | {
            "HOME": str(collision_home), "PATH": f"{collision_bin}:{os.environ['PATH']}",
            "RECEIPT_MANAGER_CHECKOUT": str(checkout),
            "RECEIPT_MANAGER_SESSION_ID": "collision",
        }, check=False)
        assert result.returncode != 0 and "branch already exists" in result.stderr

        _, _, checkout = fixture(base, "codex-missing")
        missing_codex_home = base / "home-codex-missing"
        missing_codex_home.mkdir()
        missing_codex_bin = base / "bin-codex-missing"
        missing_codex_bin.mkdir()
        result = run([str(LAUNCHER)], env=os.environ | {
            "HOME": str(missing_codex_home), "PATH": f"{missing_codex_bin}:/usr/bin:/bin",
            "RECEIPT_MANAGER_CHECKOUT": str(checkout), "RECEIPT_MANAGER_SESSION_ID": "codex-missing",
        }, check=False)
        assert result.returncode != 0 and "codex executable not found" in result.stderr
        assert not (missing_codex_home / "worktrees" / "receipt-manager" / "codex-session-codex-missing").exists()
    print("Codex main freshness scenarios passed")


if __name__ == "__main__":
    main()
