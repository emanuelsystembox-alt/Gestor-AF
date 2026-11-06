import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isoLocal } from '../lib/formato'
import { Alerta } from './ui'

/**
 * Base de clientes por área (212) — o denominador do AT1 do Dashboard VT.
 *
 * > "AT1 é a base de clientes das áreas (ex.: MA1 40 mil, MA5 30 mil =
 * >  70 mil)" — Emanuel, 05/11
 *
 * ┌─ a base tem VIGÊNCIA ─────────────────────────────────────────────┐
 * │ Gravar um número novo não reescreve o AT1 dos dias que passaram:  │
 * │ cada valor vale a partir do dia escolhido (padrão: hoje), como a  │
 * │ meta da skill (D-167). Área sem base é "sem base" no Dashboard,   │
 * │ nunca zero. Quem pode gravar é o banco que diz (RLS +             │
 * │ `pode_configurar`); a cidade é a ativa, e o autor é carimbado     │
 * │ pelo servidor.                                                     │
 * └────────────────────────────────────────────────────────────────────┘
 */

interface Area { id: string; codigo: string; apelido: string | null; ativo: boolean; base_id: string | null }
interface Vigencia {
  id: string; area_id: string; vigencia_inicio: string; clientes: number
  atualizado_em: string; autor: { nome: string | null } | null
}

const n0 = (x: number) => x.toLocaleString('pt-BR')
const dataBR = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('pt-BR')

