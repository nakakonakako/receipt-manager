import os
from datetime import datetime

import gspread
from app.schemas.receipt import ReceiptData
from dotenv import load_dotenv

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
        target_sheet = self._get_receipt_sheet(receipt.purchase_date)

        rows_to_add = []

        for item in receipt.items:
            row = [
                receipt.purchase_date,
                receipt.store_name,
                item.item_name,
                item.price,
            ]
            rows_to_add.append(row)

        if rows_to_add:
            target_sheet.append_rows(rows_to_add)
            self._apply_formatting(target_sheet)

        log_result = "skipped"
        if getattr(receipt, "payment_method", "unknown") == "cash":
            self._add_to_transaction_sheet(receipt)
            log_result = "added to transaction log"

        return {
            "added_rows": len(rows_to_add),
            "payment_method": getattr(receipt, "payment_method", "unknown"),
            "log_status": log_result,
        }

    def _add_to_transaction_sheet(self, receipt: ReceiptData) -> None:
        log_sheet = self._get_transaction_sheet(receipt.purchase_date)

        row = [
            receipt.purchase_date,
            receipt.store_name,
            receipt.total_amount,
            receipt.payment_method,
        ]

        log_sheet.append_row(row)
        self._apply_formatting(log_sheet, is_receipt=False)

    def _get_receipt_sheet(self, date_str: str) -> gspread.Worksheet:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        sheet_name = f"Receipt_{dt.strftime('%Y-%m')}"

        try:
            worksheet = self.sh.worksheet(sheet_name)
        except gspread.exceptions.WorksheetNotFound:
            worksheet = self.sh.add_worksheet(title=sheet_name, rows=1000, cols=20)

            header = ["購入日", "店舗名", "商品名", "価格"]
            worksheet.append_row(header)

            worksheet.freeze(rows=1)

        return worksheet

    def _get_transaction_sheet(self, date_str: str) -> gspread.Worksheet:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        sheet_name = f"Log_{dt.strftime('%Y-%m')}"

        try:
            worksheet = self.sh.worksheet(sheet_name)
        except gspread.exceptions.WorksheetNotFound:
            worksheet = self.sh.add_worksheet(title=sheet_name, rows=1000, cols=20)
            header = ["購入日", "店舗名", "合計金額", "支払い方法"]
            worksheet.append_row(header)
            worksheet.freeze(rows=1)

        return worksheet

    def _apply_formatting(self, sheet: gspread.Worksheet, is_receipt=True) -> None:
        try:
            sheet.sort((1, "asc"))

            requests = [
                {
                    "updateDimensionProperties": {
                        "range": {
                            "sheetId": sheet.id,
                            "dimension": "COLUMNS",
                            "startIndex": 1,
                            "endIndex": 2,
                        },
                        "properties": {"pixelSize": 300},
                        "fields": "pixelSize",
                    }
                },
            ]
            if is_receipt:
                requests.append(
                    {
                        "updateDimensionProperties": {
                            "range": {
                                "sheetId": sheet.id,
                                "dimension": "COLUMNS",
                                "startIndex": 2,
                                "endIndex": 3,
                            },
                            "properties": {"pixelSize": 300},
                            "fields": "pixelSize",
                        }
                    },
                )

            self.sh.batch_update({"requests": requests})

        except Exception as e:
            print(f"Formatting failed: {e}")

    def get_all_data(self) -> str:
        all_data = []

        headers = ["purchase_date", "store_name", "item_name", "price"]
        all_data.append(",".join(headers))

        for ws in self.sh.worksheets():
            if ws.title.startswith("Log_"):
                continue

            rows = ws.get_all_values()

            if len(rows) <= 1:
                continue

            data_rows = rows[1:]
            for row in data_rows:
                line = ",".join(map(str, row))
                all_data.append(line)

        return "\n".join(all_data)
