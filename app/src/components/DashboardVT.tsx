import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACAO_INFO } from '../lib/supabase'
import { isoLocal, equipeRotulo } from '../lib/formato'
import { Painel, BarrasHorizontais, TabelaSimples } from './graficos'
import { Alerta, Vazio } from './ui'
import { BotaoAtualizar } from './BotaoAtualizar'
import { LinkContrato } from './LinkContrato'
import { SeloLog } from './SeloLog'
import { SelecaoMultipla, type OpcaoMultipla } from './SelecaoMultipla'

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
 * │ 242 (D-354), "temos que remodelar o dashboard para melhor"         │
 * │ (Emanuel, 10/11). Quatro faixas, cada uma uma pergunta:            │
 * │  JULGAMENTO  os cinco números (TEC1, LOG, AT5, AT1, VT por equipe);│
 * │              cada card abre a sua lista embaixo da régua           │
 * │  CARGA       onde o dia pesa: janela × área, e o AT1 da área       │
 * │  RESULTADO   como terminou: situação por equipe → código → sub-    │
 * │              falha, nessa ordem, lado a lado                       │
 * │  OFENSORES   quem: TEC1 por equipe (com as O.S. perdidas à vista), │
 * │              revisita e node                                       │
 * │ Um ofensor clicado abre os contratos — o contrato abre por cima.   │
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
  /** 224 (D-335): as áreas com VT no dia, para o filtro, e o filtro aplicado. */
  areas_opcoes?: { area_id: string; rotulo: string }[]
  areas_filtro?: string[]
  areas: { area_id: string; codigo: string; rotulo: string; clientes: number | null
           desde: string | null; vt: number }[]
  equipes: { equipe_id: string | null; codigo: string | null; nome: string | null; tecnico?: string | null
             executados: number; nao_executados: number; em_aberto: number
             outros: number; total: number; equipe_vt?: boolean
             /** 242: pela SITUAÇÃO do contrato */
             concluidos?: number; reagendados?: number; cancelados?: number; abertos?: number }[]
  /** 242: contratos por sub-falha (o mesmo universo do código ofensor) */
  sub_falhas?: { contratos_com_codigo: number; sem_sub_falha: number
                 lista: { sub_falha: string; n: number
                          itens: { visita_id: string; contrato: string | null; codigo: string | null }[] }[] }
  revisita: { total: number
              tecnicos: { tecnico: string; equipe: string | null; nome_do_cadastro?: boolean; n: number; itens: ItemRev[] }[] }
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
  /** 241: os contratos com LOG acima de 1, no universo do card do LOG. */
  log_lista?: ItemLog[]
  /** 241: cada O.S. que o card do TEC1 conta, com a classe dela. */
  tec1_lista?: ItemTec1[]
}
interface ItemLog {
  visita_id: string; contrato: string | null; log: number; situacao: string
  central: boolean; equipe: string | null; tecnico: string | null
}
type ClasseTec1 = 'PADRAO' | 'SEM_PADRAO' | 'EXPURGADA'
interface ItemTec1 {
  visita_id: string; os_id: string; contrato: string | null; numero_os: string | null
  /** nulo = em aberto: não entra no TEC1 ainda */
  classe: ClasseTec1 | null
  janela_inicio: string | null; janela_fim: string | null; fim: string | null
  situacao: string; equipe_id?: string | null; equipe: string | null; tecnico: string | null
  baixa: string | null
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
  // 224 (D-335): "precisa ter o filtro por área (...) e poder selecionar mais de uma"
  // (Emanuel, 07/11). Nada marcado = todas. O filtro vai ao BANCO: os cards, a
  // matriz e as listas saem de lá já filtrados.
  const [areas, setAreas] = useState<string[]>([])
  const [opcoesArea, setOpcoesArea] = useState<OpcaoMultipla[]>([])

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('dashboard_visita_tecnica', { p_dia: dia, ...(areas.length ? { p_areas: areas } : {}) })
      .then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else {
        const x = data as DadosVT
        setD(x); setAtualizado(new Date())
        setOpcoesArea((x.areas_opcoes ?? []).map(a => ({ valor: a.area_id, rotulo: a.rotulo })))
      }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [dia, versao, areas])

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
        <SelecaoMultipla rotulo="Área" todos="Toda área" plural="áreas"
          opcoes={opcoesArea} valor={areas} onChange={setAreas}
          className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1 text-xs outline-none focus:border-af-500" />
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
          {areas.length
            ? <Vazio titulo="Nenhuma visita técnica nas áreas escolhidas"
                descricao="Neste dia, as áreas marcadas no filtro não têm contrato de VISITA TECNICA." />
            : <Vazio titulo="Nenhuma visita técnica neste dia"
                descricao="Nenhum contrato do grupo VISITA TECNICA na cidade ativa." />}
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
  // 241 (D-353): "da opção para o usuario clicar tanto no log como no TEC1" (Emanuel, 10/11)
  const [ver, setVer] = useState<'LOG' | 'TEC1' | 'MEDIA' | null>(null)
  const logAlto = d.log_lista ?? []
  const alternar = (k: 'LOG' | 'TEC1' | 'MEDIA') => setVer(v => v === k ? null : k)
  // 242: a média por equipe de VT virou o quinto card da régua
  const ev = d.equipes_vt
  const media = ev && ev.equipes ? (ev.vt / ev.equipes).toFixed(1).replace('.', ',') : null

  return (
    <ContratosCtx.Provider value={d.contratos ?? {}}>
      {/* ===== 1. o julgamento: os cinco números, cada um abre a sua lista ===== */}
      <section className="card-controle sobe overflow-hidden" aria-label="Indicadores da visita técnica">
        <div className="regua">
          <Indicador rotulo="TEC1" valor={pTec1} sufixo="%"
            cor={medidasTec1 === 0 ? undefined : corMeta(naMeta)}
            meta={`meta ≥ ${META_TEC1}%`} atingiu={medidasTec1 === 0 ? null : naMeta}
            dica="Atendimento no prazo, por O.S., só do que o TOA encerrou"
            aoClicar={d.tec1_lista ? () => alternar('TEC1') : undefined} aberto={ver === 'TEC1'}
            chamada="ver as O.S."
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
            aoClicar={d.log_lista ? () => alternar('LOG') : undefined} aberto={ver === 'LOG'}
            chamada="ver LOG acima de 1"
            barra={d.log.base > 0 && <FaixaLog porLog={d.log.por_log} base={d.log.base} />}
            apoio={<>
              <span className="tabular">{n0(d.log.log3)}</span> de{' '}
              <span className="tabular">{n0(d.log.base)}</span> contratos em LOG 3+
              {/* 241: "mostrar nos card os log alto acima de 1" (Emanuel, 10/11) */}
              {d.log_lista && (
                <span className="block">
                  <span className={`tabular font-semibold ${logAlto.length ? 'text-amber-300' : ''}`}>
                    {n0(logAlto.length)}</span> com LOG acima de 1
                </span>
              )}
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

          {/* 242: "Média por equipe de VT" deixa de ser painel e vira card */}
          {ev && (
            <Indicador rotulo="VT por equipe" valor={media}
              dica={`Equipe de VT: ${ev.minimo} ou mais VT no dia; manutenção conta sempre.`}
              aoClicar={() => alternar('MEDIA')} aberto={ver === 'MEDIA'} chamada="ver as equipes"
              barra={d.volume > 0 && (
                <BarraMeta valor={(ev.vt * 100) / d.volume} cor="var(--st-execucao)" />
              )}
              apoio={<>
                <span className="tabular">{n0(ev.vt)}</span> VT em{' '}
                <span className="tabular">{n0(ev.equipes)}</span> equipe(s) de {ev.minimo}+
                {ev.por_manutencao > 0 && (
                  <span className="block" title={`Equipe de manutenção com menos de ${ev.minimo} VT, que conta assim mesmo`}>
                    <span className="tabular">{ev.por_manutencao}</span> de manutenção com menos de {ev.minimo}
                  </span>
                )}
                {ev.sem_equipe > 0 && (
                  <span className="block text-amber-300">
                    <span className="tabular">{ev.sem_equipe}</span> VT sem equipe ficam fora
                  </span>
                )}
              </>} />
          )}
        </div>
        <p className="border-t border-graf-800 px-4 py-1.5 text-[11px] text-graf-400"
           title="Auditar e Cancelado pela central não entram nos ofensores nem no AT1; o Cancelado pela central entra no LOG e no AT5">
          <span className="tabular font-semibold text-graf-300">{n0(d.total)}</span> VT no dia ·{' '}
          <span className="tabular font-semibold text-graf-300">{n0(d.volume)}</span> na conta
          {(d.auditar + d.cancelado_central) > 0 && <>
            {' '}· fora da conta:{' '}
            {d.auditar > 0 && <><span className="tabular">{n0(d.auditar)}</span> Auditar</>}
            {d.auditar > 0 && d.cancelado_central > 0 && ', '}
            {d.cancelado_central > 0 && <><span className="tabular">{n0(d.cancelado_central)}</span> cancelado pela central</>}
          </>}
        </p>
        {ver === 'LOG' && d.log_lista && (
          <div className="px-4 pb-3">
            <ListaLogAlto itens={d.log_lista} aoFechar={() => setVer(null)} />
          </div>
        )}
        {ver === 'TEC1' && d.tec1_lista && (
          <div className="px-4 pb-3">
            <ListaTec1 itens={d.tec1_lista} aoFechar={() => setVer(null)} />
          </div>
        )}
        {ver === 'MEDIA' && ev && (
          <div className="px-4 pb-3">
            <ListaEquipesVT e={ev} equipes={d.equipes} aoFechar={() => setVer(null)} />
          </div>
        )}
      </section>

      {/* ===== 2. a carga: onde o dia pesa ===== */}
      <Faixa titulo="Carga do dia" sub="onde estão as VT, por janela e área" />
      <div className="sobe sobe-1 grid gap-3 lg:grid-cols-3">
        {d.janelas && <JanelaPorArea celulas={d.janelas} className="lg:col-span-2" />}
        <At1PorArea d={d} />
      </div>

      {/* ===== 3. o resultado: situação → código → sub-falha, nessa ordem ===== */}
      <Faixa titulo="Resultado" sub="como terminou, e por quê" />
      <div className="sobe sobe-2 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <SituacaoPorEquipe equipes={d.equipes} minimo={d.equipes_vt?.minimo} />
        <CodigosOfensores c={d.codigos} />
        {d.sub_falhas && <SubFalhaOfensora s={d.sub_falhas} />}
      </div>

      {/* ===== 4. os ofensores: quem ===== */}
      <Faixa titulo="Ofensores" sub="quem perdeu o prazo, quem gerou revisita, onde a rede pesou" />
      <div className="sobe sobe-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {d.tec1_lista && <Tec1PorEquipe itens={d.tec1_lista} />}
        <RevisitaOfensor r={d.revisita} volume={d.volume} />
        <NodeOfensor n={d.nodes} volume={d.volume} />
      </div>
    </ContratosCtx.Provider>
  )
}

