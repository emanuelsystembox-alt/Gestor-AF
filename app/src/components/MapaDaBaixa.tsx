import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useTema } from '../lib/tema'
import {
  aoFalharAutenticacao, autenticacaoFalhou, camada, carregarMapaGoogle, mapaReaproveitado, temChaveDoMapa,
} from '../lib/mapaGoogle'
import { metrosEntre, textoDistancia, type LocalBaixa } from '../lib/localBaixa'
import { idadeMin, type Aproximacao } from '../lib/aproximacao'

/**
 * O mapa da baixa, numa janela (D-295).
 *
 * > "um botão onde é a casa do cliente, e onde o técnico bateu, o sistema
 * >  mostrar em um pop up de um mapa, qual a distancia que ele bateu da casa
 * >  do cliente, onde ele estava, e é bom ter o botão onde o técnico ta
 * >  dizendo que de fato é a casa do cliente" — Emanuel, 04/11
 *
 * ┌─ os pontos, cada um com a SUA distância até a casa do TOA ────────────┐
 * │ A referência é sempre a coordenada da planilha do TOA (D-281): medir  │
 * │ contra a casa marcada pelo técnico deixaria quem marca na hora "no    │
 * │ raio" por construção. No mapa:                                        │
 * │   · CASA (TOA)   — a coordenada da planilha, com o raio da baixa;     │
 * │   · CASA MARCADA — "você está na casa do cliente?" respondido nesta   │
 * │                    visita (156e) — e, se não houver, a última marca   │
 * │                    do mesmo contrato no mesmo endereço, dita como de  │
 * │                    visita ANTERIOR;                                   │
 * │   · BAIXA        — cada baixa/encerramento do app com GPS (não só o   │
 * │                    mais longe: aqui se vê todos);                     │
 * │   · RASTRO       — baixa dada no TOA: o ponto que `local_da_baixa`    │
 * │                    escolheu, e os pontos da execução, em cinza.       │
 * │ O selo da linha continua sendo o de `local_da_baixa`; esta janela só  │
 * │ mostra de onde ele saiu, sem regra própria de "no raio".              │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ quando não há ponto, a janela diz POR QUÊ (regra 6) ─────────────────┐
 * │ Em 04/11 o Kainan (Manaus) aparecia "com sinal" e nenhum contrato     │
 * │ dele tinha selo: os 26 pontos do dia vieram com precisão de ±2.000 m  │
 * │ e coordenada em grade de ~2 km — o Android com a "localização         │
 * │ precisa" desligada para o app. O rastro descarta acima de 100 m       │
 * │ (`rastro_precisao_max_m`), então a baixa no TOA ficou sem posição,    │
 * │ calada. Agora a janela conta os pontos da execução e diz "só pontos   │
 * │ aproximados", em vez de um mapa vazio.                                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Nada sai daqui para fora do navegador além do que o mapa já pede ao
 * Google (os ladrilhos da área). O endereço não vai em URL nenhuma.
 */

export interface AlvoMapa {
  id: string
  contrato: string | null
}

type Tipo = 'TOA' | 'CASA' | 'CASA_ANTES' | 'APP' | 'RASTRO' | 'PERTO' | 'AGORA'

interface Ponto {
  chave: string
  tipo: Tipo
  lat: number
  lng: number
  precisao_m: number | null
  em: string | null
  quem: string | null
  /** Até a casa do TOA. Nulo no próprio TOA, ou sem coordenada do TOA. */
  dist: number | null
  rotulo: string
}

const COR: Record<Tipo, string> = {
  TOA: '#dc2626', CASA: '#16a34a', CASA_ANTES: '#65a30d', APP: '#2563eb', RASTRO: '#7c3aed',
  PERTO: '#7c3aed', AGORA: '#0891b2',
}
const LETRA: Record<Tipo, string> = {
  TOA: 'C', CASA: 'M', CASA_ANTES: 'M', APP: 'B', RASTRO: 'R', PERTO: 'P', AGORA: 'T',
}
const NOME: Record<Tipo, string> = {
  TOA: 'Casa do cliente (TOA)',
  CASA: 'Casa marcada pelo técnico',
  CASA_ANTES: 'Casa marcada em visita anterior',
  APP: 'Baixa pelo app',
  RASTRO: 'Rastro na baixa do TOA',
  PERTO: 'Mais perto da casa (rastro)',
  AGORA: 'Técnico agora (último ponto)',
}

