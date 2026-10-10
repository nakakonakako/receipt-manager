import asyncio
import logging

from app.schemas.csv import (
    CsvAnalysisRequest,
    CsvParseResponse,
    CsvSaveRequest,
)
from app.schemas.receipt import ReceiptData, SearchQuery
from app.services.csv_service import CsvService
from app.services.gemini_service import GeminiService
from app.services.supabase_service import InvalidSupabaseTokenError, SupabaseService
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile

app = FastAPI()
logger = logging.getLogger(__name__)
SAFE_INTERNAL_ERROR_DETAIL = "Internal Server Error"
SAFE_AUTH_ERROR_DETAIL = "Invalid authentication credentials."

load_dotenv()

gemini_service = GeminiService()
csv_service = CsvService()
MAX_CSV_MAPPING_SAMPLE_CHARACTERS = 10_000


def _internal_server_error(operation: str) -> HTTPException:
    logger.error("Unexpected error while processing endpoint %s", operation)
    return HTTPException(status_code=500, detail=SAFE_INTERNAL_ERROR_DETAIL)


@app.get("/")
def read_root():
    return {"message": "Receipt Manager API is running."}


async def get_supabase_service(
    x_supabase_token: str = Header(..., alias="x-supabase-token"),
) -> SupabaseService:
    try:
        return await asyncio.to_thread(SupabaseService, token=x_supabase_token)
    except HTTPException:
        raise
    except InvalidSupabaseTokenError:
        raise HTTPException(status_code=401, detail=SAFE_AUTH_ERROR_DETAIL) from None
    except Exception:
        raise _internal_server_error("authentication") from None


@app.post("/analyze")
async def analyze_receipt(
    files: list[UploadFile] = File(...),
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        image_bytes_list = [await file.read() for file in files]
        result = await asyncio.to_thread(
            gemini_service.analyze_receipt, image_bytes_list
        )

        item_names = []
        for receipt in result.get("receipts", []):
            for item in receipt.get("items", []):
                item_names.append(item["item_name"])

        if item_names:
            learned_data = await asyncio.to_thread(
                supabase_service.get_learned_categories, item_names
            )

            for receipt in result.get("receipts", []):
                for item in receipt.get("items", []):
                    name = item["item_name"]
                    if name in learned_data:
                        pref = learned_data[name]
                        if pref.get("main_category") is not None:
                            item["main_category"] = pref["main_category"]
                        if pref.get("sub_category") is not None:
                            item["sub_category"] = pref["sub_category"]

        return result

    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("analyze") from None


@app.post("/save")
async def save_receipt(
    data: ReceiptData,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = await asyncio.to_thread(supabase_service.add_receipt_data, data)
        return {"message": "Receipt data saved successfully.", "details": result}

    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("save") from None


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

    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("search") from None


@app.get("/available_months")
async def get_available_months(
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        return supabase_service.get_available_months()
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("available_months") from None


@app.get("/transactions")
async def get_transactions(
    month: str,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        data = supabase_service.get_transactions_by_month(month)
        return data
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("transactions") from None


def _get_csv_mapping_sample(csv_text: str) -> str:
    sample_end = 0
    sample_limit = min(len(csv_text), MAX_CSV_MAPPING_SAMPLE_CHARACTERS)
    line_count = 0

    while sample_end < sample_limit and line_count < 5:
        newline = csv_text.find("\n", sample_end, sample_limit)
        if newline == -1:
            sample_end = sample_limit
            break
        sample_end = newline + 1
        line_count += 1

    return csv_text[:sample_end].strip()


@app.post("/analyze_csv")
async def analyze_csv(
    request: CsvAnalysisRequest,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        if request.mapping is not None:
            mapping = request.mapping
        else:
            sample_text = _get_csv_mapping_sample(request.csv_text)
            mapping = gemini_service.analyze_csv(sample_text)

        transactions = csv_service.parse_csv(request.csv_text, mapping)

        return CsvParseResponse(transactions=transactions, mapping=mapping)
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("analyze_csv") from None


@app.post("/save_csv")
async def save_csv(
    request: CsvSaveRequest,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.add_csv_data(request.transactions)
        return {"message": "CSV data saved successfully.", "details": result}
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("save_csv") from None


@app.put("/receipts/{receipt_id}")
async def update_receipt(
    receipt_id: str,
    payload: dict,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.update_receipt(receipt_id, payload)
        return result
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("update_receipt") from None


@app.put("/csv_transactions/{transaction_id}")
async def update_csv_transaction(
    transaction_id: str,
    payload: dict,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.update_csv_transaction(transaction_id, payload)
        return result
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("update_csv_transaction") from None


@app.delete("/receipts/{receipt_id}")
async def delete_receipt(
    receipt_id: str,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.delete_receipt(receipt_id)
        return result
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("delete_receipt") from None


@app.delete("/csv_transactions/{transaction_id}")
async def delete_csv_transaction(
    transaction_id: str,
    supabase_service: SupabaseService = Depends(get_supabase_service),
):
    try:
        result = supabase_service.delete_csv_transaction(transaction_id)
        return result
    except HTTPException:
        raise
    except Exception:
        raise _internal_server_error("delete_csv_transaction") from None
