import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Alerta } from './ui'

/**
 * As metas por skill, na Administração (092).
 *
 * > "a meta precisa ser configuravel na tela do administrador"
 * >  — Emanuel, 27/09
 *
 * A meta sempre foi por SKILL (D-094): é por `tecnico.skill` que o
 * técnico acha a meta dele. Esta aba mostra todas lado a lado, porque o
 * buraco que interessa é justamente a skill SEM meta — foi ele que deixou
 * a central sem saber quem estava abaixo do ritmo.
 *
 * Aqui se muda só a META. As faixas de comissão (fator por pontuação)
 * continuam em Meta técnica, onde está a tabela inteira.
 */

interface Linha {
  skill: string; skill_ativa: boolean; meta: number | null; desde: string | null
  criado_por: string | null; faixas: number; tecnicos: number
}

const num2 = (n: number) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const data = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('pt-BR')

export function MetasPorSkill({ podeEditar }: { podeEditar: boolean }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function carregar() {
    const { data: d, error } = await supabase.rpc('metas_das_skills')
    if (error) setErro(error.message)
    setLinhas((d ?? []) as Linha[])
  }
  useEffect(() => { carregar() }, [])

  async function salvar(skill: string) {
    const meta = Number(valor.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(meta) || meta <= 0) { setErro('A meta tem de ser um número maior que zero.'); return }
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_meta_comissao', { p_skill: skill, p_meta: meta })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    setOk(`Meta de ${skill} agora é ${num2(meta)} pontos no mês, a partir de hoje.`)
    setEditando(null); setValor('')
    await carregar()
  }

  return (
    <section className="card-controle overflow-hidden">
      <div className="border-b border-graf-800 px-4 py-3">
        <h2 className="font-medium">Metas por skill</h2>
        <p className="mt-1 max-w-3xl text-sm text-graf-400">
          Pontos que o técnico precisa fazer no mês. A meta é da <strong>skill</strong>: o
          técnico acha a dele pelo cadastro. Mudar a meta não reescreve o passado — a antiga
          vale até ontem, a nova a partir de hoje. A meta do dia (para o ritmo da central) é a
          do mês ÷ 26. As faixas de comissão ficam em{' '}
          <Link to="/controle/produtividade" className="text-af-400 underline underline-offset-2">Meta técnica</Link>.
        </p>
      </div>
      {erro && <div className="p-3"><Alerta tipo="erro">{erro}</Alerta></div>}
      {ok && <div className="p-3"><Alerta tipo="ok">{ok}</Alerta></div>}

      {linhas == null ? (
        <p className="px-4 py-8 text-center text-sm text-graf-400">Carregando…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px] uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Skill</th>
                <th className="px-3 py-2 text-right font-medium">Meta no mês</th>
                <th className="px-3 py-2 text-right font-medium">Meta do dia</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 text-right font-medium">Técnicos</th>
                <th className="px-3 py-2 text-right font-medium">Faixas</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.skill} className="border-b border-graf-800">
                  <td className="px-3 py-2">
                    {l.skill}
                    {!l.skill_ativa && <span className="ml-1.5 text-[11px] text-graf-400">(legado)</span>}
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {editando === l.skill ? (
                      <input value={valor} onChange={e => setValor(e.target.value)} autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') salvar(l.skill); if (e.key === 'Escape') setEditando(null) }}
                        aria-label={`Nova meta de ${l.skill}`} inputMode="decimal"
                        className="w-24 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-right text-sm
                                   outline-none focus:border-af-500" />
                    ) : l.meta == null
                      // D-117: sem meta não é meta zero.
                      ? <span className="text-amber-300">sem meta</span>
                      : <strong>{num2(l.meta)}</strong>}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-graf-300">
                    {l.meta == null ? '—' : num2(l.meta / 26)}
                  </td>
                  <td className="px-3 py-2 text-xs text-graf-400">
                    {l.desde ? `${data(l.desde)}${l.criado_por ? ` · ${l.criado_por}` : ''}` : '—'}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{l.tecnicos}</td>
                  <td className="tabular px-3 py-2 text-right">
                    {l.faixas || <span className="text-amber-300" title="Sem faixa não há fator, e sem fator o 'a receber' fica em branco">0</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {podeEditar && (editando === l.skill ? (
                      <span className="flex justify-end gap-1.5">
                        <button onClick={() => setEditando(null)}
                          className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300">Cancelar</button>
                        <button onClick={() => salvar(l.skill)} disabled={ocupado}
                          className="rounded-md bg-af-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                          {ocupado ? 'Salvando…' : 'Salvar'}
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => { setEditando(l.skill); setValor(l.meta == null ? '' : String(l.meta).replace('.', ',')); setOk(null) }}
                        className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300 hover:border-af-600 hover:text-af-400">
                        {l.meta == null ? 'Definir meta' : 'Mudar'}
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!podeEditar && (
        <p className="px-4 py-3 text-xs text-graf-400">
          Somente leitura — mudar a meta exige a permissão “Editar meta e comissão do técnico”.
        </p>
      )}
    </section>
  )
}
