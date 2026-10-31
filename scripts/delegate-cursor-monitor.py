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
import stat
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Callable, Iterator


HEARTBEAT_SECONDS = 30
MAX_EVENT_BYTES = 256 * 1024
MAX_PROGRESS_LINES = 300
EVENT_TYPES = {"system", "assistant", "tool_call", "result"}
EVENT_SUBTYPES = {
    "init",
    "success",
    "error",
    "delta",
    "start",
    "started",
    "complete",
    "completed",
    "failed",
    "running",
}
FILE_READ_CATEGORY = "ファイル読み取り"
FILE_EDIT_CATEGORY = "ファイル作成・編集"
SHELL_CATEGORY = "Shellコマンド"
MCP_CATEGORY = "MCPツール"
OTHER_CATEGORY = "その他"
TOOL_PHASE_STARTED = "started"
TOOL_PHASE_COMPLETED = "completed"
TOOL_PHASE_FAILED = "failed"
# Category comes only from these shape keys, never from tool names or payloads.
_TOOL_CATEGORY_BY_SHAPE = {
    "shellToolCall": SHELL_CATEGORY,
    "shell_tool_call": SHELL_CATEGORY,
    "bashToolCall": SHELL_CATEGORY,
    "bash_tool_call": SHELL_CATEGORY,
    "mcpToolCall": MCP_CATEGORY,
    "mcp_tool_call": MCP_CATEGORY,
    "editToolCall": FILE_EDIT_CATEGORY,
    "edit_tool_call": FILE_EDIT_CATEGORY,
    "writeToolCall": FILE_EDIT_CATEGORY,
    "write_tool_call": FILE_EDIT_CATEGORY,
    "deleteToolCall": FILE_EDIT_CATEGORY,
    "delete_tool_call": FILE_EDIT_CATEGORY,
    "readToolCall": FILE_READ_CATEGORY,
    "read_tool_call": FILE_READ_CATEGORY,
}
_TOOL_SHAPE_PRIORITY = (
    "readToolCall",
    "read_tool_call",
    "editToolCall",
    "edit_tool_call",
    "writeToolCall",
    "write_tool_call",
    "deleteToolCall",
    "delete_tool_call",
    "shellToolCall",
    "shell_tool_call",
    "bashToolCall",
    "bash_tool_call",
    "mcpToolCall",
    "mcp_tool_call",
)
_FAILURE_KEYS = {"error", "failure", "failed"}
_CALL_ID_KEYS = ("call_id", "callId", "tool_call_id", "toolCallId")
_COALESCED_EVENT_TYPES = {"assistant", "thinking"}
_MAX_TRACKED_CALLS = 1000
MAX_STDERR_LINE_BYTES = 4096
MAX_DIAGNOSTIC_LINES = 12
MAX_DIAGNOSTIC_BYTES = 8192
MAX_DIAGNOSTIC_AGE_SECONDS = 7 * 24 * 60 * 60
MAX_DIAGNOSTIC_FILES = 20
MAX_REPORT_BYTES = 4096
MAX_STORED_RESULT_BYTES = 65536
_MIN_ENV_SECRET_LENGTH = 8
_REPORT_BEGIN = "[delegate-cursor] ----- worker completion report begin -----"
_REPORT_END = "[delegate-cursor] ----- worker completion report end -----"
_REPORT_PREFIX = "[delegate-cursor] report: "
_REPORT_TRUNCATED = "[delegate-cursor] report: [truncated]"
_REPORT_FINDINGS_OMITTED = "verification_findings_omitted by 4 KiB output limit"
_REPORT_OMITTED = "[delegate-cursor] report: omitted (result text absent)"
_REPORT_UNTRUSTED = (
    "[delegate-cursor] report: untrusted free-form result text; review the diff"
)
_REPORT_MISSING_VERIFICATION = (
    "[delegate-cursor] verification UNCONFIRMED: verification block, coverage, "
    "or consistent results are missing"
)
_REPORT_INPUT_TRUNCATED = (
    "[delegate-cursor] verification UNCONFIRMED: final report exceeded 64 KiB; "
    "the omitted tail may contain additional results"
)
_REPORT_BLOCK_START = re.compile(r"^#{0,6}\s*VERIFICATION RESULTS\s*:?\s*$", re.I)
_REPORT_BLOCK_END = re.compile(r"^#{0,6}\s*END VERIFICATION RESULTS\s*$", re.I)
_REPORT_STATUS = re.compile(r"^(PASS|FAIL|UNCONFIRMED):\s*(.*)$", re.I)
_REPORT_COVERAGE = re.compile(r"^COVERAGE:\s*(COMPLETE|INCOMPLETE)\s*$", re.I)
_MAX_REPORT_FINDING_BYTES = 600
_MAX_REPORT_CONTEXT_BYTES = 320
_SECRET_ENV_NAME = re.compile(
    r"(?i)(?:api[_-]?key|access[_-]?key|service[_-]?role[_-]?key|"
    r"(?:^|_)[a-z0-9]*_key(?:_|$)|secret|token|password|passwd|credential|"
    r"private[_-]?key|database[_-]?url)"
)
_ANSI_RE = re.compile(
    r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]"
)
_UNSAFE_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x0d\x0e-\x1f\x7f-\x9f\u2028\u2029]")
ERROR_PATTERNS = {
    "resource_exhausted": re.compile(
        r"resource[_ -]?exhausted|insufficient (?:model )?capacity", re.IGNORECASE
    ),
    "network_connection": re.compile(
        r"\bnetwork\b.{0,80}\b(?:error|failed|failure|timeout|unavailable|reset|refused)\b"
        r"|\bconnection\b.{0,80}\b(?:error|failed|failure|timeout|refused|reset|closed)\b"
        r"|\b(?:econnreset|econnrefused|econnaborted|etimedout|enotfound)\b"
        r"|\b(?:dns|socket|tls|handshake)\b.{0,80}\b(?:error|failed|failure|timeout)\b",
        re.IGNORECASE,
    ),
    "authentication": re.compile(
        r"\b(?:authentication|authorization|unauthorized|not logged in|invalid token|401)\b"
        r"|\bauth(?: error| failed| failure| denied)\b",
        re.IGNORECASE,
    ),
    "workspace_trust_required": re.compile(
        r"\bworkspace trust required\b", re.IGNORECASE
    ),
    "permission_denied": re.compile(
        r"permission denied|access denied|not permitted|\beacces\b|\beperm\b",
        re.IGNORECASE,
    ),
    "mcp_initialization": re.compile(
        r"\bmcp\b.{0,80}(?:initiali[sz]|failed|error)|(?:initiali[sz]|failed|error).{0,80}\bmcp\b",
        re.IGNORECASE,
    ),
    "worktree_setup": re.compile(
        r"worktree|workspace.{0,30}(?:setup|initiali[sz]|create)|(?:setup|initiali[sz]|create).{0,30}workspace",
        re.IGNORECASE,
    ),
}
SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*:\s*(?:bearer|basic)\s+)\S+"),
    re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/-]+=*"),
    re.compile(
        r"(?i)\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|password|secret|credential)\s*[\"']?\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;}]+)"
    ),
    re.compile(
        r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{30,}|ya29\.[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b"
    ),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    re.compile(r"(?i)(https?://)[^/@\s:]+:[^/@\s]+@"),
    re.compile(r"(?i)([?&](?:token|key|secret|password)=)[^&#\s]+"),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
)
_interrupted: int | None = None


