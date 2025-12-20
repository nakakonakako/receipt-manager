import axios from "axios";

const API_URL = "http://127.0.0.1:8000";

export interface ReceiptItem {
  item_name: string;
  price: number;
}

export interface Receipt {
  purchase_date: string;
  store_name: string;
  items: ReceiptItem[];
}

export interface ReceiptResponse {
  receipts: Receipt[];
}

export const analyzeReceipt = async (file: File): Promise<ReceiptResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  
  const response = await axios.post<ReceiptResponse>(
    `${API_URL}/analyze`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );

  return response.data;
};