import { useEffect, useMemo, useRef, useState } from 'react'
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
 * Rota do Dia — a terceira visão (D-111).
 *
 * ┌─ A PERGUNTA QUE FALTAVA ────────────────────────────────────────┐
 * │ Serviços responde "o que aconteceu neste contrato".              │
 * │ Equipes responde "o que a 014 tem hoje".                         │
 * │ Nenhuma responde "A ROTA ESTÁ AJUSTADA?" — e o Console de        │
 * │ Alocação do TOA também não: ele mostra se o técnico está         │
 * │ ocupado, não se faz sentido onde ele está.                        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Três painéis, na ordem em que o COP pensa: onde olhar (alertas), o
 * dia no tempo (linha do tempo com o BAIRRO no bloco, não o tipo de
 * serviço) e o dia no espaço (bairros pela coordenada média).
 *
 * ⚠ O que esta tela NÃO sabe, e diz na cara: o trajeto percorrido (o
 * TOA manda pontos, não caminho), onde o técnico está agora (sem GPS
 * ao vivo) e a distância de rua — o km aqui é linha reta.
 */

interface Parada {
  visita_id: string
  contrato: string | null
  login: string
  tecnico: string | null
  equipe: string | null
  bairro: string | null
  area: string | null
  lat: number | null
  lng: number | null
  inicio: string | null
  fim: string | null
  janela_inicio: string | null
  janela_fim: string | null
  situacao: Situacao
  tipo_servico: string | null
  ordem: number
  km_desde_anterior: number | null
  voltou_ao_bairro: boolean
}
interface BairroLinha {
  bairro: string; visitas: number; tecnicos: number; equipes: number
  concluidas: number; em_aberto: number; lat: number | null; lng: number | null
}
interface AlertaLinha {
  tipo: 'RETORNO' | 'SALTO' | 'PULVERIZADO'
  gravidade: 'ALTA' | 'MEDIA'
  login: string | null; tecnico: string | null; bairro: string | null
  titulo: string; detalhe: string; valor: number | null
}
interface Resumo {
  visitas: number; tecnicos: number; bairros: number
  km_total: number | null; km_medio: number | null; maior_salto: number | null
  com_coordenada: number; retornos: number; bairros_pulverizados: number
}

/**
 * Quantos técnicos pisaram o mesmo bairro hoje. Três é o limite em que
 * ainda dá para chamar de cobertura; de sete em diante é pulverização.
 *
 * ┌─ por que HEX e não `var(--st-...)` ──────────────────────────────┐
 * │ O Google Maps pinta em canvas, não em CSS: `fillColor` com        │
 * │ `var(--st-conflito)` não resolve — sai preto, calado. Então as    │
 * │ cores vêm escritas, e escritas IGUAIS às da rampa da casa         │
 * │ (styles.css): conflito, reagendamento e execução. Antes eram três │
 * │ tons soltos do ngestor (#d33724, #DAA520, #3c8dbc) que não        │
 * │ batiam com nenhuma outra tela.                                     │
 * │                                                                    │
 * │ Fora do componente de propósito: dentro, ela nascia nova a cada    │
 * │ render e faria o mapa redesenhar todas as bolhas sem motivo.       │
 * └────────────────────────────────────────────────────────────────────┘
 */
const corBairro = (t: number) =>
  t >= 7 ? '#e4262f' : t >= 4 ? '#f59e0b' : '#3b82f6'

const hhmm = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
/** Minutos desde a meia-noite, no fuso de Manaus. */
const minutos = (ts: string | null) => {
  if (!ts) return null
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes()
}
const num = (n: number | null | undefined, casas = 1) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas,
                                                maximumFractionDigits: casas })