class BoundedStdoutLines:
    """Yield newline-delimited records without retaining oversized rows."""

    def __init__(self, max_bytes: int = MAX_EVENT_BYTES) -> None:
        self.max_bytes = max_bytes
        self.buffer = bytearray()
        self.discarding = False
        self.pending_cr = False
        self.oversized_lines = 0

    @property
    def buffered_bytes(self) -> int:
        return len(self.buffer)

    def feed(self, chunk: bytes) -> Iterator[bytes]:
        remaining = chunk
        while remaining:
            if self.discarding:
                newline = remaining.find(b"\n")
                if newline < 0:
                    return
                remaining = remaining[newline + 1 :]
                self.discarding = False
                continue

            newline = remaining.find(b"\n")
            end = len(remaining) if newline < 0 else newline
            segment = remaining[:end]
            has_newline = newline >= 0
            if self.pending_cr:
                if not (has_newline and not segment):
                    segment = b"\r" + segment
                self.pending_cr = False
            if has_newline and segment.endswith(b"\r"):
                segment = segment[:-1]
            elif not has_newline and segment.endswith(b"\r"):
                segment = segment[:-1]
                self.pending_cr = True
            if len(self.buffer) + len(segment) > self.max_bytes:
                self.buffer.clear()
                self.pending_cr = False
                self.oversized_lines += 1
                self.discarding = not has_newline
                if has_newline:
                    remaining = remaining[newline + 1 :]
                    continue
                return

            self.buffer.extend(segment)
            if not has_newline:
                return
            yield bytes(self.buffer)
            self.buffer.clear()
            self.pending_cr = False
            remaining = remaining[newline + 1 :]

    def finish(self) -> Iterator[bytes]:
        if self.discarding:
            self.discarding = False
            return
        if self.pending_cr:
            if len(self.buffer) == self.max_bytes:
                self.buffer.clear()
                self.pending_cr = False
                self.oversized_lines += 1
                return
            self.buffer.extend(b"\r")
            self.pending_cr = False
        if self.buffer:
            if self.buffer.strip():
                yield bytes(self.buffer)
            self.buffer.clear()


class StatusSnapshot:
    """Separate in-memory event aggregation from durable checkpoint writes."""

    def __init__(
        self,
        data: dict[str, object],
        writer: Callable[[dict[str, object]], None],
    ) -> None:
        self.data = data
        self.writer = writer

    def update(self, **changes: object) -> None:
        self.data.update(changes)

    def persist(self) -> None:
        self.writer(self.data)


class ProgressOutput:
    """Bound routine progress while allowing important/final notices through."""

    def __init__(self, limit: int = MAX_PROGRESS_LINES) -> None:
        self.limit = limit
        self.emitted = 0
        self.suppressed = 0

    def emit(self, line: str, *, important: bool = False) -> None:
        if important:
            print(line, flush=True)
        elif self.emitted < self.limit:
            print(line, flush=True)
            self.emitted += 1
        else:
            self.suppressed += 1

    def report_suppressed(self) -> None:
        if self.suppressed:
            print(
                f"[delegate-cursor] progress_lines_suppressed: {self.suppressed}",
                flush=True,
            )


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
    safe_subtype = (
        subtype if isinstance(subtype, str) and subtype in EVENT_SUBTYPES else None
    )
    return safe_type, safe_subtype


def _is_coalesced_event(event: object, subtype: str | None) -> bool:
    if subtype == "delta":
        return True
    return isinstance(event, dict) and event.get("type") in _COALESCED_EVENT_TYPES


def _tool_shape_containers(event: dict[str, object]) -> list[dict[str, object]]:
    containers: list[dict[str, object]] = [event]
    for key in ("tool_call", "toolCall"):
        value = event.get(key)
        if isinstance(value, dict):
            containers.append(value)
        elif isinstance(value, list):
            containers.extend(item for item in value if isinstance(item, dict))
    return containers


def tool_category(event: object) -> str:
    if not isinstance(event, dict):
        return OTHER_CATEGORY
    found: set[str] = set()
    for container in _tool_shape_containers(event):
        for key in container:
            if isinstance(key, str) and key in _TOOL_CATEGORY_BY_SHAPE:
                found.add(key)
    for key in _TOOL_SHAPE_PRIORITY:
        if key in found:
            return _TOOL_CATEGORY_BY_SHAPE[key]
    return OTHER_CATEGORY


def _has_failure_marker(node: object, depth: int = 0, budget: int = 200) -> bool:
    """True when a known failure key is present. Values are never read for output."""
    if budget <= 0 or depth > 8:
        return False
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(key, str) and key in _FAILURE_KEYS:
                return True
            if isinstance(value, (dict, list)) and _has_failure_marker(
                value, depth + 1, budget - 1
            ):
                return True
    elif isinstance(node, list):
        for item in node[:50]:
            if isinstance(item, (dict, list)) and _has_failure_marker(
                item, depth + 1, budget - 1
            ):
                return True
    return False


def tool_payload_failed(event: dict[str, object]) -> bool:
    if event.get("is_error") is True:
        return True
    for key in ("tool_call", "toolCall"):
        if key in event and _has_failure_marker(event.get(key)):
            return True
    return False


def tool_phase(event: object, subtype: str | None) -> str | None:
    if not isinstance(event, dict) or event.get("type") != "tool_call":
        return None
    if subtype == "delta":
        return None
    if subtype == TOOL_PHASE_STARTED:
        return TOOL_PHASE_STARTED
    failed = subtype in {"failed", "error"} or tool_payload_failed(event)
    if failed and subtype in {None, "completed", "failed", "error"}:
        return TOOL_PHASE_FAILED
    if subtype == "completed":
        return TOOL_PHASE_COMPLETED
    return None


