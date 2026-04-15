export interface MemoSearchResultItem {
  id: string
  receipt_id: string
  item_name: string
  price: number
  main_category: string | null
  sub_category: string | null
  search_tags: string[] | null
  is_comparable: boolean
  receipts: {
    date: string
    store_name: string
  }
}

export interface MemoRowRecord {
  id: string
  query: string
  sort_order: number
}
