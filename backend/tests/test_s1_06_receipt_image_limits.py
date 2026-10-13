import os
import struct
import secrets
import unittest
import zlib
from io import BytesIO
from unittest.mock import patch

os.environ.setdefault("GEMINI_API_KEY", "test-only-placeholder")

from fastapi.testclient import TestClient
from PIL import Image

from app import main
from app.schemas.receipt_image import (
    GEMINI_INLINE_REQUEST_BYTE_LIMIT,
    GEMINI_RECEIPT_ANALYZE_FIXED_OVERHEAD_BYTES,
    MAX_RECEIPT_IMAGE_BYTES,
    MAX_RECEIPT_IMAGES_BASE64_CHARS,
    MAX_RECEIPT_IMAGES_PER_REQUEST,
    MAX_RECEIPT_IMAGES_TOTAL_BYTES,
    worst_case_split_base64_char_count,
)
from app.services.gemini_service import GeminiService
from app.services.receipt_image_service import (
    ReceiptImageService,
    ReceiptImageValidationError,
    SAFE_RECEIPT_IMAGE_COUNT_DETAIL,
    SAFE_RECEIPT_IMAGE_FILE_SIZE_DETAIL,
    SAFE_RECEIPT_IMAGE_HEIF_DETAIL,
    SAFE_RECEIPT_IMAGE_TOTAL_SIZE_DETAIL,
    _read_upload_bounded,
    validate_receipt_image_bytes,
)


def _large_jpeg_bytes() -> bytes:
    image = Image.frombytes("RGB", (2000, 2000), secrets.token_bytes(2000 * 2000 * 3))
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=100)
    return buffer.getvalue()


def _minimal_image_bytes(fmt: str) -> bytes:
    image = Image.new("RGB", (1, 1), color="white")
    buffer = BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def _png_with_dimensions(width: int, height: int) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = b"IHDR" + ihdr_data
    ihdr_chunk = (
        struct.pack(">I", len(ihdr_data))
        + ihdr
        + struct.pack(">I", zlib.crc32(ihdr) & 0xFFFFFFFF)
    )
    return signature + ihdr_chunk


def _heif_like_bytes() -> bytes:
    return b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1" + b"\x00" * 8


def _jpeg_com_segment(data_len: int) -> bytes:
    if data_len < 0 or data_len > 0xFFFF - 2:
        raise ValueError("JPEG COM data length out of range")
    return b"\xff\xfe" + struct.pack(">H", data_len + 2) + (b"\x00" * data_len)


def _jpeg_exact_size(target_size: int) -> bytes:
    tail = _minimal_image_bytes("JPEG")[2:]
    soi = b"\xff\xd8"
    max_com_data = 0xFFFF - 2
    padding = bytearray()
    remaining = target_size - len(soi) - len(tail)
    while remaining > 0:
        if remaining < 4:
            raise ValueError("target_size not reachable with COM segments")
        chunk = min(remaining - 4, max_com_data)
        padding.extend(_jpeg_com_segment(chunk))
        remaining -= chunk + 4
    payload = soi + bytes(padding) + tail
    validate_receipt_image_bytes(payload)
    if len(payload) != target_size:
        raise ValueError(f"expected {target_size} bytes, got {len(payload)}")
    return payload


