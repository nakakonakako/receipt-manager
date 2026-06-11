import { useState } from 'react'
import { RegisterPage } from '@/components/RegisterPage'
import { ChatInterface } from '@/features/search/components/ChatInterface'
import { HistoryPage } from '@/features/history/components/HistoryPage'
import { SmartMemoPage } from '@/features/memo/components/SmartMemoPage'
import { DashboardPage } from '@/features/dashboard/components/DashboardPage'

interface HistoryFocusTarget {
  requestId: number
  receiptId: string
  receiptDate: string
  itemName: string
}

type TabKey = 'register' | 'chat' | 'history' | 'memo' | 'dashboard'

interface TabDefinition {
  key: TabKey
  label: string
  icon: string
}

const TABS: TabDefinition[] = [
  { key: 'register', label: '登録', icon: '📸' },
  { key: 'history', label: '履歴・管理', icon: '📊' },
  { key: 'chat', label: 'AIチャット', icon: '💬' },
  { key: 'memo', label: 'メモ', icon: '🛒' },
  { key: 'dashboard', label: '統計', icon: '📈' },
]

export const MainLayout = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('register')
  const [historyFocusTarget, setHistoryFocusTarget] =
    useState<HistoryFocusTarget | null>(null)

  const handleOpenHistoryFromMemo = (payload: {
    receiptId: string
    receiptDate: string
    itemName: string
  }) => {
    setHistoryFocusTarget({
      requestId: Date.now(),
      ...payload,
    })
    setActiveTab('history')
  }

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-3 sm:p-6">
      {/* スマホ幅ではプルダウンで切り替え（タブがつぶれるのを防ぐ） */}
      <div className="sm:hidden mb-4">
        <label htmlFor="main-tab-select" className="sr-only">
          表示するページを選択
        </label>
        <div className="relative">
          <select
            id="main-tab-select"
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as TabKey)}
            className="w-full appearance-none bg-white border border-gray-300 text-gray-800 text-sm font-extrabold rounded-xl py-3 pl-4 pr-10 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TABS.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.icon} {tab.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
            ▼
          </span>
        </div>
      </div>

      {/* タブレット・PC幅では従来通りタブを表示 */}
      <div className="hidden sm:flex bg-gray-200/60 p-1.5 rounded-xl mb-6 shadow-inner">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 text-sm font-extrabold rounded-lg transition-all duration-300 flex justify-center items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-white text-blue-700 shadow-sm scale-100'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50 scale-95'
            }`}
          >
            <span className="text-lg">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <div className="transition-opacity duration-300 w-full">
        {activeTab === 'register' && <RegisterPage />}
        {activeTab === 'history' && (
          <HistoryPage focusTarget={historyFocusTarget} />
        )}
        {activeTab === 'chat' && <ChatInterface />}
        {activeTab === 'memo' && (
          <SmartMemoPage onOpenHistory={handleOpenHistoryFromMemo} />
        )}
        {activeTab === 'dashboard' && <DashboardPage />}
      </div>
    </div>
  )
}
