import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { equipeRotulo } from '../lib/formato'

/**
 * Ordem sugerida das paradas (183, D-262) — bloco da Rota do dia.
 *
 * ┌─ só informação: a ordem real é do TOA ────────────────────────────┐
 * │ A regra cabe numa frase, e a dica do título a diz: a janela que    │
 * │ fecha primeiro vem primeiro; dentro da mesma janela, o mais perto. │
 * │ Comparada com a ordem do TOA (hoje) ou com a que foi EXECUTADA     │
 * │ (dia passado), em km de LINHA RETA — não é trajeto de rua.         │
 * │                                                                    │
 * │ O tempo só aparece com velocidade MEDIDA no rastro da cidade; sem  │
 * │ ela, a tela diz "sem velocidade medida" — nunca "0 min" (zero e    │
 * │ desconhecido não são a mesma coisa). Nada aqui grava.              │
 * │                                                                    │
 * │ Técnico em que a sugerida poria mais contrato fora da janela que a │
 * │ do TOA não aparece: o banco já devolve `oferecer = false`.         │
 * └────────────────────────────────────────────────────────────────────┘
 */

interface Parada {
  visita_id: string; contrato: string | null; janela: string | null
  /** Linha reta desde a parada anterior (ou da partida). */
  km: number | null
  /** Só na sugerida: a posição dela na ordem do TOA (1 = primeira). */
  era?: number
}
interface Tecnico {
  fila: string; tecnico_id: string | null; tecnico: string | null
  equipe_id: string | null; equipe: string | null; login: string | null
  partida: 'CONTRATO_ATUAL' | 'RASTRO' | 'ULTIMO_CONCLUIDO' | 'PRIMEIRO_DO_DIA' | null
  partida_contrato: string | null
  paradas: number; sem_coordenada: number
  km_toa: number; km_sugerido: number; km_ganho: number
  min_ganho: number | null
  fora_janela_toa: number | null; fora_janela_sugerida: number | null
  oferecer: boolean
  ordem_toa: Parada[]; ordem_sugerida: Parada[]
}
interface Resposta {
  data: string; base_ordem: 'TOA' | 'EXECUTADA'
  velocidade_kmh: number | null; velocidade_trechos: number
  km_toa: number; km_sugerido: number; km_ganho: number
  tecnicos: Tecnico[]
}

const num = (n: number | null | undefined, casas = 1) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: casas,
                                                maximumFractionDigits: casas })

const PARTIDA: Record<NonNullable<Tecnico['partida']>, string> = {
  CONTRATO_ATUAL: 'a partir do contrato atual',
  RASTRO: 'a partir do rastro',
  ULTIMO_CONCLUIDO: 'a partir do último concluído',
  PRIMEIRO_DO_DIA: 'a partir do primeiro contrato do dia',
}

