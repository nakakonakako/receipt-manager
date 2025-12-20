import React, { useState } from "react";
import { analyzeReceipt, type ReceiptResponse, type Receipt } from "../api/receiptService";
import { ReceiptEditor } from "./ReceiptEditor";

export const ReceiptUploader: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReceiptResponse | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsLoading(true);

    try {
      const data = await analyzeReceipt(file);
      setResult(data);
    } catch (error) {
      console.error("Error analyzing receipt:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = (data: Receipt) => {
    console.log("Saved receipt data:", data);
    alert("レシートデータが保存されました！");
    setFile(null);
    setPreview(null);
    setResult(null);
  };

  const handleCancel = () => {
    setResult(null);
  };

  if (result && result.receipts.length > 0) {
    return (
      <ReceiptEditor
        initialData={result.receipts[0]}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    )
  }

  return (
    <div className="p-4 max-w-md mx-auto bg-white rounded-xl shadow-md space-y-4">
      <h2 className="text-xl font-bold text-center">レシート登録</h2>

      <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="mb-4"
        />

        {preview && (
          <img
            src={preview}
            alt="Receipt Preview"
            className="max-h-64 rounded shadow-sm"
          />
        )}
      </div>

      <button
        onClick={handleUpload}
        disabled={!file || isLoading}
        className={`w-full py-2 px-4 rounded font-bold text-white transition-colors ${
          !file || isLoading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700"
        }`}  
      >
        {isLoading ? "分析中..." : "レシートを分析"}
      </button>

      {result && (
        <div className="mt-4 p-4 bg-green-50 rounded text-sm text-gray-700 overflow-auto max-h-60">
          <h3 className="font-bold mb-2">分析結果:</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};