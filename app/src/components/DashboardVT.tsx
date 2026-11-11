import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACAO_INFO } from '../lib/supabase'
import { isoLocal, equipeRotulo } from '../lib/formato'
import { Painel, BarrasHorizontais, TabelaSimples } from './graficos'
import { Alerta, Vazio } from './ui'
import { BotaoAtualizar } from './BotaoAtualizar'
import { LinkContrato } from './LinkContrato'
import { SeloPosAtivo, linkPosAtivo, temPosAtivo, type PosAtivo } from './SeloPosAtivo'
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
  /** 244: o período (de = dia) e quantos dias ele tem */
  de?: string; ate?: string; dias_periodo?: number
  /** 244: a certidão de atendimento (a régua da 235) */
  certidao?: DadosCertidao
  cancelado_central: number; volume: number
  log: { base: number; sem_log: number; log3: number; log0: number
         por_log: { log: number; n: number }[] }
  tec1: { padrao: number; sem_padrao: number; expurgada: number; em_aberto: number }
  at1: { vt_com_base: number; base: number | null; vt_sem_base: number }
  /** 224 (D-335): as áreas com VT no dia, para o filtro, e o filtro aplicado. */
  areas_opcoes?: { area_id: string; rotulo: string }[]
  /** 246 (D-358): os buckets com VT no período, para o filtro */
  buckets_opcoes?: { bucket: string; n: number }[]
  /** 250 (D-364): os supervisores (D-134) com VT no período, para o filtro */
  supervisores_opcoes?: { supervisor: string; n: number }[]
  /** 250 (D-363): a Revisita 30 D — VT que voltou de VT em até 30 dias */
  revisita30?: { base: number; n: number; lista: ItemRev30[] }
  areas_filtro?: string[]
  areas: { area_id: string; codigo: string; rotulo: string; clientes: number | null
           desde: string | null; vt: number }[]
  equipes: { equipe_id: string | null; codigo: string | null; nome: string | null; tecnico?: string | null
             executados: number; nao_executados: number; em_aberto: number
             outros: number; total: number; equipe_vt?: boolean
             /** 242: pela SITUAÇÃO do contrato */
             concluidos?: number; reagendados?: number; cancelados?: number; abertos?: number }[]
  /** 244: equipe-dia em `equipes`; aqui, quantas equipes diferentes */
  /** 242: contratos por sub-falha (o mesmo universo do código ofensor) */
  sub_falhas?: { contratos_com_codigo: number; sem_sub_falha: number
                 lista: { sub_falha: string; n: number
                          itens: { visita_id: string; contrato: string | null; codigo: string | null }[] }[] }
  revisita: { total: number
              tecnicos: { tecnico: string; equipe: string | null; nome_do_cadastro?: boolean; n: number; itens: ItemRev[] }[] }
  nodes: { distintos: number; sem_node: number
           lista: { node: string; n: number; log3: number; nao_executados: number
                    itens: { visita_id: string; contrato: string | null; log: number | null
                             /** 243: janela, situação e código (TOA; sem ele, AFLINE) */
                             situacao?: string; janela_inicio?: string | null; janela_fim?: string | null
                             baixa?: string | null }[] }[] }
  codigos: { contratos_com_baixa: number; sem_baixa: number
             lista: { codigo: number; descricao: string; natureza: string | null; n: number
                      pelo_afline: number
                      sub_falhas: { sub_falha: string | null; n: number }[]
                      itens: { visita_id: string; contrato: string | null
                               sub_falha: string | null; fonte: 'TOA' | 'AFLINE' }[] }[] }
  /** 217: equipe de VT = 4+ contratos no dia, ou de manutenção com qualquer número. */
  equipes_vt?: { minimo: number; equipes: number; por_manutencao: number; vt: number
                 sem_equipe: number
                 /** 244: no período, `equipes` é equipe-dia; esta é quantas equipes diferentes */
                 equipes_distintas?: number
                 fora: { equipe_id: string; codigo: string | null; nome: string | null; n: number
                         dias?: number
                         itens: { visita_id: string; contrato: string | null; dia?: string }[] }[] }
  /** 217: janela × área; `total_janela`/`total_area` marcam as linhas de total. */
  janelas?: { janela: string | null; area: string | null; total_janela: boolean; total_area: boolean
              vt: number; vt_eq: number; equipes: number }[]
  /** 217: LOG, endereço e a chave da rua (normalizada no banco) de cada contrato. */
  contratos?: Record<string, InfoContrato>
  /** 241: os contratos com LOG acima de 1, no universo do card do LOG. */
  log_lista?: ItemLog[]
  /** 241: cada O.S. que o card do TEC1 conta, com a classe dela. */
  tec1_lista?: ItemTec1[]
  /** 257 (D-372): a evidência do NOSSO app, só sobre o encerrado (D-296) */
  evidencia?: { encerradas: number; com: number; sem: number; arquivos: number; abertas: number
                lista_sem: { visita_id: string; contrato: string | null; dia: string; situacao: string
                             equipe: string | null; tecnico: string | null }[] }
  /** 257 (D-372): equipes em campo × atrasadas, pela régua 09:10 … 17:20 */
  atraso?: { marcos: { k: number; hora: string }[]; em_campo: number; equipes_distintas: number
             julgadas: number; atrasadas: number; atrasadas_agora: number; hoje_no_periodo: boolean
             lista: ItemAtraso[] }
}
interface ItemAtraso {
  equipe_id: string; codigo: string | null; nome: string | null; dia: string; tecnico: string | null
  /** VT na agenda do dia inteiro da equipe (sem Auditar e sem cancelado pela central) */
  agenda: number; baixados: number
  /** marcos que já passaram e em quantos ela estava abaixo */
  passados: number; atrasados: number
  /** o primeiro marco em que ficou abaixo ("HH:MM") */
  primeiro: string | null; maior_falta: number | null
  /** só no dia de hoje: quantos devia no último marco que passou */
  deve_agora: number | null; atrasada_agora: boolean
  marcos: { k: number; deve: number; baixou: number }[] | null
  itens: { visita_id: string; contrato: string | null; dia: string; baixa: string | null }[]
}
interface DadosCertidao {
  finalizados: number; regular: number; com_falha: number; sem_validacao: number
  tecnicos: { tecnico_id: string | null; tecnico: string | null; equipe: string | null
              finalizados: number; regular: number; com_falha: number; sem_validacao: number
              itens: { visita_id: string; contrato: string | null; dia: string
                       classe: 'COM_FALHA' | 'SEM_VALIDACAO'; equipe: string | null }[] }[]
}
export interface ItemRev30 {
  visita_id: string; contrato: string | null; dia: string; situacao: string
  equipe: string | null; tecnico: string | null
  anterior_id: string; anterior_data: string; anterior_situacao: string; dias: number
  anterior_equipe: string | null; anterior_tecnico: string | null; anterior_baixa: string | null
  /** 252 (D-366): a validação de sinal da VT anterior, como o Portal Técnico mostrou
   *  (rótulo e cor da CLARO). Nulo = o portal não foi lido para ela. */
  anterior_sinal?: { validacao: string | null; cor: string | null; status_os: string | null
                     inicial: string | null; classe: string | null } | null
  /** 253 (D-367): o pós-ativo da VT anterior. Nulo = ninguém registrou nada. */
  anterior_pos?: PosAtivo | null
}

