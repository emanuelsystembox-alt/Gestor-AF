import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase, SITUACOES, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import type { Metricas, Visita } from '../lib/metricas'
import {
  SITUACOES_DE_TELA, infoSituacaoDeTela, situacaoDeTela, type SituacaoDeTela,
} from '../lib/filtroContratos'
import { LOG_GRAVE, lerLog } from '../lib/log'
import { SeloLog } from './SeloLog'

/**
 * As duas peças de abertura do Dashboard: a **régua do dia** e a
 * **matriz de grupo × situação**.
 *
 * ┌─ por que uma régua e não onze cartões ───────────────────────────┐
 * │ O painel abria com sete cartões de situação (todos do mesmo      │
 * │ tamanho), a matriz, e logo abaixo quatro cartões de indicador —  │
 * │ e mais abaixo um quadro "Distribuição por situação" com          │
 * │ EXATAMENTE os mesmos sete números da primeira fila. Três vezes o │
 * │ mesmo fato, ocupando duas telas, e nenhuma hierarquia: onze      │
 * │ cartões iguais afirmam onze assuntos igualmente importantes.     │
 * │                                                                  │
 * │ São dois assuntos. **Quanto e como está indo** — que é uma       │
 * │ régua de quatro leituras. E **onde o dia está**, que é a         │
 * │ composição: uma barra de proporção e as etiquetas que levam à    │
 * │ lista filtrada. Ver D-126.                                       │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * ┌─ por que volume E pontos ────────────────────────────────────────┐
 * │ São leituras diferentes, e é por isso que as duas existem:       │
 * │ DESCONEXÃO faz volume e quase não pontua; ADESÃO faz menos       │
 * │ volume e carrega o faturamento. Olhar só o volume engana quem    │
 * │ decide.                                                          │
 * └──────────────────────────────────────────────────────────────────┘
 */

interface VisitaMin {
  id: string
  situacao: Situacao
  tipo_servico: { nome: string } | null
  tipo_atividade: { nome: string; natureza: string } | null
}
interface Ponto { visita_id: string; pontos_claro: number | null; achou: boolean }

