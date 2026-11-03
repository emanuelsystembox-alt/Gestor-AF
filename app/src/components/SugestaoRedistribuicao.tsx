import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { equipeRotulo } from '../lib/formato'
import { useAuth } from '../lib/auth'
import { useAbrirContrato } from './LinkContrato'
import { Alerta } from './ui'

/**
 * Redistribuição sugerida (183, D-262) — só na web do controlador.
 *
 * ┌─ o sistema SUGERE, quem opera decide ─────────────────────────────┐
 * │ > "sobre a questão de rota e sugestões vamos manter em nosso       │
 * │ >  sistema do controlador, nada será sugerido pelo app do técnico" │
 * │ >  — Emanuel, 02/11                                                │
 * │                                                                    │
 * │ Muda a D-088 só para a operação do dia: a lista vem do banco       │
 * │ (`sugestoes_redistribuicao`, que não grava nada), cada linha com o │
 * │ motivo ao lado, e o botão chama a MESMA `transferir_visita` de     │
 * │ Serviços e da Rota (170, D-257) — sem outro caminho, com a mesma   │
 * │ trava do banco (gestão + `servicos.transferir`).                   │
 * │                                                                    │
 * │ Transferir não fixa a rota (D-257): com o roteamento do TOA armado,│
 * │ a próxima importação devolve o contrato. O aviso depois do clique  │
 * │ diz como ficou, igual à Rota do dia.                               │
 * └────────────────────────────────────────────────────────────────────┘
 */

interface Candidato {
  tecnico_id: string; tecnico: string; equipe_id: string; equipe: string | null
  /** Linha reta até onde ele fica livre. Nulo = contrato sem coordenada. */
  km: number | null
  /** De onde saiu a posição: o último da fila, o rastro de 20 min ou o último concluído. */
  posicao: 'FILA' | 'RASTRO' | 'CONCLUIDO' | null
  posicao_contrato: string | null
  na_fila: number; livre_em: string; chega: string; termina: string
  folga_min: number | null
}
interface Sugestao {
  visita_id: string; contrato: string | null; grupo: string | null; situacao: string
  janela: string | null; tem_coordenada: boolean
  risco: { nivel: 'EM_RISCO' | 'VAI_ESTOURAR'; folga_min: number | null
           previsto_chegada: string | null; prazo_chegada: string | null
           na_frente: number } | null
  suporte: { desde: string; observacao: string | null; contrato: string | null } | null
  origem: { tecnico_id: string | null; tecnico: string | null; equipe_id: string | null
            equipe: string | null; skill: string | null }
  sem_candidato: 'SEM_SKILL' | 'NINGUEM_CHEGA' | null
  candidatos: Candidato[]
}

const hhmm = (ts: string | null | undefined) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

