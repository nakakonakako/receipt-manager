from pydantic import BaseModel, Field


class CsvAnalysisRequest(BaseModel):
    csv_text: str


class CsvMapping(BaseModel):
    date_col_idx: int = Field(
        description="Index of the column for 'Purchase Date' (0-based)"
    )
    item_col_idx: int = Field(
        description="Index of the column for 'Item Name' (0-based). If mixed with store name, select the description column."
    )
    store_col_idx: int = Field(
        description="Index of the column for 'Store Name' (0-based). If not present, use same index as Item Name."
    )
    price_col_idx: int = Field(
        description="Index of the column for 'Price/Amount' (0-based)"
    )
    # confidence: float = Field(description="Confidence score of the analysis (0.0 to 1.0)")
