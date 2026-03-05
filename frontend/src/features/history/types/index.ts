export interface HistoryReceiptItem {
  id: string
  item_name: string
  price: number
}

export interface HistoryReceipt {
  id: string
  date: string
  store_name: string
  total_amount: number
  payment_method: string
  receipt_items: HistoryReceiptItem[]
}

export interface HistoryCsvTransaction {
  id: string
  date: string
  store: string
  price: number
}

export interface TransactionsResponse {
  receipts: HistoryReceipt[]
  csv_transactions: HistoryCsvTransaction[]
}
