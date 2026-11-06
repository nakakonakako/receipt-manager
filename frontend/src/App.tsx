import { useAuth } from './contexts/AuthContext'
import { Auth } from './components/Auth'
import { MainLayout } from './components/MainLayout'

export const App: React.FC = () => {
  const { session, isLoading, logout } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--rm-canvas)]">
        <div className="flex flex-col items-center gap-3 text-stone-600 font-semibold">
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
    <div className="bg-[var(--rm-canvas)] h-dvh flex flex-col overflow-hidden">
      <header className="bg-white border-b border-stone-200 shrink-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xl sm:text-2xl">🧾</span>
            <h1 className="text-lg sm:text-xl font-bold text-stone-900 tracking-tight">
              AI家計簿
            </h1>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <div className="text-right flex flex-col justify-center">
              <p className="hidden sm:block text-[10px] text-stone-600 font-medium leading-none mb-0.5">
                ログイン中
              </p>
              <p className="text-xs sm:text-sm text-stone-700 font-medium truncate max-w-[120px] sm:max-w-[200px]">
                <span className="sm:hidden">{userName}</span>
                <span className="hidden sm:inline">{session.user.email}</span>
              </p>
            </div>
            <button
              onClick={logout}
              className="min-h-11 sm:min-h-9 text-xs sm:text-sm px-3 py-2 bg-stone-100 text-stone-700 font-semibold rounded-md hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden w-full">
        <MainLayout key={session.user.id} />
      </main>
    </div>
  )
}
