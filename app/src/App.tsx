import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Login from './pages/Login'
import Controle from './pages/Controle'
import Servicos from './pages/Servicos'
import Equipes from './pages/Equipes'
import Importacao from './pages/Importacao'
import Campo from './pages/Campo'
import Visita from './pages/Visita'
import { Carregando } from './components/ui'

/** Só entra quem está logado. Papel exigido é opcional.
 *  Isto é conveniência de navegação — a barreira real é o RLS no banco. */
function Protegida({
  children,
  exige,
}: {
  children: React.ReactNode
  exige?: 'GESTAO' | 'CAMPO'
}) {
  const { session, carregando, ehGestor, ehTecnico, temPapel } = useAuth()
  const local = useLocation()

  if (carregando) return <Carregando />
  if (!session) return <Navigate to="/entrar" state={{ de: local.pathname }} replace />

  if (exige === 'GESTAO' && !(ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR')))
    return <Navigate to="/campo" replace />
  if (exige === 'CAMPO' && !ehTecnico && !ehGestor)
    return <Navigate to="/controle" replace />

  return <>{children}</>
}

/** Cada papel cai na sua casa. */
function Raiz() {
  const { session, carregando, ehGestor, ehTecnico, temPapel } = useAuth()
  if (carregando) return <Carregando />
  if (!session) return <Navigate to="/entrar" replace />
  if (ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR'))
    return <Navigate to="/controle" replace />
  if (ehTecnico) return <Navigate to="/campo" replace />
  return <Navigate to="/campo" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Raiz />} />
        <Route path="/entrar" element={<Login />} />

        <Route path="/controle" element={
          <Protegida exige="GESTAO"><Controle /></Protegida>} />
        <Route path="/controle/servicos" element={
          <Protegida exige="GESTAO"><Servicos /></Protegida>} />
        <Route path="/controle/equipes" element={
          <Protegida exige="GESTAO"><Equipes /></Protegida>} />
        <Route path="/controle/importar" element={
          <Protegida exige="GESTAO"><Importacao /></Protegida>} />

        <Route path="/campo" element={
          <Protegida exige="CAMPO"><Campo /></Protegida>} />
        <Route path="/campo/visita/:id" element={
          <Protegida exige="CAMPO"><Visita /></Protegida>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
