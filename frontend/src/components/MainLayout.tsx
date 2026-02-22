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
  const [tempId, setTempId] = useState('')

  const handleOpenSettings = () => {
    const fullUrl = spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
      : ''

    setTempId(fullUrl)
    setIsSettingsOpen(true)
  }

  const extractSpreadsheetId = (input: string) => {
    const cleanInput = input.trim()
    const match = cleanInput.match(
      /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
    )

    if (match && match[1]) {
      return match[1]
    }

    return null
  }

  const handleSaveSettings = () => {
    if (!tempId) {
      alert('URLを入力してください。')
      return
    }

    const extractedId = extractSpreadsheetId(tempId)

    if (!extractedId) {
      alert(
        '正しいGoogleスプレッドシートの共有URLを入力してください。\n例: https://docs.google.com/spreadsheets/d/...'
      )
      return
    }

    setSpreadsheetId(extractedId)
    localStorage.setItem('spreadsheetId', extractedId)
    setIsSettingsOpen(false)
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 relative">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            AIレシート家計簿 🧾
          </h1>
          <div className="flex items-center gap-3">
            {spreadsheetId ? (
              <span className="text-xs font-bold text-green-700 bg-green-100 px-3 py-1.5 rounded-full border border-green-200">
                ✅ 連携済み
              </span>
            ) : (
              <span className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-full border border-red-200 shadow-sm animate-pulse">
                ⚠️ 未設定
              </span>
            )}

            <button
              onClick={handleOpenSettings}
              className="text-gray-600 hover:text-gray-900 font-medium px-4 py-1.5 bg-white rounded-md border border-gray-300 shadow-sm hover:bg-gray-50 transition-colors"
            >
              ⚙️ 設定
            </button>
          </div>
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

      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-2">連携設定</h2>
              <p className="text-sm text-gray-600 mb-6">
                データ保存先となるGoogleスプレッドシートの共有URLを入力してください。
              </p>

              <div className="bg-blue-50 border border-blue-100 rounded-md p-3 mb-6">
                <p className="text-xs text-blue-800 leading-relaxed">
                  <span className="font-bold">💡 共有URLの取得方法：</span>
                  <br />
                  Google
                  Driveで指定したいスプレッドシートを右クリックして、「共有」 ＞
                  「リンクをコピー」から取得してください。
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-700">
                  スプレッドシートの共有URL
                </label>
                <input
                  type="text"
                  value={tempId}
                  onChange={(e) => setTempId(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="w-full border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
            </div>

            <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-100">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveSettings}
                className="px-6 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
              >
                保存する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
