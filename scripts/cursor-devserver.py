#!/usr/bin/env python3
"""Own the Cursor Playwright servers and reuse only proven same-worktree sessions."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

VERSION = 2
FRONTEND_PORT = 5274
BACKEND_PORT = 8100
MARKER = "RECEIPT_MANAGER_CURSOR_DEVSERVER_SESSION"
APPROVED_REF = "irgahixsuvtopiwmtkku"
REUSE_REASON = "run npm run devserver:stop for a verified session, or inspect the listener manually"


class DevserverError(RuntimeError):
    pass


def process_identity(pid: int) -> dict[str, int] | None:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
        fields = raw[raw.rfind(")") + 2 :].split()
        return {
            "pgid": int(fields[2]),
            "sid": int(fields[3]),
            "starttime": int(fields[19]),
        }
    except (OSError, ValueError, IndexError):
        return None


def process_marker(pid: int) -> str | None:
    try:
        entries = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    except OSError:
        return None
    prefix = f"{MARKER}=".encode()
    for entry in entries:
        if entry.startswith(prefix):
            return entry[len(prefix) :].decode(errors="replace")
    return None


def process_cwd(pid: int) -> Path | None:
    try:
        return Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
    except OSError:
        return None


def group_members(pgid: int) -> list[int]:
    result: list[int] = []
    for stat_path in Path("/proc").glob("[0-9]*/stat"):
        try:
            raw = stat_path.read_text()
            fields = raw[raw.rfind(")") + 2 :].split()
            if int(fields[2]) == pgid and fields[0] != "Z":
                result.append(int(stat_path.parent.name))
        except (OSError, ValueError, IndexError):
            continue
    return result


def listener_pids(port: int) -> set[int] | None:
    """Return all kernel-reported listener PIDs; None means ownership is unknown."""
    try:
        result = subprocess.run(
            ["ss", "-H", "-ltnp", f"sport = :{port}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    pids: set[int] = set()
    for line in result.stdout.splitlines():
        if "LISTEN" not in line:
            continue
        current = {int(value) for value in re.findall(r"pid=(\d+)", line)}
        if not current:
            return None
        pids.update(current)
    return pids


def port_is_free(port: int) -> bool:
    """Check TCP LISTEN sockets; TIME_WAIT clients do not own a dev port."""
    try:
        result = subprocess.run(
            ["ss", "-H", "-ltn", f"sport = :{port}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and not result.stdout.strip()


def ready(name: str, port: int) -> bool:
    url = f"http://127.0.0.1:{port}/"
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            body = response.read(65536).decode(errors="replace")
    except (OSError, urllib.error.URLError, TimeoutError):
        return False
    if name == "backend":
        try:
            return json.loads(body) == {
                "message": "Receipt Manager API is running.",
            }
        except json.JSONDecodeError:
            return False
    return "<title>frontend</title>" in body and "/src/main.tsx" in body


def config_fingerprint(root: Path) -> str:
    """Hash only; never persist or print environment values or dotenv contents."""
    hasher = hashlib.sha256()
    relevant = (
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_URL",
        "SUPABASE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "PYTHON_DOTENV_DISABLED",
    )
    for name in relevant:
        hasher.update(name.encode())
        hasher.update(b"\0")
        hasher.update(os.environ.get(name, "<unset>").encode())
        hasher.update(b"\0")
    files = (
        "frontend/.env",
        "frontend/.env.local",
        "frontend/.env.development",
        "frontend/.env.development.local",
        "backend/app/.env",
        "backend/.env",
        ".env",
    )
    for relative in files:
        path = root / relative
        hasher.update(relative.encode())
        try:
            content = path.read_bytes()
        except FileNotFoundError:
            hasher.update(b"<missing>")
        except OSError as exc:
            raise DevserverError(
                f"Cannot fingerprint environment file {relative}."
            ) from exc
        else:
            hasher.update(hashlib.sha256(content).digest())
    return hasher.hexdigest()


def validate_dev_target(root: Path) -> str:
    validator = root / "scripts/supabase-target.py"
    try:
        result = subprocess.run(
            [sys.executable, str(validator), "validate-dev", str(root), str(Path.home() / ".config/receipt-manager/development")],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DevserverError(
            "Could not run the Dev Supabase connection guard."
        ) from exc
    if result.returncode != 0:
        safe_detail = result.stderr.strip().splitlines()[-1:] or [
            "target validation failed"
        ]
        raise DevserverError(safe_detail[0])
    if APPROVED_REF not in result.stdout:
        raise DevserverError(
            "The connection guard did not confirm the approved Dev project."
        )
    return config_fingerprint(root)


def worktree_identity(root: Path) -> dict[str, str]:
    common_dir = subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    resolved = str(root.resolve())
    return {
        "root": resolved,
        "git_common_dir": str(Path(common_dir).resolve()),
        "id": hashlib.sha256(resolved.encode()).hexdigest(),
    }


class Devserver:
    def __init__(
        self,
        root: Path,
        state_base: Path | None = None,
        ports: dict[str, int] | None = None,
        commands: dict[str, list[str]] | None = None,
    ):
        self.root = root.resolve()
        self.ports = ports or {"frontend": FRONTEND_PORT, "backend": BACKEND_PORT}
        default_state = Path(
            os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")
        )
        self.state_base = (
            state_base or default_state / "receipt-manager/cursor-devserver"
        ).resolve()
        self.identity = worktree_identity(self.root)
        self.state_dir = self.state_base / self.identity["id"][:20]
        self.session_file = self.state_dir / "session.json"
        self.lock_file = self.state_base / "ports.lock"
        self.children: dict[str, subprocess.Popen[bytes]] = {}
        self.commands = commands or {
            "backend": [
                str(self.root / "backend/.venv/bin/python"),
                "-m",
                "uvicorn",
                "app.main:app",
                "--reload",
                "--port",
                str(self.ports["backend"]),
            ],
            "frontend": ["npm", "run", "dev:playwright", "--prefix", "frontend"],
        }

    def lock(self):
        self.state_base.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.state_base.is_symlink() or not self.state_base.is_dir():
            raise DevserverError(
                "Cursor devserver state directory is not a safe directory."
            )
        os.chmod(self.state_base, 0o700)
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(self.lock_file, flags, 0o600)
        os.fchmod(fd, 0o600)
        handle = os.fdopen(fd, "a+")
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        return handle

    def load_session(self) -> dict[str, Any] | None:
        if self.session_file.is_symlink():
            raise DevserverError(
                f"Session record is not a regular file; {REUSE_REASON}."
            )
        if self.session_file.exists() and not self.session_file.is_file():
            raise DevserverError(
                f"Session record is not a regular file; {REUSE_REASON}."
            )
        try:
            value = json.loads(self.session_file.read_text())
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError) as exc:
            raise DevserverError(
                f"Session record is unreadable; {REUSE_REASON}."
            ) from exc
        if not isinstance(value, dict):
            raise DevserverError(f"Session record is invalid; {REUSE_REASON}.")
        return value

    def save_session(self, session: dict[str, Any]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.state_dir.is_symlink() or not self.state_dir.is_dir():
            raise DevserverError(
                "Cursor devserver session directory is not a safe directory."
            )
        os.chmod(self.state_dir, 0o700)
        fd, temporary_name = tempfile.mkstemp(prefix=".session-", dir=self.state_dir)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w") as handle:
                json.dump(session, handle, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, self.session_file)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)

    def remove_session(self) -> None:
        try:
            self.session_file.unlink()
        except FileNotFoundError:
            pass

    def valid_session_header(
        self, session: dict[str, Any], fingerprint: str | None = None
    ) -> bool:
        if (
            session.get("version") != VERSION
            or session.get("worktree") != self.identity
        ):
            return False
        if (
            session.get("ports") != self.ports
            or session.get("verified_project_ref") != APPROVED_REF
        ):
            return False
        if not isinstance(session.get("nonce"), str) or len(session["nonce"]) != 36:
            return False
        fingerprint_value = session.get("config_fingerprint")
        if not isinstance(fingerprint_value, str) or not re.fullmatch(
            r"[0-9a-f]{64}", fingerprint_value
        ):
            return False
        if fingerprint is not None and session.get("config_fingerprint") != fingerprint:
            return False
        processes = session.get("processes")
        listeners = session.get("listeners")
        launches = session.get("launches", {})
        return (
            isinstance(processes, dict)
            and set(processes).issubset({"frontend", "backend"})
            and isinstance(listeners, dict)
            and set(listeners).issubset({"frontend", "backend"})
            and isinstance(launches, dict)
            and set(launches).issubset({"frontend", "backend"})
        )

    def verified_group(self, session: dict[str, Any], name: str) -> bool:
        proc = session.get("processes", {}).get(name)
        if not isinstance(proc, dict):
            return False
        try:
            pid, pgid, sid, starttime = (
                int(proc[k]) for k in ("pid", "pgid", "sid", "starttime")
            )
        except (KeyError, TypeError, ValueError):
            return False
        if pid <= 1 or pid != pgid or sid != pgid or pgid == os.getpgrp():
            return False
        leader = process_identity(pid)
        nonce = session.get("nonce")
        if not isinstance(nonce, str):
            return False
        root = Path(self.identity["root"])
        leader_ok = bool(
            leader
            and leader == {"pgid": pgid, "sid": sid, "starttime": starttime}
            and process_marker(pid) == nonce
            and process_cwd(pid) is not None
            and process_cwd(pid).is_relative_to(root)
        )
        members = group_members(pgid)
        member_ok = any(
            process_identity(member)
            and process_identity(member)["sid"] == sid
            and process_marker(member) == nonce
            and process_cwd(member) is not None
            and process_cwd(member).is_relative_to(root)
            for member in members
        )
        return leader_ok or member_ok

    def verified_leader(self, session: dict[str, Any], name: str) -> bool:
        proc = session.get("processes", {}).get(name)
        if not isinstance(proc, dict):
            return False
        try:
            pid = int(proc["pid"])
            expected = {
                "pgid": int(proc["pgid"]),
                "sid": int(proc["sid"]),
                "starttime": int(proc["starttime"]),
            }
        except (KeyError, TypeError, ValueError):
            return False
        cwd = process_cwd(pid)
        return (
            process_identity(pid) == expected
            and process_marker(pid) == session.get("nonce")
            and cwd is not None
            and cwd.is_relative_to(self.root)
        )

    def verified_listener(self, session: dict[str, Any], name: str) -> bool:
        pids = listener_pids(self.ports[name])
        if pids is None or not pids:
            return False
        proc = session["processes"][name]
        nonce = session["nonce"]
        root = Path(self.identity["root"])
        current: list[dict[str, int]] = []
        for pid in pids:
            identity = process_identity(pid)
            cwd = process_cwd(pid)
            if (
                identity is None
                or identity["pgid"] != int(proc["pgid"])
                or identity["sid"] != int(proc["sid"])
                or process_marker(pid) != nonce
                or cwd is None
                or not cwd.is_relative_to(root)
            ):
                return False
            current.append({"pid": pid, **identity})
        expected = session.get("listeners", {}).get(name)
        return isinstance(expected, list) and sorted(
            current, key=lambda item: item["pid"]
        ) == sorted(expected, key=lambda item: item["pid"])

    def session_reusable(self, session: dict[str, Any], fingerprint: str) -> bool:
        if not self.valid_session_header(session, fingerprint) or set(
            session.get("processes", {})
        ) != {"frontend", "backend"}:
            return False
        for name in ("backend", "frontend"):
            if (
                not self.verified_leader(session, name)
                or not self.verified_group(session, name)
                or not self.verified_listener(session, name)
            ):
                return False
            if not ready(name, self.ports[name]):
                return False
        return all(
            self.verified_leader(session, name)
            and self.verified_listener(session, name)
            and ready(name, self.ports[name])
            for name in ("backend", "frontend")
        )

    def port_occupancy(self) -> dict[str, bool]:
        return {name: not port_is_free(port) for name, port in self.ports.items()}

    def start_group(self, session: dict[str, Any], name: str) -> None:
        cwd = self.root / "backend" if name == "backend" else self.root
        with (self.state_dir / f"{name}.log").open("ab") as log:
            process = subprocess.Popen(
                self.commands[name],
                cwd=cwd,
                env={**os.environ, MARKER: session["nonce"]},
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.children[name] = process
        # Persist a non-signalable launch marker before attempting identity
        # inspection. It prevents a later ensure from treating this session as
        # stale if startup verification fails.
        session.setdefault("launches", {})[name] = {"pid": process.pid}
        self.save_session(session)
        deadline = time.monotonic() + 2
        identity = process_identity(process.pid)
        while identity is None and time.monotonic() < deadline:
            time.sleep(0.01)
            identity = process_identity(process.pid)
        if (
            identity is None
            or identity["pgid"] != process.pid
            or identity["sid"] != process.pid
        ):
            raise DevserverError(f"Could not verify the started {name} process group.")
        session["processes"][name] = {
            "pid": process.pid,
            "pgid": identity["pgid"],
            "sid": identity["sid"],
            "starttime": identity["starttime"],
        }
        session["launches"].pop(name, None)
        self.save_session(session)

    def resolve_launches(self, session: dict[str, Any]) -> bool:
        """Promote only independently verified children; never signal provisional PIDs."""
        launches = session.get("launches", {})
        if not launches:
            return True
        for name, launch in list(launches.items()):
            try:
                pid = int(launch["pid"])
            except (KeyError, TypeError, ValueError):
                return False
            child = self.children.get(name)
            if child is not None and child.pid == pid and child.poll() is not None:
                launches.pop(name, None)
                continue
            identity = process_identity(pid)
            expected_cwd = self.root / "backend" if name == "backend" else self.root
            cwd = process_cwd(pid)
            if (
                identity is None
                or identity["pgid"] != pid
                or identity["sid"] != pid
                or process_marker(pid) != session.get("nonce")
                or cwd is None
                or cwd != expected_cwd.resolve()
            ):
                return False
            session["processes"][name] = {
                "pid": pid,
                "pgid": identity["pgid"],
                "sid": identity["sid"],
                "starttime": identity["starttime"],
            }
            launches.pop(name, None)
        self.save_session(session)
        return True

    def stop_group(self, session: dict[str, Any], name: str) -> bool:
        if name not in session.get("processes", {}):
            return True
        if not self.valid_session_header(session):
            print(
                f"[cursor-devserver] left {name} alone: process ownership could not be verified",
                file=sys.stderr,
            )
            return False
        pgid = int(session["processes"][name]["pgid"])
        if not self.verified_group(session, name):
            if not group_members(pgid):
                child = self.children.get(name)
                if child is not None:
                    try:
                        child.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        pass
                return True
            print(
                f"[cursor-devserver] left {name} alone: process ownership could not be verified",
                file=sys.stderr,
            )
            return False
        if not self.signal_owned_group(session, name, signal.SIGTERM):
            print(
                f"[cursor-devserver] left {name} alone: process ownership changed during stop",
                file=sys.stderr,
            )
            return False
        if self.wait_group_gone(pgid, 0.25):
            return True
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if not group_members(pgid):
                return True
            time.sleep(0.05)
        if not self.verified_group(session, name):
            return False
        if not self.signal_owned_group(session, name, signal.SIGKILL):
            print(
                f"[cursor-devserver] left {name} alone: process ownership changed during stop",
                file=sys.stderr,
            )
            return False
        if not self.wait_group_gone(pgid, 3):
            print(
                f"[cursor-devserver] could not confirm {name} stopped; session record retained",
                file=sys.stderr,
            )
            return False
        child = self.children.get(name)
        if child is not None:
            try:
                child.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                return False
        return True

    @staticmethod
    def wait_group_gone(pgid: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            if not group_members(pgid):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)

    def signal_owned_group(
        self, session: dict[str, Any], name: str, signum: int
    ) -> bool:
        """Signal verified members individually through pidfds to avoid PGID reuse."""
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            return False
        proc = session.get("processes", {}).get(name, {})
        pgid, sid, nonce = int(proc["pgid"]), int(proc["sid"]), session.get("nonce")
        root = self.root
        members = group_members(pgid)
        snapshots: list[tuple[int, dict[str, int]]] = []
        for pid in members:
            identity = process_identity(pid)
            cwd = process_cwd(pid)
            if (
                identity is None
                or identity["pgid"] != pgid
                or identity["sid"] != sid
                or process_marker(pid) != nonce
                or cwd is None
                or not cwd.is_relative_to(root)
            ):
                return False
            snapshots.append((pid, identity))
        pidfds: list[tuple[int, int, dict[str, int]]] = []
        try:
            for pid, expected in snapshots:
                try:
                    pidfd = os.pidfd_open(pid)
                except ProcessLookupError:
                    continue
                except OSError:
                    return False
                pidfds.append((pidfd, pid, expected))
            for pidfd, pid, expected in pidfds:
                current = process_identity(pid)
                cwd = process_cwd(pid)
                if (
                    current != expected
                    or current["pgid"] != pgid
                    or current["sid"] != sid
                    or process_marker(pid) != nonce
                    or cwd is None
                    or not cwd.is_relative_to(root)
                ):
                    return False
            for pidfd, _, _ in pidfds:
                try:
                    signal.pidfd_send_signal(pidfd, signum)
                except ProcessLookupError:
                    continue
                except OSError:
                    return False
        finally:
            for pidfd, _, _ in pidfds:
                os.close(pidfd)
        return True

    def stop_session(self, session: dict[str, Any]) -> bool:
        if not self.valid_session_header(session):
            print(
                f"[cursor-devserver] refusing to stop an unverified session; {REUSE_REASON}",
                file=sys.stderr,
            )
            return False
        if not self.resolve_launches(session):
            print(
                "[cursor-devserver] left startup process alone: ownership could not be verified; session record retained",
                file=sys.stderr,
            )
            return False
        ok = True
        for name in ("frontend", "backend"):
            ok = self.stop_group(session, name) and ok
        deadline = time.monotonic() + 3
        while ok and time.monotonic() < deadline:
            if all(port_is_free(port) for port in self.ports.values()):
                break
            time.sleep(0.05)
        if ok and not all(port_is_free(port) for port in self.ports.values()):
            print(
                "[cursor-devserver] a port remains occupied after owned groups stopped; session record retained",
                file=sys.stderr,
            )
            ok = False
        if ok:
            self.remove_session()
        return ok

    def ensure(self) -> int:
        with self.lock():
            fingerprint = validate_dev_target(self.root)
            session = self.load_session()
            occupied = self.port_occupancy()
            if session is not None:
                if session.get("launches") and not self.resolve_launches(session):
                    raise DevserverError(
                        f"A startup process cannot be proven; {REUSE_REASON}."
                    )
                if self.session_reusable(session, fingerprint):
                    print(
                        f"[cursor-devserver] reusing verified same-worktree session; frontend http://localhost:{self.ports['frontend']} backend :{self.ports['backend']}"
                    )
                    return 0
                if not any(occupied.values()) and not any(
                    self.verified_group(session, name)
                    for name in ("frontend", "backend")
                ):
                    self.remove_session()
                    session = None
                else:
                    raise DevserverError(
                        f"Existing session or occupied port cannot be proven to belong to this worktree; {REUSE_REASON}."
                    )
            if any(occupied.values()):
                ports = ", ".join(
                    f":{self.ports[name]}" for name, used in occupied.items() if used
                )
                raise DevserverError(
                    f"Refusing to reuse occupied {ports}; owner is not proven to be this worktree. {REUSE_REASON}."
                )

            session = {
                "version": VERSION,
                "session_id": str(uuid.uuid4()),
                "nonce": str(uuid.uuid4()),
                "created_at": int(time.time()),
                "worktree": self.identity,
                "verified_project_ref": APPROVED_REF,
                "config_fingerprint": fingerprint,
                "ports": self.ports,
                "processes": {},
                "listeners": {},
                "launches": {},
            }
            self.save_session(session)
            try:
                self.start_group(session, "backend")
                if not self.wait_owned_ready(session, "backend"):
                    raise DevserverError(
                        "Backend did not become ready as an owned process."
                    )
                self.start_group(session, "frontend")
                if not self.wait_owned_ready(session, "frontend"):
                    raise DevserverError(
                        "Frontend did not become ready as an owned process."
                    )
                if validate_dev_target(
                    self.root
                ) != fingerprint or not self.session_reusable(session, fingerprint):
                    raise DevserverError(
                        "Dev configuration or process ownership changed during startup."
                    )
                print(
                    f"[cursor-devserver] started verified session; frontend http://localhost:{self.ports['frontend']} backend :{self.ports['backend']}"
                )
                return 0
            except Exception:
                try:
                    self.resolve_launches(session)
                except Exception:
                    pass
                self.stop_session(session)
                raise

    def wait_owned_ready(self, session: dict[str, Any], name: str) -> bool:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if ready(name, self.ports[name]):
                if not self.verified_group(session, name):
                    return False
                pids = listener_pids(self.ports[name])
                if pids is None or not pids:
                    return False
                proc = session["processes"][name]
                listeners: list[dict[str, int]] = []
                for pid in pids:
                    identity = process_identity(pid)
                    cwd = process_cwd(pid)
                    if (
                        identity is None
                        or identity["pgid"] != int(proc["pgid"])
                        or identity["sid"] != int(proc["sid"])
                        or process_marker(pid) != session["nonce"]
                        or cwd is None
                        or not cwd.is_relative_to(self.root)
                    ):
                        return False
                    listeners.append({"pid": pid, **identity})
                session.setdefault("listeners", {})[name] = listeners
                self.save_session(session)
                return True
            if not self.verified_group(session, name):
                return False
            time.sleep(0.2)
        return False

    def stop(self) -> int:
        with self.lock():
            session = self.load_session()
            if session is None:
                if any(self.port_occupancy().values()):
                    raise DevserverError(
                        f"No session record exists; refusing to stop an unowned port. {REUSE_REASON}."
                    )
                print("[cursor-devserver] no active session for this worktree")
                return 0
            if not self.stop_session(session):
                raise DevserverError(
                    "One or more process groups could not be proven as owned; record retained."
                )
            print(
                "[cursor-devserver] stopped verified process groups started by this worktree"
            )
            return 0

    def status(self) -> int:
        with self.lock():
            session = self.load_session()
            if session and self.valid_session_header(session):
                summary = {
                    name: self.verified_group(session, name)
                    and self.verified_listener(session, name)
                    for name in ("backend", "frontend")
                }
                print(f"[cursor-devserver] session ownership: {summary}")
            elif session:
                print("[cursor-devserver] session record: unverified")
            else:
                print("[cursor-devserver] session record: none")
            for name, port in self.ports.items():
                print(
                    f"[cursor-devserver] {name} :{port}: {'occupied' if not port_is_free(port) else 'free'}"
                )
            return 0


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if args in (["-h"], ["--help"]):
        print("Usage: cursor-devserver.sh {ensure|stop|status}")
        return 0
    if len(args) != 1 or args[0] not in {"ensure", "stop", "status"}:
        print("Usage: cursor-devserver.sh {ensure|stop|status}", file=sys.stderr)
        return 2
    try:
        root = Path(
            subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        )
        server = Devserver(root)
        return {"ensure": server.ensure, "stop": server.stop, "status": server.status}[
            args[0]
        ]()
    except (DevserverError, OSError, subprocess.CalledProcessError) as exc:
        print(f"[cursor-devserver] ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
