import { useState, useEffect } from 'react'
import { RegisterPage } from '@/components/RegisterPage'
import { ChatInterface } from '@/features/search/components/ChatInterface'
import { SettingsModel } from './SettingsModel'
import { supabase } from '@/lib/supabase'

export const MainLayout = () => {
  const [activeTab, setActiveTab] = useState<'register' | 'chat'>('register')
  const [spreadsheetId, setSpreadsheetId] = useState(() => {
    return localStorage.getItem('spreadsheetId') || ''
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)

  useEffect(() => {
    const fetchSettings = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('user_settings')
          .select('spreadsheet_id')
          .eq('user_id', user.id)
          .single()

        if (data?.spreadsheet_id) {
          setSpreadsheetId(data.spreadsheet_id)
        }
      }
      setIsLoadingSettings(false)
    }
    fetchSettings()
  }, [])

  const handleSaveSettings = (newId: string) => {
    setSpreadsheetId(newId)
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
            {isLoadingSettings ? (
              <div className="w-20 h-7 bg-gray-200 animate-pulse rounded-full"></div>
            ) : spreadsheetId ? (
              <span className="text-xs font-bold text-green-700 bg-green-100 px-3 py-1.5 rounded-full border border-green-200">
                ✅ 連携済み
              </span>
            ) : (
              <span className="text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-full border border-red-200 shadow-sm animate-pulse">
                ⚠️ 未設定
              </span>
            )}

            <button
              onClick={() => setIsSettingsOpen(true)}
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
        <SettingsModel
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
          currentId={spreadsheetId}
        />
      )}
    </div>
  )
}