/** 252: a chave do filtro de validação — o rótulo da CLARO; sem leitura à parte. */
const chaveSinal = (i: ItemRev30) => i.anterior_sinal?.validacao?.trim() || (i.anterior_sinal ? 'Sem rótulo' : 'SEM_LEITURA')
/** A cor do portal (green/red/yellow) nas cores fixas do painel. */
export const corSinal = (c: string | null | undefined) => {
  const k = (c ?? '').toLowerCase()
  return k === 'green' ? COR.executado : k === 'red' ? COR.naoExecutado : k === 'yellow' ? COR.atencao : undefined
}
interface ItemLog {
  dia?: string
  visita_id: string; contrato: string | null; log: number; situacao: string
  central: boolean; equipe: string | null; tecnico: string | null
  /** 251 (D-365): o código de baixa (TOA; sem ele, AFLINE) */
  baixa?: string | null
}
type ClasseTec1 = 'PADRAO' | 'SEM_PADRAO' | 'EXPURGADA'
interface ItemTec1 {
  dia?: string
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
/** 257: o limiar da COR do card de evidência — o mesmo do Dashboard INST (155). Não é
 *  meta de ninguém (nenhuma foto é obrigatória, D-115): a tela não escreve "meta". */
const LIMIAR_EVIDENCIA = 90
const fmtMeta = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/** Os contratos do dia, para as listas mostrarem LOG e endereço sem repetir o dado. */
const ContratosCtx = createContext<Record<string, InfoContrato>>({})
/** 244: o período tem mais de um dia — as listas mostram a data embaixo do contrato. */
const VariosDiasCtx = createContext(false)

// Cores CHEIAS que têm de ser as mesmas nos dois temas vão por variável
// fixa (`--st-*`, que o tema claro não redefine) — nunca por classe
// 700/300, que inverte no claro (D-303).
export const COR = {
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
  // 244 (D-356): "pode mostrar o acumulativo, ou seja do dia 01 a hoje, porém por padrão
  // ele deixa setado início e fim hoje" (Emanuel, 10/11)
  const hoje = isoLocal(new Date())
  const [deLocal, setDeLocal] = useState(hoje)
  const [ateLocal, setAteLocal] = useState(hoje)
  const de = diaProp ?? deLocal
  const ate = diaProp ?? (ateLocal < deLocal ? deLocal : ateLocal)
  const inicioMes = hoje.slice(0, 8) + '01'
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
  // 246 (D-358): "falta adicionar o filtro do bucket" (Emanuel, 10/11) — igual ao de área
  const [buckets, setBuckets] = useState<string[]>([])
  const [opcoesBucket, setOpcoesBucket] = useState<OpcaoMultipla[]>([])
  // 250 (D-364): "criar o filtro por supervisor também nessa janela" (Emanuel, 10/11)
  const [supervisores, setSupervisores] = useState<string[]>([])
  const [opcoesSup, setOpcoesSup] = useState<OpcaoMultipla[]>([])

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('dashboard_visita_tecnica', {
      p_dia: de, p_ate: ate,
      ...(areas.length ? { p_areas: areas } : {}),
      ...(buckets.length ? { p_buckets: buckets } : {}),
      ...(supervisores.length ? { p_supervisores: supervisores } : {}),
    })
      .then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else {
        const x = data as DadosVT
        setD(x); setAtualizado(new Date())
        setOpcoesArea((x.areas_opcoes ?? []).map(a => ({ valor: a.area_id, rotulo: a.rotulo })))
        setOpcoesBucket((x.buckets_opcoes ?? []).map(b => ({
          valor: b.bucket, rotulo: b.bucket === 'SEM_BUCKET' ? 'Sem bucket' : b.bucket, qtd: b.n,
        })))
        setOpcoesSup((x.supervisores_opcoes ?? []).map(s => ({
          valor: s.supervisor, rotulo: s.supervisor === 'SEM_SUPERVISOR' ? 'Sem supervisor' : s.supervisor, qtd: s.n,
        })))
      }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate, versao, areas, buckets, supervisores])

  return (
    <section aria-labelledby="dvt-titulo" className="space-y-3">
      {/* O cabeçalho é FAIXA, não cartão: ele separa este painel do
          Dashboard de cima sem competir com os números. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-graf-700 pb-2 pt-3">
        <span aria-hidden className="h-5 w-1 rounded-sm" style={{ background: 'var(--color-af-600)' }} />
        <h2 id="dvt-titulo" className="text-base font-semibold tracking-tight">Visita Técnica</h2>
        {diaProp != null && <span className="tabular text-xs text-graf-400">{dataBR(de)}</span>}
        {diaProp == null && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Período">
            <input type="date" value={deLocal} max={hoje}
              onChange={e => { const v = e.target.value; if (!v) return; setDeLocal(v); if (v > ateLocal) setAteLocal(v) }}
              aria-label="Início do período"
              className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1" />
            <span className="text-graf-400">a</span>
            <input type="date" value={ate} min={deLocal}
              onChange={e => e.target.value && setAteLocal(e.target.value)}
              aria-label="Fim do período"
              className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1" />
            {([['Hoje', hoje, hoje], ['Mês até hoje', inicioMes, hoje]] as const).map(([r, a, b]) => {
              const on = deLocal === a && ate === b
              return (
                <button key={r} type="button" aria-pressed={on}
                  onClick={() => { setDeLocal(a); setAteLocal(b) }}
                  className={`rounded-md px-2 py-1 ${on ? 'bg-af-600 font-semibold text-white'
                    : 'border border-graf-700 text-graf-300 hover:border-af-600'}`}>{r}</button>
              )
            })}
          </div>
        )}
        <SelecaoMultipla rotulo="Área" todos="Toda área" plural="áreas"
          opcoes={opcoesArea} valor={areas} onChange={setAreas}
          className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1 text-xs outline-none focus:border-af-500" />
        <SelecaoMultipla rotulo="Bucket" todos="Todo bucket" plural="buckets"
          opcoes={opcoesBucket} valor={buckets} onChange={setBuckets}
          className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1 text-xs outline-none focus:border-af-500" />
        <SelecaoMultipla rotulo="Supervisor" todos="Todo supervisor" plural="supervisores"
          opcoes={opcoesSup} valor={supervisores} onChange={setSupervisores}
          className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1 text-xs outline-none focus:border-af-500" />
        <div className="ml-auto flex items-center gap-3">
          <Link to={`/controle/servicos?de=${de}&ate=${ate}&grupo=${encodeURIComponent('VISITA TECNICA')}`}
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
          {areas.length || buckets.length || supervisores.length
            ? <Vazio titulo="Nenhuma visita técnica nos filtros escolhidos"
                descricao="No período, a combinação de área, bucket e supervisor marcada não tem contrato de VISITA TECNICA." />
            : <Vazio titulo="Nenhuma visita técnica no período"
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
  // 244: no período, AT1 = VT do período ÷ base; projetada = VT ÷ dias × dias do mês ÷ base
  const dias = Math.max(1, d.dias_periodo ?? 1)
  const variosDias = dias > 1
  const pAt1 = d.at1.base ? pct(d.at1.vt_com_base, d.at1.base, 2) : null
  const pAt1Proj = d.at1.base ? pct((d.at1.vt_com_base / dias) * d.dias_mes, d.at1.base, 2) : null
  // 217: as metas em número, para a cor; nulo = sem denominador, sem cor
  const vLog = d.log.base ? (d.log.log3 * 100) / d.log.base : null
  const vAt5 = d.log.base ? (d.log.log0 * 100) / d.log.base : null
  const vAt1Proj = d.at1.base ? ((d.at1.vt_com_base / dias) * d.dias_mes * 100) / d.at1.base : null
  const corMeta = (ok: boolean | null) => ok == null ? undefined : ok ? COR.executado : COR.atencao
  const okLog = vLog == null ? null : vLog <= META_LOG
  const okAt5 = vAt5 == null ? null : vAt5 >= META_AT5
  const okAt1 = vAt1Proj == null ? null : vAt1Proj <= META_AT1
  // 241 (D-353): "da opção para o usuario clicar tanto no log como no TEC1" (Emanuel, 10/11)
  type Card = 'LOG' | 'REV30' | 'TEC1' | 'MEDIA' | 'AT1' | 'EVID' | 'ATRASO'
  // 257 (D-372): evidência (só o encerrado) e equipes atrasadas
  const evd = d.evidencia
  const pEvid = evd ? pct(evd.com, evd.encerradas) : null
  const atr = d.atraso
  const marcoAgora = atr ? marcoAtual(atr.marcos) : null
  // 250 (D-363): a Revisita 30 D — VT que voltou de VT ÷ VT da conta
  const r30 = d.revisita30
  const pRev30 = r30 ? pct(r30.n, r30.base) : null
  const r30Mesmo = r30 ? r30.lista.filter(i => i.anterior_tecnico && i.anterior_tecnico === i.tecnico).length : 0
  // 252 (D-366): a anterior foi validada em vermelho no portal (o vermelho é da CLARO)
  const r30Irreg = r30 ? r30.lista.filter(i => (i.anterior_sinal?.cor ?? '').toLowerCase() === 'red').length : 0
  const [ver, setVer] = useState<Card | null>(null)
  // D-370: a barra clicada no painel da causa da revisita abre a lista embaixo
  const [filtroRev, setFiltroRev] = useState<FiltroRev | null>(null)
  const logAlto = d.log_lista ?? []
  const alternar = (k: Card) => setVer(v => v === k ? null : k)
  // 242: a média por equipe de VT virou o quinto card da régua
  const ev = d.equipes_vt
  const media = ev && ev.equipes ? (ev.vt / ev.equipes).toFixed(1).replace('.', ',') : null

  return (
    <ContratosCtx.Provider value={d.contratos ?? {}}>
    <VariosDiasCtx.Provider value={variosDias}>
      {/* ===== 1. o julgamento: os cinco números, cada um abre a sua lista ===== */}
      <section className="card-controle sobe overflow-hidden" aria-label="Indicadores da visita técnica">
        <div className="regua-grade">
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

          {/* 250 (D-363): "mais um card chamado Revisita 30 D ao lado do log (...) VT da VT
              apenas" (Emanuel, 10/11). Sem meta combinada: o número não ganha cor de meta. */}
          {r30 && (
            <Indicador rotulo="Revisita 30 D" valor={pRev30} sufixo="%"
              cor={r30.n > 0 ? COR.atencao : undefined}
              dica="VT que voltou de outra VT do mesmo contrato em até 30 dias ÷ VT na conta. A VT anterior Auditar ou cancelada pela central é pulada: vale a VT antes dela."
              aoClicar={() => alternar('REV30')} aberto={ver === 'REV30'} chamada="ver de onde voltou"
              barra={r30.base > 0 && (
                <BarraMeta valor={(r30.n * 100) / r30.base} cor={COR.atencao} />
              )}
              apoio={<>
                <span className="tabular">{n0(r30.n)}</span> de{' '}
                <span className="tabular">{n0(r30.base)}</span> VT voltaram de VT
                {r30Mesmo > 0 && (
                  <span className="block" title="A VT anterior foi feita pelo mesmo técnico da VT de agora">
                    <span className="tabular font-semibold text-amber-300">{n0(r30Mesmo)}</span> com o mesmo técnico
                  </span>
                )}
                {r30Irreg > 0 && (
                  <span className="block" title="A VT anterior teve a validação de sinal em vermelho no Portal Técnico">
                    <span className="tabular font-semibold" style={{ color: COR.naoExecutado }}>{n0(r30Irreg)}</span> com a anterior irregular
                  </span>
                )}
              </>} />
          )}

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
            dica={variosDias
              ? `VT do período ÷ ${dias} dias × ${d.dias_mes} dias ÷ base de clientes das áreas`
              : `VT do dia × ${d.dias_mes} dias ÷ base de clientes das áreas`}
            aoClicar={() => alternar('AT1')} aberto={ver === 'AT1'} chamada="ver por área"
            segundo={pAt1 && (
              <span className="tabular text-base font-semibold text-graf-300"
                title={variosDias ? 'VT do período ÷ base' : 'VT do dia ÷ base'}>
                {pAt1}<span className="text-xs text-graf-400">%</span>
                <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-graf-400">
                  {variosDias ? 'no período' : 'no dia'}</span>
              </span>
            )}
            barra={vAt1Proj != null && (
              // escala até o dobro da meta: a meta fica no meio do trilho
              <BarraMeta valor={(vAt1Proj * 50) / META_AT1} meta={50} cor={okAt1 ? COR.executado : COR.atencao} />
            )}
            apoio={d.at1.base ? <>
              <span className="tabular">{n0(d.at1.vt_com_base)}</span> VT
              {variosDias && <> em <span className="tabular">{dias}</span> dias</>} ÷{' '}
              <span className="tabular">{n0(d.at1.base)}</span> clientes · mês de {d.dias_mes} dias
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
            <Indicador rotulo={variosDias ? 'VT por equipe/dia' : 'VT por equipe'} valor={media}
              dica={`Equipe de VT: ${ev.minimo} ou mais VT no dia; manutenção conta sempre.${variosDias
                ? ' No período, a média é por equipe-dia: cada dia em que a equipe fez o mínimo.' : ''}`}
              aoClicar={() => alternar('MEDIA')} aberto={ver === 'MEDIA'} chamada="ver as equipes"
              barra={d.volume > 0 && (
                <BarraMeta valor={(ev.vt * 100) / d.volume} cor="var(--st-execucao)" />
              )}
              apoio={<>
                <span className="tabular">{n0(ev.vt)}</span> VT em{' '}
                {variosDias ? <>
                  <span className="tabular">{n0(ev.equipes)}</span> equipe-dia
                  {ev.equipes_distintas != null && <> (<span className="tabular">{n0(ev.equipes_distintas)}</span> equipes)</>}
                  {' '}de {ev.minimo}+
                </> : <>
                  <span className="tabular">{n0(ev.equipes)}</span> equipe(s) de {ev.minimo}+
                </>}
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

          {/* 257 (D-372): "o card das evidencias o mesmo que tem no dashboard da instalação,
              vamos levar para VT so de VT" (Emanuel, 11/11). A conta é a do INST (D-296). */}
          {evd && (
            <Indicador rotulo="Com evidência" valor={evd.encerradas ? pEvid : null} sufixo="%"
              cor={!evd.encerradas ? undefined : evd.com === 0 ? 'var(--color-graf-500)'
                : (evd.com * 100) / evd.encerradas >= LIMIAR_EVIDENCIA ? COR.executado : COR.atencao}
              dica="VT encerradas com pelo menos uma foto ou vídeo do NOSSO aplicativo ÷ VT encerradas. Em aberto fica fora: a foto ainda pode vir."
              aoClicar={evd.sem > 0 ? () => alternar('EVID') : undefined} aberto={ver === 'EVID'}
              chamada="ver quem não registrou"
              barra={evd.encerradas > 0 && (
                <BarraMeta valor={(evd.com * 100) / evd.encerradas}
                  cor={(evd.com * 100) / evd.encerradas >= LIMIAR_EVIDENCIA ? COR.executado : COR.atencao} />
              )}
              apoio={evd.encerradas === 0 ? <>nenhuma VT encerrada ainda</> : <>
                <span className="tabular">{n0(evd.com)}</span> com ·{' '}
                <span className="tabular">{n0(evd.sem)}</span> sem ·{' '}
                <span className="tabular">{n0(evd.arquivos)}</span> arquivo(s)
                {evd.abertas > 0 && (
                  <span className="block" title="VT que ainda não encerrou fica fora da porcentagem: a foto ainda pode vir">
                    <span className="tabular">{n0(evd.abertas)}</span> em aberto fora da conta
                  </span>
                )}
              </>} />
          )}

          {/* 257 (D-372): "Equipes em campo, Vs equipes atrasadas" — a régua 09:10 … 17:20 */}
          {atr && (
            <Indicador rotulo="Equipes atrasadas" valor={atr.julgadas ? n0(atr.atrasadas) : null}
              sufixo={`de ${n0(atr.em_campo)}`}
              cor={atr.atrasadas > 0 ? COR.naoExecutado : atr.julgadas ? COR.executado : undefined}
              dica={`Equipe de VT que, em algum marco do dia, tinha menos clientes baixados do que devia: ${
                atr.marcos.map(m => `${m.hora} ${m.k}º`).join(' · ')}. Baixa = o TOA encerrou (concluído ou não), na hora do fim. A cobrança não passa da agenda da equipe.`}
              aoClicar={atr.em_campo > 0 ? () => alternar('ATRASO') : undefined} aberto={ver === 'ATRASO'}
              chamada="ver as equipes"
              barra={atr.julgadas > 0 && (
                <BarraMeta valor={(atr.atrasadas * 100) / atr.julgadas} cor={COR.naoExecutado} />
              )}
              apoio={<>
                <span className="tabular">{n0(atr.em_campo)}</span> {variosDias ? 'equipe-dia' : 'equipe(s)'} de VT em campo
                {variosDias && <> (<span className="tabular">{n0(atr.equipes_distintas)}</span> equipes)</>}
                {atr.hoje_no_periodo && marcoAgora && (
                  <span className="block" title={`Abaixo do marco das ${marcoAgora.hora} (${marcoAgora.k}º cliente) com o que baixaram até agora`}>
                    <span className="tabular font-semibold" style={{ color: atr.atrasadas_agora ? COR.naoExecutado : undefined }}>
                      {n0(atr.atrasadas_agora)}</span> atrasada(s) agora · marco {marcoAgora.hora}
                  </span>
                )}
                {atr.julgadas === 0 && (
                  <span className="block">o primeiro marco é às {atr.marcos[0]?.hora ?? '09:10'}</span>
                )}
              </>} />
          )}
        </div>
        <p className="border-t border-graf-800 px-4 py-1.5 text-[11px] text-graf-400"
           title="Auditar e Cancelado pela central não entram nos ofensores nem no AT1; o Cancelado pela central entra no LOG e no AT5">
          <span className="tabular font-semibold text-graf-300">{n0(d.total)}</span> VT {variosDias ? 'no período' : 'no dia'} ·{' '}
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
        {ver === 'REV30' && r30 && (
          <div className="px-4 pb-3">
            <ListaRevisita30 itens={r30.lista} aoFechar={() => setVer(null)} />
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
        {ver === 'EVID' && evd && (
          <div className="px-4 pb-3">
            <Detalhe titulo="VT encerradas sem evidência" contagem={`${evd.lista_sem.length} contrato(s)`}
              aoFechar={() => setVer(null)}>
              <TabelaItens cabecalho={['Situação', 'Equipe · técnico']}
                linhas={evd.lista_sem.map(i => ({
                  id: i.visita_id, contrato: i.contrato, dia: i.dia,
                  cols: [situacaoRotulo(i.situacao), quem(i.equipe, i.tecnico)],
                }))} />
            </Detalhe>
          </div>
        )}
        {ver === 'ATRASO' && atr && (
          <div className="px-4 pb-3">
            <ListaAtraso a={atr} aoFechar={() => setVer(null)} />
          </div>
        )}
        {ver === 'AT1' && (
          <div className="px-4 pb-3">
            <Detalhe titulo="AT1 por área" contagem={`${d.areas.filter(a => a.vt > 0 || a.clientes != null).length} área(s)`}
              aoFechar={() => setVer(null)}>
              <At1Tabela d={d} />
            </Detalhe>
          </div>
        )}
      </section>

      {/* ===== 2. a carga: onde o dia pesa ===== */}
      <Faixa titulo={variosDias ? 'Carga do período' : 'Carga do dia'}
        sub="onde estão as VT, por janela e área · de onde veio a revisita · a certidão do que foi finalizado" />
      {/* D-370: "diminui mais o gráfico do VT por janela e área (...) eu quero mais um
          gráfico no meio deles pra saber a causa da revisita" (Emanuel, 11/11) */}
      <div className="sobe sobe-1 grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
        {d.janelas && <JanelaPorArea celulas={d.janelas} variosDias={variosDias}
          className={r30 ? 'lg:col-span-2 xl:col-span-5' : 'lg:col-span-2 xl:col-span-8'} />}
        {r30 && <CausaRevisita30 r={r30} filtro={filtroRev} aoFiltrar={setFiltroRev}
          className="xl:col-span-4" />}
        {d.certidao && <CertidaoVT c={d.certidao} className={r30 ? 'xl:col-span-3' : 'xl:col-span-4'} />}
      </div>
      {filtroRev && r30 && (
        <ListaRevisita30 itens={r30.lista.filter(i => passaFiltroRev(filtroRev, i))}
          titulo={`Revisita 30 D · ${filtroRev.titulo}`} aoFechar={() => setFiltroRev(null)} />
      )}

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
    </VariosDiasCtx.Provider>
    </ContratosCtx.Provider>
  )
}

// ================================================ 257: equipes atrasadas --
/** A hora de Manaus agora ("HH:MM") — o fuso da régua é o do banco, não o do navegador. */
const horaManaus = () => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date())
/** O último marco que já passou hoje; nulo antes do primeiro. */
function marcoAtual(marcos: { k: number; hora: string }[]) {
  const agora = horaManaus()
  return [...marcos].reverse().find(m => m.hora <= agora) ?? null
}

/**
 * As equipes de VT contra a régua do Emanuel (257, D-372): uma linha por equipe-dia,
 * com cada marco pintado — verde em dia, vermelho abaixo, apagado o que não passou.
 * Clicar na equipe abre os contratos dela com a hora em que o TOA encerrou cada um.
 */
function ListaAtraso({ a, aoFechar }: { a: NonNullable<DadosVT['atraso']>; aoFechar: () => void }) {
  type Filtro = 'AGORA' | 'ATRASOU' | 'EM_DIA'
  const variosDias = useContext(VariosDiasCtx)
  const [so, setSo] = useState<Filtro | null>(a.hoje_no_periodo && a.atrasadas_agora > 0 ? 'AGORA' : 'ATRASOU')
  const [aberta, setAberta] = useState<string | null>(null)
  const chave = (i: ItemAtraso) => `${i.equipe_id}|${i.dia}`
  const passa = (f: Filtro | null, i: ItemAtraso) => f == null ? true
    : f === 'AGORA' ? i.atrasada_agora : f === 'ATRASOU' ? i.atrasados > 0 : i.passados > 0 && i.atrasados === 0
  const opcoes = ([
    ...(a.hoje_no_periodo ? [['AGORA', 'Atrasadas agora'] as const] : []),
    ['ATRASOU', 'Atrasaram'] as const, ['EM_DIA', 'Em dia'] as const,
  ]).map(([k, rotulo]) => ({ k: k as Filtro, rotulo, n: a.lista.filter(i => passa(k as Filtro, i)).length }))
  const lista = a.lista.filter(i => passa(so, i))
  const rot = (i: ItemAtraso) => i.codigo ? equipeRotulo(i.codigo, i.nome) : 'Sem equipe'

  return (
    <Detalhe titulo="Equipes de VT na régua" aoFechar={aoFechar}
      contagem={a.marcos.map(m => `${m.hora} ${m.k}º`).join(' · ')}>
      <Chips opcoes={opcoes} valor={so} aoEscolher={setSo} total={a.lista.length} />
      {lista.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-graf-400">Nenhuma equipe neste filtro.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-graf-900 text-left text-[10px] uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Equipe · técnico</th>
                <th className="px-3 py-1.5 text-right font-medium" title="Clientes baixados até agora ÷ VT na agenda do dia">Baixados</th>
                <th className="px-3 py-1.5 font-medium">
                  <span className="flex gap-0.5">
                    {a.marcos.map(m => (
                      <span key={m.k} className="tabular w-9 text-center normal-case tracking-normal">{m.hora}</span>
                    ))}
                  </span>
                </th>
                <th className="px-3 py-1.5 font-medium">Atrasou desde</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(i => {
                const k = chave(i)
                const porK = new Map((i.marcos ?? []).map(m => [m.k, m]))
                return (
                  <FragmentoAtraso key={k} aberta={aberta === k} colunas={4}
                    aoAlternar={() => setAberta(x => x === k ? null : k)}
                    itens={i.itens}
                    celulas={<>
                      <td className="px-3 py-1.5">
                        <span className="block font-medium text-graf-200">{rot(i)}</span>
                        <span className="block text-[10px] text-graf-400">
                          {i.tecnico ?? 'sem técnico'}{variosDias && <> · {curta(i.dia)}</>}
                        </span>
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        <span className="font-semibold text-graf-100">{i.baixados}</span>
                        <span className="text-graf-400">/{i.agenda}</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="flex gap-0.5">
                          {a.marcos.map(m => {
                            const x = porK.get(m.k)
                            const atras = x ? x.baixou < x.deve : false
                            return (
                              <span key={m.k}
                                title={x ? `${m.hora} · devia ${x.deve}, tinha ${x.baixou}` : `${m.hora} · ainda não chegou`}
                                className={`tabular grid h-5 w-9 place-items-center rounded-sm text-[10px] font-semibold ${
                                  x ? 'text-white' : 'bg-graf-800 text-graf-500'}`}
                                style={x ? { background: atras ? COR.naoExecutado : COR.executado } : undefined}>
                                {x ? `${x.baixou}/${x.deve}` : '·'}
                              </span>
                            )
                          })}
                        </span>
                      </td>
                      <td className="tabular px-3 py-1.5">
                        {i.primeiro
                          ? <span style={{ color: COR.naoExecutado }} className="font-semibold">{i.primeiro}</span>
                          : <span className="text-graf-400">{i.passados ? 'em dia' : 'sem marco ainda'}</span>}
                        {i.atrasada_agora && i.deve_agora != null && (
                          <span className="block text-[10px] text-graf-400">agora: devia {i.deve_agora}</span>
                        )}
                      </td>
                    </>} />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Detalhe>
  )
}

/** Uma linha da régua e, aberta, os contratos da equipe com a hora da baixa no TOA. */
function FragmentoAtraso({ celulas, itens, aberta, aoAlternar, colunas }: {
  celulas: ReactNode; itens: ItemAtraso['itens']; aberta: boolean; aoAlternar: () => void; colunas: number
}) {
  return (
    <>
      <tr onClick={aoAlternar} aria-expanded={aberta}
        className={`cursor-pointer border-t border-graf-800/60 hover:bg-graf-900 ${aberta ? 'bg-graf-900' : ''}`}>
        {celulas}
      </tr>
      {aberta && (
        <tr className="bg-graf-900/60">
          <td colSpan={colunas} className="px-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              {itens.map(c => (
                <span key={c.visita_id} className="inline-flex items-center gap-1.5 rounded bg-graf-800 px-2 py-0.5">
                  <LinkContrato to={`/controle/visita/${c.visita_id}`}
                    className="tabular text-af-400 underline underline-offset-2">{c.contrato ?? 'sem contrato'}</LinkContrato>
                  <span className={`tabular text-[10px] ${c.baixa ? 'text-graf-200' : 'text-graf-400'}`}>
                    {c.baixa ?? 'em aberto'}</span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
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
                {!!f.dias && f.dias > 1 && <span className="text-[10px] opacity-80"> · {f.dias} dias</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {sel && (
        <TabelaItens linhas={sel.itens.map(i => ({ id: i.visita_id, contrato: i.contrato, dia: i.dia, cols: [] }))} />
      )}
    </Detalhe>
  )
}

// ==================================================== janela × área --
type CelulaJA = NonNullable<DadosVT['janelas']>[number]
const mediaJA = (c?: { vt_eq: number; equipes: number }) =>
  c && c.equipes ? (c.vt_eq / c.equipes).toFixed(1).replace('.', ',') : null

// 244: "o gráfico (...) tá bem alto, dá pra melhorar" (Emanuel, 10/11) — a célula
// passou a ter UMA linha (VT e a média lado a lado), metade da altura.
function CelulaJanela({ c, total, max }: { c?: CelulaJA; total?: boolean; max: number }) {
  if (!c || c.vt === 0) return <td className="px-2 py-1 text-center text-graf-600">·</td>
  const m = mediaJA(c)
  // A intensidade diz onde está o volume; o número continua escrito.
  const fundo = total ? undefined
    : `color-mix(in srgb, var(--st-execucao) ${Math.round(8 + (c.vt / max) * 32)}%, transparent)`
  return (
    <td className={`whitespace-nowrap rounded-sm px-2 py-1 text-center ${total ? 'bg-graf-900' : ''}`}
      style={fundo ? { background: fundo } : undefined}
      title={`${c.vt} VT · ${c.vt_eq} de equipe de VT, em ${c.equipes} equipe(s)`}>
      <span className={`tabular ${total ? 'font-bold' : 'font-semibold'} text-graf-100`}>{c.vt}</span>
      <span className="tabular ml-1.5 text-[10px] text-graf-300">{m ? `${m}/eq` : '—'}</span>
    </td>
  )
}

function JanelaPorArea({ celulas, className = '', variosDias = false }: {
  celulas: CelulaJA[]; className?: string; variosDias?: boolean
}) {
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
    <Painel dicaLinhas={2} className={className} titulo="VT por janela e área"
      dica={variosDias
        ? 'Em cada célula: as VT do período e a média por equipe-dia de VT com contrato ali.'
        : 'Em cada célula: as VT e a média por equipe de VT com contrato ali.'}
      tabela={<TabelaSimples colunas={['Janela', 'Área', 'VT', 'VT de equipe de VT', variosDias ? 'Equipe-dia de VT' : 'Equipes de VT', 'Média por equipe']}
        linhas={celulas.map(c => [
          c.total_area ? 'Total' : c.janela ?? '—', c.total_janela ? 'Total' : c.area ?? '—',
          c.vt, c.vt_eq, c.equipes, mediaJA(c) ?? '—'])} />}>
      {janelas.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT com ida no período.</p>
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
                  <th scope="row" className="tabular whitespace-nowrap px-2 py-1 text-left font-medium text-graf-200">{j}</th>
                  {areas.map(a => <CelulaJanela key={a} c={mapa.get(chave(j, a))} max={max} />)}
                  <CelulaJanela c={mapa.get(chave(j, null))} total max={max} />
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-2 py-1 text-left font-semibold text-graf-300">Total</th>
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
    <Painel dicaLinhas={2} titulo="Situação por equipe"
      dica="A situação do contrato. Auditar e cancelado pela central ficam fora da conta."
      extra={<span className="tabular text-xs text-graf-400">{n0(tot.concluidos)} de {n0(total)} concluídos</span>}
      tabela={<TabelaSimples colunas={['Equipe', 'Técnico', 'Concluído', 'Aberto', 'Reagendado', 'Cancelado', 'Total']}
        linhas={equipes.map(e => [rot(e), e.tecnico ?? '—', v(e, 'concluidos'), v(e, 'abertos'),
                                  v(e, 'reagendados'), v(e, 'cancelados'), e.total])} />}>
      {equipes.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT na conta no período.</p>
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
    <Painel dicaLinhas={2} titulo="Código de baixa ofensor"
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
          {filtro === 'IMPRODUTIVA' ? 'Nenhum código improdutivo no período.' : 'Nenhum contrato com código de baixa ainda.'}
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
    <Painel dicaLinhas={2} titulo="Revisita · técnico ofensor"
      dica="Quem fez o serviço anterior, concluído há até 30 dias."
      extra={<span className="tabular text-xs text-graf-400">{n0(r.total)} de {n0(volume)} VT</span>}
      tabela={<TabelaSimples colunas={['Equipe do serviço anterior', 'Técnico', 'Revisitas']}
        linhas={r.tecnicos.map(t => [t.equipe ?? '—', quem(t), t.n])} />}>
      {r.tecnicos.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma revisita no período.</p>
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
    <Painel dicaLinhas={2} titulo="Node ofensor"
      dica="Onde a rede gerou mais visita técnica no dia."
      extra={<span className="tabular text-xs text-graf-400">{n0(n.distintos)} nodes</span>}
      tabela={<TabelaSimples colunas={['Node', 'VT', 'Não executadas', 'LOG 3+']}
        linhas={n.lista.map(x => [x.node, x.n, x.nao_executados, x.log3])} />}
      nota={n.sem_node > 0 && <><span className="tabular">{n.sem_node}</span> VT sem node na planilha.</>}>
      {n.lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT com node no período.</p>
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
          {/* 243 (D-355): "mostrar a janela e codigo de baixa a situação do contrato" (Emanuel, 10/11) */}
          {/* Situação e código numa coluna só (como na janela do LOG): o card é estreito,
              e em seis colunas a situação sumia na rolagem lateral. */}
          <TabelaItens cabecalho={['Janela', 'Situação · cód. de baixa']}
            linhas={sel.itens.map(i => ({
              id: i.visita_id, contrato: i.contrato,
              cols: [
                <span className="tabular whitespace-nowrap">
                  {i.janela_inicio ? `${i.janela_inicio.slice(0, 5)}–${i.janela_fim?.slice(0, 5) ?? '?'}` : 'sem janela'}
                </span>,
                <span className="block min-w-28">
                  <span className="text-graf-200">{i.situacao ? situacaoRotulo(i.situacao) : '—'}</span>
                  <span className="block text-[10px] text-graf-400">{i.baixa ?? 'sem código'}</span>
                </span>,
              ],
            }))} />
        </Detalhe>
      )}
    </Painel>
  )
}

// ============================================================= AT1 área --
/**
 * O AT1 por área (244, D-356): era painel próprio; agora abre pelo card do AT1,
 * para o lado do VT por janela e área ficar com a certidão. No período, a
 * projetada é VT ÷ dias × dias do mês ÷ base — a mesma conta do card.
 */
function At1Tabela({ d }: { d: DadosVT }) {
  // Área sem VT e sem base não diz nada hoje: fica fora da lista, não da conta.
  const areas = d.areas.filter(a => a.vt > 0 || a.clientes != null)
  const dias = Math.max(1, d.dias_periodo ?? 1)
  const projV = (a: DadosVT['areas'][number]) =>
    a.clientes ? ((a.vt / dias) * d.dias_mes * 100) / a.clientes : null
  return (
    <div>
      <p className="flex flex-wrap items-center gap-x-3 border-b border-graf-800 px-3 py-1.5 text-[11px] text-graf-400">
        Projetada = VT {dias > 1 ? `÷ ${dias} dias` : 'do dia'} × {d.dias_mes} dias ÷ base.
        <Link to="/controle/configuracoes?aba=clientes"
          className="ml-auto text-af-400 underline-offset-2 hover:underline">base de clientes</Link>
      </p>
      {areas.length === 0 ? (
        <p className="px-3 py-4 text-xs text-graf-400">Nenhuma área com VT ou base cadastrada.</p>
      ) : (
        <div className="overflow-x-auto px-1">
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
                const real = a.clientes ? pct(a.vt, a.clientes, 2) : null
                const pv = projV(a)
                return (
                  <tr key={a.area_id} className="border-b border-graf-800/60">
                    <td className="px-2 py-1.5 text-graf-200" title={a.codigo}>{a.rotulo}</td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {a.clientes != null ? n0(a.clientes) : <span className="text-amber-300">sem base</span>}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right font-semibold">{a.vt}</td>
                    <td className="tabular px-2 py-1.5 text-right">{real ? `${real}%` : <span className="text-graf-400">—</span>}</td>
                    {/* 217: a projetada da área contra a mesma meta do card */}
                    <td className={`tabular px-2 py-1.5 text-right ${pv == null ? ''
                      : pv <= META_AT1 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {pv != null ? `${pv.toFixed(2).replace('.', ',')}%` : <span className="text-graf-400">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
  linhas: { id: string; contrato: string | null; cols: ReactNode[]; dia?: string | null }[]
  /** 241: falso na lista por O.S. (TEC1) — duas O.S. do mesmo contrato não são
   *  "dois na mesma rua", e a ordem da lista é a da classe. */
  agruparRua?: boolean
}) {
  const info = useContext(ContratosCtx)
  const variosDias = useContext(VariosDiasCtx)
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
                  {variosDias && l.dia && <span className="tabular block text-[10px] text-graf-400">{curta(l.dia)}</span>}
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
export const situacaoRotulo = (s: string) =>
  SITUACAO_INFO[s as keyof typeof SITUACAO_INFO]?.label ?? s
const quem = (equipe: string | null, tecnico: string | null) => (
  <>
    {equipe ? `equipe ${equipe}` : <span className="text-graf-400">sem equipe</span>}
    {tecnico && <span className="block text-[10px] text-graf-400">{tecnico}</span>}
  </>
)

/** Botões de filtro de uma lista: "Todos" + um por valor, com a contagem. */
function Chips<K extends string | number>({ opcoes, valor, aoEscolher, total, rotulo }: {
  opcoes: { k: K; rotulo: ReactNode; n: number }[]
  valor: K | null; aoEscolher: (k: K | null) => void; total: number
  /** 252: nome da fileira, quando a lista tem mais de uma */
  rotulo?: string
}) {
  const cls = (on: boolean) => `inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ${on
    ? 'bg-af-600 font-semibold text-white' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-graf-800 px-3 py-2">
      {rotulo && <span className="mr-1 w-36 shrink-0 text-[10px] font-medium uppercase tracking-wide text-graf-400">{rotulo}</span>}
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
        <p className="px-3 py-4 text-xs text-graf-400">Nenhum contrato de VT com LOG acima de 1 no período.</p>
      ) : (<>
        <Chips opcoes={opcoes} valor={so} aoEscolher={setSo} total={itens.length} />
        <TabelaItens cabecalho={['Situação', 'Código de baixa', 'Equipe · técnico']}
          linhas={lista.map(i => ({
            id: i.visita_id, contrato: i.contrato, dia: i.dia,
            cols: [
              <>{situacaoRotulo(i.situacao)}
                {i.central && <span className="block text-[10px] text-graf-400">cancelado pela central</span>}</>,
              // 251 (D-365): "coloque o código de baixa também na parte do log" (Emanuel, 10/11)
              i.baixa ?? <span className="text-graf-400">sem baixa</span>,
              quem(i.equipe, i.tecnico),
            ],
          }))} />
      </>)}
    </Detalhe>
  )
}

// ============================================= D-370: causa da revisita --
/**
 * De onde veio a Revisita 30 D (D-370) — o painel do meio da faixa Carga.
 *
 * > "quero mais um gráfico (...) pra saber a causa da revisita, qual código
 * >  mais gerou a revisita, status que gerou a revisita, e se foi pendente,
 * >  Regular, Irregular, sem medição (...) e qual é a idade dessas revisitas
 * >  conforme o filtro, volta em quanto tempo, 1, 2 dias 3 dias"
 * >  — Emanuel, 11/11
 *
 * Tudo é da VT ANTERIOR — a que gerou a revisita: o código de baixa (TOA; sem
 * ele, AFLINE — o mesmo da lista), a situação em que ela fechou e a validação
 * de sinal do Portal Técnico (rótulo e cor da CLARO, D-330; "Sem medição" = o
 * portal não foi lido para ela). A idade é `dias`, da anterior até a VT de
 * agora — a mesma conta da lista e do card; nada é recontado aqui, só
 * agrupado da lista que o banco devolveu (`revisita_30d_vt`, D-363).
 * A idade vai dia a dia (0 a 30), sem faixa inventada; o corte de 7 dias é o
 * mesmo vermelho/âmbar que a lista já usa.
 */
type DimRev = 'CODIGO' | 'SITUACAO' | 'SINAL'
export interface FiltroRev { dim: DimRev | 'IDADE'; valor: string; titulo: string }
const DIM_REV: { k: DimRev; rotulo: string }[] = [
  { k: 'CODIGO', rotulo: 'Código' }, { k: 'SITUACAO', rotulo: 'Situação' }, { k: 'SINAL', rotulo: 'Sinal' },
]
const SEM_CODIGO = 'Sem código de baixa'
const SEM_MEDICAO = 'Sem medição'
/** quantos códigos aparecem antes de juntar o resto em "Outros" */
const TOPO_CODIGOS = 6

function valorDim(dim: DimRev, i: ItemRev30): string {
  if (dim === 'CODIGO') return i.anterior_baixa ?? SEM_CODIGO
  if (dim === 'SITUACAO') return situacaoRotulo(i.anterior_situacao)
  const k = chaveSinal(i)
  return k === 'SEM_LEITURA' ? SEM_MEDICAO : k
}
const OUTROS = (n: number) => `Outros ${n} códigos`

export function passaFiltroRev(f: FiltroRev, i: ItemRev30): boolean {
  if (f.dim === 'IDADE') return String(i.dias) === f.valor
  if (f.dim === 'CODIGO' && f.valor.startsWith('\u0000')) {
    // "Outros": os códigos fora do topo (a lista vai no próprio valor)
    return f.valor.slice(1).split('\u0000').includes(valorDim('CODIGO', i))
  }
  return valorDim(f.dim, i) === f.valor
}

const haDiasCurto = (n: number) => n === 0 ? 'no mesmo dia' : n === 1 ? '1 dia depois' : `${n} dias depois`

export function CausaRevisita30({ r, filtro, aoFiltrar, className = '',
  titulo = 'Causa da revisita 30 D',
  dica = 'Como fechou a VT anterior — a que gerou a revisita — e em quantos dias voltou.' }: {
  /** a lista da revisita (D-363); D-371 usa o mesmo painel para VT e instalação */
  r: { n: number; lista: ItemRev30[] }
  filtro: FiltroRev | null; aoFiltrar: (f: FiltroRev | null) => void; className?: string
  titulo?: string; dica?: string
}) {
  const [dim, setDim] = useState<DimRev>('CODIGO')
  const itens = r.lista

  // as três contagens de uma vez: o botão de cada aba mostra quem lidera
  const contagens = useMemo(() => {
    const por = (d: DimRev) => {
      const m = new Map<string, { n: number; cor?: string }>()
      for (const i of itens) {
        const k = valorDim(d, i), x = m.get(k)
        m.set(k, { n: (x?.n ?? 0) + 1, cor: x?.cor ?? (d === 'SINAL' ? corSinal(i.anterior_sinal?.cor) : undefined) })
      }
      // o "não sei" vai por último, seja qual for o tamanho (regra 6)
      const fim = (k: string) => (k === SEM_CODIGO || k === SEM_MEDICAO ? 1 : 0)
      return [...m.entries()].sort((a, b) => fim(a[0]) - fim(b[0]) || b[1].n - a[1].n || a[0].localeCompare(b[0]))
    }
    return { CODIGO: por('CODIGO'), SITUACAO: por('SITUACAO'), SINAL: por('SINAL') }
  }, [itens])

  const idade = useMemo(() => {
    const v = Array.from({ length: 31 }, () => 0)
    for (const i of itens) if (i.dias >= 0 && i.dias <= 30) v[i.dias]++
    const ord = itens.map(i => i.dias).sort((a, b) => a - b)
    const mediana = ord.length ? ord[Math.floor((ord.length - 1) / 2)] : null
    return { v, max: Math.max(1, ...v), ate7: ord.filter(x => x <= 7).length, mediana }
  }, [itens])

  // as barras da aba escolhida; no código, o resto vira "Outros N códigos"
  const lista = contagens[dim]
  const semCod = dim === 'CODIGO' ? lista.filter(([k]) => k === SEM_CODIGO) : []
  const comCod = dim === 'CODIGO' ? lista.filter(([k]) => k !== SEM_CODIGO) : lista
  const topo = dim === 'CODIGO' ? comCod.slice(0, TOPO_CODIGOS) : comCod
  const resto = dim === 'CODIGO' ? comCod.slice(TOPO_CODIGOS) : []
  const barras = [
    ...topo.map(([k, x]) => ({ rotulo: k, valor: x.n, cor: x.cor })),
    ...(resto.length ? [{ rotulo: OUTROS(resto.length), valor: resto.reduce((s, [, x]) => s + x.n, 0), cor: undefined }] : []),
    ...semCod.map(([k, x]) => ({ rotulo: k, valor: x.n, cor: 'var(--color-graf-600)' })),
  ]
  const corPadrao = dim === 'SINAL' ? 'var(--color-graf-500)' : COR.atencao

  const clicar = (rot: string) => {
    if (rot === OUTROS(resto.length) && resto.length) {
      const valor = '\u0000' + resto.map(([k]) => k).join('\u0000')
      return aoFiltrar(filtro?.valor === valor ? null : { dim: 'CODIGO', valor, titulo: `outros ${resto.length} códigos da anterior` })
    }
    const rotDim = DIM_REV.find(x => x.k === dim)!.rotulo.toLowerCase()
    aoFiltrar(filtro?.dim === dim && filtro.valor === rot ? null
      : { dim, valor: rot, titulo: `${rotDim} da anterior: ${rot}` })
  }
  const selecionado = filtro && filtro.dim === dim
    ? (filtro.valor.startsWith('\u0000') ? OUTROS(resto.length) : filtro.valor) : null

  const lider = (d: DimRev) => contagens[d].find(([k]) => k !== SEM_CODIGO && k !== SEM_MEDICAO)

  return (
    <Painel dicaLinhas={2} className={className} titulo={titulo} dica={dica}
      extra={<span className="tabular text-xs text-graf-400">{n0(r.n)} revisita(s)</span>}
      tabela={<TabelaSimples colunas={['Análise da anterior', 'Valor', 'Revisitas']}
        linhas={[
          ...DIM_REV.flatMap(x => contagens[x.k].map(([k, y]) => [x.rotulo, k, y.n] as (string | number)[])),
          ...idade.v.flatMap((n, dia) => n ? [['Volta em', haDiasCurto(dia), n]] : []),
        ]} />}>
      {itens.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma VT voltou de outra VT em 30 dias no período.</p>
      ) : (<>
        {/* as três análises: cada aba diz quem lidera, a barra abre os contratos */}
        <div className="mb-2.5 grid grid-cols-3 gap-1" role="tablist" aria-label="Análise da VT anterior">
          {DIM_REV.map(x => {
            const on = dim === x.k, l = lider(x.k)
            return (
              <button key={x.k} type="button" role="tab" aria-selected={on} onClick={() => setDim(x.k)}
                className={`min-w-0 rounded-md px-2 py-1 text-left ring-1 ${on
                  ? 'bg-graf-800 ring-af-600' : 'ring-graf-800 hover:ring-graf-600'}`}>
                <span className={`block text-[10px] font-semibold uppercase tracking-wide ${on ? 'text-graf-100' : 'text-graf-400'}`}>
                  {x.rotulo}</span>
                <span className="block truncate text-[11px] text-graf-300" title={l ? `${l[0]} · ${l[1].n}` : undefined}>
                  {l ? <>{l[0]} <span className="tabular font-semibold text-graf-100">{l[1].n}</span></> : '—'}
                </span>
              </button>
            )
          })}
        </div>
        <BarrasHorizontais dados={barras} cor={corPadrao} parte totalRef={itens.length}
          aoClicar={clicar} selecionado={selecionado} />

        {/* a idade: dia a dia, de 0 (no mesmo dia) a 30 */}
        <div className="mt-3 border-t border-graf-800 pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-graf-400">Volta em quantos dias</p>
            <p className="text-[11px] text-graf-300">
              <span className="tabular font-semibold" style={{ color: COR.naoExecutado }}>{n0(idade.ate7)}</span>
              {' '}em até 7 dias
              {idade.mediana != null && <> · mediana <span className="tabular font-semibold text-graf-100">{idade.mediana}</span> d</>}
            </p>
          </div>
          <div className="mt-1.5 flex h-14 items-end gap-px" role="group" aria-label="Revisitas por dias até voltar">
            {idade.v.map((n, dia) => {
              const on = filtro?.dim === 'IDADE' && filtro.valor === String(dia)
              return (
                <button key={dia} type="button" disabled={n === 0} aria-pressed={on}
                  title={`${haDiasCurto(dia)}: ${n} revisita(s)`}
                  onClick={() => aoFiltrar(on ? null : { dim: 'IDADE', valor: String(dia), titulo: `voltou ${haDiasCurto(dia)}` })}
                  className={`flex h-full min-w-0 flex-1 items-end rounded-t-sm ${n ? 'hover:bg-graf-800' : 'cursor-default'} ${on ? 'bg-graf-800 ring-1 ring-graf-600' : ''}`}>
                  <span className="block w-full rounded-t-sm"
                    style={{ height: n ? `${Math.max(8, (n / idade.max) * 100)}%` : 2,
                             background: n ? (dia <= 7 ? COR.naoExecutado : COR.atencao) : 'var(--color-graf-800)' }} />
                </button>
              )
            })}
          </div>
          {/* o eixo: só os dias que a pergunta pediu (1, 2, 3), a semana e o mês */}
          <div className="tabular relative mt-0.5 h-3 text-[10px] text-graf-400">
            {[0, 1, 2, 3, 7, 15, 30].map(dia => (
              <span key={dia} className="absolute -translate-x-1/2"
                style={{ left: `${((dia + 0.5) / 31) * 100}%` }}>{dia}</span>
            ))}
          </div>
          <p className="mt-0.5 text-[10px] text-graf-400">0 = no mesmo dia · clique numa barra para ver os contratos</p>
        </div>
      </>)}
    </Painel>
  )
}

/**
 * A Revisita 30 D (250, D-363): cada VT que voltou de VT, com a VT de onde ela
 * veio — quando, há quantos dias, como fechou e quem fez. Os botões filtram pela
 * situação da ANTERIOR; "mesmo técnico" separa quem voltou na própria VT.
 */
function ListaRevisita30({ itens, aoFechar, titulo = 'Revisita 30 D · VT que voltou de VT' }: {
  itens: ItemRev30[]; aoFechar: () => void
  /** D-370: aberta pelo painel da causa, diz qual barra foi clicada */
  titulo?: string
}) {
  const [so, setSo] = useState<string | null>(null)
  // 252 (D-366): o segundo filtro — a validação de sinal da anterior
  const [soSinal, setSoSinal] = useState<string | null>(null)
  const mesmo = (i: ItemRev30) => !!i.anterior_tecnico && i.anterior_tecnico === i.tecnico
  const opcoes = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of itens) m.set(i.anterior_situacao, (m.get(i.anterior_situacao) ?? 0) + 1)
    const sits = [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ k, rotulo: <>anterior {situacaoRotulo(k).toLowerCase()}</>, n }))
    const nm = itens.filter(mesmo).length
    return nm ? [...sits, { k: 'MESMO', rotulo: <>mesmo técnico</>, n: nm }] : sits
  }, [itens])
  const opcoesSinal = useMemo(() => {
    const m = new Map<string, { n: number; cor: string | null }>()
    for (const i of itens) {
      const k = chaveSinal(i), x = m.get(k)
      m.set(k, { n: (x?.n ?? 0) + 1, cor: x?.cor ?? i.anterior_sinal?.cor ?? null })
    }
    return [...m.entries()].sort((a, b) => (a[0] === 'SEM_LEITURA' ? 1 : 0) - (b[0] === 'SEM_LEITURA' ? 1 : 0) || b[1].n - a[1].n)
      .map(([k, x]) => ({ k, n: x.n, rotulo: k === 'SEM_LEITURA' ? <>sem leitura do portal</>
        : <><span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: corSinal(x.cor) ?? 'var(--color-graf-500)' }} />{k}</> }))
  }, [itens])
  const lista = (so == null ? itens
    : so === 'MESMO' ? itens.filter(mesmo) : itens.filter(i => i.anterior_situacao === so))
    .filter(i => soSinal == null || chaveSinal(i) === soSinal)
  const haDias = (n: number) => n === 0 ? 'no mesmo dia' : n === 1 ? 'há 1 dia' : `há ${n} dias`
  return (
    <Detalhe titulo={titulo} contagem={`${lista.length} contrato(s)`} aoFechar={aoFechar}>
      {itens.length === 0 ? (
        <p className="px-3 py-4 text-xs text-graf-400">Nenhuma VT voltou de outra VT em 30 dias no período.</p>
      ) : (<>
        <Chips rotulo="Situação da anterior" opcoes={opcoes} valor={so} aoEscolher={setSo} total={itens.length} />
        <Chips rotulo="Validação da anterior" opcoes={opcoesSinal} valor={soSinal} aoEscolher={setSoSinal} total={itens.length} />
        <TabelaItens cabecalho={['Veio da VT de', 'Como a anterior fechou', 'Validação de sinal da anterior', 'Pós-ativo da anterior', 'Quem fez a anterior', 'Agora · com quem está']}
          linhas={lista.map(i => ({
            id: i.visita_id, contrato: i.contrato, dia: i.dia,
            cols: [
              <span className="whitespace-nowrap">
                <LinkContrato to={`/controle/visita/${i.anterior_id}`}
                  className="tabular text-af-400 underline underline-offset-2">{curta(i.anterior_data)}</LinkContrato>
                <span className="tabular block text-[10px] font-semibold"
                  style={{ color: i.dias <= 7 ? COR.naoExecutado : COR.atencao }}>{haDias(i.dias)}</span>
              </span>,
              <>{situacaoRotulo(i.anterior_situacao)}
                {i.anterior_baixa && <span className="block text-[10px] text-graf-400">{i.anterior_baixa}</span>}</>,
              // 252 (D-366): o rótulo e a cor são os do Portal Técnico (D-330), não uma faixa nossa
              i.anterior_sinal ? (
                <span className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 font-medium"
                    style={{ color: corSinal(i.anterior_sinal.cor) }}>
                    <span aria-hidden className="inline-block h-2 w-2 rounded-full"
                      style={{ background: corSinal(i.anterior_sinal.cor) ?? 'var(--color-graf-500)' }} />
                    {i.anterior_sinal.validacao ?? 'sem rótulo'}
                  </span>
                  {i.anterior_sinal.status_os && i.anterior_sinal.status_os.toLowerCase() !== 'finalizada' && (
                    <span className="block text-[10px] text-graf-400"
                      title="Situação da O.S. no portal na última leitura">O.S. {i.anterior_sinal.status_os.toLowerCase()} no portal</span>
                  )}
                  {i.anterior_sinal.inicial && (
                    <span className="block text-[10px] text-graf-400" title="Diagnóstico inicial (antes)">antes: {i.anterior_sinal.inicial}</span>
                  )}
                </span>
              ) : <span className="text-graf-400" title="O Portal Técnico não foi lido para esta VT (a leitura começou em 06/11)">sem leitura do portal</span>,
              // 253 (D-367): "preciso saber na anterior se teve pós ativo ou não, e o que foi informado"
              temPosAtivo(i.anterior_pos)
                ? <SeloPosAtivo pos={i.anterior_pos} comObservacao
                    para={linkPosAtivo(i.anterior_id, i.anterior_data, i.contrato)} />
                : <span className="text-graf-400">sem pós-ativo</span>,
              <>{quem(i.anterior_equipe, i.anterior_tecnico)}
                {mesmo(i) && (
                  <span className="mt-0.5 inline-block rounded bg-amber-900/40 px-1.5 py-px text-[10px] font-semibold
                                   text-amber-200 ring-1 ring-amber-700/50">mesmo técnico</span>
                )}</>,
              // 253: "preciso saber da equipe atual, com quem tá" — a equipe em destaque
              <>{i.equipe
                  ? <span className="font-semibold text-graf-100">equipe {i.equipe}</span>
                  : <span className="text-amber-300">sem equipe</span>}
                {i.tecnico && <span className="block text-[11px] text-graf-200">{i.tecnico}</span>}
                <span className="block text-[10px] text-graf-400">{situacaoRotulo(i.situacao)}</span></>,
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
  id: i.visita_id, contrato: i.contrato, dia: i.dia,
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
        <p className="px-3 py-4 text-xs text-graf-400">Nenhuma O.S. de VT no período.</p>
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
    <Painel dicaLinhas={2} titulo="Sub-falha ofensora"
      dica="O porquê do código: a sub-falha lançada na baixa, por contrato."
      extra={<span className="tabular text-xs text-graf-400">{n0(s.lista.length)} sub-falha(s)</span>}
      tabela={<TabelaSimples colunas={['Sub-falha', 'Contratos']} linhas={s.lista.map(x => [x.sub_falha, x.n])} />}
      nota={(fora > 0 || s.sem_sub_falha > 0) && <>
        {fora > 0 && <>As {LIMITE} maiores; outras <span className="tabular">{fora}</span> na tabela. </>}
        {s.sem_sub_falha > 0 && <><span className="tabular">{s.sem_sub_falha}</span> de{' '}
          <span className="tabular">{s.contratos_com_codigo}</span> contrato(s) com código não têm sub-falha.</>}
      </>}>
      {s.lista.length === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma sub-falha lançada no período.</p>
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
    <Painel dicaLinhas={2} titulo="TEC1 por equipe"
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
            <span style={{ color: COR.executado }} aria-hidden>✓ </span>Nenhuma O.S. perdeu o prazo no período.
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
        <p className="py-6 text-center text-sm text-graf-400">Nenhuma O.S. de VT no período.</p>
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

// =================================================== 244: certidão --
/**
 * A Certidão de Atendimento no painel de VT (244, D-356).
 *
 * > "quero saber se estão validando e não validando e % de validado, e
 * >  depois validado com falha quem está errando" — Emanuel, 10/11
 *
 * A régua é a da 235 (D-344), num lugar só no banco (`classe_certidao`): base =
 * O.S. FINALIZADA no portal; validado = com falha + sem falha (a cor da CLARO).
 * Primeiro o julgamento (% validado e a faixa das três classes); depois QUEM:
 * os técnicos por "com falha" ou por "sem validação", e o clique abre os
 * contratos.
 */
function CertidaoVT({ c, className = '' }: { c: DadosCertidao; className?: string }) {
  const [modo, setModo] = useState<'COM_FALHA' | 'SEM_VALIDACAO'>('COM_FALHA')
  const [aberto, setAberto] = useState<string | null>(null)
  const validados = c.regular + c.com_falha
  const pVal = pct(validados, c.finalizados)
  const campo = modo === 'COM_FALHA' ? 'com_falha' : 'sem_validacao'
  const chave = (t: DadosCertidao['tecnicos'][number]) => t.tecnico_id ?? 'sem'
  const nome = (t: DadosCertidao['tecnicos'][number]) => t.tecnico ?? 'Sem técnico'
  const lista = c.tecnicos.filter(t => t[campo] > 0)
    .sort((a, b) => b[campo] - a[campo] || nome(a).localeCompare(nome(b)))
  const sel = lista.find(t => chave(t) === aberto) ?? null
  const fatias = [
    { k: 'regular', rotulo: 'Validado sem falha', n: c.regular, cor: COR.executado },
    { k: 'com_falha', rotulo: 'Validado com falha', n: c.com_falha, cor: COR.naoExecutado },
    { k: 'sem_validacao', rotulo: 'Sem validação', n: c.sem_validacao, cor: COR.atencao },
  ]

  return (
    <Painel dicaLinhas={2} className={className} titulo="Certidão de atendimento"
      dica="Validação do Portal Técnico da Claro, sobre as O.S. finalizadas no portal. Validado = com e sem falha."
      extra={<span className="tabular text-xs text-graf-400">{n0(c.finalizados)} finalizada(s)</span>}
      tabela={<TabelaSimples colunas={['Técnico', 'Equipe', 'Finalizadas', 'Sem falha', 'Com falha', 'Sem validação', '% validado']}
        linhas={c.tecnicos.map(t => [nome(t), t.equipe ?? '—', t.finalizados, t.regular, t.com_falha,
          t.sem_validacao, `${pct(t.regular + t.com_falha, t.finalizados) ?? '—'}%`])} />}>
      {c.finalizados === 0 ? (
        <p className="py-6 text-center text-sm text-graf-400">
          Nenhuma O.S. de VT finalizada no portal no período.
        </p>
      ) : (<>
        {/* o julgamento */}
        <div className="flex items-baseline gap-2">
          <span className="tabular text-3xl font-bold leading-none">{pVal}</span>
          <span className="text-base font-semibold text-graf-400">%</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-graf-300">validado</span>
        </div>
        <p className="mt-1 text-[11px] text-graf-400">
          <span className="tabular font-semibold text-graf-300">{n0(validados)}</span> de{' '}
          <span className="tabular">{n0(c.finalizados)}</span> finalizadas ·{' '}
          <span className="tabular font-semibold text-graf-300">{n0(c.sem_validacao)}</span> sem validação
        </p>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-sm bg-graf-800" aria-hidden>
          {fatias.map(f => f.n > 0 && (
            <span key={f.k} style={{ width: `${(f.n * 100) / c.finalizados}%`, background: f.cor }} />
          ))}
        </div>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-graf-300">
          {fatias.map(f => (
            <li key={f.k} className="flex items-center gap-1">
              <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: f.cor }} />
              {f.rotulo} <span className="tabular font-semibold">{f.n}</span>
              <span className="tabular text-graf-400">({pct(f.n, c.finalizados, 0)}%)</span>
            </li>
          ))}
        </ul>

        {/* quem */}
        <div className="mt-3 flex items-center gap-2 border-t border-graf-800 pt-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-graf-200">Quem</span>
          <div className="ml-auto flex rounded-md bg-graf-900 p-0.5" role="group" aria-label="Qual lista">
            {([['COM_FALHA', 'Com falha', c.com_falha], ['SEM_VALIDACAO', 'Sem validação', c.sem_validacao]] as const)
              .map(([k, r, n]) => (
                <button key={k} type="button" aria-pressed={modo === k}
                  onClick={() => { setModo(k); setAberto(null) }}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    modo === k ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                  {r} <span className="tabular opacity-80">{n}</span>
                </button>
              ))}
          </div>
        </div>
        <div className="mt-2">
          {lista.length === 0 ? (
            <p className="py-3 text-center text-xs text-graf-400">
              {modo === 'COM_FALHA' ? 'Ninguém validou com falha no período.' : 'Toda O.S. finalizada foi validada.'}
            </p>
          ) : (
            <BarrasHorizontais rotuloLargo cor={modo === 'COM_FALHA' ? COR.naoExecutado : COR.atencao}
              dados={lista.slice(0, 8).map(t => ({
                rotulo: nome(t), sub: t.equipe ? `equipe ${t.equipe} · ${t.finalizados} finalizada(s)` : `${t.finalizados} finalizada(s)`,
                valor: t[campo],
              }))}
              aoClicar={r => {
                const t = lista.find(x => nome(x) === r)
                setAberto(a => (t && a !== chave(t) ? chave(t) : null))
              }}
              selecionado={sel ? nome(sel) : null} />
          )}
          {lista.length > 8 && (
            <p className="mt-1 text-[11px] text-graf-400">Os 8 maiores; os outros {lista.length - 8} em "Ver tabela".</p>
          )}
        </div>
      </>)}
      {sel && (
        <Detalhe titulo={nome(sel)} contagem={`${sel[campo]} contrato(s)`} aoFechar={() => setAberto(null)}>
          <TabelaItens cabecalho={['Certidão']}
            linhas={sel.itens.filter(i => i.classe === modo).map(i => ({
              id: i.visita_id, contrato: i.contrato, dia: i.dia,
              cols: [i.classe === 'COM_FALHA'
                ? <span style={{ color: COR.naoExecutado }}>com falha</span>
                : <span className="text-amber-300">sem validação</span>],
            }))} />
        </Detalhe>
      )}
    </Painel>
  )
}