def _call_id_value(value: object) -> str | None:
    if isinstance(value, str) and 1 <= len(value) <= 256:
        return value
    return None


def extract_call_id(event: dict[str, object]) -> str | None:
    containers: list[dict[str, object]] = [event]
    for key in ("tool_call", "toolCall"):
        value = event.get(key)
        if isinstance(value, dict):
            containers.append(value)
            for nested_key, nested in value.items():
                if nested_key in {
                    "args",
                    "arguments",
                    "parameters",
                    "input",
                    "result",
                    "output",
                }:
                    continue
                if isinstance(nested, dict):
                    containers.append(nested)
    for container in containers:
        for key in _CALL_ID_KEYS:
            found = _call_id_value(container.get(key))
            if found is not None:
                return found
    return None


def _validate_private_regular_file(dir_fd: int, name: str) -> os.stat_result | None:
    try:
        info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
        or info.st_nlink != 1
    ):
        raise OSError("unsafe state file")
    return info


def set_status(dir_fd: int, name: str, data: dict[str, object]) -> None:
    _validate_private_regular_file(dir_fd, name)
    temporary = f".{name}.{uuid.uuid4().hex}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    flags |= getattr(os, "O_CLOEXEC", 0)
    descriptor = os.open(temporary, flags, 0o600, dir_fd=dir_fd)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
        ):
            raise OSError("unsafe status temporary file")
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            json.dump(data, handle, ensure_ascii=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, name, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        os.fsync(dir_fd)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary, dir_fd=dir_fd)
        except OSError:
            pass
        raise


def _redact_known_secrets(text: str) -> str:
    scrubbed = text
    for pattern in SECRET_PATTERNS:
        if pattern.groups:
            if "https?://" in pattern.pattern:
                scrubbed = pattern.sub(r"\1[REDACTED]@", scrubbed)
            elif "[?&]" in pattern.pattern:
                scrubbed = pattern.sub(r"\1[REDACTED]", scrubbed)
            elif "authorization" in pattern.pattern.lower():
                scrubbed = pattern.sub(r"\1[REDACTED]", scrubbed)
            elif "bearer" in pattern.pattern.lower():
                scrubbed = pattern.sub(r"\1[REDACTED]", scrubbed)
            elif "api[ _-]?key" in pattern.pattern.lower():
                scrubbed = pattern.sub(r"\1=[REDACTED]", scrubbed)
            else:
                scrubbed = pattern.sub("[REDACTED]", scrubbed)
        else:
            scrubbed = pattern.sub("[REDACTED]", scrubbed)
    return scrubbed


def scrub_stderr_line(line: str) -> str:
    scrubbed = _redact_known_secrets(re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", line))
    return scrubbed.encode("utf-8")[:512].decode("utf-8", errors="ignore")


def _section_pattern(title: str) -> re.Pattern[str]:
    return re.compile(rf"(?i)^(?:#+\s+|\d+[.)]\s+)?(?:{title})\s*(?::\s*(.*))?$")


_REPORT_SECTIONS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "intent",
        _section_pattern(
            r"root cause(?:\s*/\s*(?:implementation\s+)?intent)?|implementation intent"
        ),
    ),
    ("changed files", _section_pattern(r"changed files")),
    (
        "verification",
        _section_pattern(
            r"verification(?:\s+performed(?:\s+and\s+results)?|\s+results)?"
        ),
    ),
    ("risks", _section_pattern(r"(?:remaining\s+)?risks")),
    (
        "supervisor decisions",
        _section_pattern(
            r"supervisor decisions(?:\s+required)?"
            r"|supervisor review"
            r"|anything requiring supervisor review"
        ),
    ),
)


def capture_result_text(raw_result: object) -> tuple[str | None, bool]:
    """Keep only a bounded copy of the final result string."""
    if not isinstance(raw_result, str):
        return None, False
    raw_bytes = raw_result.encode("utf-8")
    if len(raw_bytes) <= MAX_STORED_RESULT_BYTES:
        return raw_result, False
    clipped = raw_bytes[:MAX_STORED_RESULT_BYTES].decode("utf-8", errors="ignore")
    return clipped, True


def _redact_env_secrets(text: str) -> str:
    values = [
        value
        for name, value in os.environ.items()
        if _SECRET_ENV_NAME.search(name) and len(value) >= _MIN_ENV_SECRET_LENGTH
    ]
    for value in sorted(set(values), key=len, reverse=True):
        text = text.replace(value, "[REDACTED]")
    return text


def _sanitize_report_text(text: str) -> str:
    scrubbed = _redact_env_secrets(text)
    scrubbed = _ANSI_RE.sub("", scrubbed)
    scrubbed = _UNSAFE_CONTROL_RE.sub("", scrubbed)
    scrubbed = _redact_env_secrets(scrubbed)
    scrubbed = _redact_known_secrets(scrubbed)
    scrubbed = scrubbed.replace(_REPORT_BEGIN, "[report delimiter removed]")
    scrubbed = scrubbed.replace(_REPORT_END, "[report delimiter removed]")
    return scrubbed


def _normalize_header_line(line: str) -> str:
    return re.sub(r"[*_`]+", "", line).strip()


def _extract_report_sections(text: str) -> list[tuple[str, list[str]]] | None:
    sections: list[tuple[str, list[str]]] = []
    current_name: str | None = None
    current_lines: list[str] = []
    for line in text.split("\n"):
        normalized = _normalize_header_line(line)
        matched: tuple[str, str] | None = None
        for name, pattern in _REPORT_SECTIONS:
            found = pattern.fullmatch(normalized)
            if found:
                inline = found.group(1) or ""
                matched = (name, inline.strip())
                break
        if matched is None:
            if current_name is not None:
                current_lines.append(line)
            continue
        if current_name is not None:
            sections.append((current_name, current_lines))
        current_name, inline_text = matched
        current_lines = [inline_text] if inline_text else []
    if current_name is not None:
        sections.append((current_name, current_lines))
    if len(sections) < 2:
        return None
    return sections


def _report_nbytes(parts: list[str]) -> int:
    return len(("\n".join(parts) + "\n").encode("utf-8"))


