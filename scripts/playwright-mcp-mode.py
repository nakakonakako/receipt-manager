#!/usr/bin/env python3
"""Select the shared authenticated MCP mode and serialize its launchers."""

import fcntl
import os
from pathlib import Path
import stat
import sys
import tempfile


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"headless", "gui", "status", "run"}:
        raise ValueError("Usage: playwright-mcp-mode.py {headless|gui|status}")
    action = sys.argv[1]
    if (action == "run" and len(sys.argv) != 3) or (
        action != "run" and len(sys.argv) != 2
    ):
        raise ValueError("Invalid arguments")
    state_dir = Path.home() / ".local/state/receipt-manager/playwright-mcp-control"
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = state_dir.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise ValueError("Playwright state directory must be a private owned directory")
    lock_path = state_dir / "playwright-mcp.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
        or info.st_nlink != 1
    ):
        raise ValueError("Playwright lock must be a private owned regular file")
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise ValueError(
            "Authenticated Playwright MCP is active; stop its owner and Chromium before switching or starting another"
        ) from None
    mode_path = state_dir / "playwright-mcp-mode"
    try:
        mode_fd = os.open(mode_path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        mode = "headless"
    else:
        with os.fdopen(mode_fd, "r", encoding="utf-8") as f:
            info = os.fstat(f.fileno())
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.getuid()
                or info.st_mode & 0o077
                or info.st_nlink != 1
            ):
                raise ValueError("Playwright mode must be a private owned regular file")
            mode = f.read(32).strip()
        if mode not in {"headless", "gui"}:
            raise ValueError("Invalid Playwright mode file")
    if action in {"headless", "gui"}:
        with tempfile.NamedTemporaryFile(
            mode="w", dir=state_dir, delete=False, encoding="utf-8"
        ) as f:
            temporary = f.name
            f.write(action + "\n")
        try:
            os.replace(temporary, mode_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        print(f"Authenticated Playwright MCP mode: {action}")
    elif action == "status":
        print(f"Authenticated Playwright MCP mode: {mode}; lock: available")
    else:
        os.environ["RECEIPT_MANAGER_PLAYWRIGHT_MODE"] = mode
        os.set_inheritable(fd, True)
        os.execv("/bin/bash", ["bash", sys.argv[2], "--mode-locked"])


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        print(f"[playwright-mcp] {exc}", file=sys.stderr)
        sys.exit(1)
