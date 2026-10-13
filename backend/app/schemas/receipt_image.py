MEBIBYTE = 1024 * 1024
MAX_RECEIPT_IMAGES_PER_REQUEST = 10
MAX_RECEIPT_IMAGE_BYTES = 10 * MEBIBYTE
MAX_RECEIPT_IMAGES_TOTAL_BYTES = 12 * MEBIBYTE

GEMINI_INLINE_REQUEST_BYTE_LIMIT = 20_000_000
# Prompt, response_schema, and JSON/MIME Part wrappers (up to 10 images); not measured per request.
GEMINI_RECEIPT_ANALYZE_FIXED_OVERHEAD_BYTES = 512_000


def worst_case_split_base64_char_count(
    total_raw_bytes: int,
    max_parts: int = MAX_RECEIPT_IMAGES_PER_REQUEST,
) -> int:
    """Upper bound on base64 length when total_raw_bytes is split across ≤ max_parts blobs."""
    if total_raw_bytes <= 0:
        return 0
    part_count = min(max_parts, total_raw_bytes)
    if part_count <= 1:
        return ((total_raw_bytes + 2) // 3) * 4
    singleton_parts = min(part_count - 1, total_raw_bytes - 1)
    remainder = total_raw_bytes - singleton_parts
    return singleton_parts * 4 + ((remainder + 2) // 3) * 4


# Worst-case padding when 12 MiB is split across up to 10 independently encoded parts.
MAX_RECEIPT_IMAGES_BASE64_CHARS = worst_case_split_base64_char_count(
    MAX_RECEIPT_IMAGES_TOTAL_BYTES,
    MAX_RECEIPT_IMAGES_PER_REQUEST,
)

ALLOWED_RECEIPT_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
