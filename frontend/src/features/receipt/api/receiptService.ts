import axios from 'axios'

const API_URL = '/api'

export interface ReceiptItem {
  item_name: string
  price: number
}

export interface Receipt {
  purchase_date: string
  store_name: string
  items: ReceiptItem[]
}

export interface ReceiptResponse {
  receipts: Receipt[]
}

export interface SearchResponse {
  answer: string
}

const getApiKey = () => sessionStorage.getItem('receipt_app_key') || ''

export const analyzeReceipt = async (file: File): Promise<ReceiptResponse> => {
  const formData = new FormData()
  formData.append('file', file)

  const response = await axios.post<ReceiptResponse>(
    `${API_URL}/analyze`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
        'x-api-key': getApiKey(),
      },
    }
  )

  return response.data
}

export const saveReceipt = async (receipt: Receipt): Promise<void> => {
  await axios.post(`${API_URL}/save`, receipt, {
    headers: {
      'x-api-key': getApiKey(),
    },
  })
}

export const searchReceipts = async (query: string): Promise<string> => {
  const response = await axios.post<SearchResponse>(
    `${API_URL}/search`,
    {
      query,
    },
    {
      headers: {
        'x-api-key': getApiKey(),
      },
    }
  )
  return response.data.answer
}