class FakeUploadFile:
    def __init__(self, data: bytes):
        self._data = data
        self._offset = 0

    async def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = len(self._data) - self._offset
        chunk = self._data[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk


class InfiniteUploadFile:
    def __init__(self):
        self.total_read = 0

    async def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = 1024
        self.total_read += size
        return b"x" * size


class S106ReceiptImageLimitTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        main.app.dependency_overrides.clear()
        self.addCleanup(main.app.dependency_overrides.clear)
        self.service = ReceiptImageService()

    def allow_authenticated_user(self, service):
        async def authenticated_service():
            return service

        main.app.dependency_overrides[main.get_supabase_service] = authenticated_service

    def post_analyze(self, payloads: list[tuple[str, bytes, str]]):
        files = [
            ("files", (name, data, content_type))
            for name, data, content_type in payloads
        ]
        return self.client.post("/analyze", files=files)

    def test_count_eleven_rejects_without_gemini(self):
        self.allow_authenticated_user(object())
        jpeg = _minimal_image_bytes("JPEG")
        payloads = [(f"receipt-{index}.jpg", jpeg, "image/jpeg") for index in range(11)]
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze(payloads)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], SAFE_RECEIPT_IMAGE_COUNT_DETAIL)
        analyze_receipt.assert_not_called()

    def test_count_ten_accepts_and_calls_gemini(self):
        self.allow_authenticated_user(object())
        jpeg = _minimal_image_bytes("JPEG")
        payloads = [(f"receipt-{index}.jpg", jpeg, "image/jpeg") for index in range(10)]
        with patch.object(
            main.gemini_service,
            "analyze_receipt",
            return_value={"receipts": []},
        ) as analyze_receipt:
            response = self.post_analyze(payloads)
        self.assertEqual(response.status_code, 200)
        analyze_receipt.assert_called_once()
        images = analyze_receipt.call_args.args[0]
        self.assertEqual(len(images), 10)
        self.assertTrue(all(mime == "image/jpeg" for _, mime in images))

    def test_individual_over_limit_rejects_without_gemini(self):
        self.allow_authenticated_user(object())
        oversized = b"\x00" * (MAX_RECEIPT_IMAGE_BYTES + 1)
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze([("big.bin", oversized, "image/jpeg")])
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], SAFE_RECEIPT_IMAGE_FILE_SIZE_DETAIL)
        analyze_receipt.assert_not_called()

    def test_total_over_limit_rejects_without_gemini(self):
        large = _large_jpeg_bytes()
        self.assertGreater(len(large) * 2, MAX_RECEIPT_IMAGES_TOTAL_BYTES)

        async def run():
            with self.assertRaises(ReceiptImageValidationError) as ctx:
                await self.service.read_and_validate_uploads(
                    [FakeUploadFile(large), FakeUploadFile(large)]
                )
            self.assertEqual(ctx.exception.detail, SAFE_RECEIPT_IMAGE_TOTAL_SIZE_DETAIL)

        import asyncio

        asyncio.run(run())

        self.allow_authenticated_user(object())
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze(
                [
                    ("a.jpg", large, "image/jpeg"),
                    ("b.jpg", large, "image/jpeg"),
                ]
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["detail"], SAFE_RECEIPT_IMAGE_TOTAL_SIZE_DETAIL
        )
        analyze_receipt.assert_not_called()

    def test_empty_file_rejects_without_gemini(self):
        self.allow_authenticated_user(object())
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze([("empty.jpg", b"", "image/jpeg")])
        self.assertEqual(response.status_code, 422)
        analyze_receipt.assert_not_called()

    def test_truncated_image_rejects_without_gemini(self):
        self.allow_authenticated_user(object())
        truncated = _minimal_image_bytes("PNG")[:10]
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze([("broken.png", truncated, "image/png")])
        self.assertEqual(response.status_code, 422)
        analyze_receipt.assert_not_called()

    def test_fake_bytes_reject_without_gemini(self):
        self.allow_authenticated_user(object())
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze([("fake.jpg", b"not-an-image", "image/jpeg")])
        self.assertEqual(response.status_code, 422)
        analyze_receipt.assert_not_called()

    def test_heif_container_rejects_without_gemini(self):
        self.allow_authenticated_user(object())
        secret_name = "secret-household-heif-name.heic"
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze(
                [(secret_name, _heif_like_bytes(), "image/jpeg")]
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], SAFE_RECEIPT_IMAGE_HEIF_DETAIL)
        self.assertNotIn(secret_name, response.text)
        analyze_receipt.assert_not_called()

    def test_mismatched_claimed_mime_still_uses_detected_format(self):
        self.allow_authenticated_user(object())
        png = _minimal_image_bytes("PNG")
        captured_parts = []

        def capture_analyze(images):
            captured_parts.extend(images)
            return {"receipts": []}

        with patch.object(
            main.gemini_service, "analyze_receipt", side_effect=capture_analyze
        ):
            response = self.post_analyze([("wrong-name.jpg", png, "image/jpeg")])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured_parts[0][1], "image/png")

    def test_gemini_receives_webp_and_png_mime_types(self):
        self.allow_authenticated_user(object())
        with patch.object(
            main.gemini_service,
            "analyze_receipt",
            return_value={"receipts": []},
        ) as analyze_receipt:
            response = self.post_analyze(
                [
                    (
                        "a.webp",
                        _minimal_image_bytes("WEBP"),
                        "application/octet-stream",
                    ),
                    ("b.png", _minimal_image_bytes("PNG"), "text/plain"),
                ]
            )
        self.assertEqual(response.status_code, 200)
        mimes = [mime for _, mime in analyze_receipt.call_args.args[0]]
        self.assertEqual(mimes, ["image/webp", "image/png"])

    def test_valid_formats_accepted_in_combined_request(self):
        self.allow_authenticated_user(object())
        with patch.object(
            main.gemini_service,
            "analyze_receipt",
            return_value={"receipts": []},
        ) as analyze_receipt:
            response = self.post_analyze(
                [
                    ("a.jpeg", _minimal_image_bytes("JPEG"), "image/jpeg"),
                    ("b.png", _minimal_image_bytes("PNG"), "image/png"),
                    ("c.webp", _minimal_image_bytes("WEBP"), "image/webp"),
                ]
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(analyze_receipt.call_args.args[0]), 3)

    def test_pixel_bomb_rejects_without_gemini(self):
        self.allow_authenticated_user(object())
        bomb = _png_with_dimensions(8192, 8192)
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze([("bomb.png", bomb, "image/png")])
        self.assertEqual(response.status_code, 422)
        analyze_receipt.assert_not_called()

    def test_bounded_read_does_not_consume_unbounded_stream(self):
        async def run():
            upload = InfiniteUploadFile()
            with self.assertRaises(ReceiptImageValidationError):
                await self.service.read_and_validate_uploads([upload])
            self.assertLessEqual(upload.total_read, MAX_RECEIPT_IMAGE_BYTES + 1024)

        import asyncio

        asyncio.run(run())

    def test_exact_total_limit_boundary_on_read(self):
        async def run():
            half = MAX_RECEIPT_IMAGES_TOTAL_BYTES // 2
            first = b"a" * half
            second = b"b" * half
            remaining = MAX_RECEIPT_IMAGES_TOTAL_BYTES
            first_read = await _read_upload_bounded(FakeUploadFile(first), remaining)
            remaining -= len(first_read)
            second_read = await _read_upload_bounded(FakeUploadFile(second), remaining)
            self.assertEqual(
                len(first_read) + len(second_read), MAX_RECEIPT_IMAGES_TOTAL_BYTES
            )

        import asyncio

        asyncio.run(run())

    def test_exact_per_file_limit_is_rejected_when_not_valid_image(self):
        async def run():
            payload = b"\x00" * MAX_RECEIPT_IMAGE_BYTES
            with self.assertRaises(ReceiptImageValidationError):
                await self.service.read_and_validate_uploads([FakeUploadFile(payload)])

        import asyncio

        asyncio.run(run())

    def test_per_file_exact_and_over_read_boundaries(self):
        async def run():
            exact = await _read_upload_bounded(
                FakeUploadFile(b"a" * MAX_RECEIPT_IMAGE_BYTES),
                MAX_RECEIPT_IMAGES_TOTAL_BYTES,
            )
            self.assertEqual(len(exact), MAX_RECEIPT_IMAGE_BYTES)
            with self.assertRaises(ReceiptImageValidationError) as ctx:
                await _read_upload_bounded(
                    FakeUploadFile(b"b" * (MAX_RECEIPT_IMAGE_BYTES + 1)),
                    MAX_RECEIPT_IMAGES_TOTAL_BYTES,
                )
            self.assertEqual(ctx.exception.detail, SAFE_RECEIPT_IMAGE_FILE_SIZE_DETAIL)

        import asyncio

        asyncio.run(run())

    def test_validate_receipt_image_bytes_minimum_one_pixel(self):
        for fmt, mime in [
            ("JPEG", "image/jpeg"),
            ("PNG", "image/png"),
            ("WEBP", "image/webp"),
        ]:
            validated = validate_receipt_image_bytes(_minimal_image_bytes(fmt))
            self.assertEqual(validated.mime_type, mime)

    def test_gemini_inline_base64_limit_matches_twelve_mebibytes_raw(self):
        self.assertEqual(MAX_RECEIPT_IMAGES_TOTAL_BYTES, 12_582_912)
        self.assertEqual(
            MAX_RECEIPT_IMAGES_BASE64_CHARS,
            worst_case_split_base64_char_count(
                MAX_RECEIPT_IMAGES_TOTAL_BYTES, MAX_RECEIPT_IMAGES_PER_REQUEST
            ),
        )
        self.assertEqual(MAX_RECEIPT_IMAGES_BASE64_CHARS, 16_777_240)
        self.assertLessEqual(
            MAX_RECEIPT_IMAGES_BASE64_CHARS
            + GEMINI_RECEIPT_ANALYZE_FIXED_OVERHEAD_BYTES,
            GEMINI_INLINE_REQUEST_BYTE_LIMIT,
        )

        service = GeminiService()
        ten_mebi = MAX_RECEIPT_IMAGE_BYTES
        two_mebi = MAX_RECEIPT_IMAGES_TOTAL_BYTES - ten_mebi
        split_pair = [
            (b"x" * ten_mebi, "image/jpeg"),
            (b"y" * two_mebi, "image/jpeg"),
        ]
        service._validate_receipt_images_for_gemini(split_pair)

        half = MAX_RECEIPT_IMAGES_TOTAL_BYTES // 2
        exact_pair = [(b"x" * half, "image/jpeg"), (b"y" * half, "image/jpeg")]
        service._validate_receipt_images_for_gemini(exact_pair)
        over_pair = [
            (b"x" * (half + 1), "image/jpeg"),
            (b"y" * half, "image/jpeg"),
        ]
        with self.assertRaises(ValueError):
            service._validate_receipt_images_for_gemini(over_pair)

    def test_twelve_mebibyte_split_ten_plus_two_reaches_gemini(self):
        self.allow_authenticated_user(object())
        large = _jpeg_exact_size(MAX_RECEIPT_IMAGE_BYTES)
        small = _jpeg_exact_size(
            MAX_RECEIPT_IMAGES_TOTAL_BYTES - MAX_RECEIPT_IMAGE_BYTES
        )
        self.assertEqual(len(large) + len(small), MAX_RECEIPT_IMAGES_TOTAL_BYTES)
        with patch.object(
            main.gemini_service,
            "analyze_receipt",
            return_value={"receipts": []},
        ) as analyze_receipt:
            response = self.post_analyze(
                [
                    ("a.jpg", large, "image/jpeg"),
                    ("b.jpg", small, "image/jpeg"),
                ]
            )
        self.assertEqual(response.status_code, 200)
        analyze_receipt.assert_called_once()
        images = analyze_receipt.call_args.args[0]
        self.assertEqual(len(images), 2)
        self.assertEqual(
            len(images[0][0]) + len(images[1][0]), MAX_RECEIPT_IMAGES_TOTAL_BYTES
        )

    def test_exact_ten_mebibyte_valid_jpeg_reaches_gemini(self):
        self.allow_authenticated_user(object())
        payload = _jpeg_exact_size(MAX_RECEIPT_IMAGE_BYTES)
        self.assertEqual(len(payload), MAX_RECEIPT_IMAGE_BYTES)
        with patch.object(
            main.gemini_service,
            "analyze_receipt",
            return_value={"receipts": []},
        ) as analyze_receipt:
            response = self.post_analyze([("receipt.jpg", payload, "image/jpeg")])
        self.assertEqual(response.status_code, 200)
        analyze_receipt.assert_called_once()
        sent = analyze_receipt.call_args.args[0]
        self.assertEqual(len(sent[0][0]), MAX_RECEIPT_IMAGE_BYTES)
        self.assertEqual(sent[0][1], "image/jpeg")

    def test_gemini_service_rejects_disallowed_mime_before_api_call(self):
        service = GeminiService()
        with patch.object(
            service.client.models, "generate_content"
        ) as generate_content:
            with self.assertRaises(ValueError):
                service.analyze_receipt([(_minimal_image_bytes("JPEG"), "image/gif")])
        generate_content.assert_not_called()

    def test_analyze_error_response_is_safe(self):
        self.allow_authenticated_user(object())
        secret = "secret-receipt-filename-value.jpg"
        with patch.object(main.gemini_service, "analyze_receipt") as analyze_receipt:
            response = self.post_analyze(
                [(secret, _heif_like_bytes(), "image/jpeg")],
            )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn(secret, response.text)
        analyze_receipt.assert_not_called()

    def test_heif_rejection_does_not_call_logger_error_or_leak_filename(self):
        self.allow_authenticated_user(object())
        secret_name = "secret-household-heif-name.heic"
        with patch.object(main.logger, "error") as log_error:
            with patch.object(
                main.gemini_service, "analyze_receipt"
            ) as analyze_receipt:
                response = self.post_analyze(
                    [(secret_name, _heif_like_bytes(), "image/jpeg")]
                )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], SAFE_RECEIPT_IMAGE_HEIF_DETAIL)
        self.assertNotIn(secret_name, response.text)
        log_error.assert_not_called()
        analyze_receipt.assert_not_called()

    def test_gemini_failure_safe_500_without_secrets_in_logger_error_args(self):
        self.allow_authenticated_user(object())
        secret_marker = "GEMINI_FAILURE_SECRET_EXCEPTION_MARKER"
        secret_filename = "secret-receipt-filename-on-success-path.jpg"
        jpeg = _minimal_image_bytes("JPEG")

        def raise_with_marker(_images):
            raise RuntimeError(f"simulated gemini failure {secret_marker}")

        with patch.object(main.logger, "error") as log_error:
            with patch.object(
                main.gemini_service,
                "analyze_receipt",
                side_effect=raise_with_marker,
            ):
                response = self.post_analyze([(secret_filename, jpeg, "image/jpeg")])
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], main.SAFE_INTERNAL_ERROR_DETAIL)
        self.assertNotIn(secret_marker, response.text)
        self.assertNotIn(secret_filename, response.text)
        log_error.assert_called_once()
        logged_args = repr(log_error.call_args)
        self.assertNotIn(secret_marker, logged_args)
        self.assertNotIn(secret_filename, logged_args)
        self.assertNotIn(jpeg.hex(), logged_args)

    def test_constants_match_request_policy(self):
        self.assertEqual(MAX_RECEIPT_IMAGES_PER_REQUEST, 10)
        self.assertEqual(MAX_RECEIPT_IMAGE_BYTES, 10 * 1024 * 1024)
        self.assertEqual(MAX_RECEIPT_IMAGES_TOTAL_BYTES, 12 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
