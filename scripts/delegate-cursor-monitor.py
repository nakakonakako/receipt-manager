#!/usr/bin/env python3
"""Run Cursor while exposing only bounded, non-content progress metadata."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone


HEARTBEAT_SECONDS = 30
MAX_WORKER_RESPONSE_CHARS = 20_000
EVENT_TYPES = {"system", "assistant", "tool_call", "result"}
EVENT_SUBTYPES = {
    "init",
    "success",
    "error",
    "delta",
    "start",
    "complete",
    "completed",
    "failed",
    "running",
}
_interrupted: int | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_event_name(event: object) -> tuple[str, str | None]:
    if not isinstance(event, dict):
        return "unparsed_output", None
    event_type = event.get("type")
    if not isinstance(event_type, str):
        return "unparsed_output", None
    subtype = event.get("subtype")
    safe_type = event_type if event_type in EVENT_TYPES else "other"
    safe_subtype = subtype if isinstance(subtype, str) and subtype in EVENT_SUBTYPES else None
    return safe_type, safe_subtype


def set_status(path: Path, data: dict[str, object]) -> None:
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(data, handle, ensure_ascii=True, separators=(",", ":"))
        handle.write("\n")
    temporary.replace(path)


def on_signal(signum: int, _frame: object) -> None:
    global _interrupted
    _interrupted = signum


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkout", required=True)
    parser.add_argument("--tier", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--heartbeat-seconds", type=int, default=HEARTBEAT_SECONDS)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        print("[delegate-cursor] missing Cursor command", file=sys.stderr)
        return 2
    if args.heartbeat_seconds < 1:
        print("[delegate-cursor] heartbeat interval must be positive", file=sys.stderr)
        return 2

    checkout = Path(args.checkout).resolve()
    key = hashlib.sha256(os.fsencode(checkout)).hexdigest()
    state_root = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
    state_dir = state_root / "receipt-manager" / "delegate-cursor"
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(state_dir, 0o700)
    status_path = state_dir / f"{key}.json"
    lock_path = state_dir / f"{key}.lock"
    lock = lock_path.open("a", encoding="utf-8")
    os.chmod(lock_path, 0o600)
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("[delegate-cursor] worker already active for this checkout; refusing duplicate run", file=sys.stderr)
        return 4

    started_at = utc_now()
    started_mono = time.monotonic()
    last_event_at = started_at
    last_event_mono = started_mono
    last_event_type = "none"
    last_event_subtype: str | None = None
    session_id: str | None = None
    result_status: str | None = None
    result_is_error: bool | None = None
    worker_response: str | None = None
    stderr_bytes = 0
    malformed_lines = 0
    interrupted_signal: int | None = None
    pid: int | None = None
    exit_code: int | None = None
    outcome = "running"

    data: dict[str, object] = {
        "started_at": started_at,
        "pid": None,
        "tier": args.tier,
        "model": args.model,
        "session_id": None,
        "last_event_type": last_event_type,
        "last_event_subtype": None,
        "last_event_at": last_event_at,
        "last_event_idle_seconds": 0,
        "process_exit_code": None,
        "result_status": None,
        "result_is_error": None,
        "outcome": outcome,
        "stderr_bytes_discarded": 0,
        "unparsed_line_count": 0,
    }

    def update(**changes: object) -> None:
        data.update(changes)
        set_status(status_path, data)

    update()
    print(f"[delegate-cursor] started_at: {started_at}", flush=True)
    print(f"[delegate-cursor] tier/model: {args.tier}/{args.model}", flush=True)
    print(f"[delegate-cursor] status: {status_path}", flush=True)

    old_handlers = {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        try:
            child = subprocess.Popen(
                command,
                cwd=checkout,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
                bufsize=0,
            )
        except OSError:
            update(process_exit_code=127, outcome="failed")
            print("[delegate-cursor] Cursor process could not be started (details suppressed)", flush=True)
            return 127
        pid = child.pid
        update(pid=pid)
        print(f"[delegate-cursor] pid: {pid}", flush=True)

        assert child.stdout is not None and child.stderr is not None
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ, "stdout")
        selector.register(child.stderr, selectors.EVENT_READ, "stderr")
        stdout_buffer = bytearray()
        next_heartbeat = time.monotonic() + args.heartbeat_seconds

        while selector.get_map() or child.poll() is None:
            now = time.monotonic()
            if _interrupted is not None and interrupted_signal is None:
                interrupted_signal = _interrupted
                try:
                    os.killpg(child.pid, interrupted_signal)
                except ProcessLookupError:
                    pass
                outcome = "interrupted"
                update(outcome=outcome)
                print(f"[delegate-cursor] interruption requested (signal {interrupted_signal}); waiting for worker exit", flush=True)

            for key_event, _ in selector.select(timeout=min(1.0, max(0.0, next_heartbeat - now))):
                stream = key_event.fileobj
                chunk = os.read(stream.fileno(), 65536)
                if not chunk:
                    selector.unregister(stream)
                    stream.close()
                    continue
                if key_event.data == "stderr":
                    stderr_bytes += len(chunk)
                    continue
                stdout_buffer.extend(chunk)
                while b"\n" in stdout_buffer:
                    raw_line, _, remainder = stdout_buffer.partition(b"\n")
                    stdout_buffer = bytearray(remainder)
                    try:
                        event = json.loads(raw_line)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        malformed_lines += 1
                        event = None
                    last_event_type, last_event_subtype = safe_event_name(event)
                    last_event_at = utc_now()
                    last_event_mono = time.monotonic()
                    if isinstance(event, dict):
                        if event.get("type") == "system" and event.get("subtype") == "init":
                            raw_session_id = event.get("session_id")
                            if isinstance(raw_session_id, str) and re.fullmatch(
                                r"[A-Za-z0-9_-]{1,200}", raw_session_id
                            ):
                                session_id = raw_session_id
                        if event.get("type") == "result":
                            raw_status = event.get("subtype")
                            if isinstance(raw_status, str):
                                result_status = raw_status if raw_status in {"success", "error"} else "other"
                            elif isinstance(event.get("is_error"), bool):
                                result_status = "error" if event["is_error"] else "completed"
                            raw_is_error = event.get("is_error")
                            result_is_error = raw_is_error if isinstance(raw_is_error, bool) else None
                            raw_result = event.get("result")
                            worker_response = (
                                raw_result[:MAX_WORKER_RESPONSE_CHARS]
                                if isinstance(raw_result, str)
                                else None
                            )
                    update(
                        session_id=session_id,
                        last_event_type=last_event_type,
                        last_event_subtype=last_event_subtype,
                        last_event_at=last_event_at,
                        last_event_idle_seconds=0,
                        result_status=result_status,
                        result_is_error=result_is_error,
                        stderr_bytes_discarded=stderr_bytes,
                        unparsed_line_count=malformed_lines,
                    )
                    print(
                        f"[delegate-cursor] event: {last_event_type}"
                        f"{('/' + last_event_subtype) if last_event_subtype else ''} at {last_event_at}",
                        flush=True,
                    )

            now = time.monotonic()
            if now >= next_heartbeat and child.poll() is None:
                idle = int(now - last_event_mono)
                update(
                    last_event_idle_seconds=idle,
                    stderr_bytes_discarded=stderr_bytes,
                    unparsed_line_count=malformed_lines,
                )
                print(f"[delegate-cursor] 稼働中、最終イベントから{idle}秒無出力（heartbeatはworkerの進捗を保証しません）", flush=True)
                next_heartbeat = now + args.heartbeat_seconds

            if child.poll() is not None and not selector.get_map():
                break
            if child.poll() is not None and selector.get_map():
                continue

        if stdout_buffer.strip():
            malformed_lines += 1
        exit_code = child.wait()
        if interrupted_signal is not None:
            outcome = "interrupted"
        elif exit_code != 0:
            outcome = "failed"
        elif result_status == "success" and result_is_error is not True:
            outcome = "succeeded"
        else:
            outcome = "failed"
        update(
            process_exit_code=exit_code,
            result_status=result_status,
            result_is_error=result_is_error,
            outcome=outcome,
            last_event_idle_seconds=int(time.monotonic() - last_event_mono),
            stderr_bytes_discarded=stderr_bytes,
            unparsed_line_count=malformed_lines,
        )
        print(f"[delegate-cursor] exit_code: {exit_code}", flush=True)
        print(f"[delegate-cursor] result_status: {result_status or 'missing'}", flush=True)
        print(f"[delegate-cursor] outcome: {outcome}", flush=True)
        print(f"[delegate-cursor] stderr bytes discarded: {stderr_bytes}", flush=True)
        if worker_response:
            print("[delegate-cursor] worker response (not saved by monitor):", flush=True)
            print(worker_response, flush=True)
            if len(worker_response) == MAX_WORKER_RESPONSE_CHARS:
                print("[delegate-cursor] worker response truncated at 20000 characters", flush=True)
        return (128 + interrupted_signal) if interrupted_signal is not None else (0 if outcome == "succeeded" else (exit_code or 1))
    finally:
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
