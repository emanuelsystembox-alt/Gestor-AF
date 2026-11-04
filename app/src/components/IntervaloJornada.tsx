import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useTema } from '../lib/tema'
import {
  aoFalharAutenticacao, autenticacaoFalhou, carregarMapaGoogle, temChaveDoMapa,
} from '../lib/mapaGoogle'
import { metrosEntre, textoDistancia } from '../lib/localBaixa'

/**
 * O intervalo do almoço (ou de outra jornada), numa janela (D-303).
 *
 * > "quando eu clicar em cima do almoço da equipe é interessante ele
 * >  mostrar o intervalo do técnico de almoço onde ele almoçou de fato
 * >  onde ele ficou parado esse tempo" — Emanuel, 04/11
 *
 * ┌─ o que é "de fato" ───────────────────────────────────────────────────┐
 * │ O começo real é o do TOA quando a atividade está INICIADA ou          │
 * │ CONCLUÍDA; o fim real, só na CONCLUÍDA. Em "iniciado" o `fim` que o   │
 * │ TOA manda é o início + a duração prevista — não é fim (D-103), e a    │
 * │ janela diz "em curso". Pendente não tem real nenhum.                  │
 * │                                                                       │
 * │ "Onde ficou parado" sai do RASTRO do celular no intervalo real:      │
 * │ o centro (mediana) dos pontos com GPS até 100 m, e o raio em que eles │
 * │ ficaram. Sem ponto bom, diz isso — o mapa vazio não é "não saiu do   │
 * │ lugar" (regra 6). Os pontos de 15 min antes e depois entram em cinza │
 * │ claro, para ver de onde ele veio e para onde foi.                     │
 * └───────────────────────────────────────────────────────────────────────┘
 */

export interface AlvoJornada {
  visita_id: string
  login: string
  tecnico: string | null
  rotulo: string
  status_toa: string | null
  janela_inicio: string | null
  janela_fim: string | null
  inicio: string | null
  fim: string | null
}

const PREC_MAX = 100
const MARGEM_MIN = 15
/** Pontos a até isto um do outro são o mesmo lugar (o GPS bom erra dezenas de metros). */
const RAIO_PARADA = 100

const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()

/** INICIADO = em curso; CONCLUIDO = terminou; o resto = não começou. */
export function estadoJornada(status: string | null | undefined): 'EM_CURSO' | 'TERMINOU' | 'PLANEJADA' {
  const s = norm(status)
  if (s === 'INICIADO') return 'EM_CURSO'
  if (s === 'CONCLUIDO') return 'TERMINOU'
  return 'PLANEJADA'
}

const hhmm = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' })
  : '—'
