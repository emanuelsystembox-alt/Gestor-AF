import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { isoLocal, equipeRotulo } from '../lib/formato'
import { Painel, BarrasHorizontais, TabelaSimples } from './graficos'
import { Alerta, Vazio } from './ui'
import { BotaoAtualizar } from './BotaoAtualizar'
import { LinkContrato } from './LinkContrato'
import { SeloLog } from './SeloLog'

/**
 * Dashboard Visita Técnica (212) — desde a 217 em tela própria, "Dashboard VT"
 * no menu, logo abaixo do Dashboard (pages/DashboardVTPagina.tsx).
 * 217 acrescentou: as metas do Emanuel nos quatro números, a média por
 * equipe de VT, VT por janela × área e LOG + endereço nas listas.
 *
 * > "Vamos criar um Dashboard Visita Técnica abaixo do principal. Nesse
 * >  dashboard vamos ter gráficos intuitivos e direcionados para o
 * >  resultado (...) vamos monitorar as visitas, quero aprimorar o
 * >  controle." — Emanuel, 05/11
 *
 * ┌─ a conta é TODA do banco ─────────────────────────────────────────┐
 * │ Uma RPC só (`dashboard_visita_tecnica`) devolve os quatro          │
 * │ indicadores e os ofensores do dia. A tela não soma nada: a regra   │
 * │ de cada número (o que sai, o que fica, o corte do LOG, a base do   │
 * │ AT1) está no cabeçalho da migration 212 — mudar lá muda aqui.      │
 * │                                                                    │
 * │ Hierarquia: primeiro o JULGAMENTO (os quatro números da CLARO),    │
 * │ depois ONDE ESTÁ (equipe, código, revisita, node, área). Um        │
 * │ ofensor clicado abre os contratos — o contrato abre por cima.      │
 * └────────────────────────────────────────────────────────────────────┘
 */

// --------------------------------------------------------------- tipos --
interface ItemRev {
  visita_id: string; contrato: string | null; anterior_id: string | null
  anterior_data: string | null; anterior_grupo: string | null; dias: number | null
  baixa: string | null
}
interface DadosVT {
  dia: string; dias_mes: number; total: number; auditar: number
  cancelado_central: number; volume: number
  log: { base: number; sem_log: number; log3: number; log0: number
         por_log: { log: number; n: number }[] }
  tec1: { padrao: number; sem_padrao: number; expurgada: number; em_aberto: number }
  at1: { vt_com_base: number; base: number | null; vt_sem_base: number }
  areas: { area_id: string; codigo: string; rotulo: string; clientes: number | null
           desde: string | null; vt: number }[]
  equipes: { equipe_id: string | null; codigo: string | null; nome: string | null
             executados: number; nao_executados: number; em_aberto: number
             outros: number; total: number; equipe_vt?: boolean }[]
  revisita: { total: number
              tecnicos: { tecnico: string; equipe: string | null; n: number; itens: ItemRev[] }[] }
  nodes: { distintos: number; sem_node: number
           lista: { node: string; n: number; log3: number; nao_executados: number
                    itens: { visita_id: string; contrato: string | null; log: number | null }[] }[] }
  codigos: { contratos_com_baixa: number; sem_baixa: number
             lista: { codigo: number; descricao: string; natureza: string | null; n: number
                      pelo_afline: number
                      sub_falhas: { sub_falha: string | null; n: number }[]
                      itens: { visita_id: string; contrato: string | null
                               sub_falha: string | null; fonte: 'TOA' | 'AFLINE' }[] }[] }
  /** 217: equipe de VT = 4+ contratos no dia, ou de manutenção com qualquer número. */
  equipes_vt?: { minimo: number; equipes: number; por_manutencao: number; vt: number
                 sem_equipe: number
                 fora: { equipe_id: string; codigo: string | null; nome: string | null; n: number
                         itens: { visita_id: string; contrato: string | null }[] }[] }
  /** 217: janela × área; `total_janela`/`total_area` marcam as linhas de total. */
  janelas?: { janela: string | null; area: string | null; total_janela: boolean; total_area: boolean
              vt: number; vt_eq: number; equipes: number }[]
  /** 217: LOG, endereço e a chave da rua (normalizada no banco) de cada contrato. */
  contratos?: Record<string, InfoContrato>
}
interface InfoContrato {
  log: number | null; endereco: string | null; complemento: string | null
  bairro: string | null; rua: string | null
}

/** A meta do TEC1 é a do livro da CLARO, a mesma do Dashboard (D-187). */
const META_TEC1 = 94
/** 217: as metas do Emanuel (06/11). LOG e AT1 são "até", AT5 é "pelo menos".
 *  O AT1 se julga pela PROJETADA: o do dia é sempre uma fração mínima. */
const META_LOG = 1.4
const META_AT5 = 80
const META_AT1 = 2.4
const fmtMeta = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** Os contratos do dia, para as listas mostrarem LOG e endereço sem repetir o dado. */
const ContratosCtx = createContext<Record<string, InfoContrato>>({})

// Cores CHEIAS que têm de ser as mesmas nos dois temas vão por variável
// fixa (`--st-*`, que o tema claro não redefine) — nunca por classe
// 700/300, que inverte no claro (D-303).
const COR = {
  executado: 'var(--st-concluida)',
  naoExecutado: 'var(--st-conflito)',
  aberto: 'var(--st-execucao)',
  outro: 'var(--st-entrada)',
  atencao: 'var(--st-reagendamento)',
}
const COR_NATUREZA: Record<string, string> = {
  IMPRODUTIVA: 'var(--st-conflito)',
  SUCESSO: 'var(--st-execucao)',
  CANCELAMENTO: 'var(--st-cancelada)',
  REAGENDAMENTO: 'var(--st-reagendamento)',
}

