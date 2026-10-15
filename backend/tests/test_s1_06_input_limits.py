import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault("GEMINI_API_KEY", "test-only-placeholder")

from fastapi.testclient import TestClient

from tests.support_ai_quota import ensure_user_id, install_granting_quota

from app import main
from app.schemas.csv import MAX_CSV_ROWS
from app.services.csv_service import CsvRowLimitError, CsvService
from app.services.gemini_service import GeminiService
from app.services.supabase_service import (
    SEARCH_DATA_HEADER,
    SEARCH_DATA_MAX_CHARACTERS,
    SEARCH_DATA_MAX_ROWS,
    SearchDataLimitError,
    SupabaseService,
)


class FakeQuery:
    def __init__(self, client, table):
        self.client = client
        self.table_name = table
        self.filters = []
        self.offset = 0
        self.limit = 0

    def select(self, _columns):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self.offset = start
        self.limit = end - start + 1
        return self

    def gte(self, column, value):
        self.filters.append(("gte", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, values))
        return self

    def execute(self):
        rows = self.client.tables[self.table_name]
        for operator, column, value in self.filters:
            if operator == "gte":
                rows = [row for row in rows if row.get(column, "") >= value]
            else:
                rows = [row for row in rows if row.get(column) in value]
        self.client.ranges.append((self.table_name, self.offset, self.limit))
        return SimpleNamespace(data=rows[self.offset : self.offset + self.limit])


class FakeSupabaseClient:
    def __init__(self, **tables):
        self.tables = tables
        self.ranges = []

    def table(self, table):
        return FakeQuery(self, table)


