from dataclasses import dataclass
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

MEBIBYTE = 1024 * 1024
MAX_RECEIPT_IMAGES_PER_REQUEST = 10
MAX_RECEIPT_IMAGE_BYTES = 10 * MEBIBYTE
MAX_RECEIPT_IMAGES_TOTAL_BYTES = 12 * MEBIBYTE
MAX_RECEIPT_IMAGE_PIXELS = 16_777_216
READ_CHUNK_SIZE = 64 * 1024

SUPPORTED_PIL_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
FORMAT_TO_MIME = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}

HEIF_BRANDS = frozenset(
    {
        b"heic",
        b"heix",
        b"heim",
        b"heis",
        b"hevc",
        b"hevx",
        b"mif1",
        b"msf1",
        b"avis",
        b"ncdi",
    }
)

SAFE_RECEIPT_IMAGE_COUNT_DETAIL = (
    "レシート画像は1回の送信で10枚までです。枚数を減らして再度お試しください。"
)
SAFE_RECEIPT_IMAGE_FILE_SIZE_DETAIL = (
    "画像が大きすぎます。1枚あたり10MiB以下のファイルを選んでください。"
)
SAFE_RECEIPT_IMAGE_TOTAL_SIZE_DETAIL = (
    "選択した画像の合計サイズが上限を超えています。"
    "枚数を減らすか、より小さい画像（合計12MiB以下）を選んでください。"
)
SAFE_RECEIPT_IMAGE_EMPTY_DETAIL = (
    "空の画像ファイルは送信できません。別の画像を選んでください。"
)
SAFE_RECEIPT_IMAGE_UNSUPPORTED_DETAIL = (
    "この画像形式はサポートされていません。"
    "JPEG、PNG、またはWebP形式の画像を選んでください。"
)
SAFE_RECEIPT_IMAGE_HEIF_DETAIL = (
    "HEIC/HEIF形式の画像は現在サポートされていません。"
    "JPEG、PNG、またはWebPに変換してから再度お試しください。"
)
SAFE_RECEIPT_IMAGE_CORRUPT_DETAIL = (
    "画像を読み取れませんでした。破損しているか、対応していない形式の可能性があります。"
    "JPEG、PNG、またはWebPの別ファイルをお試しください。"
)
SAFE_RECEIPT_IMAGE_PIXEL_LIMIT_DETAIL = (
    "画像の解像度が上限を超えています。より小さい画像を選ぶか、"
    "JPEG、PNG、またはWebPに変換してから再度お試しください。"
)


class ReceiptImageValidationError(ValueError):
    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class ValidatedReceiptImage:
    data: bytes
    mime_type: str


def is_heif_container(data: bytes) -> bool:
    if len(data) < 12 or data[4:8] != b"ftyp":
        return False
    header = data[8 : min(len(data), 64)]
    for offset in range(0, len(header) - 3, 4):
        if header[offset : offset + 4] in HEIF_BRANDS:
            return True
    return False


def validate_receipt_image_bytes(data: bytes) -> ValidatedReceiptImage:
    if len(data) == 0:
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_EMPTY_DETAIL)
    if is_heif_container(data):
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_HEIF_DETAIL)

    image_format: str | None = None
    try:
        with Image.open(BytesIO(data)) as image:
            width, height = image.size
            if width <= 0 or height <= 0:
                raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_CORRUPT_DETAIL)
            if width * height > MAX_RECEIPT_IMAGE_PIXELS:
                raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_PIXEL_LIMIT_DETAIL)
            image_format = image.format
            if image_format not in SUPPORTED_PIL_FORMATS:
                raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_UNSUPPORTED_DETAIL)
            image.verify()
    except ReceiptImageValidationError:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_CORRUPT_DETAIL) from None

    mime_type = FORMAT_TO_MIME.get(image_format or "")
    if not mime_type:
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_UNSUPPORTED_DETAIL)
    return ValidatedReceiptImage(data=data, mime_type=mime_type)


async def _read_upload_bounded(
    upload: UploadFile,
    remaining_total_bytes: int,
) -> bytes:
    per_file_limit = min(MAX_RECEIPT_IMAGE_BYTES, remaining_total_bytes)
    if per_file_limit < 0:
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_TOTAL_SIZE_DETAIL)

    read_cap = per_file_limit + 1
    buffer = bytearray()
    while len(buffer) < read_cap:
        chunk_limit = min(READ_CHUNK_SIZE, read_cap - len(buffer))
        chunk = await upload.read(chunk_limit)
        if not chunk:
            break
        buffer.extend(chunk)

    if len(buffer) == 0:
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_EMPTY_DETAIL)
    if len(buffer) > MAX_RECEIPT_IMAGE_BYTES:
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_FILE_SIZE_DETAIL)
    if len(buffer) > remaining_total_bytes:
        raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_TOTAL_SIZE_DETAIL)
    return bytes(buffer)


class ReceiptImageService:
    async def read_and_validate_uploads(
        self, uploads: list[UploadFile]
    ) -> list[ValidatedReceiptImage]:
        if len(uploads) > MAX_RECEIPT_IMAGES_PER_REQUEST:
            raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_COUNT_DETAIL)
        if len(uploads) == 0:
            raise ReceiptImageValidationError(SAFE_RECEIPT_IMAGE_EMPTY_DETAIL)

        validated: list[ValidatedReceiptImage] = []
        remaining_total = MAX_RECEIPT_IMAGES_TOTAL_BYTES

        for upload in uploads:
            payload = await _read_upload_bounded(upload, remaining_total)
            validated_image = validate_receipt_image_bytes(payload)
            validated.append(validated_image)
            remaining_total -= len(payload)

        return validated
