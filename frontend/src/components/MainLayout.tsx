import { useState } from 'react'
import { RegisterPage } from '@/components/RegisterPage'
import { ChatInterface } from '@/features/search/components/ChatInterface'
import { HistoryPage } from '@/features/history/components/HistoryPage'

export const MainLayout = () => {
  const [activeTab, setActiveTab] = useState<'register' | 'chat' | 'history'>(
    'register'
  )

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 relative">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            AIレシート家計簿 🧾
          </h1>
        </div>

        <div className="flex mb-6 bg-white rounded-lg shadow p-1">
          <button
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-2 text-center rounded-md font-bold transition-colors ${
              activeTab === 'register'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            📸 登録
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 text-center rounded-md font-bold transition-colors ${
              activeTab === 'history'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            📊 履歴・管理
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex-1 py-2 text-center rounded-md font-bold transition-colors ${
              activeTab === 'chat'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            💬 AIチャット
          </button>
        </div>

        <div className="transition-opacity duration-300">
          {activeTab === 'register' && <RegisterPage />}
          {activeTab === 'history' && <HistoryPage />}
          {activeTab === 'chat' && <ChatInterface />}
        </div>
      </div>
    </div>
  )
}