const km = (n: number | null) =>
  n == null ? 'sem coordenada'
    : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`

const ORIGEM_POSICAO: Record<NonNullable<Candidato['posicao']>, string> = {
  FILA: 'do último contrato da fila',
  RASTRO: 'pelo rastro',
  CONCLUIDO: 'do último concluído',
}

/** O motivo em uma linha — o que o controlador lê antes de clicar. */
function motivo(s: Sugestao): string {
  const partes: string[] = []
  if (s.risco) {
    partes.push(s.risco.nivel === 'VAI_ESTOURAR' ? 'TEC1 vai estourar' : 'TEC1 em risco')
    partes.push(`chega ~${hhmm(s.risco.previsto_chegada)}`)
    if (s.risco.na_frente > 0) partes.push(`${s.risco.na_frente} na frente`)
  }
  if (s.suporte) partes.push(`suporte desde ${hhmm(s.suporte.desde)}`)
  return partes.join(' · ')
}

export function SugestaoRedistribuicao({ aoTransferir }: {
  /** Para a tela recarregar o que mostra depois de uma transferência. */
  aoTransferir?: () => void
}) {
  const { pode } = useAuth()
  const abrirContrato = useAbrirContrato()
  const [lista, setLista] = useState<Sugestao[] | null>(null)
  const [semAcesso, setSemAcesso] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  /** O candidato escolhido em cada contrato; sem escolha, o primeiro. */
  const [escolha, setEscolha] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('sugestoes_redistribuicao')
    if (error) {
      // 42501: não é da gestão. O banco recusa; a tela some, sem recado.
      if (error.code === '42501') setSemAcesso(true)
      else setErro(error.message)
      return
    }
    setLista((data ?? []) as Sugestao[])
  }, [])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 60_000)
    return () => clearInterval(t)
  }, [carregar])

  async function transferir(s: Sugestao, c: Candidato) {
    setOcupado(s.visita_id); setErro(null); setOk(null)
    const { data: r, error } = await supabase.rpc('transferir_visita', {
      p_visita: s.visita_id,
      p_equipe: c.equipe_id,
      p_motivo: `Sugestão aceita: ${motivo(s)}`,
    })
    setOcupado(null)
    if (error) {
      setErro(/permiss/i.test(error.message)
        ? 'Sem permissão para transferir. A barreira é do banco.' : error.message)
      return
    }
    const res = r as { mudou?: boolean; rota_fixada?: boolean } | null
    if (res?.mudou === false) {
      setErro('Já é da mesma equipe — nada mudou.')
    } else {
      // 170 (D-257): transferir não fixa a rota; o aviso diz como ficou
      setOk(`Contrato ${s.contrato ?? ''} → ${c.tecnico} (${equipeRotulo(c.equipe)}). `
        + (res?.rota_fixada
          ? 'A rota já estava fixada: a importação do TOA não desfaz.'
          : 'O roteamento do TOA continua ligado: para a importação não devolver o contrato, desligue a chave no contrato.'))
      aoTransferir?.()
    }
    carregar()
  }

  if (semAcesso || lista === null) return null
  const podeTransferir = pode('servicos.transferir')

  return (
    <section className="card-controle overflow-hidden" aria-label="Redistribuição sugerida">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-graf-800 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Redistribuição sugerida</h2>
        <span className="tabular text-xs text-graf-400"
          title="TEC1 em risco ou ticket de suporte · mesma skill · chega na janela · o mais perto primeiro (linha reta)">
          {lista.length === 0 ? 'nenhuma agora' : `${lista.length} contrato(s)`}
        </span>
      </div>

      {(erro || ok) && (
        <div className="px-4 pt-3">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {ok && <Alerta tipo="ok">{ok}</Alerta>}
        </div>
      )}

      {lista.length > 0 && (
        <ul className="divide-y divide-graf-800">
          {lista.map(s => {
            const c = s.candidatos.find(x => x.tecnico_id === escolha[s.visita_id])
              ?? s.candidatos[0]
            return (
              <li key={s.visita_id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                {/* ---- o contrato e o motivo ---- */}
                <div className="min-w-0 flex-[1_1_16rem]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button onClick={() => abrirContrato(s.visita_id)}
                      className="tabular text-sm font-semibold text-graf-100 hover:text-af-400">
                      {s.contrato ?? 'sem contrato'}
                    </button>
                    {s.risco && (
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        s.risco.nivel === 'VAI_ESTOURAR'
                          ? 'bg-af-900/40 text-af-300' : 'bg-amber-900/40 text-amber-300'}`}>
                        {s.risco.nivel === 'VAI_ESTOURAR' ? 'TEC1 vai estourar' : 'TEC1 em risco'}
                      </span>
                    )}
                    {s.suporte && (
                      <span title={s.suporte.observacao ?? undefined}
                        className="rounded bg-orange-900/40 px-1.5 py-0.5 text-[11px] font-semibold text-orange-300">
                        Suporte {hhmm(s.suporte.desde)}
                      </span>
                    )}
                  </div>
                  <div className="tabular mt-0.5 text-[11px] text-graf-400">
                    {[s.grupo, s.janela && `janela ${s.janela}`, motivo(s)].filter(Boolean).join(' · ')}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-graf-400">
                    de {s.origem.tecnico ?? 'sem técnico'}
                    {s.origem.equipe && ` · ${equipeRotulo(s.origem.equipe)}`}
                    {s.origem.skill && ` · ${s.origem.skill}`}
                  </div>
                </div>

                {/* ---- para quem ---- */}
                <div className="min-w-0 flex-[1_1_18rem]">
                  {!c ? (
                    <p className="text-[11px] text-graf-400">
                      {s.sem_candidato === 'SEM_SKILL'
                        ? 'Técnico sem skill no cadastro: sem com quem comparar.'
                        : 'Ninguém da mesma skill chega na janela.'}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs text-graf-400" aria-hidden>→</span>
                        <span className="truncate text-sm font-medium text-graf-100">{c.tecnico}</span>
                        <span className="text-[11px] text-graf-400">{equipeRotulo(c.equipe)}</span>
                      </div>
                      <div className="tabular mt-0.5 text-[11px] text-graf-400"
                        title={c.posicao
                          ? `Distância ${ORIGEM_POSICAO[c.posicao]}${c.posicao_contrato ? ` (${c.posicao_contrato})` : ''}, em linha reta`
                          : undefined}>
                        {[km(c.km),
                          `${c.na_fila} na fila`,
                          `livre ~${hhmm(c.livre_em)}`,
                          `chega ~${hhmm(c.chega)}`,
                          c.folga_min != null ? `sobra ${c.folga_min} min` : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      {s.candidatos.length > 1 && (
                        <div className="mt-1 flex flex-wrap gap-1" role="radiogroup"
                          aria-label="Outros técnicos possíveis">
                          {s.candidatos.map(x => (
                            <button key={x.tecnico_id} role="radio"
                              aria-checked={x.tecnico_id === c.tecnico_id}
                              onClick={() => setEscolha(e => ({ ...e, [s.visita_id]: x.tecnico_id }))}
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                                x.tecnico_id === c.tecnico_id
                                  ? 'border-af-600 text-af-300'
                                  : 'border-graf-700 text-graf-400 hover:border-graf-500'}`}>
                              {x.tecnico.split(' ')[0]} · {km(x.km)}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {c && podeTransferir && (
                  <button onClick={() => transferir(s, c)} disabled={ocupado !== null}
                    className="self-center rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium
                               text-white hover:bg-af-500 disabled:opacity-50">
                    {ocupado === s.visita_id ? 'Transferindo…' : 'Transferir'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
