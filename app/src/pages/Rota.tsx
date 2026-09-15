import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { equipeRotulo, isoLocal } from '../lib/formato'
import { useDiaAnteriorComMovimento } from '../lib/dia'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { useTema } from '../lib/tema'
import { aoFalharAutenticacao, autenticacaoFalhou, carregarMapaGoogle,
         temChaveDoMapa } from '../lib/mapaGoogle'

/**
 * Rota do Dia — a mesa de despacho (D-111, redesenhada).
 *
 * ┌─ DIREÇÃO: painel de despacho, não painel de indicador ───────────┐
 * │ > "pense que tem um controlador de rota olhando isso […] quero    │
 * │ >  uma visão de rota muito lisa e fluida" — Emanuel, 14/09        │
 * │                                                                   │
 * │ A versão anterior era um Gantt: cada visita virava um retângulo   │
 * │ posicionado pela hora, com o bairro espremido dentro. Num dia     │
 * │ real a visita de 20 minutos vira um bloco de 14 px, e 14 px não   │
 * │ cabem "SETOR CENTRAL", muito menos o tipo de serviço e a hora.    │
 * │ O desenho respondia QUANDO e escondia O QUÊ.                      │
 * │                                                                   │
 * │ Agora a faixa é uma SEQUÊNCIA de paradas, e o que ganha espaço é  │
 * │ o **trecho entre elas** — que é a unidade do despachante. O km e  │
 * │ o tempo parado moram na linha que liga duas paradas, que é        │
 * │ exatamente o que eles são: o deslocamento. A hora continua        │
 * │ escrita em cada cartão, com precisão de minuto — melhor do que    │
 * │ deduzir de um pixel.                                              │
 * │                                                                   │
 * │ Gramática: tipografia tabular para hora e km (a coluna não        │
 * │ dança), caixa alta pequena para etiqueta, canto pouco arredondado │
 * │ — mesa de operação, não cartão de marketing. Tudo dentro da rampa │
 * │ `graf` e das cores de situação que a casa inteira já usa; nenhum  │
 * │ botão, input ou card novo foi inventado (D-011).                  │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ⚠ O que esta tela continua NÃO sabendo, e diz: o trajeto percorrido
 * (o TOA manda pontos, não caminho), onde o técnico está agora (sem GPS
 * ao vivo) e a distância de rua — o km aqui é linha reta.
 */

interface Parada {
  visita_id: string
  contrato: string | null
  login: string
  tecnico: string | null
  equipe: string | null
  /** A CHAVE para agir. `equipe` é o código, rótulo; quem `transferir_visita`
   *  aceita é o id (075). */
  equipe_id: string | null
  bairro: string | null
  area: string | null
  lat: number | null
  lng: number | null
  inicio: string | null
  fim: string | null
  /** Quem diz que encerrou. `fim` vem preenchido em atividade só
   *  INICIADA — sem isto o cartão daria hora de fim a quem não fechou
   *  (D-103). */
  finalizado_toa: boolean | null
  janela_inicio: string | null
  janela_fim: string | null
  situacao: Situacao
  tipo_servico: string | null
  /** Aderência à janela, calculada pelo SERVIDOR (D-047). A tela não
   *  recalcula: uma segunda regra divergiria da primeira. */
  tec1: 'PADRAO' | 'SEM_PADRAO' | 'EXPURGADA' | null
  ordem: number
  km_desde_anterior: number | null
  voltou_ao_bairro: boolean
  /** Os códigos de baixa das O.S. desta visita — a NOSSA quando existe,
   *  senão a da operadora. São duas baixas e elas divergem (D-042), por
   *  isso `baixa_origem` vem junto e `baixa_detalhe` traz as duas
   *  inteiras para a dica do cartão (076). */
  baixa_codigos: string | null
  baixa_origem: 'AFLINE' | 'TOA' | null
  baixa_detalhe: string | null
  /** PRODUTIVA ou JORNADA (079). A jornada entra na sequencia do dia
   *  para explicar o buraco entre um contrato e o seguinte -- mas com
   *  `ordem` NULA, sem km e fora de toda contagem. */
  natureza: 'PRODUTIVA' | 'JORNADA' | string
  tipo_atividade: string | null
}
interface BairroLinha {
  bairro: string; visitas: number; tecnicos: number; equipes: number
  concluidas: number; em_aberto: number; lat: number | null; lng: number | null
}
interface Resumo {
  visitas: number; tecnicos: number; bairros: number
  km_total: number | null; km_medio: number | null; maior_salto: number | null
  com_coordenada: number; retornos: number; bairros_pulverizados: number
}

/**
 * O salto que vale aviso, em km de linha reta.
 *
 * NÃO é meta da CLARO e não é palpite: é o mesmo corte que
 * `rota_alertas` (054) usa, tirado do que o próprio dia mostrou como
 * fora da curva. Está aqui como constante nomeada para a régua e o
 * servidor falarem o mesmo número — se um dia mudar, muda nos dois.
 */
const LIMITE_SALTO_KM = 10

/**
 * Encerrado: não se arrasta. Espelha `situacoes_terminais()` (035) — o
 * banco é quem recusa; a tela só evita oferecer o que vai falhar.
 */
const TERMINAIS: string[] = ['CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO']

/**
 * A cor da EQUIPE no mapa — categórica, não semântica.
 *
 * Deliberadamente fora da rampa `--st-*`: aquela significa SITUAÇÃO, e
 * no mapa a cor significa DE QUEM É. Usar verde de "concluída" para a
 * equipe 001 faria o mapa mentir duas vezes. Vermelho fica no fim da
 * fila de propósito — equipe nenhuma deve nascer parecendo alarme.
 */
const CORES_EQUIPE = [
  '#3b82f6', '#f59e0b', '#06b6d4', '#a855f7',
  '#10b981', '#ec4899', '#f97316', '#6366f1',
]

/** Hex concreto: o Maps pinta em canvas e `var(--x)` não resolve ali. */
const corBairro = (t: number) =>
  t >= 7 ? '#e4262f' : t >= 4 ? '#f59e0b' : '#3b82f6'

const hhmm = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

const num = (n: number | null | undefined, casas = 1) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas,
                                                maximumFractionDigits: casas })

