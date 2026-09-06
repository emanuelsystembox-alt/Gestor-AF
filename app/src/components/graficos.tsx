import { useId, useState, type ReactNode } from 'react'

/* ============================================================
   Gráficos em SVG puro — sem biblioteca.
   Motivo: controle total do tema (claro/escuro), bundle pequeno,
   e nenhuma dependência externa para o time manter.

   Todo gráfico oferece "Ver tabela": quem usa leitor de tela, quem
   precisa do número exato e quem vai copiar para um relatório não
   deveriam depender de ler pixels.
   ============================================================ */

export function Painel({
  titulo, extra, children, tabela,
}: {
  titulo: string
  extra?: ReactNode
  children: ReactNode
  tabela?: ReactNode
}) {
  const [verTabela, setVerTabela] = useState(false)
  return (
    <section className="card-controle p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        <div className="flex items-center gap-3">
          {extra}
          {tabela && (
            <button
              onClick={() => setVerTabela(v => !v)}
              className="text-xs text-graf-400 underline-offset-2 hover:text-af-400 hover:underline"
            >
              {verTabela ? 'Ver gráfico' : 'Ver tabela'}
            </button>
          )}
        </div>
      </div>
      {verTabela && tabela ? tabela : children}
    </section>
  )
}

/** Minigráfico de tendência ao lado do número grande. */
export function Sparkline({ valores, cor = 'var(--color-af-500)' }: {
  valores: number[]; cor?: string
}) {
  if (valores.length < 2) return <div className="h-9" />
  const min = Math.min(...valores), max = Math.max(...valores)
  const amp = max - min || 1
  const L = 160, A = 36
  const pts = valores.map((v, i) => {
    const x = (i / (valores.length - 1)) * L
    const y = A - ((v - min) / amp) * (A - 6) - 3
    return [x, y] as const
  })
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [ux, uy] = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={cor} strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={ux} cy={uy} r="2.5" fill={cor} />
    </svg>
  )
}

