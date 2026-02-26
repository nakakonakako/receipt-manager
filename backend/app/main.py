from app.schemas.csv import CsvAnalysisRequest, CsvParseResponse, CsvSaveRequest
from app.schemas.receipt import ReceiptData, SearchQuery
from app.services.csv_service import CsvService
from app.services.gemini_service import GeminiService
from app.services.sheets_service import SheetsService
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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
csv_service = CsvService()


@app.get("/")
def read_root():
    return {"message": "Receipt Manager API is running."}


async def get_user_sheets_service(
    x_access_token: str = Header(..., alias="x-access-token"),
    x_spreadsheet_id: str = Header(..., alias="x-spreadsheet-id"),
) -> SheetsService:
    try:
        return SheetsService(
            access_token=x_access_token, spreadsheet_id=x_spreadsheet_id
        )
    except Exception as e:
        raise HTTPException(
            status_code=401, detail=f"Google Sheetsの認証に失敗しました: {str(e)}"
        )


@app.post("/analyze")
async def analyze_receipt(files: list[UploadFile] = File(...)):
    try:
        image_bytes_list = [await file.read() for file in files]
        result = gemini_service.analyze_receipt(image_bytes_list)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/save")
async def save_receipt(
    data: ReceiptData,
    sheets_service: SheetsService = Depends(get_user_sheets_service),
):
    try:
        result = sheets_service.add_receipt_data(data)
        return {"message": "Receipt data saved successfully.", "details": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search")
async def search_receipts(
    search_query: SearchQuery,
    sheets_service: SheetsService = Depends(get_user_sheets_service),
):
    try:
        data = sheets_service.get_all_data(
            data_type=search_query.data_type, period=search_query.period
        )

        if not data or len(data.strip().split("\n")) <= 1:
            return {"answer": "合致するレシートデータが存在しません。"}

        answer = gemini_service.answer_question(search_query.query, data)

        return {"answer": answer}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze_csv")
async def analyze_csv(request: CsvAnalysisRequest):
    try:
        if request.mapping:
            mapping = request.mapping
        else:
            lines = request.csv_text.strip().split("\n")
            sample_text = "\n".join(lines[:5])
            mapping = gemini_service.analyze_csv(sample_text)

        transactions = csv_service.parse_csv(request.csv_text, mapping)

        return CsvParseResponse(transactions=transactions, mapping=mapping)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/save_csv")
async def save_csv(
    request: CsvSaveRequest,
    sheets_service: SheetsService = Depends(get_user_sheets_service),
):
    try:
        result = sheets_service.add_csv_data(request.transactions)
        return {"message": "CSV data saved successfully.", "details": result}
    except Exception as e:
        if "RATE_LIMIT_EXCEEDED" in str(e):
            raise HTTPException(status_code=429, detail="API rate limit exceeded")
        raise HTTPException(status_code=500, detail=str(e))
