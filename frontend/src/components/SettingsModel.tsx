import { useState } from 'react'

const extractSpreadsheetId = (input: string): string | null => {
  const cleanInput = input.trim()
  const match = cleanInput.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
  )
  if (match && match[1]) {
    return match[1]
  }
  return null
}

const buildSpreadsheetUrl = (id: string | null): string => {
  return id ? `https://docs.google.com/spreadsheets/d/${id}` : ''
}

interface SettingsModelProps {
  onClose: () => void
  onSave: (newId: string) => void
  currentId: string
}

export const SettingsModel = ({
  onClose,
  onSave,
  currentId,
}: SettingsModelProps) => {
  const [tempId, setTempId] = useState(() => buildSpreadsheetUrl(currentId))

  const handleSave = () => {
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

    localStorage.setItem('spreadsheetId', extractedId)
    onSave(extractedId)
  }

  return (
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
              Google Driveで指定したいスプレッドシートを右クリックして、
              <br />
              「共有」＞「リンクをコピー」から取得してください。
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
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
          >
            保存する
          </button>
        </div>
      </div>
    </div>
  )
}