class S106ApiInputLimitTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.app.dependency_overrides.clear()
        self.addCleanup(main.app.dependency_overrides.clear)
        self.quota = install_granting_quota(self)

    def allow_authenticated_user(self, service):
        service = ensure_user_id(service)

        async def authenticated_service():
            return service

        main.app.dependency_overrides[main.get_supabase_service] = authenticated_service

    def test_csv_logical_row_limit_includes_quoted_newlines(self):
        service = CsvService()
        self.assertEqual(
            service.validate_csv_limits('"a\nb",c\n' * MAX_CSV_ROWS), MAX_CSV_ROWS
        )
        with self.assertRaises(CsvRowLimitError):
            service.validate_csv_limits('"a\nb",c\n' * (MAX_CSV_ROWS + 1))

    def test_csv_rejects_more_than_twenty_thousand_records_before_gemini(self):
        self.allow_authenticated_user(object())
        marker = "household-csv-secret"
        csv_text = f"{marker},store,1\n" * (MAX_CSV_ROWS + 1)
        mapping = {
            "has_header": False,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        with (
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch.object(main.csv_service, "parse_csv") as parse_csv,
        ):
            response = self.client.post(
                "/analyze_csv", json={"csv_text": csv_text, "mapping": mapping}
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json(), {"detail": "CSVは20,000行以内にしてください。"}
        )
        self.assertNotIn(marker, response.text)
        self.assertNotIn("transactions", response.json())
        analyze_csv.assert_not_called()
        parse_csv.assert_not_called()

    def test_csv_accepts_exactly_twenty_thousand_logical_rows_without_gemini(self):
        self.allow_authenticated_user(object())
        mapping = {
            "has_header": False,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        csv_text = "2024-06-15,店,100\n" * MAX_CSV_ROWS
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            response = self.client.post(
                "/analyze_csv", json={"csv_text": csv_text, "mapping": mapping}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["transactions"]), MAX_CSV_ROWS)
        self.assertEqual(response.json()["mapping"], mapping)
        analyze_csv.assert_not_called()

    def test_quoted_newline_over_limit_is_rejected_without_partial_result(self):
        self.allow_authenticated_user(object())
        marker = "quoted-household-secret"
        csv_text = f'"{marker}\ncontinued",c\n' * (MAX_CSV_ROWS + 1)
        with (
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch.object(main.csv_service, "parse_csv") as parse_csv,
        ):
            response = self.client.post("/analyze_csv", json={"csv_text": csv_text})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json(), {"detail": "CSVは20,000行以内にしてください。"}
        )
        self.assertNotIn(marker, response.text)
        analyze_csv.assert_not_called()
        parse_csv.assert_not_called()

    def test_multi_year_rows_parse_without_date_range_limit(self):
        service = CsvService()
        csv_text = "date,store,price\n2018-02-03,古い店,120\n2026-11-30,新しい店,340\n"
        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        parsed = service.parse_csv(csv_text, mapping)
        self.assertEqual([row.date for row in parsed], ["2018-02-03", "2026-11-30"])
        self.assertEqual([row.store for row in parsed], ["古い店", "新しい店"])

    def test_twenty_thousand_transactions_parse_across_years(self):
        service = CsvService()
        rows = ["2018-01-01,旧店,10"]
        rows.extend(["2024-06-15,店,20"] * (MAX_CSV_ROWS - 2))
        rows.append("2026-12-31,新店,30")
        mapping = {
            "has_header": False,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        csv_text = "\n".join(rows) + "\n"
        self.assertEqual(service.validate_csv_limits(csv_text), MAX_CSV_ROWS)
        parsed = service.parse_csv(csv_text, mapping)
        self.assertEqual(len(parsed), MAX_CSV_ROWS)
        self.assertEqual(parsed[0].date, "2018-01-01")
        self.assertEqual(parsed[0].store, "旧店")
        self.assertEqual(parsed[-1].date, "2026-12-31")
        self.assertEqual(parsed[-1].store, "新店")

    def test_invalid_supplied_mapping_is_rejected_before_gemini(self):
        self.allow_authenticated_user(object())
        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": True,
        }
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": "date,store,price\n", "mapping": mapping},
            )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("True", response.text)
        analyze_csv.assert_not_called()

    def test_out_of_range_supplied_mapping_is_rejected_without_gemini(self):
        self.allow_authenticated_user(object())
        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 3,
        }
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": "date,store,price\n", "mapping": mapping},
            )
        self.assertEqual(response.status_code, 422)
        analyze_csv.assert_not_called()

    def test_valid_mapping_skips_gemini_and_keeps_response_shape(self):
        self.allow_authenticated_user(object())
        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": "date,store,price\n", "mapping": mapping},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"transactions": [], "mapping": mapping})
        analyze_csv.assert_not_called()

    def test_legacy_preset_mapping_is_adapted_without_gemini(self):
        self.allow_authenticated_user(object())
        mapping = {
            "date_col_idx": 0,
            "item_col_idx": 2,
            "store_col_idx": 1,
            "price_col_idx": 2,
            "confidence": 0.95,
        }
        with patch.object(main.gemini_service, "analyze_csv") as analyze_csv:
            response = self.client.post(
                "/analyze_csv",
                json={
                    "csv_text": "date,store,price\n2026-10-01,Shop,100\n",
                    "mapping": mapping,
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["transactions"]), 1)
        self.assertEqual(response.json()["transactions"][0]["store"], "Shop")
        self.assertEqual(response.json()["mapping"]["has_header"], False)
        analyze_csv.assert_not_called()

    def test_invalid_gemini_mapping_is_rejected_before_csv_parse(self):
        self.allow_authenticated_user(object())
        with (
            patch.object(
                main.gemini_service,
                "analyze_csv",
                return_value={
                    "has_header": True,
                    "date_col_index": 0,
                    "store_col_index": 1,
                    "price_col_index": 100,
                },
            ),
            patch.object(main.csv_service, "parse_csv") as parse_csv,
        ):
            response = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )
        self.assertEqual(response.status_code, 422)
        parse_csv.assert_not_called()

    def test_csv_row_boundary_is_accepted(self):
        service = CsvService()
        self.assertEqual(
            service.validate_csv_limits("x\n" * MAX_CSV_ROWS), MAX_CSV_ROWS
        )

    def test_search_question_and_enum_validation_redact_input(self):
        self.allow_authenticated_user(object())
        secret = "private-household-question"
        with patch.object(main.gemini_service, "answer_question") as answer_question:
            too_long = self.client.post("/search", json={"query": secret + ("x" * 500)})
            bad_period = self.client.post(
                "/search", json={"query": secret, "period": "unknown"}
            )
            bad_data_type = self.client.post(
                "/search", json={"query": secret, "data_type": secret}
            )
        self.assertEqual(too_long.status_code, 422)
        self.assertEqual(bad_period.status_code, 422)
        self.assertEqual(bad_data_type.status_code, 422)
        self.assertNotIn(secret, too_long.text + bad_period.text + bad_data_type.text)
        answer_question.assert_not_called()

    def test_search_accepts_question_at_five_hundred_characters(self):
        service = Mock()
        service.get_all_data.return_value = SEARCH_DATA_HEADER
        self.allow_authenticated_user(service)
        response = self.client.post("/search", json={"query": "x" * 500})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"answer": "合致するレシートデータが存在しません。"}
        )

    def test_search_overflow_is_safe_and_does_not_call_gemini(self):
        service = Mock()
        service.get_all_data.side_effect = SearchDataLimitError
        self.allow_authenticated_user(service)
        with patch.object(main.gemini_service, "answer_question") as answer_question:
            response = self.client.post(
                "/search", json={"query": "今月の支出は？", "period": "all"}
            )
        self.assertEqual(response.status_code, 422)
        self.assertIn("対象期間を短く", response.json()["detail"])
        answer_question.assert_not_called()

    def test_search_success_response_shape_is_unchanged(self):
        service = Mock()
        service.get_all_data.return_value = f"{SEARCH_DATA_HEADER}\n2026-10,店,商品,100"
        self.allow_authenticated_user(service)
        with patch.object(main.gemini_service, "answer_question", return_value="回答"):
            response = self.client.post(
                "/search", json={"query": "今月の支出は？", "period": "all"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"answer": "回答"})
        service.get_all_data.assert_called_once_with(data_type="all", period="all")

    def test_fastapi_validation_does_not_echo_credentials_or_input(self):
        secret = "secret-input-value"
        response = self.client.post(
            "/search",
            json={"query": secret, "data_type": secret, "period": "all"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text)

    def test_search_service_accepts_all_and_rejects_complete_overflow(self):
        rows = [
            {"id": str(index), "date": "", "store": "", "price": 0}
            for index in range(SEARCH_DATA_MAX_ROWS)
        ]
        client = FakeSupabaseClient(csv_transactions=rows)
        service = SupabaseService.__new__(SupabaseService)
        service.client = client
        result = service.get_all_data(data_type="log", period="all")
        self.assertEqual(len(result.splitlines()), SEARCH_DATA_MAX_ROWS + 1)
        self.assertGreater(len(client.ranges), 1)
        self.assertLessEqual(len(result), SEARCH_DATA_MAX_CHARACTERS)
        client.tables["csv_transactions"].append(
            {"id": "overflow", "date": "", "store": "", "price": 0}
        )
        with self.assertRaises(SearchDataLimitError):
            service.get_all_data(data_type="log", period="all")

    def test_search_character_limit_rejects_without_truncating(self):
        row = {
            "id": "1",
            "date": "2026-01-01",
            "store": "店" * SEARCH_DATA_MAX_CHARACTERS,
            "price": 1,
        }
        service = SupabaseService.__new__(SupabaseService)
        service.client = FakeSupabaseClient(csv_transactions=[row])
        with self.assertRaises(SearchDataLimitError):
            service.get_all_data(data_type="log", period="all")

    def test_search_all_includes_receipts_and_csv_transactions(self):
        client = FakeSupabaseClient(
            receipts=[
                {
                    "id": "receipt-1",
                    "date": "2026-10-01",
                    "store_name": "店,支店",
                    "total_amount": 100,
                }
            ],
            receipt_items=[
                {
                    "id": "item-1",
                    "receipt_id": "receipt-1",
                    "item_name": "商品\n限定",
                    "price": 100,
                }
            ],
            csv_transactions=[
                {"id": "csv-1", "date": "2026-10-02", "store": "カード店", "price": 200}
            ],
        )
        service = SupabaseService.__new__(SupabaseService)
        service.client = client
        result = service.get_all_data(data_type="all", period="all")
        self.assertIn('"店,支店"', result)
        self.assertIn('"商品\n限定"', result)
        self.assertIn("キャッシュレス決済,200", result)

    def test_gemini_client_uses_explicit_http_timeout(self):
        from google.genai._api_client import get_timeout_in_seconds, retry_args

        with patch("app.services.gemini_service.genai.Client") as client_factory:
            service = GeminiService()
        self.assertIs(service.client, client_factory.return_value)
        options = client_factory.call_args.kwargs["http_options"]
        self.assertEqual(options.timeout, 120_000)
        self.assertEqual(get_timeout_in_seconds(options.timeout), 120)
        self.assertIsNone(options.retry_options)
        self.assertEqual(
            retry_args(options.retry_options)["stop"].max_attempt_number, 1
        )


if __name__ == "__main__":
    unittest.main()
