from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
)

MAX_CSV_TEXT_CHARACTERS = 20 * 1024 * 1024
MAX_CSV_ROWS = 20_000


class CsvAnalysisRequest(BaseModel):
    csv_text: str = Field(min_length=1, max_length=MAX_CSV_TEXT_CHARACTERS)
    mapping: "CsvMapping | None" = None

    @field_validator("mapping", mode="before")
    @classmethod
    def adapt_legacy_preset_mapping(cls, value):
        if not isinstance(value, dict):
            return value

        legacy_keys = {
            "date_col_idx",
            "item_col_idx",
            "store_col_idx",
            "price_col_idx",
            "confidence",
        }
        if set(value) != legacy_keys:
            return value

        index_values = [
            value["date_col_idx"],
            value["item_col_idx"],
            value["store_col_idx"],
            value["price_col_idx"],
        ]
        if any(type(index) is not int or index < 0 for index in index_values):
            return value

        confidence = value["confidence"]
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not 0 <= confidence <= 1
        ):
            return value

        return {
            "has_header": False,
            "date_col_index": value["date_col_idx"],
            "store_col_index": value["store_col_idx"],
            "price_col_index": value["price_col_idx"],
        }


class CsvMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    has_header: StrictBool = Field(
        description="True if the 1st row contains column headers (like '日付', 'ご利用店名'). False if it starts directly with transaction data."
    )
    date_col_index: StrictInt = Field(
        ge=0,
        description="0-based column index for the transaction Date (e.g., '利用日', 'お取扱日').",
    )
    store_col_index: StrictInt = Field(
        ge=0,
        description="0-based column index for the Store name or Payee (e.g., 'ご利用店名', '摘要').",
    )
    price_col_index: StrictInt = Field(
        ge=0,
        description="0-based column index for the Withdrawal Amount or Expense (e.g., 'お支払金額', '出金金額', 'ご利用金額'). If there are separate columns for income and expense, choose the expense column.",
    )


class ParsedCsvTransaction(BaseModel):
    date: str
    store: str
    price: int


class CsvParseResponse(BaseModel):
    transactions: list[ParsedCsvTransaction]
    mapping: CsvMapping


class CsvSaveRequest(BaseModel):
    transactions: list[ParsedCsvTransaction]