/** Cartão de indicador: número grande, variação e meta. */
export function Indicador({
  rotulo, valor, sufixo = '', variacao, meta, serie, cor, alerta, detalhe,
}: {
  rotulo: string
  valor: number | string
  sufixo?: string
  variacao?: number
  meta?: string
  serie?: number[]
  cor?: string
  alerta?: boolean
  detalhe?: string
}) {
  return (
    <div className={`card-controle p-4 ${alerta ? 'ring-1 ring-af-600/60' : ''}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-graf-400">{rotulo}</p>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="tabular text-4xl font-bold leading-none"
              style={cor ? { color: cor } : undefined}>{valor}</span>
        {sufixo && <span className="text-xl font-semibold text-graf-400">{sufixo}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 text-xs">
        {variacao !== undefined && (
          <span className={variacao < 0 ? 'font-semibold text-af-400' : 'font-semibold text-emerald-400'}>
            {variacao > 0 ? '+' : ''}{variacao.toFixed(1)} pp
          </span>
        )}
        {meta && <span className="text-graf-500">meta {meta}</span>}
        {detalhe && <span className="text-graf-500">{detalhe}</span>}
      </div>
      {serie && serie.length > 1 && (
        <div className="mt-2"><Sparkline valores={serie} cor={cor} /></div>
      )}
    </div>
  )
}

export interface Fatia { rotulo: string; valor: number; cor: string }

/** Barra empilhada + legenda com contagem e percentual. */
export function BarraEmpilhada({ fatias }: { fatias: Fatia[] }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0)
  if (total === 0) return <p className="py-6 text-center text-sm text-graf-500">Sem dados no período.</p>
  return (
    <div>
      <div className="flex h-7 overflow-hidden rounded-md" role="img"
           aria-label={fatias.filter(f => f.valor).map(f => `${f.rotulo}: ${f.valor}`).join(', ')}>
        {fatias.filter(f => f.valor > 0).map(f => (
          <div key={f.rotulo}
               className="grid place-items-center text-[11px] font-bold text-white/95"
               style={{ width: `${(f.valor / total) * 100}%`, background: f.cor }}
               title={`${f.rotulo}: ${f.valor}`}>
            {(f.valor / total) > 0.05 && f.valor}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {fatias.map(f => (
          <div key={f.rotulo} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: f.cor }} />
            <span className="text-graf-300">{f.rotulo}</span>
            <span className="tabular ml-auto font-semibold">{f.valor}</span>
            <span className="tabular w-12 text-right text-xs text-graf-500">
              {total ? ((f.valor / total) * 100).toFixed(1) : '0,0'}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Barras horizontais ordenadas — motivos, equipes, etapas. */
export function BarrasHorizontais({ dados, cor = 'var(--color-af-600)', sufixo = '' }: {
  dados: { rotulo: string; valor: number; cor?: string; nota?: string }[]
  cor?: string
  sufixo?: string
}) {
  if (dados.length === 0)
    return <p className="py-6 text-center text-sm text-graf-500">Sem dados no período.</p>
  const max = Math.max(...dados.map(d => d.valor)) || 1
  return (
    <div className="space-y-1.5">
      {dados.map(d => (
        <div key={d.rotulo} className="flex items-center gap-3 text-sm">
          <span className="w-56 shrink-0 truncate text-right text-xs text-graf-300"
                title={d.rotulo}>{d.rotulo}</span>
          <div className="h-5 flex-1 rounded-sm bg-graf-900">
            <div className="h-full rounded-sm transition-all"
                 style={{ width: `${Math.max((d.valor / max) * 100, 1.5)}%`, background: d.cor ?? cor }} />
          </div>
          <span className="tabular w-16 shrink-0 text-xs font-semibold">
            {d.valor}{sufixo}
          </span>
          {d.nota && <span className="w-24 shrink-0 text-[11px] text-graf-500">{d.nota}</span>}
        </div>
      ))}
    </div>
  )
}

/** Colunas empilhadas por hora do dia (00h–23h). */
export function ColunasPorHora({ horas, series }: {
  horas: number[]
  series: { rotulo: string; cor: string; valores: number[] }[]
}) {
  const id = useId()
  const totais = horas.map((_, i) => series.reduce((s, sr) => s + (sr.valores[i] ?? 0), 0))
  const max = Math.max(...totais, 1)
  const temDado = totais.some(t => t > 0)

  if (!temDado)
    return <p className="py-6 text-center text-sm text-graf-500">Nenhum encerramento no período.</p>

  return (
    <div>
      <div className="flex h-44 items-end gap-[3px]">
        {horas.map((h, i) => (
          <div key={h} className="group relative flex flex-1 flex-col justify-end"
               title={`${String(h).padStart(2, '0')}:00 — ${totais[i]}`}>
            {series.map(sr => {
              const v = sr.valores[i] ?? 0
              if (!v) return null
              return (
                <div key={sr.rotulo} style={{
                  height: `${(v / max) * 100}%`, background: sr.cor, minHeight: 2,
                }} />
              )
            })}
            {totais[i] > 0 && (
              <span className="tabular absolute -top-4 left-1/2 -translate-x-1/2 text-[10px]
                               text-graf-400 opacity-0 group-hover:opacity-100">
                {totais[i]}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {horas.map(h => (
          <span key={h} className="tabular flex-1 text-center text-[9px] text-graf-600">
            {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        {series.map(sr => (
          <div key={sr.rotulo} className="flex items-center gap-1.5 text-xs text-graf-300">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: sr.cor }} />
            {sr.rotulo}
          </div>
        ))}
      </div>
      <span id={id} className="sr-only">Encerramentos por hora do dia</span>
    </div>
  )
}

/** Tabela simples usada como alternativa de qualquer gráfico. */
export function TabelaSimples({ colunas, linhas }: {
  colunas: string[]
  linhas: (string | number)[][]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
            {colunas.map((c, i) => (
              <th key={c} className={`px-2 py-1.5 font-medium ${i ? 'text-right' : ''}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-graf-800/60">
              {l.map((c, j) => (
                <td key={j} className={`px-2 py-1.5 ${j ? 'tabular text-right' : 'text-graf-300'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
