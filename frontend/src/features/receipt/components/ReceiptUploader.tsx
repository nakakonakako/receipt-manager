import React, { useState } from "react";
import { analyzeReceipt, saveReceipt, type Receipt } from "../api/receiptService";
import { ReceiptEditor } from "./ReceiptEditor";

export const ReceiptUploader: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingReceipts, setPendingReceipts] = useState<Receipt[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<Receipt[]>([]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      setPendingReceipts([]);
      setCurrentIndex(0);
      setResults([]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsLoading(true);
    try {
      const data = await analyzeReceipt(file);
      setPendingReceipts(data.receipts);
      setCurrentIndex(0);
      setResults([]);
    } catch (error) {
      console.error("解析に失敗しました", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveCurrent = async (data: Receipt) => {
    try {
      await saveReceipt(data);

      const newResults = [...results, data];
      setResults(newResults);
      const nextIndex = currentIndex + 1;
  
      if (nextIndex < pendingReceipts.length) {
        setCurrentIndex(nextIndex);
      } else {
        console.log("すべてのレシートが保存されました:", newResults);
        alert(`${newResults.length}件のレシートが保存されました。`);
        
        setFile(null);
        setPreview(null);
        setPendingReceipts([]);
        setResults([]);
      }
    } catch (error) {
      console.error("レシートの保存に失敗しました", error);
    }
  };

  const handleSkipCurrent = () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < pendingReceipts.length) {
      setCurrentIndex(nextIndex);
    } else {
      if (results.length > 0) {
        alert(`${results.length}件のレシートが保存されました。`);
      }
      setFile(null);
      setPreview(null);
      setPendingReceipts([]);
      setResults([]);
    }
  };

  if (pendingReceipts.length > 0 && currentIndex < pendingReceipts.length) {
    return (
      <div>
        <div className="max-w-2xl mx-auto mb-2 flex justify-between items-end px-2">
          <span className="text-sm font-bold text-gray-500">
             レシート連続処理モード
          </span>
          <span className="text-xl font-bold text-blue-600">
            {currentIndex + 1} <span className="text-sm text-gray-400">/ {pendingReceipts.length}</span>
          </span>
        </div>

        <ReceiptEditor
          key={currentIndex}
          initialData={pendingReceipts[currentIndex]}
          onSave={handleSaveCurrent}
          onCancel={handleSkipCurrent}
        />
      </div>
    );
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
    </div>
  );
};