export default function Rota() {
  const navegar = useNavigate()
  // HOJE. Abria no último dia com visita, e a rota de ontem sob a data
  // de hoje é a pior das confusões numa tela de despacho (lib/dia.ts).
  const [data, setData] = useState(isoLocal())
  const [paradas, setParadas] = useState<Parada[]>([])
  const [bairros, setBairros] = useState<BairroLinha[]>([])
  const [alertas, setAlertas] = useState<AlertaLinha[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [foco, setFoco] = useState<string | null>(null)   // login em foco
  /** Atalho do estado vazio: o último dia com movimento, quando não é
   *  o dia na tela. A rota abre em HOJE (ver lib/dia.ts). */
  const outroDia = useDiaAnteriorComMovimento(data)

  useEffect(() => {
    if (!data) return
    let vivo = true
    setCarregando(true); setErro(null); setFoco(null)
    Promise.all([
      supabase.rpc('rota_do_dia', { p_data: data }),
      supabase.rpc('rota_bairros', { p_data: data }),
      supabase.rpc('rota_alertas', { p_data: data }),
      supabase.rpc('rota_resumo', { p_data: data }),
    ]).then(([p, b, a, r]) => {
      if (!vivo) return
      if (p.error) setErro(p.error.message)
      setParadas((p.data ?? []) as Parada[])
      setBairros((b.data ?? []) as BairroLinha[])
      setAlertas((a.data ?? []) as AlertaLinha[])
      setResumo((r.data ?? null) as Resumo | null)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [data])

  /** Um técnico por faixa, na ordem de quem mais rodou. */
  const porTecnico = useMemo(() => {
    const m = new Map<string, Parada[]>()
    for (const p of paradas) m.set(p.login, [...(m.get(p.login) ?? []), p])
    return [...m.entries()]
      .map(([login, ps]) => ({
        login, paradas: ps,
        nome: ps.find(p => p.tecnico)?.tecnico ?? null,
        equipe: ps.find(p => p.equipe)?.equipe ?? null,
        km: ps.reduce((s, p) => s + (p.km_desde_anterior ?? 0), 0),
        bairros: new Set(ps.map(p => p.bairro).filter(Boolean)).size,
        retornos: ps.filter(p => p.voltou_ao_bairro).length,
      }))
      .sort((a, b) => b.km - a.km)
  }, [paradas])

  const visiveis = foco ? porTecnico.filter(t => t.login === foco) : porTecnico

  // Escala da linha do tempo: do primeiro início ao último fim do dia,
  // arredondado para a hora cheia. Fixar 8h–18h cortaria o técnico que
  // encerrou 23:30 — e é justamente ele que interessa.
  const [h0, h1] = useMemo(() => {
    const ms = paradas.flatMap(p => [minutos(p.inicio), minutos(p.fim)])
      .filter((n): n is number => n != null)
    if (!ms.length) return [8 * 60, 18 * 60]
    return [Math.floor(Math.min(...ms) / 60) * 60, Math.ceil(Math.max(...ms) / 60) * 60]
  }, [paradas])

  const cor = (s: Situacao) => SITUACAO_INFO[s]?.cor ?? '#64748b'
  const pct = (m: number) => ((m - h0) / (h1 - h0)) * 100
  const horas = useMemo(() => {
    const passo = (h1 - h0) / 60 > 10 ? 120 : 60
    const l: number[] = []
    for (let m = h0; m <= h1; m += passo) l.push(m)
    return l
  }, [h0, h1])

  return (
    <Shell acoes={
      <input type="date" value={data} onChange={e => setData(e.target.value)}
        className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
    }>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Rota do dia</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            O dia inteiro no tempo e no espaço. <strong>Serviços</strong> responde o que
            houve num contrato, <strong>Equipes</strong> o que a equipe tem hoje — aqui a
            pergunta é se a rota está ajustada.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

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
                {nota && <div className="mt-0.5 text-[10px] text-graf-600">{nota}</div>}
              </div>
            ))}
          </div>
        )}

        {carregando ? (
          <p className="py-16 text-center text-graf-400">Carregando o dia…</p>
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

          {/* ====== 1. onde olhar ====== */}
          {alertas.length > 0 && (
            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold">
                  O que precisa de olho
                  <span className="tabular ml-2 text-xs font-normal text-graf-500">
                    {alertas.length}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-graf-500">
                  Os limites — 10 km de salto, 5 técnicos por bairro — saíram do que o
                  próprio dia mostrou como fora da curva. Não são meta da CLARO.
                </p>
              </div>
              <div className="max-h-72 overflow-auto">
                {alertas.map((a, i) => (
                  <button key={i}
                    onClick={() => a.login && setFoco(foco === a.login ? null : a.login)}
                    className="flex w-full items-start gap-3 border-b border-graf-800 px-4 py-2
                               text-left last:border-0 hover:bg-graf-850">
                    <span className={`mt-0.5 w-1 self-stretch rounded ${
                      a.gravidade === 'ALTA' ? 'bg-af-500' : 'bg-amber-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-graf-200">{a.titulo}</span>
                      <span className="mt-0.5 block text-[11px] text-graf-400">
                        {a.login && (
                          <span className="tabular mr-1.5 text-graf-300">{a.login}</span>
                        )}
                        {a.tecnico && <span className="mr-1.5">{a.tecnico}</span>}
                        {a.detalhe}
                      </span>
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase
                                      tracking-wide ${a.gravidade === 'ALTA'
                        ? 'bg-af-900/40 text-af-300' : 'bg-amber-900/40 text-amber-300'}`}>
                      {a.tipo.toLowerCase()}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ====== 2. o dia no tempo ====== */}
          <section className="card-controle overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-2 border-b border-graf-800 px-4 py-2.5">
              <h2 className="text-sm font-semibold">O dia no tempo</h2>
              <span className="text-xs text-graf-500">
                cada bloco é uma visita, com o bairro escrito
              </span>
              {foco && (
                <button onClick={() => setFoco(null)}
                  className="ml-auto text-xs text-af-400 underline underline-offset-2">
                  ver todos os {porTecnico.length} técnicos
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[52rem] px-4 py-3">
                {/* régua */}
                <div className="relative mb-1.5 ml-40 h-4">
                  {horas.map(m => (
                    <span key={m} style={{ left: `${pct(m)}%` }}
                      className="tabular absolute -translate-x-1/2 text-[10px] text-graf-500">
                      {String(Math.floor(m / 60)).padStart(2, '0')}h
                    </span>
                  ))}
                </div>

                {visiveis.map(t => (
                  <div key={t.login} className="mb-1.5 flex items-stretch gap-2">
                    <button onClick={() => setFoco(foco === t.login ? null : t.login)}
                      className="w-38 shrink-0 pr-2 text-left" style={{ width: '9.5rem' }}>
                      <span className="tabular block truncate text-[11px] font-medium text-graf-200">
                        {t.login}
                      </span>
                      <span className="block truncate text-[10px] text-graf-500">
                        {t.nome ?? (t.equipe ? equipeRotulo(t.equipe) : 'sem nome no TOA')}
                      </span>
                      <span className="tabular block text-[10px] text-graf-600">
                        {num(t.km, 0)} km · {t.bairros} bairros
                        {t.retornos > 0 && (
                          <span className="ml-1 text-af-400">· {t.retornos} ↩</span>
                        )}
                      </span>
                    </button>

                    <div className="relative min-h-[2.1rem] flex-1 rounded bg-graf-900">
                      {horas.map(m => (
                        <span key={m} style={{ left: `${pct(m)}%` }}
                          className="absolute inset-y-0 w-px bg-graf-800" />
                      ))}
                      {t.paradas.map(p => {
                        const i = minutos(p.inicio), f = minutos(p.fim)
                        if (i == null) return null
                        const largura = Math.max(pct(f ?? i + 20) - pct(i), 1.4)
                        return (
                          <button key={p.visita_id}
                            onClick={() => navegar(`/controle/visita/${p.visita_id}`)}
                            title={`${p.contrato ?? 'sem contrato'} · ${p.bairro ?? 'sem bairro'}`
                              + ` · ${hhmm(p.inicio)}–${hhmm(p.fim) ?? '?'}`
                              + ` · ${SITUACAO_INFO[p.situacao]?.label ?? p.situacao}`
                              + (p.km_desde_anterior != null
                                  ? ` · ${num(p.km_desde_anterior)} km desde a anterior` : '')}
                            style={{
                              left: `${pct(i)}%`, width: `${largura}%`,
                              background: cor(p.situacao),
                              opacity: p.situacao === 'ENTRADA' ? 0.45 : 0.9,
                            }}
                            className="absolute inset-y-1 overflow-hidden rounded-sm px-1
                                       text-left text-[9px] font-semibold text-white
                                       hover:ring-2 hover:ring-white/40">
                            {p.voltou_ao_bairro && '↩ '}
                            {p.bairro ?? ''}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-graf-800 px-4 py-2
                            text-[10px] text-graf-500">
              {(['CONCLUIDA', 'EM_EXECUCAO', 'EM_DESLOCAMENTO', 'REAGENDAMENTO',
                 'CANCELADA', 'ENTRADA'] as Situacao[]).map(s => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm" style={{ background: cor(s) }} />
                  {SITUACAO_INFO[s]?.label ?? s}
                </span>
              ))}
              <span className="ml-auto">↩ voltou a um bairro onde já esteve hoje</span>
            </div>
          </section>

          {/* ====== 3. o dia no espaço ====== */}
          <section className="card-controle overflow-hidden">
            <div className="flex flex-wrap items-baseline gap-2 border-b border-graf-800 px-4 py-2.5">
              <h2 className="text-sm font-semibold">O dia no espaço</h2>
              <span className="text-xs text-graf-500">
                bolha = bairro, na coordenada média · tamanho = visitas · cor = técnicos
                · troque a camada no canto do mapa (mapa, satélite, híbrido) e arraste
                o boneco para o Street View
              </span>
            </div>
            <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
              <MapaBairros bairros={bairros} cor={corBairro} />
              <div className="max-h-[26rem] overflow-auto border-t border-graf-800 lg:border-l lg:border-t-0">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-graf-700 bg-graf-900 text-left
                                    text-[10px] uppercase tracking-wide text-graf-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Bairro</th>
                      <th className="px-3 py-2 text-right font-medium">Visitas</th>
                      <th className="px-3 py-2 text-right font-medium">Téc.</th>
                      <th className="px-3 py-2 text-right font-medium">Concl.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bairros.map(b => (
                      <tr key={b.bairro} className="border-b border-graf-800">
                        <td className="px-3 py-1.5 text-xs text-graf-200">{b.bairro}</td>
                        <td className="tabular px-3 py-1.5 text-right text-xs">{b.visitas}</td>
                        <td className="px-3 py-1.5 text-right">
                          <span className="tabular rounded px-1.5 py-0.5 text-xs font-semibold"
                            style={{ color: corBairro(b.tecnicos),
                                     background: `color-mix(in srgb, ${corBairro(b.tecnicos)} 16%, transparent)` }}>
                            {b.tecnicos}
                          </span>
                        </td>
                        <td className="tabular px-3 py-1.5 text-right text-xs text-graf-400">
                          {b.concluidas}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <p className="pb-6 text-center text-xs text-graf-600">
            {resumo?.com_coordenada ?? 0} de {resumo?.visitas ?? 0} visitas com coordenada ·
            distância em linha reta, não trajeto de rua · esta tela é do dia agendado,
            não é rastreamento ao vivo
          </p>
        </>)}
      </div>
    </Shell>
  )
}

/**
 * O dia no espaço, sobre o mapa de verdade.
 *
 * ┌─ o que mudou, e por quê ─────────────────────────────────────────┐
 * │ > "devemos colocar o mapa do google aí com as camadas de visão    │
 * │ >  satélite e visão street view" — Emanuel, 14/09                 │
 * │                                                                   │
 * │ Antes era SVG puro: as bolhas numa caixa vazia, posição RELATIVA  │
 * │ entre bairros. Respondia "está espalhado?" e não respondia "onde"  │
 * │ — quem não conhece Manaus de cor via um diagrama, não uma cidade. │
 * │ Com o mapa embaixo, a mesma bolha passa a dizer QUAL bairro, o    │
 * │ satélite mostra se é área densa ou ramal, e o Street View põe o   │
 * │ COP na esquina antes de despachar.                                │
 * │                                                                   │
 * │ A CODIFICAÇÃO NÃO MUDOU de propósito: tamanho = visitas, cor e    │
 * │ número = técnicos, as mesmas da tabela ao lado. Trocar o fundo    │
 * │ não é motivo para trocar a gramática da tela.                     │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ e o SVG continua existindo ─────────────────────────────────────┐
 * │ `MapaBairrosSVG` não foi apagado: é o que aparece quando não há   │
 * │ chave no `.env`, quando o script do Google não carrega (rede,     │
 * │ chave restrita a outro domínio, cota estourada) e em qualquer     │
 * │ clone novo do repositório. Tela que depende de terceiro para      │
 * │ existir é tela que some quando o terceiro cai.                    │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Continua NÃO sendo rastreamento: é o dia AGENDADO, e a bolha é a
 * média das coordenadas das visitas do bairro — não a casa de ninguém.
 */
/** O recado tem de dizer O QUE FAZER. "Erro no mapa" manda a pessoa
 *  abrir o console; isto manda ela no lugar certo do Cloud Console. */
const RECADO_CHAVE =
  'O Google recusou a chave deste endereço. No Cloud Console, em '
  + 'Credenciais → a chave → Restrições de aplicativo, inclua '
  + 'https://gestor-af.pages.dev/* e http://localhost:5173/*.'

function MapaBairros({ bairros, cor }: {
  bairros: BairroLinha[]; cor: (t: number) => string
}) {
  const [tema] = useTema()
  const div = useRef<HTMLDivElement | null>(null)
  const mapa = useRef<google.maps.Map | null>(null)
  const marcas = useRef<google.maps.Marker[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [pronto, setPronto] = useState(false)

  const pontos = useMemo(
    () => bairros.filter(b => b.lat != null && b.lng != null),
    [bairros])

  // 1. carregar a API uma vez
  useEffect(() => {
    if (!temChaveDoMapa) return
    let vivo = true
    // A chave recusada NÃO chega por `catch`: o script carrega, o mapa é
    // criado, e só então a API pinta o próprio "Ops!" dentro do nosso
    // div. Sem este ouvinte a tela ficaria com um retângulo morto — foi
    // exatamente o que aconteceu na primeira vez que esta tela abriu,
    // com `RefererNotAllowedMapError` em localhost.
    if (autenticacaoFalhou()) setErro(RECADO_CHAVE)
    const cancelar = aoFalharAutenticacao(() => { if (vivo) setErro(RECADO_CHAVE) })
    carregarMapaGoogle()
      .then(() => { if (vivo) setPronto(true) })
      .catch(() => { if (vivo) setErro('O mapa do Google não carregou (rede).') })
    return () => { vivo = false; cancelar() }
  }, [])

  // 2. criar o mapa quando o div existir
  useEffect(() => {
    if (!pronto || !div.current || mapa.current) return
    mapa.current = new google.maps.Map(div.current, {
      center: { lat: -3.1, lng: -60.0 },   // Manaus, até o fitBounds mandar
      zoom: 11,
      // O controle é escuro por padrão (D-011) — mapa branco no meio de
      // uma tela grafite é um holofote. Segue a chave de tema da casa.
      colorScheme: tema === 'claro' ? 'LIGHT' : 'DARK',
      mapTypeControl: true,
      mapTypeControlOptions: {
        mapTypeIds: ['roadmap', 'satellite', 'hybrid', 'terrain'],
      },
      streetViewControl: true,   // o pedido: "visão street view"
      fullscreenControl: true,
      rotateControl: false,
      // Rolar a PÁGINA não pode virar zoom no mapa sem querer: com Ctrl
      // (ou dois dedos) o mapa aceita; sem, a página rola.
      gestureHandling: 'cooperative',
    })
  }, [pronto, tema])

  // 3. redesenhar as bolhas quando os dados mudarem
  useEffect(() => {
    const m = mapa.current
    if (!m) return

    for (const x of marcas.current) x.setMap(null)
    marcas.current = []
    if (pontos.length === 0) return

    const limites = new google.maps.LatLngBounds()
    const info = new google.maps.InfoWindow()

    // Do maior para o menor: a bolha pequena fica POR CIMA e continua
    // clicável. Mesma ordem de desenho do SVG que isto substituiu.
    for (const b of [...pontos].sort((a, z) => z.visitas - a.visitas)) {
      const pos = { lat: b.lat as number, lng: b.lng as number }
      limites.extend(pos)
      const c = cor(b.tecnicos)
      // `Marker` está marcado como legado em favor de
      // `AdvancedMarkerElement` — que exige um `mapId` criado no Cloud
      // Console e um estilo hospedado lá. Não vale trocar uma tela que
      // funciona por uma dependência de console; quando o `mapId`
      // existir, é só este bloco que muda.
      const marca = new google.maps.Marker({
        position: pos,
        map: m,
        title: `${b.bairro} · ${b.visitas} visita(s) · ${b.tecnicos} técnico(s)`,
        zIndex: 1000 - b.visitas,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8 + Math.sqrt(b.visitas) * 3.2,   // mesma escala do SVG
          fillColor: c,
          fillOpacity: 0.32,
          strokeColor: c,
          strokeWeight: 1.6,
        },
        label: {
          text: String(b.tecnicos),
          color: c,
          fontSize: '11px',
          fontWeight: '600',
        },
      })
      marca.addListener('click', () => {
        // Bairro, contagem e concluídas. Nada de assinante: a bolha é
        // média de bairro, e a janela não vai inventar um endereço.
        info.setContent(
          `<div style="color:#111;font:500 12px/1.45 system-ui;min-width:9rem">
             <strong style="font-size:13px">${b.bairro}</strong><br>
             ${b.visitas} visita(s) · ${b.tecnicos} técnico(s)<br>
             ${b.concluidas} concluída(s) · ${b.em_aberto} em aberto
           </div>`)
        info.open({ map: m, anchor: marca })
      })
      marcas.current.push(marca)
    }

    if (pontos.length === 1) { m.setCenter(limites.getCenter()); m.setZoom(14) }
    else m.fitBounds(limites, 48)

    return () => info.close()
  }, [pontos, cor, pronto])

  // Sem chave, ou com o Google fora do ar: o desenho antigo, que não
  // depende de ninguém.
  if (!temChaveDoMapa || erro) {
    return (
      <div>
        <MapaBairrosSVG bairros={bairros} cor={cor} />
        <p className="px-3 pb-2 text-[11px] text-graf-500">
          {erro
            ? `${erro} Mostrando a posição relativa dos bairros.`
            : 'Mapa em posição relativa. Para ver ruas e satélite, preencha '}
          {!erro && <code className="text-graf-400">VITE_GOOGLE_MAPS_API_KEY</code>}
          {!erro && ' no app/.env.'}
        </p>
      </div>
    )
  }

  if (pontos.length === 0) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center p-6 text-center
                      text-xs text-graf-500">
        Sem coordenada neste dia para desenhar o mapa.
      </div>
    )
  }

  return (
    <div className="relative min-h-[26rem]">
      <div ref={div} className="absolute inset-0" />
      {!pronto && (
        <div className="absolute inset-0 flex items-center justify-center
                        text-xs text-graf-500">
          Carregando o mapa…
        </div>
      )}
    </div>
  )
}

/**
 * O mapa de bairros em SVG puro (D-010: gráfico aqui é escrito à mão).
 *
 * Não é mapa de ruas — é a posição RELATIVA dos bairros, pela coordenada
 * média das visitas de cada um. Deixou de ser a única visão (o Google
 * entrou por cima), mas continua sendo a que sempre funciona: sem chave,
 * sem rede e sem conta de terceiro.
 */
function MapaBairrosSVG({ bairros, cor }: {
  bairros: BairroLinha[]; cor: (t: number) => string
}) {
  const pontos = bairros.filter(b => b.lat != null && b.lng != null)
  if (pontos.length < 2) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center p-6 text-center
                      text-xs text-graf-500">
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
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[36rem]">
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
