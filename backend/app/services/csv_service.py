import csv
import io
import logging
import re

from app.schemas.csv import MAX_CSV_ROWS, CsvMapping, ParsedCsvTransaction
from dateutil import parser

logger = logging.getLogger(__name__)


class CsvRowLimitError(ValueError):
    """Raised when a CSV exceeds the bounded number of logical records."""


class CsvService:
    def validate_csv_limits(self, csv_text: str) -> int:
        row_count = 0
        try:
            reader = csv.reader(io.StringIO(csv_text, newline=""))
            for _ in reader:
                row_count += 1
                if row_count > MAX_CSV_ROWS:
                    raise CsvRowLimitError
        except csv.Error:
            raise ValueError("Invalid CSV") from None
        return row_count

    def validate_mapping_columns(self, csv_text: str, mapping: CsvMapping) -> None:
        reader = csv.reader(io.StringIO(csv_text, newline=""))
        try:
            first_row = next(reader)
        except StopIteration:
            raise ValueError("CSV has no columns") from None
        except csv.Error:
            raise ValueError("Invalid CSV") from None

        if max(
            mapping.date_col_index,
            mapping.store_col_index,
            mapping.price_col_index,
        ) >= len(first_row):
            raise ValueError("Mapping exceeds CSV columns")

    def parse_csv(
        self, csv_text: str, mapping: CsvMapping | dict
    ) -> list[ParsedCsvTransaction]:
        if not isinstance(mapping, CsvMapping):
            mapping = CsvMapping.model_validate(
                {"has_header": mapping.get("has_header", False), **mapping}
            )
        parsed_transactions = []
        csv_reader = csv.reader(io.StringIO(csv_text, newline=""))

        max_col_index = max(
            mapping.date_col_index,
            mapping.store_col_index,
            mapping.price_col_index,
        )

        for i, row in enumerate(csv_reader):
            if mapping.has_header and i == 0:
                continue

            if len(row) <= max_col_index:
                continue

            try:
                raw_date = row[mapping.date_col_index].strip()
                raw_store = row[mapping.store_col_index].strip()
                raw_price = row[mapping.price_col_index].strip()

                if not raw_date or not raw_store or raw_store == "-" or not raw_price:
                    continue

                price_str = re.sub(r"[^0-9]", "", raw_price)
                price = int(price_str) if price_str else 0
                if price == 0:
                    continue

                try:
                    parsed_date = parser.parse(raw_date, fuzzy=True)
                    formatted_date = parsed_date.strftime("%Y-%m-%d")
                except Exception:
                    logger.warning("Skipping CSV row with an invalid date (row=%d)", i)
                    continue

                parsed_transactions.append(
                    ParsedCsvTransaction(
                        date=formatted_date, store=raw_store, price=price
                    )
                )
                if len(parsed_transactions) > MAX_CSV_ROWS:
                    raise CsvRowLimitError

            except CsvRowLimitError:
                raise
            except Exception:
                logger.warning("Skipping malformed CSV row (row=%d)", i)
                continue

        return parsed_transactions
