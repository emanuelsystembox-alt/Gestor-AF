import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Login from './pages/Login'
const Controle = lazy(() => import('./pages/Controle'))
const Servicos = lazy(() => import('./pages/Servicos'))
const Equipes = lazy(() => import('./pages/Equipes'))
const VisitaDetalhe = lazy(() => import('./pages/VisitaDetalhe'))
const Importacao = lazy(() => import('./pages/Importacao'))
const SubFalhas = lazy(() => import('./pages/SubFalhas'))
const Configuracoes = lazy(() => import('./pages/Configuracoes'))
const Relatorios = lazy(() => import('./pages/Relatorios'))
const Produtividade = lazy(() => import('./pages/Produtividade'))
const Administracao = lazy(() => import('./pages/Administracao'))
const Campo = lazy(() => import('./pages/Campo'))
const Visita = lazy(() => import('./pages/Visita'))
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
      <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/" element={<Raiz />} />
        <Route path="/entrar" element={<Login />} />

        <Route path="/controle" element={
          <Protegida exige="GESTAO"><Controle /></Protegida>} />
        <Route path="/controle/servicos" element={
          <Protegida exige="GESTAO"><Servicos /></Protegida>} />
        <Route path="/controle/visita/:id" element={
          <Protegida exige="GESTAO"><VisitaDetalhe /></Protegida>} />
        <Route path="/controle/equipes" element={
          <Protegida exige="GESTAO"><Equipes /></Protegida>} />
        <Route path="/controle/importar" element={
          <Protegida exige="GESTAO"><Importacao /></Protegida>} />
        <Route path="/controle/sub-falhas" element={
          <Protegida exige="GESTAO"><SubFalhas /></Protegida>} />
        <Route path="/controle/produtividade" element={
          <Protegida exige="GESTAO"><Produtividade /></Protegida>} />
        <Route path="/controle/relatorios" element={
          <Protegida exige="GESTAO"><Relatorios /></Protegida>} />
        <Route path="/controle/configuracoes" element={
          <Protegida exige="GESTAO"><Configuracoes /></Protegida>} />
        <Route path="/controle/administracao" element={
          <Protegida exige="GESTAO"><Administracao /></Protegida>} />

        <Route path="/campo" element={
          <Protegida exige="CAMPO"><Campo /></Protegida>} />
        <Route path="/campo/visita/:id" element={
          <Protegida exige="CAMPO"><Visita /></Protegida>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </AuthProvider>
  )
}
