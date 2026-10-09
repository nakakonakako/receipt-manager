import os
import unittest
from unittest.mock import patch

os.environ.setdefault("GEMINI_API_KEY", "test-only-placeholder")

from fastapi.testclient import TestClient

from app import main
from app.schemas.csv import CsvAnalysisRequest, MAX_CSV_TEXT_CHARACTERS


class AnalyzeCsvAuthTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.app.dependency_overrides.clear()
        self.addCleanup(main.app.dependency_overrides.clear)

    def _allow_authenticated_user(self):
        async def authenticated_service():
            return object()

        main.app.dependency_overrides[main.get_supabase_service] = authenticated_service

    def test_missing_token_is_rejected_without_gemini(self):
        with (
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch.object(main.csv_service, "parse_csv") as parse_csv,
        ):
            response = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )

        self.assertEqual(response.status_code, 422)
        analyze_csv.assert_not_called()
        parse_csv.assert_not_called()

    def test_invalid_token_is_rejected_without_gemini(self):
        with (
            patch.object(
                main,
                "SupabaseService",
                side_effect=ValueError("invalid token"),
            ),
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch.object(main.csv_service, "parse_csv") as parse_csv,
        ):
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": "date,store,price\n"},
                headers={"x-supabase-token": "invalid-test-token"},
            )

        self.assertEqual(response.status_code, 401)
        analyze_csv.assert_not_called()
        parse_csv.assert_not_called()

    def test_authenticated_request_with_mapping_skips_gemini(self):
        self._allow_authenticated_user()
        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        with (
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch.object(
                main.csv_service,
                "parse_csv",
                return_value=[{"date": "2026-10-10", "store": "Shop", "price": 100}],
            ),
        ):
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": "date,store,price\n", "mapping": mapping},
                headers={"x-supabase-token": "valid-test-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mapping"], mapping)
        analyze_csv.assert_not_called()

    def test_authenticated_request_without_mapping_calls_gemini_with_bounded_sample(
        self,
    ):
        self._allow_authenticated_user()
        mapping = {
            "has_header": True,
            "date_col_index": 0,
            "store_col_index": 1,
            "price_col_index": 2,
        }
        csv_text = "header\n" + ("x" * (main.MAX_CSV_MAPPING_SAMPLE_CHARACTERS + 100))

        with (
            patch.object(
                main.gemini_service,
                "analyze_csv",
                return_value=mapping,
            ) as analyze_csv,
            patch.object(main.csv_service, "parse_csv", return_value=[]),
        ):
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": csv_text},
                headers={"x-supabase-token": "valid-test-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["mapping"], mapping)
        sample = analyze_csv.call_args.args[0]
        self.assertLessEqual(len(sample), main.MAX_CSV_MAPPING_SAMPLE_CHARACTERS)
        self.assertTrue(sample.startswith("header"))

    def test_empty_csv_is_rejected_without_parsing_or_gemini(self):
        self._allow_authenticated_user()
        with (
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch.object(main.csv_service, "parse_csv") as parse_csv,
        ):
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": ""},
                headers={"x-supabase-token": "valid-test-token"},
            )

        self.assertEqual(response.status_code, 422)
        analyze_csv.assert_not_called()
        parse_csv.assert_not_called()

    def test_csv_character_limit_boundary(self):
        CsvAnalysisRequest(csv_text="x" * MAX_CSV_TEXT_CHARACTERS)
        with self.assertRaises(ValueError):
            CsvAnalysisRequest(csv_text="x" * (MAX_CSV_TEXT_CHARACTERS + 1))

    def test_oversized_csv_is_rejected_without_parsing_or_gemini(self):
        self._allow_authenticated_user()
        csv_text = "x" * (MAX_CSV_TEXT_CHARACTERS + 1)
        with (
            patch.object(main.gemini_service, "analyze_csv") as analyze_csv,
            patch.object(main.csv_service, "parse_csv") as parse_csv,
        ):
            response = self.client.post(
                "/analyze_csv",
                json={"csv_text": csv_text},
                headers={"x-supabase-token": "valid-test-token"},
            )

        self.assertEqual(response.status_code, 422)
        analyze_csv.assert_not_called()
        parse_csv.assert_not_called()


if __name__ == "__main__":
    unittest.main()
