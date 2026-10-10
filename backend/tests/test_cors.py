import os
import unittest

os.environ.setdefault("GEMINI_API_KEY", "test-only-placeholder")

from fastapi.testclient import TestClient

from app import main

_CORS_RESPONSE_HEADERS = (
    "access-control-allow-origin",
    "access-control-allow-credentials",
)


class CorsRegressionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_root_health_remains_usable(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("running", response.json().get("message", "").lower())

    def test_options_with_origin_has_no_cors_headers(self):
        response = self.client.options(
            "/",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        for header in _CORS_RESPONSE_HEADERS:
            self.assertNotIn(header, response.headers)


if __name__ == "__main__":
    unittest.main()
