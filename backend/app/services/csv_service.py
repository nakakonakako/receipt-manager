import csv
import io
import re

from app.schemas.csv import ParsedCsvTransaction
from dateutil import parser


class CsvService:
    def parse_csv(self, csv_text: str, mapping: dict) -> list[ParsedCsvTransaction]:
        parsed_transactions = []
        csv_reader = csv.reader(io.StringIO(csv_text))

        max_col_index = max(
            mapping.get("date_col_index", 0),
            mapping.get("store_col_index", 0),
            mapping.get("price_col_index", 0),
        )

        for i, row in enumerate(csv_reader):
            if mapping.get("has_header") and i == 0:
                continue

            if len(row) <= max_col_index:
                continue

            try:
                raw_date = row[mapping["date_col_index"]].strip()
                raw_store = row[mapping["store_col_index"]].strip()
                raw_price = row[mapping["price_col_index"]].strip()

                if not raw_date or not raw_store or raw_store == "-" or not raw_price:
                    continue

                price_str = re.sub(r"[^0-9]", "", raw_price)
                price = int(price_str) if price_str else 0
                if price == 0:
                    continue

                try:
                    parsed_date = parser.parse(raw_date, fuzzy=True)
                    formatted_date = parsed_date.strftime("%Y-%m-%d")
                except Exception as e:
                    print(f"Date parsing failed for '{raw_date}': {e}")
                    continue

                parsed_transactions.append(
                    ParsedCsvTransaction(
                        date=formatted_date, store=raw_store, price=price
                    )
                )

            except Exception as e:
                print(f"Error processing row {i}: {e}")
                continue

        return parsed_transactions
