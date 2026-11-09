import { useState } from 'react'
import { RegisterPage } from '@/components/RegisterPage'
import { ChatInterface } from '@/features/search/components/ChatInterface'
import { HistoryPage } from '@/features/history/components/HistoryPage'
import { DashboardPage } from '@/features/dashboard/components/DashboardPage'

type TabKey = 'register' | 'chat' | 'history' | 'dashboard'

interface TabDefinition {
  key: TabKey
  label: string
  icon: string
}

const TABS: TabDefinition[] = [
  { key: 'register', label: '登録', icon: '📸' },
  { key: 'history', label: '履歴・管理', icon: '📊' },
  { key: 'chat', label: 'AIチャット', icon: '💬' },
  { key: 'dashboard', label: '統計', icon: '📈' },
]

export const MainLayout = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('register')

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
      <div className="relative w-full max-w-4xl mx-auto px-3 sm:px-6 pt-3 sm:pt-6 shrink-0">
        {/* スマホ幅ではプルダウンで切り替え（タブがつぶれるのを防ぐ） */}
        <div className="sm:hidden mb-4 shrink-0">
          <label htmlFor="main-tab-select" className="sr-only">
            表示するページを選択
          </label>
          <div className="relative">
            <select
              id="main-tab-select"
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as TabKey)}
              className="rm-field w-full appearance-none text-stone-900 text-sm font-semibold py-3 pl-4 pr-10 focus:outline-none"
            >
              {TABS.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.icon} {tab.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-stone-600">
              ▼
            </span>
          </div>
        </div>

        {/* タブレット幅では従来通りタブを表示 */}
        <div className="hidden sm:flex xl:hidden shrink-0 bg-stone-100 p-1 rounded-xl mb-6 border border-stone-200">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-10 flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-150 flex justify-center items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                activeTab === tab.key
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-200/70'
              }`}
            >
              <span className="text-lg">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>

        <nav aria-label="メインナビゲーション" className="hidden xl:flex absolute top-6 right-full mr-1 w-[180px] flex-col gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-11 w-full px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors duration-150 flex items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                activeTab === tab.key
                  ? 'bg-stone-200 text-stone-900'
                  : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
              }`}
            >
              <span className="text-lg" aria-hidden="true">{tab.icon}</span> {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div
        className={`flex-1 min-h-0 transition-opacity duration-300 w-full max-w-4xl mx-auto px-3 sm:px-6 pb-3 sm:pb-6 ${
          activeTab === 'chat'
            ? 'flex flex-col'
            : 'overflow-y-auto rm-scrollbar-stable'
        }`}
      >
        {activeTab === 'register' && <RegisterPage />}
        {activeTab === 'history' && <HistoryPage />}
        {activeTab === 'chat' && <ChatInterface />}
        {activeTab === 'dashboard' && <DashboardPage />}
      </div>
    </div>
  )
}
