export interface ReceiptItem {
  item_name: string
  price: number
}

export interface Receipt {
  purchase_date: string
  store_name: string
  items: ReceiptItem[]
  total_amount: number
  payment_method: string
}

// 編集用のアイテム型 価格は空文字も許容
export type EditingItem = Omit<ReceiptItem, 'price'> & {
  price: number | ''
}

export interface ReceiptEditorProps {
  initialData: Receipt
  onSave: (data: Receipt) => void
  onCancel: () => void
}

export interface UploadTask {
  id: string
  file: File
  previewUrl: string
  status: 'idle' | 'analyzing' | 'success' | 'error'
  results: Receipt[]
}
