import os

from app.schemas.csv import ParsedCsvTransaction
from app.schemas.receipt import ReceiptData
from supabase import Client, create_client


class SupabaseService:
    def __init__(self, token: str):
        url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
        key = os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY") or os.environ.get(
            "SUPABASE_KEY"
        )

        if not url or not key:
            raise ValueError(
                "Supabase URL and Key must be set in environment variables."
            )

        self.client: Client = create_client(url, key)

        self.client.options.headers.update({"Authorization": f"Bearer {token}"})

        user_response = self.client.auth.get_user(token)
        if not user_response or not user_response.data:
            raise ValueError("Invalid Supabase token provided.")
        self.user_id = user_response.data.id

    def add_receipt_data(self, receipt: ReceiptData) -> dict:
        items_dict_list = [item.model_dump() for item in receipt.items]

        data = {
            "user_id": self.user_id,
            "date": receipt.purchase_date,
            "store_name": receipt.store_name,
            "total_amount": receipt.total_amount,
            "payment_method": receipt.payment_method,
            "items": items_dict_list,
        }

        response = self.client.table("receipts").insert(data).execute()
        return {"added_rows": len(response.data), "log_status": "saved to supabase"}

    def add_csv_data(self, transactions: list[ParsedCsvTransaction]) -> dict:
        data = [
            {
                "user_id": self.user_id,
                "date": t.date,
                "store": t.store,
                "price": t.price,
            }
            for t in transactions
        ]

        response = self.client.table("csv_transactions").insert(data).execute()
        return {"total_added": len(response.data)}

    def get_all_data(self, data_type: str = "all", period: str = "3months") -> dict:
        all_data = []
        headers = ["purchase_date", "store_name", "item_name", "price"]
        all_data.append(",".join(headers))

        if data_type in ["all", "receipt"]:
            res = self.client.table("receipts").select("*").order("date").execute()
            for row in res.data:
                date = row.get("date")
                store = row.get("store_name")
                items = row.get("items", [])
                if items:
                    for item in items:
                        all_data.append(
                            f"{date},{store},{item.get('item_name', '')},{item.get('price', '')}"
                        )
                else:
                    all_data.append(f"{date},{store},合計,{row.get('total_amount')}")

        if data_type in ["all", "log"]:
            res = (
                self.client.table("csv_transactions")
                .select("*")
                .order("date")
                .execute()
            )
            for row in res.data:
                date = row.get("date")
                store = row.get("store")
                price = row.get("price")
                all_data.append(f"{date},{store},キャッシュレス決済,{price}")

        return "\n".join(all_data)
