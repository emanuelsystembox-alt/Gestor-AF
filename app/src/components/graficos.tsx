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
  titulo, dica, extra, children, tabela, nota, className = '',
}: {
  titulo: string
  /** Uma linha dizendo QUE PERGUNTA o quadro responde. O painel tinha
   *  oito quadros com titulo de duas palavras; "Tempo medio por etapa"
   *  nao diz o que fazer com o numero. Ver D-126. */
  dica?: string
  extra?: ReactNode
  children: ReactNode
  tabela?: ReactNode
  /** Rodape com a leitura em portugues — o porque, a ressalva, a fonte. */
  nota?: ReactNode
  className?: string
}) {
  const [verTabela, setVerTabela] = useState(false)
  return (
    <section className={`card-controle flex flex-col p-4 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{titulo}</h2>
          {dica && <p className="mt-0.5 text-[11px] leading-snug text-graf-500">{dica}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
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
      <div className="flex-1">{verTabela && tabela ? tabela : children}</div>
      {nota && (
        <p className="mt-3 border-t border-graf-800 pt-2.5 text-[11px] leading-snug text-graf-500">
          {nota}
        </p>
      )}
    </section>
  )
}

export interface Fatia { rotulo: string; valor: number; cor: string }

/** Barras horizontais ordenadas — motivos, equipes, etapas.
 *
 *  `parte` escreve a fatia de cada barra sobre o total. Numa lista de
 *  motivos, "55" sozinho nao diz se e o problema do dia ou um caso
 *  isolado; "55 · 34%" diz. */
export function BarrasHorizontais({
  dados, cor = 'var(--color-af-600)', sufixo = '', parte = false,
  rotuloLargo = false, totalRef,
}: {
  dados: { rotulo: string; valor: number; cor?: string; nota?: string }[]
  cor?: string
  sufixo?: string
  parte?: boolean
  rotuloLargo?: boolean
  /** Denominador do percentual. Obrigatorio quando a lista foi CORTADA
   *  (os 10 maiores motivos), senao a fatia sai sobre os 10 e nao sobre
   *  o universo -- e a soma da 100% mentindo. */
  totalRef?: number
}) {
  if (dados.length === 0)
    return <p className="py-6 text-center text-sm text-graf-500">Sem dados no período.</p>
  const max = Math.max(...dados.map(d => d.valor)) || 1
  const total = totalRef ?? dados.reduce((s, d) => s + d.valor, 0)
  return (
    <div className="space-y-1.5">
      {dados.map(d => (
        <div key={d.rotulo} className="flex items-center gap-2.5 text-sm">
          {/* O rotulo encolhe na tela estreita: 208px fixos somados as
              colunas de numero estouravam a largura da pagina e punham
              rolagem horizontal no corpo. */}
          <span className={`${rotuloLargo ? 'w-36 sm:w-52' : 'w-28 sm:w-40'}
                            shrink-0 truncate text-right text-xs text-graf-300`}
                title={d.rotulo}>{d.rotulo}</span>
          <div className="h-5 flex-1 rounded-sm bg-graf-900">
            <div className="h-full rounded-sm transition-all"
                 style={{ width: `${Math.max((d.valor / max) * 100, 1.5)}%`, background: d.cor ?? cor }} />
          </div>
          <span className="tabular w-12 shrink-0 text-right text-xs font-semibold">
            {d.valor}{sufixo}
          </span>
          {parte && (
            <span className="tabular w-10 shrink-0 text-right text-[11px] text-graf-500">
              {total ? Math.round((d.valor / total) * 100) : 0}%
            </span>
          )}
          {d.nota && <span className="w-24 shrink-0 text-[11px] text-graf-500">{d.nota}</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * Colunas empilhadas por hora do dia.
 *
 * ┌─ dois defeitos que este bloco ja teve ──────────────────────────┐
 * │ 1. As barras nasciam com 2px SEMPRE. A coluna era filha de um   │
 * │    flex com `items-end`, entao a altura dela era o CONTEUDO --  │
 * │    e `height: 42%` de um pai sem altura definida nao resolve.   │
 * │    Todas caiam no `minHeight: 2`. O grafico existia, ocupava a  │
 * │    tela inteira e nao dizia nada. Agora a coluna e `h-full`.    │
 * │ 2. O eixo ia das 00h as 23h. A operacao anda das 6h as 21h, e   │
 * │    as oito horas mortas comiam um terco da largura. O eixo agora │
 * │    e a FAIXA COM MOVIMENTO, e o rodape escreve qual e -- eixo   │
 * │    cortado sem dizer onde corta e grafico que mente.            │
 * └──────────────────────────────────────────────────────────────────┘
 */
export function ColunasPorHora({ horas, series, altura = 'h-40' }: {
  horas: number[]
  series: { rotulo: string; cor: string; valores: number[] }[]
  altura?: string
}) {
  const id = useId()
  const totais = horas.map((_, i) => series.reduce((s, sr) => s + (sr.valores[i] ?? 0), 0))
  const temDado = totais.some(t => t > 0)

  if (!temDado)
    return <p className="py-6 text-center text-sm text-graf-500">Nenhum encerramento no período.</p>

  // A janela do eixo: da primeira à última hora com movimento, com uma
  // hora de folga de cada lado para a barra não encostar na borda.
  const comDado = horas.filter((_, i) => totais[i] > 0)
  const de = Math.max(0, Math.min(...comDado) - 1)
  const ate = Math.min(23, Math.max(...comDado) + 1)
  const faixa = horas.filter(h => h >= de && h <= ate)
  const max = Math.max(...totais, 1)
  const hh = (h: number) => String(h).padStart(2, '0')

  return (
    <div>
      {/* A régua do topo diz quanto vale a barra mais alta. Sem ela o
          desenho é proporção sem unidade, e ninguém sabe se o pico foi
          9 ou 90 sem passar o mouse. */}
      <div className="mb-1 flex items-center justify-between text-[10px] text-graf-500">
        <span className="tabular">pico {max}</span>
        <span className="tabular">{hh(de)}h–{hh(ate)}h</span>
      </div>
      <div className={`flex ${altura} items-stretch gap-[2px] border-b border-graf-800`}>
        {faixa.map(h => {
          const i = horas.indexOf(h)
          return (
            <div key={h} className="group relative flex h-full flex-1 flex-col justify-end"
                 title={`${hh(h)}:00 — ${totais[i]}`}>
              {series.map(sr => {
                const v = sr.valores[i] ?? 0
                if (!v) return null
                return (
                  <div key={sr.rotulo} className="first:rounded-t-[2px]" style={{
                    height: `${(v / max) * 100}%`, background: sr.cor, minHeight: 2,
                  }} />
                )
              })}
              {totais[i] > 0 && (
                <span className="tabular absolute -top-4 left-1/2 -translate-x-1/2 text-[10px]
                                 text-graf-300 opacity-0 group-hover:opacity-100">
                  {totais[i]}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {faixa.map(h => (
          <span key={h} className="tabular flex-1 text-center text-[9px] text-graf-600">
            {h % 2 === 0 ? hh(h) : ''}
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {series.map(sr => (
          <div key={sr.rotulo} className="flex items-center gap-1.5 text-xs text-graf-300">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: sr.cor }} />
            {sr.rotulo}
            <span className="tabular font-semibold text-graf-400">
              {sr.valores.reduce((a, b) => a + b, 0)}
            </span>
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