const num = (n: number, casas = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

/** A meta de conclusão que a tela já cobrava antes desta reforma. */
const META = 85
/** Meta do TEC1 no livro oficial da CLARO ("Indicadores COP - TEC1", item 4). */
const META_TEC1 = 94

// ================================================================== //
//  A RÉGUA
// ================================================================== //

/** Uma célula da régua: número, rótulo e a linha que explica o número.
 *  Com `aoClicar`, a célula inteira vira botão (o TEC1 abre a lista). */
function Celula({ valor, sufixo, rotulo, apoio, cor, alerta, aoClicar, dica, chamada }: {
  valor: string | number
  sufixo?: string
  rotulo: string
  apoio: React.ReactNode
  cor?: string
  alerta?: boolean
  aoClicar?: () => void
  dica?: string
  /** O texto do rodapé quando a célula é clicável. Era fixo em "ver quem
   *  perdeu", que só serve ao TEC1: o LOG abre quem VOLTOU. */
  chamada?: string
}) {
  const Caixa = aoClicar ? 'button' : 'div'
  return (
    <Caixa onClick={aoClicar} title={dica}
      className={aoClicar
        ? 'block w-full rounded-md text-left transition hover:bg-graf-900/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-af-500'
        : undefined}>
      <div className="flex items-baseline gap-1">
        <span className="tabular text-3xl font-bold leading-none"
              style={cor ? { color: cor } : undefined}>{valor}</span>
        {sufixo && <span className="text-base font-semibold text-graf-400">{sufixo}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase
                      tracking-wide text-graf-400">
        {alerta && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-af-500" />}
        {rotulo}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-graf-500">{apoio}</div>
      {aoClicar && (
        <div className="mt-1 text-[11px] font-medium text-af-400">{chamada ?? 'ver quem perdeu'} →</div>
      )}
    </Caixa>
  )
}

// ================================================================== //
//  O TEC1 PERDIDO — clicar no card abre quem perdeu e por quê
// ================================================================== //

const hora = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

/** "+1h12" / "−0h20": o fim do atendimento contra o fim da janela. É a
 *  DIFERENÇA, não o veredito — a tolerância (2 h ou 1 h, D-187) e o
 *  expurgo já estão na classe que veio do banco. */
function sobreAJanela(v: Visita): string | null {
  if (!v.fim || !v.janela_fim) return null
  const [h, mi] = v.janela_fim.split(':').map(Number)
  const lim = new Date(v.data_agendada + 'T00:00:00'); lim.setHours(h, mi, 0, 0)
  const d = Math.round((new Date(v.fim).getTime() - lim.getTime()) / 60000)
  const a = Math.abs(d)
  return `${d >= 0 ? '+' : '−'}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`
}

const supervisorDe = (v: Visita) =>
  v.tecnico?.supervisor?.nome ?? v.equipe?.supervisor_nome ?? null

/**
 * Quem perdeu o TEC1 — "o técnico que perdeu, janela, hora início e fim,
 * cód de baixa, supervisor ofensor" (Emanuel, 24/10).
 *
 * Sai do MESMO conjunto que o card conta (as O.S. das visitas produtivas
 * filtradas, classe `tec1_ao_vivo` do banco): o card diz "2 perdidas" e a
 * lista tem 2, sempre. O ranking de supervisor fica no topo porque é a
 * pergunta que a gestão faz primeiro.
 */
function Tec1Perdido({ linhas, aoFechar }: { linhas: Visita[]; aoFechar: () => void }) {
  const perdidas = useMemo(() => linhas
    .filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
    .flatMap(v => v.ordem_servico
      .filter(o => o.tec1_ao_vivo === 'SEM_PADRAO')
      .map(o => ({ v, o })))
    .sort((a, b) => (supervisorDe(a.v) ?? 'zz').localeCompare(supervisorDe(b.v) ?? 'zz')
      || (a.v.tecnico?.nome ?? '').localeCompare(b.v.tecnico?.nome ?? '')),
  [linhas])

  const porSupervisor = useMemo(() => {
    const m = new Map<string, number>()
    for (const { v } of perdidas) {
      const s = supervisorDe(v) ?? 'Sem supervisor definido'
      m.set(s, (m.get(s) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [perdidas])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aoFechar])

  // Portal para `.sup-controle` (que também dá o tema): o card da régua tem
  // `transform` (animação "sobe") e `overflow-hidden`, e um `fixed` dentro
  // dele abriu recortado no próprio card — a armadilha da D-169/D-173.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog" aria-modal="true" aria-label="O.S. que perderam o TEC1" onClick={aoFechar}>
      <div className="card-controle mt-10 w-full max-w-6xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-graf-800 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">TEC1 perdido · {perdidas.length} O.S.</h2>
            <p className="mt-0.5 text-[11px] text-graf-500">
              Fora do padrão pelo livro da CLARO (D-187): baixa depois do fim da janela mais a
              tolerância do grupo. "Sobre a janela" é o fim do atendimento contra o fim da janela.
            </p>
          </div>
          <button onClick={aoFechar} className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-300 hover:border-af-600">
            Fechar
          </button>
        </div>

        {perdidas.length === 0 ? (
          <p className="px-4 py-6 text-sm text-graf-400">Nenhuma O.S. perdeu o TEC1 no período e nos filtros.</p>
        ) : (<>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-graf-800 px-4 py-2.5">
            <span className="mr-1 text-[11px] uppercase tracking-wide text-graf-400">Por supervisor</span>
            {porSupervisor.map(([s, n]) => (
              <span key={s} className="rounded bg-graf-800 px-2 py-0.5 text-xs text-graf-200">
                {s} <strong className="tabular text-af-400">{n}</strong>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px] uppercase tracking-wide text-graf-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Técnico</th>
                  <th className="px-3 py-2 font-medium">Supervisor</th>
                  <th className="px-3 py-2 font-medium">Contrato · O.S.</th>
                  <th className="px-3 py-2 font-medium">Janela</th>
                  <th className="px-3 py-2 font-medium">Início</th>
                  <th className="px-3 py-2 font-medium">Fim</th>
                  <th className="px-3 py-2 font-medium">Sobre a janela</th>
                  <th className="px-3 py-2 font-medium">Cód. de baixa</th>
                </tr>
              </thead>
              <tbody>
                {perdidas.map(({ v, o }) => {
                  const sobre = sobreAJanela(v)
                  return (
                    <tr key={o.id} className="border-b border-graf-800/60 align-top hover:bg-graf-900/60">
                      <td className="px-3 py-2">
                        <div className="font-medium">{v.tecnico?.nome ?? <span className="text-graf-400">sem técnico</span>}</div>
                        <div className="text-[11px] text-graf-400">
                          {[v.tecnico?.matricula, v.equipe?.codigo && `equipe ${v.equipe.codigo}`].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {supervisorDe(v) ?? <span className="text-graf-400">não definido</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Link to={`/controle/visita/${v.id}`} className="font-medium underline-offset-2 hover:text-af-400 hover:underline">
                          {v.contrato ?? v.wo_numero ?? '—'}
                        </Link>
                        <div className="text-[11px] text-graf-400">
                          {o.numero_os}{o.tipo_os ? ` · ${o.tipo_os.codigo} ${o.tipo_os.descricao}` : ''}
                        </div>
                        <div className="text-[11px] text-graf-500">{v.tipo_servico?.nome ?? ''} · {new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR')}</div>
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2">
                        {v.janela_inicio ? `${v.janela_inicio.slice(0, 5)}–${v.janela_fim?.slice(0, 5) ?? '?'}` : '—'}
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2">{hora(v.inicio)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-2">{hora(v.fim)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-2">
                        {sobre ? <span className={sobre.startsWith('+') ? 'font-semibold text-af-400' : 'text-graf-300'}>{sobre}</span> : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {o.codigo_baixa
                          ? <><span className="tabular font-medium">{o.codigo_baixa.codigo}</span> <span className="text-graf-300">{o.codigo_baixa.descricao}</span></>
                          : <span className="text-graf-400">sem código</span>}
                        {o.baixa_afline && o.baixa_afline.codigo !== o.codigo_baixa?.codigo && (
                          <div className="text-[11px] text-graf-400">AFLINE: {o.baixa_afline.codigo} {o.baixa_afline.descricao}</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>)}
      </div>
    </div>,
    document.querySelector('.sup-controle') ?? document.body,
  )
}

// ================================================================== //
//  O LOG — clicar no card abre quem voltou, por grupo de servico
// ================================================================== //

/**
 * Os contratos que ja voltaram para a agenda (144).
 *
 * > "preciso saber igual ao tec1, os log acima de 0 devem aparecer, log
 * >  de visita tecnica - log de adesao, de mudanca de pacote tecnicos e
 * >  entre outros" — Emanuel, 26/10
 *
 * O recorte pedido e POR GRUPO DE SERVICO, entao e ele que abre a lista
 * — e nao o supervisor, como no TEC1. Sai do mesmo conjunto que o card
 * conta (as produtivas filtradas), para card e lista nunca divergirem.
 *
 * A ordem e por LOG decrescente: quem voltou oito vezes e a primeira
 * linha, nao a decima — e por ela que se abre a tela.
 */
function LogRetornos({ linhas, aoFechar }: { linhas: Visita[]; aoFechar: () => void }) {
  // 145: "nao consigo filtrar nessa propria janela o que e 1, log 2,
  // log 3, deve dar essa opcao" (Emanuel, 26/10). Dois filtros, que se
  // combinam: o valor do LOG e o grupo de servico. Nulo = todos.
  const [soLog, setSoLog] = useState<number | null>(null)
  const [soGrupo, setSoGrupo] = useState<string | null>(null)

  const todos = useMemo(() => linhas
    .filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
    .map(v => ({ v, n: lerLog(v.contador_log) }))
    .filter((x): x is { v: Visita; n: number } => x.n != null && x.n > 0)
    .sort((a, b) => b.n - a.n
      || (a.v.tipo_servico?.nome ?? '').localeCompare(b.v.tipo_servico?.nome ?? '')),
  [linhas])

  const grupoDe = (v: Visita) => v.tipo_servico?.nome ?? 'Sem grupo de serviço'

  /** Quantos de cada LOG — a contagem do chip é sobre o OUTRO filtro
   *  aplicado, para a soma dos chips sempre bater com a lista. */
  const porLog = useMemo(() => {
    const m = new Map<number, number>()
    for (const { v, n } of todos) {
      if (soGrupo && grupoDe(v) !== soGrupo) continue
      m.set(n, (m.get(n) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [todos, soGrupo])

  const porGrupo = useMemo(() => {
    const m = new Map<string, { qtd: number; graves: number }>()
    for (const { v, n } of todos) {
      if (soLog != null && n !== soLog) continue
      const g = grupoDe(v)
      const t = m.get(g) ?? { qtd: 0, graves: 0 }
      t.qtd++; if (n >= LOG_GRAVE) t.graves++
      m.set(g, t)
    }
    return [...m.entries()].sort((a, b) => b[1].qtd - a[1].qtd)
  }, [todos, soLog])

  const voltaram = useMemo(() => todos.filter(({ v, n }) =>
    (soLog == null || n === soLog) && (soGrupo == null || grupoDe(v) === soGrupo)),
  [todos, soLog, soGrupo])

  const filtrando = soLog != null || soGrupo != null

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [aoFechar])

  // Portal para `.sup-controle` pelo mesmo motivo do TEC1 (D-169/D-173):
  // o card da regua tem `transform`, e `fixed` dentro dele abre recortado.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog" aria-modal="true" aria-label="Contratos que voltaram para a agenda" onClick={aoFechar}>
      <div className="card-controle mt-10 w-full max-w-6xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-graf-800 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              LOG · {voltaram.length} contrato(s) que já voltaram
              {filtrando && <span className="ml-1 font-normal text-graf-400">
                de {todos.length}</span>}
            </h2>
            <p className="mt-0.5 text-[11px] text-graf-500">
              O &ldquo;Contador de log&rdquo; é da CLARO e vem na planilha do TOA: quantas vezes o
              contrato já voltou para a agenda. Conta o histórico inteiro dela, inclusive o que
              nunca passou por aqui — por isso pode divergir da nossa reincidência.
            </p>
          </div>
          <button onClick={aoFechar} className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-300 hover:border-af-600">
            Fechar
          </button>
        </div>

        {todos.length === 0 ? (
          <p className="px-4 py-6 text-sm text-graf-400">
            Nenhum contrato com LOG acima de 0 no período e nos filtros.
          </p>
        ) : (<>
          {/* ---- filtrar por valor do LOG ---- */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-graf-800 px-4 py-2.5">
            <span className="mr-1 w-28 text-[11px] uppercase tracking-wide text-graf-400">Por LOG</span>
            <button onClick={() => setSoLog(null)}
              className={`rounded px-2 py-0.5 text-xs ${soLog == null
                ? 'bg-af-600 font-semibold text-white' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
              Todos <span className="tabular opacity-80">{porLog.reduce((t, [, q]) => t + q, 0)}</span>
            </button>
            {porLog.map(([n, qtd]) => (
              <button key={n} onClick={() => setSoLog(soLog === n ? null : n)}
                aria-pressed={soLog === n}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${soLog === n
                  ? 'bg-af-600 font-semibold text-white' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
                <SeloLog valor={n} />
                <span className="tabular">{qtd}</span>
              </button>
            ))}
          </div>

          {/* ---- filtrar por grupo de servico ---- */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-graf-800 px-4 py-2.5">
            <span className="mr-1 w-28 text-[11px] uppercase tracking-wide text-graf-400">Por grupo</span>
            <button onClick={() => setSoGrupo(null)}
              className={`rounded px-2 py-0.5 text-xs ${soGrupo == null
                ? 'bg-af-600 font-semibold text-white' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
              Todos
            </button>
            {porGrupo.map(([g, t]) => (
              <button key={g} onClick={() => setSoGrupo(soGrupo === g ? null : g)}
                aria-pressed={soGrupo === g}
                className={`rounded px-2 py-0.5 text-xs ${soGrupo === g
                  ? 'bg-af-600 font-semibold text-white' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
                {g} <strong className="tabular">{t.qtd}</strong>
                {t.graves > 0 && (
                  <span className="tabular ml-1 text-amber-400"
                    title={`${t.graves} com LOG ${LOG_GRAVE} ou mais`}>({t.graves} ≥ {LOG_GRAVE})</span>
                )}
              </button>
            ))}
          </div>
          {voltaram.length === 0 && (
            <p className="px-4 py-6 text-sm text-graf-400">
              Nenhum contrato com esta combinação de filtros.{' '}
              <button onClick={() => { setSoLog(null); setSoGrupo(null) }}
                className="text-af-400 underline-offset-2 hover:underline">Limpar os filtros</button>
            </p>
          )}
          <div className={`overflow-x-auto ${voltaram.length === 0 ? 'hidden' : ''}`}>
            <table className="w-full text-sm">
              <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px] uppercase tracking-wide text-graf-400">
                <tr>
                  <th className="px-3 py-2 font-medium">LOG</th>
                  <th className="px-3 py-2 font-medium">Grupo de serviço</th>
                  <th className="px-3 py-2 font-medium">Contrato</th>
                  <th className="px-3 py-2 font-medium">Técnico</th>
                  <th className="px-3 py-2 font-medium">Equipe</th>
                  <th className="px-3 py-2 font-medium">Área</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Cód. de baixa</th>
                </tr>
              </thead>
              <tbody>
                {voltaram.map(({ v, n }) => {
                  const baixa = v.ordem_servico.find(o => o.codigo_baixa)?.codigo_baixa ?? null
                  return (
                    <tr key={v.id} className="border-b border-graf-800/60 align-top hover:bg-graf-900/60">
                      <td className="px-3 py-2"><SeloLog valor={n} /></td>
                      <td className="px-3 py-2">{v.tipo_servico?.nome ?? <span className="text-graf-400">sem grupo</span>}</td>
                      <td className="px-3 py-2">
                        <Link to={`/controle/visita/${v.id}`} className="font-medium underline-offset-2 hover:text-af-400 hover:underline">
                          {v.contrato ?? v.wo_numero ?? '—'}
                        </Link>
                        <div className="text-[11px] text-graf-500">
                          {new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR')}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {v.tecnico?.nome ?? <span className="text-graf-400">sem técnico</span>}
                      </td>
                      <td className="px-3 py-2">{v.equipe?.codigo ?? <span className="text-graf-400">—</span>}</td>
                      <td className="px-3 py-2">{v.area?.codigo ?? <span className="text-graf-400">—</span>}</td>
                      <td className="px-3 py-2">{SITUACAO_INFO[v.situacao]?.label ?? v.situacao}</td>
                      <td className="px-3 py-2">
                        {baixa
                          ? <><span className="tabular font-medium">{baixa.codigo}</span> <span className="text-graf-300">{baixa.descricao}</span></>
                          : <span className="text-graf-400">sem código</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>)}
      </div>
    </div>,
    document.querySelector('.sup-controle') ?? document.body,
  )
}

export function ReguaDoDia({ m, de, ate, linhas }: {
  m: Metricas
  /** As visitas FILTRADAS, as mesmas de onde `m` saiu — a lista do TEC1
   *  perdido tem de bater com o número do card. */
  linhas: Visita[]
  /** Vão junto no link para Serviços: clicar em "Cancelada 41" tem de
   *  cair nas 41 canceladas DESTE período, não nas de hoje. */
  de: string
  ate: string
}) {
  const [verTec1, setVerTec1] = useState(false)
  const [verLog, setVerLog] = useState(false)
  const faltamParaMeta = Math.max(0, Math.ceil((META / 100) * m.produtivas) - m.concluidas)
  const naMeta = m.taxaConclusao >= META

  // Só as situações que existem no período, na ordem do domínio — com
  // Desatribuído e Cancelado pela central à parte de Cancelada, a mesma
  // conta de Serviços (filtroContratos.ts; Emanuel, 24/10).
  const fatias = useMemo(() => {
    const c = new Map<SituacaoDeTela, number>()
    for (const v of linhas) {
      if (v.tipo_atividade?.natureza === 'JORNADA') continue
      const s = situacaoDeTela({ ...v, status_toa: v.status_toa ?? null })
      c.set(s, (c.get(s) ?? 0) + 1)
    }
    return SITUACOES_DE_TELA
      .map(s => ({ s, qtd: c.get(s) ?? 0, ...infoSituacaoDeTela(s) }))
      .filter(f => f.qtd > 0)
  }, [linhas])

  const link = (s?: SituacaoDeTela) =>
    `/controle/servicos?de=${de}&ate=${ate}${s ? `&situacao=${s}` : ''}`

  return (
    <section className="card-controle sobe overflow-hidden" aria-label="O dia em números">
      <div className="regua">
        <Celula
          valor={num(m.produtivas)}
          rotulo="Visitas produtivas"
          apoio={<>
            <span className="tabular">{num(m.os)}</span> O.S. dentro delas
            {m.jornada > 0 && <> · <span className="tabular">{num(m.jornada)}</span> de
              jornada fora da conta</>}
          </>}
        />

        <Celula
          valor={m.taxaConclusao.toFixed(1).replace('.', ',')} sufixo="%"
          rotulo="Taxa de conclusão"
          cor={naMeta ? 'var(--st-concluida)' : undefined}
          apoio={<>
            <span className="tabular">{num(m.concluidas)}</span> de{' '}
            <span className="tabular">{num(m.produtivas)}</span> ·{' '}
            {naMeta
              ? <span className="text-emerald-400">meta de {META}% atingida</span>
              : <><span className="tabular">{num(faltamParaMeta)}</span> abaixo da meta de {META}%</>}
          </>}
        />

        {/* TEC1 (D-187) — era "Chegou dentro da janela", que media só a
            chegada, por visita. O TEC1 é por O.S., conta início E baixa
            com a tolerância do grupo, e só sobre o que foi encerrado. */}
        <Celula
          valor={m.tec1Medidas ? m.pctTec1.toFixed(1).replace('.', ',') : '—'}
          sufixo={m.tec1Medidas ? '%' : undefined}
          rotulo="TEC1 - Atendimento no Prazo"
          // "ao clicar no card do TEC1 (...) o técnico que perdeu" (Emanuel, 24/10)
          aoClicar={m.tec1SemPadrao > 0 ? () => setVerTec1(true) : undefined}
          dica={m.tec1SemPadrao > 0 ? `Ver as ${m.tec1SemPadrao} O.S. que perderam o TEC1` : undefined}
          chamada="ver quem perdeu"
          cor={!m.tec1Medidas ? 'var(--color-graf-500)'
            : m.pctTec1 >= META_TEC1 ? 'var(--st-concluida)' : 'var(--st-reagendamento)'}
          apoio={m.tec1Medidas
            ? <>
                <span className="tabular">{num(m.tec1Padrao)}</span> de{' '}
                <span className="tabular">{num(m.tec1Medidas)}</span> O.S. no prazo · meta {META_TEC1}%
                {(m.tec1Expurgadas > 0 || m.tec1EmAberto > 0) && (
                  <span className="block">
                    {m.tec1Expurgadas > 0 && <><span className="tabular">{num(m.tec1Expurgadas)}</span> expurgada(s)</>}
                    {m.tec1Expurgadas > 0 && m.tec1EmAberto > 0 && ' · '}
                    {m.tec1EmAberto > 0 && <><span className="tabular">{num(m.tec1EmAberto)}</span> em aberto, fora da conta</>}
                  </span>
                )}
              </>
            // Zero e desconhecido não são a mesma coisa: nada encerrado
            // ainda não é TEC1 de 0%.
            : m.tec1EmAberto > 0
              ? <><span className="tabular">{num(m.tec1EmAberto)}</span> O.S. em aberto — nada encerrado para medir ainda</>
              : 'nenhuma O.S. no período'}
        />

        <Celula
          valor={num(m.nossas)}
          rotulo="Improdutivas de Serviços de campo"
          cor={m.nossas > 0 ? 'var(--st-conflito)' : 'var(--st-concluida)'}
          alerta={m.nossas > 0}
          apoio={m.osImprodutivas
            ? <>de <span className="tabular">{num(m.osImprodutivas)}</span> O.S. improdutivas
                {' '}· “Serviços de campo” na classificação da CLARO — o resto é argumento com ela</>
            : 'nenhuma O.S. improdutiva no período'}
        />

        {/* LOG (144) — "ao lado de improdutivas, coloque a tag log"
            (Emanuel, 26/10). O número é de CONTRATO: o LOG conta idas à
            agenda, e uma ida é uma visita, não uma O.S. */}
        <Celula
          valor={num(m.logComRetorno)}
          rotulo="LOG - Contratos que voltaram"
          aoClicar={m.logComRetorno > 0 ? () => setVerLog(true) : undefined}
          dica={m.logComRetorno > 0
            ? `Ver os ${m.logComRetorno} contratos com LOG acima de 0, por grupo de serviço`
            : undefined}
          chamada="ver quem voltou"
          cor={!m.logMedidos ? 'var(--color-graf-500)'
            : m.logComRetorno > 0 ? 'var(--st-reagendamento)' : 'var(--st-concluida)'}
          alerta={m.logGraves > 0}
          apoio={m.logMedidos
            ? <>
                de <span className="tabular">{num(m.logMedidos)}</span> contratos ·{' '}
                <span className="tabular">{num(m.logRetornos)}</span> retorno(s) somado(s)
                {m.logGraves > 0 && (
                  <span className="block font-semibold text-graf-300">
                    <span className="tabular">{num(m.logGraves)}</span> com LOG {LOG_GRAVE} ou mais
                  </span>
                )}
                {/* Zero e desconhecido não são a mesma coisa (regra 6). */}
                {m.logSemInfo > 0 && (
                  <span className="block">
                    <span className="tabular">{num(m.logSemInfo)}</span> sem a coluna na planilha, fora da conta
                  </span>
                )}
              </>
            : 'a planilha não trouxe o contador de log no período'}
        />
      </div>

      {/* ---------- a composição: a barra é a proporção, as etiquetas
           são o comando. Mesma gramática de Serviços. ---------- */}
      {fatias.length > 0 && (
        <div className="space-y-2 border-t border-graf-800 px-4 py-3">
          <div className="mistura" aria-hidden
            title={fatias.map(f => `${f.label}: ${f.qtd}`).join('\n')}>
            {fatias.map(f => (
              <span key={f.s} style={{
                flex: `${f.qtd} 0 0`, ['--fatia-cor' as string]: f.cor,
              }} />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {fatias.map(f => (
              <Link key={f.s} to={link(f.s)}
                style={{ ['--pill-cor' as string]: f.cor }}
                title={`Ver as ${f.qtd} em Serviços`}
                className="pill pill-filtro pill-apagada">
                {f.label}
                <span className="tabular font-bold opacity-80">{f.qtd}</span>
              </Link>
            ))}
            <Link to={link()}
              className="ml-auto text-[11px] text-graf-400 underline-offset-2
                         hover:text-af-400 hover:underline">
              abrir em Serviços →
            </Link>
          </div>
        </div>
      )}
      {verTec1 && <Tec1Perdido linhas={linhas} aoFechar={() => setVerTec1(false)} />}
      {verLog && <LogRetornos linhas={linhas} aoFechar={() => setVerLog(false)} />}
    </section>
  )
}

// ================================================================== //
//  A MATRIZ
// ================================================================== //

export function MatrizGrupos({ linhas, de, ate, onCSV }: {
  linhas: VisitaMin[]
  de: string
  ate: string
  onCSV: () => void
}) {
  const [pontos, setPontos] = useState<Map<string, number>>(new Map())
  const [aba, setAba] = useState<'volume' | 'pontos'>('volume')
  const [eixo, setEixo] = useState<'grupo' | 'toa'>('grupo')

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    supabase.rpc('pontos_por_periodo', { p_de: de, p_ate: ate }).then(({ data }) => {
      if (!vivo) return
      const m = new Map<string, number>()
      for (const p of (data ?? []) as Ponto[]) {
        if (p.achou && p.pontos_claro != null) m.set(p.visita_id, Number(p.pontos_claro))
      }
      setPontos(m)
    })
    return () => { vivo = false }
  }, [de, ate])

  const produtivas = useMemo(
    () => linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA'), [linhas])

  const porSituacao = useMemo(() => {
    const c = new Map<string, number>()
    for (const v of produtivas) c.set(v.situacao, (c.get(v.situacao) ?? 0) + 1)
    return c
  }, [produtivas])

  /** Uma linha por grupo (ou por tipo do TOA), com a contagem OU os
   *  pontos de cada situação. */
  const tabela = useMemo(() => {
    const m = new Map<string, { volume: Map<string, number>; pontos: Map<string, number> }>()
    for (const v of produtivas) {
      const g = eixo === 'grupo'
        ? v.tipo_servico?.nome ?? '(sem grupo)'
        : v.tipo_atividade?.nome ?? '(sem tipo)'
      if (!m.has(g)) m.set(g, { volume: new Map(), pontos: new Map() })
      const linha = m.get(g)!
      linha.volume.set(v.situacao, (linha.volume.get(v.situacao) ?? 0) + 1)
      const p = pontos.get(v.id) ?? 0
      linha.pontos.set(v.situacao, (linha.pontos.get(v.situacao) ?? 0) + p)
    }
    return [...m.entries()]
      .map(([grupo, d]) => ({
        grupo,
        total: [...d.volume.values()].reduce((a, b) => a + b, 0),
        totalPontos: [...d.pontos.values()].reduce((a, b) => a + b, 0),
        volume: d.volume, pontosPorSit: d.pontos,
      }))
      .sort((a, b) => (aba === 'volume' ? b.total - a.total : b.totalPontos - a.totalPontos))
  }, [produtivas, pontos, aba, eixo])

  // Só as situações que aparecem, na ordem do domínio.
  const colunas = useMemo(
    () => SITUACOES.filter(s => porSituacao.has(s)), [porSituacao])

  const totalPontos = [...pontos.values()].reduce((a, b) => a + b, 0)
  const semPontuacao = produtivas.filter(v => !pontos.has(v.id)).length

  /** A fatia concluída da linha, na unidade da aba ativa. Fica ao lado
   *  da própria coluna CONCLUÍDA de propósito: percentual cujo
   *  numerador está três colunas à esquerda é conta de cabeça. */
  const pctConcl = (l: typeof tabela[number]) => {
    const base = aba === 'volume' ? l.total : l.totalPontos
    const conc = aba === 'volume'
      ? l.volume.get('CONCLUIDA') ?? 0
      : l.pontosPorSit.get('CONCLUIDA') ?? 0
    return base ? (conc / base) * 100 : null
  }

  if (produtivas.length === 0) return null

  const alternador = 'rounded px-2.5 py-1 text-[11px] font-medium transition'

  return (
    <section className="card-controle sobe sobe-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-graf-800 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {eixo === 'grupo' ? 'Grupo de serviço × situação' : 'Tipo do TOA × situação'}
          </h2>
          <p className="mt-0.5 text-[11px] text-graf-500">
            Onde o volume está parado e onde ele fechou.
          </p>
        </div>

        <div className="flex rounded-md bg-graf-900 p-0.5">
          {([['volume', 'Volume'], ['pontos', 'Pontos']] as const).map(([a, rot]) => (
            <button key={a} onClick={() => setAba(a)} aria-pressed={aba === a}
              className={`${alternador} ${
                aba === a ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
              {rot}
            </button>
          ))}
        </div>

        <div className="flex rounded-md bg-graf-900 p-0.5">
          {([['grupo', 'Grupo'], ['toa', 'Tipo do TOA']] as const).map(([e, rot]) => (
            <button key={e} onClick={() => setEixo(e)} aria-pressed={eixo === e}
              className={`${alternador} ${
                eixo === e ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
              {rot}
            </button>
          ))}
        </div>

        <span className="ml-auto flex items-center gap-3 text-xs text-graf-500">
          {aba === 'volume'
            ? `${num(produtivas.length)} contratos produtivos`
            : <>
                <strong className="tabular text-emerald-400">{num(totalPontos, 2)}</strong>
                {' '}pontos CLARO
              </>}
          <button onClick={onCSV}
            className="text-graf-400 underline-offset-2 hover:text-af-400 hover:underline">
            Exportar CSV
          </button>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-graf-800 bg-graf-900 text-left
                            text-[11px] uppercase tracking-wide text-graf-400">
            <tr>
              <th className="px-3 py-2 font-medium">
                {eixo === 'grupo' ? 'Grupo' : 'Tipo de atividade'}
              </th>
              {colunas.map(s => (
                <th key={s} className="px-2 py-2 text-right font-medium">
                  <span style={{ color: SITUACAO_INFO[s]?.cor }}>
                    {SITUACAO_INFO[s]?.label ?? s}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">
                {aba === 'volume' ? 'Contratos' : 'Pontos'}
              </th>
              <th className="px-3 py-2 text-right font-medium">% concl.</th>
            </tr>
          </thead>
          <tbody>
            {tabela.map(l => {
              const p = pctConcl(l)
              return (
                <tr key={l.grupo} className="border-b border-graf-800/60 hover:bg-graf-900/60">
                  <td className="px-3 py-2 font-medium">
                    {eixo === 'grupo' ? (
                      <Link to={`/controle/servicos?de=${de}&ate=${ate}&grupo=${encodeURIComponent(l.grupo)}`}
                        className="underline-offset-2 hover:text-af-400 hover:underline">
                        {l.grupo}
                      </Link>
                    ) : l.grupo}
                  </td>
                  {colunas.map(s => {
                    const v = aba === 'volume'
                      ? l.volume.get(s) ?? 0
                      : l.pontosPorSit.get(s) ?? 0
                    return (
                      <td key={s} className="tabular px-2 py-2 text-right text-graf-300">
                        {v ? num(v, aba === 'volume' ? 0 : 2)
                           : <span className="text-graf-700">—</span>}
                      </td>
                    )
                  })}
                  <td className="tabular px-3 py-2 text-right font-semibold">
                    {aba === 'volume' ? num(l.total) : num(l.totalPontos, 2)}
                  </td>
                  <td className="tabular px-3 py-2 text-right font-medium">
                    {p === null ? <span className="text-graf-700">—</span>
                      : <span style={p >= META ? { color: 'var(--st-concluida)' } : undefined}>
                          {p.toFixed(1).replace('.', ',')}%
                        </span>}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t border-graf-700 font-semibold">
              <td className="px-3 py-2">Total</td>
              {colunas.map(s => {
                const v = tabela.reduce((soma, l) => soma + (aba === 'volume'
                  ? l.volume.get(s) ?? 0 : l.pontosPorSit.get(s) ?? 0), 0)
                return (
                  <td key={s} className="tabular px-2 py-2 text-right"
                      style={{ color: SITUACAO_INFO[s]?.cor }}>
                    {v ? num(v, aba === 'volume' ? 0 : 2) : '—'}
                  </td>
                )
              })}
              <td className="tabular px-3 py-2 text-right">
                {aba === 'volume' ? num(produtivas.length) : num(totalPontos, 2)}
              </td>
              <td className="tabular px-3 py-2 text-right">
                {(() => {
                  const base = aba === 'volume' ? produtivas.length : totalPontos
                  const conc = tabela.reduce((s, l) => s + (aba === 'volume'
                    ? l.volume.get('CONCLUIDA') ?? 0
                    : l.pontosPorSit.get('CONCLUIDA') ?? 0), 0)
                  return base ? `${((conc / base) * 100).toFixed(1).replace('.', ',')}%` : '—'
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {aba === 'pontos' && (
        <p className="border-t border-graf-800 px-4 py-2 text-[11px] leading-snug text-graf-500">
          Pontos CLARO, pela combinação de O.S. × edificação (D-045). O que a equipe
          recebe ainda não foi levantado — sem ele não dá para mostrar margem.
          {semPontuacao > 0 && <>
            {' '}<strong className="text-amber-400">
              {num(semPontuacao)} contrato(s) sem regra de pontuação
            </strong>{' '}
            entram no volume e valem <strong>zero</strong> aqui — não porque não valham
            nada, mas porque a regra não existe ainda (D-117).
          </>}
        </p>
      )}
    </section>
  )
}
