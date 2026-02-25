from typing import Any

from pydantic import BaseModel, Field


class CsvAnalysisRequest(BaseModel):
    csv_text: str
    mapping: dict[str, Any] | None = None


class CsvMapping(BaseModel):
    has_header: bool = Field(
        description="True if the 1st row contains column headers (like '日付', 'ご利用店名'). False if it starts directly with transaction data."
    )
    date_col_index: int = Field(
        description="0-based column index for the transaction Date (e.g., '利用日', 'お取扱日')."
    )
    store_col_index: int = Field(
        description="0-based column index for the Store name or Payee (e.g., 'ご利用店名', '摘要')."
    )
    price_col_index: int = Field(
        description="0-based column index for the Withdrawal Amount or Expense (e.g., 'お支払金額', '出金金額', 'ご利用金額'). If there are separate columns for income and expense, choose the expense column."
    )


class ParsedCsvTransaction(BaseModel):
    date: str
    store: str
    price: int


class CsvParseResponse(BaseModel):
    transactions: list[ParsedCsvTransaction]
    mapping: dict[str, Any]


class CsvSaveRequest(BaseModel):
    transactions: list[ParsedCsvTransaction]