const dur = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`

interface Ponto { lat: number; lng: number; precisao_m: number | null; em: string; motivo: string | null; dentro: boolean }

export function IntervaloJornada({ alvo, onFechar }: { alvo: AlvoJornada; onFechar: () => void }) {
  const estado = estadoJornada(alvo.status_toa)
  const ini = estado !== 'PLANEJADA' ? alvo.inicio : null
  const fimReal = estado === 'TERMINOU' ? alvo.fim : null
  const [pontos, setPontos] = useState<Ponto[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [foco, setFoco] = useState<number | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onFechar])

  useEffect(() => {
    if (!ini) { setPontos([]); return }
    let vivo = true
    ;(async () => {
      // O técnico: o responsável do contrato; sem ele, o do login.
      const { data: v } = await supabase.from('visita').select('tecnico_responsavel_id')
        .eq('id', alvo.visita_id).maybeSingle()
      let tec = (v as { tecnico_responsavel_id: string | null } | null)?.tecnico_responsavel_id ?? null
      if (!tec) {
        const { data: t } = await supabase.from('tecnico').select('id').eq('matricula', alvo.login).limit(1)
        tec = ((t ?? []) as { id: string }[])[0]?.id ?? null
      }
      if (!tec) { if (vivo) { setErro('Sem técnico cadastrado para este login.'); setPontos([]) } return }
      const a = new Date(ini).getTime()
      const b = fimReal ? new Date(fimReal).getTime() : Date.now()
      const { data, error } = await supabase.from('rastro_ponto')
        .select('capturado_em, lat, lng, precisao_m, motivo, simulado')
        .eq('tecnico_id', tec)
        .gte('capturado_em', new Date(a - MARGEM_MIN * 60000).toISOString())
        .lte('capturado_em', new Date(b + MARGEM_MIN * 60000).toISOString())
        .order('capturado_em').limit(1000)
      if (!vivo) return
      if (error) { setErro(error.message); setPontos([]); return }
      setPontos(((data ?? []) as { capturado_em: string; lat: number; lng: number; precisao_m: number | null
                                   motivo: string | null; simulado: boolean }[])
        .filter(p => !p.simulado)
        .map(p => {
          const t = new Date(p.capturado_em).getTime()
          return { lat: Number(p.lat), lng: Number(p.lng), precisao_m: p.precisao_m, em: p.capturado_em,
                   motivo: p.motivo, dentro: t >= a && t <= b }
        }))
    })()
    return () => { vivo = false }
  }, [alvo.visita_id, alvo.login, ini, fimReal])

  // Onde ficou: o GRUPO de pontos bons que ficaram a até 100 m um do outro
  // por mais tempo — a parada. O raio de TODOS os pontos enganava: quem
  // inicia a Refeição ainda chegando ao restaurante "parava num raio de
  // 1,3 km" (medido em 04/11). O que sai do grupo é deslocamento.
  const parada = useMemo(() => {
    const bons = (pontos ?? []).filter(p => p.dentro && (p.precisao_m ?? 0) <= PREC_MAX)
    if (!bons.length) return null
    let melhor: Ponto[] = []
    for (const c of bons) {
      const g = bons.filter(p => metrosEntre(c.lat, c.lng, p.lat, p.lng) <= RAIO_PARADA)
      const span = (x: Ponto[]) => new Date(x[x.length - 1].em).getTime() - new Date(x[0].em).getTime()
      if (g.length > melhor.length || (g.length === melhor.length && span(g) > span(melhor))) melhor = g
    }
    const med = (xs: number[]) => { const o = [...xs].sort((x, y) => x - y); return o[Math.floor(o.length / 2)] }
    const c = { lat: med(melhor.map(p => p.lat)), lng: med(melhor.map(p => p.lng)) }
    const raio = Math.max(...melhor.map(p => metrosEntre(c.lat, c.lng, p.lat, p.lng)))
    return { ...c, raio, n: melhor.length, de: melhor[0].em, ate: melhor[melhor.length - 1].em,
             fora: bons.length - melhor.length }
  }, [pontos])
  const noIntervalo = (pontos ?? []).filter(p => p.dentro)
  const fechouApp = noIntervalo.some(p => p.motivo === 'SAIU')

  const realMin = ini
    ? Math.max(0, Math.round(((fimReal ? new Date(fimReal).getTime() : Date.now()) - new Date(ini).getTime()) / 60000))
    : null

  return createPortal(
    <div onClick={e => { e.stopPropagation(); onFechar() }}
      className="janela-fundo fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true"
        aria-label={`${alvo.rotulo} de ${alvo.tecnico ?? alvo.login}`}
        className="janela-caixa sup-controle mt-6 w-full max-w-4xl rounded-xl border border-graf-700 border-t-4 border-t-af-600 bg-graf-950 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-graf-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">{alvo.rotulo} · {alvo.tecnico ?? alvo.login}</h2>
            <p className="text-xs text-graf-400">{alvo.login}</p>
          </div>
          <button onClick={onFechar}
            className="ml-auto rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300 hover:border-af-600">
            Fechar
          </button>
        </div>
        <div className="grid lg:grid-cols-[1fr_17rem]">
          <MapaIntervalo pontos={pontos ?? []} parada={parada} foco={foco} />
          <dl className="space-y-2 border-t border-graf-800 p-4 text-xs lg:border-l lg:border-t-0">
            <div>
              <dt className="text-graf-400">Planejado</dt>
              <dd className="tabular text-graf-100">
                {alvo.janela_inicio?.slice(0, 5) ?? '—'}–{alvo.janela_fim?.slice(0, 5) ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-graf-400">De fato (TOA)</dt>
              <dd className="tabular text-graf-100">
                {estado === 'PLANEJADA' ? 'ainda não começou'
                  : `${hhmm(ini)} – ${estado === 'TERMINOU' ? hhmm(fimReal) : 'em curso'}`}
                {realMin != null && (
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white ${
                    estado === 'EM_CURSO' ? 'bg-[#047857]' : 'bg-[#0369a1]'}`}>
                    {estado === 'EM_CURSO' ? `há ${dur(realMin)}` : dur(realMin)}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-graf-400">Onde ficou</dt>
              <dd className="text-graf-100">
                {pontos == null ? 'carregando…'
                  : !ini ? '—'
                  : parada ? <>
                      parado de <strong className="tabular">{hhmm(parada.de)}</strong> a{' '}
                      <strong className="tabular">{hhmm(parada.ate)}</strong>, num raio de{' '}
                      <strong>{textoDistancia(parada.raio)}</strong> ({parada.n} ponto(s))
                      {parada.fora > 0 && (
                        <span className="block text-graf-400">
                          {parada.fora} ponto(s) fora dali — deslocamento no intervalo
                        </span>
                      )}
                    </>
                  : noIntervalo.length ? `${noIntervalo.length} ponto(s) no intervalo, nenhum com GPS até ±${PREC_MAX} m`
                  : 'nenhum ponto do celular no intervalo (app fechado, sem sinal ou sem login)'}
              </dd>
            </div>
            {fechouApp && <p className="text-amber-300">O app foi fechado durante o intervalo.</p>}
            {erro && <p className="text-af-400">{erro}</p>}
            <p className="pt-1 text-[11px] text-graf-400">
              Verde: pontos do intervalo · cinza: {MARGEM_MIN} min antes e depois
            </p>
            {/* D-303: o horário de cada ponto, em lista — clicar centraliza */}
            {(pontos ?? []).length > 0 && (
              <div>
                <dt className="mb-1 text-graf-400">Pontos ({(pontos ?? []).length})</dt>
                <ol className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                  {(pontos ?? []).map((p, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => setFoco(i)}
                        className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-[11px] hover:bg-graf-800 ${
                          foco === i ? 'bg-graf-800' : ''}`}>
                        <i aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${p.dentro ? 'bg-[#047857]' : 'bg-graf-500'}`} />
                        <span className="tabular font-semibold text-graf-100">{hhmm(p.em)}</span>
                        <span className="tabular text-graf-400">
                          {p.precisao_m != null ? `±${Math.round(Number(p.precisao_m))} m` : 'sem precisão'}
                          {parada ? ` · ${textoDistancia(metrosEntre(parada.lat, parada.lng, p.lat, p.lng))} da parada` : ''}
                          {p.motivo === 'SAIU' ? ' · app fechado' : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function MapaIntervalo({ pontos, parada, foco }: {
  pontos: Ponto[]; parada: { lat: number; lng: number; raio: number; de: string; ate: string } | null
  foco: number | null
}) {
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
    carregarMapaGoogle().then(() => { if (vivo) setPronto(true) })
      .catch(() => { if (vivo) setErro('O mapa do Google não carregou (rede).') })
    return () => { vivo = false; cancelar() }
  }, [])

  useEffect(() => {
    if (!pronto || !div.current) return
    div.current.innerHTML = ''
    const m = new google.maps.Map(div.current, {
      center: parada ?? (pontos[0] ? { lat: pontos[0].lat, lng: pontos[0].lng } : { lat: -3.1, lng: -60.0 }),
      zoom: 16, colorScheme: tema === 'claro' ? 'LIGHT' : 'DARK',
      mapTypeControl: true, streetViewControl: true, fullscreenControl: true, clickableIcons: false,
    })
    mapa.current = m
    const limites = new google.maps.LatLngBounds()
    // O horário em cima de cada ponto. Pontos a menos de 30 m de um já
    // rotulado não repetem o rótulo (na parada eles se empilham); o horário
    // deles está na lista ao lado e no mouse.
    const rotulados: Ponto[] = []
    if (pontos.length > 1) new google.maps.Polyline({
      map: m, path: pontos.map(p => ({ lat: p.lat, lng: p.lng })),
      strokeColor: '#6b7280', strokeOpacity: 0.6, strokeWeight: 2,
    })
    for (const p of pontos) {
      limites.extend(p)
      const rotula = !rotulados.some(r => metrosEntre(r.lat, r.lng, p.lat, p.lng) < 30)
      if (rotula) rotulados.push(p)
      new google.maps.Marker({
        map: m, position: p, zIndex: p.dentro ? 20 : 10,
        title: `${hhmm(p.em)}${p.precisao_m != null ? ` · GPS ±${Math.round(Number(p.precisao_m))} m` : ''}`
             + (p.motivo === 'SAIU' ? ' · app fechado' : ''),
        label: rotula ? { text: hhmm(p.em),
                          color: tema === 'claro' ? (p.dentro ? '#065f46' : '#4b5563')
                                                  : (p.dentro ? '#6ee7b7' : '#d1d5db'),
                          fontSize: '11px', fontWeight: '700' } : undefined,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: p.dentro ? 5 : 3.5,
                fillColor: p.dentro ? '#047857' : '#9ca3af', fillOpacity: 0.95,
                strokeColor: '#ffffff', strokeWeight: 1,
                // o rótulo acima do ponto, não em cima dele
                labelOrigin: new google.maps.Point(0, -2.6) },
      })
    }
    if (parada) {
      limites.extend(parada)
      new google.maps.Circle({
        map: m, center: parada, radius: Math.max(parada.raio, 15), clickable: false,
        strokeColor: '#047857', strokeOpacity: 0.9, strokeWeight: 2, fillColor: '#047857', fillOpacity: 0.12,
      })
      new google.maps.Marker({
        map: m, position: parada, zIndex: 40, title: `Parado de ${hhmm(parada.de)} a ${hhmm(parada.ate)}`,
        label: { text: 'P', color: '#ffffff', fontSize: '11px', fontWeight: '800' },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#047857', fillOpacity: 1,
                strokeColor: '#ffffff', strokeWeight: 2 },
      })
    }
    if (!limites.isEmpty()) {
      if (pontos.length > 1) m.fitBounds(limites, 48)
      else m.setCenter(limites.getCenter())
    }
  }, [pronto, pontos, parada, tema])

  useEffect(() => {
    const p = foco != null ? pontos[foco] : null
    if (mapa.current && p) { mapa.current.panTo(p); mapa.current.setZoom(Math.max(mapa.current.getZoom() ?? 16, 18)) }
  }, [foco, pontos])

  if (erro) return <div className="flex h-[24rem] items-center justify-center p-6 text-sm text-amber-300">{erro}</div>
  return <div ref={div} className="h-[24rem] w-full lg:h-[28rem]" />
}
