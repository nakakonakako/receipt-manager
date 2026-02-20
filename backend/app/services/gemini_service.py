import datetime
import json
import os

from app.schemas.csv import CsvMapping
from app.schemas.receipt import ReceiptDatas
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()


class GeminiService:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        self.client = genai.Client(api_key=api_key)

    def analyze_receipt(self, image_bytes: bytes) -> dict:
        config = types.GenerateContentConfig(
            temperature=0.0,
            response_mime_type="application/json",
            response_schema=ReceiptDatas,
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.LOW
            ),
        )

        prompt = "Analyze the receipt image and extract data according to the schema."

        try:
            response = self.client.models.generate_content(
                model="gemini-3-flash-preview",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=config,
            )
            return json.loads(response.text)
        except Exception as e:
            print(f"Error during Gemini API call: {e}")
            raise e

    def answer_question(self, question: str, context_data: str) -> str:
        today = datetime.date.today().strftime("%Y-%m-%d")

        prompt = f"""
        あなたは専属の家計簿アシスタントです。
        以下のレシートデータ（CSV形式）をもとに、ユーザーの質問に答えてください。

        # 制約事項
        - 今日は {today} です。
        - 提供されたデータのみを根拠に回答してください。
        - データにないことは「分かりません」と答えてください。
        - 計算が必要な場合は、ステップを踏んで正確に計算してください。
        - 語尾は「～ですね」「～ですよ」など、親しみやすい丁寧語を使ってください。

        # レシートデータ
        フォーマット: 購入日, 商品名, 店舗名, 金額
        ---
        {context_data}
        ---

        # ユーザーの質問
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
            return response.text
        except Exception as e:
            print(f"Error during Gemini API call: {e}")
            raise e

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

            return json.loads(response.text)

        except Exception as e:
            print(f"Gemini CSV Mapping Error: {e}")
            raise e
