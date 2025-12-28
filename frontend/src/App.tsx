import { useState } from 'react'
import { ReceiptUploader } from './features/receipt/components/ReceiptUploader'
import { ChatInterface } from './features/receipt/components/ChatInterface'

function App() {
  const [activeTab, setActiveTab] = useState<'upload' | 'chat'>('upload')

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-8">
          AIレシート家計簿 🧾
        </h1>

        {/* タブ切り替えボタン */}
        <div className="flex mb-6 bg-white rounded-lg shadow p-1">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2 text-center rounded-md font-bold transition-colors ${
              activeTab === 'upload'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            📸 レシート登録
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-2 text-center rounded-md font-bold transition-colors ${
              activeTab === 'chat'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            💬 AIに質問
          </button>
        </div>

        {/* 画面の表示切り替え */}
        <div className="transition-opacity duration-300">
          {activeTab === 'upload' ? <ReceiptUploader /> : <ChatInterface />}
        </div>
      </div>
    </div>
  )
}

export default App
