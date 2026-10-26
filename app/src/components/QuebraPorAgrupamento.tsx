import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'

/**
 * Responsável pela quebra — o painel no formato que o Emanuel já usa (142).
 *
 * > "preciso desse painel alinhado igual ao do anexo 2 (...) temos o maior
 * >  ofensor como agendamento, depois processo de venda, depois infra claro
 * >  (...) quando eu botar o mouse em cima dessas barras, a ideia é aparecer
 * >  também um resumo igual que está aparecendo para você" — Emanuel, 26/10
 *
 * O eixo é o AGRUPAMENTO (em que parte do processo quebrou), não o
 * responsável: é assim que o painel da CLARO fala, e é o que se ataca.
 * Cada barra mostra o impacto sobre o total de UN; o resumo que abre no
 * mouse traz volume, fatia das quebras, a variação contra o período
 * anterior e os cinco motivos que mais pesam ali dentro.
 *
 * ┌─ a variação só aparece quando é comparável ───────────────────────┐
 * │ O período atual a tela calcula com os filtros que estão nela; o   │
 * │ anterior vem agregado do banco, SEM esses filtros. Comparar os    │
 * │ dois com filtro ligado seria comparar coisas diferentes e chamar  │
 * │ de melhora — então, com filtro, a seta não aparece.               │
 * └────────────────────────────────────────────────────────────────────┘
 */

export interface GrupoQuebra {
  chave: string
  rotulo: string
  valor: number
  pctUn: number
  pctQuebras: number
  cor: string
  motivos: { rotulo: string; qtd: number }[]
}

interface Anterior { agrupamento: string; quebras: number; total_un: number; pct_un: number }

const n2 = (x: number) => x.toFixed(2).replace('.', ',')
const n1 = (x: number) => x.toFixed(1).replace('.', ',')

