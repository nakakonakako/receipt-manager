import datetime
import json
import logging
import os

from app.schemas.csv import CsvMapping
from app.schemas.receipt import ReceiptDatas
from app.schemas.receipt_image import (
    ALLOWED_RECEIPT_IMAGE_MIME_TYPES,
    MAX_RECEIPT_IMAGE_BYTES,
    MAX_RECEIPT_IMAGES_PER_REQUEST,
    MAX_RECEIPT_IMAGES_TOTAL_BYTES,
    worst_case_split_base64_char_count,
)
from app.services.ai_usage import (
    GeminiInvalidOutput,
    ModelResult,
    token_usage_from_response,
)
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()
logger = logging.getLogger(__name__)


class GeminiService:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        self.client = genai.Client(
            api_key=api_key,
            # google-genai 1.53: timeout is milliseconds. retry_options=None
            # is a single attempt, so this is one 120 second HTTP timeout.
            http_options=types.HttpOptions(timeout=120_000),
        )

    def _validate_receipt_images_for_gemini(
        self, images: list[tuple[bytes, str]]
    ) -> None:
        if not images:
            raise ValueError("receipt images required")
        if len(images) > MAX_RECEIPT_IMAGES_PER_REQUEST:
            raise ValueError("too many receipt images")
        total_raw = 0
        total_base64_chars = 0
        for image_bytes, mime_type in images:
            if mime_type not in ALLOWED_RECEIPT_IMAGE_MIME_TYPES:
                raise ValueError("unsupported receipt image mime")
            if len(image_bytes) == 0 or len(image_bytes) > MAX_RECEIPT_IMAGE_BYTES:
                raise ValueError("receipt image size out of range")
            total_raw += len(image_bytes)
            total_base64_chars += ((len(image_bytes) + 2) // 3) * 4
        if total_raw > MAX_RECEIPT_IMAGES_TOTAL_BYTES:
            raise ValueError("receipt images total size out of range")
        base64_limit = worst_case_split_base64_char_count(total_raw, len(images))
        if total_base64_chars > base64_limit:
            raise ValueError("receipt images base64 payload out of range")

    def analyze_receipt(self, images: list[tuple[bytes, str]]) -> dict:
        self._validate_receipt_images_for_gemini(images)
        config = types.GenerateContentConfig(
            temperature=0.0,
            response_mime_type="application/json",
            response_schema=ReceiptDatas,
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.LOW
            ),
        )

        prompt = """
        Analyze the receipt image(s) and extract data according to the schema.
        If multiple images are provided, they are parts of a single long receipt. 
        Please combine the items appropriately without duplicating them.
        """

        contents = [
            types.Part.from_bytes(data=img_bytes, mime_type=mime_type)
            for img_bytes, mime_type in images
        ]
        contents.append(prompt)

        try:
            response = self.client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=contents,
                config=config,
            )
        except Exception:
            logger.error("Gemini receipt analysis failed")
            raise
        usage = token_usage_from_response(response)
        try:
            parsed = json.loads(response.text)
        except Exception:
            logger.error("Gemini receipt analysis failed")
            raise GeminiInvalidOutput(usage) from None
        return ModelResult(parsed, usage)

    def answer_question(self, question: str, context_data: str) -> str:
        today = datetime.date.today().strftime("%Y-%m-%d")

        prompt = f"""
        You are a dedicated personal household account book assistant.
        Please answer the user's question based strictly on the following receipt data (CSV format).

        # Constraints
        - Today is {today}.
        - Base your answers ONLY on the provided data.
        - If the information is not present in the data, strictly answer with "分かりません" (I don't know).
        - Respond in a friendly and polite Japanese tone. Use conversational endings such as "～ですね" or "～ですよ".
        - NEVER use Markdown `**` for emphasis in your response. If you want to emphasize a specific word, you MUST use the HTML `<b>` tag instead.

        # Receipt Data
        Format: Purchase Date, Item Name, Store Name, Amount
        ---
        {context_data}
        ---

        # User's Question
        {question}
        """

        try:
            response = self.client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=[prompt],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    thinking_config=types.ThinkingConfig(
                        thinking_level=types.ThinkingLevel.LOW
                    ),
                ),
            )
        except Exception:
            logger.error("Gemini question answering failed")
            raise
        usage = token_usage_from_response(response)
        try:
            answer = response.text
        except Exception:
            logger.error("Gemini question answering failed")
            raise GeminiInvalidOutput(usage) from None
        if not isinstance(answer, str):
            logger.error("Gemini question answering failed")
            raise GeminiInvalidOutput(usage)
        return ModelResult(answer, usage)

    def analyze_csv(self, csv_sample: str) -> dict:
        prompt = "Analyze the provided CSV sample lines and determine the column indices according to the schema."

        try:
            response = self.client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=[prompt, f"CSV Sample:\n{csv_sample}"],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                    response_schema=CsvMapping,
                    thinking_config=types.ThinkingConfig(
                        thinking_level=types.ThinkingLevel.LOW
                    ),
                ),
            )
        except Exception:
            logger.error("Gemini CSV mapping failed")
            raise
        usage = token_usage_from_response(response)
        try:
            parsed = json.loads(response.text)
        except Exception:
            logger.error("Gemini CSV mapping failed")
            raise GeminiInvalidOutput(usage) from None
        return ModelResult(parsed, usage)
