import { useState } from 'react'
import { LoginPage } from './components/LoginPage'
import { MainLayout } from './components/MainLayout'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  if (isAuthenticated) {
    return <MainLayout onLogout={() => setIsAuthenticated(false)} />
  } else {
    return <LoginPage onLoginSuccess={() => setIsAuthenticated(true)} />
  }
}

export default App
