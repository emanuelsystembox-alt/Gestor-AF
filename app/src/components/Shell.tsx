import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useTema } from '../lib/tema'
import { Marca } from './ui'
import { Icone, type NomeIcone } from './icones'

interface Item {
  para: string; rotulo: string; icone: NomeIcone
  contagem?: number; futuro?: boolean
}

/**
 * Menu recolhido: a preferencia fica no navegador, como a do tema.
 *
 * Quem trabalha em tela de 1366 quer os 224px da lateral de volta para
 * a tabela; quem tem monitor grande quer o menu escrito. E preferencia,
 * e preferencia que volta ao normal a cada F5 nao e preferencia.
 *
 * Recolhido, a lateral NAO some: vira uma faixa de iniciais. Sumir de
 * vez tiraria a navegacao da tela -- a ideia e ganhar espaco, nao se
 * perder.
 */
const CHAVE_MENU = 'afline:menu-recolhido'

function lerRecolhido(): boolean {
  try { return localStorage.getItem(CHAVE_MENU) === '1' } catch { return false }
}

const OPERACAO: Item[] = [
  { para: '/controle', rotulo: 'Dashboard', icone: 'dashboard' },
  { para: '/controle/servicos', rotulo: 'Serviços', icone: 'servicos' },
  { para: '/controle/equipes', rotulo: 'Equipes', icone: 'equipes' },
  { para: '/controle/rota', rotulo: 'Rota do dia', icone: 'rota' },
  { para: '/controle/produtividade', rotulo: 'Meta técnica', icone: 'produtividade' },
  { para: '/controle/relatorios', rotulo: 'Relatórios', icone: 'relatorios' },
]
const ENTRADA: Item[] = [
  { para: '/controle/importar', rotulo: 'Importar TOA', icone: 'importar' },
  { para: '/controle/sub-falhas', rotulo: 'Sub-falhas', icone: 'subfalhas' },
]
const AJUSTES: Item[] = [
  { para: '/controle/configuracoes', rotulo: 'Configurações', icone: 'configuracoes' },
  { para: '/controle/administracao', rotulo: 'Administração', icone: 'administracao' },
]
const FUTURO: Item[] = [
  { para: '/estoque', rotulo: 'Estoque', icone: 'estoque', futuro: true },
  { para: '/frota', rotulo: 'Frota', icone: 'frota', futuro: true },
]