def _shrink_report_line(line: str, kept: list[str]) -> str | None:
    if not line.startswith(_REPORT_PREFIX):
        return None
    prefix_len = len(_REPORT_PREFIX)
    best: str | None = None
    low = prefix_len
    high = len(line)
    while low <= high:
        mid = (low + high) // 2
        candidate = line[:mid]
        trial = [_REPORT_BEGIN, *kept, candidate, _REPORT_TRUNCATED, _REPORT_END]
        if _report_nbytes(trial) <= MAX_REPORT_BYTES:
            best = candidate
            low = mid + 1
        else:
            high = mid - 1
    return best


def _fit_report_lines(body_lines: list[str], *, force_truncated: bool) -> list[str]:
    if not force_truncated:
        full = [_REPORT_BEGIN, *body_lines, _REPORT_END]
        if _report_nbytes(full) <= MAX_REPORT_BYTES:
            return full
    kept: list[str] = []
    omitted = False
    for line in body_lines:
        trial = [_REPORT_BEGIN, *kept, line, _REPORT_TRUNCATED, _REPORT_END]
        if _report_nbytes(trial) <= MAX_REPORT_BYTES:
            kept.append(line)
            continue
        omitted = True
        shrunk = _shrink_report_line(line, kept) if not kept else None
        if shrunk is not None:
            kept.append(shrunk)
    if omitted or force_truncated:
        return [_REPORT_BEGIN, *kept, _REPORT_TRUNCATED, _REPORT_END]
    return [_REPORT_BEGIN, *kept, _REPORT_END]


def _bounded_report_line(line: str, limit: int) -> str:
    encoded = line.encode("utf-8")
    if len(encoded) <= limit:
        return line
    return encoded[: limit - 3].decode("utf-8", errors="ignore") + "..."


def _verification_report(
    text: str, input_truncated: bool
) -> tuple[str, list[str], list[str]]:
    findings: dict[str, list[str]] = {"FAIL": [], "UNCONFIRMED": [], "PASS": []}
    context: list[str] = []
    coverage_claims: list[str] = []
    criteria: set[str] = set()
    in_block = False
    starts = 0
    ends = 0
    malformed = False

    for line in text.splitlines():
        candidate = re.sub(r"^[-*+]\s+", "", line.strip())
        if _REPORT_BLOCK_START.fullmatch(candidate):
            starts += 1
            malformed |= in_block or starts > 1
            in_block = True
            continue
        if _REPORT_BLOCK_END.fullmatch(candidate):
            if not in_block:
                malformed = True
            else:
                ends += 1
                malformed |= ends > 1
                in_block = False
            continue
        if not in_block:
            status = _REPORT_STATUS.fullmatch(candidate)
            if status or candidate.upper().startswith("COVERAGE:"):
                malformed = True
                context.append(
                    _bounded_report_line(
                        f"unscoped status-like text: {line.strip()}",
                        _MAX_REPORT_CONTEXT_BYTES,
                    )
                )
            continue
        coverage = _REPORT_COVERAGE.fullmatch(candidate)
        if coverage:
            coverage_claims.append(coverage.group(1).upper())
            continue
        if candidate.upper().startswith("COVERAGE:"):
            malformed = True
            context.append(
                _bounded_report_line(
                    f"malformed coverage: {line.strip()}", _MAX_REPORT_CONTEXT_BYTES
                )
            )
            continue
        status = _REPORT_STATUS.fullmatch(candidate)
        if status:
            label, value = status.group(1).upper(), status.group(2).strip()
            if "—" not in value:
                malformed = True
                context.append(
                    _bounded_report_line(
                        f"malformed status: {line.strip()}", _MAX_REPORT_CONTEXT_BYTES
                    )
                )
                continue
            criterion, evidence = (part.strip() for part in value.split("—", 1))
            if (
                not criterion
                or not evidence
                or criterion in {"...", "TBD"}
                or evidence in {"...", "TBD"}
            ):
                malformed = True
                context.append(
                    _bounded_report_line(
                        f"malformed status: {line.strip()}", _MAX_REPORT_CONTEXT_BYTES
                    )
                )
                continue
            key = re.sub(r"\s+", " ", criterion).casefold()
            malformed |= key in criteria
            criteria.add(key)
            findings[label].append(
                _bounded_report_line(
                    f"[delegate-cursor] verification {label}: {criterion} — {evidence}",
                    _MAX_REPORT_FINDING_BYTES,
                )
            )
            continue
        if candidate.upper().startswith(("PASS:", "FAIL:", "UNCONFIRMED:")):
            malformed = True
            context.append(
                _bounded_report_line(
                    f"malformed status: {line.strip()}", _MAX_REPORT_CONTEXT_BYTES
                )
            )

    valid_block = starts == 1 and ends == 1 and not in_block
    if not valid_block:
        for label, lines in findings.items():
            context.extend(
                _bounded_report_line(
                    f"unscoped {line.partition('] verification ')[2]}",
                    _MAX_REPORT_CONTEXT_BYTES,
                )
                for line in lines
            )
            findings[label].clear()
    if input_truncated:
        coverage_status = "UNCONFIRMED"
        findings["UNCONFIRMED"].insert(0, _REPORT_INPUT_TRUNCATED)
    elif (
        not valid_block
        or len(coverage_claims) != 1
        or malformed
        or not any(findings.values())
    ):
        coverage_status = "UNCONFIRMED"
        findings["UNCONFIRMED"].insert(0, _REPORT_MISSING_VERIFICATION)
    elif coverage_claims[0] == "INCOMPLETE" or findings["UNCONFIRMED"]:
        coverage_status = "INCOMPLETE"
        if coverage_claims[0] == "INCOMPLETE" and not findings["UNCONFIRMED"]:
            findings["UNCONFIRMED"].append(
                "[delegate-cursor] verification UNCONFIRMED: coverage is incomplete but no unchecked criterion was identified"
            )
    else:
        coverage_status = "COMPLETE"
    prioritized = [
        findings[label][0]
        for label in ("FAIL", "UNCONFIRMED", "PASS")
        if findings[label]
    ]
    prioritized.extend(
        line
        for label in ("FAIL", "UNCONFIRMED", "PASS")
        for line in findings[label][1:]
    )
    context.sort(key=lambda line: not line.startswith("unscoped"))
    return coverage_status, prioritized, context


