import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useTema } from '../lib/tema'
import { supabase, EM_ABERTO } from '../lib/supabase'
import { isoLocal } from '../lib/formato'
import { Avatar, Logo, Marca } from './ui'
import { Icone, type NomeIcone } from './icones'
import { useCentral } from '../lib/central'
import { PainelCentral } from './PainelCentral'
import { ChatControle } from './ChatControle'

interface Item {
  para: string; rotulo: string; icone: NomeIcone
  /** Palavras a mais para a busca (Ctrl+K) achar a tela pelo que ela faz. */
  busca?: string
  futuro?: boolean
}

interface Modulo {
  chave: string; titulo: string; icone: NomeIcone; itens: Item[]
}

/**
 * Preferências do menu ficam no navegador, como a do tema: é conforto de
 * quem olha, não dado da operação. Tudo em try/catch — janela anônima ou
 * storage bloqueado devolve o padrão, e a tela funciona igual.
 */
const CHAVE_MENU = 'afline:menu-recolhido'
const CHAVE_FECHADOS = 'afline:menu-grupos-fechados'

function lerRecolhido(): boolean {
  try { return localStorage.getItem(CHAVE_MENU) === '1' } catch { return false }
}
function lerFechados(): string[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_FECHADOS) ?? '[]') as string[] } catch { return [] }
}

/**
 * O menu é por MÓDULO, não por função (D-152).
 *
 * ┌─ o que veio do concorrente, e o que foi além (D-166) ────────────┐
 * │ O ngestor separa módulos no topo e, dentro de cada um, grupos    │
 * │ (Operação, Análise, Importadores) com CONTADOR ao lado do item — │
 * │ o COP vê "Serviços 13" sem abrir a tela. Isso é bom e veio.      │
 * │                                                                  │
 * │ O que ele não tem, e entrou aqui:                                │
 * │  · o grupo abre e fecha, e LEMBRA — quem só mexe em estoque      │
 * │    fecha Operação uma vez e não vê mais;                         │
 * │  · Ctrl+K: vai para qualquer tela digitando, sem conhecer o mapa;│
 * │  · o topo diz onde você está (Módulo › Tela);                    │
 * │  · no celular, gaveta com o mesmo menu, e não uma faixa de botões│
 * │    que escondia a Frota e ignorava a permissão.                  │
 * └──────────────────────────────────────────────────────────────────┘
 */
const OPERACAO: Modulo = {
  chave: 'operacao', titulo: 'Operação', icone: 'servicos', itens: [
    { para: '/controle', rotulo: 'Dashboard', icone: 'dashboard', busca: 'painel controle inicio' },
    { para: '/controle/servicos', rotulo: 'Serviços', icone: 'servicos', busca: 'contratos os visitas baixa' },
    { para: '/controle/equipes', rotulo: 'Equipes', icone: 'equipes', busca: 'tecnicos login' },
    { para: '/controle/rota', rotulo: 'Rota do dia', icone: 'rota', busca: 'mapa' },
    { para: '/controle/produtividade', rotulo: 'Meta técnica', icone: 'produtividade', busca: 'produtividade pontos comissao' },
    { para: '/controle/relatorios', rotulo: 'Relatórios', icone: 'relatorios' },
    { para: '/controle/importar', rotulo: 'Importar TOA', icone: 'importar', busca: 'planilha importacao rota' },
    // Sub-falhas saiu daqui: mora em Configurações, aba Sub-falhas (D-161).
  ],
}
const ALMOXARIFADO: Modulo = {
  chave: 'almoxarifado', titulo: 'Almoxarifado', icone: 'estoque', itens: [
    { para: '/almoxarifado', rotulo: 'Estoque', icone: 'estoque', busca: 'almoxarifado romaneio serial miscelanea carga' },
  ],
}
const FROTA: Modulo = {
  chave: 'frota', titulo: 'Frota', icone: 'frota', itens: [
    { para: '/frota', rotulo: 'Veículos e consumo', icone: 'frota', busca: 'carro abastecimento km' },
  ],
}
const AJUSTES: Modulo = {
  chave: 'ajustes', titulo: 'Ajustes', icone: 'configuracoes', itens: [
    { para: '/controle/configuracoes', rotulo: 'Configurações', icone: 'configuracoes', busca: 'sub-falhas situacao parametros' },
    { para: '/controle/administracao', rotulo: 'Administração', icone: 'administracao', busca: 'usuarios perfil acesso' },
  ],
}
const FUTURO: Modulo = {
  chave: 'futuro', titulo: 'Próximas fases', icone: 'relatorios', itens: [
    { para: '/financeiro', rotulo: 'Financeiro', icone: 'produtividade', futuro: true },
    { para: '/rh', rotulo: 'RH', icone: 'equipes', futuro: true },
  ],
}

