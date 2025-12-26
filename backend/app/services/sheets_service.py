import os
import gspread
from dotenv import load_dotenv
from app.services.gemini_service import ReceiptData

load_dotenv()


class SheetsService:
    def __init__(self):
        json_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "service_account.json",
        )
        if not os.path.exists(json_path):
            raise FileNotFoundError("Service account JSON file not found.")
        self.gc = gspread.service_account(filename=json_path)

        sheet_id = os.getenv("SPREADSHEET_ID")
        if not sheet_id:
            raise ValueError("SPREADSHEET_ID environment variable not set.")

        self.sh = self.gc.open_by_key(sheet_id)
        self.worksheet = self.sh.sheet1

    def add_receipt_data(self, receipt: ReceiptData):
        rows_to_add = []

        for item in receipt.items:
            row = [
                receipt.purchase_date,
                item.item_name,
                receipt.store_name,
                item.price,
            ]
            rows_to_add.append(row)

        if rows_to_add:
            self.worksheet.append_rows(rows_to_add)

        return {"added_rows": len(rows_to_add)}