// ============================================================ faixas --
/** O título de uma faixa do painel: a pergunta que ela responde. */
function Faixa({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div className="flex items-baseline gap-3 pt-3">
      <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-graf-200">{titulo}</h3>
      <span className="hidden truncate text-[11px] text-graf-400 sm:inline">{sub}</span>
      <span aria-hidden className="h-px min-w-6 flex-1 self-center bg-graf-800" />
    </div>
  )
}

// ================================================== equipes de VT (card) --
/**
 * A lista do card "VT por equipe" (242): quem entra na média e quem fica de
 * fora por ter menos do mínimo — esta, clicável, abre os contratos.
 */
function ListaEquipesVT({ e, equipes, aoFechar }: {
  e: NonNullable<DadosVT['equipes_vt']>; equipes: DadosVT['equipes']; aoFechar: () => void
}) {
  const [aberta, setAberta] = useState<string | null>(null)
  const rot = (f: { codigo: string | null; nome: string | null }) =>
    f.codigo ? equipeRotulo(f.codigo, f.nome) : 'Sem equipe'
  const dentro = equipes.filter(q => q.equipe_vt && q.equipe_id)
    .sort((a, b) => b.total - a.total || rot(a).localeCompare(rot(b)))
  const sel = e.fora.find(f => f.equipe_id === aberta) ?? null
  const media = e.equipes ? (e.vt / e.equipes).toFixed(1).replace('.', ',') : '—'
  return (
    <Detalhe titulo="Equipes de VT" contagem={`${e.equipes} equipe(s) · média ${media}`} aoFechar={aoFechar}>
      <div className="grid gap-x-6 gap-y-0.5 px-3 py-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {dentro.map(q => (
          <div key={q.equipe_id} className="flex min-w-0 items-baseline gap-2 border-b border-graf-800/60 py-1">
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-medium text-graf-200">{rot(q)}</span>
              {!!q.tecnico && <span className="block truncate text-[10px] text-graf-400">{q.tecnico}</span>}
            </span>
            <span className="tabular shrink-0 font-semibold">{q.total}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-graf-800 px-3 py-2">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-graf-400">
          Fora da média · menos de {e.minimo} VT
        </p>
        {e.fora.length === 0 ? (
          <p className="text-[11px] text-graf-400">Nenhuma equipe ficou de fora.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {e.fora.map(f => (
              <button key={f.equipe_id} type="button" aria-pressed={aberta === f.equipe_id}
                onClick={() => setAberta(a => a === f.equipe_id ? null : f.equipe_id)}
                className={`rounded px-2 py-0.5 text-xs ${aberta === f.equipe_id
                  ? 'bg-af-600 font-semibold text-white' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
                {rot(f)} <span className="tabular">{f.n}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {sel && (
        <TabelaItens linhas={sel.itens.map(i => ({ id: i.visita_id, contrato: i.contrato, cols: [] }))} />
      )}
    </Detalhe>
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
function Indicador({ rotulo, valor, sufixo, cor, apoio, barra, segundo, dica, meta, atingiu,
  aoClicar, aberto, chamada }: {
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
  /** 241: com ele, o card inteiro vira botão e abre a lista embaixo da régua */
  aoClicar?: () => void
  aberto?: boolean
  chamada?: string
}) {
  const Caixa = aoClicar ? 'button' : 'div'
  return (
    <Caixa title={dica} onClick={aoClicar} type={aoClicar ? 'button' : undefined}
      aria-expanded={aoClicar ? !!aberto : undefined}
      className={aoClicar
        ? `block w-full rounded-md text-left transition hover:bg-graf-900/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-af-500 ${aberto ? 'bg-graf-900/70' : ''}`
        : undefined}>
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
      {aoClicar && (
        <div className="mt-1 text-[11px] font-medium text-af-400">
          {aberto ? 'fechar a lista' : `${chamada ?? 'ver a lista'} →`}
        </div>
      )}
    </Caixa>
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

// ============================================== situação por equipe --
/**
 * 242 (D-354): "vamos usar os status que temos, CANCELADO, REAGENDADO,
 * CONCLUÍDO, ABERTO" (Emanuel, 10/11). É a SITUAÇÃO do contrato — não mais a
 * natureza do código (executada/não executada), que o painel ao lado já mostra.
 * Auditar e cancelado pela central não estão aqui (`conta`, 216).
 */
function SituacaoPorEquipe({ equipes, minimo }: { equipes: DadosVT['equipes']; minimo?: number }) {
  const [todas, setTodas] = useState(false)
  const LIMITE = 12
  const max = Math.max(1, ...equipes.map(e => e.total))
  const vis = todas ? equipes : equipes.slice(0, LIMITE)
  type K = 'concluidos' | 'abertos' | 'reagendados' | 'cancelados'
  const series: { k: K; rotulo: string; cor: string }[] = [
    { k: 'concluidos', rotulo: 'Concluído', cor: 'var(--st-concluida)' },
    { k: 'abertos', rotulo: 'Aberto', cor: 'var(--st-execucao)' },
    { k: 'reagendados', rotulo: 'Reagendado', cor: 'var(--st-reagendamento)' },
    { k: 'cancelados', rotulo: 'Cancelado', cor: 'var(--st-cancelada)' },
  ]
  const v = (e: DadosVT['equipes'][number], k: K) => e[k] ?? 0
  const tot = Object.fromEntries(series.map(s => [s.k, equipes.reduce((t, e) => t + v(e, s.k), 0)])) as Record<K, number>
  const total = equipes.reduce((t, e) => t + e.total, 0)
  const rot = (e: DadosVT['equipes'][number]) => e.codigo ? equipeRotulo(e.codigo, e.nome) : 'Sem equipe'
  const min = minimo ?? 3

  return (
    <Painel titulo="Situação por equipe"
      dica="A situação do contrato. Auditar e cancelado pela central ficam fora da conta."
      extra={<span className="tabular text-xs text-graf-400">{n0(tot.concluidos)} de {n0(total)} concluídos</span>}
      tabela={<TabelaSimples colunas={['Equipe', 'Técnico', 'Concluído', 'Aberto', 'Reagendado', 'Cancelado', 'Total']}
        linhas={equipes.map(e => [rot(e), e.tecnico ?? '—', v(e, 'concluidos'), v(e, 'abertos'),
                                  v(e, 'reagendados'), v(e, 'cancelados'), e.total])} />}>
      {equipes.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT na conta neste dia.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {vis.map(e => (
              <li key={e.equipe_id ?? 'sem'} className="flex items-center gap-2.5 text-sm"
                title={series.map(s => `${s.rotulo}: ${v(e, s.k)}`).join('\n')}>
                <span className="flex w-28 shrink-0 items-center justify-end gap-1 text-right text-xs sm:w-36">
                  {e.equipe_vt === false && (
                    <span className="shrink-0 rounded bg-graf-800 px-1 text-[9px] font-semibold uppercase text-graf-300"
                      title={`Menos de ${min} VT no dia: fora da média por equipe de VT`}>
                      &lt;{min}
                    </span>
                  )}
                  <span className="min-w-0 leading-tight" title={e.tecnico ? `${rot(e)} — ${e.tecnico}` : rot(e)}>
                    <span className="block truncate font-semibold text-graf-200">{rot(e)}</span>
                    {!!e.tecnico && <span className="block truncate text-[11px] text-graf-400">{e.tecnico}</span>}
                  </span>
                </span>
                <div className="flex h-5 flex-1 overflow-hidden rounded-sm bg-graf-900">
                  {series.map(s => v(e, s.k) > 0 && (
                    <div key={s.k} style={{ width: `${(v(e, s.k) / max) * 100}%`, background: s.cor }} />
                  ))}
                </div>
                <span className="tabular w-12 shrink-0 text-right text-xs">
                  <span className="font-semibold">{v(e, 'concluidos')}</span>
                  <span className="text-graf-400">/{e.total}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {series.map(s => (
              <span key={s.k} className="flex items-center gap-1.5 text-xs text-graf-300">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />
                {s.rotulo} <span className="tabular font-semibold">{tot[s.k]}</span>
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
  // D-328: a linha é a EQUIPE do serviço anterior; o técnico vai embaixo (o registrado na
  // visita, ou o cadastrado na equipe quando o histórico do ngestor não trouxe — 220)
  const nome = (t: { tecnico: string; equipe: string | null }) => `Equipe ${t.equipe ?? '?'}`
  const quem = (t: { tecnico: string; nome_do_cadastro?: boolean }) =>
    t.tecnico ? t.tecnico + (t.nome_do_cadastro ? ' (cadastro)' : '') : 'sem técnico na equipe'
  const chave = (t: { tecnico: string; equipe: string | null }) => `${t.tecnico}|${t.equipe ?? ''}`
  const sel = r.tecnicos.find(t => chave(t) === aberto) ?? null

  return (
    <Painel titulo="Revisita · técnico ofensor"
      dica="Quem fez o serviço anterior, concluído há até 30 dias."
      extra={<span className="tabular text-xs text-graf-400">{n0(r.total)} de {n0(volume)} VT</span>}
      tabela={<TabelaSimples colunas={['Equipe do serviço anterior', 'Técnico', 'Revisitas']}
        linhas={r.tecnicos.map(t => [t.equipe ?? '—', quem(t), t.n])} />}>
      {r.tecnicos.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma revisita neste dia.</p>
      ) : (
        <BarrasHorizontais rotuloLargo cor={COR.atencao}
          dados={r.tecnicos.slice(0, 10).map(t => ({ rotulo: nome(t), sub: quem(t), valor: t.n }))}
          aoClicar={rot => {
            const t = r.tecnicos.find(x => nome(x) === rot)
            setAberto(a => (t && a !== chave(t) ? chave(t) : null))
          }}
          selecionado={sel ? nome(sel) : null} />
      )}
      {sel && (
        <Detalhe titulo={`${nome(sel)} · ${quem(sel)}`} contagem={`${sel.n} revisita(s)`} aoFechar={() => setAberto(null)}>
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
function TabelaItens({ cabecalho = [], linhas, agruparRua = true }: {
  /** as colunas DEPOIS de Contrato, LOG e Endereço */
  cabecalho?: string[]
  linhas: { id: string; contrato: string | null; cols: ReactNode[] }[]
  /** 241: falso na lista por O.S. (TEC1) — duas O.S. do mesmo contrato não são
   *  "dois na mesma rua", e a ordem da lista é a da classe. */
  agruparRua?: boolean
}) {
  const info = useContext(ContratosCtx)
  const { ordenadas, porRua, ruasRepetidas } = useMemo(() => {
    const porRua = new Map<string, number>()
    if (!agruparRua) return { ordenadas: linhas, porRua, ruasRepetidas: 0 }
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
  }, [linhas, info, agruparRua])

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

// =============================================== 241: LOG alto e TEC1 --
const situacaoRotulo = (s: string) =>
  SITUACAO_INFO[s as keyof typeof SITUACAO_INFO]?.label ?? s
const quem = (equipe: string | null, tecnico: string | null) => (
  <>
    {equipe ? `equipe ${equipe}` : <span className="text-graf-400">sem equipe</span>}
    {tecnico && <span className="block text-[10px] text-graf-400">{tecnico}</span>}
  </>
)

/** Botões de filtro de uma lista: "Todos" + um por valor, com a contagem. */
function Chips<K extends string | number>({ opcoes, valor, aoEscolher, total }: {
  opcoes: { k: K; rotulo: ReactNode; n: number }[]
  valor: K | null; aoEscolher: (k: K | null) => void; total: number
}) {
  const cls = (on: boolean) => `inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${on
    ? 'bg-af-600 font-semibold text-white' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-graf-800 px-3 py-2">
      <button type="button" onClick={() => aoEscolher(null)} aria-pressed={valor == null} className={cls(valor == null)}>
        Todos <span className="tabular opacity-80">{total}</span>
      </button>
      {opcoes.map(o => (
        <button key={String(o.k)} type="button" aria-pressed={valor === o.k}
          onClick={() => aoEscolher(valor === o.k ? null : o.k)} className={cls(valor === o.k)}>
          {o.rotulo} <span className="tabular">{o.n}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Os contratos com LOG acima de 1 (241, D-353) — o mesmo universo do card do
 * LOG (sem Auditar; o cancelado pela central entra, 216). LOG 1 fica de fora:
 * "os log alto acima de 1" (Emanuel, 10/11).
 */
function ListaLogAlto({ itens, aoFechar }: { itens: ItemLog[]; aoFechar: () => void }) {
  const [so, setSo] = useState<number | null>(null)
  const opcoes = useMemo(() => {
    const m = new Map<number, number>()
    for (const i of itens) m.set(i.log, (m.get(i.log) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => a[0] - b[0])
      .map(([k, n]) => ({ k, rotulo: <SeloLog valor={k} />, n }))
  }, [itens])
  const lista = so == null ? itens : itens.filter(i => i.log === so)
  return (
    <Detalhe titulo="LOG acima de 1" contagem={`${lista.length} contrato(s)`} aoFechar={aoFechar}>
      {itens.length === 0 ? (
        <p className="px-3 py-4 text-xs text-graf-400">Nenhum contrato de VT com LOG acima de 1 neste dia.</p>
      ) : (<>
        <Chips opcoes={opcoes} valor={so} aoEscolher={setSo} total={itens.length} />
        <TabelaItens cabecalho={['Situação', 'Equipe · técnico']}
          linhas={lista.map(i => ({
            id: i.visita_id, contrato: i.contrato,
            cols: [
              <>{situacaoRotulo(i.situacao)}
                {i.central && <span className="block text-[10px] text-graf-400">cancelado pela central</span>}</>,
              quem(i.equipe, i.tecnico),
            ],
          }))} />
      </>)}
    </Detalhe>
  )
}

const TEC1_ROTULO: Record<ClasseTec1 | 'ABERTO', string> = {
  SEM_PADRAO: 'Fora do prazo', PADRAO: 'No prazo', EXPURGADA: 'Expurgada', ABERTO: 'Em aberto',
}
const horaDe = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

const CAB_TEC1 = ['O.S.', 'Janela', 'Fim', 'TEC1', 'Equipe · técnico']
/** As linhas da tabela de O.S. do TEC1 — a do card e a do gráfico por equipe. */
const linhasTec1 = (lista: ItemTec1[]) => lista.map(i => ({
  id: i.visita_id, contrato: i.contrato,
  cols: [
    <>{i.numero_os ?? '—'}
      {i.baixa && <span className="block text-[10px] text-graf-400">{i.baixa}</span>}</>,
    <span className="tabular whitespace-nowrap">
      {i.janela_inicio ? `${i.janela_inicio.slice(0, 5)}–${i.janela_fim?.slice(0, 5) ?? '?'}` : 'sem janela'}
    </span>,
    <span className="tabular">{horaDe(i.fim)}</span>,
    <span className="whitespace-nowrap font-medium" style={{
      color: i.classe === 'SEM_PADRAO' ? COR.naoExecutado
        : i.classe === 'PADRAO' ? COR.executado : undefined }}>
      {TEC1_ROTULO[i.classe ?? 'ABERTO']}
      {i.classe == null && (
        <span className="block text-[10px] font-normal text-graf-400">{situacaoRotulo(i.situacao)}</span>
      )}
    </span>,
    quem(i.equipe, i.tecnico),
  ],
}))

/**
 * As O.S. que o card do TEC1 conta (241, D-353), com a classe de
 * `tec1_da_os` — a mesma chamada do card, então card e lista batem. A
 * ordem vem do banco: fora do prazo primeiro.
 */
function ListaTec1({ itens, aoFechar }: { itens: ItemTec1[]; aoFechar: () => void }) {
  const [so, setSo] = useState<ClasseTec1 | 'ABERTO' | null>(null)
  const opcoes = useMemo(() => (['SEM_PADRAO', 'PADRAO', 'EXPURGADA', 'ABERTO'] as const)
    .map(k => ({ k, rotulo: TEC1_ROTULO[k], n: itens.filter(i => (i.classe ?? 'ABERTO') === k).length }))
    .filter(o => o.n > 0), [itens])
  const lista = so == null ? itens : itens.filter(i => (i.classe ?? 'ABERTO') === so)
  return (
    <Detalhe titulo="TEC1 por O.S." contagem={`${lista.length} O.S.`} aoFechar={aoFechar}>
      {itens.length === 0 ? (
        <p className="px-3 py-4 text-xs text-graf-400">Nenhuma O.S. de VT neste dia.</p>
      ) : (<>
        <Chips opcoes={opcoes} valor={so} aoEscolher={setSo} total={itens.length} />
        <TabelaItens agruparRua={false} cabecalho={CAB_TEC1} linhas={linhasTec1(lista)} />
      </>)}
    </Detalhe>
  )
}

// ==================================================== 242: sub-falha --
/**
 * A sub-falha ofensora (242, D-354) — "código de baixa ofensor logo ao lado e
 * subfalha ao lado também" (Emanuel, 10/11). Por contrato: cada sub-falha que
 * alguma O.S. dele tem. O universo é o do código ofensor (`codos`).
 */
function SubFalhaOfensora({ s }: { s: NonNullable<DadosVT['sub_falhas']> }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const LIMITE = 12
  const sel = s.lista.find(x => x.sub_falha === aberto) ?? null
  const fora = s.lista.length - Math.min(s.lista.length, LIMITE)
  return (
    <Painel titulo="Sub-falha ofensora"
      dica="O porquê do código: a sub-falha lançada na baixa, por contrato."
      extra={<span className="tabular text-xs text-graf-400">{n0(s.lista.length)} sub-falha(s)</span>}
      tabela={<TabelaSimples colunas={['Sub-falha', 'Contratos']} linhas={s.lista.map(x => [x.sub_falha, x.n])} />}
      nota={(fora > 0 || s.sem_sub_falha > 0) && <>
        {fora > 0 && <>As {LIMITE} maiores; outras <span className="tabular">{fora}</span> na tabela. </>}
        {s.sem_sub_falha > 0 && <><span className="tabular">{s.sem_sub_falha}</span> de{' '}
          <span className="tabular">{s.contratos_com_codigo}</span> contrato(s) com código não têm sub-falha.</>}
      </>}>
      {s.lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma sub-falha lançada neste dia.</p>
      ) : (
        <BarrasHorizontais rotuloLargo parte totalRef={s.contratos_com_codigo} cor="var(--st-impedimento)"
          dados={s.lista.slice(0, LIMITE).map(x => ({ rotulo: x.sub_falha, valor: x.n }))}
          aoClicar={r => setAberto(a => (a === r ? null : r))}
          selecionado={aberto} />
      )}
      {sel && (
        <Detalhe titulo={sel.sub_falha} contagem={`${sel.n} contrato(s)`} aoFechar={() => setAberto(null)}>
          <TabelaItens cabecalho={['Código de baixa']}
            linhas={sel.itens.map(i => ({
              id: i.visita_id, contrato: i.contrato,
              cols: [i.codigo ?? <span className="text-graf-400">sem código</span>],
            }))} />
        </Detalhe>
      )}
    </Painel>
  )
}

// ================================================ 242: TEC1 por equipe --
interface Tec1Equipe {
  chave: string; equipe: string | null; tecnico: string | null
  padrao: number; sem: number; expurgada: number; aberto: number; itens: ItemTec1[]
}

/**
 * O TEC1 por equipe (242, D-354) — "adicione um gráfico de TEC1 também, e na
 * o.s perdida o colaborador conseguirá visualizar qual contrato" (Emanuel, 10/11).
 *
 * A classe de cada O.S. vem pronta do banco (`tec1_lista`, a mesma chamada de
 * `tec1_da_os` do card): a tela só AGRUPA a lista por equipe, então card,
 * gráfico e lista sempre batem. As O.S. perdidas ficam à vista no topo, com o
 * contrato — não escondidas atrás de um clique.
 */
function Tec1PorEquipe({ itens }: { itens: ItemTec1[] }) {
  const [aberta, setAberta] = useState<string | null>(null)
  const [todas, setTodas] = useState(false)
  const LIMITE = 10
  const equipes = useMemo(() => {
    const m = new Map<string, Tec1Equipe>()
    for (const i of itens) {
      const k = i.equipe_id ?? i.equipe ?? 'sem'
      const t = m.get(k) ?? { chave: k, equipe: i.equipe, tecnico: i.tecnico,
                              padrao: 0, sem: 0, expurgada: 0, aberto: 0, itens: [] }
      if (i.classe === 'PADRAO') t.padrao++
      else if (i.classe === 'SEM_PADRAO') t.sem++
      else if (i.classe === 'EXPURGADA') t.expurgada++
      else t.aberto++
      if (!t.tecnico && i.tecnico) t.tecnico = i.tecnico
      t.itens.push(i)
      m.set(k, t)
    }
    // quem perdeu primeiro; depois quem tem mais O.S. medidas
    return [...m.values()].sort((a, b) => b.sem - a.sem
      || (b.padrao + b.sem) - (a.padrao + a.sem) || b.itens.length - a.itens.length
      || (a.equipe ?? 'zz').localeCompare(b.equipe ?? 'zz'))
  }, [itens])
  const perdidas = useMemo(() => itens.filter(i => i.classe === 'SEM_PADRAO'), [itens])
  // O chip é o CONTRATO: duas O.S. perdidas no mesmo contrato são um chip com "2 O.S.".
  const perdidosPorContrato = useMemo(() => {
    const m = new Map<string, ItemTec1[]>()
    for (const i of perdidas) m.set(i.visita_id, [...(m.get(i.visita_id) ?? []), i])
    return [...m.values()]
  }, [perdidas])
  const max = Math.max(1, ...equipes.map(e => e.itens.length))
  const vis = todas ? equipes : equipes.slice(0, LIMITE)
  const sel = equipes.find(e => e.chave === aberta) ?? null
  const rot = (e: Tec1Equipe) => e.equipe ? `Equipe ${e.equipe}` : 'Sem equipe'
  const pctE = (e: Tec1Equipe) => pct(e.padrao, e.padrao + e.sem, 0)
  const series = [
    { k: 'padrao', rotulo: 'No prazo', cor: COR.executado },
    { k: 'sem', rotulo: 'Fora do prazo', cor: COR.naoExecutado },
    { k: 'expurgada', rotulo: 'Expurgada', cor: 'var(--color-graf-500)' },
    { k: 'aberto', rotulo: 'Em aberto', cor: 'var(--color-graf-700)' },
  ] as const
  const tot = (k: typeof series[number]['k']) => equipes.reduce((t, e) => t + e[k], 0)

  return (
    <Painel titulo="TEC1 por equipe"
      dica="Por O.S., só do que o TOA encerrou. % = no prazo ÷ (no prazo + fora do prazo)."
      extra={<span className="tabular text-xs text-graf-400">{n0(itens.length)} O.S.</span>}
      tabela={<TabelaSimples colunas={['Equipe', 'Técnico', 'No prazo', 'Fora do prazo', 'Expurgada', 'Em aberto', 'TEC1']}
        linhas={equipes.map(e => [rot(e), e.tecnico ?? '—', e.padrao, e.sem, e.expurgada, e.aberto,
                                  pctE(e) ? `${pctE(e)}%` : '—'])} />}>
      {/* As perdidas, com o contrato, antes do gráfico. */}
      <div className="mb-3 rounded-md border border-graf-800 px-3 py-2"
        style={perdidas.length ? {
          borderColor: 'color-mix(in srgb, var(--st-conflito) 45%, transparent)',
          background: 'color-mix(in srgb, var(--st-conflito) 6%, transparent)',
        } : undefined}>
        {perdidas.length === 0 ? (
          <p className="text-xs text-graf-300">
            <span style={{ color: COR.executado }} aria-hidden>✓ </span>Nenhuma O.S. perdeu o prazo neste dia.
          </p>
        ) : (<>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-graf-200">
            O.S. perdidas · <span className="tabular" style={{ color: COR.naoExecutado }}>{perdidas.length}</span>
            {perdidosPorContrato.length !== perdidas.length && (
              <span className="font-normal normal-case tracking-normal text-graf-400">
                {' '}em <span className="tabular">{perdidosPorContrato.length}</span> contratos</span>
            )}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {perdidosPorContrato.map(os => {
              const i = os[0]
              return (
                <li key={i.visita_id}>
                  <LinkContrato to={`/controle/visita/${i.visita_id}`}
                    title={`O.S. ${os.map(o => o.numero_os ?? '?').join(', ')} · ${i.equipe ? `equipe ${i.equipe}` : 'sem equipe'}${i.tecnico ? ` · ${i.tecnico}` : ''}`}
                    className="inline-flex items-baseline gap-1.5 rounded bg-graf-900 px-2 py-0.5 text-xs ring-1 ring-graf-700 hover:ring-af-500">
                    <span className="tabular font-semibold text-graf-100">{i.contrato ?? 'sem contrato'}</span>
                    <span className="text-[10px] text-graf-400">
                      {i.equipe ? `eq ${i.equipe}` : 'sem equipe'}{os.length > 1 && ` · ${os.length} O.S.`}
                    </span>
                  </LinkContrato>
                </li>
              )
            })}
          </ul>
        </>)}
      </div>

      {equipes.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma O.S. de VT neste dia.</p>
      ) : (<>
        <ul className="space-y-1.5">
          {vis.map(e => {
            const p = pctE(e)
            return (
              <li key={e.chave}>
                <button type="button" onClick={() => setAberta(a => a === e.chave ? null : e.chave)}
                  aria-pressed={aberta === e.chave}
                  title={series.map(s => `${s.rotulo}: ${e[s.k]}`).join('\n')}
                  className={`flex w-full items-center gap-2.5 rounded px-1 text-left text-sm hover:bg-graf-900 ${
                    aberta === e.chave ? 'bg-graf-900 ring-1 ring-graf-700' : ''}`}>
                  <span className="w-24 shrink-0 text-right text-xs leading-tight sm:w-32">
                    <span className="block truncate font-semibold text-graf-200">{rot(e)}</span>
                    {!!e.tecnico && <span className="block truncate text-[11px] text-graf-400">{e.tecnico}</span>}
                  </span>
                  <span className="flex h-5 flex-1 overflow-hidden rounded-sm bg-graf-900">
                    {series.map(s => e[s.k] > 0 && (
                      <span key={s.k} style={{ width: `${(e[s.k] / max) * 100}%`, background: s.cor }} />
                    ))}
                  </span>
                  <span className="tabular w-12 shrink-0 text-right text-xs font-semibold"
                    style={{ color: p == null ? undefined : e.sem > 0 ? COR.atencao : COR.executado }}>
                    {p != null ? `${p}%` : <span className="font-normal text-graf-400">—</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map(s => (
            <span key={s.k} className="flex items-center gap-1.5 text-xs text-graf-300">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm ring-1 ring-graf-600/40" style={{ background: s.cor }} />
              {s.rotulo} <span className="tabular font-semibold">{tot(s.k)}</span>
            </span>
          ))}
          {equipes.length > LIMITE && (
            <button type="button" onClick={() => setTodas(t => !t)} aria-expanded={todas}
              className="ml-auto text-[11px] text-af-400 underline-offset-2 hover:underline">
              {todas ? 'mostrar menos' : `todas as ${equipes.length} equipes`}
            </button>
          )}
        </div>
      </>)}

      {sel && (
        <Detalhe titulo={`${rot(sel)}${sel.tecnico ? ` · ${sel.tecnico}` : ''}`}
          contagem={`${sel.itens.length} O.S.`} aoFechar={() => setAberta(null)}>
          <TabelaItens agruparRua={false} cabecalho={CAB_TEC1} linhas={linhasTec1(sel.itens)} />
        </Detalhe>
      )}
    </Painel>
  )
}
