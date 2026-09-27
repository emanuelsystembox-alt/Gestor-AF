import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCentral } from '../lib/central'
import { Alerta } from './ui'

/**
 * Sinalizações do campo (091) — o técnico diz, pelo aplicativo, que uma
 * ferramenta falta ou quebrou, e o almoxarifado responde.
 *
 * Sinalizar não move saldo nem posse (posse só se move por documento ou
 * pela baixa — D-154). Atender aqui é RESPONDER; a entrega de uma
 * ferramenta nova continua sendo um romaneio. A resposta volta para o
 * técnico como aviso na agenda dele.
 *
 * Recusar exige motivo (o banco recusa sem): "não" sem porquê faz o
 * técnico sinalizar de novo amanhã.
 */

interface Linha {
  id: string; tipo: 'FALTANDO' | 'DEFEITO'; serial: string | null; descricao: string | null
  situacao: 'ABERTA' | 'ATENDIDA' | 'RECUSADA'; criado_em: string; resolvido_em: string | null
  resposta: string | null
  tecnico: { nome: string; equipe: { codigo: string } | null } | null
  item: { nome: string; codigo: string | null; tipo: string | null } | null
}

const quando = (ts: string) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function Sinalizacoes({ podeMexer }: { podeMexer: boolean }) {
  const { recarregar: recarregarCentral } = useCentral()
  const [filtro, setFiltro] = useState<'ABERTA' | 'TODAS'>('ABERTA')
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [respondendo, setRespondendo] = useState<{ id: string; situacao: 'ATENDIDA' | 'RECUSADA' } | null>(null)
  const [resposta, setResposta] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function carregar() {
    let q = supabase.from('sinalizacao_material')
      .select(`id, tipo, serial, descricao, situacao, criado_em, resolvido_em, resposta,
               tecnico:tecnico_id ( nome, equipe:equipe_id ( codigo ) ),
               item:item_id ( nome, codigo, tipo )`)
      .order('criado_em', { ascending: false }).limit(200)
    if (filtro === 'ABERTA') q = q.eq('situacao', 'ABERTA')
    const { data, error } = await q
    if (error) setErro(error.message)
    setLinhas((data ?? []) as unknown as Linha[])
  }

  useEffect(() => { carregar() }, [filtro])

  async function responder() {
    if (!respondendo) return
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('resolver_sinalizacao', {
      p_id: respondendo.id, p_situacao: respondendo.situacao, p_resposta: resposta.trim() || null,
    })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    setOk(respondendo.situacao === 'ATENDIDA'
      ? 'Respondido. O técnico vê o aviso na agenda.'
      : 'Recusado com motivo. O técnico vê o aviso na agenda.')
    setRespondendo(null); setResposta('')
    await carregar(); recarregarCentral()
  }

  return (
    <section className="card-controle overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-graf-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Sinalizações do campo</h2>
          <p className="mt-0.5 text-xs text-graf-400">
            Ferramenta faltando ou com defeito, avisada pelo técnico no aplicativo. Responder
            não entrega nada — a entrega continua sendo um romaneio.
          </p>
        </div>
        <div className="flex rounded-md bg-graf-900 p-0.5 text-xs">
          {(['ABERTA', 'TODAS'] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f)} aria-pressed={filtro === f}
              className={`rounded px-2.5 py-1 ${filtro === f ? 'bg-af-600 text-white' : 'text-graf-300'}`}>
              {f === 'ABERTA' ? 'Aguardando' : 'Todas'}
            </button>
          ))}
        </div>
      </div>

      {erro && <div className="p-3"><Alerta tipo="erro">{erro}</Alerta></div>}
      {ok && <div className="p-3"><Alerta tipo="ok">{ok}</Alerta></div>}

      {linhas == null ? (
        <p className="px-4 py-8 text-center text-sm text-graf-400">Carregando…</p>
      ) : linhas.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-graf-400">
          {filtro === 'ABERTA' ? 'Nenhuma sinalização aguardando resposta.' : 'Nenhuma sinalização ainda.'}
        </p>
      ) : (
        <ul>
          {linhas.map(l => (
            <li key={l.id} className="border-b border-graf-800 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  l.tipo === 'DEFEITO' ? 'bg-af-900/40 text-af-300' : 'bg-amber-900/40 text-amber-300'}`}>
                  {l.tipo === 'DEFEITO' ? 'Com defeito' : 'Faltando'}
                </span>
                <span className="text-sm font-medium">
                  {l.item?.nome ?? (l.serial ? `serial ${l.serial}` : l.descricao ?? '—')}
                </span>
                <span className="text-xs text-graf-400">
                  {l.tecnico?.nome ?? '—'}{l.tecnico?.equipe ? ` · equipe ${l.tecnico.equipe.codigo}` : ''} · {quando(l.criado_em)}
                </span>
                <span className={`ml-auto text-[11px] font-semibold ${
                  l.situacao === 'ABERTA' ? 'text-amber-300'
                  : l.situacao === 'ATENDIDA' ? 'text-emerald-400' : 'text-af-300'}`}>
                  {l.situacao === 'ABERTA' ? 'Aguardando' : l.situacao === 'ATENDIDA' ? 'Atendida' : 'Recusada'}
                </span>
              </div>
              {l.descricao && (l.item || l.serial) && (
                <p className="mt-1 text-sm italic text-graf-300">“{l.descricao}”</p>
              )}
              {l.resposta && <p className="mt-1 text-xs text-graf-400">Resposta: {l.resposta}</p>}

              {l.situacao === 'ABERTA' && podeMexer && (
                respondendo?.id === l.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={resposta} onChange={e => setResposta(e.target.value)} autoFocus
                      maxLength={300} aria-label="Resposta ao técnico"
                      placeholder={respondendo.situacao === 'RECUSADA'
                        ? 'Motivo (obrigatório): o técnico vai ler'
                        : 'Resposta ao técnico (opcional), ex.: retire no balcão amanhã'}
                      className="min-w-64 flex-1 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5
                                 text-xs outline-none focus:border-af-500" />
                    <button onClick={() => { setRespondendo(null); setResposta('') }}
                      className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300">
                      Cancelar
                    </button>
                    <button onClick={responder}
                      disabled={ocupado || (respondendo.situacao === 'RECUSADA' && !resposta.trim())}
                      className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-semibold text-white
                                 hover:bg-af-500 disabled:opacity-50">
                      {ocupado ? 'Enviando…' : respondendo.situacao === 'ATENDIDA' ? 'Confirmar atendimento' : 'Confirmar recusa'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => { setRespondendo({ id: l.id, situacao: 'ATENDIDA' }); setResposta('') }}
                      className="rounded-md border border-emerald-700/60 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-900/30">
                      Atender
                    </button>
                    <button onClick={() => { setRespondendo({ id: l.id, situacao: 'RECUSADA' }); setResposta('') }}
                      className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-300 hover:border-af-600 hover:text-af-300">
                      Recusar
                    </button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
