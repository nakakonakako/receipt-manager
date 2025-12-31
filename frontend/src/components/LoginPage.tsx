import React, { useState } from 'react'
import axios from 'axios'

interface LoginPageProps {
  onLoginSuccess: () => void
}

const API_URL = '/api'

export const LoginPage = ({ onLoginSuccess }: LoginPageProps) => {
  const [passwordInput, setPasswordInput] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    try {
      await axios.post(`${API_URL}/check_auth`, {
        password: passwordInput,
      })

      sessionStorage.setItem('receipt_app_key', passwordInput)
      onLoginSuccess()
    } catch (error) {
      console.error(error)

      if (axios.isAxiosError(error) && error.response) {
        setErrorMsg('パスワードが違います')
      } else {
        setErrorMsg('サーバーに接続できませんでした')
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">
          🔒 ログイン
        </h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              パスワード
            </label>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="パスワードを入力..."
            />
          </div>
          {errorMsg && (
            <p className="text-red-500 text-sm font-bold text-center">
              {errorMsg}
            </p>
          )}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700 transition"
          >
            次へ進む
          </button>
        </form>
      </div>
    </div>
  )
}
