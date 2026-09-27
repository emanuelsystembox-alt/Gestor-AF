import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PainelCercas, SELECT_CERCA, type Cerca, type EdicaoCerca } from '../components/Cercas'
import { supabase, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { equipeRotulo, isoLocal } from '../lib/formato'
import { Shell } from '../components/Shell'
import { Alerta, Avatar, Pill, Vazio } from '../components/ui'
import { BotaoAtualizar } from '../components/BotaoAtualizar'
import { SeloLocal } from '../components/TabelaContratos'
import { useTema } from '../lib/tema'
import {
  aoFalharAutenticacao, autenticacaoFalhou, carregarMapaGoogle, temChaveDoMapa,
} from '../lib/mapaGoogle'
import {
  carregarLocais, metrosEntre, textoDistancia, type LocalBaixa,
} from '../lib/localBaixa'

/**
 * A central de monitoramento (096).
 *
 * ┌─ O PEDIDO ────────────────────────────────────────────────────────┐
 * │ > "na nossa central de monitoramento gps, precisamos saber onde   │
 * │ >  está cada técnico, técnicos próximos, trilha, informações de   │
 * │ >  monitoramento […] explore se necessário da concorrente também  │
 * │ >  pra pegar algumas coisas que não temos e fazer melhor"          │
 * │ >  "quando formos olhar no mapa a trilha dele, pegarmos ele no ato │
 * │ >  se estiver fazendo algo de errado" — Emanuel, 27/09             │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ DO CONCORRENTE, E O QUE FIZEMOS DIFERENTE ───────────────────────┐
 * │ O "Monitoramento App" do ngestor tem Status Técnicos, Caminho     │
 * │ percorrido (usuário, placa, geocerca, última localização,         │
 * │ distância percorrida, trajeto) e Código de Baixa (docs/07 §4).    │
 * │ Trouxemos os três, e acrescentamos o que lá não existe:           │
 * │  · o BURACO na trilha tem nome — "app fechado" (ele saiu do app)  │
 * │    é diferente de "sem sinal" (o celular parou de mandar);        │
 * │  · PARADAS longe de qualquer contrato, com hora e duração;        │
 * │  · cada baixa com a distância do endereço e o raio desenhado;     │
 * │  · o REPLAY: arrastar a hora e ver onde ele estava;               │
 * │  · técnicos PRÓXIMOS de um técnico ou de um contrato (despacho).  │
 * │ Geocerca e garagens ficaram de fora: são regra de negócio (qual   │
 * │ cerca, qual garagem, o que acontece ao sair) que ninguém definiu. │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * LGPD: localização de empregado é dado pessoal. O RLS só mostra o
 * rastro de técnico de equipe visível, e só para a gestão (096); o
 * técnico sabe que é registrado (aviso na Agenda do app) e o rastro
 * para no fim da rota.
 */

// ---------------------------------------------------------------------------
// tipos
// ---------------------------------------------------------------------------
interface TecMonitor {
  tecnico_id: string
  nome: string
  matricula: string
  equipe_id: string | null
  equipe_codigo: string | null
  equipe_nome: string | null
  placa: string | null
  pontos: number
  primeiro_em: string | null
  ultimo_em: string | null
  ultimo_lat: number | null
  ultimo_lng: number | null
  ultimo_precisao: number | null
  ultimo_motivo: string | null
  bateria: number | null
  km: number
  contrato_ativo: string | null
  situacao_ativa: Situacao | null
  visita_ativa: string | null
  contratos: number
  encerrados: number
  baixas_campo: number
  baixas_fora: number
  /** 097: o estado do GPS no servidor, e desde quando. */
  gps_estado: 'NORMAL' | 'SIMULADO' | 'DESLIGADO' | 'SEM_PERMISSAO'
  gps_desde: string | null
  aparelho_modificado: boolean
  /** Quando deu ciência do aviso de rastro (097). Nulo = ainda não deu. */
  ciencia_em: string | null
  /** Áreas (com aviso ao sair) de onde ele está FORA agora. */
  fora_de_area: string | null
  /** Garagens onde ele está DENTRO agora. */
  na_garagem: string | null
  alertas_gps: number
}

/** Um evento da linha do dia: cerca (entrou/saiu) ou GPS (097). */
interface EventoDia {
  em: string
  tipo: string
  texto: string
  grave: boolean
}

interface PontoRastro {
  id: number
  capturado_em: string
  lat: number
  lng: number
  precisao_m: number | null
  velocidade_ms: number | null
  bateria: number | null
  motivo: string
}

interface ContratoMapa {
  id: string
  contrato: string | null
  bairro: string | null
  situacao: Situacao
  janela_inicio: string | null
  janela_fim: string | null
  lat: number | null
  lng: number | null
  equipe_id: string | null
  tecnico_responsavel_id: string | null
  equipe: { codigo: string; nome: string } | null
}

type Estado = 'VIVO' | 'SEM_SINAL' | 'APP_FECHADO' | 'ENCERROU' | 'NUNCA' | 'DIA_PASSADO'
  | 'GPS_SIMULADO' | 'GPS_DESLIGADO'

// ---------------------------------------------------------------------------
// o que a tela deduz — e diz que deduz
// ---------------------------------------------------------------------------
/**
 * Sem ponto há mais de 10 min = "sem sinal". Não é regra de negócio:
 * sai da regra de captura do app (um ponto a cada 2 a 5 min, 096), e 10
 * min é o dobro do maior intervalo — dois pontos perdidos seguidos.
 */
const SEM_SINAL_MIN = 10
/** Uma "parada": 15 min ou mais dentro de 50 m. Leitura da trilha, não
 *  infração — a tela mostra onde foi e o contrato mais perto. */
const PARADA_MIN = 15
const PARADA_M = 50

const COR_ESTADO: Record<Estado, string> = {
  VIVO: '#10b981', SEM_SINAL: '#f59e0b', APP_FECHADO: '#f97316',
  ENCERROU: '#64748b', NUNCA: '#94a3b8', DIA_PASSADO: '#38bdf8',
  GPS_SIMULADO: '#be123c', GPS_DESLIGADO: '#7c2d12',
}
const ROTULO_ESTADO: Record<Estado, string> = {
  VIVO: 'com sinal', SEM_SINAL: 'sem sinal', APP_FECHADO: 'app fechado',
  ENCERROU: 'rota encerrada', NUNCA: 'sem sinal hoje', DIA_PASSADO: 'último ponto',
  GPS_SIMULADO: 'GPS simulado', GPS_DESLIGADO: 'GPS desligado',
}

/**
 * O mapa pinta de dois jeitos. Por SINAL (o celular está mandando?) e
 * por TRABALHO — a legenda do concorrente (Deslogado, Ocioso, Em
 * deslocamento, Em execução). O "ocioso" NÃO é regra nova: é o da tela
 * de Equipes (D-026), lido de `painel_equipes` — uma regra, um lugar.
 */
type Trabalho = 'EM_EXECUCAO' | 'EM_DESLOCAMENTO' | 'OCIOSO' | 'SEM_ANDAMENTO'
const COR_TRABALHO: Record<Trabalho, string> = {
  EM_EXECUCAO: '#16a34a', EM_DESLOCAMENTO: '#0ea5e9', OCIOSO: '#dc2626', SEM_ANDAMENTO: '#64748b',
}
const ROTULO_TRABALHO: Record<Trabalho, string> = {
  EM_EXECUCAO: 'em execução', EM_DESLOCAMENTO: 'em deslocamento',
  OCIOSO: 'ocioso (D-026)', SEM_ANDAMENTO: 'nada em andamento',
}
function trabalhoDo(t: TecMonitor, ociosas: Set<string>): Trabalho {
  if (t.situacao_ativa === 'EM_EXECUCAO') return 'EM_EXECUCAO'
  if (t.situacao_ativa === 'EM_DESLOCAMENTO') return 'EM_DESLOCAMENTO'
  if (t.equipe_id && ociosas.has(t.equipe_id)) return 'OCIOSO'
  return 'SEM_ANDAMENTO'
}

function estadoDo(t: TecMonitor, ehHoje: boolean, agora: number): Estado {
  // 097: o que o servidor sabe do GPS vem antes do que o ponto diz.
  if (ehHoje && t.gps_estado === 'SIMULADO') return 'GPS_SIMULADO'
  if (ehHoje && (t.gps_estado === 'DESLIGADO' || t.gps_estado === 'SEM_PERMISSAO')) return 'GPS_DESLIGADO'
  if (!t.ultimo_em) return 'NUNCA'
  if (!ehHoje) return 'DIA_PASSADO'
  if (t.ultimo_motivo === 'ENCERROU') return 'ENCERROU'
  if (t.ultimo_motivo === 'SAIU') return 'APP_FECHADO'
  const min = (agora - new Date(t.ultimo_em).getTime()) / 60000
  return min > SEM_SINAL_MIN ? 'SEM_SINAL' : 'VIVO'
}

const hhmm = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

function haQuanto(ts: string | null, agora: number): string {
  if (!ts) return '—'
  const min = Math.floor((agora - new Date(ts).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

interface Buraco { de: string; ate: string; min: number; tipo: 'APP_FECHADO' | 'SEM_SINAL' | 'ENCERROU' }
interface Parada { de: string; ate: string; min: number; lat: number; lng: number
                   perto: { contrato: string | null; m: number } | null }

/** Lê a trilha: onde ela tem buraco e onde ele ficou parado. */
function lerTrilha(p: PontoRastro[], contratos: ContratoMapa[]) {
  const buracos: Buraco[] = []
  for (let i = 1; i < p.length; i++) {
    const min = (new Date(p[i].capturado_em).getTime() - new Date(p[i - 1].capturado_em).getTime()) / 60000
    if (min > SEM_SINAL_MIN) {
      const m = p[i - 1].motivo
      buracos.push({
        de: p[i - 1].capturado_em, ate: p[i].capturado_em, min: Math.round(min),
        tipo: m === 'SAIU' ? 'APP_FECHADO' : m === 'ENCERROU' ? 'ENCERROU' : 'SEM_SINAL',
      })
    }
  }

  const paradas: Parada[] = []
  let i = 0
  while (i < p.length) {
    let j = i
    while (j + 1 < p.length && metrosEntre(p[i].lat, p[i].lng, p[j + 1].lat, p[j + 1].lng) <= PARADA_M) j++
    const min = (new Date(p[j].capturado_em).getTime() - new Date(p[i].capturado_em).getTime()) / 60000
    if (j > i && min >= PARADA_MIN) {
      const grupo = p.slice(i, j + 1)
      const lat = grupo.reduce((s, x) => s + x.lat, 0) / grupo.length
      const lng = grupo.reduce((s, x) => s + x.lng, 0) / grupo.length
      let perto: Parada['perto'] = null
      for (const c of contratos) {
        if (c.lat == null || c.lng == null) continue
        const m = metrosEntre(lat, lng, Number(c.lat), Number(c.lng))
        if (!perto || m < perto.m) perto = { contrato: c.contrato, m }
      }
      paradas.push({ de: p[i].capturado_em, ate: p[j].capturado_em, min: Math.round(min), lat, lng, perto })
      i = j + 1
    } else i++
  }
  return { buracos, paradas }
}

// ---------------------------------------------------------------------------
// a página
// ---------------------------------------------------------------------------
export default function Monitor() {
  const [data, setData] = useState(isoLocal())
  const ehHoje = data === isoLocal()
  const [tecnicos, setTecnicos] = useState<TecMonitor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null)
  const [versao, setVersao] = useState(0)
  const [agora, setAgora] = useState(Date.now())
  const [busca, setBusca] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<Estado | 'TODOS'>('TODOS')

  // o selecionado
  const [sel, setSel] = useState<string | null>(null)
  const [trilha, setTrilha] = useState<PontoRastro[]>([])
  const [contratosDele, setContratosDele] = useState<ContratoMapa[]>([])
  const [locais, setLocais] = useState<Map<string, LocalBaixa>>(new Map())
  const [replay, setReplay] = useState<number | null>(null)

  // próximos
  const [refContrato, setRefContrato] = useState<string>('')
  const [contratosDia, setContratosDia] = useState<ContratoMapa[] | null>(null)

  // 097: cercas e garagens
  const [cercas, setCercas] = useState<Cerca[]>([])
  const [editando, setEditando] = useState<EdicaoCerca | null>(null)
  const [mapaOk, setMapaOk] = useState(false)
  const [eventosDia, setEventosDia] = useState<EventoDia[]>([])
  const [params] = useSearchParams()

  const pedido = useRef(0)
  const [corPor, setCorPor] = useState<'SINAL' | 'TRABALHO'>('SINAL')
  /** Equipes ociosas pela regra da tela de Equipes (D-026). Só hoje. */
  const [ociosas, setOciosas] = useState<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    const meu = ++pedido.current
    setCarregando(true); setErro(null)
    const [r, p, c] = await Promise.all([
      supabase.rpc('monitor_tecnicos', { p_data: data }),
      supabase.rpc('painel_equipes', { p_data: data }),
      supabase.from('cerca').select(SELECT_CERCA).is('arquivado_em', null).order('nome'),
    ])
    if (meu !== pedido.current) return
    setCercas((c.data ?? []) as unknown as Cerca[])
    const { data: d, error } = r
    setOciosas(new Set(((p.data ?? []) as { equipe_id: string; ocioso: boolean | null }[])
      .filter(x => x.ocioso).map(x => x.equipe_id)))
    if (error) setErro(error.message)
    else setTecnicos((d ?? []) as TecMonitor[])
    setCarregando(false)
    setAtualizadoEm(new Date())
    setAgora(Date.now())
  }, [data])

  useEffect(() => { carregar() }, [carregar, versao])

  // Hoje, a central se atualiza sozinha a cada minuto: o ponto do
  // celular chega de 2 em 2 min, e olhar um mapa de 10 min atrás é
  // olhar o passado achando que é o presente.
  useEffect(() => {
    if (!ehHoje) return
    const t = setInterval(() => setVersao(v => v + 1), 60_000)
    return () => clearInterval(t)
  }, [ehHoje])

  // Trocar de dia limpa a seleção: a trilha é de um dia só.
  useEffect(() => { setSel(null); setContratosDia(null); setRefContrato('') }, [data])

  // O sino (GPS, cerca) abre o técnico já selecionado.
  const pedidoUrl = params.get('tecnico')
  useEffect(() => {
    if (pedidoUrl && tecnicos.some(t => t.tecnico_id === pedidoUrl)) setSel(pedidoUrl)
  }, [pedidoUrl, tecnicos.length > 0])  // eslint-disable-line react-hooks/exhaustive-deps

  const selecionado = tecnicos.find(t => t.tecnico_id === sel) ?? null

  // 097: a linha do dia dele — cerca e GPS.
  useEffect(() => {
    if (!selecionado) { setEventosDia([]); return }
    let vivo = true
    const ini = new Date(`${data}T00:00:00-04:00`).toISOString()
    const fim = new Date(new Date(`${data}T00:00:00-04:00`).getTime() + 86400000).toISOString()
    Promise.all([
      supabase.from('cerca_evento').select('tipo, em, alerta, cerca:cerca_id ( nome, tipo )')
        .eq('tecnico_id', selecionado.tecnico_id).gte('em', ini).lt('em', fim).order('em'),
      supabase.from('gps_alerta').select('tipo, em, detalhe')
        .eq('tecnico_id', selecionado.tecnico_id).gte('em', ini).lt('em', fim).order('em'),
    ]).then(([ce, ga]) => {
      if (!vivo) return
      const l: EventoDia[] = []
      for (const x of (ce.data ?? []) as unknown as { tipo: string; em: string; alerta: boolean
                                                      cerca: { nome: string; tipo: string } | null }[]) {
        const onde = x.cerca ? `${x.cerca.tipo === 'GARAGEM' ? 'da garagem' : 'da área'} "${x.cerca.nome}"` : 'da cerca'
        l.push({ em: x.em, tipo: 'CERCA', texto: `${x.tipo === 'SAIU' ? 'saiu' : 'entrou'} ${onde}`,
                 grave: x.alerta && x.tipo === 'SAIU' })
      }
      const ROT: Record<string, string> = {
        SIMULADO: 'localização simulada', DESLIGADO: 'GPS desligado', SEM_PERMISSAO: 'localização negada',
        NORMALIZADO: 'GPS voltou ao normal', SALTO: 'salto de posição', APARELHO_MODIFICADO: 'aparelho modificado (root)',
      }
      for (const x of (ga.data ?? []) as { tipo: string; em: string; detalhe: string | null }[]) {
        l.push({ em: x.em, tipo: 'GPS', texto: [ROT[x.tipo] ?? x.tipo, x.detalhe].filter(Boolean).join(' · '),
                 grave: x.tipo !== 'NORMALIZADO' })
      }
      setEventosDia(l)
    })
    return () => { vivo = false }
  }, [selecionado?.tecnico_id, data, versao])

  // A trilha do selecionado, os contratos dele e onde baixou cada um.
  useEffect(() => {
    if (!selecionado) { setTrilha([]); setContratosDele([]); setLocais(new Map()); return }
    let vivo = true
    const ini = new Date(`${data}T00:00:00-04:00`).toISOString()
    const fim = new Date(new Date(`${data}T00:00:00-04:00`).getTime() + 86400000).toISOString()
    ;(async () => {
      const [r, c] = await Promise.all([
        supabase.from('rastro_ponto')
          .select('id, capturado_em, lat, lng, precisao_m, velocidade_ms, bateria, motivo')
          .eq('tecnico_id', selecionado.tecnico_id)
          .gte('capturado_em', ini).lt('capturado_em', fim)
          .order('capturado_em').limit(5000),
        selecionado.equipe_id
          ? supabase.from('visita')
              .select(`id, contrato, bairro, situacao, janela_inicio, janela_fim, lat, lng,
                       equipe_id, tecnico_responsavel_id, equipe:equipe_id ( codigo, nome ),
                       tipo_atividade:tipo_atividade_id ( natureza )`)
              .eq('data_agendada', data).eq('equipe_id', selecionado.equipe_id)
              .is('excluido_em', null)
              .order('janela_inicio', { nullsFirst: false })
          : Promise.resolve({ data: [], error: null }),
      ])
      if (!vivo) return
      if (r.error) setErro(r.error.message)
      setTrilha(((r.data ?? []) as PontoRastro[]).map(x => ({ ...x, lat: Number(x.lat), lng: Number(x.lng) })))
      // Os contratos DELE: o responsável, ou — sem responsável — a equipe.
      const cs = ((c.data ?? []) as unknown as (ContratoMapa & { tipo_atividade: { natureza: string } | null })[])
        .filter(x => x.tipo_atividade?.natureza !== 'JORNADA')
        .filter(x => x.tecnico_responsavel_id === selecionado.tecnico_id || !x.tecnico_responsavel_id)
      setContratosDele(cs)
      setReplay(null)
      try { const m = await carregarLocais(cs.map(x => x.id)); if (vivo) setLocais(m) } catch { /* sem local */ }
    })()
    return () => { vivo = false }
    // `versao` recarrega a trilha junto com a lista (a cada minuto, hoje).
  }, [selecionado?.tecnico_id, selecionado?.equipe_id, data, versao])

  // Contratos do dia inteiro, para "quem está mais perto deste contrato".
  async function abrirProximosDeContrato() {
    if (contratosDia) return
    const { data: d } = await supabase.from('visita')
      .select(`id, contrato, bairro, situacao, janela_inicio, janela_fim, lat, lng,
               equipe_id, tecnico_responsavel_id, equipe:equipe_id ( codigo, nome )`)
      .eq('data_agendada', data).is('excluido_em', null).not('lat', 'is', null)
      .order('contrato')
    setContratosDia((d ?? []) as unknown as ContratoMapa[])
  }

  const comEstado = useMemo(
    () => tecnicos.map(t => ({ t, e: estadoDo(t, ehHoje, agora) })),
    [tecnicos, ehHoje, agora])

  const contagem = useMemo(() => {
    const c: Partial<Record<Estado, number>> = {}
    for (const x of comEstado) c[x.e] = (c[x.e] ?? 0) + 1
    return c
  }, [comEstado])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return comEstado
      .filter(x => filtroEstado === 'TODOS' || x.e === filtroEstado)
      .filter(x => !q || [x.t.nome, x.t.matricula, x.t.equipe_codigo, x.t.placa, x.t.contrato_ativo]
        .some(v => v?.toLowerCase().includes(q)))
      // Os que pedem atenção primeiro: sem sinal, app fechado, baixa fora.
      .sort((a, b) => {
        const peso = (x: { t: TecMonitor; e: Estado }) =>
          (x.t.baixas_fora > 0 ? 0 : 10)
          + ({ GPS_SIMULADO: -2, GPS_DESLIGADO: -1, SEM_SINAL: 0, APP_FECHADO: 1, NUNCA: 2, VIVO: 3,
               ENCERROU: 4, DIA_PASSADO: 3 }[x.e])
          + (x.t.fora_de_area ? -1 : 0)
        return peso(a) - peso(b) || a.t.nome.localeCompare(b.t.nome)
      })
  }, [comEstado, filtroEstado, busca])

  const leitura = useMemo(() => lerTrilha(trilha, contratosDele), [trilha, contratosDele])

  // Estável: o mapa guarda em ref, mas a identidade estável evita surpresa.
  const aoMudarDesenho = useCallback((pontos: [number, number][]) =>
    setEditando(e => e ? { ...e, pontos } : e), [])

  // Memorizada: função nova a cada render redesenharia o mapa inteiro a
  // cada movimento do replay.
  const pintura = useMemo(() => corPor === 'SINAL'
    ? {
        corDe: (_t: TecMonitor, e: Estado) => ({ cor: COR_ESTADO[e], rotulo: ROTULO_ESTADO[e] }),
        legenda: (['VIVO', 'SEM_SINAL', 'APP_FECHADO', 'ENCERROU'] as Estado[])
          .map(e => ({ cor: COR_ESTADO[e], rotulo: ROTULO_ESTADO[e] })),
      }
    : {
        corDe: (t: TecMonitor) => {
          const w = trabalhoDo(t, ociosas)
          return { cor: COR_TRABALHO[w], rotulo: ROTULO_TRABALHO[w] }
        },
        legenda: (Object.keys(COR_TRABALHO) as Trabalho[])
          .map(w => ({ cor: COR_TRABALHO[w], rotulo: ROTULO_TRABALHO[w] })),
      }, [corPor, ociosas])

  /** Referência dos "próximos": o contrato escolhido, ou o técnico
   *  selecionado (a última posição dele — ou a do replay). */
  const referencia = useMemo(() => {
    if (refContrato && contratosDia) {
      const c = contratosDia.find(x => x.id === refContrato)
      if (c?.lat != null && c.lng != null) {
        return { lat: Number(c.lat), lng: Number(c.lng), rotulo: `contrato ${c.contrato ?? '—'}`, excluir: null as string | null }
      }
    }
    if (selecionado) {
      const p = replay != null ? trilha[replay] : null
      const lat = p?.lat ?? selecionado.ultimo_lat
      const lng = p?.lng ?? selecionado.ultimo_lng
      if (lat != null && lng != null) {
        return { lat: Number(lat), lng: Number(lng), rotulo: selecionado.nome, excluir: selecionado.tecnico_id }
      }
    }
    return null
  }, [refContrato, contratosDia, selecionado, replay, trilha])

  const proximos = useMemo(() => {
    if (!referencia) return []
    return comEstado
      .filter(x => x.t.tecnico_id !== referencia.excluir && x.t.ultimo_lat != null && x.t.ultimo_lng != null)
      .map(x => ({ ...x, m: metrosEntre(referencia.lat, referencia.lng, Number(x.t.ultimo_lat), Number(x.t.ultimo_lng)) }))
      .sort((a, b) => a.m - b.m)
      .slice(0, 8)
  }, [referencia, comEstado])

  const kmTotal = tecnicos.reduce((s, t) => s + Number(t.km), 0)
  const foraTotal = tecnicos.reduce((s, t) => s + t.baixas_fora, 0)
  const baixasTotal = tecnicos.reduce((s, t) => s + t.baixas_campo, 0)

  return (
    <Shell acoes={
      <div className="flex items-center gap-2">
        <input type="date" value={data} onChange={e => setData(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        <BotaoAtualizar aoAtualizar={() => setVersao(v => v + 1)} carregando={carregando}
          atualizadoEm={atualizadoEm} />
      </div>
    }>
      <div className="space-y-3 p-4">
        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* ====== o dia em números ====== */}
        <section className="card-controle sobe grid grid-cols-2 gap-px overflow-hidden
                            sm:grid-cols-4 xl:grid-cols-8">
          {([
            ['VIVO', 'com sinal agora', `ponto nos últimos ${SEM_SINAL_MIN} min`],
            ['SEM_SINAL', 'sem sinal', `mais de ${SEM_SINAL_MIN} min sem ponto`],
            ['APP_FECHADO', 'app fechado', 'saiu do app e o registro em 2º plano não está ligado'],
            ['NUNCA', 'sem sinal no dia', 'tem contrato, mas nenhum ponto chegou'],
            ['GPS_SIMULADO', 'GPS simulado', 'o celular informou localização simulada — as ações dele estão pausadas'],
            ['GPS_DESLIGADO', 'GPS desligado', 'desligou a localização ou negou a permissão — o app dele está pausado'],
          ] as [Estado, string, string][]).filter(([e]) => ehHoje || e === 'NUNCA').map(([e, r, d]) => (
            <button key={e} onClick={() => setFiltroEstado(filtroEstado === e ? 'TODOS' : e)}
              aria-pressed={filtroEstado === e} title={d}
              className={`bg-graf-900/40 p-3 text-left transition hover:bg-graf-800/60 ${
                filtroEstado === e ? 'ring-2 ring-inset ring-af-500' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: COR_ESTADO[e] }} />
                <span className="tabular text-2xl font-semibold text-graf-100">{contagem[e] ?? 0}</span>
              </div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-graf-400">{r}</div>
            </button>
          ))}
          <div className="bg-graf-900/40 p-3" title="Soma dos trechos medidos pelo GPS. Estimativa: linha reta entre pontos, só trechos com precisão até 100 m.">
            <div className="tabular text-2xl font-semibold text-graf-100">{kmTotal.toFixed(1).replace('.', ',')}</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-graf-400">km estimados</div>
          </div>
          <div className="bg-graf-900/40 p-3" title="Baixas e encerramentos dados pelo celular a mais que o raio do endereço do cliente">
            <div className={`tabular text-2xl font-semibold ${foraTotal ? 'text-af-400' : 'text-graf-100'}`}>
              {foraTotal}<span className="text-sm font-normal text-graf-400"> / {baixasTotal}</span>
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wide text-graf-400">baixas fora do raio</div>
          </div>
        </section>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          {/* ====== a lista ====== */}
          <section className="card-controle sobe sobe-2 flex max-h-[46rem] flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-graf-800 p-2.5">
              <input value={busca} onChange={e => setBusca(e.target.value)}
                aria-label="Buscar técnico, equipe, placa ou contrato"
                placeholder="Técnico, equipe, placa, contrato…"
                className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5
                           text-sm outline-none placeholder-graf-500 focus:border-af-500" />
              {filtroEstado !== 'TODOS' && (
                <button onClick={() => setFiltroEstado('TODOS')}
                  className="shrink-0 text-xs text-af-400 underline underline-offset-2">
                  todos
                </button>
              )}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {!carregando && visiveis.length === 0 && (
                <li className="p-4">
                  <Vazio titulo="Ninguém aqui"
                    descricao={tecnicos.length === 0
                      ? 'Nenhum técnico com contrato, sinal ou baixa neste dia. O rastro começa quando o técnico abre o aplicativo logado.'
                      : 'Nenhum técnico passa no filtro.'} />
                </li>
              )}
              {visiveis.map(({ t, e }) => {
                const ativo = sel === t.tecnico_id
                return (
                  <li key={t.tecnico_id}>
                    <button onClick={() => setSel(ativo ? null : t.tecnico_id)} aria-pressed={ativo}
                      className={`flex w-full items-start gap-2.5 border-b border-graf-800/70 px-3 py-2.5
                                  text-left transition hover:bg-graf-800/40 ${ativo ? 'bg-af-900/20' : ''}`}>
                      <div className="relative">
                        <Avatar nome={t.nome} tamanho={32} />
                        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-graf-900 ${
                          e === 'VIVO' ? 'ponto-vivo' : ''}`}
                          style={{ background: COR_ESTADO[e] }} title={ROTULO_ESTADO[e]} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-sm font-medium text-graf-100">{t.nome}</span>
                          <span className="shrink-0 text-[10px] text-graf-400">{t.matricula}</span>
                        </div>
                        <div className="truncate text-[11px] text-graf-400">
                          {t.equipe_codigo ? equipeRotulo(t.equipe_codigo, t.equipe_nome) : 'sem equipe'}
                          {t.placa && <span className="ml-1.5 rounded bg-graf-800 px-1 font-mono text-[10px] text-graf-300">{t.placa}</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                          <span style={{ color: COR_ESTADO[e] }} className="font-semibold">
                            {ROTULO_ESTADO[e]}
                          </span>
                          {t.ultimo_em && (
                            <span className="tabular text-graf-400">
                              {ehHoje ? haQuanto(t.ultimo_em, agora) : hhmm(t.ultimo_em)}
                            </span>
                          )}
                          {t.bateria != null && (
                            <span className={`tabular ${t.bateria <= 15 ? 'font-semibold text-af-400' : 'text-graf-400'}`}
                              title="Bateria do celular no último ponto">
                              🔋{t.bateria}%
                            </span>
                          )}
                          {t.pontos > 0 && (
                            <span className="tabular text-graf-400" title="Estimado pelo GPS">
                              {Number(t.km).toFixed(1).replace('.', ',')} km
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {t.situacao_ativa ? (
                            <>
                              <Pill situacao={t.situacao_ativa} vivo />
                              <span className="tabular text-graf-300">ctt {t.contrato_ativo}</span>
                            </>
                          ) : (
                            <span className="text-graf-400">nenhum contrato em andamento</span>
                          )}
                          <span className="tabular text-graf-400">· {t.encerrados}/{t.contratos} encerrados</span>
                          {t.baixas_fora > 0 && (
                            <span className="rounded bg-af-900/50 px-1 text-[10px] font-semibold uppercase text-af-200"
                              title="Baixas ou encerramentos dados pelo celular fora do raio do endereço">
                              {t.baixas_fora} fora do raio
                            </span>
                          )}
                        </div>
                        {/* 097: cerca, garagem, GPS e ciência */}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                          {t.fora_de_area && (
                            <span className="rounded bg-indigo-900/60 px-1 font-semibold uppercase text-indigo-200"
                              title="Está fora de uma área com aviso ao sair">fora de: {t.fora_de_area}</span>
                          )}
                          {t.na_garagem && (
                            <span className="rounded bg-graf-800 px-1 text-graf-300">na garagem: {t.na_garagem}</span>
                          )}
                          {t.aparelho_modificado && (
                            <span className="rounded bg-rose-900/50 px-1 font-semibold uppercase text-rose-200"
                              title="O aparelho tem root: a marca de localização simulada pode ser escondida">aparelho com root</span>
                          )}
                          {t.alertas_gps > 0 && t.gps_estado === 'NORMAL' && (
                            <span className="rounded bg-graf-800 px-1 text-amber-300"
                              title="Alertas de GPS no dia (simulação, desligado, salto)">{t.alertas_gps} alerta(s) de GPS</span>
                          )}
                          {!t.ciencia_em && (
                            <span className="text-graf-400" title="Ainda não tocou em 'Estou ciente' no aviso de rastro do aplicativo">
                              sem ciência do aviso
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* ====== o mapa ====== */}
          <section className="card-controle sobe sobe-3 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-graf-800 px-3 py-1.5 text-[11px]">
              <span className="text-graf-400">Cor no mapa:</span>
              {(['SINAL', 'TRABALHO'] as const).map(c => (
                <button key={c} onClick={() => setCorPor(c)} aria-pressed={corPor === c}
                  className={`rounded px-2 py-0.5 font-medium ${corPor === c
                    ? 'bg-af-600 text-white' : 'text-graf-300 hover:text-graf-100'}`}>
                  {c === 'SINAL' ? 'sinal do celular' : 'trabalho'}
                </button>
              ))}
              {corPor === 'TRABALHO' && !ehHoje && (
                <span className="text-graf-400">· ocioso só existe no dia de hoje</span>
              )}
            </div>
            <MapaMonitor
              corDe={pintura.corDe}
              legenda={pintura.legenda}
              tecnicos={comEstado}
              selecionado={selecionado}
              trilha={trilha}
              contratos={contratosDele}
              locais={locais}
              paradas={leitura.paradas}
              replay={replay}
              // O técnico selecionado já está marcado; o anel é para o CONTRATO.
              // (Passar sempre redesenharia o mapa a cada passo do replay.)
              referencia={refContrato ? referencia : null}
              aoSelecionar={setSel}
              cercas={cercas}
              desenho={editando}
              aoMudarDesenho={aoMudarDesenho}
              aoMapaPronto={setMapaOk}
            />
            {selecionado && trilha.length > 1 && (
              <div className="border-t border-graf-800 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] uppercase tracking-wide text-graf-400">Replay</span>
                  <input type="range" min={0} max={trilha.length - 1}
                    value={replay ?? trilha.length - 1}
                    onChange={e => setReplay(Number(e.target.value))}
                    aria-label="Arraste para ver onde o técnico estava em cada hora"
                    className="flex-1 accent-af-600" />
                  <span className="tabular w-28 text-right text-sm font-semibold text-graf-100">
                    {hhmm(trilha[replay ?? trilha.length - 1].capturado_em)}
                  </span>
                  {replay != null && (
                    <button onClick={() => setReplay(null)}
                      className="text-xs text-af-400 underline underline-offset-2">agora</button>
                  )}
                </div>
                {replay != null && (() => {
                  const p = trilha[replay]
                  return (
                    <div className="mt-1 text-[11px] text-graf-400">
                      {p.precisao_m != null && `±${Math.round(p.precisao_m)} m · `}
                      {p.velocidade_ms != null && `${Math.round(p.velocidade_ms * 3.6)} km/h · `}
                      {p.bateria != null && `bateria ${p.bateria}% · `}
                      {ROTULO_MOTIVO[p.motivo] ?? p.motivo}
                    </div>
                  )
                })()}
              </div>
            )}
          </section>
        </div>

        {/* ====== cercas e garagens (097) ====== */}
        <PainelCercas cercas={cercas} editando={editando} setEditando={setEditando}
          aoSalvar={() => setVersao(v => v + 1)} temMapa={mapaOk} />

        {/* ====== o detalhe do selecionado ====== */}
        {selecionado && (
          <section className="card-controle sobe grid gap-4 p-4 lg:grid-cols-3">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-400">
                A trilha de {selecionado.nome.split(' ')[0]}
              </h3>
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
                <dt className="text-graf-400">primeiro sinal</dt><dd className="tabular text-graf-200">{hhmm(selecionado.primeiro_em)}</dd>
                <dt className="text-graf-400">último sinal</dt><dd className="tabular text-graf-200">{hhmm(selecionado.ultimo_em)}</dd>
                <dt className="text-graf-400">pontos</dt><dd className="tabular text-graf-200">{selecionado.pontos}</dd>
                <dt className="text-graf-400">km estimados</dt><dd className="tabular text-graf-200">{Number(selecionado.km).toFixed(1).replace('.', ',')}</dd>
                <dt className="text-graf-400">placa</dt><dd className="text-graf-200">{selecionado.placa ?? <span className="text-graf-400">sem carro no nome</span>}</dd>
              </dl>
              {trilha.length === 0 && (
                <p className="mt-2 text-xs text-graf-400">
                  Nenhum ponto neste dia. O rastro começa quando ele abre o aplicativo logado
                  (versão com o rastro, 096).
                </p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-400">
                Linha do dia
              </h3>
              {selecionado.gps_estado !== 'NORMAL' && ehHoje && (
                <p className="mb-2 rounded bg-rose-900/40 px-2 py-1.5 text-xs text-rose-200">
                  {selecionado.gps_estado === 'SIMULADO'
                    ? 'Localização simulada ativa: baixa e mudança de status estão travadas no servidor até chegar um ponto real.'
                    : 'GPS desligado ou sem permissão: o aplicativo dele está pausado.'}
                  {selecionado.gps_desde && ` Desde ${hhmm(selecionado.gps_desde)}.`}
                </p>
              )}
              {eventosDia.length > 0 && (
                <ul className="mb-2 space-y-1 text-xs">
                  {[...eventosDia].sort((a, b) => a.em.localeCompare(b.em)).map((ev, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="tabular w-24 shrink-0 text-graf-300">{hhmm(ev.em)}</span>
                      <span className={ev.grave ? (ev.tipo === 'GPS' ? 'text-rose-300' : 'text-indigo-300') : 'text-graf-300'}>
                        {ev.tipo === 'GPS' ? '🛰 ' : '⬡ '}{ev.texto}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {leitura.buracos.length === 0 && leitura.paradas.length === 0 && (
                <p className="text-xs text-graf-400">
                  {trilha.length > 1 ? 'Trilha contínua, sem parada longa.' : '—'}
                </p>
              )}
              <ul className="space-y-1.5 text-xs">
                {[...leitura.buracos.map(b => ({ em: b.de, b, p: null as Parada | null })),
                  ...leitura.paradas.map(p => ({ em: p.de, b: null as Buraco | null, p }))]
                  .sort((a, b) => a.em.localeCompare(b.em))
                  .map(({ b, p }, i) => b ? (
                    <li key={i} className="flex gap-2">
                      <span className="tabular w-24 shrink-0 text-graf-300">{hhmm(b.de)}–{hhmm(b.ate)}</span>
                      <span className={b.tipo === 'APP_FECHADO' ? 'text-orange-400' : 'text-amber-400'}>
                        {b.tipo === 'APP_FECHADO' ? 'app fechado' : b.tipo === 'ENCERROU' ? 'rastro encerrado' : 'sem sinal'}
                        {' '}· {b.min} min
                      </span>
                    </li>
                  ) : p ? (
                    <li key={i} className="flex gap-2">
                      <span className="tabular w-24 shrink-0 text-graf-300">{hhmm(p.de)}–{hhmm(p.ate)}</span>
                      <span className="text-graf-200">
                        parado {p.min} min
                        {p.perto
                          ? <span className={p.perto.m > PARADA_M * 4 ? 'text-af-400' : 'text-graf-400'}>
                              {' '}· a {textoDistancia(p.perto.m)} do ctt {p.perto.contrato ?? '—'}
                            </span>
                          : <span className="text-graf-400"> · sem contrato com coordenada</span>}
                      </span>
                    </li>
                  ) : null)}
              </ul>
              <p className="mt-2 text-[10px] leading-snug text-graf-400">
                Parada = {PARADA_MIN} min ou mais num raio de {PARADA_M} m. Buraco = mais de {SEM_SINAL_MIN} min
                sem ponto. É leitura da trilha, não infração: a tela mostra, quem opera julga.
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-400">
                Contratos do dia · onde baixou
              </h3>
              {contratosDele.length === 0 && <p className="text-xs text-graf-400">Nenhum contrato dele neste dia.</p>}
              <ul className="space-y-1.5">
                {contratosDele.map(c => (
                  <li key={c.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="tabular w-16 text-graf-200">{c.contrato ?? '—'}</span>
                    <Pill situacao={c.situacao} />
                    {locais.get(c.id)
                      ? <SeloLocal local={locais.get(c.id)!} />
                      : <span className="text-graf-400">{c.lat == null ? 'endereço sem coordenada' : 'sem baixa pelo celular'}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ====== técnicos próximos ====== */}
        <section className="card-controle sobe p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-graf-400">
              Técnicos próximos
            </h3>
            <span className="text-xs text-graf-400">de</span>
            <select value={refContrato}
              onFocus={abrirProximosDeContrato}
              onChange={e => setRefContrato(e.target.value)}
              className="max-w-64 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs">
              <option value="">{selecionado ? `${selecionado.nome} (selecionado)` : 'escolha um técnico na lista…'}</option>
              {(contratosDia ?? []).map(c => (
                <option key={c.id} value={c.id}>
                  contrato {c.contrato ?? '—'} · {c.bairro ?? 'sem bairro'} · {SITUACAO_INFO[c.situacao]?.label ?? c.situacao}
                </option>
              ))}
            </select>
            {contratosDia === null && (
              <span className="text-[11px] text-graf-400">(abra a lista para escolher um contrato do dia)</span>
            )}
          </div>
          {!referencia ? (
            <p className="mt-2 text-xs text-graf-400">
              Escolha um técnico na lista ou um contrato: a tela ordena os outros pela distância da
              última posição de cada um — para mandar quem está mais perto.
            </p>
          ) : proximos.length === 0 ? (
            <p className="mt-2 text-xs text-graf-400">Nenhum outro técnico com posição neste dia.</p>
          ) : (
            <ol className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {proximos.map(({ t, e, m }) => (
                <li key={t.tecnico_id}>
                  <button onClick={() => { setSel(t.tecnico_id); setRefContrato('') }}
                    className="flex w-full items-center gap-2 rounded-md border border-graf-800 px-2.5 py-1.5
                               text-left hover:border-af-600">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COR_ESTADO[e] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-graf-100">{t.nome}</span>
                      <span className="block truncate text-[10px] text-graf-400">
                        {t.situacao_ativa ? `${SITUACAO_INFO[t.situacao_ativa]?.label ?? ''} · ` : 'livre · '}
                        {ehHoje ? haQuanto(t.ultimo_em, agora) : hhmm(t.ultimo_em)}
                      </span>
                    </span>
                    <span className="tabular text-sm font-semibold text-graf-200">{textoDistancia(m)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {referencia && (
            <p className="mt-2 text-[10px] text-graf-400">
              Distância em linha reta de {referencia.rotulo} até a última posição de cada técnico.
              Posição velha (veja o "há X min") vale menos que posição de agora.
            </p>
          )}
        </section>
      </div>
    </Shell>
  )
}

const ROTULO_MOTIVO: Record<string, string> = {
  ABRIU: 'abriu o app', PERIODICO: 'app aberto', SEGUNDO_PLANO: 'app em segundo plano',
  SAIU: 'saiu do app', ENCERROU: 'rastro encerrado',
}

// ---------------------------------------------------------------------------
// o mapa
// ---------------------------------------------------------------------------
const RECADO_CHAVE = 'recusou'

function MapaMonitor({ tecnicos, selecionado, trilha, contratos, locais, paradas, replay, referencia,
                       aoSelecionar, corDe, legenda, cercas, desenho, aoMudarDesenho, aoMapaPronto }: {
  cercas: Cerca[]
  desenho: EdicaoCerca | null
  aoMudarDesenho: (pontos: [number, number][]) => void
  aoMapaPronto: (ok: boolean) => void
  corDe: (t: TecMonitor, e: Estado) => { cor: string; rotulo: string }
  legenda: { cor: string; rotulo: string }[]
  tecnicos: { t: TecMonitor; e: Estado }[]
  selecionado: TecMonitor | null
  trilha: PontoRastro[]
  contratos: ContratoMapa[]
  locais: Map<string, LocalBaixa>
  paradas: Parada[]
  replay: number | null
  referencia: { lat: number; lng: number; rotulo: string } | null
  aoSelecionar: (id: string) => void
}) {
  const [tema] = useTema()
  const div = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<google.maps.Map | null>(null)
  const temaDoMapa = useRef<string | null>(null)
  const desenhos = useRef<{ setMap: (m: google.maps.Map | null) => void }[]>([])
  const marcaReplay = useRef<google.maps.Marker | null>(null)
  const enquadrouPara = useRef<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState(false)

  useEffect(() => {
    if (!temChaveDoMapa) return
    let vivo = true
    if (autenticacaoFalhou()) setErro(RECADO_CHAVE)
    const cancelar = aoFalharAutenticacao(() => { if (vivo) setErro(RECADO_CHAVE) })
    carregarMapaGoogle()
      .then(() => { if (vivo) setPronto(true) })
      .catch(() => { if (vivo) setErro('O mapa do Google não carregou (rede).') })
    return () => { vivo = false; cancelar() }
  }, [])

  // `colorScheme` é opção de CONSTRUÇÃO (traps.md): trocar de tema
  // refaz o mapa inteiro.
  useEffect(() => {
    if (!pronto || !div.current) return
    if (mapa.current && temaDoMapa.current === tema) return
    if (mapa.current) {
      for (const d of desenhos.current) d.setMap(null)
      desenhos.current = []
      div.current.innerHTML = ''
    }
    temaDoMapa.current = tema
    enquadrouPara.current = null
    mapa.current = new google.maps.Map(div.current, {
      center: { lat: -3.1, lng: -60.0 }, zoom: 11,
      colorScheme: tema === 'claro' ? 'LIGHT' : 'DARK',
      mapTypeControl: true,
      mapTypeControlOptions: { mapTypeIds: ['roadmap', 'satellite', 'hybrid'] },
      streetViewControl: true, fullscreenControl: true, rotateControl: false,
      gestureHandling: 'cooperative',
    })
    setVersao(v => v + 1)
  }, [pronto, tema])

  // Tudo, menos o marcador do replay (que anda sem redesenhar o resto).
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    for (const d of desenhos.current) d.setMap(null)
    desenhos.current = []
    const info = new google.maps.InfoWindow()
    const limites = new google.maps.LatLngBounds()
    let temLimite = false
    const guarda = <T extends { setMap: (m: google.maps.Map | null) => void }>(d: T) => { desenhos.current.push(d); return d }

    // 1 · onde cada técnico está (a última posição). Com um selecionado,
    //     os outros ficam apagados — continuam lá para o "quem está perto".
    for (const { t, e } of tecnicos) {
      if (t.ultimo_lat == null || t.ultimo_lng == null) continue
      const pos = { lat: Number(t.ultimo_lat), lng: Number(t.ultimo_lng) }
      const eu = selecionado?.tecnico_id === t.tecnico_id
      const apagado = !!selecionado && !eu
      if (!selecionado) { limites.extend(pos); temLimite = true }
      const iniciais = t.nome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('')
      const pinta = corDe(t, e)
      const marca = guarda(new google.maps.Marker({
        position: pos, map: m, zIndex: eu ? 50 : 20,
        title: `${t.nome} · ${pinta.rotulo} · ${ROTULO_ESTADO[e]} ${hhmm(t.ultimo_em)}`,
        label: apagado ? undefined : { text: iniciais, color: '#ffffff', fontSize: '10px', fontWeight: '700' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE, scale: eu ? 13 : 11,
          fillColor: pinta.cor, fillOpacity: apagado ? 0.35 : 1,
          strokeColor: '#ffffff', strokeWeight: eu ? 3 : 1.5,
        },
      }))
      marca.addListener('click', () => {
        aoSelecionar(t.tecnico_id)
        info.setContent(
          `<div style="color:#111;font:500 12px/1.5 system-ui;min-width:12rem">
             <strong style="font-size:13px">${esc(t.nome)}</strong> · ${esc(t.matricula)}<br>
             ${esc(ROTULO_ESTADO[e])} · ${hhmm(t.ultimo_em)}${t.ultimo_precisao != null ? ` · ±${Math.round(t.ultimo_precisao)} m` : ''}<br>
             ${t.contrato_ativo ? `ctt ${esc(t.contrato_ativo)} · ${esc(SITUACAO_INFO[t.situacao_ativa as Situacao]?.label ?? '')}` : 'nenhum contrato em andamento'}
             ${t.placa ? `<br>placa ${esc(t.placa)}` : ''}${t.bateria != null ? ` · bateria ${t.bateria}%` : ''}
           </div>`)
        info.open({ map: m, anchor: marca })
      })
      // A precisão desenhada: ±2 km não é um ponto, é uma nuvem.
      if (!apagado && t.ultimo_precisao != null && t.ultimo_precisao > 30) {
        guarda(new google.maps.Circle({
          map: m, center: pos, radius: t.ultimo_precisao, clickable: false,
          strokeColor: COR_ESTADO[e], strokeOpacity: 0.5, strokeWeight: 1,
          fillColor: COR_ESTADO[e], fillOpacity: 0.08,
        }))
      }
    }

    // 2 · a trilha do selecionado: trechos contínuos cheios, buracos
    //     tracejados (o que não se viu não se desenha como se tivesse visto).
    if (selecionado && trilha.length > 0) {
      let trecho: google.maps.LatLngLiteral[] = []
      const fecha = () => {
        if (trecho.length > 1) {
          guarda(new google.maps.Polyline({
            map: m, path: trecho, strokeColor: '#3b82f6', strokeOpacity: 0.9, strokeWeight: 4,
            icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2.2, strokeColor: '#1d4ed8' }, repeat: '90px' }],
          }))
        }
      }
      for (let i = 0; i < trilha.length; i++) {
        const p = trilha[i]
        const pos = { lat: p.lat, lng: p.lng }
        limites.extend(pos); temLimite = true
        if (i > 0) {
          const min = (new Date(p.capturado_em).getTime() - new Date(trilha[i - 1].capturado_em).getTime()) / 60000
          if (min > SEM_SINAL_MIN) {
            fecha()
            guarda(new google.maps.Polyline({
              map: m, path: [{ lat: trilha[i - 1].lat, lng: trilha[i - 1].lng }, pos],
              strokeOpacity: 0, strokeColor: '#f97316',
              icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '12px' }],
            }))
            trecho = []
          }
        }
        trecho.push(pos)
        const marco = p.motivo === 'ABRIU' || p.motivo === 'SAIU' || p.motivo === 'ENCERROU'
        const ponto = guarda(new google.maps.Marker({
          position: pos, map: m, zIndex: 30,
          title: `${hhmm(p.capturado_em)} · ${ROTULO_MOTIVO[p.motivo] ?? p.motivo}${p.precisao_m != null ? ` · ±${Math.round(p.precisao_m)} m` : ''}`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE, scale: marco ? 5 : 2.5,
            fillColor: p.motivo === 'SAIU' ? '#f97316' : p.motivo === 'ABRIU' ? '#10b981' : '#1d4ed8',
            fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: marco ? 1.5 : 0.5,
          },
        }))
        ponto.addListener('click', () => {
          info.setContent(`<div style="color:#111;font:500 12px/1.5 system-ui">
            <strong>${hhmm(p.capturado_em)}</strong> · ${esc(ROTULO_MOTIVO[p.motivo] ?? p.motivo)}<br>
            ${p.precisao_m != null ? `±${Math.round(p.precisao_m)} m` : 'precisão não informada'}
            ${p.velocidade_ms != null ? ` · ${Math.round(p.velocidade_ms * 3.6)} km/h` : ''}
            ${p.bateria != null ? ` · bateria ${p.bateria}%` : ''}</div>`)
          info.open({ map: m, anchor: ponto })
        })
      }
      fecha()
    }

    // 3 · as paradas
    for (const pa of paradas) {
      const longe = !pa.perto || pa.perto.m > PARADA_M * 4
      const c = guarda(new google.maps.Marker({
        position: { lat: pa.lat, lng: pa.lng }, map: m, zIndex: 40,
        title: `Parado ${pa.min} min · ${hhmm(pa.de)}–${hhmm(pa.ate)}${pa.perto ? ` · a ${textoDistancia(pa.perto.m)} do ctt ${pa.perto.contrato ?? '—'}` : ''}`,
        label: { text: 'P', color: '#ffffff', fontSize: '10px', fontWeight: '800' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE, scale: 9,
          fillColor: longe ? '#dc2626' : '#8b5cf6', fillOpacity: 0.95,
          strokeColor: '#ffffff', strokeWeight: 1.5,
        },
      }))
      c.addListener('click', () => {
        info.setContent(`<div style="color:#111;font:500 12px/1.5 system-ui">
          <strong>Parado ${pa.min} min</strong><br>${hhmm(pa.de)}–${hhmm(pa.ate)}<br>
          ${pa.perto ? `a ${textoDistancia(pa.perto.m)} do contrato ${esc(pa.perto.contrato ?? '—')}` : 'sem contrato com coordenada'}</div>`)
        info.open({ map: m, anchor: c })
      })
    }

    // 4 · os contratos dele, o raio e a linha até onde baixou
    for (const ct of contratos) {
      if (ct.lat == null || ct.lng == null) continue
      const pos = { lat: Number(ct.lat), lng: Number(ct.lng) }
      limites.extend(pos); temLimite = true
      const cor = corParaMapa(SITUACAO_INFO[ct.situacao]?.cor)
      const l = locais.get(ct.id)
      guarda(new google.maps.Marker({
        position: pos, map: m, zIndex: 25,
        title: `ctt ${ct.contrato ?? '—'} · ${ct.bairro ?? ''} · ${SITUACAO_INFO[ct.situacao]?.label ?? ct.situacao}`,
        icon: {
          path: 'M -6,-6 6,-6 6,6 -6,6 z', scale: 1,
          fillColor: cor, fillOpacity: 0.9,
          strokeColor: '#ffffff', strokeWeight: 1.5,
        },
      }))
      if (l) {
        const fora = l.fora_do_raio === true
        guarda(new google.maps.Circle({
          map: m, center: pos, radius: l.raio_m, clickable: false,
          strokeColor: fora ? '#dc2626' : '#10b981', strokeOpacity: 0.8, strokeWeight: 1.5,
          fillColor: fora ? '#dc2626' : '#10b981', fillOpacity: 0.07,
        }))
        const baixa = { lat: Number(l.lat), lng: Number(l.lng) }
        limites.extend(baixa)
        guarda(new google.maps.Polyline({
          map: m, path: [baixa, pos], strokeColor: fora ? '#dc2626' : '#10b981',
          strokeOpacity: 0.9, strokeWeight: 2,
        }))
        guarda(new google.maps.Marker({
          position: baixa, map: m, zIndex: 45,
          title: `Baixa do ctt ${ct.contrato ?? '—'} às ${hhmm(l.em)} · ${textoDistancia(l.distancia_m)} do endereço`
               + `${l.precisao_m != null ? ` (GPS ±${Math.round(Number(l.precisao_m))} m)` : ''}`,
          label: { text: 'B', color: '#ffffff', fontSize: '10px', fontWeight: '800' },
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 6,
            fillColor: fora ? '#dc2626' : '#10b981', fillOpacity: 1,
            strokeColor: '#ffffff', strokeWeight: 1,
          },
        }))
      }
    }

    // 5 · a referência dos "próximos"
    if (referencia) {
      guarda(new google.maps.Marker({
        position: { lat: referencia.lat, lng: referencia.lng }, map: m, zIndex: 60,
        title: `Referência: ${referencia.rotulo}`,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 16, fillOpacity: 0,
                strokeColor: '#e11d48', strokeWeight: 2.5 },
      }))
    }

    // Enquadra uma vez por seleção, não a cada minuto: o controlador que
    // deu zoom num quarteirão não pode ser jogado de volta ao mapa todo.
    const chave = selecionado?.tecnico_id ?? 'todos'
    if (temLimite && enquadrouPara.current !== chave) {
      enquadrouPara.current = chave
      m.fitBounds(limites, 48)
      google.maps.event.addListenerOnce(m, 'idle', () => {
        if ((m.getZoom() ?? 0) > 17) m.setZoom(17)
      })
    }
    return () => info.close()
  }, [tecnicos, selecionado, trilha, contratos, locais, paradas, referencia, versao, aoSelecionar, corDe])

  // 097 · o mapa conta à página se dá para desenhar cerca.
  useEffect(() => { aoMapaPronto(pronto && !erro) }, [pronto, erro, aoMapaPronto])

  // 097 · as cercas: camada própria, para não redesenhar a trilha junto.
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    const info = new google.maps.InfoWindow()
    const pols = cercas.filter(c => c.id !== desenho?.id).map(c => {
      const p = new google.maps.Polygon({
        map: m, paths: c.poligono.map(([lat, lng]) => ({ lat, lng })),
        strokeColor: c.cor, strokeOpacity: 0.9, strokeWeight: c.tipo === 'GARAGEM' ? 2 : 1.5,
        fillColor: c.cor, fillOpacity: c.tipo === 'GARAGEM' ? 0.2 : 0.08, zIndex: 5,
        clickable: !desenho,
      })
      p.addListener('click', (ev: google.maps.PolyMouseEvent) => {
        info.setContent(`<div style="color:#111;font:500 12px/1.5 system-ui">
          <strong>${esc(c.nome)}</strong> · ${c.tipo === 'GARAGEM' ? 'garagem' : 'área'}<br>
          ${c.alerta_sair || c.alerta_entrar ? 'avisa ao ' + [c.alerta_sair && 'sair', c.alerta_entrar && 'entrar'].filter(Boolean).join(' e ') : 'só registra'}</div>`)
        info.setPosition(ev.latLng); info.open({ map: m })
      })
      return p
    })
    return () => { info.close(); for (const p of pols) p.setMap(null) }
  }, [cercas, desenho?.id, !!desenho, versao])  // eslint-disable-line react-hooks/exhaustive-deps

  // 097 · o desenho: clique no mapa marca um canto; o polígono é editável
  // (arrastar ajusta, botão direito num canto apaga). O React só guarda a
  // lista de cantos — o polígono vivo é do Maps, recriado quando a
  // `chave` muda (começar, desfazer, recomeçar).
  const avisarDesenho = useRef(aoMudarDesenho)
  avisarDesenho.current = aoMudarDesenho
  useEffect(() => {
    const m = mapa.current
    if (!m || !desenho) return
    // Polígono criado com a lista VAZIA (cerca nova) não tem caminho —
    // `getPath()` volta indefinido; e um MVCArray passado no construtor é
    // COPIADO (os cliques iam para uma lista que o mapa não desenhava).
    // `setPath` + `getPath`: o caminho é o do próprio polígono.
    const poly = new google.maps.Polygon({
      map: m, editable: true, strokeColor: desenho.cor, strokeWeight: 2.5,
      fillColor: desenho.cor, fillOpacity: 0.18, zIndex: 300,
    })
    poly.setPath(desenho.pontos.map(([lat, lng]) => ({ lat, lng })))
    const path = poly.getPath()
    const avisa = () => avisarDesenho.current(path.getArray().map(p => [p.lat(), p.lng()] as [number, number]))
    const ouvintes = [
      path.addListener('insert_at', avisa),
      path.addListener('set_at', avisa),
      path.addListener('remove_at', avisa),
      m.addListener('click', (ev: google.maps.MapMouseEvent) => { if (ev.latLng) path.push(ev.latLng) }),
      poly.addListener('contextmenu', (ev: google.maps.PolyMouseEvent) => {
        if (ev.vertex != null) path.removeAt(ev.vertex)
      }),
    ]
    // Ícone de loja/POI do Google engole o clique (abre a ficha do lugar).
    m.setOptions({ draggableCursor: 'crosshair', gestureHandling: 'greedy', clickableIcons: false })
    if (desenho.pontos.length >= 3) {
      const b = new google.maps.LatLngBounds()
      for (const [lat, lng] of desenho.pontos) b.extend({ lat, lng })
      m.fitBounds(b, 60)
    }
    return () => {
      for (const o of ouvintes) o.remove()
      poly.setMap(null)
      m.setOptions({ draggableCursor: null, gestureHandling: 'cooperative', clickableIcons: true })
    }
  }, [desenho?.chave, versao])  // eslint-disable-line react-hooks/exhaustive-deps

  // O replay: um marcador que anda sem redesenhar o resto.
  useEffect(() => {
    const m = mapa.current
    marcaReplay.current?.setMap(null)
    marcaReplay.current = null
    if (!m || replay == null || !trilha[replay]) return
    const p = trilha[replay]
    marcaReplay.current = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng }, map: m, zIndex: 100,
      title: `${hhmm(p.capturado_em)} · replay`,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#facc15',
              fillOpacity: 1, strokeColor: '#111827', strokeWeight: 2.5 },
    })
    m.panTo({ lat: p.lat, lng: p.lng })
  }, [replay, trilha, versao])

  if (!temChaveDoMapa || erro) {
    return (
      <div className="p-3">
        <TrilhaSVG tecnicos={tecnicos} trilha={trilha} contratos={contratos}
          replay={replay} selecionado={selecionado} />
        <p className="mt-2 text-[11px] leading-relaxed text-graf-400">
          {erro === RECADO_CHAVE
            ? 'O Google recusou a chave nesta tela (endereço fora da lista da chave). Mostrando o desenho sem o mapa de fundo.'
            : erro ?? 'Sem chave do Google Maps nesta instalação: o desenho vai sem o mapa de fundo.'}
        </p>
      </div>
    )
  }

  return (
    <div className="relative">
      <div ref={div} className="h-[34rem] w-full bg-graf-900" />
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md
                      bg-black/60 px-2.5 py-1.5 text-[10px] text-white">
        {legenda.map(l => (
          <span key={l.rotulo} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: l.cor }} />{l.rotulo}
          </span>
        ))}
        {selecionado && <>
          <span>━ trilha</span><span className="text-orange-300">┅ buraco</span>
          <span>■ contrato</span><span>B baixa</span><span>P parada</span>
        </>}
      </div>
    </div>
  )
}

/**
 * A cor da situação para o Maps. O cadastro guarda `var(--st-…)`, e o
 * Maps pinta em canvas: variável CSS não resolve e o marcador sai PRETO,
 * calado (traps.md). Resolve-se aqui, no tema da tela.
 */
function corParaMapa(c: string | undefined): string {
  if (!c) return '#64748b'
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim())
  if (!m) return c
  const alvo = document.querySelector('.sup-controle') ?? document.documentElement
  const v = getComputedStyle(alvo).getPropertyValue(m[1]).trim()
  return /^#[0-9a-f]{3,8}$/i.test(v) ? v : '#64748b'
}

/** HTML do balão do Maps: nome de técnico e contrato vão escapados. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/**
 * Sem Google (sem chave, chave recusada): o mesmo desenho em SVG, sobre
 * uma projeção simples. Perde a rua de fundo, mantém a forma da trilha,
 * as posições e os contratos — a tela nunca fica em branco por causa do
 * mapa (mesma decisão da Rota do dia).
 */
function TrilhaSVG({ tecnicos, trilha, contratos, replay, selecionado }: {
  tecnicos: { t: TecMonitor; e: Estado }[]
  trilha: PontoRastro[]
  contratos: ContratoMapa[]
  replay: number | null
  selecionado: TecMonitor | null
}) {
  const pontos: { lat: number; lng: number }[] = [
    ...trilha,
    ...contratos.filter(c => c.lat != null && c.lng != null).map(c => ({ lat: Number(c.lat), lng: Number(c.lng) })),
    ...(selecionado ? [] : tecnicos.filter(x => x.t.ultimo_lat != null)
      .map(x => ({ lat: Number(x.t.ultimo_lat), lng: Number(x.t.ultimo_lng) }))),
  ]
  if (pontos.length === 0) {
    return <div className="grid h-72 place-items-center text-xs text-graf-400">Nenhuma posição para desenhar.</div>
  }
  const L = 600, A = 380, M = 20
  const minLat = Math.min(...pontos.map(p => p.lat)), maxLat = Math.max(...pontos.map(p => p.lat))
  const minLng = Math.min(...pontos.map(p => p.lng)), maxLng = Math.max(...pontos.map(p => p.lng))
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
  const w = Math.max((maxLng - minLng) * k, 1e-4), h = Math.max(maxLat - minLat, 1e-4)
  const esc2 = Math.min((L - 2 * M) / w, (A - 2 * M) / h)
  const x = (lng: number) => M + (lng - minLng) * k * esc2
  const y = (lat: number) => A - M - (lat - minLat) * esc2
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full rounded-md bg-graf-900" role="img"
      aria-label="Desenho das posições e da trilha, sem mapa de fundo">
      {contratos.filter(c => c.lat != null).map(c => (
        <rect key={c.id} x={x(Number(c.lng)) - 5} y={y(Number(c.lat)) - 5} width={10} height={10}
          fill={SITUACAO_INFO[c.situacao]?.cor ?? '#64748b'} stroke="#fff" strokeWidth={1}>
          <title>ctt {c.contrato}</title>
        </rect>
      ))}
      {trilha.length > 1 && (
        <polyline points={trilha.map(p => `${x(p.lng)},${y(p.lat)}`).join(' ')}
          fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinejoin="round" />
      )}
      {!selecionado && tecnicos.filter(v => v.t.ultimo_lat != null).map(({ t, e }) => (
        <circle key={t.tecnico_id} cx={x(Number(t.ultimo_lng))} cy={y(Number(t.ultimo_lat))} r={7}
          fill={COR_ESTADO[e]} stroke="#fff" strokeWidth={1.5}>
          <title>{t.nome}</title>
        </circle>
      ))}
      {replay != null && trilha[replay] && (
        <circle cx={x(trilha[replay].lng)} cy={y(trilha[replay].lat)} r={8}
          fill="#facc15" stroke="#111827" strokeWidth={2} />
      )}
    </svg>
  )
}
