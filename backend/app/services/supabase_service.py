import calendar
import datetime
import os
import unicodedata

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
        if not user_response or not user_response:
            raise ValueError("Invalid Supabase token provided.")
        self.user_id = user_response.user.id

    def add_receipt_data(self, receipt: ReceiptData) -> dict:
        parent_data = {
            "user_id": self.user_id,
            "date": receipt.purchase_date,
            "store_name": receipt.store_name,
            "total_amount": receipt.total_amount,
            "payment_method": receipt.payment_method,
        }

        parent_response = self.client.table("receipts").insert(parent_data).execute()

        if not parent_response.data:
            raise Exception("親レシートの保存に失敗しました。")

        receipt_id = parent_response.data[0]["id"]

        items_count = 0
        if receipt.items:
            items_data = [
                {
                    "receipt_id": receipt_id,
                    "user_id": self.user_id,
                    "item_name": item.item_name,
                    "price": item.price,
                    "main_category": getattr(item, "main_category", None),
                    "sub_category": getattr(item, "sub_category", None),
                    "search_tags": getattr(item, "search_tags", None),
                    "is_comparable": getattr(item, "is_comparable", None),
                }
                for item in receipt.items
            ]

            child_response = (
                self.client.table("receipt_items").insert(items_data).execute()
            )
            items_count = len(child_response.data)

        return {
            "log_status": "saved to database",
            "receipt_id": receipt_id,
            "saved_items": items_count,
        }

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

    def update_receipt(self, receipt_id: str, receipt_data: dict) -> dict:
        parent_data = {
            "date": receipt_data.get("date"),
            "store_name": receipt_data.get("store_name"),
            "total_amount": receipt_data.get("total_amount"),
            "payment_method": receipt_data.get("payment_method", "unknown"),
        }
        self.client.table("receipts").update(parent_data).eq("id", receipt_id).execute()

        self.client.table("receipt_items").delete().eq(
            "receipt_id", receipt_id
        ).execute()

        items = receipt_data.get("receipt_items", [])
        if items:
            items_data = [
                {
                    "receipt_id": receipt_id,
                    "user_id": self.user_id,
                    "item_name": item.get("item_name"),
                    "price": item.get("price"),
                    "main_category": item.get("main_category"),
                    "sub_category": item.get("sub_category"),
                    "search_tags": item.get("search_tags"),
                    "is_comparable": item.get("is_comparable", True),
                }
                for item in items
            ]
            self.client.table("receipt_items").insert(items_data).execute()

        return {"status": "success", "updated_id": receipt_id}

    def update_csv_transaction(self, transaction_id: str, csv_data: dict) -> dict:
        update_data = {
            "date": csv_data.get("date"),
            "store": csv_data.get("store"),
            "price": csv_data.get("price"),
        }
        self.client.table("csv_transactions").update(update_data).eq(
            "id", transaction_id
        ).execute()
        return {"status": "success", "updated_id": transaction_id}

    def delete_receipt(self, receipt_id: int) -> dict:
        response = self.client.table("receipts").delete().eq("id", receipt_id).execute()
        return {"status": "success", "deleted_id": receipt_id, "details": response.data}

    def delete_csv_transaction(self, transaction_id: int) -> dict:
        response = (
            self.client.table("csv_transactions")
            .delete()
            .eq("id", transaction_id)
            .execute()
        )
        return {
            "status": "success",
            "deleted_id": transaction_id,
            "details": response.data,
        }

    def get_all_data(self, data_type: str = "all", period: str = "3months") -> dict:
        all_data = []
        headers = ["purchase_date", "store_name", "item_name", "price"]
        all_data.append(",".join(headers))

        if data_type in ["all", "receipt"]:
            res = (
                self.client.table("receipts")
                .select("*, receipt_items(*)")
                .order("date")
                .execute()
            )
            for row in res.data:
                date = row.get("date")
                store = row.get("store_name")
                items = row.get("receipt_items", [])

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

    def get_available_months(self) -> dict:
        receipts_res = self.client.table("receipts").select("date").execute()
        csv_res = self.client.table("csv_transactions").select("date").execute()

        receipt_months = set()
        for row in receipts_res.data:
            if row.get("date"):
                receipt_months.add(row["date"][:7])

        csv_months = set()
        for row in csv_res.data:
            if row.get("date"):
                csv_months.add(row["date"][:7])

        current_month = datetime.date.today().strftime("%Y-%m")
        if not receipt_months:
            receipt_months.add(current_month)
        if not csv_months:
            csv_months.add(current_month)

        return {
            "receipts": sorted(list(receipt_months), reverse=True),
            "csv": sorted(list(csv_months), reverse=True),
        }

    def get_transactions_by_month(self, month: str = None) -> dict:
        receipts_query = (
            self.client.table("receipts")
            .select("*, receipt_items(*)")
            .order("date", desc=True)
        )

        csv_query = (
            self.client.table("csv_transactions").select("*").order("date", desc=True)
        )

        if month:
            try:
                y, m = map(int, month.split("-"))
                last_day = calendar.monthrange(y, m)[1]

                start_date = f"{month}-01"
                end_date = f"{month}-{last_day:02d}"

                receipts_query = receipts_query.gte("date", start_date).lte(
                    "date", end_date
                )
                csv_query = csv_query.gte("date", start_date).lte("date", end_date)
            except ValueError:
                pass

        receipts_res = receipts_query.execute()
        csv_res = csv_query.execute()

        return {"receipts": receipts_res.data, "csv_transactions": csv_res.data}

    def get_learned_categories(self, item_names: list[str]) -> dict:
        if not item_names:
            return {}

        response = (
            self.client.table("receipt_items")
            .select("item_name, main_category, sub_category, is_comparable")
            .in_("item_name", item_names)
            .order("created_at", desc=True)
            .execute()
        )

        learned_data = {}
        for row in response.data:
            name = row["item_name"]
            if name not in learned_data:
                learned_data[name] = {
                    "main_category": row.get("main_category"),
                    "sub_category": row.get("sub_category"),
                    "is_comparable": row.get("is_comparable"),
                }

        return learned_data

    def search_items_for_memo(self, query: str) -> list[dict]:
        if not query:
            return []

        keywords = query.replace("　", " ").split()
        if not keywords:
            return []

        search_groups = []
        for kw in keywords:
            normalized = unicodedata.normalize("NFKC", kw)
            hira = "".join(
                [
                    chr(ord(c) - 96) if 12449 <= ord(c) <= 12534 else c
                    for c in normalized
                ]
            )
            kata = "".join(
                [
                    chr(ord(c) + 96) if 12353 <= ord(c) <= 12438 else c
                    for c in normalized
                ]
            )
            search_groups.append({normalized.lower(), hira.lower(), kata.lower()})

        response = (
            self.client.table("receipt_items")
            .select("*, receipts(date, store_name)")
            .order("created_at", desc=True)
            .execute()
        )

        results = []
        for item in response.data:
            item_name = str(item.get("item_name", "")).lower()
            tags = item.get("search_tags") or []
            tags_str = " ".join(tags).lower()
            target_text = f"{item_name} {tags_str}"

            is_match = True
            for group in search_groups:
                if not any(sw in target_text for sw in group):
                    is_match = False
                    break

            if is_match:
                results.append(item)

        return results
