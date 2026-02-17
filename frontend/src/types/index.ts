export interface ReceiptItem {
  item_name: string
  price: number
}

export interface Receipt {
  purchase_date: string
  store_name: string
  items: ReceiptItem[]
}