/** As três situações terminais — a mesma lista de `situacoes_terminais()` (035). */
const TERMINAIS = ['CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO']

/** Tolerância e precisão do rastro: os padrões de `local_da_baixa` (191). */
const TOL_MIN = 10
const PREC_MAX = 100

const hhmm = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' })
  : '—'
const diaHora = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' })
  : '—'

interface Dados {
  toa: { lat: number; lng: number } | null
  endereco: string
  pontos: Ponto[]
  /** Pontos do rastro na execução (para desenhar e para explicar a ausência). */
  rastro: { lat: number; lng: number; precisao_m: number | null; em: string }[]
  raio: number
  baixaNoToa: boolean
  /** Ainda não encerrou: o rastro vai até agora, e não há baixa para mostrar. */
  aberto: boolean
}

async function carregar(id: string): Promise<Dados> {
  const [vq, marcas, casa, evs, loc, par, apx] = await Promise.all([
    supabase.from('visita')
      .select('id, logradouro, complemento, bairro, lat, lng, inicio, fim, finalizado_toa, situacao, tecnico_responsavel_id')
      .eq('id', id).maybeSingle(),
    supabase.rpc('casa_marcada_na_visita', { p_visitas: [id] }),
    supabase.rpc('casa_do_cliente', { p_visitas: [id] }),
    supabase.from('visita_evento')
      .select('id, criado_em, tipo, login, lat, lng, precisao_m, para')
      .eq('visita_id', id).eq('origem', 'MOBILE').not('lat', 'is', null)
      .order('criado_em'),
    supabase.rpc('local_da_baixa', { p_visitas: [id] }),
    supabase.from('parametro').select('valor').eq('chave', 'raio_baixa_m').maybeSingle(),
    // 190: o último ponto do técnico, o mesmo do selo "a caminho / no raio"
    supabase.rpc('aproximacao_do_tecnico', { p_visitas: [id] }),
  ])
  if (vq.error) throw vq.error
  const v = vq.data as {
    lat: number | null; lng: number | null; logradouro: string | null; complemento: string | null
    bairro: string | null; inicio: string | null; fim: string | null; finalizado_toa: boolean
    situacao: string; tecnico_responsavel_id: string | null
  } | null
  if (!v) throw new Error('Contrato fora do seu alcance.')

  const toa = v.lat != null && v.lng != null ? { lat: Number(v.lat), lng: Number(v.lng) } : null
  const ate = (lat: number, lng: number) => toa ? metrosEntre(lat, lng, toa.lat, toa.lng) : null
  const pontos: Ponto[] = []

  // A casa marcada NESTA visita (a mais recente vem primeiro na lista).
  type Marca = { lat: number; lng: number; precisao_m: number | null; marcado_em: string; marcado_por: string | null }
  const daVisita = ((marcas.data ?? []) as Marca[])
    .sort((a, b) => b.marcado_em.localeCompare(a.marcado_em))
  daVisita.forEach((m, i) => pontos.push({
    chave: `casa-${i}`, tipo: 'CASA', lat: Number(m.lat), lng: Number(m.lng),
    precisao_m: m.precisao_m, em: m.marcado_em, quem: m.marcado_por,
    dist: ate(Number(m.lat), Number(m.lng)),
    rotulo: i === 0 ? NOME.CASA : `${NOME.CASA} (marca anterior)`,
  }))
  // Sem marca nesta visita: a última do contrato no mesmo endereço (156e).
  const ant = ((casa.data ?? []) as (Marca & { marcas: number })[])[0]
  if (!daVisita.length && ant) {
    pontos.push({
      chave: 'casa-antes', tipo: 'CASA_ANTES', lat: Number(ant.lat), lng: Number(ant.lng),
      precisao_m: ant.precisao_m, em: ant.marcado_em, quem: ant.marcado_por,
      dist: ate(Number(ant.lat), Number(ant.lng)), rotulo: NOME.CASA_ANTES,
    })
  }

  // Cada baixa/encerramento do app com GPS — onde ele "bateu".
  type Ev = { id: string; criado_em: string; tipo: string; login: string | null
              lat: number; lng: number; precisao_m: number | null; para: { situacao?: string } | null }
  for (const e of (evs.data ?? []) as Ev[]) {
    const encerra = e.tipo === 'SITUACAO' && TERMINAIS.includes(e.para?.situacao ?? '')
    if (e.tipo !== 'BAIXA' && !encerra) continue
    pontos.push({
      chave: `ev-${e.id}`, tipo: 'APP', lat: Number(e.lat), lng: Number(e.lng),
      precisao_m: e.precisao_m, em: e.criado_em, quem: e.login,
      dist: ate(Number(e.lat), Number(e.lng)),
      rotulo: e.tipo === 'BAIXA' ? 'Baixa de O.S. pelo app' : 'Encerramento pelo app',
    })
  }

  // Baixa no TOA: o ponto escolhido pelo banco (o mais perto na execução).
  const l = ((loc.data ?? []) as LocalBaixa[])[0]
  if (l?.fonte === 'RASTRO') {
    pontos.push({
      chave: 'rastro', tipo: 'RASTRO', lat: Number(l.lat), lng: Number(l.lng),
      precisao_m: l.precisao_m, em: l.em, quem: l.login,
      dist: ate(Number(l.lat), Number(l.lng)), rotulo: NOME.RASTRO,
    })
  }

  // Os pontos do rastro durante a execução — os mesmos limites do banco.
  // Em aberto, até AGORA: o `fim` do TOA ali ainda é o planejado. Sem
  // início nenhum (deslocamento recém-aberto), as últimas 2 h.
  const aberto = !TERMINAIS.includes(v.situacao)
  let rastro: Dados['rastro'] = []
  if (v.tecnico_responsavel_id && (v.inicio || v.fim || aberto)) {
    const agora = Date.now()
    const ini = v.inicio ?? v.fim
    const de = new Date(ini ? new Date(ini).getTime() - TOL_MIN * 60000 : agora - 2 * 3600000).toISOString()
    const fim = new Date(aberto || !v.fim ? agora : new Date(v.fim).getTime() + TOL_MIN * 60000).toISOString()
    const { data: rp } = await supabase.from('rastro_ponto')
      .select('capturado_em, lat, lng, precisao_m, simulado')
      .eq('tecnico_id', v.tecnico_responsavel_id)
      .gte('capturado_em', de).lte('capturado_em', fim)
      .order('capturado_em').limit(500)
    rastro = ((rp ?? []) as { capturado_em: string; lat: number; lng: number; precisao_m: number | null; simulado: boolean }[])
      .filter(p => !p.simulado)
      .map(p => ({ lat: Number(p.lat), lng: Number(p.lng), precisao_m: p.precisao_m, em: p.capturado_em }))
  }

  // Sem baixa com posição (contrato aberto, ou baixa no TOA sem ponto
  // escolhido): o ponto do rastro MAIS PERTO da casa — esteve lá ou não?
  if (toa && !pontos.some(p => p.tipo === 'APP' || p.tipo === 'RASTRO')) {
    const perto = rastro
      .filter(p => (p.precisao_m ?? 0) <= PREC_MAX)
      .map(p => ({ p, d: metrosEntre(p.lat, p.lng, toa.lat, toa.lng) }))
      .sort((a, b) => a.d - b.d)[0]
    if (perto) pontos.push({
      chave: 'perto', tipo: 'PERTO', lat: perto.p.lat, lng: perto.p.lng,
      precisao_m: perto.p.precisao_m, em: perto.p.em, quem: null, dist: perto.d, rotulo: NOME.PERTO,
    })
  }

  // Em deslocamento / execução: onde ele está agora (é o selo da linha).
  const a = ((apx.data ?? []) as Aproximacao[])[0]
  if (a) {
    const idade = idadeMin(a)
    pontos.push({
      chave: 'agora', tipo: 'AGORA', lat: Number(a.lat), lng: Number(a.lng),
      precisao_m: a.precisao_m, em: a.ponto_em,
      quem: idade === 0 ? 'agora' : `há ${idade} min${a.motivo === 'SAIU' ? ' · app fechado' : ''}`,
      dist: a.distancia_m ?? ate(Number(a.lat), Number(a.lng)), rotulo: NOME.AGORA,
    })
  }

  const raioPar = Number((par.data as { valor: unknown } | null)?.valor)
  return {
    toa,
    endereco: [v.logradouro, v.complemento, v.bairro].filter(Boolean).join(' · '),
    pontos,
    rastro,
    raio: l?.raio_m ?? (Number.isFinite(raioPar) && raioPar > 0 ? raioPar : 200),
    baixaNoToa: v.finalizado_toa && TERMINAIS.includes(v.situacao),
    aberto,
  }
}

