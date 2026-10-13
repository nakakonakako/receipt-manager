import asyncio
import logging

from app.schemas.csv import (
    CsvAnalysisRequest,
    CsvMapping,
    CsvParseResponse,
    CsvSaveRequest,
)
from app.schemas.receipt import ReceiptData, SearchQuery
from app.services.csv_service import CsvRowLimitError, CsvService
from app.services.gemini_service import GeminiService
from app.services.receipt_image_service import (
    ReceiptImageService,
    ReceiptImageValidationError,
)
from app.services.supabase_service import (
    InvalidSupabaseTokenError,
    SearchDataLimitError,
    SupabaseService,
)
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

app = FastAPI()
logger = logging.getLogger(__name__)
SAFE_INTERNAL_ERROR_DETAIL = "Internal Server Error"
SAFE_AUTH_ERROR_DETAIL = "Invalid authentication credentials."

load_dotenv()

gemini_service = GeminiService()
csv_service = CsvService()
receipt_image_service = ReceiptImageService()
MAX_CSV_MAPPING_SAMPLE_CHARACTERS = 10_000
SAFE_VALIDATION_ERROR_DETAIL = "入力内容を確認してください。"
SAFE_SEARCH_DATA_LIMIT_DETAIL = (
    "検索対象のデータ量が上限を超えています。対象期間を短くして再度お試しください。"
)
SAFE_CSV_MAPPING_ERROR_DETAIL = "列マッピングを確認してください。CSVの列に合うプリセットを選択するか、AIで列を判定してください。"


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_, __: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": SAFE_VALIDATION_ERROR_DETAIL},
    )


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
        validated_images = await receipt_image_service.read_and_validate_uploads(files)
        result = await asyncio.to_thread(
            gemini_service.analyze_receipt,
            [(image.data, image.mime_type) for image in validated_images],
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
    except ReceiptImageValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.detail) from None
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
        if not data or data == "purchase_date,store_name,item_name,price":
            return {"answer": "合致するレシートデータが存在しません。"}

        answer = gemini_service.answer_question(search_query.query, data)
        return {"answer": answer}

    except HTTPException:
        raise
    except SearchDataLimitError:
        raise HTTPException(
            status_code=422, detail=SAFE_SEARCH_DATA_LIMIT_DETAIL
        ) from None
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
        csv_service.validate_csv_limits(request.csv_text)
        if request.mapping is not None:
            mapping = request.mapping
        else:
            sample_text = _get_csv_mapping_sample(request.csv_text)
            try:
                mapping = CsvMapping.model_validate(
                    gemini_service.analyze_csv(sample_text)
                )
            except ValidationError:
                raise HTTPException(
                    status_code=422, detail=SAFE_CSV_MAPPING_ERROR_DETAIL
                ) from None

        try:
            csv_service.validate_mapping_columns(request.csv_text, mapping)
        except ValueError:
            raise HTTPException(
                status_code=422, detail=SAFE_CSV_MAPPING_ERROR_DETAIL
            ) from None

        transactions = csv_service.parse_csv(request.csv_text, mapping)

        return CsvParseResponse(transactions=transactions, mapping=mapping)
    except HTTPException:
        raise
    except CsvRowLimitError:
        raise HTTPException(
            status_code=422,
            detail="CSVは20,000行以内にしてください。",
        ) from None
    except ValueError:
        raise HTTPException(
            status_code=422, detail="CSVの内容を確認してください。"
        ) from None
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