export function OrdemSugerida({ data, login, aoAbrir }: {
  /** O dia da Rota (`YYYY-MM-DD`). Hoje compara com o TOA; passado, com o executado. */
  data: string
  /** O login em foco na Rota: mostra só ele, mesmo sem ganho. */
  login?: string | null
  aoAbrir?: (visitaId: string) => void
}) {
  const [r, setR] = useState<Resposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setR(null); setErro(null)
    supabase.rpc('ordem_sugerida', { p_data: data }).then(({ data: d, error }) => {
      if (!vivo) return
      // 42501: não é da gestão — o bloco some, sem recado
      if (error) { if (error.code !== '42501') setErro(error.message); return }
      setR(d as Resposta)
    })
    return () => { vivo = false }
  }, [data])

  const lista = useMemo(() => {
    if (!r) return []
    return login
      ? r.tecnicos.filter(t => t.login === login)
      : r.tecnicos.filter(t => t.oferecer)
  }, [r, login])

  if (erro) return (
    <p className="card-controle px-4 py-2.5 text-xs text-graf-400">Ordem sugerida: {erro}</p>
  )
  if (!r) return null

  const passado = r.base_ordem === 'EXECUTADA'
  const ganhoOferecido = lista.reduce((s, t) => s + (t.oferecer ? t.km_ganho : 0), 0)
  const minuto = (km: number) =>
    r.velocidade_kmh ? Math.round(km / r.velocidade_kmh * 60) : null
  const minTotal = minuto(ganhoOferecido)

  return (
    <section className="card-controle overflow-hidden" aria-label="Ordem sugerida das paradas">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-graf-800 px-4 py-2.5">
        <h2 className="text-sm font-semibold"
          title="A janela que fecha primeiro vem primeiro; dentro da mesma janela, o mais perto">
          Ordem sugerida
        </h2>
        <span className="tabular text-xs text-graf-400">
          {passado ? 'contra a ordem executada' : 'contra a ordem do TOA'} · km em linha reta
        </span>
        {lista.length > 0 && !login && (
          <span className="tabular ml-auto text-xs text-graf-300">
            −{num(ganhoOferecido)} km
            {' · '}
            {minTotal != null
              ? `≈ ${minTotal} min`
              : <span className="text-graf-400"
                  title={`O rastro da cidade tem ${r.velocidade_trechos} trecho(s) em movimento em 30 dias; o tempo precisa de 30`}>
                  tempo sem velocidade medida
                </span>}
          </span>
        )}
      </div>

      {lista.length === 0 ? (
        <p className="px-4 py-3 text-xs text-graf-400">
          {login ? 'Sem paradas para reordenar neste técnico.' : 'Nenhuma ordem mais curta que a atual.'}
        </p>
      ) : (
        <ul className="divide-y divide-graf-800">
          {lista.map(t => {
            const min = minuto(t.km_ganho)
            const piora = t.fora_janela_toa != null && t.fora_janela_sugerida != null
              && t.fora_janela_sugerida > t.fora_janela_toa
            return (
              <li key={t.fila} className="px-4 py-2.5">
                <button onClick={() => setAberto(a => (a === t.fila ? null : t.fila))}
                  aria-expanded={aberto === t.fila}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left">
                  <span className="min-w-0 truncate text-xs font-semibold text-graf-100">
                    {t.tecnico ?? 'sem técnico'}
                  </span>
                  <span className="tabular text-[11px] text-graf-400">
                    {[t.login, t.equipe && equipeRotulo(t.equipe), `${t.paradas} paradas`]
                      .filter(Boolean).join(' · ')}
                  </span>
                  <span className="tabular ml-auto text-[11px] text-graf-300">
                    {num(t.km_toa)} → {num(t.km_sugerido)} km
                    <span className={`ml-2 font-semibold ${t.km_ganho > 0 ? 'text-emerald-300' : 'text-graf-400'}`}>
                      {t.km_ganho > 0 ? '−' : ''}{num(Math.abs(t.km_ganho))} km
                    </span>
                    {min != null && t.km_ganho > 0 && <span className="ml-1.5">≈ {min} min</span>}
                  </span>
                </button>

                <div className="tabular mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-graf-400">
                  {t.partida && (
                    <span>{PARTIDA[t.partida]}{t.partida_contrato ? ` (${t.partida_contrato})` : ''}</span>
                  )}
                  {t.fora_janela_toa != null && (
                    <span className={piora ? 'text-amber-300' : undefined}
                      title="Previsão da fila (mediana do TOA): contratos que terminariam fora da janela">
                      fora da janela: TOA {t.fora_janela_toa} · sugerida {t.fora_janela_sugerida}
                    </span>
                  )}
                  {t.sem_coordenada > 0 && <span>{t.sem_coordenada} sem coordenada fora da conta</span>}
                </div>

                {aberto === t.fila && (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {([['Sugerida', t.ordem_sugerida], [passado ? 'Executada' : 'TOA', t.ordem_toa]] as
                      [string, Parada[]][]).map(([rot, ps]) => (
                      <div key={rot}>
                        <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-graf-400">
                          {rot}
                        </h3>
                        <ol className="space-y-0.5">
                          {ps.map((p, i) => (
                            <li key={p.visita_id} className="tabular flex items-baseline gap-2 text-[11px]">
                              <span className="w-4 text-right text-graf-400">{i + 1}</span>
                              <button onClick={() => aoAbrir?.(p.visita_id)}
                                className="text-graf-200 hover:text-af-400">
                                {p.contrato ?? 'sem contrato'}
                              </button>
                              <span className="text-graf-400">{p.janela ?? 'sem janela'}</span>
                              <span className="ml-auto text-graf-400">
                                {p.km != null ? `${num(p.km)} km` : '—'}
                              </span>
                              {p.era != null && p.era !== i + 1 && (
                                <span className="text-af-300" title="Posição na outra ordem">era {p.era}º</span>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