export function MapaDaBaixa({ alvo, onFechar }: { alvo: AlvoMapa; onFechar: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [foco, setFoco] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setDados(null); setErro(null)
    carregar(alvo.id)
      .then(d => { if (vivo) setDados(d) })
      .catch(e => { if (vivo) setErro(e instanceof Error ? e.message : String(e)) })
    return () => { vivo = false }
  }, [alvo.id])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onFechar])

  // Por que não há posição do técnico — dito, nunca um mapa vazio calado.
  const semPosicao = useMemo(() => {
    if (!dados) return null
    if (dados.pontos.some(p => p.tipo !== 'TOA')) return null
    const r = dados.rastro
    if (!r.length) {
      return dados.baixaNoToa
        ? 'Baixa dada no TOA e nenhum ponto do rastro do celular durante a execução (app fechado, sem sinal ou sem login).'
        : 'Nenhuma baixa pelo app com GPS e nenhuma casa marcada neste contrato.'
    }
    const bons = r.filter(p => (p.precisao_m ?? 0) <= PREC_MAX).length
    const melhor = Math.min(...r.map(p => Number(p.precisao_m ?? 0)))
    if (!bons) {
      return `${r.length} ponto(s) do rastro na execução, todos com precisão pior que ±${PREC_MAX} m `
        + `(o melhor: ±${Math.round(melhor)} m). O celular está mandando localização APROXIMADA — `
        + 'no Android: Configurações › Apps › o aplicativo › Permissões › Localização › ligar "Usar localização precisa".'
    }
    return `${bons} ponto(s) do rastro com GPS bom, mas nenhum com coordenada da casa para comparar.`
  }, [dados])

  return createPortal(
    <div onClick={e => { e.stopPropagation(); onFechar() }}
      onContextMenu={e => e.stopPropagation()}
      className="janela-fundo fixed inset-0 z-[80] flex items-start justify-center
                 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
        aria-label={`Mapa da baixa do contrato ${alvo.contrato ?? ''}`}
        className="janela-caixa sup-controle mt-6 w-full max-w-5xl rounded-xl border
                   border-graf-700 border-t-4 border-t-af-600 bg-graf-950 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-graf-800 px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Onde baixou · contrato {alvo.contrato ?? '—'}</h2>
            {dados?.endereco && <p className="truncate text-xs text-graf-400">{dados.endereco}</p>}
          </div>
          <button onClick={onFechar} aria-label="Fechar"
            className="ml-auto rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300 hover:border-af-600">
            Fechar
          </button>
        </div>

        {erro && <p className="px-5 py-4 text-sm text-af-400">Não consegui carregar: {erro}</p>}
        {!dados && !erro && <p className="px-5 py-6 text-sm text-graf-400">Carregando…</p>}

        {dados && (
          <div className="grid gap-0 lg:grid-cols-[1fr_20rem]">
            <MapaPontos dados={dados} foco={foco} />
            <div className="space-y-2 border-t border-graf-800 p-4 lg:border-l lg:border-t-0">
              <Item cor={COR.TOA} letra="C" titulo={NOME.TOA}
                linha={dados.toa ? `raio da baixa: ${dados.raio} m` : 'o TOA mandou o endereço SEM coordenada — não dá para medir distância'}
                ativo={foco === 'toa'} aoClicar={dados.toa ? () => setFoco('toa') : undefined} />
              {dados.pontos.map(p => {
                const fora = p.dist != null && p.dist > dados.raio
                return (
                  <Item key={p.chave} cor={COR[p.tipo]} letra={LETRA[p.tipo]} titulo={p.rotulo}
                    destaque={p.dist == null ? 'sem medida'
                      : `${textoDistancia(p.dist)} da casa`}
                    destaqueFora={fora}
                    linha={[diaHora(p.em), p.quem,
                            p.precisao_m != null ? `GPS ±${Math.round(Number(p.precisao_m))} m` : 'sem precisão informada']
                      .filter(Boolean).join(' · ')}
                    ativo={foco === p.chave} aoClicar={() => setFoco(p.chave)} />
                )
              })}
              {dados.rastro.length > 0 && (
                <p className="text-[11px] text-graf-400">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-graf-400 align-middle" />
                  {dados.rastro.length} ponto(s) do rastro entre {hhmm(dados.rastro[0].em)} e{' '}
                  {hhmm(dados.rastro[dados.rastro.length - 1].em)}{' '}
                  {dados.aberto ? '(em andamento, até agora)' : `(execução ± ${TOL_MIN} min)`} — a linha cinza é o trajeto
                </p>
              )}
              {semPosicao && (
                <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs leading-relaxed text-amber-200">
                  {semPosicao}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function Item({ cor, letra, titulo, linha, destaque, destaqueFora, ativo, aoClicar }: {
  cor: string; letra: string; titulo: string; linha: string
  destaque?: string; destaqueFora?: boolean; ativo: boolean; aoClicar?: () => void
}) {
  return (
    <button type="button" onClick={aoClicar} disabled={!aoClicar}
      title={aoClicar ? 'Centralizar no mapa' : undefined}
      className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left
                  ${ativo ? 'border-af-600 bg-graf-900' : 'border-graf-800 hover:border-graf-600'}`}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]
                       font-bold text-white" style={{ background: cor }}>{letra}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-xs font-semibold text-graf-100">{titulo}</span>
          {destaque && (
            <span className={`tabular text-xs font-semibold ${destaqueFora ? 'text-af-400' : 'text-emerald-400'}`}>
              {destaqueFora ? 'fora · ' : ''}{destaque}
            </span>
          )}
        </span>
        <span className="block text-[11px] text-graf-400">{linha}</span>
      </span>
    </button>
  )
}

function MapaPontos({ dados, foco }: { dados: Dados; foco: string | null }) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<google.maps.Map | null>(null)
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState<string | null>(temChaveDoMapa ? null : 'Mapa do Google sem chave neste site.')
  const [tema] = useTema()

  useEffect(() => {
    if (!temChaveDoMapa) return
    let vivo = true
    if (autenticacaoFalhou()) setErro('O Google recusou a chave do mapa.')
    const cancelar = aoFalharAutenticacao(() => { if (vivo) setErro('O Google recusou a chave do mapa.') })
    carregarMapaGoogle()
      .then(() => { if (vivo) setPronto(true) })
      .catch(() => { if (vivo) setErro('O mapa do Google não carregou (rede).') })
    return () => { vivo = false; cancelar() }
  }, [])

  // Monta tudo de uma vez: a janela é efêmera, e `colorScheme` só vale na
  // construção (traps.md) — trocar o tema com ela aberta refaz o mapa.
  useEffect(() => {
    if (!pronto || !div.current) return
    // D-308: o mesmo mapa em toda abertura (lib/mapaGoogle)
    const m = mapaReaproveitado(div.current, tema, {
      center: dados.toa ?? { lat: -3.1, lng: -60.0 }, zoom: 17,
      mapTypeControl: true,
      mapTypeControlOptions: { mapTypeIds: ['roadmap', 'satellite', 'hybrid'] },
      streetViewControl: true, fullscreenControl: true, rotateControl: false,
      clickableIcons: false,
    })
    mapa.current = m
    const c = camada()
    const limites = new google.maps.LatLngBounds()
    let n = 0

    // O caminho da execução, em ordem: a linha e os pontos, em cinza — o
    // trajeto, não a afirmação.
    if (dados.rastro.length > 1) c.guarda(new google.maps.Polyline({
      map: m, path: dados.rastro, strokeColor: '#6b7280', strokeOpacity: 0.7, strokeWeight: 3, zIndex: 5,
      icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_OPEN_ARROW, scale: 2, strokeColor: '#4b5563' },
                offset: '50%', repeat: '120px' }],
    }))
    for (const p of dados.rastro) {
      // O círculo de precisão só quando é pequeno: doze círculos de 2 km
      // um em cima do outro escurecem o mapa e não dizem nada a mais.
      if (p.precisao_m != null && Number(p.precisao_m) <= 300) c.guarda(new google.maps.Circle({
        map: m, center: p, radius: Number(p.precisao_m), clickable: false,
        strokeColor: '#9ca3af', strokeOpacity: 0.35, strokeWeight: 1, fillColor: '#9ca3af', fillOpacity: 0.06,
      }))
      c.guarda(new google.maps.Marker({
        map: m, position: p, zIndex: 10,
        title: `Rastro ${hhmm(p.em)}${p.precisao_m != null ? ` · GPS ±${Math.round(Number(p.precisao_m))} m` : ''}`,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4, fillColor: '#6b7280', fillOpacity: 0.95,
                strokeColor: '#ffffff', strokeWeight: 1 },
      }))
    }

    if (dados.toa) {
      limites.extend(dados.toa); n++
      c.guarda(new google.maps.Circle({
        map: m, center: dados.toa, radius: dados.raio, clickable: false,
        strokeColor: COR.TOA, strokeOpacity: 0.8, strokeWeight: 1.5, fillColor: COR.TOA, fillOpacity: 0.06,
      }))
      c.guarda(new google.maps.Marker({
        map: m, position: dados.toa, zIndex: 60, title: `${NOME.TOA} · raio ${dados.raio} m`,
        label: { text: 'C', color: '#ffffff', fontSize: '11px', fontWeight: '800' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: COR.TOA, fillOpacity: 1,
                strokeColor: '#ffffff', strokeWeight: 2 },
      }))
    }

    for (const p of dados.pontos) {
      const pos = { lat: p.lat, lng: p.lng }
      limites.extend(pos); n++
      if (dados.toa) {
        c.guarda(new google.maps.Polyline({
          map: m, path: [pos, dados.toa], strokeColor: COR[p.tipo], strokeOpacity: 0.85, strokeWeight: 2,
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2 }, offset: '0', repeat: '8px' }],
        }))
      }
      if (p.precisao_m != null && Number(p.precisao_m) > 0) {
        c.guarda(new google.maps.Circle({
          map: m, center: pos, radius: Math.min(Number(p.precisao_m), 2000), clickable: false,
          strokeColor: COR[p.tipo], strokeOpacity: 0.4, strokeWeight: 1, fillColor: COR[p.tipo], fillOpacity: 0.08,
        }))
      }
      c.guarda(new google.maps.Marker({
        map: m, position: pos, zIndex: p.tipo === 'AGORA' ? 58 : p.tipo === 'APP' ? 50 : 55,
        title: `${p.rotulo} · ${diaHora(p.em)}${p.dist != null ? ` · ${textoDistancia(p.dist)} da casa do TOA` : ''}`
             + `${p.precisao_m != null ? ` · GPS ±${Math.round(Number(p.precisao_m))} m` : ''}`,
        label: { text: LETRA[p.tipo], color: '#ffffff', fontSize: '10px', fontWeight: '800' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: COR[p.tipo], fillOpacity: 1,
                strokeColor: '#ffffff', strokeWeight: 2 },
      }))
    }
    // A trilha entra no enquadramento: é ela que diz por onde ele andou.
    for (const p of dados.rastro) { limites.extend(p); n++ }
    if (n > 1) m.fitBounds(limites, 48)
    else if (n === 1) { m.setCenter(limites.getCenter()); m.setZoom(17) }
    return () => c.limpa()
  }, [pronto, dados, tema])

  // O item clicado na lista centraliza o mapa nele.
  useEffect(() => {
    const m = mapa.current
    if (!m || !foco) return
    const p = foco === 'toa' ? dados.toa : dados.pontos.find(x => x.chave === foco)
    if (p) { m.panTo({ lat: p.lat, lng: p.lng }); m.setZoom(Math.max(m.getZoom() ?? 17, 18)) }
  }, [foco, dados])

  if (erro) {
    return <div className="flex h-[28rem] items-center justify-center p-6 text-sm text-amber-300">{erro}</div>
  }
  return <div ref={div} className="h-[28rem] w-full lg:h-[32rem]" />
}

/** O botão da linha (Serviços e Equipes), quando ainda não há selo de local. */
export function BotaoMapa({ aoAbrir }: { aoAbrir: () => void }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); aoAbrir() }}
      title="Mapa: a casa do cliente, onde o técnico marcou a casa e onde baixou"
      className="inline-flex items-center gap-1 rounded bg-graf-800 px-1.5 py-0.5 text-[10px]
                 font-semibold text-graf-300 ring-1 ring-graf-600/50 hover:brightness-125">
      <span aria-hidden>⌖</span>mapa
    </button>
  )
}
