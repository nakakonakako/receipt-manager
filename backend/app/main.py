import os

from app.schemas.common import PasswordCheck
from app.schemas.csv import CsvAnalysisRequest
from app.schemas.receipt import ReceiptData, SearchQuery
from app.services.gemini_service import GeminiService
from app.services.sheets_service import SheetsService
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Security, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

load_dotenv()

gemini_service = GeminiService()
sheets_service = SheetsService()

api_key_header = APIKeyHeader(name="x-api-key", auto_error=False)


@app.get("/")
def read_root():
    return {"message": "Receipt Manager API is running."}


async def verify_api_key(api_key: str = Security(api_key_header)):
    if api_key == os.getenv("APP_PASSWORD"):
        return api_key
    else:
        raise HTTPException(status_code=403, detail="認証されていません")


@app.post("/check_auth")
async def check_auth(data: PasswordCheck):
    APP_PASSWORD = os.getenv("APP_PASSWORD")
    if data.password == APP_PASSWORD:
        return {"status": "ok", "message": "認証成功"}
    else:
        raise HTTPException(status_code=401, detail="パスワードが違います")


@app.post("/analyze", dependencies=[Depends(verify_api_key)])
async def analyze_receipt(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        result = gemini_service.analyze_receipt(image_bytes)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/save", dependencies=[Depends(verify_api_key)])
async def save_receipt(data: ReceiptData):
    try:
        result = sheets_service.add_receipt_data(data)
        return {"message": "Receipt data saved successfully.", "details": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", dependencies=[Depends(verify_api_key)])
async def search_receipts(search_query: SearchQuery):
    try:
        data = sheets_service.get_all_data()

        if not data:
            return {"answer": "レシートデータが存在しません。"}

        answer = gemini_service.answer_question(search_query.query, data)

        return {"answer": answer}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze_csv", dependencies=[Depends(verify_api_key)])
async def analyze_csv(request: CsvAnalysisRequest):
    try:
        result = gemini_service.analyze_csv(request.csv_text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
