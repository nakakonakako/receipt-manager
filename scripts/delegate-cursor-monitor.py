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
from datetime import datetime, timezone


HEARTBEAT_SECONDS = 30
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
_TOOL_SHAPE_PRIORITY = tuple(_TOOL_CATEGORY_BY_SHAPE)
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


def set_status(path: Path, data: dict[str, object]) -> None:
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(data, handle, ensure_ascii=True, separators=(",", ":"))
        handle.write("\n")
    temporary.replace(path)


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
        line for label in ("FAIL", "UNCONFIRMED", "PASS") for line in findings[label]
    ]
    context.sort(key=lambda line: not line.startswith("unscoped"))
    return coverage_status, prioritized, context


def _report_body(text: str, *, input_truncated: bool) -> list[str]:
    coverage, findings, context = _verification_report(text, input_truncated)
    sections = _extract_report_sections(text)
    if sections is None:
        body = [f"{_REPORT_PREFIX}verification_coverage: {coverage}"]
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
    body = [f"{_REPORT_PREFIX}verification_coverage: {coverage}"]
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


def emit_worker_report(text: str | None, *, input_truncated: bool) -> None:
    """Print a bounded completion report. The text is not retained elsewhere."""
    sanitized = _sanitize_report_text(text) if text else ""
    if not sanitized.strip():
        parts = [
            _REPORT_BEGIN,
            f"{_REPORT_PREFIX}verification_coverage: UNCONFIRMED",
            f"{_REPORT_PREFIX}{_REPORT_MISSING_VERIFICATION.removeprefix('[delegate-cursor] ')}",
            _REPORT_OMITTED,
        ]
        if input_truncated:
            parts.append(_REPORT_TRUNCATED)
        parts.append(_REPORT_END)
    else:
        parts = _fit_report_lines(
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


def prune_diagnostic_logs(state_dir: Path, preserve: Path | None = None) -> None:
    now = time.time()
    logs = sorted(
        (path for path in state_dir.glob("cursor-stderr-*.log") if path != preserve),
        key=lambda path: _log_mtime(path),
        reverse=True,
    )
    max_files = MAX_DIAGNOSTIC_FILES - 1 if preserve else MAX_DIAGNOSTIC_FILES
    for index, path in enumerate(logs):
        try:
            if (
                now - path.stat().st_mtime > MAX_DIAGNOSTIC_AGE_SECONDS
                or index >= max_files
            ):
                path.unlink(missing_ok=True)
        except OSError:
            continue


def ensure_private_state_directory(path: Path) -> None:
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    if not getattr(os, "O_DIRECTORY", 0) or not getattr(os, "O_NOFOLLOW", 0):
        raise OSError("safe state directory flags are unavailable")
    descriptor = os.open(path, flags)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise OSError("unsafe state directory owner or type")
        os.fchmod(descriptor, 0o700)
    finally:
        os.close(descriptor)


def open_lock_file(path: Path):
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    if not getattr(os, "O_NOFOLLOW", 0):
        raise OSError("safe lock file flags are unavailable")
    flags |= getattr(os, "O_CLOEXEC", 0)
    descriptor = os.open(path, flags, 0o600)
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
        ):
            raise OSError("unsafe lock file owner or type")
        os.fchmod(descriptor, 0o600)
        return os.fdopen(descriptor, "r+")
    except Exception:
        os.close(descriptor)
        raise


def acquire_file_lock(path: Path, *, nonblocking: bool):
    handle = open_lock_file(path)
    operation = fcntl.LOCK_EX | (fcntl.LOCK_NB if nonblocking else 0)
    try:
        fcntl.flock(handle.fileno(), operation)
    except Exception:
        handle.close()
        raise
    return handle


def prune_diagnostics_safely(state_dir: Path) -> None:
    try:
        lock = acquire_file_lock(state_dir / "diagnostics.lock", nonblocking=False)
    except OSError:
        return
    try:
        prune_diagnostic_logs(state_dir)
    finally:
        lock.close()


def _log_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0


def save_failure_diagnostics(
    state_dir: Path, pid: int, diagnostics: StderrDiagnostics
) -> Path | None:
    if not diagnostics.excerpts:
        return None
    try:
        lock = acquire_file_lock(state_dir / "diagnostics.lock", nonblocking=False)
    except OSError:
        return None
    try:
        return _save_failure_diagnostics_locked(state_dir, pid, diagnostics)
    finally:
        lock.close()