function Grupo({ titulo, itens, recolhido }: {
  titulo: string; itens: Item[]; recolhido?: boolean
}) {
  const local = useLocation()
  return (
    <div className={recolhido ? 'mb-3' : 'mb-5'}>
      {recolhido ? (
        // Um traco no lugar do titulo: o agrupamento continua legivel
        // sem a palavra, que nao caberia em 3rem.
        <div className="mx-3 mb-1.5 border-t border-graf-800" />
      ) : (
        <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-graf-600">
          {titulo}
        </p>
      )}
      <nav className="space-y-0.5">
        {itens.map(i => {
          const ativo = local.pathname === i.para
          if (i.futuro) return (
            <span key={i.para}
              className={`flex cursor-not-allowed items-center gap-2.5 rounded-md py-1.5
                          text-sm text-graf-600 ${recolhido ? 'justify-center px-0' : 'px-3'}`}
              title={recolhido ? `${i.rotulo} — ainda não construído` : 'Ainda não construído — Fase 2'}>
              <Icone nome={i.icone} />
              {!recolhido && <>
                {i.rotulo}
                <span className="ml-auto rounded bg-graf-800 px-1.5 py-0.5 text-[9px]
                                 font-semibold uppercase text-graf-500">em breve</span>
              </>}
            </span>
          )
          return (
            <NavLink key={i.para} to={i.para} title={recolhido ? i.rotulo : undefined}
              className={`flex items-center gap-2.5 rounded-md py-1.5 text-sm transition ${
                recolhido ? 'justify-center px-0' : 'px-3'} ${
                ativo ? 'bg-af-600/15 font-medium text-af-300 ring-1 ring-af-600/30'
                      : 'text-graf-300 hover:bg-graf-800'}`}>
              <Icone nome={i.icone} />
              {!recolhido && <>
                {i.rotulo}
                {i.contagem !== undefined && (
                  <span className="tabular ml-auto rounded bg-graf-800 px-1.5 text-[11px]">
                    {i.contagem}
                  </span>
                )}
              </>}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

export function Shell({ children, acoes }: { children: ReactNode; acoes?: ReactNode }) {
  const { perfil, papeis, sair } = useAuth()
  const [tema, setTema] = useTema()
  const [recolhido, setRecolhido] = useState(lerRecolhido)
  /** Recolhido, mas com o mouse em cima: abre só enquanto o cursor
   *  estiver lá. Não mexe na preferência guardada. */
  const [espiando, setEspiando] = useState(false)
  const aberto = !recolhido || espiando

  useEffect(() => {
    try { localStorage.setItem(CHAVE_MENU, recolhido ? '1' : '0') } catch { /* sem storage */ }
  }, [recolhido])

  return (
    <div className="sup-controle flex min-h-screen">
      {/* ---------- lateral ---------- */}
      {/*
        * Recolhido, a lateral vira uma faixa de ícones de 56px — e
        * ABRE SOZINHA quando o mouse encosta (D-110). A faixa segura o
        * espaço no layout; o painel que cresce é `absolute`, por cima
        * do conteúdo, para a tabela não se mexer a cada passada de
        * mouse. Menu que empurra a tela ao passar o cursor é pior que
        * menu estreito.
        */}
      <aside className={`relative hidden shrink-0 lg:block
                         ${recolhido ? 'w-14' : 'w-56'}`}>
        <div onMouseEnter={() => recolhido && setEspiando(true)}
             onMouseLeave={() => setEspiando(false)}
             className={`absolute left-0 top-0 h-full border-r border-graf-800
                         bg-graf-900 transition-[width] duration-150
                         ${aberto ? 'w-56' : 'w-14'}
                         ${espiando ? 'z-40 shadow-2xl shadow-black/40' : ''}`}>
          <div className="sticky top-0">
            <div className={`flex items-center py-4 ${aberto ? 'px-4' : 'justify-center px-0'}`}>
              <Marca compacto={!aberto} />
            </div>
            <div className="px-2">
              <Grupo titulo="Operação" itens={OPERACAO} recolhido={!aberto} />
              <Grupo titulo="Entrada de dados" itens={ENTRADA} recolhido={!aberto} />
              <Grupo titulo="Ajustes" itens={AJUSTES} recolhido={!aberto} />
              <Grupo titulo="Próximas fases" itens={FUTURO} recolhido={!aberto} />
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- topo ---------- */}
        <header className="sticky top-0 z-30 border-b border-graf-800 bg-graf-950/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5">
            {/* So no desktop: no celular a navegacao e a barra de baixo,
                e nao ha lateral para recolher. */}
            <button onClick={() => { setRecolhido(r => !r); setEspiando(false) }}
              title={recolhido ? 'Expandir o menu' : 'Recolher o menu'}
              aria-label={recolhido ? 'Expandir o menu' : 'Recolher o menu'}
              className="hidden rounded-md border border-graf-700 px-2 py-1 text-xs
                         leading-none text-graf-400 hover:border-af-600
                         hover:text-af-400 lg:block">
              {recolhido ? '»' : '«'}
            </button>
            <div className="lg:hidden"><Marca compacto /></div>
            <span className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1
                             text-xs font-medium text-graf-300">
              MANAUS · AM
            </span>
            <div className="ml-auto flex items-center gap-3">
              {acoes}
              <button
                onClick={() => setTema(tema === 'escuro' ? 'claro' : 'escuro')}
                title={tema === 'escuro' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
                aria-label="Alternar tema"
                className="rounded-md border border-graf-700 px-2 py-1 text-xs text-graf-400
                           hover:border-af-600 hover:text-af-400">
                {tema === 'escuro' ? '☀' : '☾'}
              </button>
              <div className="hidden text-right sm:block">
                <div className="text-xs font-medium leading-tight">{perfil?.nome ?? '—'}</div>
                <div className="text-[10px] leading-tight text-graf-500">
                  {papeis.join(' · ') || 'sem papel'}
                </div>
              </div>
              <button onClick={sair}
                className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-400
                           hover:border-af-600 hover:text-af-400">
                Sair
              </button>
            </div>
          </div>

          {/* navegação móvel */}
          <nav className="flex gap-1 overflow-x-auto border-t border-graf-800 px-4 py-1.5 lg:hidden">
            {[...OPERACAO, ...ENTRADA, ...AJUSTES].filter(i => !i.futuro).map(i => (
              <NavLink key={i.para} to={i.para}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${
                    isActive ? 'bg-af-600 text-white' : 'bg-graf-800 text-graf-300'}`}>
                {i.rotulo}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
