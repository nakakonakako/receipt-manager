import os
import unittest
from unittest.mock import Mock, patch

os.environ.setdefault("GEMINI_API_KEY", "test-only-placeholder")

from fastapi import HTTPException
from fastapi.testclient import TestClient
from supabase_auth.errors import AuthApiError

from app import main
from app.services import csv_service as csv_service_module
from app.services import gemini_service as gemini_service_module
from app.services.csv_service import CsvService
from app.services.supabase_service import (
    InvalidSupabaseTokenError,
    SupabaseService,
)


class ApiErrorSafetyTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.app.dependency_overrides.clear()
        self.addCleanup(main.app.dependency_overrides.clear)

    def _allow_authenticated_user(self, service):
        async def authenticated_service():
            return service

        main.app.dependency_overrides[main.get_supabase_service] = authenticated_service

    def test_database_failure_returns_fixed_500_without_logging_exception(self):
        secret = "database-host-and-household-data"
        service = Mock()
        service.get_available_months.side_effect = RuntimeError(secret)
        self._allow_authenticated_user(service)

        with patch.object(main.logger, "error") as error_log:
            response = self.client.get("/available_months")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Internal Server Error"})
        self.assertNotIn(secret, response.text)
        error_log.assert_called_once_with(
            "Unexpected error while processing endpoint %s", "available_months"
        )
        self.assertNotIn(secret, repr(error_log.call_args))

    def test_gemini_failure_returns_fixed_500_without_exception_details(self):
        secret = "gemini-api-key-and-prompt-content"
        self._allow_authenticated_user(object())

        with patch.object(
            main.gemini_service,
            "analyze_csv",
            side_effect=RuntimeError(secret),
        ):
            response = self.client.post(
                "/analyze_csv", json={"csv_text": "date,store,price\n"}
            )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Internal Server Error"})
        self.assertNotIn(secret, response.text)

    def test_gemini_service_logs_no_exception_or_prompt_details(self):
        secret = "gemini-api-key-and-receipt-data"
        with (
            patch.object(
                main.gemini_service.client.models,
                "generate_content",
                side_effect=RuntimeError(secret),
            ),
            patch.object(gemini_service_module.logger, "error") as error_log,
        ):
            with self.assertRaises(RuntimeError):
                main.gemini_service.analyze_csv(secret)

        error_log.assert_called_once_with("Gemini CSV mapping failed")
        self.assertNotIn(secret, repr(error_log.call_args))

    def test_csv_service_logs_no_csv_values_or_exception_details(self):
        secret = "csv-household-data-and-parser-detail"
        with (
            patch.object(
                csv_service_module.parser, "parse", side_effect=ValueError(secret)
            ),
            patch.object(csv_service_module.logger, "warning") as warning_log,
        ):
            result = CsvService().parse_csv(
                f"{secret},Store,100",
                {"date_col_index": 0, "store_col_index": 1, "price_col_index": 2},
            )

        self.assertEqual(result, [])
        warning_log.assert_called_once_with(
            "Skipping CSV row with an invalid date (row=%d)", 0
        )
        self.assertNotIn(secret, repr(warning_log.call_args))

    def test_invalid_auth_token_returns_safe_401(self):
        secret = "auth-provider-response-with-internal-details"
        with patch.object(
            main,
            "SupabaseService",
            side_effect=InvalidSupabaseTokenError(secret),
        ):
            response = self.client.get(
                "/available_months",
                headers={"x-supabase-token": "invalid-test-token"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(
            response.json(), {"detail": "Invalid authentication credentials."}
        )
        self.assertNotIn(secret, response.text)

    def test_non_auth_supabase_failure_is_not_misclassified_as_401(self):
        secret = "supabase-url-or-service-configuration"
        with (
            patch.object(
                main,
                "SupabaseService",
                side_effect=RuntimeError(secret),
            ),
            patch.object(main.logger, "error") as error_log,
        ):
            response = self.client.get(
                "/available_months",
                headers={"x-supabase-token": "test-token"},
            )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Internal Server Error"})
        self.assertNotIn(secret, response.text)
        self.assertNotIn(secret, repr(error_log.call_args))

    def test_intentional_http_exception_from_auth_dependency_is_preserved(self):
        with patch.object(
            main,
            "SupabaseService",
            side_effect=HTTPException(status_code=403, detail="Access denied"),
        ):
            response = self.client.get(
                "/available_months",
                headers={"x-supabase-token": "test-token"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "Access denied"})

    def test_missing_auth_header_keeps_existing_422_behavior(self):
        with patch.object(main, "SupabaseService") as service_constructor:
            response = self.client.get("/available_months")

        self.assertEqual(response.status_code, 422)
        service_constructor.assert_not_called()

    def test_request_validation_keeps_existing_422_behavior(self):
        self._allow_authenticated_user(object())

        response = self.client.post("/analyze_csv", json={"mapping": {}})

        self.assertEqual(response.status_code, 422)

    def test_success_response_shape_is_unchanged(self):
        expected = {"receipts": ["2026-10"], "csv": ["2026-10"]}
        service = Mock()
        service.get_available_months.return_value = expected
        self._allow_authenticated_user(service)

        response = self.client.get("/available_months")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)

    def test_intentional_http_exception_is_not_converted_to_500(self):
        service = Mock()
        service.get_available_months.side_effect = HTTPException(
            status_code=403, detail="Access denied"
        )
        self._allow_authenticated_user(service)

        response = self.client.get("/available_months")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "Access denied"})

    def test_supabase_classifies_only_explicit_invalid_token_errors(self):
        secret = "provider-internal-auth-detail"
        client = Mock()
        client.auth.get_user.side_effect = AuthApiError(
            secret, status=400, code="invalid_jwt"
        )
        with (
            patch.dict(
                os.environ,
                {
                    "SUPABASE_URL": "https://example.supabase.co",
                    "SUPABASE_KEY": "test-only-key",
                },
            ),
            patch("app.services.supabase_service.create_client", return_value=client),
        ):
            with self.assertRaises(InvalidSupabaseTokenError) as raised:
                SupabaseService(token="test-token")

        self.assertNotIn(secret, str(raised.exception))

        client.auth.get_user.side_effect = AuthApiError(secret, status=401, code=None)
        with (
            patch.dict(
                os.environ,
                {
                    "SUPABASE_URL": "https://example.supabase.co",
                    "SUPABASE_KEY": "test-only-key",
                },
            ),
            patch("app.services.supabase_service.create_client", return_value=client),
        ):
            with self.assertRaises(AuthApiError):
                SupabaseService(token="test-token")


if __name__ == "__main__":
    unittest.main()