def _report_body(text: str, *, input_truncated: bool) -> list[str]:
    coverage, findings, context = _verification_report(text, input_truncated)
    counts = {
        label: sum(f"verification {label}:" in line for line in findings)
        for label in ("FAIL", "UNCONFIRMED", "PASS")
    }
    summary = [
        f"{_REPORT_PREFIX}verification_coverage: {coverage}",
        (
            f"{_REPORT_PREFIX}verification_counts: FAIL={counts['FAIL']} "
            f"UNCONFIRMED={counts['UNCONFIRMED']} PASS={counts['PASS']}"
        ),
    ]
    sections = _extract_report_sections(text)
    if sections is None:
        body = list(summary)
        body.extend(
            f"{_REPORT_PREFIX}{line.removeprefix('[delegate-cursor] ')}"
            for line in findings
        )
        body.append(_REPORT_UNTRUSTED)
        body.extend(
            f"{_REPORT_PREFIX}{_bounded_report_line(line, _MAX_REPORT_CONTEXT_BYTES)}"
            for line in context[:8]
        )
        body.extend(
            f"{_REPORT_PREFIX}{_bounded_report_line(line, _MAX_REPORT_CONTEXT_BYTES)}"
            for line in text.split("\n")[:8]
        )
        return body
    body = list(summary)
    body.extend(
        f"{_REPORT_PREFIX}{line.removeprefix('[delegate-cursor] ')}"
        for line in findings
    )
    body.extend(f"{_REPORT_PREFIX}{line}" for line in context)
    for name, content in sections:
        body.append(f"{_REPORT_PREFIX}section: {name}")
        body.extend(
            f"{_REPORT_PREFIX}{_bounded_report_line(line, _MAX_REPORT_CONTEXT_BYTES)}"
            for line in content
        )
    return body


def _visible_finding_counts(lines: list[str]) -> dict[str, int]:
    counts = {label: 0 for label in ("FAIL", "UNCONFIRMED", "PASS")}
    pattern = re.compile(
        r"^\[delegate-cursor\] report: verification (FAIL|UNCONFIRMED|PASS):"
    )
    for line in lines:
        match = pattern.match(line)
        if match:
            counts[match.group(1)] += 1
    return counts


def _fit_report_with_omission_notice(
    body: list[str], *, force_truncated: bool
) -> list[str]:
    parts = _fit_report_lines(body, force_truncated=force_truncated)
    expected = _visible_finding_counts(body)
    visible = _visible_finding_counts(parts)
    omitted = {label: expected[label] - visible[label] for label in expected}
    if not any(omitted.values()):
        return parts

    notice = (
        f"{_REPORT_PREFIX}{_REPORT_FINDINGS_OMITTED}: "
        f"FAIL={omitted['FAIL']} UNCONFIRMED={omitted['UNCONFIRMED']} "
        f"PASS={omitted['PASS']}"
    )
    insert_at = 2 if len(body) >= 2 else len(body)
    body.insert(insert_at, notice)
    for _ in range(3):
        parts = _fit_report_lines(body, force_truncated=True)
        visible = _visible_finding_counts(parts)
        final_omitted = {label: expected[label] - visible[label] for label in expected}
        if final_omitted == omitted:
            break
        omitted = final_omitted
        body[insert_at] = (
            f"{_REPORT_PREFIX}{_REPORT_FINDINGS_OMITTED}: "
            f"FAIL={omitted['FAIL']} UNCONFIRMED={omitted['UNCONFIRMED']} "
            f"PASS={omitted['PASS']}"
        )
    return parts


def emit_worker_report(text: str | None, *, input_truncated: bool) -> None:
    """Print a bounded completion report. The text is not retained elsewhere."""
    sanitized = _sanitize_report_text(text) if text else ""
    if not sanitized.strip():
        parts = [
            _REPORT_BEGIN,
            f"{_REPORT_PREFIX}verification_coverage: UNCONFIRMED",
            f"{_REPORT_PREFIX}verification_counts: FAIL=0 UNCONFIRMED=1 PASS=0",
            f"{_REPORT_PREFIX}{_REPORT_MISSING_VERIFICATION.removeprefix('[delegate-cursor] ')}",
            _REPORT_OMITTED,
        ]
        if input_truncated:
            parts.append(_REPORT_TRUNCATED)
        parts.append(_REPORT_END)
    else:
        parts = _fit_report_with_omission_notice(
            _report_body(sanitized, input_truncated=input_truncated),
            force_truncated=(
                input_truncated or len(sanitized.encode("utf-8")) > MAX_REPORT_BYTES
            ),
        )
    for line in parts:
        print(line, flush=True)


class StderrDiagnostics:
    """Bounded in-memory stderr classifier and failure-only excerpt buffer."""

    def __init__(self) -> None:
        self.buffer = bytearray()
        self.discarding_long_line = False
        self.error_events: list[dict[str, str]] = []
        self.leading_excerpts: list[str] = []
        self.trailing_excerpts: list[str] = []

    @property
    def excerpts(self) -> list[str]:
        return [*self.leading_excerpts, *self.trailing_excerpts]

    def _consume_line(
        self, raw_line: bytes, truncated: bool = False
    ) -> list[dict[str, str]]:
        text = raw_line.decode("utf-8", errors="replace")
        if truncated:
            text += " [line truncated]"
        occurred_at = utc_now()
        added: list[dict[str, str]] = []
        for category, pattern in ERROR_PATTERNS.items():
            if pattern.search(text):
                record = {"category": category, "occurred_at": occurred_at}
                if len(self.error_events) < 30:
                    self.error_events.append(record)
                    added.append(record)
        safe_line = scrub_stderr_line(text)
        if len(self.leading_excerpts) < MAX_DIAGNOSTIC_LINES // 2:
            self.leading_excerpts.append(safe_line)
        else:
            if len(self.trailing_excerpts) >= MAX_DIAGNOSTIC_LINES // 2:
                self.trailing_excerpts.pop(0)
            self.trailing_excerpts.append(safe_line)
        return added

    def feed(self, chunk: bytes) -> list[dict[str, str]]:
        added: list[dict[str, str]] = []
        remaining = chunk
        while remaining:
            if self.discarding_long_line:
                newline = remaining.find(b"\n")
                if newline < 0:
                    return added
                remaining = remaining[newline + 1 :]
                self.discarding_long_line = False
                continue
            newline = remaining.find(b"\n")
            if newline >= 0:
                segment = remaining[:newline]
                if len(self.buffer) + len(segment) > MAX_STDERR_LINE_BYTES:
                    available = max(0, MAX_STDERR_LINE_BYTES - len(self.buffer))
                    self.buffer.extend(segment[:available])
                    added.extend(self._consume_line(bytes(self.buffer), truncated=True))
                    self.buffer.clear()
                else:
                    self.buffer.extend(segment)
                    added.extend(self._consume_line(bytes(self.buffer)))
                    self.buffer.clear()
                remaining = remaining[newline + 1 :]
                continue
            if len(self.buffer) + len(remaining) > MAX_STDERR_LINE_BYTES:
                available = max(0, MAX_STDERR_LINE_BYTES - len(self.buffer))
                self.buffer.extend(remaining[:available])
                added.extend(self._consume_line(bytes(self.buffer), truncated=True))
                self.buffer.clear()
                self.discarding_long_line = True
            else:
                self.buffer.extend(remaining)
            break
        return added

    def finish(self) -> list[dict[str, str]]:
        if not self.buffer:
            return []
        added = self._consume_line(
            bytes(self.buffer), truncated=self.discarding_long_line
        )
        self.buffer.clear()
        return added


