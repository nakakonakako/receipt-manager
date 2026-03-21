from pydantic import BaseModel, Field


class ReceiptItem(BaseModel):
    item_name: str = Field(description="Name of the the product")
    price: int = Field(
        description="Price of the product exactly as printed on the receipt. DO NOT calculate or add tax manually."
    )
    main_category: str = Field(
        description="Must be exactly one of: '食費', '日用品', '交通・通信', '衣服・美容', '趣味・娯楽', '医療・健康', '住居・家具', 'その他'."
    )
    sub_category: str = Field(
        description="General sub-category of the item (e.g., '野菜', '肉類', '調味料', '洗剤', '食器', '文房具', 'スマホ周辺機器')."
    )
    search_tags: list[str] = Field(
        description="3 to 5 search keywords including general names, synonyms, and use cases (e.g., for 'ｻｰﾓｽ ﾏｸﾞ', use ['コップ', 'マグカップ', 'グラス', '水筒', '食器'])."
    )
    is_comparable: bool = Field(
        description="Set to true ONLY for daily consumables/repeat purchases where tracking price trends is useful (e.g., vegetables, meat, tissues, detergent). Set to false for durable goods, luxury items, or one-off expenses (e.g., dishes, appliances, clothes, eating out)."
    )


class ReceiptData(BaseModel):
    purchase_date: str = Field(description="Date of purchase in YYYY-MM-DD format")
    store_name: str = Field(description="Name of the store")
    items: list[ReceiptItem] = Field(
        description="List of actual purchased products. DO NOT include subtotal (小計), tax (外税/内税/消費税), or total (合計) rows."
    )
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
