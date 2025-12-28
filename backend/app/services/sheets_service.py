import os

import gspread
from app.services.gemini_service import ReceiptData
from dotenv import load_dotenv

from datetime import datetime

load_dotenv()


class SheetsService:
    def __init__(self) -> None:
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

    def add_receipt_data(self, receipt: ReceiptData) -> dict:
        self.worksheet = self.get_monthly_sheet(receipt.purchase_date)

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

    def _get_monthly_sheet(self, date_str: str) -> gspread.Worksheet:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        sheet_name = dt.strftime("%Y-%m")

        try:
            worksheet = self.sh.worksheet(sheet_name)
        except gspread.exceptions.WorksheetNotFound:
            worksheet = self.sh.add_worksheet(title=sheet_name, rows=1000, cols=20)

            header = ["購入日", "商品名", "店舗名", "価格"]
            worksheet.append_row(header)

        return worksheet

    def get_all_data(self) -> str:
        all_data = []

        headers = ["purchase_date", "item_name", "store_name", "price"]
        all_data.append(",".join(headers))

        for ws in self.sh.worksheets():
            rows = ws.get_all_values()

            if len(rows) <= 1:
                continue

            data_rows = rows[1:]
            for row in data_rows:
                line = ",".join(map(str, row))
                all_data.append(line)

        return "\n".join(all_data)