/** Os módulos que ESTA pessoa enxerga. A barreira real é o RLS; isto é
 *  para a tela não oferecer o que vai dar em porta fechada. */
function useModulos(): Modulo[] {
  const { pode, ehGestor, temPapel } = useAuth()
  const gestao = ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR')
  return [
    ...(gestao ? [OPERACAO] : []),
    ...(pode('almoxarifado.ver') ? [ALMOXARIFADO] : []),
    ...(pode('frota.ver') ? [FROTA] : []),
    ...(gestao ? [AJUSTES] : []),
    FUTURO,
  ]
}

/** A tela ativa é a do caminho EXATO. Prefixo não serve: o detalhe da
 *  visita (`/controle/visita/…`) acenderia o Dashboard só porque começa
 *  com `/controle`. */
function ativo(pathname: string, para: string) {
  return pathname === para
}

/**
 * Contratos EM ABERTO hoje, para o contador de Serviços.
 *
 * Mesma conta da tela de Serviços: situação em `EM_ABERTO` e jornada
 * fora (Na Base / Refeição não é serviço — D-117 e business-rules).
 * Enquanto não sabe, devolve `null` e o menu NÃO mostra número: um "0"
 * no carregamento seria afirmar que não há nada aberto.
 */
function useAbertosHoje(ligado: boolean): number | null {
  const [n, setN] = useState<number | null>(null)
  const local = useLocation()

  useEffect(() => {
    if (!ligado) return
    let vivo = true
    const contar = () => {
      supabase.from('visita')
        .select('id, tipo_atividade:tipo_atividade_id ( natureza )')
        .eq('data_agendada', isoLocal())
        .is('excluido_em', null)
        .in('situacao', EM_ABERTO)
        .then(({ data, error }) => {
          if (!vivo) return
          if (error) { setN(null); return }
          const linhas = (data ?? []) as unknown as { tipo_atividade: { natureza: string } | null }[]
          setN(linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA').length)
        })
    }
    contar()
    // A cada 2 min: o menu é olhado de relance, não precisa de Realtime
    // (e cada canal é uma conexão do teto do plano Free).
    const t = setInterval(contar, 120_000)
    return () => { vivo = false; clearInterval(t) }
    // Recontar ao trocar de tela: quem volta de uma baixa quer ver o
    // número já descontado.
  }, [ligado, local.pathname])

  return n
}

/** O número ao lado de um item do menu, e o que ele conta. */
interface Contagem { n: number | null; titulo: string }

function Grupo({ modulo, recolhido, fechado, alternar, contagens, aoNavegar }: {
  modulo: Modulo; recolhido: boolean; fechado: boolean; alternar: () => void
  contagens: Record<string, Contagem>; aoNavegar?: () => void
}) {
  const local = useLocation()
  const temAtivo = modulo.itens.some(i => ativo(local.pathname, i.para))
  // O grupo da tela atual nunca fica fechado: esconder onde você está
  // é perder o fio.
  const aberto = recolhido || !fechado || temAtivo

  return (
    <div className={recolhido ? 'mb-2' : 'mb-3'}>
      {recolhido ? (
        <div className="mx-3 mb-1.5 border-t border-graf-800" />
      ) : (
        <button onClick={alternar} aria-expanded={aberto}
          className="group mb-1 flex w-full items-center gap-2 rounded px-3 py-1
                     text-[10px] font-semibold uppercase tracking-widest text-graf-400
                     hover:text-graf-200">
          {modulo.titulo}
          <span className="ml-auto h-px flex-1 bg-graf-800 group-hover:bg-graf-700" />
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden
               className={`shrink-0 transition-transform ${aberto ? '' : '-rotate-90'}`}>
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      )}
      {aberto && (
        <nav className="space-y-0.5">
          {modulo.itens.map(i => {
            const eh = ativo(local.pathname, i.para)
            const c = contagens[i.para]
            const n = c?.n ?? null
            if (i.futuro) return (
              <span key={i.para}
                className={`flex cursor-not-allowed items-center gap-2.5 rounded-md py-1.5
                            text-sm text-graf-500 ${recolhido ? 'justify-center px-0' : 'px-3'}`}
                title={recolhido ? `${i.rotulo} — ainda não construído` : 'Ainda não construído'}>
                <Icone nome={i.icone} />
                {!recolhido && <>
                  {i.rotulo}
                  <span className="ml-auto rounded bg-graf-800 px-1.5 py-0.5 text-[9px]
                                   font-semibold uppercase text-graf-400">em breve</span>
                </>}
              </span>
            )
            return (
              <NavLink key={i.para} to={i.para} onClick={aoNavegar}
                title={recolhido ? (n != null ? `${i.rotulo} · ${n} ${c!.titulo}` : i.rotulo) : undefined}
                aria-current={eh ? 'page' : undefined}
                className={`relative flex items-center gap-2.5 rounded-md py-1.5 text-sm transition ${
                  recolhido ? 'justify-center px-0' : 'px-3'} ${
                  eh ? 'bg-af-600/15 font-medium text-af-300'
                     : 'text-graf-300 hover:bg-graf-800 hover:text-graf-100'}`}>
                {/* a barra vermelha na borda: o "você está aqui" que se
                    lê de canto de olho, inclusive no menu recolhido */}
                {eh && <span aria-hidden
                  className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-r bg-af-500" />}
                <Icone nome={i.icone} />
                {!recolhido && <>
                  <span className="truncate">{i.rotulo}</span>
                  {n != null && (
                    <span title={c!.titulo}
                      className={`tabular ml-auto rounded px-1.5 text-[11px] font-medium ${
                        eh ? 'bg-af-600/25 text-af-200' : 'bg-graf-800 text-graf-300'}`}>
                      {n}
                    </span>
                  )}
                </>}
                {recolhido && n != null && n > 0 && (
                  <span aria-hidden className="absolute right-2 top-1 h-1.5 w-1.5 rounded-full bg-af-500" />
                )}
              </NavLink>
            )
          })}
        </nav>
      )}
    </div>
  )
}

/** Ctrl+K: ir para qualquer tela pelo nome ou pelo que ela faz. */
function BuscaDeTelas({ modulos, fechar }: { modulos: Modulo[]; fechar: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const navegar = useNavigate()
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => { campo.current?.focus() }, [])

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const itens = useMemo(() => {
    const todos = modulos.flatMap(m => m.itens.filter(i => !i.futuro)
      .map(i => ({ ...i, modulo: m.titulo })))
    const termos = norm(q).split(/\s+/).filter(Boolean)
    return todos.filter(i => {
      const alvo = norm(`${i.rotulo} ${i.modulo} ${i.busca ?? ''}`)
      return termos.every(t => alvo.includes(t))
    })
  }, [q, modulos])

  useEffect(() => { setSel(0) }, [q])

  function ir(para: string) { fechar(); navegar(para) }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
         onMouseDown={fechar} role="dialog" aria-modal="true" aria-label="Ir para uma tela">
      <div className="card-controle w-full max-w-md overflow-hidden shadow-2xl"
           onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-graf-800 px-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" className="text-graf-400" aria-hidden>
            <circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" />
          </svg>
          <input ref={campo} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Ir para… (ex.: estoque, importar, meta)"
            aria-label="Buscar tela"
            onKeyDown={e => {
              if (e.key === 'Escape') fechar()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, itens.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter' && itens[sel]) ir(itens[sel].para)
            }}
            // Sem o anel de foco global: a caixa inteira É o foco aqui,
            // e o anel dentro dela desenhava uma segunda moldura.
            className="w-full bg-transparent py-3 text-sm outline-none
                       placeholder:text-graf-500 focus-visible:outline-none" />
          <kbd className="rounded border border-graf-700 px-1.5 text-[10px] text-graf-400">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {itens.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-graf-400">Nenhuma tela com esse nome.</li>
          )}
          {itens.map((i, k) => (
            <li key={i.para}>
              <button onMouseEnter={() => setSel(k)} onClick={() => ir(i.para)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm ${
                  k === sel ? 'bg-af-600/15 text-af-200' : 'text-graf-200'}`}>
                <Icone nome={i.icone} />
                {i.rotulo}
                <span className="ml-auto text-[11px] text-graf-400">{i.modulo}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function Shell({ children, acoes }: { children: ReactNode; acoes?: ReactNode }) {
  const { perfil, papeis, sair, ehGestor, temPapel } = useAuth()
  const [tema, setTema] = useTema()
  const local = useLocation()
  const modulos = useModulos()
  const [recolhido, setRecolhido] = useState(lerRecolhido)
  const [fechados, setFechados] = useState<string[]>(lerFechados)
  /** Recolhido, mas com o mouse em cima: abre só enquanto o cursor
   *  estiver lá (D-110). Não mexe na preferência guardada. */
  const [espiando, setEspiando] = useState(false)
  const [gaveta, setGaveta] = useState(false)
  const [busca, setBusca] = useState(false)
  const aberto = !recolhido || espiando

  const gestao = ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR')
  const abertos = useAbertosHoje(gestao)
  const central = useCentral()
  const [sinoAberto, setSinoAberto] = useState(false)
  const naoLidas = central.dados?.mensagens?.reduce((s, m) => s + Number(m.nao_lidas), 0) ?? null
  // 091: o selo do módulo mostra o que o CAMPO pediu e ainda espera
  // resposta — sinalização de material, pedido de abastecimento. Sem a
  // central carregada, nulo: nada de "0" que ninguém mediu.
  const contagens: Record<string, Contagem> = {
    '/controle/servicos': { n: abertos, titulo: 'em aberto hoje (sem jornada)' },
    // Selo de pedido só aparece quando há pedido: é chamada de atenção,
    // não inventário.
    '/almoxarifado': { n: central.dados?.material?.length || null, titulo: 'sinalização(ões) do campo aguardando' },
    '/frota': { n: central.dados?.abastecimento?.length || null, titulo: 'abastecimento(s) aguardando aprovação' },
  }

  useEffect(() => {
    try { localStorage.setItem(CHAVE_MENU, recolhido ? '1' : '0') } catch { /* sem storage */ }
  }, [recolhido])
  useEffect(() => {
    try { localStorage.setItem(CHAVE_FECHADOS, JSON.stringify(fechados)) } catch { /* sem storage */ }
  }, [fechados])

  // Ctrl+K (ou ⌘K) em qualquer tela.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setBusca(b => !b)
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  // Trocou de tela, a gaveta do celular fecha.
  useEffect(() => { setGaveta(false) }, [local.pathname])

  const alternar = (chave: string) =>
    setFechados(f => f.includes(chave) ? f.filter(x => x !== chave) : [...f, chave])

  // Onde estou: o módulo e a tela, para o topo.
  const aqui = modulos.flatMap(m => m.itens.map(i => ({ m, i })))
    .find(x => ativo(local.pathname, x.i.para))

  const menu = (compacto: boolean, aoNavegar?: () => void) => (
    <div className="flex h-full flex-col">
      <div className={`flex items-center py-4 ${compacto ? 'justify-center px-0' : 'px-4'}`}>
        <Marca compacto={compacto} />
      </div>

      <div className={compacto ? 'px-2 pb-2' : 'px-3 pb-3'}>
        <button onClick={() => setBusca(true)} title="Ir para uma tela (Ctrl+K)"
          className={`flex w-full items-center gap-2 rounded-md border border-graf-800
                      bg-graf-950/40 text-xs text-graf-400 hover:border-graf-700 hover:text-graf-200
                      ${compacto ? 'justify-center py-2' : 'px-2.5 py-1.5'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" aria-hidden className="shrink-0">
            <circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" />
          </svg>
          {!compacto && <>
            Ir para…
            <kbd className="ml-auto rounded border border-graf-700 px-1 text-[10px]">Ctrl K</kbd>
          </>}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {modulos.map(m => (
          <Grupo key={m.chave} modulo={m} recolhido={compacto}
            fechado={fechados.includes(m.chave)} alternar={() => alternar(m.chave)}
            contagens={contagens} aoNavegar={aoNavegar} />
        ))}
      </div>

      {/* quem está logado, no pé da lateral */}
      <div className={`border-t border-graf-800 py-3 ${compacto ? 'px-2' : 'px-3'}`}>
        <div className={`flex items-center gap-2.5 ${compacto ? 'justify-center' : ''}`}>
          <Avatar nome={perfil?.nome ?? perfil?.email} tamanho={30}
            titulo={compacto ? `${perfil?.nome ?? '—'} · ${papeis.join(' · ')}` : undefined} />
          {!compacto && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-medium">{perfil?.nome ?? '—'}</div>
              <div className="truncate text-[10px] text-graf-400">
                {papeis.join(' · ') || 'sem papel'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="sup-controle flex min-h-screen">
      {/* ---------- lateral (desktop) ---------- */}
      {/*
        * Recolhido, a lateral vira uma faixa de ícones de 56px — e
        * ABRE SOZINHA quando o mouse encosta (D-110). A faixa segura o
        * espaço no layout; o painel que cresce é `absolute`, por cima
        * do conteúdo, para a tabela não se mexer a cada passada de
        * mouse.
        */}
      <aside className={`relative hidden shrink-0 lg:block ${recolhido ? 'w-14' : 'w-60'}`}>
        <div onMouseEnter={() => recolhido && setEspiando(true)}
             onMouseLeave={() => setEspiando(false)}
             className={`absolute left-0 top-0 h-full border-r border-graf-800
                         bg-graf-900 transition-[width] duration-150
                         ${aberto ? 'w-60' : 'w-14'}
                         ${espiando ? 'z-40 shadow-2xl shadow-black/40' : ''}`}>
          <div className="sticky top-0 h-screen">{menu(!aberto)}</div>
        </div>
      </aside>

      {/* ---------- gaveta (celular) ---------- */}
      {gaveta && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setGaveta(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-graf-800
                          bg-graf-900 shadow-2xl">
            {menu(false, () => setGaveta(false))}
          </div>
        </div>
      )}

      {busca && <BuscaDeTelas modulos={modulos} fechar={() => setBusca(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- topo ---------- */}
        <header className="sticky top-0 z-30 border-b border-graf-800 bg-graf-950/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button onClick={() => { setRecolhido(r => !r); setEspiando(false) }}
              title={recolhido ? 'Expandir o menu' : 'Recolher o menu'}
              aria-label={recolhido ? 'Expandir o menu' : 'Recolher o menu'}
              className="hidden rounded-md border border-graf-700 px-2 py-1 text-xs
                         leading-none text-graf-400 hover:border-af-600
                         hover:text-af-400 lg:block">
              {recolhido ? '»' : '«'}
            </button>
            <button onClick={() => setGaveta(true)} aria-label="Abrir o menu"
              className="rounded-md border border-graf-700 p-1.5 text-graf-300 lg:hidden">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.8" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <div className="lg:hidden"><Logo tamanho={28} /></div>

            {/* onde estou */}
            <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1.5 text-sm">
              {aqui ? <>
                <span className="hidden text-graf-400 sm:inline">{aqui.m.titulo}</span>
                <span className="hidden text-graf-600 sm:inline" aria-hidden>›</span>
                <span className="truncate font-medium">{aqui.i.rotulo}</span>
              </> : null}
            </nav>

            <span className="hidden rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1
                             text-xs font-medium text-graf-300 md:inline">
              MANAUS · AM
            </span>

            <div className="ml-auto flex items-center gap-3">
              {acoes}
              {/* 091: a conversa com o campo e a central. O balão conta
                  mensagem; o sino conta o que pede AÇÃO. */}
              {gestao && (
                <button onClick={() => central.abrirChat(null)}
                  aria-label={naoLidas ? `Conversas, ${naoLidas} não lida(s)` : 'Conversas com o campo'}
                  title="Conversas com o campo"
                  className="relative rounded-md border border-graf-700 px-2 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
                    <path d="M4 5.5h16v10H9l-4.5 3.5V15.5H4z" />
                  </svg>
                  {!!naoLidas && (
                    <span className="tabular absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-af-600 px-1
                                     text-center text-[10px] font-semibold leading-4 text-white">
                      {naoLidas > 99 ? '99+' : naoLidas}
                    </span>
                  )}
                </button>
              )}
              {central.dados && (
                <div className="relative">
                  <button onClick={() => setSinoAberto(a => !a)} aria-expanded={sinoAberto}
                    aria-label={central.total ? `Central: ${central.total} item(ns) pedindo atenção` : 'Central do controle'}
                    title="O que pede atenção"
                    className="relative rounded-md border border-graf-700 px-2 py-1 text-graf-300
                               hover:border-af-600 hover:text-af-400">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" />
                    </svg>
                    {central.total > 0 && (
                      <span className="tabular absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-orange-500 px-1
                                       text-center text-[10px] font-semibold leading-4 text-white">
                        {central.total > 99 ? '99+' : central.total}
                      </span>
                    )}
                  </button>
                  {sinoAberto && <PainelCentral fechar={() => setSinoAberto(false)} />}
                </div>
              )}
              <button
                onClick={() => setTema(tema === 'escuro' ? 'claro' : 'escuro')}
                title={tema === 'escuro' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
                aria-label="Alternar tema"
                className="rounded-md border border-graf-700 px-2 py-1 text-xs text-graf-400
                           hover:border-af-600 hover:text-af-400">
                {tema === 'escuro' ? '☀' : '☾'}
              </button>
              <button onClick={sair}
                className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-400
                           hover:border-af-600 hover:text-af-400">
                Sair
              </button>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
        <ChatControle />
      </div>
    </div>
  )
}