_DIAGNOSTIC_NAME = re.compile(r"cursor-stderr-[0-9]{8}T[0-9]{6}Z-[0-9]+\.log\Z")


def _diagnostic_records(dir_fd: int) -> list[tuple[str, float]]:
    records: list[tuple[str, float]] = []
    for name in os.listdir(dir_fd):
        if not name.startswith("cursor-stderr-"):
            continue
        if not _DIAGNOSTIC_NAME.fullmatch(name):
            raise OSError("unsafe diagnostic log name")
        info = _validate_private_regular_file(dir_fd, name)
        if info is None:
            continue
        records.append((name, info.st_mtime))
    return records


def prune_diagnostic_logs(dir_fd: int, preserve: str | None = None) -> None:
    now = time.time()
    logs = sorted(
        (
            (name, modified)
            for name, modified in _diagnostic_records(dir_fd)
            if name != preserve
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    max_files = MAX_DIAGNOSTIC_FILES - 1 if preserve else MAX_DIAGNOSTIC_FILES
    for index, (name, modified) in enumerate(logs):
        if now - modified > MAX_DIAGNOSTIC_AGE_SECONDS or index >= max_files:
            os.unlink(name, dir_fd=dir_fd)


def _open_state_directory(path: Path) -> int:
    """Open/create a private directory chain without following symlinks."""
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    directory = getattr(os, "O_DIRECTORY", 0)
    if not nofollow or not directory:
        raise OSError("safe state directory flags are unavailable")
    if not path.is_absolute() or ".." in path.parts:
        raise OSError("unsafe state directory path")
    absolute = path
    descriptor = os.open(os.sep, os.O_RDONLY | directory | nofollow)
    try:
        components = absolute.parts[1:]
        for index, component in enumerate(components):
            try:
                next_descriptor = os.open(
                    component,
                    os.O_RDONLY | directory | nofollow,
                    dir_fd=descriptor,
                )
            except FileNotFoundError:
                try:
                    os.mkdir(component, 0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
                next_descriptor = os.open(
                    component,
                    os.O_RDONLY | directory | nofollow,
                    dir_fd=descriptor,
                )
            info = os.fstat(next_descriptor)
            root_sticky_parent = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
            if not stat.S_ISDIR(info.st_mode) or (
                info.st_uid not in {0, os.getuid()} and not root_sticky_parent
            ):
                os.close(next_descriptor)
                raise OSError("unsafe state directory owner or type")
            if info.st_mode & 0o022 and not root_sticky_parent:
                os.close(next_descriptor)
                raise OSError("writable state directory parent")
            if index == len(components) - 1 and (
                info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700
            ):
                os.close(next_descriptor)
                raise OSError("state directory must be owned and mode 0700")
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def open_lock_file(dir_fd: int, name: str) -> int:
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if not nofollow:
        raise OSError("safe lock file flags are unavailable")
    flags = os.O_RDWR | os.O_CREAT | nofollow | getattr(os, "O_CLOEXEC", 0)
    descriptor = os.open(name, flags, 0o600, dir_fd=dir_fd)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink != 1
        ):
            raise OSError("unsafe lock file owner or type")
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def acquire_file_lock(dir_fd: int, name: str, *, nonblocking: bool) -> int:
    descriptor = open_lock_file(dir_fd, name)
    operation = fcntl.LOCK_EX | (fcntl.LOCK_NB if nonblocking else 0)
    try:
        fcntl.flock(descriptor, operation)
    except Exception:
        os.close(descriptor)
        raise
    return descriptor


def prune_diagnostics_safely(dir_fd: int, *, required: bool = False) -> bool:
    try:
        lock = acquire_file_lock(dir_fd, "diagnostics.lock", nonblocking=False)
    except OSError:
        if required:
            raise
        return False
    try:
        prune_diagnostic_logs(dir_fd)
        return True
    finally:
        os.close(lock)


def save_failure_diagnostics(
    dir_fd: int, state_dir: Path, pid: int, diagnostics: StderrDiagnostics
) -> Path | None:
    if not diagnostics.excerpts:
        return None
    try:
        lock = acquire_file_lock(dir_fd, "diagnostics.lock", nonblocking=False)
    except OSError:
        return None
    try:
        return _save_failure_diagnostics_locked(dir_fd, state_dir, pid, diagnostics)
    except OSError:
        return None
    finally:
        os.close(lock)


def _save_failure_diagnostics_locked(
    dir_fd: int, state_dir: Path, pid: int, diagnostics: StderrDiagnostics
) -> Path | None:
    prune_diagnostic_logs(dir_fd)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = f"cursor-stderr-{timestamp}-{pid}.log"
    content = "\n".join(diagnostics.excerpts).encode("utf-8")[:MAX_DIAGNOSTIC_BYTES]
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    flags |= getattr(os, "O_CLOEXEC", 0)
    descriptor: int | None = None
    created = False
    try:
        descriptor = os.open(name, flags, 0o600, dir_fd=dir_fd)
        created = True
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
        ):
            raise OSError("unsafe diagnostic file")
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if created:
            try:
                os.unlink(name, dir_fd=dir_fd)
            except OSError:
                pass
        return None
    prune_diagnostic_logs(dir_fd, preserve=name)
    os.fsync(dir_fd)
    return state_dir / name


def on_signal(signum: int, _frame: object) -> None:
    global _interrupted
    _interrupted = signum


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkout", required=True)
    parser.add_argument(
        "--route",
        choices={"cursor", "other-models", "other-models-reserve"},
        default="cursor",
    )
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

    try:
        checkout = Path(args.checkout).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        print("[delegate-cursor] workspace path could not be resolved", file=sys.stderr)
        return 2
    if not checkout.is_dir():
        print("[delegate-cursor] workspace is not a directory", file=sys.stderr)
        return 2
    key = hashlib.sha256(os.fsencode(checkout)).hexdigest()
    state_root_value = os.environ.get("XDG_STATE_HOME")
    if state_root_value is not None and not os.path.isabs(state_root_value):
        print(
            "[delegate-cursor] secure lock storage is unavailable; Cursor was not started",
            file=sys.stderr,
        )
        return 5
    state_root = (
        Path(state_root_value) if state_root_value else Path.home() / ".local/state"
    )
    state_dir = state_root / "receipt-manager" / "delegate-cursor"
    try:
        state_dir_fd = _open_state_directory(state_dir)
    except OSError:
        print(
            "[delegate-cursor] secure lock storage is unavailable; Cursor was not started",
            file=sys.stderr,
        )
        return 5
    status_name = f"{key}.json"
    status_path = state_dir / status_name
    lock_name = f"{key}.lock"
    try:
        lock = acquire_file_lock(state_dir_fd, lock_name, nonblocking=True)
    except BlockingIOError:
        os.close(state_dir_fd)
        print(
            "[delegate-cursor] worker already active for this workspace; refusing duplicate run",
            file=sys.stderr,
        )
        return 4
    except OSError:
        os.close(state_dir_fd)
        print(
            "[delegate-cursor] workspace lock could not be acquired; Cursor was not started",
            file=sys.stderr,
        )
        return 5
    try:
        prune_diagnostics_safely(state_dir_fd, required=True)
    except OSError:
        os.close(lock)
        os.close(state_dir_fd)
        print(
            "[delegate-cursor] secure diagnostic storage is unavailable; Cursor was not started",
            file=sys.stderr,
        )
        return 5

    started_at = utc_now()
    started_mono = time.monotonic()
    last_event_at = started_at
    last_event_mono = started_mono
    last_event_type = "none"
    last_event_subtype: str | None = None
    session_id: str | None = None
    result_status: str | None = None
    result_is_error: bool | None = None
    worker_result_text: str | None = None
    worker_result_truncated = False
    active_call_ids: set[str] = set()
    anonymous_active = 0
    active_tool_count = 0
    last_operation_category: str | None = None
    last_operation_status: str | None = None
    last_operation_at: str | None = None
    assistant_update_count = 0
    assistant_updates_reported = 0
    stderr_bytes = 0
    stderr_diagnostics = StderrDiagnostics()
    stderr_diagnostic_log: Path | None = None
    malformed_lines = 0
    interrupted_signal: int | None = None
    pid: int | None = None
    exit_code: int | None = None
    outcome = "running"

    data: dict[str, object] = {
        "started_at": started_at,
        "pid": None,
        "route": args.route,
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
        "active_tool_count": 0,
        "last_operation_category": None,
        "last_operation_status": None,
        "last_operation_at": None,
        "assistant_update_count": 0,
        "outcome": outcome,
        "stderr_bytes_read": 0,
        "stderr_error_events": [],
        "stderr_diagnostic_log": None,
        "unparsed_line_count": 0,
    }

    status_warning_emitted = False
    progress = ProgressOutput()
    status_snapshot = StatusSnapshot(
        data, lambda current: set_status(state_dir_fd, status_name, current)
    )

    def update(**changes: object) -> None:
        status_snapshot.update(**changes)

    def persist_status(*, required: bool = False) -> bool:
        nonlocal status_warning_emitted
        try:
            status_snapshot.persist()
            return True
        except OSError:
            if required:
                raise
            if pid is not None and not status_warning_emitted:
                progress.emit(
                    "[delegate-cursor] status storage became unavailable; continuing worker monitoring",
                    important=True,
                )
                status_warning_emitted = True
            return False

    def current_active() -> int:
        return len(active_call_ids) + anonymous_active

    def note_tool_start(call_id: str | None) -> None:
        nonlocal anonymous_active
        if call_id is not None:
            if len(active_call_ids) < _MAX_TRACKED_CALLS or call_id in active_call_ids:
                active_call_ids.add(call_id)
            return
        anonymous_active += 1

    def note_tool_finish(call_id: str | None) -> None:
        nonlocal anonymous_active
        if call_id is not None:
            active_call_ids.discard(call_id)
            return
        if anonymous_active > 0:
            anonymous_active -= 1

    def flush_assistant_summary() -> None:
        nonlocal assistant_updates_reported
        if assistant_update_count == assistant_updates_reported:
            return
        progress.emit(f"[delegate-cursor] assistant_updates: {assistant_update_count}")
        assistant_updates_reported = assistant_update_count

    def process_stdout_line(raw_line: bytes) -> None:
        nonlocal malformed_lines, last_event_type, last_event_subtype
        nonlocal last_event_at, last_event_mono, session_id, result_status
        nonlocal result_is_error, worker_result_text, worker_result_truncated
        nonlocal active_tool_count, last_operation_category
        nonlocal last_operation_status, last_operation_at, assistant_update_count
        try:
            event = json.loads(raw_line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            malformed_lines += 1
            event = None
        last_event_type, last_event_subtype = safe_event_name(event)
        last_event_at = utc_now()
        last_event_mono = time.monotonic()
        quiet = _is_coalesced_event(event, last_event_subtype)
        phase = None if quiet else tool_phase(event, last_event_subtype)
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
                    result_status = (
                        raw_status if raw_status in {"success", "error"} else "other"
                    )
                elif isinstance(event.get("is_error"), bool):
                    result_status = "error" if event["is_error"] else "completed"
                raw_is_error = event.get("is_error")
                result_is_error = (
                    raw_is_error if isinstance(raw_is_error, bool) else None
                )
                worker_result_text, worker_result_truncated = capture_result_text(
                    event.get("result")
                )
            if phase is not None:
                if phase == TOOL_PHASE_STARTED:
                    note_tool_start(extract_call_id(event))
                else:
                    note_tool_finish(extract_call_id(event))
                active_tool_count = current_active()
                last_operation_category = tool_category(event)
                last_operation_status = phase
                last_operation_at = last_event_at
        if quiet:
            assistant_update_count += 1
        update(
            session_id=session_id,
            last_event_type=last_event_type,
            last_event_subtype=last_event_subtype,
            last_event_at=last_event_at,
            last_event_idle_seconds=0,
            result_status=result_status,
            result_is_error=result_is_error,
            active_tool_count=active_tool_count,
            last_operation_category=last_operation_category,
            last_operation_status=last_operation_status,
            last_operation_at=last_operation_at,
            assistant_update_count=assistant_update_count,
            stderr_bytes_read=stderr_bytes,
            unparsed_line_count=malformed_lines,
        )
        if phase is not None:
            flush_assistant_summary()
            progress.emit(
                f"[delegate-cursor] tool: {last_operation_category} {phase} at {last_event_at} active={active_tool_count}"
            )
        elif not quiet:
            if last_event_type in {"system", "result"}:
                flush_assistant_summary()
            progress.emit(
                f"[delegate-cursor] event: {last_event_type}"
                f"{('/' + last_event_subtype) if last_event_subtype else ''} at {last_event_at}"
            )

    old_handlers = {
        sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        update()
        persist_status(required=True)
    except OSError:
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        os.close(lock)
        os.close(state_dir_fd)
        print(
            "[delegate-cursor] secure status storage is unavailable; Cursor was not started",
            file=sys.stderr,
        )
        return 5
    progress.emit(f"[delegate-cursor] started_at: {started_at}", important=True)
    progress.emit(f"[delegate-cursor] route: {args.route}", important=True)
    progress.emit(
        f"[delegate-cursor] tier/model: {args.tier}/{args.model}", important=True
    )
    progress.emit(f"[delegate-cursor] status: {status_path}", important=True)

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
            persist_status()
            progress.emit(
                "[delegate-cursor] Cursor process could not be started (details suppressed)",
                important=True,
            )
            return 127
        pid = child.pid
        update(pid=pid)
        persist_status()
        progress.emit(f"[delegate-cursor] pid: {pid}", important=True)

        assert child.stdout is not None and child.stderr is not None
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ, "stdout")
        selector.register(child.stderr, selectors.EVENT_READ, "stderr")
        stdout_lines = BoundedStdoutLines()
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
                persist_status()
                progress.emit(
                    f"[delegate-cursor] interruption requested (signal {interrupted_signal}); waiting for worker exit",
                    important=True,
                )

            for key_event, _ in selector.select(
                timeout=min(1.0, max(0.0, next_heartbeat - now))
            ):
                stream = key_event.fileobj
                chunk = os.read(stream.fileno(), 65536)
                if not chunk:
                    selector.unregister(stream)
                    stream.close()
                    continue
                if key_event.data == "stderr":
                    stderr_bytes += len(chunk)
                    added_errors = stderr_diagnostics.feed(chunk)
                    update(
                        stderr_bytes_read=stderr_bytes,
                        stderr_error_events=list(stderr_diagnostics.error_events),
                    )
                    for error in added_errors:
                        progress.emit(
                            f"[delegate-cursor] stderr_error: {error['category']} at {error['occurred_at']}",
                        )
                    continue
                for raw_line in stdout_lines.feed(chunk):
                    process_stdout_line(raw_line)

            now = time.monotonic()
            if now >= next_heartbeat and child.poll() is None:
                idle = int(now - last_event_mono)
                operation = last_operation_category or "なし"
                update(
                    last_event_idle_seconds=idle,
                    active_tool_count=active_tool_count,
                    last_operation_category=last_operation_category,
                    last_operation_status=last_operation_status,
                    last_operation_at=last_operation_at,
                    assistant_update_count=assistant_update_count,
                    stderr_bytes_read=stderr_bytes,
                    unparsed_line_count=malformed_lines,
                )
                persist_status()
                assistant_note = (
                    f"、assistant_updates={assistant_update_count}"
                    if assistant_update_count
                    else ""
                )
                progress.emit(
                    f"[delegate-cursor] 稼働中、最終操作: {operation}、{idle}秒無出力{assistant_note}（heartbeatはworkerの進捗を保証しません）",
                )
                next_heartbeat = now + args.heartbeat_seconds

            if child.poll() is not None and not selector.get_map():
                break
            if child.poll() is not None and selector.get_map():
                continue

        for raw_line in stdout_lines.finish():
            process_stdout_line(raw_line)
        exit_code = child.wait()
        for error in stderr_diagnostics.finish():
            progress.emit(
                f"[delegate-cursor] stderr_error: {error['category']} at {error['occurred_at']}",
            )
        if interrupted_signal is not None:
            outcome = "interrupted"
        elif exit_code != 0:
            outcome = "failed"
        elif result_status == "success" and result_is_error is not True:
            outcome = "succeeded"
        else:
            outcome = "failed"
        if outcome in {"failed", "interrupted"}:
            stderr_diagnostic_log = save_failure_diagnostics(
                state_dir_fd, state_dir, pid, stderr_diagnostics
            )
        update(
            process_exit_code=exit_code,
            result_status=result_status,
            result_is_error=result_is_error,
            active_tool_count=active_tool_count,
            last_operation_category=last_operation_category,
            last_operation_status=last_operation_status,
            last_operation_at=last_operation_at,
            assistant_update_count=assistant_update_count,
            outcome=outcome,
            last_event_idle_seconds=int(time.monotonic() - last_event_mono),
            stderr_bytes_read=stderr_bytes,
            stderr_error_events=list(stderr_diagnostics.error_events),
            stderr_diagnostic_log=str(stderr_diagnostic_log)
            if stderr_diagnostic_log
            else None,
            unparsed_line_count=malformed_lines,
        )
        persist_status()
        flush_assistant_summary()
        progress.emit(f"[delegate-cursor] exit_code: {exit_code}", important=True)
        progress.emit(
            f"[delegate-cursor] result_status: {result_status or 'missing'}",
            important=True,
        )
        progress.emit(f"[delegate-cursor] outcome: {outcome}", important=True)
        progress.emit(
            f"[delegate-cursor] stderr bytes read: {stderr_bytes}", important=True
        )
        if stdout_lines.oversized_lines:
            progress.emit(
                f"[delegate-cursor] oversized_stream_lines: {stdout_lines.oversized_lines}",
                important=True,
            )
        if stderr_diagnostic_log:
            progress.emit(
                f"[delegate-cursor] sanitized stderr diagnostics: {stderr_diagnostic_log}",
                important=True,
            )
        emit_worker_report(worker_result_text, input_truncated=worker_result_truncated)
        progress.report_suppressed()
        return (
            (128 + interrupted_signal)
            if interrupted_signal is not None
            else (0 if outcome == "succeeded" else (exit_code or 1))
        )
    finally:
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        os.close(lock)
        os.close(state_dir_fd)


if __name__ == "__main__":
    raise SystemExit(main())
