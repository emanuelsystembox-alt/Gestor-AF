import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { Marca } from './ui'

interface Item { para: string; rotulo: string; contagem?: number; futuro?: boolean }

const OPERACAO: Item[] = [
  { para: '/controle', rotulo: 'Dashboard' },
  { para: '/controle/servicos', rotulo: 'Serviços' },
  { para: '/controle/equipes', rotulo: 'Equipes' },
  { para: '/controle/produtividade', rotulo: 'Produtividade', futuro: true },
]
const ENTRADA: Item[] = [
  { para: '/controle/importar', rotulo: 'Importar TOA' },
]
const FUTURO: Item[] = [
  { para: '/estoque', rotulo: 'Estoque', futuro: true },
  { para: '/frota', rotulo: 'Frota', futuro: true },
  { para: '/admin', rotulo: 'Administração', futuro: true },
]

function Grupo({ titulo, itens }: { titulo: string; itens: Item[] }) {
  const local = useLocation()
  return (
    <div className="mb-5">
      <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-graf-600">
        {titulo}
      </p>
      <nav className="space-y-0.5">
        {itens.map(i => {
          const ativo = local.pathname === i.para
          if (i.futuro) return (
            <span key={i.para}
              className="flex cursor-not-allowed items-center gap-2 rounded-md px-3 py-1.5
                         text-sm text-graf-600"
              title="Ainda não construído — Fase 2">
              {i.rotulo}
              <span className="ml-auto rounded bg-graf-800 px-1.5 py-0.5 text-[9px]
                               font-semibold uppercase text-graf-500">em breve</span>
            </span>
          )
          return (
            <NavLink key={i.para} to={i.para}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
                ativo ? 'bg-af-600/15 font-medium text-af-300 ring-1 ring-af-600/30'
                      : 'text-graf-300 hover:bg-graf-800'}`}>
              {i.rotulo}
              {i.contagem !== undefined && (
                <span className="tabular ml-auto rounded bg-graf-800 px-1.5 text-[11px]">
                  {i.contagem}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

export function Shell({ children, acoes }: { children: ReactNode; acoes?: ReactNode }) {
  const { perfil, papeis, sair } = useAuth()

  return (
    <div className="sup-controle flex min-h-screen">
      {/* ---------- lateral ---------- */}
      <aside className="hidden w-56 shrink-0 border-r border-graf-800 bg-graf-900 lg:block">
        <div className="sticky top-0">
          <div className="px-4 py-4"><Marca /></div>
          <div className="px-2">
            <Grupo titulo="Operação" itens={OPERACAO} />
            <Grupo titulo="Entrada de dados" itens={ENTRADA} />
            <Grupo titulo="Próximas fases" itens={FUTURO} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- topo ---------- */}
        <header className="sticky top-0 z-30 border-b border-graf-800 bg-graf-950/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="lg:hidden"><Marca compacto /></div>
            <span className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1
                             text-xs font-medium text-graf-300">
              MANAUS · AM
            </span>
            <div className="ml-auto flex items-center gap-3">
              {acoes}
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
            {[...OPERACAO, ...ENTRADA].filter(i => !i.futuro).map(i => (
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