const n0 = (x: number) => x.toLocaleString('pt-BR')
const pct = (num: number, den: number | null, casas = 1) =>
  den ? ((num * 100) / den).toFixed(casas).replace('.', ',') : null
const dataBR = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('pt-BR')
const curta = (iso: string) => new Date(iso + 'T12:00')
  .toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

export default function DashboardVT({ dia: diaProp }: { dia?: string }) {
  const [diaLocal, setDiaLocal] = useState(() => isoLocal(new Date()))
  const dia = diaProp ?? diaLocal
  const [d, setD] = useState<DadosVT | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizado, setAtualizado] = useState<Date | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('dashboard_visita_tecnica', { p_dia: dia }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else { setD(data as DadosVT); setAtualizado(new Date()) }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [dia, versao])

  return (
    <section aria-labelledby="dvt-titulo" className="space-y-3">
      {/* O cabeçalho é FAIXA, não cartão: ele separa este painel do
          Dashboard de cima sem competir com os números. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-graf-700 pb-2 pt-3">
        <span aria-hidden className="h-5 w-1 rounded-sm" style={{ background: 'var(--color-af-600)' }} />
        <h2 id="dvt-titulo" className="text-base font-semibold tracking-tight">Visita Técnica</h2>
        {diaProp != null && <span className="tabular text-xs text-graf-400">{dataBR(dia)}</span>}
        {diaProp == null && (
          <input type="date" value={diaLocal} onChange={e => e.target.value && setDiaLocal(e.target.value)}
            aria-label="Dia da visita técnica"
            className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        )}
        <div className="ml-auto flex items-center gap-3">
          <Link to={`/controle/servicos?de=${dia}&ate=${dia}&grupo=${encodeURIComponent('VISITA TECNICA')}`}
            className="text-[11px] text-af-400 underline-offset-2 hover:underline">
            ver as VT em Serviços
          </Link>
          <BotaoAtualizar aoAtualizar={() => setVersao(v => v + 1)} carregando={carregando}
            atualizadoEm={atualizado} />
        </div>
      </header>

      {erro && <Alerta tipo="erro">Não consegui carregar o painel de VT: {erro}</Alerta>}

      {carregando && !d && (
        <div className="card-controle grid place-items-center gap-3 py-14" aria-busy="true">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-graf-700 border-t-af-500" />
          <p className="text-sm text-graf-400">Carregando as visitas técnicas…</p>
        </div>
      )}

      {d && d.total === 0 && !erro && (
        <div className="card-controle">
          <Vazio titulo="Nenhuma visita técnica neste dia"
            descricao="Nenhum contrato do grupo VISITA TECNICA na cidade ativa." />
        </div>
      )}

      {d && d.total > 0 && <Conteudo d={d} />}
    </section>
  )
}

// ============================================================ conteúdo --
function Conteudo({ d }: { d: DadosVT }) {
  const medidasTec1 = d.tec1.padrao + d.tec1.sem_padrao
  const pTec1 = pct(d.tec1.padrao, medidasTec1)
  const naMeta = medidasTec1 > 0 && (d.tec1.padrao * 100) / medidasTec1 >= META_TEC1
  const pLog = pct(d.log.log3, d.log.base)
  const pAt5 = pct(d.log.log0, d.log.base)
  const pAt1 = d.at1.base ? pct(d.at1.vt_com_base, d.at1.base, 2) : null
  const pAt1Proj = d.at1.base ? pct(d.at1.vt_com_base * d.dias_mes, d.at1.base, 2) : null
  // 217: as metas em número, para a cor; nulo = sem denominador, sem cor
  const vLog = d.log.base ? (d.log.log3 * 100) / d.log.base : null
  const vAt5 = d.log.base ? (d.log.log0 * 100) / d.log.base : null
  const vAt1Proj = d.at1.base ? (d.at1.vt_com_base * d.dias_mes * 100) / d.at1.base : null
  const corMeta = (ok: boolean | null) => ok == null ? undefined : ok ? COR.executado : COR.atencao
  const okLog = vLog == null ? null : vLog <= META_LOG
  const okAt5 = vAt5 == null ? null : vAt5 >= META_AT5
  const okAt1 = vAt1Proj == null ? null : vAt1Proj <= META_AT1

  return (
    <ContratosCtx.Provider value={d.contratos ?? {}}>
      {/* ===== 1. o julgamento: os quatro números, cada um contra a meta ===== */}
      <section className="card-controle sobe overflow-hidden" aria-label="Indicadores da visita técnica">
        <div className="regua">
          <Indicador rotulo="TEC1" valor={pTec1} sufixo="%"
            cor={medidasTec1 === 0 ? undefined : corMeta(naMeta)}
            meta={`meta ≥ ${META_TEC1}%`} atingiu={medidasTec1 === 0 ? null : naMeta}
            dica="Atendimento no prazo, por O.S., só do que o TOA encerrou"
            barra={medidasTec1 > 0 && (
              <BarraMeta valor={(d.tec1.padrao * 100) / medidasTec1} meta={META_TEC1}
                cor={naMeta ? COR.executado : COR.atencao} />
            )}
            apoio={medidasTec1 === 0
              ? <>nenhuma O.S. encerrada no TOA ainda</>
              : <>
                  <span className="tabular">{n0(d.tec1.padrao)}</span> de{' '}
                  <span className="tabular">{n0(medidasTec1)}</span> O.S. no prazo
                  {(d.tec1.expurgada + d.tec1.em_aberto) > 0 && (
                    <span className="block" title="Expurgada (janela imediata, 08–22, cancelado no NETSMS…) e em aberto não entram no TEC1">
                      <span className="tabular">{n0(d.tec1.expurgada)}</span> expurgada(s) ·{' '}
                      <span className="tabular">{n0(d.tec1.em_aberto)}</span> em aberto
                    </span>
                  )}
                </>} />

          <Indicador rotulo="LOG" valor={pLog} sufixo="%" cor={corMeta(okLog)}
            meta={`meta ≤ ${fmtMeta(META_LOG)}%`} atingiu={okLog}
            dica="Contratos com LOG 3 ou mais"
            barra={d.log.base > 0 && <FaixaLog porLog={d.log.por_log} base={d.log.base} />}
            apoio={<>
              <span className="tabular">{n0(d.log.log3)}</span> de{' '}
              <span className="tabular">{n0(d.log.base)}</span> contratos em LOG 3+
              {d.log.sem_log > 0 && (
                <span className="block" title="A planilha do TOA não trouxe o Contador de log: não é LOG 0, fica fora da conta">
                  <span className="tabular">{n0(d.log.sem_log)}</span> sem log
                </span>
              )}
            </>} />

          <Indicador rotulo="AT5" valor={pAt5} sufixo="%" cor={corMeta(okAt5)}
            meta={`meta ≥ ${META_AT5}%`} atingiu={okAt5}
            dica="Contratos em LOG 0 — a primeira ida"
            barra={vAt5 != null && (
              <BarraMeta valor={vAt5} meta={META_AT5} cor={okAt5 ? COR.executado : COR.atencao} />
            )}
            apoio={<>
              <span className="tabular">{n0(d.log.log0)}</span> de{' '}
              <span className="tabular">{n0(d.log.base)}</span> contratos em LOG 0
            </>} />

          {/* 217: o número grande do AT1 passou a ser a PROJETADA — é ela que a
              meta julga; o do dia é sempre uma fração mínima e fica ao lado. */}
          <Indicador rotulo="AT1 projetada" valor={pAt1Proj ?? 'sem base'} sufixo={pAt1Proj ? '%' : undefined}
            cor={corMeta(okAt1)}
            meta={d.at1.base ? `meta ≤ ${fmtMeta(META_AT1)}% no mês` : undefined} atingiu={okAt1}
            dica={`VT do dia × ${d.dias_mes} dias ÷ base de clientes das áreas`}
            segundo={pAt1 && (
              <span className="tabular text-base font-semibold text-graf-300" title="VT do dia ÷ base">
                {pAt1}<span className="text-xs text-graf-400">%</span>
                <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-graf-400">no dia</span>
              </span>
            )}
            barra={vAt1Proj != null && (
              // escala até o dobro da meta: a meta fica no meio do trilho
              <BarraMeta valor={(vAt1Proj * 50) / META_AT1} meta={50} cor={okAt1 ? COR.executado : COR.atencao} />
            )}
            apoio={d.at1.base ? <>
              <span className="tabular">{n0(d.at1.vt_com_base)}</span> VT ÷{' '}
              <span className="tabular">{n0(d.at1.base)}</span> clientes · {d.dias_mes} dias
              {d.at1.vt_sem_base > 0 && (
                <span className="block text-amber-300" title="VT em área sem base cadastrada não entra no AT1">
                  <span className="tabular">{n0(d.at1.vt_sem_base)}</span> VT em área sem base
                </span>
              )}
            </> : <>
              nenhuma área com base de clientes ·{' '}
              <Link to="/controle/configuracoes?aba=clientes"
                className="text-af-400 underline underline-offset-2">cadastrar</Link>
            </>} />
        </div>
        <p className="border-t border-graf-800 px-4 py-1.5 text-[11px] text-graf-400"
           title="Auditar e Cancelado pela central não entram nos ofensores nem no AT1; o Cancelado pela central entra no LOG e no AT5">
          <span className="tabular font-semibold text-graf-300">{n0(d.total)}</span> VT no dia ·{' '}
          <span className="tabular">{n0(d.volume)}</span> com ida
          {d.auditar > 0 && <> · <span className="tabular">{n0(d.auditar)}</span> Auditar</>}
          {d.cancelado_central > 0 && <> · <span className="tabular">{n0(d.cancelado_central)}</span> Cancelado pela central</>}
        </p>
      </section>

      {/* ===== 2. a carga: média por equipe de VT, janela × área ===== */}
      {d.equipes_vt && d.janelas && (
        <div className="sobe sobe-1 grid gap-3 lg:grid-cols-3">
          <MediaPorEquipe e={d.equipes_vt} />
          <JanelaPorArea celulas={d.janelas} className="lg:col-span-2" />
        </div>
      )}

      {/* ===== 3. onde está: equipe e código ===== */}
      <div className="sobe sobe-2 grid gap-3 xl:grid-cols-2">
        <ExecutadasPorEquipe equipes={d.equipes} minimo={d.equipes_vt?.minimo} />
        <CodigosOfensores c={d.codigos} />
      </div>

      {/* ===== 4. quem e onde: revisita, node, área ===== */}
      <div className="sobe sobe-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <RevisitaOfensor r={d.revisita} volume={d.volume} />
        <NodeOfensor n={d.nodes} volume={d.volume} />
        <At1PorArea d={d} />
      </div>
    </ContratosCtx.Provider>
  )
}

