import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { CentralProvider } from './lib/central'
import Login from './pages/Login'
const Controle = lazy(() => import('./pages/Controle'))
const Servicos = lazy(() => import('./pages/Servicos'))
const Rota = lazy(() => import('./pages/Rota'))
const Equipes = lazy(() => import('./pages/Equipes'))
const VisitaDetalhe = lazy(() => import('./pages/VisitaDetalhe'))
// 140: Indicadores — nasce com a Primeira WO.
const Indicadores = lazy(() => import('./pages/Indicadores'))
const Importacao = lazy(() => import('./pages/Importacao'))
const SubFalhas = lazy(() => import('./pages/SubFalhas'))
const Configuracoes = lazy(() => import('./pages/Configuracoes'))
const Relatorios = lazy(() => import('./pages/Relatorios'))
const Produtividade = lazy(() => import('./pages/Produtividade'))
const Administracao = lazy(() => import('./pages/Administracao'))
const Campo = lazy(() => import('./pages/Campo'))
const Visita = lazy(() => import('./pages/Visita'))
const Almoxarifado = lazy(() => import('./pages/Almoxarifado'))
const Frota = lazy(() => import('./pages/Frota'))
const Monitor = lazy(() => import('./pages/Monitor'))
const Sincronismo = lazy(() => import('./pages/Sincronismo'))
// 146: o que o técnico diz de si — humor do dia e ocorrências (D-226).
const Humor = lazy(() => import('./pages/Humor'))
const Ocorrencias = lazy(() => import('./pages/Ocorrencias'))
// 147: a celula de qualidade -- falar com o assinante atendido (D-228).
const Qualidade = lazy(() => import('./pages/Qualidade'))
import { Carregando } from './components/ui'

/** Só entra quem está logado. Papel exigido é opcional.
 *  Isto é conveniência de navegação — a barreira real é o RLS no banco. */
function Protegida({
  children,
  exige,
}: {
  children: React.ReactNode
  exige?: 'GESTAO' | 'CAMPO' | 'ALMOXARIFADO' | 'FROTA' | 'SINCRONISMO'
}) {
  const { session, carregando, ehGestor, ehTecnico, temPapel } = useAuth()
  const local = useLocation()

  if (carregando) return <Carregando />
  if (!session) return <Navigate to="/entrar" state={{ de: local.pathname }} replace />

  if (exige === 'GESTAO' && !(ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR')))
    return <Navigate to="/campo" replace />
  if (exige === 'CAMPO' && !ehTecnico && !ehGestor)
    return <Navigate to="/controle" replace />
  // O almoxarife nao e gestao nem campo: e o terceiro modulo (077). Sem
  // esta porta ele entraria no sistema e seria expulso para /campo, onde
  // nao tem nada -- e o RLS ja o barra em tudo o mais.
  if (exige === 'ALMOXARIFADO' && !(ehGestor || temPapel('ALMOXARIFE')))
    return <Navigate to="/" replace />
  // Frota é o quarto módulo (088), com o papel que já existia no enum.
  if (exige === 'FROTA' && !(ehGestor || temPapel('FROTA')))
    return <Navigate to="/" replace />
  // 111: a gestão configura; o ROBO roda. O robô não entra em mais nada.
  if (exige === 'SINCRONISMO' && !(ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR', 'ROBO')))
    return <Navigate to="/" replace />

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
  // Almoxarife cai na casa dele, nao num /campo que ele nao usa.
  if (temPapel('ALMOXARIFE')) return <Navigate to="/almoxarifado" replace />
  if (temPapel('FROTA')) return <Navigate to="/frota" replace />
  // O robô de sincronismo (111) só tem uma casa: a tela que ele roda.
  if (temPapel('ROBO')) return <Navigate to="/controle/sincronismo" replace />
  return <Navigate to="/campo" replace />
}

export default function App() {
  return (
    <AuthProvider>
      {/* A central fica ACIMA das rotas: um canal de Realtime a sessão
          inteira, e não um por página (091). */}
      <CentralProvider>
      <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/" element={<Raiz />} />
        <Route path="/entrar" element={<Login />} />

        <Route path="/controle" element={
          <Protegida exige="GESTAO"><Controle /></Protegida>} />
        <Route path="/controle/servicos" element={
          <Protegida exige="GESTAO"><Servicos /></Protegida>} />
        <Route path="/controle/rota" element={
          <Protegida exige="GESTAO"><Rota /></Protegida>} />
        <Route path="/controle/visita/:id" element={
          <Protegida exige="GESTAO"><VisitaDetalhe /></Protegida>} />
        <Route path="/controle/monitor" element={
          <Protegida exige="GESTAO"><Monitor /></Protegida>} />
        <Route path="/controle/equipes" element={
          <Protegida exige="GESTAO"><Equipes /></Protegida>} />
        <Route path="/controle/importar" element={
          <Protegida exige="GESTAO"><Importacao /></Protegida>} />
        <Route path="/controle/sincronismo" element={
          <Protegida exige="SINCRONISMO"><Sincronismo /></Protegida>} />
        <Route path="/controle/sub-falhas" element={
          <Protegida exige="GESTAO"><SubFalhas /></Protegida>} />
        <Route path="/controle/produtividade" element={
          <Protegida exige="GESTAO"><Produtividade /></Protegida>} />
        <Route path="/controle/indicadores" element={
          <Protegida exige="GESTAO"><Indicadores /></Protegida>} />
        <Route path="/controle/relatorios" element={
          <Protegida exige="GESTAO"><Relatorios /></Protegida>} />
        <Route path="/controle/configuracoes" element={
          <Protegida exige="GESTAO"><Configuracoes /></Protegida>} />
        <Route path="/controle/humor" element={
          <Protegida exige="GESTAO"><Humor /></Protegida>} />
        <Route path="/controle/ocorrencias" element={
          <Protegida exige="GESTAO"><Ocorrencias /></Protegida>} />
        <Route path="/controle/qualidade" element={
          <Protegida exige="GESTAO"><Qualidade /></Protegida>} />
        <Route path="/controle/administracao" element={
          <Protegida exige="GESTAO"><Administracao /></Protegida>} />

        <Route path="/almoxarifado" element={
          <Protegida exige="ALMOXARIFADO"><Almoxarifado /></Protegida>} />
        <Route path="/frota" element={
          <Protegida exige="FROTA"><Frota /></Protegida>} />

        <Route path="/campo" element={
          <Protegida exige="CAMPO"><Campo /></Protegida>} />
        <Route path="/campo/visita/:id" element={
          <Protegida exige="CAMPO"><Visita /></Protegida>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </CentralProvider>
    </AuthProvider>
  )
}
