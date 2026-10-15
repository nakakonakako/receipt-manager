from __future__ import annotations

import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest


REPO_ROOT = Path(__file__).resolve().parents[2]
MONITOR = REPO_ROOT / "scripts" / "delegate-cursor-monitor.py"


class DelegateCursorMonitorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.checkout = self.root / "checkout"
        self.checkout.mkdir()
        self.state_home = self.root / "state"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def fake_agent(self, source: str) -> Path:
        path = self.root / "fake-agent.py"
        path.write_text(source, encoding="utf-8")
        return path

    def command(self, agent: Path, *extra: str) -> list[str]:
        return [
            sys.executable,
            str(MONITOR),
            "--checkout",
            str(self.checkout),
            "--tier",
            "light",
            "--model",
            "composer-2.5",
            *extra,
            "--",
            sys.executable,
            str(agent),
        ]

    def run_agent(self, agent: Path, *extra: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["XDG_STATE_HOME"] = str(self.state_home)
        return subprocess.run(
            self.command(agent, *extra),
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )

    def status(self) -> dict[str, object]:
        statuses = list(
            (self.state_home / "receipt-manager/delegate-cursor").glob("*.json")
        )
        self.assertEqual(len(statuses), 1)
        return json.loads(statuses[0].read_text(encoding="utf-8"))

    def test_success_keeps_only_minimal_metadata(self) -> None:
        agent = self.fake_agent(
            "import json,sys\n"
            "print(json.dumps({'type':'system','subtype':'init','session_id':'session-123','secret':'TOKEN_SENTINEL'}), flush=True)\n"
            "print(json.dumps({'type':'assistant','message':'PROMPT_SENTINEL THINKING_SENTINEL'}), flush=True)\n"
            "print(json.dumps({'type':'tool_call','arguments':'TOOL_ARG_SENTINEL','result':'TOOL_RESULT_SENTINEL'}), flush=True)\n"
            "print(json.dumps({'type':'result','subtype':'success','result':'RESULT_SENTINEL'}), flush=True)\n"
            "print('STDERR_SENTINEL', file=sys.stderr, flush=True)\n"
        )
        result = self.run_agent(agent)
        self.assertEqual(result.returncode, 0, result.stdout)
        status = self.status()
        self.assertEqual(status["outcome"], "succeeded")
        self.assertEqual(status["result_status"], "success")
        self.assertEqual(status["session_id"], "session-123")
        self.assertEqual(status["process_exit_code"], 0)
        combined = result.stdout + json.dumps(status)
        for sentinel in (
            "TOKEN_SENTINEL",
            "PROMPT_SENTINEL",
            "THINKING_SENTINEL",
            "TOOL_ARG_SENTINEL",
            "TOOL_RESULT_SENTINEL",
            "RESULT_SENTINEL",
            "STDERR_SENTINEL",
        ):
            self.assertNotIn(sentinel, combined)
        self.assertGreater(status["stderr_bytes_read"], 0)
        self.assertIn("event: system/init", result.stdout)
        self.assertIn("event: result/success", result.stdout)
        self.assertNotIn("worker response", result.stdout)
        self.assertIn("worker_response_chars: 15", result.stdout)
        self.assertIsNone(status["stderr_diagnostic_log"])
        self.assertEqual(status["stderr_error_events"], [])
        self.assertEqual(
            list(
                (self.state_home / "receipt-manager/delegate-cursor").glob(
                    "cursor-stderr-*.log"
                )
            ),
            [],
        )

    def test_failure_classifies_and_scrubs_bounded_stderr_diagnostics(self) -> None:
        agent = self.fake_agent(
            "import sys\n"
            'print(\'resource_exhausted: {"api_key":"SECRET_API_KEY"}\', file=sys.stderr)\n'
            "[print('Error detail ' + 'x' * 800, file=sys.stderr) for _ in range(120)]\n"
            "print('Network connection error: ECONNRESET Authorization: Bearer SECRET_BEARER', file=sys.stderr)\n"
            "print('authentication failed token=SECRET_TOKEN', file=sys.stderr)\n"
            "print('Workspace Trust Required', file=sys.stderr)\n"
            "print('permission denied: /private/path', file=sys.stderr)\n"
            "print('MCP initialization error for https://example.test/?token=SECRET_QUERY', file=sys.stderr)\n"
            "print('worktree setup failed for checkout', file=sys.stderr)\n"
            "print('Unclassified diagnostic user@example.test credential=SECRET_UNKNOWN', file=sys.stderr)\n"
            "sys.stderr.flush()\n"
            "raise SystemExit(1)\n"
        )
        result = self.run_agent(agent)
        self.assertNotEqual(result.returncode, 0)
        status = self.status()
        expected_categories = {
            "resource_exhausted",
            "network_connection",
            "authentication",
            "permission_denied",
            "workspace_trust_required",
            "mcp_initialization",
            "worktree_setup",
        }
        observed = {event["category"] for event in status["stderr_error_events"]}
        self.assertTrue(expected_categories.issubset(observed), observed)
        self.assertEqual(
            sum(
                event["category"] == "workspace_trust_required"
                for event in status["stderr_error_events"]
            ),
            1,
        )
        self.assertEqual(
            sum(
                event["category"] == "permission_denied"
                for event in status["stderr_error_events"]
            ),
            1,
        )
        for event in status["stderr_error_events"]:
            self.assertTrue(event["occurred_at"])
        diagnostic_path = Path(status["stderr_diagnostic_log"])
        diagnostic = diagnostic_path.read_text(encoding="utf-8")
        self.assertIn("resource_exhausted", diagnostic)
        self.assertIn("Workspace Trust Required", diagnostic)
        self.assertIn("Unclassified diagnostic", diagnostic)
        for secret in (
            "SECRET_API_KEY",
            "SECRET_BEARER",
            "SECRET_TOKEN",
            "SECRET_QUERY",
            "SECRET_UNKNOWN",
            "user@example.test",
        ):
            self.assertNotIn(secret, result.stdout + json.dumps(status) + diagnostic)
        self.assertLessEqual(diagnostic_path.stat().st_size, 8192)
        self.assertLessEqual(len(diagnostic.splitlines()), 12)
        self.assertEqual(stat.S_IMODE(diagnostic_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(diagnostic_path.parent.stat().st_mode), 0o700)
        self.assertIn(str(diagnostic_path), result.stdout)

    def test_old_diagnostic_logs_are_pruned_on_next_run(self) -> None:
        log_dir = self.state_home / "receipt-manager/delegate-cursor"
        log_dir.mkdir(parents=True)
        old_log = log_dir / "cursor-stderr-expired.log"
        old_log.write_text("old diagnostic", encoding="utf-8")
        expired_at = time.time() - 8 * 24 * 60 * 60
        os.utime(old_log, (expired_at, expired_at))
        for index in range(21):
            recent_log = log_dir / f"cursor-stderr-recent-{index}.log"
            recent_log.write_text("bounded diagnostic", encoding="utf-8")
            recent_at = time.time() - (21 - index) * 60
            os.utime(recent_log, (recent_at, recent_at))
        agent = self.fake_agent(
            "import json\n"
            "print(json.dumps({'type':'result','subtype':'success'}), flush=True)\n"
        )
        result = self.run_agent(agent)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertFalse(old_log.exists())
        retained_logs = list(log_dir.glob("cursor-stderr-*.log"))
        self.assertLessEqual(len(retained_logs), 20)

    def test_missing_or_error_result_is_not_success(self) -> None:
        for source, expected_status in (
            ('print(\'\\"type\\":\\"assistant\\"\')\n', None),
            (
                "import json\n"
                "print(json.dumps({'type':'result','subtype':'error'}), flush=True)\n"
                "raise SystemExit(1)\n",
                "error",
            ),
        ):
            with self.subTest(expected_status=expected_status):
                agent = self.fake_agent(source)
                result = self.run_agent(agent)
                status = self.status()
                self.assertNotEqual(status["outcome"], "succeeded")
                self.assertEqual(status["result_status"], expected_status)
                if expected_status is None:
                    self.assertNotEqual(result.returncode, 0)

    def test_no_output_reports_heartbeat_without_termination(self) -> None:
        agent = self.fake_agent(
            "import json,time\n"
            "time.sleep(1.3)\n"
            "print(json.dumps({'type':'result','subtype':'success'}), flush=True)\n"
        )
        result = self.run_agent(agent, "--heartbeat-seconds", "1")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("稼働中、最終操作: なし、", result.stdout)
        self.assertIn("秒無出力", result.stdout)
        self.assertIn("heartbeatはworkerの進捗を保証しません", result.stdout)
        self.assertNotIn("thinking", result.stdout.lower())
        self.assertEqual(self.status()["outcome"], "succeeded")

    def test_interrupt_is_forwarded_and_recorded(self) -> None:
        agent = self.fake_agent("import time\ntime.sleep(20)\n")
        env = os.environ.copy()
        env["XDG_STATE_HOME"] = str(self.state_home)
        process = subprocess.Popen(
            self.command(agent),
            cwd=REPO_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if list(
                    (self.state_home / "receipt-manager/delegate-cursor").glob("*.json")
                ):
                    break
                time.sleep(0.05)
            process.send_signal(signal.SIGINT)
            stdout, _ = process.communicate(timeout=5)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
        self.assertEqual(process.returncode, 130, stdout)
        self.assertEqual(self.status()["outcome"], "interrupted")

    def test_duplicate_checkout_worker_is_rejected(self) -> None:
        agent = self.fake_agent(
            "import json,time\n"
            "print(json.dumps({'type':'result','subtype':'success'}), flush=True)\n"
            "time.sleep(1)\n"
        )
        env = os.environ.copy()
        env["XDG_STATE_HOME"] = str(self.state_home)
        first = subprocess.Popen(
            self.command(agent),
            cwd=REPO_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            text=True,
        )
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                status_files = list(
                    (self.state_home / "receipt-manager/delegate-cursor").glob("*.json")
                )
                if (
                    status_files
                    and json.loads(status_files[0].read_text())["pid"] is not None
                ):
                    break
                time.sleep(0.05)
            second = self.run_agent(agent)
            self.assertEqual(second.returncode, 4, second.stderr)
            self.assertIn("refusing duplicate run", second.stderr)
        finally:
            first.communicate(timeout=5)
        self.assertEqual(self.status()["outcome"], "succeeded")

    def test_delegate_script_uses_stream_json_and_preserves_trust(self) -> None:
        captured_args = self.root / "captured-args.json"
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        fake_agent = bin_dir / "agent"
        fake_agent.write_text(
            "#!/usr/bin/env python3\n"
            "import json,os,sys\n"
            "from pathlib import Path\n"
            "Path(os.environ['CAPTURED_ARGS']).write_text(json.dumps(sys.argv[1:]))\n"
            "print(json.dumps({'type':'result','subtype':'success'}), flush=True)\n",
            encoding="utf-8",
        )
        fake_agent.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}:{env['PATH']}"
        env["XDG_STATE_HOME"] = str(self.state_home)
        env["CAPTURED_ARGS"] = str(captured_args)
        result = subprocess.run(
            [
                str(REPO_ROOT / "scripts/delegate-cursor.sh"),
                "--tier",
                "light",
                "--allow-dirty",
                "--trust",
                "--prompt",
                "PROMPT_SENTINEL",
            ],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        argv = json.loads(captured_args.read_text(encoding="utf-8"))
        self.assertIn("--trust", argv)
        self.assertIn("--output-format", argv)
        self.assertIn("stream-json", argv)
        self.assertNotIn("--stream-partial-output", argv)
        self.assertIn("composer-2.5", argv)
        self.assertNotIn("PROMPT_SENTINEL", result.stdout + result.stderr)

    def test_delegate_script_defaults_to_trust_and_no_trust_disables_it(self) -> None:
        captured_args = self.root / "captured-args.json"
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        fake_agent = bin_dir / "agent"
        fake_agent.write_text(
            "#!/usr/bin/env python3\n"
            "import json,os,sys\n"
            "from pathlib import Path\n"
            "Path(os.environ['CAPTURED_ARGS']).write_text(json.dumps(sys.argv[1:]))\n"
            "print(json.dumps({'type':'result','subtype':'success'}), flush=True)\n",
            encoding="utf-8",
        )
        fake_agent.chmod(0o755)
        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}:{env['PATH']}"
        env["XDG_STATE_HOME"] = str(self.state_home)
        env["CAPTURED_ARGS"] = str(captured_args)

        for trust_option, should_trust in ((None, True), ("--no-trust", False)):
            with self.subTest(trust_option=trust_option):
                args = [
                    str(REPO_ROOT / "scripts/delegate-cursor.sh"),
                    "--tier",
                    "light",
                    "--allow-dirty",
                ]
                if trust_option:
                    args.append(trust_option)
                args.extend(("--prompt", "PONG"))
                result = subprocess.run(
                    args,
                    cwd=REPO_ROOT,
                    env=env,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                argv = json.loads(captured_args.read_text(encoding="utf-8"))
                self.assertEqual("--trust" in argv, should_trust)
                self.assertIn("--output-format", argv)
                self.assertIn("stream-json", argv)
                self.assertNotIn("--stream-partial-output", argv)

    def test_tool_progress_reports_safe_categories_without_payloads(self) -> None:
        events = [
            {
                "type": "system",
                "subtype": "init",
                "session_id": "session-tools",
                "secret": "TOKEN_SENTINEL",
            },
            {
                "type": "assistant",
                "subtype": "delta",
                "text": "ASSISTANT_SENTINEL",
                "thinking": "THINKING_SENTINEL",
            },
            {
                "type": "assistant",
                "message": {"content": "ASSISTANT_SENTINEL"},
            },
            {"type": "thinking", "text": "THINKING_SENTINEL"},
            {
                "type": "tool_call",
                "subtype": "delta",
                "tool_call": {
                    "shellToolCall": {"args": {"command": "SHELL_TEXT_SENTINEL"}}
                },
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "CALL_ID_SENTINEL",
                "tool_call": {
                    "readToolCall": {
                        "args": {
                            "path": "/secret/PATH_SENTINEL",
                            "name": "TOOL_NAME_SENTINEL",
                        }
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "call-shell",
                "tool_call": {
                    "shellToolCall": {
                        "args": {"command": "echo SHELL_TEXT_SENTINEL"},
                        "name": "TOOL_NAME_SENTINEL",
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "call_id": "CALL_ID_SENTINEL",
                "tool_call": {
                    "readToolCall": {
                        "result": {
                            "success": {
                                "content": "FILE_CONTENT_SENTINEL TOOL_RESULT_SENTINEL"
                            }
                        }
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "call_id": "call-shell",
                "tool_call": {
                    "shellToolCall": {
                        "result": {"error": {"message": "ERROR_VALUE_SENTINEL"}}
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "call-edit",
                "tool_call": {"editToolCall": {"args": {"path": "PATH_SENTINEL"}}},
            },
            {
                "type": "tool_call",
                "subtype": "failed",
                "call_id": "call-edit",
                "tool_call": {"editToolCall": {"error": "ERROR_VALUE_SENTINEL"}},
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "call-write",
                "tool_call": {"writeToolCall": {"args": {"path": "PATH_SENTINEL"}}},
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "call_id": "call-write",
                "tool_call": {
                    "writeToolCall": {
                        "result": {"success": {"content": "FILE_CONTENT_SENTINEL"}}
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "call-delete",
                "tool_call": {"delete_tool_call": {"args": {"path": "PATH_SENTINEL"}}},
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "call_id": "call-delete",
                "tool_call": {
                    "delete_tool_call": {"failure": {"detail": "ERROR_VALUE_SENTINEL"}}
                },
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "call-mcp",
                "tool_call": {
                    "mcpToolCall": {
                        "args": {
                            "name": "TOOL_NAME_SENTINEL",
                            "payload": "TOOL_ARG_SENTINEL",
                        }
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "error",
                "call_id": "call-mcp",
                "tool_call": {"mcpToolCall": {"failure": "ERROR_VALUE_SENTINEL"}},
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "call-other",
                "tool_call": {
                    "TOOL_NAME_SENTINEL": {"args": {"path": "PATH_SENTINEL"}}
                },
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "call_id": "call-other",
                "tool_call": {"TOOL_NAME_SENTINEL": {"result": "TOOL_RESULT_SENTINEL"}},
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "tool_call": {"read_tool_call": {"args": {"path": "PATH_SENTINEL"}}},
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "tool_call": {"edit_tool_call": {"args": {"path": "PATH_SENTINEL"}}},
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "tool_call": {"read_tool_call": {"result": {"success": True}}},
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "tool_call": {"edit_tool_call": {"result": {"success": True}}},
            },
            {"type": "tool_call", "subtype": "completed", "tool_call": None},
            {"type": "tool_call", "subtype": "started"},
            {"type": "tool_call", "subtype": "completed"},
            {
                "type": "tool_call",
                "subtype": "not-a-real-phase",
                "tool_call": {"readToolCall": {"args": {"path": "PATH_SENTINEL"}}},
            },
            {
                "type": "result",
                "subtype": "success",
                "result": "RESULT_SENTINEL",
            },
        ]
        agent = self.fake_agent(
            "import json\n"
            f"events = {events!r}\n"
            "for event in events:\n"
            "    print(json.dumps(event), flush=True)\n"
        )
        result = self.run_agent(agent)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        status = self.status()
        combined = (
            result.stdout + result.stderr + json.dumps(status, ensure_ascii=False)
        )
        for sentinel in (
            "TOKEN_SENTINEL",
            "ASSISTANT_SENTINEL",
            "THINKING_SENTINEL",
            "TOOL_ARG_SENTINEL",
            "TOOL_RESULT_SENTINEL",
            "TOOL_NAME_SENTINEL",
            "PATH_SENTINEL",
            "SHELL_TEXT_SENTINEL",
            "ERROR_VALUE_SENTINEL",
            "CALL_ID_SENTINEL",
            "FILE_CONTENT_SENTINEL",
            "RESULT_SENTINEL",
            "call-shell",
            "call-edit",
            "call-write",
            "call-delete",
            "call-mcp",
            "call-other",
        ):
            self.assertNotIn(sentinel, combined)
        for raw_shape in (
            "readToolCall",
            "read_tool_call",
            "shellToolCall",
            "editToolCall",
            "edit_tool_call",
            "writeToolCall",
            "delete_tool_call",
            "mcpToolCall",
        ):
            self.assertNotIn(raw_shape, combined)
        self.assertNotIn("event: assistant", result.stdout)
        self.assertNotIn("event: thinking", result.stdout)
        self.assertEqual(result.stdout.count("assistant_updates:"), 1)
        self.assertIn("[delegate-cursor] assistant_updates: 4", result.stdout)
        self.assertEqual(status["assistant_update_count"], 4)
        self.assertEqual(status["session_id"], "session-tools")
        self.assertEqual(status["active_tool_count"], 0)
        self.assertEqual(status["last_operation_category"], "その他")
        self.assertEqual(status["last_operation_status"], "completed")
        self.assertNotIn("worker response", result.stdout)
        self.assertIn("worker_response_chars: 15", result.stdout)

        pattern = re.compile(
            r"^\[delegate-cursor\] tool: (?P<category>.+?) "
            r"(?P<phase>started|completed|failed) at "
            r"(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00) "
            r"active=(?P<active>\d+)$"
        )
        parsed: list[tuple[str, str, int, str]] = []
        for line in result.stdout.splitlines():
            match = pattern.fullmatch(line)
            if match:
                parsed.append(
                    (
                        match.group("category"),
                        match.group("phase"),
                        int(match.group("active")),
                        match.group("ts"),
                    )
                )
        expected = [
            ("ファイル読み取り", "started", 1),
            ("Shellコマンド", "started", 2),
            ("ファイル読み取り", "completed", 1),
            ("Shellコマンド", "failed", 0),
            ("ファイル作成・編集", "started", 1),
            ("ファイル作成・編集", "failed", 0),
            ("ファイル作成・編集", "started", 1),
            ("ファイル作成・編集", "completed", 0),
            ("ファイル作成・編集", "started", 1),
            ("ファイル作成・編集", "failed", 0),
            ("MCPツール", "started", 1),
            ("MCPツール", "failed", 0),
            ("その他", "started", 1),
            ("その他", "completed", 0),
            ("ファイル読み取り", "started", 1),
            ("ファイル作成・編集", "started", 2),
            ("ファイル読み取り", "completed", 1),
            ("ファイル作成・編集", "completed", 0),
            ("その他", "completed", 0),
            ("その他", "started", 1),
            ("その他", "completed", 0),
        ]
        self.assertEqual([(item[0], item[1], item[2]) for item in parsed], expected)
        self.assertEqual(status["last_operation_at"], parsed[-1][3])
        self.assertNotIn("call_id", json.dumps(status))

    def test_bash_tool_call_shape_is_shell_command_without_payload(self) -> None:
        events = [
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "BASH_CALL_ID_SENTINEL",
                "tool_call": {
                    "bashToolCall": {
                        "args": {
                            "command": "echo BASH_COMMAND_SENTINEL",
                            "name": "BASH_TOOL_NAME_SENTINEL",
                        }
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "call_id": "BASH_CALL_ID_SENTINEL",
                "tool_call": {
                    "bashToolCall": {
                        "result": {"success": {"stdout": "BASH_RESULT_SENTINEL"}}
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "started",
                "call_id": "BASH_CALL_ID_SENTINEL",
                "tool_call": {
                    "bash_tool_call": {
                        "args": {
                            "command": "echo BASH_COMMAND_SENTINEL",
                            "name": "BASH_TOOL_NAME_SENTINEL",
                        }
                    }
                },
            },
            {
                "type": "tool_call",
                "subtype": "completed",
                "call_id": "BASH_CALL_ID_SENTINEL",
                "tool_call": {
                    "bash_tool_call": {
                        "result": {"success": {"stdout": "BASH_RESULT_SENTINEL"}}
                    }
                },
            },
            {
                "type": "result",
                "subtype": "success",
                "result": "BASH_RESULT_SENTINEL",
            },
        ]
        agent = self.fake_agent(
            "import json\n"
            f"events = {events!r}\n"
            "for event in events:\n"
            "    print(json.dumps(event), flush=True)\n"
        )
        result = self.run_agent(agent)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        status = self.status()
        combined = (
            result.stdout + result.stderr + json.dumps(status, ensure_ascii=False)
        )
        for sentinel in (
            "BASH_COMMAND_SENTINEL",
            "BASH_RESULT_SENTINEL",
            "BASH_TOOL_NAME_SENTINEL",
            "BASH_CALL_ID_SENTINEL",
            "bashToolCall",
            "bash_tool_call",
        ):
            self.assertNotIn(sentinel, combined)
        self.assertEqual(status["active_tool_count"], 0)
        self.assertEqual(status["last_operation_category"], "Shellコマンド")
        self.assertEqual(status["last_operation_status"], "completed")

        pattern = re.compile(
            r"^\[delegate-cursor\] tool: (?P<category>.+?) "
            r"(?P<phase>started|completed|failed) at "
            r"(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00) "
            r"active=(?P<active>\d+)$"
        )
        parsed: list[tuple[str, str, int, str]] = []
        for line in result.stdout.splitlines():
            match = pattern.fullmatch(line)
            if match:
                parsed.append(
                    (
                        match.group("category"),
                        match.group("phase"),
                        int(match.group("active")),
                        match.group("ts"),
                    )
                )
        self.assertEqual(
            [(item[0], item[1], item[2]) for item in parsed],
            [
                ("Shellコマンド", "started", 1),
                ("Shellコマンド", "completed", 0),
                ("Shellコマンド", "started", 1),
                ("Shellコマンド", "completed", 0),
            ],
        )
        self.assertEqual(status["last_operation_at"], parsed[-1][3])
        self.assertNotIn("call_id", json.dumps(status))


if __name__ == "__main__":
    unittest.main()