export function DashboardVTBaseClientes() {
  const [areas, setAreas] = useState<Area[]>([])
  const [vig, setVig] = useState<Vigencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [rascunho, setRascunho] = useState<Record<string, { clientes: string; desde: string }>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [historico, setHistorico] = useState<string | null>(null)
  const hoje = isoLocal(new Date())

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    Promise.all([
      supabase.from('area_trabalho').select('id, codigo, apelido, ativo, base_id')
        .not('base_id', 'is', null).order('codigo'),
      supabase.from('base_clientes_area')
        .select('id, area_id, vigencia_inicio, clientes, atualizado_em, autor:atualizado_por ( nome )')
        .order('vigencia_inicio', { ascending: false }).range(0, 999),
    ]).then(([a, b]) => {
      if (!vivo) return
      const e = a.error ?? b.error
      if (e) setErro(e.message)
      else {
        setAreas((a.data ?? []) as Area[])
        setVig((b.data ?? []) as unknown as Vigencia[])
      }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [versao])

  /** A base que vale HOJE e a próxima, se alguém já agendou uma. */
  const porArea = useMemo(() => {
    const m = new Map<string, { atual: Vigencia | null; futura: Vigencia | null; todas: Vigencia[] }>()
    for (const a of areas) m.set(a.id, { atual: null, futura: null, todas: [] })
    for (const v of vig) {
      const x = m.get(v.area_id); if (!x) continue
      x.todas.push(v)
      if (v.vigencia_inicio <= hoje) { if (!x.atual) x.atual = v }
      else x.futura = v   // a lista vem da mais nova para a mais velha: fica a mais próxima
    }
    return m
  }, [areas, vig, hoje])

  const total = useMemo(() => [...porArea.values()]
    .reduce((s, x) => s + (x.atual?.clientes ?? 0), 0), [porArea])
  const comBase = [...porArea.values()].filter(x => x.atual).length

  async function salvar(a: Area) {
    const r = rascunho[a.id]
    const n = Number((r?.clientes ?? '').replace(/\D/g, ''))
    if (!Number.isInteger(n) || n <= 0) {
      setErro('A base de clientes é um número inteiro maior que zero.'); return
    }
    setOcupado(a.id); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_base_clientes_area', {
      p_area: a.id, p_clientes: n, p_desde: r?.desde || hoje,
    })
    setOcupado(null)
    if (error) { setErro(error.message); return }
    setOk(`${a.apelido || a.codigo}: ${n0(n)} clientes a partir de ${dataBR(r?.desde || hoje)}.`)
    setRascunho(x => { const y = { ...x }; delete y[a.id]; return y })
    setVersao(v => v + 1)
  }

  async function apagar(v: Vigencia, rotulo: string) {
    if (!confirm(`Tirar a base de ${n0(v.clientes)} clientes de ${rotulo}, vigente desde ${dataBR(v.vigencia_inicio)}?`)) return
    setOcupado(v.id); setErro(null); setOk(null)
    const { error, count } = await supabase.from('base_clientes_area')
      .delete({ count: 'exact' }).eq('id', v.id)
    setOcupado(null)
    // RLS que barra o DELETE não dá erro: apaga 0 linhas. Por isso a contagem.
    if (error) { setErro(error.message); return }
    if (!count) { setErro('Não apagou: só quem configura a operação tira uma base.'); return }
    setOk(`Base de ${rotulo} desde ${dataBR(v.vigencia_inicio)} retirada.`)
    setVersao(x => x + 1)
  }

  const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-sm outline-none focus:border-af-500'

  return (
    <section className="card-controle overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-graf-800 px-4 py-3">
        <div className="min-w-64 flex-1">
          <h2 className="text-sm font-semibold">Base de clientes por área</h2>
          <p className="mt-1 text-xs text-graf-400">
            O denominador do AT1 no Dashboard de Visita Técnica, da cidade ativa. Cada valor vale a
            partir do dia escolhido — o AT1 dos dias anteriores não muda.
          </p>
        </div>
        <p className="tabular text-xs text-graf-300">
          <strong className="text-graf-100">{n0(total)}</strong> clientes hoje ·{' '}
          {comBase} de {areas.length} áreas
        </p>
      </div>

      {erro && <div className="px-4 pt-3"><Alerta tipo="erro">{erro}</Alerta></div>}
      {ok && <div className="px-4 pt-3"><Alerta tipo="ok">{ok}</Alerta></div>}

      {carregando ? (
        <p className="py-10 text-center text-sm text-graf-400">Carregando…</p>
      ) : areas.length === 0 ? (
        <p className="py-10 text-center text-sm text-graf-400">Nenhuma área de trabalho nesta cidade.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 text-left text-[11px] uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-4 py-2 font-medium">Área</th>
                <th className="px-3 py-2 text-right font-medium">Base hoje</th>
                <th className="px-3 py-2 font-medium">Nova base</th>
                <th className="px-3 py-2 font-medium">Vale a partir de</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {areas.map(a => {
                const x = porArea.get(a.id)!
                const r = rascunho[a.id] ?? { clientes: '', desde: hoje }
                const rot = a.apelido || a.codigo
                const aberto = historico === a.id
                return (
                  <Fragment key={a.id}>
                    <tr className={`border-b border-graf-800/60 ${a.ativo ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-2">
                        <span className="font-medium text-graf-100">{rot}</span>
                        {a.apelido && a.apelido !== a.codigo && (
                          <span className="ml-1.5 text-[11px] text-graf-400">{a.codigo}</span>
                        )}
                        {!a.ativo && <span className="ml-1.5 text-[11px] text-graf-400">inativa</span>}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {x.atual ? (
                          <span title={`desde ${dataBR(x.atual.vigencia_inicio)} · gravado por ${x.atual.autor?.nome ?? '—'} em ${new Date(x.atual.atualizado_em).toLocaleString('pt-BR')}`}>
                            {n0(x.atual.clientes)}
                          </span>
                        ) : <span className="text-amber-300">sem base</span>}
                        {x.futura && (
                          <span className="block text-[11px] text-graf-400">
                            {n0(x.futura.clientes)} a partir de {dataBR(x.futura.vigencia_inicio)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input value={r.clientes} inputMode="numeric" placeholder="clientes"
                          aria-label={`Nova base de clientes de ${rot}`}
                          onChange={e => setRascunho(s => ({ ...s, [a.id]: { ...r, clientes: e.target.value.replace(/\D/g, '') } }))}
                          onKeyDown={e => { if (e.key === 'Enter') salvar(a) }}
                          className={`tabular w-28 text-right ${campo}`} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="date" value={r.desde} aria-label={`Vale a partir de, ${rot}`}
                          onChange={e => setRascunho(s => ({ ...s, [a.id]: { ...r, desde: e.target.value } }))}
                          className={`tabular ${campo}`} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button type="button" onClick={() => salvar(a)}
                          disabled={ocupado === a.id || !r.clientes}
                          className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-semibold text-white
                                     hover:bg-af-500 disabled:opacity-40">
                          Salvar
                        </button>
                        {x.todas.length > 0 && (
                          <button type="button" onClick={() => setHistorico(h => h === a.id ? null : a.id)}
                            aria-expanded={aberto}
                            className="ml-2 text-[11px] text-graf-300 underline-offset-2 hover:underline">
                            histórico {x.todas.length}
                          </button>
                        )}
                      </td>
                    </tr>
                    {aberto && (
                      <tr className="border-b border-graf-800/60 bg-graf-900">
                        <td colSpan={5} className="px-4 py-2">
                          <ul className="space-y-1 text-xs">
                            {x.todas.map(v => (
                              <li key={v.id} className="flex flex-wrap items-center gap-x-3">
                                <span className="tabular w-24 text-graf-300">desde {dataBR(v.vigencia_inicio)}</span>
                                <span className="tabular w-24 text-right font-semibold">{n0(v.clientes)}</span>
                                <span className="text-graf-400">
                                  {v.autor?.nome ?? '—'} · {new Date(v.atualizado_em).toLocaleString('pt-BR')}
                                </span>
                                <button type="button" onClick={() => apagar(v, rot)} disabled={ocupado === v.id}
                                  className="ml-auto text-af-400 underline-offset-2 hover:underline disabled:opacity-40">
                                  tirar
                                </button>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-graf-800 px-4 py-2.5 text-xs text-graf-400">
        Só quem configura a operação grava — quem barra é o banco.
      </p>
    </section>
  )
}
