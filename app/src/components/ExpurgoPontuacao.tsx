import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta } from './ui'

/**
 * Expurgo de pontuação por lote de WOs — ADMIN ou quem tem "Desatribuir pontuação" (136, 161).
 *
 * > "o admin poderá jogar todas as WOs que o sistema deve expurgar por
 * >  alguma ordem da gerência (...) o técnico anexou foto de uma coisa,
 * >  mas era de outra (...) poderia botar assim, expurgar ou retornar a
 * >  pontuação novamente" — Emanuel, 25/10
 *
 * ESCOPO por lote (escolha dele): **do técnico** tira só do painel e do
 * ranking dele; **de todos** tira também da conta da empresa.
 *
 * O motivo é obrigatório. Expurgo sem motivo é número que ninguém
 * explica seis meses depois — a mesma regra da reversão de situação
 * (D-030). E nada se apaga: devolver carimba o desfazimento, e as duas
 * decisões ficam no histórico do contrato.
 */

interface Linha {
  id: number; visita_id: string; contrato: string | null; wo_numero: string | null
  digitado: string | null; escopo: 'TECNICO' | 'TODOS'; motivo: string
  criado_em: string; quem: string | null
  desfeito_em: string | null; desfeito_motivo: string | null; desfeito_por_quem: string | null
  data_agendada: string; tecnico: string | null; pontos: number | null
}

interface Resultado {
  expurgados?: number; ja_estavam?: number; devolvidos?: number
  nao_encontradas?: string[]
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm outline-none focus:border-af-500'

/** Aceita colado de planilha: uma por linha, vírgula, ponto-e-vírgula ou espaço. */
const separar = (texto: string) =>
  texto.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean)

