import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { useTema } from '../lib/tema'
import { Marca } from './ui'

interface Item { para: string; rotulo: string; contagem?: number; futuro?: boolean }

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

/** A inicial que representa o item quando so cabe um caractere. */
function sigla(rotulo: string): string {
  return rotulo.trim().charAt(0).toUpperCase()
}

const OPERACAO: Item[] = [
  { para: '/controle', rotulo: 'Dashboard' },
  { para: '/controle/servicos', rotulo: 'Serviços' },
  { para: '/controle/equipes', rotulo: 'Equipes' },
  { para: '/controle/produtividade', rotulo: 'Produtividade' },
  { para: '/controle/relatorios', rotulo: 'Relatórios' },
]
const ENTRADA: Item[] = [
  { para: '/controle/importar', rotulo: 'Importar TOA' },
  { para: '/controle/sub-falhas', rotulo: 'Sub-falhas' },
]
const AJUSTES: Item[] = [
  { para: '/controle/configuracoes', rotulo: 'Configurações' },
  { para: '/controle/administracao', rotulo: 'Administração' },
]
const FUTURO: Item[] = [
  { para: '/estoque', rotulo: 'Estoque', futuro: true },
  { para: '/frota', rotulo: 'Frota', futuro: true },
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
              className={`flex cursor-not-allowed items-center gap-2 rounded-md py-1.5
                          text-sm text-graf-600 ${recolhido ? 'justify-center px-0' : 'px-3'}`}
              title={recolhido ? `${i.rotulo} — ainda não construído` : 'Ainda não construído — Fase 2'}>
              {recolhido ? sigla(i.rotulo) : i.rotulo}
              {!recolhido && (
                <span className="ml-auto rounded bg-graf-800 px-1.5 py-0.5 text-[9px]
                                 font-semibold uppercase text-graf-500">em breve</span>
              )}
            </span>
          )
          return (
            // Recolhido, o `title` e a unica pista do que e o item --
            // sem ele a faixa de iniciais vira adivinhacao.
            <NavLink key={i.para} to={i.para} title={recolhido ? i.rotulo : undefined}
              className={`flex items-center gap-2 rounded-md py-1.5 text-sm transition ${
                recolhido ? 'justify-center px-0' : 'px-3'} ${
                ativo ? 'bg-af-600/15 font-medium text-af-300 ring-1 ring-af-600/30'
                      : 'text-graf-300 hover:bg-graf-800'}`}>
              {recolhido ? sigla(i.rotulo) : i.rotulo}
              {!recolhido && i.contagem !== undefined && (
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
  const [tema, setTema] = useTema()
  const [recolhido, setRecolhido] = useState(lerRecolhido)

  useEffect(() => {
    try { localStorage.setItem(CHAVE_MENU, recolhido ? '1' : '0') } catch { /* sem storage */ }
  }, [recolhido])

  return (
    <div className="sup-controle flex min-h-screen">
      {/* ---------- lateral ---------- */}
      <aside className={`hidden shrink-0 border-r border-graf-800 bg-graf-900
                         transition-[width] duration-150 lg:block
                         ${recolhido ? 'w-14' : 'w-56'}`}>
        <div className="sticky top-0">
          <div className={`flex items-center py-4 ${recolhido ? 'justify-center px-0' : 'px-4'}`}>
            <Marca compacto={recolhido} />
          </div>
          <div className="px-2">
            <Grupo titulo="Operação" itens={OPERACAO} recolhido={recolhido} />
            <Grupo titulo="Entrada de dados" itens={ENTRADA} recolhido={recolhido} />
            <Grupo titulo="Ajustes" itens={AJUSTES} recolhido={recolhido} />
            <Grupo titulo="Próximas fases" itens={FUTURO} recolhido={recolhido} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- topo ---------- */}
        <header className="sticky top-0 z-30 border-b border-graf-800 bg-graf-950/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5">
            {/* So no desktop: no celular a navegacao e a barra de baixo,
                e nao ha lateral para recolher. */}
            <button onClick={() => setRecolhido(r => !r)}
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