export function QuebraPorAgrupamento({ grupos, totalUn, totalQuebras, de, ate, temFiltro }: {
  grupos: GrupoQuebra[]
  totalUn: number
  totalQuebras: number
  de: string
  ate: string
  temFiltro: boolean
}) {
  const [anterior, setAnterior] = useState<Map<string, number> | null>(null)
  const [aberto, setAberto] = useState<{ g: GrupoQuebra; x: number; y: number } | null>(null)
  const caixa = useRef<HTMLDivElement>(null)

  // O período anterior tem o MESMO tamanho e termina na véspera do atual.
  useEffect(() => {
    let vivo = true
    const d1 = new Date(de + 'T12:00'), d2 = new Date(ate + 'T12:00')
    const dias = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1)
    const fimAnt = new Date(d1); fimAnt.setDate(fimAnt.getDate() - 1)
    const iniAnt = new Date(fimAnt); iniAnt.setDate(iniAnt.getDate() - (dias - 1))
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    supabase.rpc('impacto_quebra', { p_de: iso(iniAnt), p_ate: iso(fimAnt) })
      .then(({ data }) => {
        if (!vivo) return
        const m = new Map<string, number>()
        for (const a of (data ?? []) as Anterior[]) m.set(a.agrupamento, Number(a.pct_un))
        setAnterior(m)
      })
    return () => { vivo = false }
  }, [de, ate])

  // Fecha o resumo ao sair da área do painel ou ao rolar a página.
  useEffect(() => {
    if (!aberto) return
    const fora = () => setAberto(null)
    window.addEventListener('scroll', fora, true)
    return () => window.removeEventListener('scroll', fora, true)
  }, [aberto])

  const maior = Math.max(...grupos.map(g => g.pctUn), 1)

  return (
    <div ref={caixa} className="relative" onMouseLeave={() => setAberto(null)}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-graf-400">
        <span>Total UN: <strong className="tabular text-graf-200">{totalUn}</strong></span>
        <span>Total c/ quebra: <strong className="tabular text-graf-200">{totalQuebras}</strong></span>
        {!temFiltro && anterior && (
          <span className="ml-auto flex items-center gap-2 text-[11px]">
            <span className="text-emerald-300">↓ melhorou</span>
            <span className="text-af-300">↑ piorou</span>
          </span>
        )}
      </div>

      {grupos.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-500">Nenhuma improdutiva no período.</p>
      ) : (
        <div className="space-y-1.5">
          {grupos.map(g => {
            const ant = anterior?.get(g.chave)
            const varPp = ant == null ? null : g.pctUn - ant
            return (
              <div key={g.chave}
                onMouseEnter={e => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setAberto({ g, x: r.left + 120, y: r.bottom + 6 })
                }}
                className="flex items-center gap-2.5 rounded px-1 py-0.5 text-sm hover:bg-graf-900">
                <span className="w-40 shrink-0 truncate text-right text-[11px] uppercase
                                 tracking-wide text-graf-300" title={g.rotulo}>
                  {g.rotulo}
                </span>
                <div className="h-5 flex-1 rounded-sm bg-graf-900">
                  <div className="h-full rounded-sm transition-all"
                    style={{ width: `${Math.max((g.pctUn / maior) * 100, 1.5)}%`, background: g.cor }} />
                </div>
                <span className="tabular w-16 shrink-0 text-right text-xs font-semibold">
                  {n2(g.pctUn)}%
                </span>
                <span className="tabular w-12 shrink-0 text-right text-[11px] text-graf-400">
                  ({g.valor})
                </span>
                <span className="tabular w-16 shrink-0 text-right text-[11px]">
                  {varPp == null || temFiltro ? (
                    <span className="text-graf-600">—</span>
                  ) : varPp <= 0 ? (
                    <span className="text-emerald-300">▼ {n2(Math.abs(varPp))}</span>
                  ) : (
                    <span className="text-af-300">▲ {n2(varPp)}</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* O resumo vai por PORTAL para a raiz: dentro do cartão, qualquer
          ancestral com `transform` ou `overflow` recortaria ou deslocaria
          a caixa — foi o que aconteceu com o menu do contrato (D-169). */}
      {aberto && createPortal(
        <div style={{ left: aberto.x, top: aberto.y }}
          className="sup-controle pointer-events-none fixed z-[70] w-72 rounded-lg border
                     border-graf-700 bg-graf-900 p-3 shadow-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: aberto.g.cor }}>{aberto.g.rotulo}</p>
          <dl className="mt-2 space-y-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-graf-400">Volume (quebra)</dt>
              <dd className="tabular font-semibold">{aberto.g.valor}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-graf-400">Impacto no total UN</dt>
              <dd className="tabular font-semibold">{n2(aberto.g.pctUn)}%</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-graf-400">% das quebras</dt>
              <dd className="tabular font-semibold">{n2(aberto.g.pctQuebras)}%</dd>
            </div>
            {(() => {
              const ant = anterior?.get(aberto.g.chave)
              if (temFiltro) return (
                <p className="border-t border-graf-800 pt-1.5 text-[11px] text-graf-500">
                  Com filtro na tela não dá para comparar com o período anterior:
                  o anterior vem sem filtro.
                </p>
              )
              if (ant == null) return (
                <p className="border-t border-graf-800 pt-1.5 text-[11px] text-graf-500">
                  Sem quebra deste agrupamento no período anterior.
                </p>
              )
              const v = aberto.g.pctUn - ant
              return (<>
                <div className="flex justify-between gap-3 border-t border-graf-800 pt-1.5">
                  <dt className="text-graf-400">Período anterior</dt>
                  <dd className="tabular">{n2(ant)}%</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-graf-400">Variação (p.p.)</dt>
                  <dd className={`tabular font-semibold ${v <= 0 ? 'text-emerald-300' : 'text-af-300'}`}>
                    {v <= 0 ? '−' : '+'}{n2(Math.abs(v))}
                  </dd>
                </div>
              </>)
            })()}
          </dl>
          {aberto.g.motivos.length > 0 && (
            <div className="mt-2 border-t border-graf-800 pt-2">
              <p className="text-[10px] uppercase tracking-wide text-graf-500">
                Motivos (top {aberto.g.motivos.length})
              </p>
              <ul className="mt-1 space-y-0.5 text-[11px]">
                {aberto.g.motivos.map(mt => (
                  <li key={mt.rotulo} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate text-graf-300">{mt.rotulo}</span>
                    <span className="tabular shrink-0 font-semibold">{mt.qtd}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>,
        document.querySelector('.sup-controle') ?? document.body)}
    </div>
  )
}

/** A tabela que o botão "Ver tabela" mostra — os mesmos números. */
export function tabelaQuebra(grupos: GrupoQuebra[]): (string | number)[][] {
  return grupos.map(g => [g.rotulo, g.valor, `${n1(g.pctUn)}%`, `${n1(g.pctQuebras)}%`])
}