export function ExpurgoPontuacao() {
  const [wos, setWos] = useState('')
  const [escopo, setEscopo] = useState<'TECNICO' | 'TODOS'>('TECNICO')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [res, setRes] = useState<Resultado | null>(null)
  const [indo, setIndo] = useState(false)
  const [linhas, setLinhas] = useState<Linha[]>([])

  const lista = separar(wos)

  function carregar() {
    supabase.rpc('lista_expurgos', { p_limite: 200 })
      .then(({ data }) => setLinhas((data ?? []) as Linha[]))
  }
  useEffect(() => { carregar() }, [])

  async function agir(acao: 'expurgar' | 'devolver') {
    if (lista.length === 0) { setErro('Cole pelo menos uma WO.'); return }
    if (!motivo.trim()) { setErro('Escreva o motivo — ele fica no histórico do contrato.'); return }
    setIndo(true); setErro(null); setRes(null)
    const { data, error } = acao === 'expurgar'
      ? await supabase.rpc('expurgar_pontuacao',
          { p_wos: lista, p_escopo: escopo, p_motivo: motivo.trim() })
      : await supabase.rpc('devolver_pontuacao', { p_wos: lista, p_motivo: motivo.trim() })
    setIndo(false)
    if (error) { setErro(error.message); return }
    setRes(data as Resultado)
    setWos(''); setMotivo('')
    carregar()
  }

  return (
    <section className="space-y-4">
      <div className="card-controle p-4">
        <h2 className="text-sm font-semibold">Expurgar pontuação</h2>
        <p className="mt-1 text-xs text-graf-400">
          Cole as WOs (uma por linha, ou separadas por vírgula). Também aceita o número do
          contrato ou o ID da atividade do TOA. O que não for encontrado é listado — nada
          acontece em silêncio.
        </p>

        {erro && <div className="mt-3"><Alerta tipo="erro">{erro}</Alerta></div>}
        {res && (
          <div className="mt-3">
            <Alerta tipo={res.nao_encontradas?.length ? 'aviso' : 'ok'}>
              {res.expurgados != null && <>{res.expurgados} expurgado(s). </>}
              {res.ja_estavam ? <>{res.ja_estavam} já estava(m) expurgado(s). </> : null}
              {res.devolvidos != null && <>{res.devolvidos} devolvido(s). </>}
              {res.nao_encontradas?.length
                ? <>Não encontrada(s): <span className="tabular">{res.nao_encontradas.join(', ')}</span>.</>
                : null}
            </Alerta>
          </div>
        )}

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          <textarea value={wos} onChange={e => setWos(e.target.value)} rows={5}
            placeholder={'00121|232063780\n232074528\n209045283'}
            aria-label="WOs para expurgar"
            className={`${campo} w-full resize-y font-mono text-xs`} />
          <div className="flex flex-col gap-2">
            <label className="text-[11px] text-graf-400">
              Tira a pontuação
              <select value={escopo} onChange={e => setEscopo(e.target.value as 'TECNICO' | 'TODOS')}
                className={`${campo} mt-1 w-full`}>
                <option value="TECNICO">só do técnico</option>
                <option value="TODOS">de todos (técnico e empresa)</option>
              </select>
            </label>
            <p className="max-w-56 text-[11px] text-graf-500">
              {escopo === 'TECNICO'
                ? 'O serviço continua contando para a empresa e para o COP. Some do painel e do ranking do técnico.'
                : 'Sai também da produtividade e do painel de Equipes. Use quando o serviço não vale nem para a AFLINE.'}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1 text-[11px] text-graf-400">
            Motivo (obrigatório)
            <input value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300}
              placeholder="Ex.: foto de outro contrato, conferido no TOA"
              className={`${campo} mt-1 w-full`} />
          </label>
          <span className="tabular text-xs text-graf-400">
            {lista.length} WO(s) coladas
          </span>
          <button onClick={() => agir('expurgar')} disabled={indo}
            className="rounded-md bg-af-600 px-4 py-1.5 text-sm font-medium text-white
                       hover:bg-af-500 disabled:opacity-40">
            {indo ? 'Aplicando…' : 'Expurgar'}
          </button>
          <button onClick={() => agir('devolver')} disabled={indo}
            className="rounded-md border border-graf-700 px-4 py-1.5 text-sm text-graf-200
                       hover:border-emerald-600 hover:text-emerald-300 disabled:opacity-40">
            Devolver pontuação
          </button>
        </div>
      </div>

      <div className="card-controle overflow-hidden">
        <p className="border-b border-graf-800 px-4 py-2.5 text-xs text-graf-400">
          Os últimos {linhas.length} lançamentos. Devolvido continua na lista: o histórico é
          o que explica o número no fim do mês.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Quando</th>
                <th className="px-3 py-2 font-medium">Contrato / WO</th>
                <th className="px-3 py-2 font-medium">Dia</th>
                <th className="px-3 py-2 font-medium">Técnico</th>
                <th className="px-3 py-2 font-medium">Pontos</th>
                <th className="px-3 py-2 font-medium">Escopo</th>
                <th className="px-3 py-2 font-medium">Motivo</th>
                <th className="px-3 py-2 font-medium">Quem</th>
                <th className="px-3 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-graf-500">
                  Nenhuma pontuação expurgada até agora.
                </td></tr>
              )}
              {linhas.map(l => (
                <tr key={l.id} className="border-b border-graf-800/60 align-top">
                  <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">
                    {new Date(l.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-3 py-2">
                    <a href={`/controle/visita/${l.visita_id}`}
                       className="tabular text-af-400 underline underline-offset-2">
                      {l.contrato ?? l.visita_id.slice(0, 8)}
                    </a>
                    <div className="tabular text-[11px] text-graf-500">{l.wo_numero ?? '—'}</div>
                  </td>
                  <td className="tabular px-3 py-2 text-xs text-graf-300">
                    {new Date(l.data_agendada + 'T12:00').toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-3 py-2 text-xs text-graf-300">{l.tecnico ?? '—'}</td>
                  <td className="tabular px-3 py-2 text-xs text-graf-300">
                    {/* Com escopo TODOS a conta já devolve zero: dizer "—"
                        seria esconder que o expurgo é a causa. */}
                    {l.pontos != null ? Number(l.pontos).toFixed(2).replace('.', ',')
                                      : <span className="text-graf-600">sem regra</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      l.escopo === 'TODOS' ? 'bg-af-900/40 text-af-300' : 'bg-graf-800 text-graf-300'}`}>
                      {l.escopo === 'TODOS' ? 'de todos' : 'do técnico'}
                    </span>
                  </td>
                  <td className="max-w-64 px-3 py-2 text-xs text-graf-300">{l.motivo}</td>
                  <td className="px-3 py-2 text-xs text-graf-400">{l.quem ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {l.desfeito_em ? (
                      <span className="text-emerald-300">
                        devolvida em {new Date(l.desfeito_em).toLocaleDateString('pt-BR')}
                        {l.desfeito_motivo && <div className="text-[11px] text-graf-400">“{l.desfeito_motivo}”</div>}
                        {l.desfeito_por_quem && <div className="text-[11px] text-graf-500">{l.desfeito_por_quem}</div>}
                      </span>
                    ) : <span className="text-af-300">expurgada</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