/** "1h20" / "45 min" — o tempo parado entre duas paradas. */
function duracao(min: number): string {
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/**
 * A etiqueta curta do tipo de serviço.
 *
 * "VISITA TECNICA" não cabe num cartão de 9 rem, e o controlador chama
 * de VT. As abreviações são as da operação — não invenção nossa. O que
 * não estiver no de/para aparece inteiro, truncado pelo CSS: melhor uma
 * palavra cortada do que um rótulo errado.
 */
const APELIDO_SERVICO: Record<string, string> = {
  'VISITA TECNICA': 'VT',
  'MUDANCA DE ENDERECO': 'MUD. END.',
  'RETORNO DE CREDENCIADA': 'RETORNO CRED.',
  'MIGRACAO GPON': 'GPON',
  'REINSTALACAO': 'REINST.',
  'DESCONEXAO': 'DESCONEXÃO',
  'ADESAO': 'ADESÃO',
  'SERVICO': 'SERVIÇO',
}

export default function Rota() {
  const navegar = useNavigate()
  // HOJE. Abria no último dia com visita, e a rota de ontem sob a data
  // de hoje é a pior das confusões numa tela de despacho (lib/dia.ts).
  const [data, setData] = useState(isoLocal())
  const [paradas, setParadas] = useState<Parada[]>([])
  /** Refeicao, Na Base: o que explica o buraco na sequencia do dia. */
  const [jornadas, setJornadas] = useState<Parada[]>([])
  const [bairros, setBairros] = useState<BairroLinha[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [foco, setFoco] = useState<string | null>(null)   // login em foco
  const outroDia = useDiaAnteriorComMovimento(data)

  /** A transferência em curso: o que está sendo movido e para onde.
   *  Nasce do arrasto OU do botão do cartão — os dois caem aqui, para
   *  não existirem dois caminhos com regras diferentes. */
  const [mover, setMover] = useState<
    { parada: Parada; destinoLogin: string | null } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)

  const recarregar = useCallback(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    Promise.all([
      supabase.rpc('rota_do_dia', { p_data: data }),
      supabase.rpc('rota_bairros', { p_data: data }),
      supabase.rpc('rota_resumo', { p_data: data }),
    ]).then(([p, b, r]) => {
      if (!vivo) return
      if (p.error) setErro(p.error.message)
      // ┌─ jornada nao entra em conta nenhuma ─────────────────────┐
      // │ A separacao acontece AQUI, na porta: `paradas` alimenta  │
      // │ km, bairros, "a fazer", o mapa e o resumo das equipes.   │
      // │ Deixar a Refeicao entrar ali seria exatamente o que o    │
      // │ Emanuel pediu para nao acontecer -- e sairia calado.     │
      // └──────────────────────────────────────────────────────────┘
      const todas = (p.data ?? []) as Parada[]
      setParadas(todas.filter(x => x.natureza !== 'JORNADA'))
      setJornadas(todas.filter(x => x.natureza === 'JORNADA'))
      setBairros((b.data ?? []) as BairroLinha[])
      setResumo((r.data ?? null) as Resumo | null)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [data])

  useEffect(() => {
    if (!data) return
    setFoco(null)
    return recarregar()
  }, [data, recarregar])

  /** Uma faixa por LOGIN do TOA, na ordem de quem mais rodou. */
  const faixas = useMemo(() => {
    const m = new Map<string, Parada[]>()
    for (const p of paradas) m.set(p.login, [...(m.get(p.login) ?? []), p])
    return [...m.entries()]
      .map(([login, ps]) => {
        const ordenadas = [...ps].sort((a, b) => a.ordem - b.ordem)
        return {
          login, paradas: ordenadas,
          jornada: jornadas.filter(j => j.login === login)
            .sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? '')),
          nome: ps.find(p => p.tecnico)?.tecnico ?? null,
          equipe: ps.find(p => p.equipe)?.equipe ?? null,
          equipeId: ps.find(p => p.equipe_id)?.equipe_id ?? null,
          km: ps.reduce((s, p) => s + (p.km_desde_anterior ?? 0), 0),
          bairros: new Set(ps.map(p => p.bairro).filter(Boolean)).size,
          retornos: ps.filter(p => p.voltou_ao_bairro).length,
          saltos: ps.filter(p => (p.km_desde_anterior ?? 0) >= LIMITE_SALTO_KM).length,
          foraJanela: ps.filter(p => p.tec1 === 'SEM_PADRAO').length,
          aFazer: ps.filter(p => !TERMINAIS.includes(p.situacao)).length,
        }
      })
      .sort((a, b) => b.km - a.km)
  }, [paradas, jornadas])

  /** A cor de cada equipe, fixa no dia — a mesma no mapa e na faixa. */
  const corEquipe = useMemo(() => {
    const codigos = [...new Set(paradas.map(p => p.equipe).filter(Boolean))].sort()
    const m = new Map<string, string>()
    codigos.forEach((c, i) => m.set(c as string, CORES_EQUIPE[i % CORES_EQUIPE.length]))
    return (c: string | null) => (c && m.get(c)) || '#64748b'
  }, [paradas])

  /** As equipes em campo, com o que ainda têm para executar. */
  const equipes = useMemo(() => {
    const m = new Map<string, {
      codigo: string; visitas: number; aFazer: number; concluidas: number
      logins: Set<string>; km: number
    }>()
    for (const p of paradas) {
      const c = p.equipe ?? '—'
      const e = m.get(c) ?? { codigo: c, visitas: 0, aFazer: 0, concluidas: 0,
                              logins: new Set<string>(), km: 0 }
      e.visitas++
      if (!TERMINAIS.includes(p.situacao)) e.aFazer++
      if (p.situacao === 'CONCLUIDA') e.concluidas++
      e.logins.add(p.login)
      e.km += p.km_desde_anterior ?? 0
      m.set(c, e)
    }
    return [...m.values()].sort((a, b) => b.aFazer - a.aFazer || b.visitas - a.visitas)
  }, [paradas])

  const visiveis = foco ? faixas.filter(t => t.login === foco) : faixas
  const faixaDestino = mover?.destinoLogin
    ? faixas.find(f => f.login === mover.destinoLogin) ?? null : null
  /** Duas faixas podem ser a MESMA equipe: dois logins, um dono. Aí o
   *  banco responde "não mudou" — e a tela avisa antes de tentar. */
  const mesmaEquipe = Boolean(
    mover && faixaDestino && faixaDestino.equipeId === mover.parada.equipe_id)

  async function confirmarTransferencia() {
    if (!mover || !faixaDestino?.equipeId || mesmaEquipe) return
    setOcupado(true); setErro(null); setOk(null)
    const { data: r, error } = await supabase.rpc('transferir_visita', {
      p_visita: mover.parada.visita_id,
      p_equipe: faixaDestino.equipeId,
      p_motivo: motivo.trim() || null,
    })
    if (error) {
      setErro(/permiss/i.test(error.message)
        ? 'Só COP, Controlador ou ADMIN transferem contrato. A barreira é do banco.'
        : error.message)
    } else if ((r as { mudou?: boolean } | null)?.mudou === false) {
      setErro('As duas faixas são da mesma equipe — nada mudou.')
    } else {
      setOk(`Contrato ${mover.parada.contrato ?? ''} → equipe ${faixaDestino.equipe}. `
            + 'A rota ficou FIXADA: a próxima importação do TOA não desfaz.')
      recarregar()
    }
    setOcupado(false); setMover(null); setMotivo('')
  }

  return (
    <Shell acoes={
      <input type="date" value={data} onChange={e => setData(e.target.value)}
        aria-label="Dia da rota"
        className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
    }>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Rota do dia</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            A mesa de despacho. Cada faixa é um técnico, cada cartão é uma parada, e a
            linha entre dois cartões é o <strong>deslocamento</strong> — é nela que o km
            e o tempo parado aparecem. <strong>Arraste</strong> um contrato em aberto
            para outra faixa para transferi-lo de equipe.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        {/* ====== resumo ====== */}
        {resumo && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Visitas', String(resumo.visitas), null],
              ['Técnicos', String(resumo.tecnicos), null],
              ['Bairros', String(resumo.bairros), null],
              ['Km no dia', num(resumo.km_total, 0), 'em linha reta'],
              ['Retornos', String(resumo.retornos),
                resumo.retornos ? 'voltou a bairro já visitado' : null],
              ['Bairros pulverizados', String(resumo.bairros_pulverizados),
                '5+ técnicos no mesmo bairro'],
            ].map(([rot, val, nota], i) => (
              <div key={rot as string} className="card-controle p-3">
                <div className={`tabular text-2xl font-semibold leading-none ${
                  i >= 4 && Number(val) > 0 ? 'text-af-400' : ''}`}>{val}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">
                  {rot}
                </div>
                {nota && <div className="mt-0.5 text-[10px] text-graf-400">{nota}</div>}
              </div>
            ))}
          </div>
        )}

        {carregando ? (
          <p className="py-16 text-center text-graf-400" role="status">Carregando o dia…</p>
        ) : paradas.length === 0 ? (
          <Vazio titulo="Sem rota para este dia"
            descricao="Nenhuma visita produtiva com login de técnico nesta data."
            acao={outroDia ? (
              <button onClick={() => setData(outroDia)}
                className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                           text-graf-300 hover:border-af-600 hover:text-af-400">
                ver {new Date(outroDia + 'T12:00').toLocaleDateString('pt-BR')}
                {' '}— último dia com movimento
              </button>
            ) : undefined} />
        ) : (<>

          {/* ====== 1. a mesa ====== */}
          <section className="card-controle overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1
                            border-b border-graf-800 px-4 py-2.5">
              <h2 className="text-sm font-semibold">A rota, parada a parada</h2>
              <span className="text-xs text-graf-400">
                janela combinada em cima, execução embaixo · o km e o tempo ficam no
                trecho entre dois cartões
              </span>
              {foco && (
                <button onClick={() => setFoco(null)}
                  className="ml-auto text-xs text-af-400 underline underline-offset-2">
                  ver os {faixas.length} técnicos
                </button>
              )}
            </div>

            <div className="divide-y divide-graf-800">
              {visiveis.map(t => {
                const alvo = Boolean(arrastando)
                  && arrastando !== null
                  && !t.paradas.some(p => p.visita_id === arrastando)
                return (
                  <div key={t.login}
                    onDragOver={e => { if (alvo) { e.preventDefault(); setSobre(t.login) } }}
                    onDragLeave={() => setSobre(s => (s === t.login ? null : s))}
                    onDrop={e => {
                      e.preventDefault(); setSobre(null)
                      const p = paradas.find(x => x.visita_id === arrastando)
                      setArrastando(null)
                      if (p) { setMover({ parada: p, destinoLogin: t.login }); setMotivo('') }
                    }}
                    className={`faixa-rota px-4 py-3 ${alvo ? 'faixa-alvo' : ''} ${
                      sobre === t.login ? 'faixa-sobre' : ''}`}>

                    {/* ---- cabeçalho da faixa ---- */}
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button onClick={() => setFoco(foco === t.login ? null : t.login)}
                        aria-pressed={foco === t.login}
                        className="group flex min-w-0 items-center gap-2 text-left">
                        <span aria-hidden className="h-7 w-1 shrink-0 rounded-full"
                          style={{ background: corEquipe(t.equipe) }} />
                        <span className="min-w-0">
                          <span className="tabular block truncate text-xs font-semibold
                                           text-graf-100 group-hover:text-af-400">
                            {t.login}
                          </span>
                          <span className="block truncate text-[11px] text-graf-400">
                            {t.nome ?? 'sem nome no TOA'}
                            {t.equipe && (
                              <span className="ml-1.5 text-graf-400">
                                · {equipeRotulo(t.equipe)}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>

                      <span className="tabular ml-auto flex flex-wrap items-center gap-x-3
                                       gap-y-0.5 text-[11px] text-graf-400">
                        <span>{num(t.km, 0)} km</span>
                        <span>{t.bairros} bairro{t.bairros === 1 ? '' : 's'}</span>
                        <span>{t.paradas.length} parada{t.paradas.length === 1 ? '' : 's'}</span>
                        {t.aFazer > 0 && (
                          <span className="text-graf-300">{t.aFazer} a fazer</span>
                        )}
                        {/* Divergência com PALAVRA, não só cor. */}
                        {t.retornos > 0 && (
                          <span className="rounded bg-af-900/40 px-1.5 py-0.5 font-semibold
                                           text-af-300">
                            {t.retornos} retorno{t.retornos === 1 ? '' : 's'}
                          </span>
                        )}
                        {t.saltos > 0 && (
                          <span className="rounded bg-af-900/40 px-1.5 py-0.5 font-semibold
                                           text-af-300">
                            {t.saltos} salto{t.saltos === 1 ? '' : 's'}
                          </span>
                        )}
                        {t.foraJanela > 0 && (
                          <span title="Fora do padrão TEC1 — a aderência é calculada pelo servidor"
                            className="rounded bg-amber-900/40 px-1.5 py-0.5 font-semibold
                                       text-amber-300">
                            {t.foraJanela} fora da janela
                          </span>
                        )}
                      </span>
                    </div>

                    {/* ---- a sequência ---- */}
                    {/* ┌─ QUEBRA, nao rola ──────────────────────────┐
                        │ > "o ideal é olhar a rota inteira sem o      │
                        │ >  scroll" — Emanuel                         │
                        │                                              │
                        │ 13 paradas num cartao legivel dao ~2.400 px: │
                        │ nao existe fonte pequena o bastante para     │
                        │ caber numa tela de 950 px sem virar borrao.  │
                        │ Entao a sequencia QUEBRA e continua na linha │
                        │ de baixo, como texto — a rota inteira fica   │
                        │ visivel de uma vez, sem barra horizontal.    │
                        └──────────────────────────────────────────────┘ */}
                    {/* ┌─ a jornada entra na sequência, pelo relógio ────┐
                        │ Sem ela o controlador vê o contrato das 12:06   │
                        │ e o das 14:38 colados, e não sabe se o técnico  │
                        │ almoçou ou sumiu. Com ela, a Refeição de duas   │
                        │ horas está escrita ali.                         │
                        │                                                 │
                        │ Mas ela NÃO é um Trecho: não tem número de      │
                        │ ordem, não tem km, não abre contrato e não      │
                        │ arrasta. É um separador que fala. Ver D-149.    │
                        └─────────────────────────────────────────────────┘ */}
                    <ol className="trilho flex flex-wrap items-stretch gap-y-1.5">
                      {t.paradas.map((p, i) => {
                        // A jornada que começou DEPOIS da parada anterior e
                        // ANTES desta: é o buraco que ela explica.
                        const antes = t.jornada.filter(j => {
                          if (!j.inicio) return false
                          const ant = i > 0 ? t.paradas[i - 1].inicio : null
                          return (!ant || j.inicio > ant) && (!p.inicio || j.inicio <= p.inicio)
                        })
                        return (
                          <Fragment key={p.visita_id}>
                            {antes.map(j => <ChipJornada key={j.visita_id} j={j} />)}
                            <Trecho
                              parada={p} anterior={i > 0 ? t.paradas[i - 1] : null}
                              primeiro={i === 0}
                              arrastando={arrastando === p.visita_id}
                              onArrastar={setArrastando}
                              onAbrir={() => navegar(`/controle/visita/${p.visita_id}`)}
                              onMover={() => { setMover({ parada: p, destinoLogin: null })
                                               setMotivo('') }} />
                          </Fragment>
                        )
                      })}
                      {/* o que ficou depois do último contrato do dia */}
                      {t.jornada
                        .filter(j => j.inicio && t.paradas.length > 0
                          && j.inicio > (t.paradas[t.paradas.length - 1].inicio ?? ''))
                        .map(j => <ChipJornada key={j.visita_id} j={j} />)}
                      {/* técnico que só tem jornada no dia: a faixa existe
                          e precisa dizer o que ele fez */}
                      {t.paradas.length === 0 &&
                        t.jornada.map(j => <ChipJornada key={j.visita_id} j={j} />)}
                    </ol>
                  </div>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t
                            border-graf-800 px-4 py-2 text-[10px] text-graf-400">
              {(['CONCLUIDA', 'EM_EXECUCAO', 'EM_DESLOCAMENTO', 'REAGENDAMENTO',
                 'CANCELADA', 'ENTRADA'] as Situacao[]).map(s => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <i aria-hidden className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: SITUACAO_INFO[s]?.cor ?? '#64748b' }} />
                  {SITUACAO_INFO[s]?.label ?? s}
                </span>
              ))}
              <span className="ml-auto">
                ↩ voltou ao bairro · ⚑ salto de {LIMITE_SALTO_KM} km ou mais ·
                ⧗ fora da janela (TEC1)
              </span>
            </div>
          </section>

          {/* ====== 2. o dia no espaço ====== */}
          <section className="card-controle overflow-hidden">
            <div className="border-b border-graf-800 px-4 py-2.5">
              <h2 className="text-sm font-semibold">O dia no espaço</h2>
              <p className="mt-0.5 text-xs text-graf-400">
                um pino por contrato, na cor da equipe · troque a camada no canto do
                mapa e arraste o boneco para o Street View
              </p>
            </div>
            <div className="grid gap-0 lg:grid-cols-[1.5fr_1fr]">
              <MapaDoDia paradas={paradas} bairros={bairros}
                corEquipe={corEquipe} corBairro={corBairro} foco={foco} />

              {/* Painel das equipes: substitui a tabela de bairros porque a
                  pergunta mudou — "o que eles têm pra executar", não "onde
                  há concentração". O agregado por bairro segue no resumo. */}
              <div className="max-h-[26rem] overflow-auto border-t border-graf-800
                              lg:border-l lg:border-t-0">
                <h3 className="sticky top-0 z-10 border-b border-graf-700 bg-graf-900
                               px-3 py-2 text-[10px] font-medium uppercase
                               tracking-wide text-graf-400">
                  Equipes em campo
                </h3>
                <ul>
                  {equipes.map(e => (
                    <li key={e.codigo}
                      className="flex items-center gap-2.5 border-b border-graf-800 px-3 py-2">
                      <span aria-hidden className="h-6 w-1 shrink-0 rounded-full"
                        style={{ background: corEquipe(e.codigo) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-graf-200">
                          {equipeRotulo(e.codigo)}
                        </span>
                        <span className="tabular block text-[10px] text-graf-400">
                          {e.logins.size} login{e.logins.size === 1 ? '' : 's'} ·{' '}
                          {num(e.km, 0)} km
                        </span>
                      </span>
                      <span className="text-right">
                        <span className={`tabular block text-sm font-semibold ${
                          e.aFazer > 0 ? 'text-graf-100' : 'text-graf-400'}`}>
                          {e.aFazer}
                        </span>
                        <span className="block text-[9px] uppercase tracking-wide
                                         text-graf-400">a executar</span>
                      </span>
                      <span className="tabular w-10 text-right text-xs text-graf-400">
                        {e.concluidas}
                        <span className="block text-[9px] uppercase tracking-wide
                                         text-graf-400">ok</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="border-t border-graf-800 px-4 py-2 text-center text-[11px]
                          text-graf-400">
              {resumo?.com_coordenada ?? 0} de {resumo?.visitas ?? 0} visitas com
              coordenada · distância em linha reta, não trajeto de rua · esta tela é do
              dia agendado, não é rastreamento ao vivo
            </p>
          </section>
        </>)}

        {/* ====== a transferência ====== */}
        {mover && (
          <PainelMover parada={mover.parada} faixas={faixas}
            destinoLogin={mover.destinoLogin} mesmaEquipe={mesmaEquipe}
            motivo={motivo} ocupado={ocupado}
            onDestino={l => setMover(m => (m ? { ...m, destinoLogin: l } : m))}
            onMotivo={setMotivo}
            onConfirmar={confirmarTransferencia}
            onFechar={() => { setMover(null); setMotivo('') }} />
        )}
      </div>
    </Shell>
  )
}

/* ================================================================== */

/**
 * A jornada na sequência do dia: Refeição, Na Base.
 *
 * ┌─ o que ela é, e o que ela NÃO é ─────────────────────────────────┐
 * │ > "ele vai tá ali pra gente saber mais ou menos o que ele tá      │
 * │ >  fazendo quando não está no contrato [...] mais não serve para  │
 * │ >  considerar como um contrato" — Emanuel, 15/09                  │
 * │                                                                   │
 * │ Sem isto, o contrato que fecha 12:26 e o seguinte que começa      │
 * │ 14:38 aparecem colados, e o despachante não sabe se foram duas    │
 * │ horas de almoço ou duas horas de sumiço.                          │
 * │                                                                   │
 * │ De propósito NÃO é um `Trecho`: não tem número de ordem (a 7ª     │
 * │ parada do dia não pode ser o almoço), não carrega km (jornada     │
 * │ não tem coordenada, e medir até um ponto sem coordenada           │
 * │ inventaria distância), não abre contrato e não arrasta. É         │
 * │ separador que fala — mais estreito e mais apagado que um cartão,  │
 * │ para o olho não confundir as duas coisas. Ver D-149.              │
 * └───────────────────────────────────────────────────────────────────┘
 */
function ChipJornada({ j }: { j: Parada }) {
  const min = j.inicio && j.fim
    ? Math.round((new Date(j.fim).getTime() - new Date(j.inicio).getTime()) / 60000)
    : null
  const rotulo = j.tipo_atividade ?? 'jornada'
  return (
    <li className="flex items-center" aria-label={`Fora de contrato: ${rotulo}`}>
      <div className="mx-1 flex items-center gap-1.5 rounded-sm border border-dashed
                      border-graf-600 bg-graf-900/60 px-2 py-1 text-[10px]"
        title={[
          `${rotulo} — fora de contrato`,
          j.inicio ? `das ${hhmm(j.inicio)}` : null,
          j.fim ? `às ${hhmm(j.fim)}` : null,
          'Não conta como contrato nem em produtividade.',
        ].filter(Boolean).join(' ')}>
        <span aria-hidden className="text-graf-500">⏸</span>
        <span className="font-medium text-graf-300">{rotulo}</span>
        <span className="tabular text-graf-500">
          {hhmm(j.inicio) ?? '?'}–{hhmm(j.fim) ?? '?'}
        </span>
        {min != null && min >= 0 && (
          <span className="tabular font-semibold text-graf-400">{duracao(min)}</span>
        )}
      </div>
    </li>
  )
}

/**
 * Um trecho da rota: o DESLOCAMENTO que chegou até aqui, e a parada.
 *
 * O deslocamento vem primeiro porque é o que o despachante julga — e é
 * ele que carrega o km e o tempo. A primeira parada do dia não tem
 * trecho: ninguém sabe de onde o técnico saiu (o TOA não manda a base).
 */
function Trecho({ parada: p, anterior, primeiro, arrastando,
                  onArrastar, onAbrir, onMover }: {
  parada: Parada
  anterior: Parada | null
  primeiro: boolean
  arrastando: boolean
  onArrastar: (id: string | null) => void
  onAbrir: () => void
  onMover: () => void
}) {
  const encerrou = p.finalizado_toa ? hhmm(p.fim) : null
  const km = p.km_desde_anterior
  const salto = km != null && km >= LIMITE_SALTO_KM
  const movel = !TERMINAIS.includes(p.situacao)
  const cor = SITUACAO_INFO[p.situacao]?.cor ?? '#64748b'
  const servico = p.tipo_servico
    ? APELIDO_SERVICO[p.tipo_servico] ?? p.tipo_servico
    : null

  // Tempo entre o fim da anterior e o início desta. Só descreve; não
  // julga — não existe regra de quanto é "parado demais", e inventar uma
  // seria escrever meta que ninguém combinou.
  const parado = useMemo(() => {
    if (!anterior?.fim || !p.inicio) return null
    const d = (new Date(p.inicio).getTime() - new Date(anterior.fim).getTime()) / 60000
    return d > 0 && d < 60 * 14 ? d : null
  }, [anterior?.fim, p.inicio])

  /** "08:00–12:00" — o combinado com o assinante. */
  const janela = p.janela_inicio
    ? `${p.janela_inicio.slice(0, 5)}–${(p.janela_fim ?? '').slice(0, 5) || '?'}`
    : null

  const rotulo = [
    p.contrato ? `contrato ${p.contrato}` : 'sem contrato',
    p.bairro ?? 'sem bairro',
    servico ?? 'sem grupo de serviço',
    janela ? `janela ${janela}` : 'sem janela',
    `${hhmm(p.inicio) ?? 'sem início'}${encerrou ? ` até ${encerrou}` : ', em curso'}`,
    SITUACAO_INFO[p.situacao]?.label ?? p.situacao,
    p.baixa_codigos
      ? `baixa ${p.baixa_origem === 'AFLINE' ? 'da AFLINE' : 'da operadora'}`
        + ` ${p.baixa_codigos}`
      : '',
    km != null ? `${num(km)} km desde a parada anterior` : '',
    p.voltou_ao_bairro ? 'voltou a um bairro onde já esteve hoje' : '',
    p.tec1 === 'SEM_PADRAO' ? 'fora da janela combinada' : '',
  ].filter(Boolean).join(' · ')

  return (
    <li className="flex shrink-0 items-stretch">
      {/* ---- o trecho ---- */}
      {!primeiro && (
        <span className="flex w-11 shrink-0 flex-col items-center justify-center px-0.5
                         text-center"
          aria-hidden>
          <span className={`tabular text-[9px] font-semibold leading-tight ${
            salto ? 'text-af-400' : 'text-graf-400'}`}>
            {km != null ? num(km) : '—'}
          </span>
          <span className={`my-0.5 h-px w-full ${
            salto ? 'bg-af-500' : 'bg-graf-700'}`} />
          <span className="text-[8px] leading-tight text-graf-400">
            {salto ? '⚑' : parado != null ? duracao(parado) : 'km'}
          </span>
        </span>
      )}
      {primeiro && <span className="w-1 shrink-0" aria-hidden />}

      {/* ---- a parada ---- */}
      <div
        draggable={movel}
        onDragStart={e => {
          if (!movel) return
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', p.visita_id)
          onArrastar(p.visita_id)
        }}
        onDragEnd={() => onArrastar(null)}
        className={`parada-cartao ${arrastando ? 'parada-arrastando' : ''} ${
          movel ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{ ['--parada-cor' as string]: cor }}>

        <button onClick={onAbrir} title={rotulo} aria-label={rotulo}
          className="block w-full px-1.5 py-1 text-left">
          <span className="block truncate text-[11px] font-semibold leading-tight
                           text-graf-100">
            {p.bairro ?? <span className="font-normal text-graf-400">sem bairro</span>}
          </span>

          {/* A janela é o COMBINADO; a execução é o que houve. As duas
              juntas, e distintas pelo peso — o controlador compara as
              duas o tempo todo, e separá-las em telas diferentes era
              obrigá-lo a decorar uma. */}
          <span className="tabular mt-0.5 block text-[9px] leading-tight text-graf-400">
            {janela ?? 'sem janela'}
          </span>
          <span className="tabular block text-[10px] font-semibold leading-tight
                           text-graf-200">
            {hhmm(p.inicio) ?? '--:--'}
            <span className="text-graf-400"> → </span>
            {encerrou ?? <span className="font-normal text-graf-400">em curso</span>}
          </span>

          <span className="mt-1 flex items-center gap-1">
            <span className="min-w-0 truncate rounded-sm bg-graf-800 px-1 text-[8px]
                             font-semibold uppercase tracking-wide text-graf-300">
              {servico ?? 'sem grupo'}
            </span>
            {/* O código é a prova do que aconteceu — e a etiqueta diz de
                QUEM é a baixa, porque a da operadora e a nossa divergem. */}
            {p.baixa_codigos && (
              <span title={p.baixa_detalhe ?? undefined}
                className={`tabular shrink-0 rounded-sm px-1 text-[8px] font-semibold ${
                  p.baixa_origem === 'AFLINE'
                    ? 'bg-emerald-900/40 text-emerald-300'
                    // graf-400 sobre graf-800 media 4,35:1 -- passa raspando
                    // por baixo do minimo. graf-300 da 6,26:1.
                    : 'bg-graf-800 text-graf-300'}`}>
                {p.baixa_codigos}
              </span>
            )}
            {/* Divergência com SÍMBOLO + título, nunca só cor. */}
            {p.voltou_ao_bairro && (
              <span title="Voltou a um bairro onde já esteve hoje"
                className="shrink-0 text-[10px] font-semibold text-af-400">↩</span>
            )}
            {p.tec1 === 'SEM_PADRAO' && (
              <span title="Fora da janela combinada (TEC1, calculado pelo servidor)"
                className="shrink-0 text-[10px] font-semibold text-amber-400">⧗</span>
            )}
          </span>
        </button>

        {/* O mesmo caminho do arrasto, pelo teclado. Arrastar sozinho
            deixaria a transferência inacessível a quem não usa mouse. */}
        {movel && (
          <button onClick={onMover}
            title={`Transferir o contrato ${p.contrato ?? ''} para outra faixa`}
            aria-label={`Transferir o contrato ${p.contrato ?? 'sem número'} para outra faixa`}
            className="parada-mover">
            ⇄
          </button>
        )}
      </div>
    </li>
  )
}

/* ================================================================== */

/** O painel que confirma a transferência — do arrasto ou do teclado. */
function PainelMover({ parada: p, faixas, destinoLogin, mesmaEquipe, motivo,
                       ocupado, onDestino, onMotivo, onConfirmar, onFechar }: {
  parada: Parada
  faixas: { login: string; nome: string | null; equipe: string | null
            equipeId: string | null }[]
  destinoLogin: string | null
  mesmaEquipe: boolean
  motivo: string
  ocupado: boolean
  onDestino: (login: string) => void
  onMotivo: (m: string) => void
  onConfirmar: () => void
  onFechar: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    caixa.current?.querySelector<HTMLElement>('select, input')?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const destino = faixas.find(f => f.login === destinoLogin) ?? null
  const podeIr = Boolean(destino?.equipeId) && !mesmaEquipe && !ocupado
  const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
                'outline-none focus:border-af-500'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4
                    sm:items-center"
      role="dialog" aria-modal="true" aria-labelledby="mover-titulo"
      onClick={e => { if (e.target === e.currentTarget) onFechar() }}>
      <div ref={caixa} className="card-controle w-full max-w-lg p-4">
        <h2 id="mover-titulo" className="text-sm font-semibold">
          Transferir contrato {p.contrato ?? 'sem número'}
        </h2>
        <p className="mt-1 text-xs text-graf-400">
          {p.bairro ?? 'sem bairro'} · {p.tipo_servico ?? 'sem grupo'} · sai da equipe{' '}
          <strong>{p.equipe ? equipeRotulo(p.equipe) : 'sem equipe'}</strong>.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-[11px] text-graf-400">
            <span className="mb-1 block">Faixa de destino</span>
            <select value={destinoLogin ?? ''} className={`${campo} w-full`}
              onChange={e => onDestino(e.target.value)}>
              <option value="">— escolha —</option>
              {faixas.filter(f => f.login !== p.login).map(f => (
                <option key={f.login} value={f.login}>
                  {f.login} · {f.nome ?? 'sem nome'}
                  {f.equipe ? ` · ${equipeRotulo(f.equipe)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-graf-400">
            <span className="mb-1 block">Motivo</span>
            <input value={motivo} onChange={e => onMotivo(e.target.value)}
              placeholder="Por que está transferindo?" className={`${campo} w-full`} />
          </label>
        </div>

        {/* A armadilha do modelo, dita antes de falhar: a faixa é o LOGIN,
            a transferência é por EQUIPE. */}
        {mesmaEquipe && (
          <p className="mt-3 rounded-md border border-amber-900/50 bg-amber-950/30 px-3
                        py-2 text-[11px] text-amber-300">
            Essa faixa é da <strong>mesma equipe</strong> ({destino?.equipe}). O que o
            sistema transfere é a equipe dona do contrato, não o login do TOA — mover
            entre dois logins da mesma equipe não muda nada.
          </p>
        )}

        <p className="mt-3 text-[11px] text-graf-400">
          A transferência fica no histórico, com autor e motivo, e <strong>fixa a
          rota</strong>: a próxima importação do TOA não desfaz o que você decidiu aqui.
        </p>

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onFechar}
            className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                       hover:border-graf-600 hover:text-graf-100">
            Cancelar
          </button>
          <button onClick={onConfirmar} disabled={!podeIr}
            className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                       hover:bg-af-500 disabled:opacity-40">
            {ocupado ? 'Transferindo…' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */

const RECADO_CHAVE = 'recusou'

/**
 * O endereço que o Google quer ver autorizado — calculado AQUI, na hora.
 * Texto fixo mandaria autorizar o endereço errado quando a porta muda.
 */
const ORIGEM_A_AUTORIZAR = `${window.location.origin}/*`

/**
 * O dia no espaço: um pino por contrato, na cor da equipe.
 *
 * > "a visão do mapa deverá mostrar as equipes em campo e o que eles
 * >  têm pra executar" — Emanuel, 14/09
 *
 * Era bolha por bairro (agregado). Agora é o contrato onde ele está, e
 * a cor responde DE QUEM É — que é a pergunta do despacho. O pino
 * pendente é sólido; o encerrado é vazado: o que já acabou não disputa
 * a atenção com o que falta.
 *
 * ┌─ LGPD ───────────────────────────────────────────────────────────┐
 * │ O pino fica no endereço do assinante, então a janela de           │
 * │ informação mostra CONTRATO, bairro, janela e situação — e mais    │
 * │ nada. Nome e telefone não vêm de `rota_do_dia` e não vão entrar:  │
 * │ quem precisa do cadastro abre o contrato, onde o acesso é         │
 * │ registrado. Para o Google vai só a área da tela, para o ladrilho. │
 * └───────────────────────────────────────────────────────────────────┘
 */
function MapaDoDia({ paradas, bairros, corEquipe, corBairro, foco }: {
  paradas: Parada[]
  bairros: BairroLinha[]
  corEquipe: (c: string | null) => string
  corBairro: (t: number) => string
  foco: string | null
}) {
  const [tema] = useTema()
  const div = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<google.maps.Map | null>(null)
  const marcas = useRef<google.maps.Marker[]>([])
  /** Com que tema o mapa que está na tela foi construído. */
  const temaDoMapa = useRef<string | null>(null)
  /** Sobe a cada mapa novo, para os pinos serem redesenhados nele. */
  const [versao, setVersao] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState(false)

  const pontos = useMemo(
    () => paradas.filter(p => p.lat != null && p.lng != null
                              && (!foco || p.login === foco)),
    [paradas, foco])

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

  // ┌─ o mapa se REFAZ quando o tema muda ─────────────────────────┐
  // │ `colorScheme` é opção de CONSTRUÇÃO: não existe               │
  // │ `setOptions({colorScheme})`. Sem isto, trocar para o tema      │
  // │ escuro deixava um mapa branco de holofote no meio de uma tela  │
  // │ grafite — e o defeito só aparecia DEPOIS de alternar, que é    │
  // │ por que ele passou na primeira conferência.                    │
  // └────────────────────────────────────────────────────────────────┘
  useEffect(() => {
    if (!pronto || !div.current) return
    if (mapa.current && temaDoMapa.current === tema) return
    if (mapa.current) {
      for (const x of marcas.current) x.setMap(null)
      marcas.current = []
      div.current.innerHTML = ''
    }
    temaDoMapa.current = tema
    mapa.current = new google.maps.Map(div.current, {
      center: { lat: -3.1, lng: -60.0 },
      zoom: 11,
      colorScheme: tema === 'claro' ? 'LIGHT' : 'DARK',
      mapTypeControl: true,
      mapTypeControlOptions: {
        mapTypeIds: ['roadmap', 'satellite', 'hybrid', 'terrain'],
      },
      streetViewControl: true,
      fullscreenControl: true,
      rotateControl: false,
      // Rolar a PÁGINA não pode virar zoom sem querer.
      gestureHandling: 'cooperative',
    })
    setVersao(v => v + 1)
  }, [pronto, tema])

  useEffect(() => {
    const m = mapa.current
    if (!m) return
    for (const x of marcas.current) x.setMap(null)
    marcas.current = []
    if (pontos.length === 0) return

    const limites = new google.maps.LatLngBounds()
    const info = new google.maps.InfoWindow()

    // Encerrados primeiro: o pendente fica por cima e continua clicável.
    const ordenados = [...pontos].sort(
      (a, b) => Number(TERMINAIS.includes(a.situacao))
                - Number(TERMINAIS.includes(b.situacao)))

    for (const p of ordenados) {
      const pos = { lat: p.lat as number, lng: p.lng as number }
      limites.extend(pos)
      const c = corEquipe(p.equipe)
      const feito = TERMINAIS.includes(p.situacao)
      // `Marker` é legado em favor de `AdvancedMarkerElement`, que exige
      // um `mapId` criado no Cloud Console. Quando o mapId existir, é só
      // este bloco que muda.
      const marca = new google.maps.Marker({
        position: pos,
        map: m,
        title: `${p.contrato ?? 'sem contrato'} · ${p.bairro ?? 'sem bairro'}`
             + ` · ${SITUACAO_INFO[p.situacao]?.label ?? p.situacao}`,
        zIndex: feito ? 1 : 10,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: feito ? 6 : 8.5,
          fillColor: c,
          fillOpacity: feito ? 0.15 : 0.9,
          strokeColor: c,
          strokeWeight: feito ? 1.2 : 2.2,
        },
      })
      marca.addListener('click', () => {
        const janela = p.janela_inicio
          ? `${p.janela_inicio.slice(0, 5)}–${(p.janela_fim ?? '').slice(0, 5) || '?'}`
          : 'sem janela'
        info.setContent(
          `<div style="color:#111;font:500 12px/1.5 system-ui;min-width:11rem">
             <strong style="font-size:13px">${p.contrato ?? 'sem contrato'}</strong><br>
             ${p.bairro ?? 'sem bairro'} · ${p.tipo_servico ?? 'sem grupo'}<br>
             janela ${janela} · ${SITUACAO_INFO[p.situacao]?.label ?? p.situacao}<br>
             <span style="color:#555">equipe ${p.equipe ?? '—'} · ${p.login}</span>
           </div>`)
        info.open({ map: m, anchor: marca })
      })
      marcas.current.push(marca)
    }

    if (pontos.length === 1) { m.setCenter(limites.getCenter()); m.setZoom(15) }
    else m.fitBounds(limites, 48)

    return () => info.close()
  }, [pontos, corEquipe, pronto, versao])

  if (!temChaveDoMapa || erro) {
    return (
      <div>
        <MapaBairrosSVG bairros={bairros} cor={corBairro} />
        <div className="px-3 pb-2.5 text-[11px] leading-relaxed text-graf-400">
          {erro === RECADO_CHAVE ? (
            <>
              <strong className="text-amber-400">
                O Google recusou a chave nesta tela.
              </strong>{' '}
              Mostrando a posição relativa dos bairros. São <strong>duas</strong>{' '}
              listas na mesma página do Cloud Console (Credenciais → a chave), e o mapa
              só desenha se passar nas duas — o console do navegador diz em qual parou:
              <span className="mt-1 block">
                <strong>1.</strong> <em>Restrições de aplicativo</em> →{' '}
                <em>Referenciadores HTTP</em> tem de conter este endereço
                (<code>RefererNotAllowedMapError</code>):
              </span>
              <code className="mt-1 block w-fit select-all rounded bg-graf-900 px-2 py-1
                               text-[11px] text-graf-200">
                {ORIGEM_A_AUTORIZAR}
              </code>
              <span className="mt-1 block">
                A <strong>porta</strong> faz parte: <code>localhost/*</code> não libera{' '}
                <code>localhost:5173</code>.
              </span>
              <span className="mt-1 block">
                <strong>2.</strong> <em>Restrições de API</em> tem de incluir a{' '}
                <strong>Maps JavaScript API</strong>
                (<code>ApiTargetBlockedMapError</code>).
              </span>
            </>
          ) : erro ? (
            <>{erro} Mostrando a posição relativa dos bairros.</>
          ) : (
            <>
              Mapa em posição relativa. Para ver ruas e satélite, preencha{' '}
              <code className="text-graf-400">VITE_GOOGLE_MAPS_API_KEY</code> no{' '}
              <code className="text-graf-400">app/.env</code>.
            </>
          )}
        </div>
      </div>
    )
  }

  if (pontos.length === 0) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center p-6 text-center
                      text-xs text-graf-400">
        {foco
          ? 'Este técnico não tem contrato com coordenada neste dia.'
          : 'Sem coordenada neste dia para desenhar o mapa.'}
      </div>
    )
  }

  return (
    <div className="relative min-h-[26rem]">
      <div ref={div} className="absolute inset-0" />
      {!pronto && (
        <div role="status"
          className="absolute inset-0 flex items-center justify-center text-xs
                     text-graf-400">
          Carregando o mapa…
        </div>
      )}
    </div>
  )
}

/**
 * A rede: posição RELATIVA dos bairros em SVG (D-010, gráfico à mão).
 * Aparece sem chave, sem rede e em clone novo do repositório — tela que
 * depende de terceiro para existir some quando o terceiro cai.
 */
function MapaBairrosSVG({ bairros, cor }: {
  bairros: BairroLinha[]; cor: (t: number) => string
}) {
  const pontos = bairros.filter(b => b.lat != null && b.lng != null)
  if (pontos.length < 2) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center p-6 text-center
                      text-xs text-graf-400">
        Sem coordenada suficiente neste dia para desenhar o mapa.
      </div>
    )
  }
  const W = 720, H = 420, M = 34
  const xs = pontos.map(p => p.lng as number), ys = pontos.map(p => p.lat as number)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const px = (v: number) => M + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * M)
  const py = (v: number) => H - M - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * M)
  const r = (v: number) => 6 + Math.sqrt(v) * 3.2

  return (
    <div className="overflow-x-auto p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[36rem]" role="img"
        aria-label={`Posição relativa de ${pontos.length} bairros do dia`}>
        {[...pontos].sort((a, b) => b.visitas - a.visitas).map(b => {
          const cx = px(b.lng as number), cy = py(b.lat as number), rr = r(b.visitas)
          const c = cor(b.tecnicos)
          return (
            <g key={b.bairro}>
              <title>{`${b.bairro} · ${b.visitas} visitas · ${b.tecnicos} técnicos`}</title>
              <circle cx={cx} cy={cy} r={rr} fill={c} opacity={0.22} />
              <circle cx={cx} cy={cy} r={rr} fill="none" stroke={c} strokeWidth={1.5} />
              <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10.5}
                    fontWeight={600} fill={c} className="tabular">
                {b.tecnicos}
              </text>
              {b.visitas >= 8 && (
                <text x={cx} y={cy - rr - 4} textAnchor="middle" fontSize={9.5}
                      fill="currentColor" className="fill-graf-400">
                  {b.bairro}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
