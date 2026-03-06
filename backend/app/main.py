from app.schemas.csv import CsvAnalysisRequest, CsvParseResponse, CsvSaveRequest
from app.schemas.receipt import ReceiptData, SearchQuery
from app.services.csv_service import CsvService
from app.services.gemini_service import GeminiService
from app.services.supabase_service import SupabaseService
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


async def get_supabase_service(
    x_supabase_token: str = Header(..., alias="x-supabase-token"),
) -> SupabaseService:
    try:
        return SupabaseService(token=x_supabase_token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


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
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.add_receipt_data(data)
        return {"message": "Receipt data saved successfully.", "details": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search")
async def search_receipts(
    search_query: SearchQuery,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        data = supabase_service.get_all_data(
            data_type=search_query.data_type, period=search_query.period
        )
        if not data or len(data.strip().split("\n")) <= 1:
            return {"answer": "合致するレシートデータが存在しません。"}

        answer = gemini_service.answer_question(search_query.query, data)
        return {"answer": answer}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/available_months")
async def get_available_months(
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        return supabase_service.get_available_months()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/transactions")
async def get_transactions(
    month: str,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        data = supabase_service.get_transactions_by_month(month)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze_csv")
async def analyze_csv(request: CsvAnalysisRequest):
    try:
        if request.mapping is not None:
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
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.add_csv_data(request.transactions)
        return {"message": "CSV data saved successfully.", "details": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/receipts/{receipt_id}")
async def update_receipt(
    receipt_id: str,
    payload: dict,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.update_receipt(receipt_id, payload)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/csv_transactions/{transaction_id}")
async def update_csv_transaction(
    transaction_id: str,
    payload: dict,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.update_csv_transaction(transaction_id, payload)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/receipts/{receipt_id}")
async def delete_receipt(
    receipt_id: str,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.delete_receipt(receipt_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/csv_transactions/{transaction_id}")
async def delete_csv_transaction(
    transaction_id: str,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.delete_csv_transaction(transaction_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
