export interface CsvMapping {
  date_col_idx: number
  item_col_idx: number
  store_col_idx: number
  price_col_idx: number
  confidence: number
}

export interface ParsedTransaction {
  date: string
  store: string
  price: number
}
