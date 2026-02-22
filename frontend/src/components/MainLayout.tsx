import { useState } from 'react'
import { RegisterPage } from '@/pages/RegisterPage'
import { ChatInterface } from '@/features/search/components/ChatInterface'

export const MainLayout = () => {
  const [activeTab, setActiveTab] = useState<'register' | 'chat'>('register')
  const [spreadsheetId, setSpreadsheetId] = useState(() => {
    const savedId = localStorage.getItem('spreadsheetId')
    return savedId ? savedId : ''
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newId = e.target.value
    setSpreadsheetId(newId)
    localStorage.setItem('spreadsheetId', newId)
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            AIレシート家計簿 🧾
          </h1>
          <div className="flex gap-3">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="text-gray-500 hover:text-gray-700 font-medium px-3 py-1 rounded shadow-sm"
            >
              ⚙️ 設定
            </button>
          </div>
        </div>

        {isSettingsOpen && (
          <div className='className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200 transition-all'>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              連携するスプレッドシートID
            </label>
            <input
              type="text"
              value={spreadsheetId}
              onChange={handleIdChange}
              placeholder="例: 1BxiMVs0XRYF..."
              className="w-full border border-gray-300 rounded p-2 text-sm"
            />
            <p className="text-xs text-gray-500 mt-2">
              ※一度入力すればブラウザに自動保存されます。
            </p>
          </div>
        )}

        <div className="flex mb-6 bg-white rounded-lg shadow p-1">
          <button
            onClick={() => setActiveTab('register')}
            className={`flex-1 py-2 text-center rounded-md font-bold transition-colors ${
              activeTab === 'register'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            📸 データ登録
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

        <div className="transition-opacity duration-300">
          {activeTab === 'register' ? <RegisterPage /> : <ChatInterface />}
        </div>
      </div>
    </div>
  )
}
