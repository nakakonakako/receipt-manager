import { useAuth } from './contexts/AuthContext'
import { Auth } from './components/Auth'
import { MainLayout } from './components/MainLayout'

export const App: React.FC = () => {
  const { session, isLoading, logout } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-400 font-bold">
          <span className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
          読み込み中...
        </div>
      </div>
    )
  }

  if (!session) {
    return <Auth />
  }

  const userName = session.user.email?.split('@')[0] || 'ユーザー'

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xl sm:text-2xl">🧾</span>
            <h1 className="text-lg sm:text-xl font-extrabold text-gray-800 tracking-tight">
              AI家計簿
            </h1>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="text-right flex flex-col justify-center">
              <p className="hidden sm:block text-[10px] text-gray-400 font-bold leading-none mb-0.5">
                ログイン中
              </p>
              <p className="text-xs sm:text-sm text-gray-700 font-bold truncate max-w-[120px] sm:max-w-[200px]">
                <span className="sm:hidden">{userName}</span>
                <span className="hidden sm:inline">{session.user.email}</span>
              </p>
            </div>
            <button
              onClick={logout}
              className="text-xs sm:text-sm px-3 py-1.5 bg-gray-100 text-gray-600 font-bold rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col w-full">
        <MainLayout />
      </main>
    </div>
  )
}