// ================================================= média por equipe VT --
function MediaPorEquipe({ e }: { e: NonNullable<DadosVT['equipes_vt']> }) {
  const [aberta, setAberta] = useState<string | null>(null)
  const [verFora, setVerFora] = useState(false)
  const media = e.equipes ? (e.vt / e.equipes).toFixed(1).replace('.', ',') : null
  const sel = e.fora.find(f => f.equipe_id === aberta) ?? null
  const rot = (f: { codigo: string | null; nome: string | null }) =>
    f.codigo ? equipeRotulo(f.codigo, f.nome) : 'Sem equipe'
  return (
    <Painel titulo="Média por equipe de VT"
      dica={`Equipe de VT: ${e.minimo} ou mais VT no dia; manutenção conta sempre.`}>
      <div className="flex items-baseline gap-2">
        <span className="tabular text-4xl font-bold leading-none">{media ?? '—'}</span>
        {media && <span className="text-sm text-graf-400">VT por equipe</span>}
      </div>
      <p className="mt-2 text-xs text-graf-300">
        <span className="tabular font-semibold">{n0(e.vt)}</span> VT em{' '}
        <span className="tabular font-semibold">{n0(e.equipes)}</span> equipe(s)
        {e.por_manutencao > 0 && (
          <span className="text-graf-400" title={`Equipe de manutenção com menos de ${e.minimo} VT, que conta assim mesmo`}>
            {' '}· <span className="tabular">{e.por_manutencao}</span> de manutenção com menos de {e.minimo}
          </span>
        )}
      </p>
      {e.sem_equipe > 0 && (
        <p className="mt-1 text-[11px] text-amber-300">
          <span className="tabular">{e.sem_equipe}</span> VT sem equipe ficam fora
        </p>
      )}
      <div className="mt-3 border-t border-graf-800 pt-2.5">
        {e.fora.length === 0 ? (
          <p className="text-[11px] text-graf-400">Nenhuma equipe ficou de fora por ter menos de {e.minimo}.</p>
        ) : (
          <button type="button" onClick={() => { setVerFora(v => !v); setAberta(null) }} aria-expanded={verFora}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-graf-900">
            <span className="tabular rounded bg-graf-800 px-1.5 py-0.5 font-semibold text-graf-100">{e.fora.length}</span>
            <span className="text-graf-300">equipe(s) fora, com menos de {e.minimo} VT</span>
            <span aria-hidden className="ml-auto text-graf-400">{verFora ? '▴' : '▾'}</span>
          </button>
        )}
        {verFora && e.fora.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {e.fora.map(f => (
              <li key={f.equipe_id}>
                <button type="button" onClick={() => setAberta(a => a === f.equipe_id ? null : f.equipe_id)}
                  aria-expanded={aberta === f.equipe_id}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-graf-900 ${
                    aberta === f.equipe_id ? 'bg-graf-900 ring-1 ring-graf-700' : ''}`}>
                  <span className="truncate text-graf-200">{rot(f)}</span>
                  <span className="tabular ml-auto text-graf-400">{f.n} VT</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {sel && (
        <Detalhe titulo={rot(sel)} contagem={`${sel.n} VT`} aoFechar={() => setAberta(null)}>
          <TabelaItens linhas={sel.itens.map(i => ({ id: i.visita_id, contrato: i.contrato, cols: [] }))} />
        </Detalhe>
      )}
    </Painel>
  )
}

// ==================================================== janela × área --
type CelulaJA = NonNullable<DadosVT['janelas']>[number]
const mediaJA = (c?: { vt_eq: number; equipes: number }) =>
  c && c.equipes ? (c.vt_eq / c.equipes).toFixed(1).replace('.', ',') : null

function CelulaJanela({ c, total, max }: { c?: CelulaJA; total?: boolean; max: number }) {
  if (!c || c.vt === 0) return <td className="px-2 py-1.5 text-center text-graf-600">·</td>
  const m = mediaJA(c)
  // A intensidade diz onde está o volume; o número continua escrito.
  const fundo = total ? undefined
    : `color-mix(in srgb, var(--st-execucao) ${Math.round(8 + (c.vt / max) * 32)}%, transparent)`
  return (
    <td className={`rounded-sm px-2 py-1.5 text-center ${total ? 'bg-graf-900' : ''}`}
      style={fundo ? { background: fundo } : undefined}
      title={`${c.vt} VT · ${c.vt_eq} de equipe de VT, em ${c.equipes} equipe(s)`}>
      <span className={`tabular block leading-tight ${total ? 'font-bold' : 'font-semibold'} text-graf-100`}>{c.vt}</span>
      <span className="tabular block text-[10px] leading-tight text-graf-300">{m ? `${m}/eq` : '—'}</span>
    </td>
  )
}

function JanelaPorArea({ celulas, className = '' }: { celulas: CelulaJA[]; className?: string }) {
  // A ordem das janelas vem do banco (pela hora); as áreas em ordem
  // alfabética, "sem área" por último.
  const janelas = [...new Set(celulas.filter(c => !c.total_area && c.janela != null).map(c => c.janela!))]
  const areas = [...new Set(celulas.filter(c => !c.total_janela && c.area != null).map(c => c.area!))]
    .sort((a, b) => (a === 'sem área' ? 1 : b === 'sem área' ? -1 : a.localeCompare(b, 'pt-BR')))
  const chave = (j: string | null, a: string | null) => `${j ?? '*'}|${a ?? '*'}`
  const mapa = new Map(celulas.map(c => [
    chave(c.total_area ? null : c.janela, c.total_janela ? null : c.area), c]))
  const max = Math.max(1, ...celulas.filter(c => !c.total_area && !c.total_janela).map(c => c.vt))

  return (
    <Painel className={className} titulo="VT por janela e área"
      dica="Em cada célula: as VT e a média por equipe de VT com contrato ali."
      tabela={<TabelaSimples colunas={['Janela', 'Área', 'VT', 'VT de equipe de VT', 'Equipes de VT', 'Média por equipe']}
        linhas={celulas.map(c => [
          c.total_area ? 'Total' : c.janela ?? '—', c.total_janela ? 'Total' : c.area ?? '—',
          c.vt, c.vt_eq, c.equipes, mediaJA(c) ?? '—'])} />}>
      {janelas.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT com ida neste dia.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-[2px] text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-graf-400">
                <th className="px-2 py-1 text-left font-medium">Janela</th>
                {areas.map(a => <th key={a} className="px-2 py-1 text-center font-medium">{a}</th>)}
                <th className="px-2 py-1 text-center font-semibold text-graf-300">Total</th>
              </tr>
            </thead>
            <tbody>
              {janelas.map(j => (
                <tr key={j}>
                  <th scope="row" className="tabular whitespace-nowrap px-2 py-1.5 text-left font-medium text-graf-200">{j}</th>
                  {areas.map(a => <CelulaJanela key={a} c={mapa.get(chave(j, a))} max={max} />)}
                  <CelulaJanela c={mapa.get(chave(j, null))} total max={max} />
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-2 py-1.5 text-left font-semibold text-graf-300">Total</th>
                {areas.map(a => <CelulaJanela key={a} c={mapa.get(chave(null, a))} total max={max} />)}
                <CelulaJanela c={mapa.get(chave(null, null))} total max={max} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  )
}

// ========================================================== indicador --
function Indicador({ rotulo, valor, sufixo, cor, apoio, barra, segundo, dica, meta, atingiu }: {
  rotulo: string
  /** nulo = não há denominador: "—", nunca 0 (regra 6) */
  valor: string | null
  sufixo?: string
  cor?: string
  apoio: ReactNode
  barra?: ReactNode
  segundo?: ReactNode
  dica?: string
  /** 217: o texto da meta, ao lado do rótulo */
  meta?: string
  /** nulo = não dá para julgar (sem denominador) */
  atingiu?: boolean | null
}) {
  return (
    <div title={dica}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-1">
          <span className={`tabular font-bold leading-none ${valor && valor.length > 7 ? 'text-xl' : 'text-3xl'}`}
                style={cor ? { color: cor } : undefined}>{valor ?? '—'}</span>
          {valor && sufixo && <span className="text-base font-semibold text-graf-400">{sufixo}</span>}
        </span>
        {segundo}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-graf-300">{rotulo}</span>
        {/* A cor sozinha não diz nada a quem não a enxerga: o texto da meta
            leva o sinal ✓ / ✗ junto. */}
        {meta && (
          <span className={`tabular text-[11px] ${atingiu == null ? 'text-graf-400'
            : atingiu ? 'text-emerald-300' : 'text-amber-300'}`}>
            {atingiu == null ? '' : atingiu ? '✓ ' : '✗ '}{meta}
          </span>
        )}
      </div>
      {barra && <div className="mt-2">{barra}</div>}
      <div className="mt-1.5 text-[11px] leading-snug text-graf-400">{apoio}</div>
    </div>
  )
}

/** Trilho fino com o valor e, se houver, o traço da meta. */
function BarraMeta({ valor, meta, cor }: { valor: number; meta?: number; cor: string }) {
  const v = Math.max(0, Math.min(100, valor))
  return (
    <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="block h-2 w-full" aria-hidden>
      <rect x="0" y="2" width="100" height="4" rx="1" fill="var(--color-graf-800)" />
      <rect x="0" y="2" width={Math.max(v, 0.8)} height="4" rx="1" fill={cor} />
      {meta != null && <rect x={meta - 0.4} y="0" width="0.8" height="8" fill="var(--color-graf-200)" />}
    </svg>
  )
}

/** LOG 0 · 1 · 2 · 3+ numa faixa só — o mesmo preto do selo a partir de 3. */
function FaixaLog({ porLog, base }: { porLog: { log: number; n: number }[]; base: number }) {
  const cores = ['var(--st-concluida)', 'var(--color-graf-500)', 'var(--st-reagendamento)', '#000']
  let x = 0
  return (
    <div>
      <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="block h-2 w-full" aria-hidden>
        <rect x="0" y="2" width="100" height="4" rx="1" fill="var(--color-graf-800)" />
        {porLog.map(p => {
          const w = (p.n * 100) / base
          const r = <rect key={p.log} x={x} y="2" width={w} height="4" fill={cores[Math.min(p.log, 3)]}
                      stroke={p.log >= 3 ? '#f59e0b' : undefined} strokeWidth={p.log >= 3 ? 0.4 : 0}
                      vectorEffect="non-scaling-stroke" />
          x += w
          return r
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-graf-400">
        {porLog.map(p => (
          <span key={p.log} className="flex items-center gap-1">
            <span aria-hidden className="h-1.5 w-1.5 rounded-sm"
              style={{ background: cores[Math.min(p.log, 3)],
                       boxShadow: p.log >= 3 ? '0 0 0 1px #f59e0b' : undefined }} />
            {p.log >= 3 ? '3+' : p.log} <span className="tabular font-semibold text-graf-300">{p.n}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ============================================== executadas por equipe --
function ExecutadasPorEquipe({ equipes, minimo }: { equipes: DadosVT['equipes']; minimo?: number }) {
  const [todas, setTodas] = useState(false)
  const LIMITE = 12
  const max = Math.max(1, ...equipes.map(e => e.total))
  const vis = todas ? equipes : equipes.slice(0, LIMITE)
  const tot = equipes.reduce((s, e) => ({
    exe: s.exe + e.executados, nao: s.nao + e.nao_executados,
    abe: s.abe + e.em_aberto, out: s.out + e.outros,
  }), { exe: 0, nao: 0, abe: 0, out: 0 })
  const rot = (e: DadosVT['equipes'][number]) => e.codigo ? equipeRotulo(e.codigo, e.nome) : 'Sem equipe'
  const series: { k: 'executados' | 'nao_executados' | 'em_aberto' | 'outros'; rotulo: string; cor: string; total: number }[] = [
    { k: 'executados', rotulo: 'Executada', cor: COR.executado, total: tot.exe },
    { k: 'nao_executados', rotulo: 'Não executada', cor: COR.naoExecutado, total: tot.nao },
    { k: 'em_aberto', rotulo: 'Em aberto', cor: COR.aberto, total: tot.abe },
    { k: 'outros', rotulo: 'Cancelada/reagendada', cor: COR.outro, total: tot.out },
  ]

  return (
    <Painel titulo="Executadas por equipe"
      dica="Executada = código de sucesso; não executada = código improdutivo."
      extra={<span className="tabular text-xs text-graf-400">
        {n0(tot.exe)} de {n0(tot.exe + tot.nao + tot.abe + tot.out)}</span>}
      tabela={<TabelaSimples colunas={['Equipe', 'Executadas', 'Não executadas', 'Em aberto', 'Canc./reag.', 'Total']}
        linhas={equipes.map(e => [rot(e), e.executados, e.nao_executados, e.em_aberto, e.outros, e.total])} />}>
      {equipes.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT com ida neste dia.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {vis.map(e => (
              <li key={e.equipe_id ?? 'sem'} className="flex items-center gap-2.5 text-sm"
                title={series.map(s => `${s.rotulo}: ${e[s.k]}`).join('\n')}>
                {/* 217: a equipe que não é "de VT" (menos do mínimo, sem manutenção)
                    aparece, mas marcada — ela não entra na média por equipe. */}
                <span className="flex w-28 shrink-0 items-center justify-end gap-1 text-right text-xs sm:w-40">
                  {e.equipe_vt === false && (
                    <span className="shrink-0 rounded bg-graf-800 px-1 text-[9px] font-semibold uppercase text-graf-300"
                      title={`Menos de ${minimo ?? 4} VT no dia: fora da média por equipe de VT`}>
                      &lt;{minimo ?? 4}
                    </span>
                  )}
                  <span className="truncate text-graf-300">{rot(e)}</span>
                </span>
                <div className="flex h-5 flex-1 overflow-hidden rounded-sm bg-graf-900">
                  {series.map(s => e[s.k] > 0 && (
                    <div key={s.k} style={{ width: `${(e[s.k] / max) * 100}%`, background: s.cor }} />
                  ))}
                </div>
                <span className="tabular w-14 shrink-0 text-right text-xs">
                  <span className="font-semibold">{e.executados}</span>
                  <span className="text-graf-400">/{e.total}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {series.map(s => (
              <span key={s.k} className="flex items-center gap-1.5 text-xs text-graf-300">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />
                {s.rotulo} <span className="tabular font-semibold">{s.total}</span>
              </span>
            ))}
            {equipes.length > LIMITE && (
              <button type="button" onClick={() => setTodas(t => !t)} aria-expanded={todas}
                className="ml-auto text-[11px] text-af-400 underline-offset-2 hover:underline">
                {todas ? 'mostrar menos' : `todas as ${equipes.length} equipes`}
              </button>
            )}
          </div>
        </>
      )}
    </Painel>
  )
}

// ====================================================== código de baixa --
function CodigosOfensores({ c }: { c: DadosVT['codigos'] }) {
  const [filtro, setFiltro] = useState<'TODOS' | 'IMPRODUTIVA'>('TODOS')
  const [aberto, setAberto] = useState<number | null>(null)
  const LIMITE = 12
  const lista = useMemo(() => c.lista.filter(x => filtro === 'TODOS' || x.natureza === 'IMPRODUTIVA'),
    [c.lista, filtro])
  const rotulo = (x: DadosVT['codigos']['lista'][number]) => `${x.codigo} - ${x.descricao}`
  const sel = c.lista.find(x => x.codigo === aberto) ?? null
  const fora = lista.length - Math.min(lista.length, LIMITE)

  return (
    <Painel titulo="Código de baixa ofensor"
      dica="Por contrato: o código do TOA; sem baixa no TOA, o da AFLINE."
      extra={
        <div className="flex rounded-md bg-graf-900 p-0.5" role="group" aria-label="Quais códigos">
          {([['TODOS', 'Todos'], ['IMPRODUTIVA', 'Improdutivos']] as const).map(([k, r]) => (
            <button key={k} type="button" onClick={() => { setFiltro(k); setAberto(null) }}
              aria-pressed={filtro === k}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                filtro === k ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>{r}</button>
          ))}
        </div>}
      tabela={<TabelaSimples colunas={['Código', 'Natureza', 'Contratos', 'Pela AFLINE']}
        linhas={lista.map(x => [rotulo(x), (x.natureza ?? '—').toLowerCase(), x.n, x.pelo_afline])} />}
      nota={(fora > 0 || c.sem_baixa > 0) && <>
        {fora > 0 && <>Os {LIMITE} maiores; outros <span className="tabular">{fora}</span> códigos na tabela. </>}
        {c.sem_baixa > 0 && <><span className="tabular">{c.sem_baixa}</span> contrato(s) ainda sem código.</>}
      </>}>
      {lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">
          {filtro === 'IMPRODUTIVA' ? 'Nenhum código improdutivo neste dia.' : 'Nenhum contrato com código de baixa ainda.'}
        </p>
      ) : (
        <>
          <BarrasHorizontais rotuloLargo parte totalRef={c.contratos_com_baixa}
            dados={lista.slice(0, LIMITE).map(x => ({
              rotulo: rotulo(x), valor: x.n, cor: COR_NATUREZA[x.natureza ?? ''] ?? 'var(--st-entrada)',
            }))}
            aoClicar={r => {
              const x = lista.find(y => rotulo(y) === r)
              setAberto(a => (x && a !== x.codigo ? x.codigo : null))
            }}
            selecionado={sel ? rotulo(sel) : null} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-graf-400">
            {Object.entries(COR_NATUREZA).filter(([k]) => c.lista.some(x => x.natureza === k)).map(([k, cor]) => (
              <span key={k} className="flex items-center gap-1">
                <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: cor }} />{k.toLowerCase()}
              </span>
            ))}
          </div>
        </>
      )}

      {/* A sub-falha é o POR QUÊ do código (D-027): abre ao clicar. */}
      {sel && (
        <Detalhe titulo={rotulo(sel)} contagem={`${sel.n} contrato(s)`} aoFechar={() => setAberto(null)}>
          <div className="border-b border-graf-800 px-3 py-2">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-graf-400">Sub-falha</p>
            <BarrasHorizontais rotuloLargo parte totalRef={sel.n} cor="var(--color-af-600)"
              dados={sel.sub_falhas.map(s => ({
                rotulo: s.sub_falha ?? 'sem sub-falha', valor: s.n,
                cor: s.sub_falha ? undefined : 'var(--color-graf-600)',
              }))} />
          </div>
          <TabelaItens cabecalho={['Sub-falha', 'Baixa']}
            linhas={sel.itens.map(i => ({
              id: i.visita_id, contrato: i.contrato,
              cols: [i.sub_falha ?? <span className="text-graf-400">sem sub-falha</span>,
                     i.fonte === 'AFLINE'
                       ? <span className="text-amber-300" title="O contrato não tem baixa no TOA">AFLINE</span>
                       : 'TOA'],
            }))} />
        </Detalhe>
      )}
    </Painel>
  )
}

// ============================================================ revisita --
function RevisitaOfensor({ r, volume }: { r: DadosVT['revisita']; volume: number }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const nome = (t: { tecnico: string; equipe: string | null }) =>
    t.tecnico || `sem técnico${t.equipe ? ` · equipe ${t.equipe}` : ''}`
  const chave = (t: { tecnico: string; equipe: string | null }) => `${t.tecnico}|${t.equipe ?? ''}`
  const sel = r.tecnicos.find(t => chave(t) === aberto) ?? null

  return (
    <Painel titulo="Revisita · técnico ofensor"
      dica="Quem fez o serviço anterior, concluído há até 30 dias."
      extra={<span className="tabular text-xs text-graf-400">{n0(r.total)} de {n0(volume)} VT</span>}
      tabela={<TabelaSimples colunas={['Técnico do serviço anterior', 'Equipe', 'Revisitas']}
        linhas={r.tecnicos.map(t => [t.tecnico || 'sem técnico', t.equipe ?? '—', t.n])} />}>
      {r.tecnicos.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma revisita neste dia.</p>
      ) : (
        <BarrasHorizontais rotuloLargo cor={COR.atencao}
          dados={r.tecnicos.slice(0, 10).map(t => ({ rotulo: nome(t), valor: t.n }))}
          aoClicar={rot => {
            const t = r.tecnicos.find(x => nome(x) === rot)
            setAberto(a => (t && a !== chave(t) ? chave(t) : null))
          }}
          selecionado={sel ? nome(sel) : null} />
      )}
      {sel && (
        <Detalhe titulo={nome(sel)} contagem={`${sel.n} revisita(s)`} aoFechar={() => setAberto(null)}>
          <TabelaItens cabecalho={['Serviço anterior', 'Baixa anterior']}
            linhas={sel.itens.map(i => ({
              id: i.visita_id, contrato: i.contrato,
              cols: [
                i.anterior_id && i.anterior_data
                  ? <LinkContrato to={`/controle/visita/${i.anterior_id}`}
                      className="text-graf-200 underline-offset-2 hover:underline">
                      <span className="tabular">{curta(i.anterior_data)}</span>
                      <span className="text-graf-400"> · {i.dias === 0 ? 'mesmo dia' : `${i.dias} d`} · {i.anterior_grupo ?? 'sem grupo'}</span>
                    </LinkContrato>
                  : '—',
                i.baixa ?? <span className="text-graf-400">sem código</span>,
              ],
            }))} />
        </Detalhe>
      )}
    </Painel>
  )
}

// ================================================================ node --
function NodeOfensor({ n, volume }: { n: DadosVT['nodes']; volume: number }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const sel = n.lista.find(x => x.node === aberto) ?? null
  return (
    <Painel titulo="Node ofensor"
      dica="Onde a rede gerou mais visita técnica no dia."
      extra={<span className="tabular text-xs text-graf-400">{n0(n.distintos)} nodes</span>}
      tabela={<TabelaSimples colunas={['Node', 'VT', 'Não executadas', 'LOG 3+']}
        linhas={n.lista.map(x => [x.node, x.n, x.nao_executados, x.log3])} />}
      nota={n.sem_node > 0 && <><span className="tabular">{n.sem_node}</span> VT sem node na planilha.</>}>
      {n.lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT com node neste dia.</p>
      ) : (
        <BarrasHorizontais parte totalRef={volume} cor="var(--st-deslocamento)"
          dados={n.lista.slice(0, 10).map(x => ({
            rotulo: x.node, valor: x.n,
          }))}
          aoClicar={r => setAberto(a => (a === r ? null : r))}
          selecionado={aberto} />
      )}
      {sel && (
        <Detalhe titulo={`Node ${sel.node}`} contagem={`${sel.n} VT`} aoFechar={() => setAberto(null)}>
          <TabelaItens linhas={sel.itens.map(i => ({ id: i.visita_id, contrato: i.contrato, cols: [] }))} />
        </Detalhe>
      )}
    </Painel>
  )
}

// ============================================================= AT1 área --
function At1PorArea({ d }: { d: DadosVT }) {
  // Área sem VT e sem base não diz nada hoje: fica fora da lista, não da conta.
  const areas = d.areas.filter(a => a.vt > 0 || a.clientes != null)
  const lin = (a: DadosVT['areas'][number]) => ({
    real: a.clientes ? pct(a.vt, a.clientes, 2) : null,
    proj: a.clientes ? pct(a.vt * d.dias_mes, a.clientes, 2) : null,
  })
  return (
    <Painel titulo="AT1 por área"
      dica={`Projetada = VT do dia × ${d.dias_mes} dias ÷ base.`}
      extra={<Link to="/controle/configuracoes?aba=clientes"
        className="text-[11px] text-af-400 underline-offset-2 hover:underline">base de clientes</Link>}>
      {areas.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma área com VT ou base cadastrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-graf-700 text-left text-[10px] uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-2 py-1.5 font-medium">Área</th>
                <th className="px-2 py-1.5 text-right font-medium">Clientes</th>
                <th className="px-2 py-1.5 text-right font-medium">VT</th>
                <th className="px-2 py-1.5 text-right font-medium">AT1</th>
                <th className="px-2 py-1.5 text-right font-medium">Projetada</th>
              </tr>
            </thead>
            <tbody>
              {areas.map(a => {
                const x = lin(a)
                return (
                  <tr key={a.area_id} className="border-b border-graf-800/60">
                    <td className="px-2 py-1.5 text-graf-200" title={a.codigo}>{a.rotulo}</td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {a.clientes != null ? n0(a.clientes) : <span className="text-amber-300">sem base</span>}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right font-semibold">{a.vt}</td>
                    <td className="tabular px-2 py-1.5 text-right">{x.real ? `${x.real}%` : <span className="text-graf-400">—</span>}</td>
                    {/* 217: a projetada da área contra a mesma meta do card */}
                    <td className={`tabular px-2 py-1.5 text-right ${a.clientes == null ? ''
                      : (a.vt * d.dias_mes * 100) / a.clientes <= META_AT1 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {x.proj ? `${x.proj}%` : <span className="text-graf-400">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Painel>
  )
}

// ======================================================= peças comuns --
function Detalhe({ titulo, contagem, aoFechar, children }: {
  titulo: string; contagem: string; aoFechar: () => void; children: ReactNode
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-graf-800">
      <p className="flex items-center gap-2 border-b border-graf-800 bg-graf-900 px-3 py-1.5 text-[11px] text-graf-300">
        <strong className="truncate">{titulo}</strong>
        <span className="tabular shrink-0 text-graf-400">{contagem}</span>
        <button type="button" onClick={aoFechar}
          className="ml-auto shrink-0 text-graf-400 hover:text-graf-100">fechar ✕</button>
      </p>
      {children}
    </div>
  )
}

/**
 * A lista de contratos de um ofensor — com LOG e endereço (217).
 *
 * > "quando clicarem em cima do nome o correto é saber o log e saber o
 * >  endereço, se tem casos na mesma rua tudo bem?" — Emanuel, 06/11
 *
 * A rua é a CHAVE que o banco devolve (logradouro até a vírgula + bairro,
 * em norm_txt) — a tela só compara, não normaliza. Duas ou mais na mesma
 * rua sobem para o alto da lista, juntas, com o selo "N na mesma rua".
 * O endereço é dado de assinante: aparece aqui porque o RLS já deixa esta
 * pessoa ver o contrato, e nunca vai para a URL.
 */
function TabelaItens({ cabecalho = [], linhas }: {
  /** as colunas DEPOIS de Contrato, LOG e Endereço */
  cabecalho?: string[]
  linhas: { id: string; contrato: string | null; cols: ReactNode[] }[]
}) {
  const info = useContext(ContratosCtx)
  const { ordenadas, porRua, ruasRepetidas } = useMemo(() => {
    const porRua = new Map<string, number>()
    for (const l of linhas) {
      const r = info[l.id]?.rua
      if (r) porRua.set(r, (porRua.get(r) ?? 0) + 1)
    }
    const n = (id: string) => { const r = info[id]?.rua; return r ? porRua.get(r) ?? 0 : 0 }
    // estável: quem não repete rua fica na ordem que veio
    const ordenadas = linhas.map((l, i) => ({ l, i })).sort((a, b) => {
      const na = n(a.l.id) > 1 ? n(a.l.id) : 0, nb = n(b.l.id) > 1 ? n(b.l.id) : 0
      if (na !== nb) return nb - na
      if (na > 0) {
        const ra = info[a.l.id]?.rua ?? '', rb = info[b.l.id]?.rua ?? ''
        if (ra !== rb) return ra < rb ? -1 : 1
      }
      return a.i - b.i
    }).map(x => x.l)
    return { ordenadas, porRua, ruasRepetidas: [...porRua.values()].filter(v => v > 1).length }
  }, [linhas, info])

  return (
    <div className="max-h-72 overflow-y-auto">
      {ruasRepetidas > 0 && (
        <p className="border-b border-graf-800 px-3 py-1.5 text-[11px] text-amber-300">
          <span className="tabular font-semibold">{ruasRepetidas}</span>{' '}
          {ruasRepetidas === 1 ? 'rua com mais de um contrato' : 'ruas com mais de um contrato'}
        </p>
      )}
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-graf-900 text-left text-[10px] uppercase tracking-wide text-graf-400">
          <tr>
            {['Contrato', 'LOG', 'Endereço', ...cabecalho].map(c =>
              <th key={c} className="px-3 py-1.5 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((l, i) => {
            const c = info[l.id]
            const repete = c?.rua ? porRua.get(c.rua) ?? 0 : 0
            return (
              <tr key={`${l.id}-${i}`}
                className="border-t border-graf-800/60"
                style={repete > 1 ? { boxShadow: 'inset 3px 0 0 0 var(--st-reagendamento)' } : undefined}>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <LinkContrato to={`/controle/visita/${l.id}`}
                    className="tabular text-af-400 underline underline-offset-2">
                    {l.contrato ?? 'sem contrato'}
                  </LinkContrato>
                </td>
                <td className="px-3 py-1.5"><SeloLog valor={c?.log} /></td>
                <td className="min-w-48 px-3 py-1.5 text-graf-200">
                  {c?.endereco ?? <span className="text-graf-400">sem endereço</span>}
                  {c?.complemento && <span className="text-graf-400"> · {c.complemento}</span>}
                  {repete > 1 && (
                    <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-amber-900/40 px-1.5 py-px
                                     text-[10px] font-semibold text-amber-200 ring-1 ring-amber-700/50">
                      {repete} na mesma rua
                    </span>
                  )}
                </td>
                {l.cols.map((x, j) => <td key={j} className="px-3 py-1.5 text-graf-300">{x}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
