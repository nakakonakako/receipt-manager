import { useAuth } from './contexts/AuthContext'
import { Auth } from './components/Auth'
import { MainLayout } from './components/MainLayout'

export const App: React.FC = () => {
  const { session, isLoading, logout } = useAuth()

  if (isLoading) {
    return <div className="p-8 text-center">読み込み中...</div>
  }

  if (!session) {
    return <Auth />
  }

  return (
    <div className="p-4 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6 max-w-4xl mx-auto border-b pb-4">
        <h1 className="text-xl font-bold">Receipt Manager</h1>
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-600">
            ログイン中: {session.user.email}
          </p>
          <button
            onClick={logout}
            className="text-sm px-3 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
          >
            ログアウト
          </button>
        </div>
      </div>

      <MainLayout />
    </div>
  )
}
