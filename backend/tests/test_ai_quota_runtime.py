import asyncio
import logging
import os
import tempfile
import threading
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault("GEMINI_API_KEY", "test-only-placeholder")

from fastapi.testclient import TestClient
from PIL import Image
from io import BytesIO

from app import main
from app.services.ai_quota_config import (
    CONFIG_KEYS,
    AiQuotaConfigError,
    AiQuotaDbConfig,
    load_ai_quota_config,
)
from app.services.ai_quota_db import (
    PERMITTED_RPCS,
    RPC_SQL,
    AiQuotaDatabase,
    connection_kwargs,
    silence_driver_logs,
)
from app.services.ai_quota_guard import (
    DETAIL_CONCURRENCY,
    DETAIL_DAILY,
    DETAIL_UNAVAILABLE,
    AiQuotaGuard,
)
from app.services.ai_usage import (
    GeminiInvalidOutput,
    ModelResult,
    TokenUsage,
    token_usage_from_metadata,
    token_usage_from_response,
)
from app.services.gemini_service import GeminiService
from tests.support_ai_quota import (
    TEST_USER_ID,
    GrantingQuotaDatabase,
    ensure_user_id,
    install_granting_quota,
)

SECRET_PASSWORD = "quota-password-must-not-leak"
SECRET_DSN = (
    "postgresql://ai_quota_backend.proj:"
    + SECRET_PASSWORD
    + "@db.example:5432/postgres"
)


def _jpeg_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (1, 1), "white").save(buffer, format="JPEG")
    return buffer.getvalue()


def _valid_environ(cert_path: str, **overrides: str) -> dict[str, str]:
    values = {
        "AI_QUOTA_DB_HOST": "aws-0-ap-northeast-1.pooler.supabase.com",
        "AI_QUOTA_DB_PORT": "5432",
        "AI_QUOTA_DB_NAME": "postgres",
        "AI_QUOTA_DB_USER": "ai_quota_backend.abcdefghijklmnopqrst",
        "AI_QUOTA_DB_PASSWORD": SECRET_PASSWORD,
        "AI_QUOTA_DB_SSLROOTCERT": cert_path,
    }
    values.update(overrides)
    return values


class _FakeCursor:
    def __init__(self, connection, row):
        self.connection = connection
        self.row = row
        self.executed = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def execute(self, query, params):
        self.executed = (query, params)
        self.connection.executed.append((query, params))

    async def fetchone(self):
        query = self.executed[0] if self.executed else ""
        if "finish_ai_request" in query:
            return {"outcome": "finished", "reject_reason": None}
        if "renew_ai_lease" in query:
            return {"outcome": "renewed", "reject_reason": None}
        return self.row


class _FakeConnection:
    def __init__(self, pool, row):
        self.pool = pool
        self.row = row
        self.executed = []

    async def __aenter__(self):
        self.pool.in_use += 1
        self.pool.max_in_use = max(self.pool.max_in_use, self.pool.in_use)
        return self

    async def __aexit__(self, *_args):
        self.pool.in_use -= 1
        return None

    def cursor(self, **_kwargs):
        return _FakeCursor(self, self.row)


class _FakePool:
    def __init__(self, row):
        self.row = row
        self.in_use = 0
        self.max_in_use = 0
        self.executed = []

    def connection(self, timeout=None):
        self.last_timeout = timeout
        return _FakeConnection(self, self.row)

    @property
    def cursor_executed(self):
        return self.executed


def _attach_executed(pool: _FakePool) -> None:
    original = pool.connection

    def connection(timeout=None):
        conn = original(timeout)

        class Proxy:
            async def __aenter__(self):
                self.conn = await conn.__aenter__()
                return self

            async def __aexit__(self, *args):
                return await conn.__aexit__(*args)

            def cursor(self, **kwargs):
                cursor = self.conn.cursor(**kwargs)

                class CursorProxy:
                    async def __aenter__(self):
                        self.cursor = await cursor.__aenter__()
                        return self

                    async def __aexit__(self, *args):
                        return await cursor.__aexit__(*args)

                    async def execute(self, query, params):
                        pool.executed.append((query, params))
                        return await self.cursor.execute(query, params)

                    async def fetchone(self):
                        return await self.cursor.fetchone()

                return CursorProxy()

        return Proxy()

    pool.connection = connection


class AiQuotaRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.app.dependency_overrides.clear()
        self.addCleanup(main.app.dependency_overrides.clear)
        self.quota = install_granting_quota(self)
        self.cert = tempfile.NamedTemporaryFile()
        self.cert.write(b"test-ca")
        self.cert.flush()
        self.addCleanup(self.cert.close)

    def allow_user(self, service=None):
        service = ensure_user_id(service or object())

        async def authenticated_service():
            return service

        main.app.dependency_overrides[main.get_supabase_service] = authenticated_service
        return service

    def test_config_requires_verify_full_and_dedicated_role(self):
        config = load_ai_quota_config(_valid_environ(self.cert.name))
        self.assertIsNotNone(config)
        kwargs = connection_kwargs(config)
        self.assertEqual(kwargs["sslmode"], "verify-full")
        self.assertEqual(kwargs["sslrootcert"], self.cert.name)
        self.assertEqual(kwargs["port"], 5432)
        self.assertEqual(kwargs["dbname"], "postgres")
        self.assertTrue(kwargs["user"].startswith("ai_quota_backend."))
        self.assertNotIn("service_role", kwargs["user"])
        self.assertNotIn("postgres", kwargs["user"])
        self.assertEqual(kwargs["connect_timeout"], 5)
        self.assertIn("statement_timeout=5000", kwargs["options"])
        self.assertNotIn(SECRET_PASSWORD, repr(config))
        self.assertNotIn(SECRET_DSN, repr(config))

    def test_missing_or_malformed_config_fails_closed_without_secrets(self):
        self.assertIsNone(load_ai_quota_config({}))
        with self.assertRaises(AiQuotaConfigError) as raised:
            load_ai_quota_config(
                _valid_environ(self.cert.name, AI_QUOTA_DB_PORT="6543")
            )
        self.assertNotIn(SECRET_PASSWORD, str(raised.exception))
        for overrides in (
            {"AI_QUOTA_DB_USER": "postgres.abcdefghijklmnopqrst"},
            {"AI_QUOTA_DB_USER": "service_role"},
            {"AI_QUOTA_DB_USER": "ai_quota_backend.service_role"},
            {"AI_QUOTA_DB_NAME": "template1"},
            {"AI_QUOTA_DB_HOST": "https://db.example"},
            {"AI_QUOTA_DB_SSLROOTCERT": self.cert.name + "-missing"},
            {"AI_QUOTA_DB_PASSWORD": ""},
        ):
            with self.assertRaises(AiQuotaConfigError):
                load_ai_quota_config(_valid_environ(self.cert.name, **overrides))
        self.assertEqual(
            set(CONFIG_KEYS),
            {
                "AI_QUOTA_DB_HOST",
                "AI_QUOTA_DB_PORT",
                "AI_QUOTA_DB_NAME",
                "AI_QUOTA_DB_USER",
                "AI_QUOTA_DB_PASSWORD",
                "AI_QUOTA_DB_SSLROOTCERT",
            },
        )

    def test_pool_uses_small_limits_and_does_not_embed_a_dsn(self):
        created = {}

        class Factory:
            def __init__(self, conninfo="", **kwargs):
                created["conninfo"] = conninfo
                created["kwargs"] = kwargs

            async def open(self):
                created["opened"] = True

            async def close(self):
                created["closed"] = True

        config = load_ai_quota_config(_valid_environ(self.cert.name))
        database = AiQuotaDatabase(config, pool_factory=Factory)
        asyncio.run(database.start())
        self.assertTrue(created["opened"])
        self.assertEqual(created["conninfo"], "")
        self.assertEqual(created["kwargs"]["kwargs"]["sslmode"], "verify-full")
        self.assertEqual(created["kwargs"]["min_size"], 0)
        self.assertEqual(created["kwargs"]["max_size"], 2)
        self.assertEqual(created["kwargs"]["timeout"], 5)
        self.assertNotIn(SECRET_PASSWORD, created["conninfo"])
        asyncio.run(database.close())
        self.assertTrue(created["closed"])
        self.assertFalse(database.available)

    def test_pool_open_failure_disables_ai_without_logging_the_exception(self):
        class Factory:
            def __init__(self, *_args, **_kwargs):
                raise RuntimeError(SECRET_DSN)

        config = load_ai_quota_config(_valid_environ(self.cert.name))
        database = AiQuotaDatabase(config, pool_factory=Factory)
        with patch("app.services.ai_quota_db.logger.error") as error_log:
            asyncio.run(database.start())
        self.assertFalse(database.available)
        error_log.assert_called_with("AI quota database pool failed to open")
        self.assertNotIn(SECRET_PASSWORD, repr(error_log.call_args))
        self.assertNotIn(SECRET_DSN, repr(error_log.call_args))

    def test_driver_logs_cannot_emit_connection_errors(self):
        silence_driver_logs()
        records = []
        handler = logging.Handler()
        handler.emit = lambda record: records.append(record.getMessage())
        root = logging.getLogger()
        root.addHandler(handler)
        self.addCleanup(root.removeHandler, handler)
        logging.getLogger("psycopg.pool").warning("password=%s", SECRET_PASSWORD)
        logging.getLogger("psycopg").error(SECRET_DSN)
        self.assertFalse(any(SECRET_PASSWORD in message for message in records))
        self.assertFalse(any(SECRET_DSN in message for message in records))

    def test_database_calls_only_permitted_rpcs(self):
        self.assertEqual(
            set(RPC_SQL),
            {"claim_ai_request", "renew_ai_lease", "finish_ai_request"},
        )
        self.assertEqual(set(RPC_SQL), set(PERMITTED_RPCS))
        for name, sql in RPC_SQL.items():
            self.assertIn(f"ai_quota.{name}", sql)
            self.assertNotIn(SECRET_PASSWORD, sql)
            for other in PERMITTED_RPCS - {name}:
                self.assertNotIn(other, sql)

        pool = _FakePool({"outcome": "granted", "reject_reason": None})
        _attach_executed(pool)
        database = AiQuotaDatabase(None)
        database._pool = pool
        request_id = str(uuid.uuid4())
        asyncio.run(database.claim(request_id, TEST_USER_ID, "ocr"))
        asyncio.run(database.renew(request_id))
        asyncio.run(database.finish(request_id, True, True, 3, 5, 0))
        names = []
        for query, _params in pool.executed:
            matched = [name for name in PERMITTED_RPCS if f"ai_quota.{name}" in query]
            self.assertEqual(len(matched), 1)
            names.append(matched[0])
            self.assertNotIn("select * from ai_quota.settings", query.lower())
        self.assertEqual(
            names, ["claim_ai_request", "renew_ai_lease", "finish_ai_request"]
        )

    def test_usage_splits_thoughts_and_treats_omission_as_zero(self):
        normal = token_usage_from_metadata(
            SimpleNamespace(
                prompt_token_count=11,
                candidates_token_count=7,
                thoughts_token_count=3,
            )
        )
        self.assertEqual(normal, TokenUsage(True, 11, 7, 3))
        omitted = token_usage_from_metadata(
            SimpleNamespace(prompt_token_count=11, candidates_token_count=7)
        )
        self.assertEqual(omitted.thought_tokens, 0)
        self.assertTrue(omitted.usage_available)
        explicit_zero = token_usage_from_metadata(
            {
                "prompt_token_count": 1,
                "candidates_token_count": 2,
                "thoughts_token_count": None,
            }
        )
        self.assertEqual(explicit_zero.thought_tokens, 0)

    def test_missing_or_invalid_usage_is_unknown(self):
        self.assertFalse(token_usage_from_response(SimpleNamespace()).usage_available)
        invalid_cases = [
            None,
            SimpleNamespace(prompt_token_count=1),
            SimpleNamespace(
                prompt_token_count=-1,
                candidates_token_count=1,
                thoughts_token_count=0,
            ),
            SimpleNamespace(
                prompt_token_count=True,
                candidates_token_count=1,
                thoughts_token_count=0,
            ),
            SimpleNamespace(
                prompt_token_count=1,
                candidates_token_count=1,
                thoughts_token_count=-2,
            ),
        ]
        for metadata in invalid_cases:
            usage = token_usage_from_metadata(metadata)
            self.assertFalse(usage.usage_available)
            self.assertIsNone(usage.input_tokens)
            self.assertIsNone(usage.output_tokens)
            self.assertIsNone(usage.thought_tokens)

    def test_receipt_parse_failure_keeps_usage_captured_before_text(self):
        service = GeminiService()
        events = []

        class Response:
            @property
            def usage_metadata(self):
                events.append("usage")
                return SimpleNamespace(
                    prompt_token_count=9,
                    candidates_token_count=4,
                    thoughts_token_count=2,
                )

            @property
            def text(self):
                events.append("text")
                return "{"

        with patch.object(
            service.client.models, "generate_content", return_value=Response()
        ):
            with self.assertRaises(GeminiInvalidOutput) as raised:
                service.analyze_receipt([(_jpeg_bytes(), "image/jpeg")])
        self.assertEqual(events, ["usage", "text"])
        self.assertEqual(raised.exception.usage, TokenUsage(True, 9, 4, 2))

    def test_analyze_search_and_csv_success_shapes(self):
        usage = TokenUsage(True, 8, 5, 1)
        self.allow_user()
        with patch.object(
            main.gemini_service,
            "analyze_receipt",
            return_value=ModelResult({"receipts": []}, usage),
        ):
            analyze = self.client.post(
                "/analyze",
                files=[("files", ("receipt.jpg", _jpeg_bytes(), "image/jpeg"))],
            )
        self.assertEqual(analyze.status_code, 200)
        self.assertEqual(analyze.json(), {"receipts": []})
        self.assertEqual(self.quota.claim_calls[0][1], TEST_USER_ID)
        self.assertEqual(self.quota.claim_calls[0][2], "ocr")
        self.assertEqual(self.quota.finish_calls[-1][1:], (True, True, 8, 5, 1))

        service = self.allow_user(service := Mock())
        service.get_all_data.return_value = (
            "purchase_date,store_name,item_name,price\n2026-10-01,店,牛乳,100"
        )
        with patch.object(
            main.gemini_service,
            "answer_question",
            return_value=ModelResult("今月は100円ですよ", usage),
        ):
            search = self.client.post("/search", json={"query": "今月の支出は？"})
        self.assertEqual(search.status_code, 200)
        self.assertEqual(search.json(), {"answer": "今月は100円ですよ"})
        self.assertEqual(self.quota.claim_calls[-1][2], "chat")

        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        self.allow_user()
        with patch.object(
            main.gemini_service,
            "analyze_csv",
            return_value=ModelResult(mapping, usage),
        ):
            csv_response = self.client.post(
                "/analyze_csv",
                json={"csv_text": "date,store,price\n2026-10-01,Shop,100\n"},
            )
        self.assertEqual(csv_response.status_code, 200)
        self.assertEqual(csv_response.json()["mapping"], mapping)
        self.assertEqual(len(csv_response.json()["transactions"]), 1)
        self.assertEqual(self.quota.claim_calls[-1][2], "csv_estimate")
        request_ids = [uuid.UUID(call[0]) for call in self.quota.claim_calls]
        self.assertEqual(len(set(request_ids)), 3)

    def test_rejected_and_idempotent_claims_do_not_call_gemini(self):
        cases = (
            ("rejected", "daily_limit_user", 429, DETAIL_DAILY),
            ("rejected", "daily_limit_global", 429, DETAIL_DAILY),
            ("rejected", "concurrency_user", 429, DETAIL_CONCURRENCY),
            ("rejected", "concurrency_global", 429, DETAIL_CONCURRENCY),
            ("rejected", "emergency_stop", 503, DETAIL_UNAVAILABLE),
            ("rejected", "monthly_cost_cap", 503, DETAIL_UNAVAILABLE),
            ("rejected", "unknown_usage_breaker", 503, DETAIL_UNAVAILABLE),
            ("rejected", "idempotency_conflict", 503, DETAIL_UNAVAILABLE),
            ("idempotent", None, 503, DETAIL_UNAVAILABLE),
            ("something-secret", SECRET_PASSWORD, 503, DETAIL_UNAVAILABLE),
        )
        self.allow_user()
        for outcome, reason, status, detail in cases:
            self.quota.claim_calls.clear()
            self.quota.finish_calls.clear()
            self.quota.claim_outcome = outcome
            self.quota.reject_reason = reason
            with (
                patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
                patch("app.services.ai_quota_guard.logger.warning") as warning_log,
            ):
                response = self.client.post(
                    "/analyze_csv", json={"csv_text": "date,store,price\n"}
                )
            self.assertEqual(response.status_code, status, outcome)
            self.assertEqual(response.json(), {"detail": detail})
            self.assertNotIn(SECRET_PASSWORD, response.text)
            analyze_csv.assert_not_called()
            self.assertEqual(self.quota.finish_calls, [])
            self.assertNotIn(SECRET_PASSWORD, repr(warning_log.call_args_list))

    def test_missing_auth_image_csv_and_search_skip_do_not_claim(self):
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            missing = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(missing.status_code, 422)
        analyze_csv.assert_not_called()
        self.assertEqual(self.quota.claim_calls, [])

        self.allow_user()
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            invalid = self.client.post(
                "/analyze",
                files=[("files", ("bad.jpg", b"not-an-image", "image/jpeg"))],
            )
        self.assertEqual(invalid.status_code, 422)
        analyze_receipt.assert_not_called()
        self.assertEqual(self.quota.claim_calls, [])

        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            mapped = self.client.post(
                "/analyze_csv",
                json={"csv_text": "date,store,price\n", "mapping": mapping},
            )
        self.assertEqual(mapped.status_code, 200)
        analyze_csv.assert_not_called()
        self.assertEqual(self.quota.claim_calls, [])

        service = self.allow_user(Mock())
        service.get_all_data.return_value = "purchase_date,store_name,item_name,price"
        with patch.object(main.gemini_service, "answer_question") as answer_question:
            empty = self.client.post("/search", json={"query": "ある？"})
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(
            empty.json(), {"answer": "合致するレシートデータが存在しません。"}
        )
        answer_question.assert_not_called()
        self.assertEqual(self.quota.claim_calls, [])

    def test_search_data_fetch_failure_happens_before_claim(self):
        service = self.allow_user(Mock())
        service.get_all_data.side_effect = RuntimeError(SECRET_DSN)
        with (
            patch.object(main.gemini_service, "answer_question") as answer_question,
            patch.object(main.logger, "error") as error_log,
        ):
            response = self.client.post("/search", json={"query": "今月は？"})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Internal Server Error"})
        self.assertNotIn(SECRET_PASSWORD, response.text)
        self.assertNotIn(SECRET_DSN, repr(error_log.call_args))
        answer_question.assert_not_called()
        self.assertEqual(self.quota.claim_calls, [])

    def test_database_unavailable_fails_closed_and_non_ai_still_works(self):
        self.allow_user()
        self.quota.fail_claim = True
        self.quota.claim_error = RuntimeError(SECRET_DSN)
        with (
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch("app.services.ai_quota_guard.logger.error") as error_log,
        ):
            response = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"detail": DETAIL_UNAVAILABLE})
        self.assertNotIn(SECRET_DSN, response.text)
        self.assertNotIn(SECRET_PASSWORD, repr(error_log.call_args))
        analyze_csv.assert_not_called()
        self.assertEqual(self.quota.finish_calls, [])

        months = MockMonths()
        self.allow_user(months)
        health = self.client.get("/")
        listed = self.client.get("/available_months")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json(), {"receipts": [], "csv": []})
        self.assertEqual(self.quota.finish_calls, [])

    def test_gemini_timeout_finishes_unknown_and_parse_failure_keeps_usage(self):
        self.allow_user()
        service = GeminiService()
        with patch.object(
            service.client.models,
            "generate_content",
            side_effect=TimeoutError("gemini timeout " + SECRET_PASSWORD),
        ) as generate_content:
            with self.assertRaises(TimeoutError):
                service.analyze_csv("date,store,price")
        generate_content.assert_called_once()

        with patch.object(
            main.gemini_service,
            "analyze_csv",
            side_effect=TimeoutError("gemini timeout " + SECRET_PASSWORD),
        ) as analyze_csv:
            timed_out = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(timed_out.status_code, 500)
        self.assertNotIn(SECRET_PASSWORD, timed_out.text)
        analyze_csv.assert_called_once()
        self.assertEqual(
            self.quota.finish_calls[-1][1:], (False, False, None, None, None)
        )

        usage = TokenUsage(True, 6, 2, 0)
        self.quota.finish_calls.clear()
        with patch.object(
            main.gemini_service,
            "analyze_csv",
            side_effect=GeminiInvalidOutput(usage),
        ):
            parsed = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(parsed.status_code, 500)
        self.assertEqual(self.quota.finish_calls[-1][1:], (False, True, 6, 2, 0))

        self.quota.finish_calls.clear()
        with patch.object(
            main.gemini_service,
            "analyze_csv",
            return_value=ModelResult({"has_header": "no"}, usage),
        ):
            rejected = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(self.quota.finish_calls[-1][1:], (False, True, 6, 2, 0))

        self.quota.finish_calls.clear()
        with patch.object(
            main.gemini_service,
            "analyze_csv",
            return_value=ModelResult(
                {
                    "has_header": True,
                    "date_col_index": 0,
                    "store_col_index": 1,
                    "price_col_index": 100,
                },
                usage,
            ),
        ):
            invalid_columns = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(invalid_columns.status_code, 422)
        self.assertEqual(
            invalid_columns.json(), {"detail": main.SAFE_CSV_MAPPING_ERROR_DETAIL}
        )
        self.assertEqual(self.quota.finish_calls[-1][1:], (False, True, 6, 2, 0))

    def test_finish_retries_same_payload_and_does_not_call_gemini_again(self):
        self.allow_user()
        self.quota.finish_failures_remaining = 2
        main.ai_quota_guard.finish_attempts = 3
        main.ai_quota_guard.finish_retry_delay_seconds = 0
        self.addCleanup(setattr, main.ai_quota_guard, "finish_attempts", 3)
        self.addCleanup(setattr, main.ai_quota_guard, "finish_retry_delay_seconds", 0.2)
        with patch.object(
            main.gemini_service,
            "analyze_csv",
            return_value={
                "has_header": True,
                "date_col_index": 0,
                "store_col_index": 1,
                "price_col_index": 2,
            },
        ) as analyze_csv:
            response = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(response.status_code, 200)
        analyze_csv.assert_called_once()
        self.assertEqual(len(self.quota.finish_calls), 3)
        self.assertEqual(self.quota.finish_failures_remaining, 0)
        self.assertEqual(len(set(self.quota.finish_calls)), 1)
        request_id = self.quota.claim_calls[-1][0]
        self.assertEqual(self.quota.finish_calls[0][0], request_id)

    def test_model_and_search_fetch_run_off_the_event_loop(self):
        import asyncio as asyncio_module

        caller_threads = []
        worker_threads = []
        real_to_thread = asyncio_module.to_thread

        async def tracking(func, /, *args, **kwargs):
            caller_threads.append(threading.get_ident())

            def invoke():
                worker_threads.append(threading.get_ident())
                return func(*args, **kwargs)

            return await real_to_thread(invoke)

        service = self.allow_user(Mock())
        service.get_all_data.return_value = (
            "purchase_date,store_name,item_name,price\n2026-10-01,店,牛乳,100"
        )
        with (
            patch("app.main.asyncio.to_thread", tracking),
            patch.object(
                main.gemini_service, "answer_question", return_value="回答ですよ"
            ),
        ):
            response = self.client.post("/search", json={"query": "今月は？"})
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(worker_threads), 2)
        self.assertTrue(
            all(
                caller != worker
                for caller, worker in zip(caller_threads, worker_threads)
            )
        )
        self.assertEqual(service.get_all_data.call_count, 1)

    def test_csv_gemini_runs_off_the_event_loop(self):
        import asyncio as asyncio_module

        seen = []
        real_to_thread = asyncio_module.to_thread

        async def tracking(func, /, *args, **kwargs):
            seen.append(func)

            def invoke():
                self.assertNotEqual(threading.get_ident(), tracking.caller)
                return func(*args, **kwargs)

            tracking.caller = threading.get_ident()
            return await real_to_thread(invoke)

        self.allow_user()
        with (
            patch("app.main.asyncio.to_thread", tracking),
            patch.object(
                main.gemini_service,
                "analyze_csv",
                return_value={
                    "has_header": True,
                    "date_col_index": 0,
                    "store_col_index": 1,
                    "price_col_index": 2,
                },
            ) as analyze_csv,
        ):
            response = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn(analyze_csv, seen)
        analyze_csv.assert_called_once()

    def test_connection_is_not_held_during_the_model_call(self):
        pool = _FakePool({"outcome": "granted", "reject_reason": None})
        _attach_executed(pool)
        database = AiQuotaDatabase(None)
        database._pool = pool
        observed = {}

        async def operation():
            observed["in_use"] = pool.in_use
            return "ok", TokenUsage(True, 1, 2, 0)

        guard = AiQuotaGuard(database, renew_interval_seconds=30)
        result = asyncio.run(guard.execute(uuid.UUID(TEST_USER_ID), "chat", operation))
        self.assertEqual(result, "ok")
        self.assertEqual(observed["in_use"], 0)
        self.assertEqual(pool.in_use, 0)
        self.assertGreaterEqual(len(pool.executed), 2)

    def test_renew_loop_stops_and_swallows_errors(self):
        database = GrantingQuotaDatabase()
        database.renew_error = RuntimeError(SECRET_DSN)
        guard = AiQuotaGuard(
            database,
            renew_interval_seconds=0.01,
            finish_retry_delay_seconds=0,
        )
        errors = []

        async def operation():
            await asyncio.sleep(0.05)
            return "ok", TokenUsage.unavailable()

        async def scenario():
            loop = asyncio.get_running_loop()
            loop.set_exception_handler(lambda _loop, context: errors.append(context))
            with patch("app.services.ai_quota_guard.logger.error") as error_log:
                result = await guard.execute(uuid.UUID(TEST_USER_ID), "ocr", operation)
            self.assertEqual(result, "ok")
            self.assertGreaterEqual(len(database.renew_calls), 1)
            self.assertNotIn(SECRET_DSN, repr(error_log.call_args_list))
            self.assertFalse(any(not task.done() for task in guard._tasks))

        asyncio.run(scenario())
        self.assertEqual(errors, [])
        self.assertEqual(len(database.finish_calls), 1)

    def test_client_cancel_does_not_repeat_gemini_or_skip_finish(self):
        database = GrantingQuotaDatabase()
        guard = AiQuotaGuard(database, renew_interval_seconds=30)
        started = asyncio.Event()
        release = asyncio.Event()
        calls = {"model": 0}

        async def operation():
            calls["model"] += 1
            started.set()
            await release.wait()
            return "ok", TokenUsage(True, 1, 1, 0)

        async def scenario():
            request = asyncio.create_task(
                guard.execute(uuid.UUID(TEST_USER_ID), "ocr", operation)
            )
            await started.wait()
            self.assertTrue(any(not task.done() for task in guard._tasks))
            request.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await request
            self.assertEqual(calls["model"], 1)
            release.set()
            for _ in range(50):
                if database.finish_calls:
                    break
                await asyncio.sleep(0.01)
            self.assertEqual(calls["model"], 1)
            self.assertEqual(len(database.finish_calls), 1)
            self.assertEqual(database.finish_calls[0][0], database.claim_calls[0][0])

        asyncio.run(scenario())

    def test_detached_task_failure_is_consumed_without_exception_text(self):
        import gc

        guard = AiQuotaGuard(GrantingQuotaDatabase(), renew_interval_seconds=30)

        async def fail():
            raise RuntimeError(SECRET_PASSWORD)

        async def scenario():
            loop = asyncio.get_running_loop()
            contexts = []
            loop.set_exception_handler(lambda _loop, context: contexts.append(context))
            task = asyncio.create_task(fail(), name="ai-quota-detached")
            guard._track(task)
            for _ in range(50):
                if task.done():
                    break
                await asyncio.sleep(0.01)
            self.assertTrue(task.done())
            await asyncio.sleep(0)
            gc.collect()
            await asyncio.sleep(0)
            rendered = repr(contexts)
            self.assertEqual(contexts, [])
            self.assertNotIn(SECRET_PASSWORD, rendered)
            self.assertNotIn("never retrieved", rendered)
            self.assertNotIn(task, guard._tasks)

        asyncio.run(scenario())

    def test_disconnect_failure_is_consumed_and_live_awaiter_still_sees_it(self):
        import gc

        database = GrantingQuotaDatabase()
        guard = AiQuotaGuard(database, renew_interval_seconds=30)
        started = asyncio.Event()
        release = asyncio.Event()

        async def fail_immediately():
            raise RuntimeError(SECRET_PASSWORD)

        async def fail_after_release():
            started.set()
            await release.wait()
            raise RuntimeError(SECRET_PASSWORD)

        async def scenario():
            loop = asyncio.get_running_loop()
            contexts = []
            loop.set_exception_handler(lambda _loop, context: contexts.append(context))
            with self.assertRaises(RuntimeError) as live:
                await guard.execute(uuid.UUID(TEST_USER_ID), "ocr", fail_immediately)
            self.assertIn(SECRET_PASSWORD, str(live.exception))
            self.assertEqual(database.finish_calls[-1][1], False)

            database.finish_calls.clear()
            request = asyncio.create_task(
                guard.execute(uuid.UUID(TEST_USER_ID), "chat", fail_after_release)
            )
            await started.wait()
            request.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await request
            release.set()
            for _ in range(50):
                if database.finish_calls and all(task.done() for task in guard._tasks):
                    break
                await asyncio.sleep(0.01)
            await asyncio.sleep(0)
            gc.collect()
            await asyncio.sleep(0)
            rendered = repr(contexts)
            self.assertEqual(contexts, [])
            self.assertNotIn(SECRET_PASSWORD, rendered)
            self.assertNotIn("never retrieved", rendered)
            self.assertEqual(database.finish_calls[-1][1], False)

        asyncio.run(scenario())

    def test_cancelled_tracked_task_callback_does_not_emit(self):
        guard = AiQuotaGuard(GrantingQuotaDatabase(), renew_interval_seconds=30)

        async def scenario():
            loop = asyncio.get_running_loop()
            contexts = []
            loop.set_exception_handler(lambda _loop, context: contexts.append(context))
            task = asyncio.create_task(asyncio.sleep(60), name="ai-quota-cancelled")
            guard._track(task)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            await asyncio.sleep(0)
            self.assertEqual(contexts, [])
            self.assertNotIn(task, guard._tasks)

        asyncio.run(scenario())

    def test_lifespan_starts_and_closes_without_blocking_non_ai(self):
        events = []

        async def start():
            events.append("start")

        async def close():
            events.append("close")

        with (
            patch.object(main.ai_quota_database, "start", start),
            patch.object(main.ai_quota_database, "close", close),
        ):
            with TestClient(main.app) as client:
                response = client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(events, ["start", "close"])

    def test_unconfigured_quota_returns_503_without_stopping_health(self):
        previous = main.ai_quota_guard.database
        main.ai_quota_guard.database = AiQuotaDatabase(None)
        self.addCleanup(setattr, main.ai_quota_guard, "database", previous)
        self.allow_user()
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            response = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(response.status_code, 503)
        analyze_csv.assert_not_called()
        self.assertEqual(self.client.get("/").status_code, 200)


class MockMonths:
    user_id = TEST_USER_ID

    def get_available_months(self):
        return {"receipts": [], "csv": []}


class AiQuotaConfigReprTests(unittest.TestCase):
    def test_config_repr_redacts_password(self):
        config = AiQuotaDbConfig(
            host="db.example",
            port=5432,
            dbname="postgres",
            user="ai_quota_backend.abc",
            password=SECRET_PASSWORD,
            sslrootcert="/tmp/ca.crt",
        )
        self.assertEqual(repr(config), "AiQuotaDbConfig(redacted)")
        self.assertNotIn(SECRET_PASSWORD, repr(config))
