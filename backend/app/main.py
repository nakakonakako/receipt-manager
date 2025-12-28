from app.services.gemini_service import GeminiService, ReceiptData
from app.services.sheets_service import SheetsService
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

gemini_service = GeminiService()
sheets_service = SheetsService()


class SearchQuery(BaseModel):
    question: str


@app.get("/")
def read_root():
    return {"message": "Receipt Manager API is running."}


@app.post("/analyze")
async def analyze_receipt(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        result = gemini_service.analyze_receipt(image_bytes)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/save")
async def save_receipt(data: ReceiptData):
    try:
        result = sheets_service.add_receipt_data(data)
        return {"message": "Receipt data saved successfully.", "details": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search")
async def search_receipts(search_query: SearchQuery):
    try:
        data = sheets_service.get_all_data()

        if not data:
            return {"answer": "レシートデータが存在しません。"}

        answer = gemini_service.answer_question(search_query.question, data)

        return {"answer": answer}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
