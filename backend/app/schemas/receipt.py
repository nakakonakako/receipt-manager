from pydantic import BaseModel, Field


class ReceiptItem(BaseModel):
    item_name: str = Field(description="Name of the the product")
    price: int = Field(description="Price of the product including 8% tax")


class ReceiptData(BaseModel):
    purchase_date: str = Field(description="Date of purchase in YYYY-MM-DD format")
    store_name: str = Field(description="Name of the store")
    items: list[ReceiptItem]
    total_amount: int = Field(
        description="The final total amount paid (Tax included). MUST extract the value explicitly printed on the receipt (e.g., marked as '合計', 'Total'). DO NOT calculate the sum of items."
    )
    payment_method: str = Field(
        description="Payment method. Return 'cash' if keywords like '現金', 'お預り', '釣銭' (Change) are present. Return 'cashless' if keywords like 'Credit', 'Card', 'PayPay', 'IC', 'Suica', 'iD', 'QuicPay' are present."
    )


class ReceiptDatas(BaseModel):
    receipts: list[ReceiptData]


class SearchQuery(BaseModel):
    query: str
    data_type: str = "all"
    period: str = "3months"