def _save_failure_diagnostics_locked(
    state_dir: Path, pid: int, diagnostics: StderrDiagnostics
) -> Path | None:
    prune_diagnostic_logs(state_dir)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = state_dir / f"cursor-stderr-{timestamp}-{pid}.log"
    content = "\n".join(diagnostics.excerpts).encode("utf-8")[:MAX_DIAGNOSTIC_BYTES]
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
    except OSError:
        return None
    prune_diagnostic_logs(state_dir, preserve=path)
    return path


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

    try:
        checkout = Path(args.checkout).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        print("[delegate-cursor] workspace path could not be resolved", file=sys.stderr)
        return 2
    if not checkout.is_dir():
        print("[delegate-cursor] workspace is not a directory", file=sys.stderr)
        return 2
    key = hashlib.sha256(os.fsencode(checkout)).hexdigest()
    state_root = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state"))
    state_dir = state_root / "receipt-manager" / "delegate-cursor"
    try:
        ensure_private_state_directory(state_dir)
    except OSError:
        print(
            "[delegate-cursor] secure lock storage is unavailable; Cursor was not started",
            file=sys.stderr,
        )
        return 5
    status_path = state_dir / f"{key}.json"
    lock_path = state_dir / f"{key}.lock"
    try:
        lock = acquire_file_lock(lock_path, nonblocking=True)
    except BlockingIOError:
        print(
            "[delegate-cursor] worker already active for this workspace; refusing duplicate run",
            file=sys.stderr,
        )
        return 4
    except OSError:
        print(
            "[delegate-cursor] workspace lock could not be acquired; Cursor was not started",
            file=sys.stderr,
        )
        return 5
    prune_diagnostics_safely(state_dir)

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

    def update(**changes: object) -> None:
        data.update(changes)
        set_status(status_path, data)

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
        print(
            f"[delegate-cursor] assistant_updates: {assistant_update_count}", flush=True
        )
        assistant_updates_reported = assistant_update_count

    update()
    print(f"[delegate-cursor] started_at: {started_at}", flush=True)
    print(f"[delegate-cursor] tier/model: {args.tier}/{args.model}", flush=True)
    print(f"[delegate-cursor] status: {status_path}", flush=True)

    old_handlers = {
        sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)
    }
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
            print(
                "[delegate-cursor] Cursor process could not be started (details suppressed)",
                flush=True,
            )
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
                print(
                    f"[delegate-cursor] interruption requested (signal {interrupted_signal}); waiting for worker exit",
                    flush=True,
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
                        print(
                            f"[delegate-cursor] stderr_error: {error['category']} at {error['occurred_at']}",
                            flush=True,
                        )
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
                    quiet = _is_coalesced_event(event, last_event_subtype)
                    phase = None if quiet else tool_phase(event, last_event_subtype)
                    if isinstance(event, dict):
                        if (
                            event.get("type") == "system"
                            and event.get("subtype") == "init"
                        ):
                            raw_session_id = event.get("session_id")
                            if isinstance(raw_session_id, str) and re.fullmatch(
                                r"[A-Za-z0-9_-]{1,200}", raw_session_id
                            ):
                                session_id = raw_session_id
                        if event.get("type") == "result":
                            raw_status = event.get("subtype")
                            if isinstance(raw_status, str):
                                result_status = (
                                    raw_status
                                    if raw_status in {"success", "error"}
                                    else "other"
                                )
                            elif isinstance(event.get("is_error"), bool):
                                result_status = (
                                    "error" if event["is_error"] else "completed"
                                )
                            raw_is_error = event.get("is_error")
                            result_is_error = (
                                raw_is_error if isinstance(raw_is_error, bool) else None
                            )
                            worker_result_text, worker_result_truncated = (
                                capture_result_text(event.get("result"))
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
                        print(
                            f"[delegate-cursor] tool: {last_operation_category} {phase} at {last_event_at} active={active_tool_count}",
                            flush=True,
                        )
                    elif not quiet:
                        if last_event_type in {"system", "result"}:
                            flush_assistant_summary()
                        print(
                            f"[delegate-cursor] event: {last_event_type}"
                            f"{('/' + last_event_subtype) if last_event_subtype else ''} at {last_event_at}",
                            flush=True,
                        )

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
                assistant_note = (
                    f"、assistant_updates={assistant_update_count}"
                    if assistant_update_count
                    else ""
                )
                print(
                    f"[delegate-cursor] 稼働中、最終操作: {operation}、{idle}秒無出力{assistant_note}（heartbeatはworkerの進捗を保証しません）",
                    flush=True,
                )
                next_heartbeat = now + args.heartbeat_seconds

            if child.poll() is not None and not selector.get_map():
                break
            if child.poll() is not None and selector.get_map():
                continue

        if stdout_buffer.strip():
            malformed_lines += 1
        exit_code = child.wait()
        for error in stderr_diagnostics.finish():
            print(
                f"[delegate-cursor] stderr_error: {error['category']} at {error['occurred_at']}",
                flush=True,
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
                state_dir, pid, stderr_diagnostics
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
        flush_assistant_summary()
        print(f"[delegate-cursor] exit_code: {exit_code}", flush=True)
        print(
            f"[delegate-cursor] result_status: {result_status or 'missing'}", flush=True
        )
        print(f"[delegate-cursor] outcome: {outcome}", flush=True)
        print(f"[delegate-cursor] stderr bytes read: {stderr_bytes}", flush=True)
        if stderr_diagnostic_log:
            print(
                f"[delegate-cursor] sanitized stderr diagnostics: {stderr_diagnostic_log}",
                flush=True,
            )
        emit_worker_report(worker_result_text, input_truncated=worker_result_truncated)
        return (
            (128 + interrupted_signal)
            if interrupted_signal is not None
            else (0 if outcome == "succeeded" else (exit_code or 1))
        )
    finally:
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
