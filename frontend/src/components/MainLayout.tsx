import { useState } from 'react'
import { RegisterPage } from '@/components/RegisterPage'
import { ChatInterface } from '@/features/search/components/ChatInterface'
import { HistoryPage } from '@/features/history/components/HistoryPage'
import { SmartMemoPage } from '@/features/memo/components/SmartMemoPage'
import { DashboardPage } from '@/features/dashboard/components/DashboardPage'

export const MainLayout = () => {
  const [activeTab, setActiveTab] = useState<
    'register' | 'chat' | 'history' | 'memo' | 'dashboard'
  >('register')

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-3 sm:p-6">
      <div className="flex overflow-x-auto bg-gray-200/60 p-1.5 rounded-xl mb-4 sm:mb-6 shadow-inner custom-scrollbar">
        <button
          onClick={() => setActiveTab('register')}
          className={`flex-1 py-2.5 text-xs sm:text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-1.5 sm:gap-2 ${
            activeTab === 'register'
              ? 'bg-white text-blue-700 shadow-sm scale-100'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50 scale-95'
          }`}
        >
          <span className="text-base sm:text-lg">📸</span> 登録
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-2.5 text-xs sm:text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-1.5 sm:gap-2 ${
            activeTab === 'history'
              ? 'bg-white text-blue-700 shadow-sm scale-100'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50 scale-95'
          }`}
        >
          <span className="text-base sm:text-lg">📊</span> 履歴・管理
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-2.5 text-xs sm:text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-1.5 sm:gap-2 ${
            activeTab === 'chat'
              ? 'bg-white text-blue-700 shadow-sm scale-100'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50 scale-95'
          }`}
        >
          <span className="text-base sm:text-lg">💬</span> AIチャット
        </button>
        <button
          onClick={() => setActiveTab('memo')}
          className={`flex-1 min-w-[90px] py-2.5 text-xs sm:text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-1.5 sm:gap-2 ${
            activeTab === 'memo'
              ? 'bg-white text-blue-700 shadow-sm scale-100'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50 scale-95'
          }`}
        >
          <span className="text-base sm:text-lg">🛒</span> メモ
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex-1 min-w-[90px] py-2.5 text-xs sm:text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-1.5 sm:gap-2 ${
            activeTab === 'dashboard'
              ? 'bg-white text-blue-700 shadow-sm scale-100'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50 scale-95'
          }`}
        >
          <span className="text-base sm:text-lg">📈</span> 統計
        </button>
      </div>

      <div className="transition-opacity duration-300 w-full">
        {activeTab === 'register' && <RegisterPage />}
        {activeTab === 'history' && <HistoryPage />}
        {activeTab === 'chat' && <ChatInterface />}
        {activeTab === 'memo' && <SmartMemoPage />}
        {activeTab === 'dashboard' && <DashboardPage />}
      </div>
    </div>
  )
}
