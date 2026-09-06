import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACOES, SITUACAO_INFO, type Situacao } from '../lib/supabase'

/**
 * Os dois quadros que faltavam no painel:
 *
 * 1. **Situação em cartões**, cada um na cor do cadastro — bate o olho e
 *    sabe onde está o dia, sem ler tabela.
 * 2. **Tipos de serviço em VOLUME e em PONTOS.** São leituras
 *    diferentes, e é por isso que as duas existem: DESCONEXÃO faz
 *    volume e quase não pontua; ADESÃO faz menos volume e carrega o
 *    faturamento. Olhar só o volume engana quem decide.
 */

interface VisitaMin {
  id: string
  situacao: Situacao
  tipo_servico: { nome: string } | null
  tipo_atividade: { natureza: string } | null
}
interface Ponto { visita_id: string; pontos_claro: number | null; achou: boolean }

const num = (n: number, casas = 0) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

export function StatusEPontos({
  linhas, de, ate,
}: { linhas: VisitaMin[]; de: string; ate: string }) {
  const [pontos, setPontos] = useState<Map<string, number>>(new Map())
  const [aba, setAba] = useState<'volume' | 'pontos'>('volume')

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    supabase.rpc('pontos_por_periodo', { p_de: de, p_ate: ate }).then(({ data }) => {
      if (!vivo) return
      const m = new Map<string, number>()
      for (const p of (data ?? []) as Ponto[]) {
        if (p.achou && p.pontos_claro != null) m.set(p.visita_id, Number(p.pontos_claro))
      }
      setPontos(m)
    })
    return () => { vivo = false }
  }, [de, ate])

  const produtivas = useMemo(
    () => linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA'), [linhas])

  const porSituacao = useMemo(() => {
    const c = new Map<string, number>()
    for (const v of produtivas) c.set(v.situacao, (c.get(v.situacao) ?? 0) + 1)
    return c
  }, [produtivas])

  /** Uma linha por grupo de serviço, com a contagem OU os pontos de cada situação. */
  const tabela = useMemo(() => {
    const m = new Map<string, { volume: Map<string, number>; pontos: Map<string, number> }>()
    for (const v of produtivas) {
      const g = v.tipo_servico?.nome ?? '(sem grupo)'
      if (!m.has(g)) m.set(g, { volume: new Map(), pontos: new Map() })
      const linha = m.get(g)!
      linha.volume.set(v.situacao, (linha.volume.get(v.situacao) ?? 0) + 1)
      const p = pontos.get(v.id) ?? 0
      linha.pontos.set(v.situacao, (linha.pontos.get(v.situacao) ?? 0) + p)
    }
    return [...m.entries()]
      .map(([grupo, d]) => ({
        grupo,
        total: [...d.volume.values()].reduce((a, b) => a + b, 0),
        totalPontos: [...d.pontos.values()].reduce((a, b) => a + b, 0),
        volume: d.volume, pontosPorSit: d.pontos,
      }))
      .sort((a, b) => (aba === 'volume' ? b.total - a.total : b.totalPontos - a.totalPontos))
  }, [produtivas, pontos, aba])

  // Só as situações que aparecem, na ordem do domínio.
  const colunas = useMemo(
    () => SITUACOES.filter(s => porSituacao.has(s)), [porSituacao])

  const totalPontos = [...pontos.values()].reduce((a, b) => a + b, 0)
  const semPontuacao = produtivas.filter(v => !pontos.has(v.id)).length

  if (produtivas.length === 0) return null

  return (
    <>
      {/* ---------- situação em cartões ---------- */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {colunas.map(s => {
          const info = SITUACAO_INFO[s]
          const n = porSituacao.get(s) ?? 0
          return (
            <Link key={s} to={`/controle/servicos`}
              className="card-controle group px-3 py-2.5 transition hover:ring-1"
              style={{ ['--tw-ring-color' as string]: info?.cor }}>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full"
                      style={{ background: info?.cor ?? '#64748b' }} />
                <span className="truncate text-[10px] uppercase tracking-wide text-graf-400">
                  {info?.label ?? s}
                </span>
              </div>
              <div className="tabular mt-1 text-2xl font-semibold leading-none"
                   style={{ color: info?.cor }}>
                {n}
              </div>
              <div className="mt-0.5 text-[10px] text-graf-600">
                {produtivas.length ? num(100 * n / produtivas.length, 1) : '0'}% do dia
              </div>
            </Link>
          )
        })}
      </section>

      {/* ---------- tipos de serviço: volume x pontos ---------- */}
      <section className="card-controle overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-graf-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold">Tipos de serviço</h2>
          <div className="flex rounded-md bg-graf-900 p-0.5">
            {([['volume', 'Volume'], ['pontos', 'Pontos']] as const).map(([a, rot]) => (
              <button key={a} onClick={() => setAba(a)}
                className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                  aba === a ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                {rot}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-graf-500">
            {aba === 'volume'
              ? `${produtivas.length} contratos produtivos`
              : <>
                  <strong className="tabular text-emerald-400">{num(totalPontos, 4)}</strong>
                  {' '}pontos CLARO
                  {semPontuacao > 0 &&
                    ` · ${semPontuacao} contrato(s) sem regra de pontuação`}
                </>}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 bg-graf-900 text-left
                              text-[11px] uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Grupo</th>
                {colunas.map(s => (
                  <th key={s} className="px-2 py-2 text-right font-medium">
                    <span style={{ color: SITUACAO_INFO[s]?.cor }}>
                      {SITUACAO_INFO[s]?.label ?? s}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">
                  {aba === 'volume' ? 'Contratos' : 'Pontos'}
                </th>
              </tr>
            </thead>
            <tbody>
              {tabela.map(l => (
                <tr key={l.grupo} className="border-b border-graf-800/60">
                  <td className="px-3 py-2 font-medium">{l.grupo}</td>
                  {colunas.map(s => {
                    const v = aba === 'volume'
                      ? l.volume.get(s) ?? 0
                      : l.pontosPorSit.get(s) ?? 0
                    return (
                      <td key={s} className="tabular px-2 py-2 text-right text-graf-300">
                        {v ? num(v, aba === 'volume' ? 0 : 2)
                           : <span className="text-graf-700">—</span>}
                      </td>
                    )
                  })}
                  <td className="tabular px-3 py-2 text-right font-semibold">
                    {aba === 'volume' ? num(l.total) : num(l.totalPontos, 2)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-graf-700 font-semibold">
                <td className="px-3 py-2">Total</td>
                {colunas.map(s => {
                  const v = tabela.reduce((soma, l) => soma + (aba === 'volume'
                    ? l.volume.get(s) ?? 0 : l.pontosPorSit.get(s) ?? 0), 0)
                  return (
                    <td key={s} className="tabular px-2 py-2 text-right"
                        style={{ color: SITUACAO_INFO[s]?.cor }}>
                      {v ? num(v, aba === 'volume' ? 0 : 2) : '—'}
                    </td>
                  )
                })}
                <td className="tabular px-3 py-2 text-right">
                  {aba === 'volume' ? num(produtivas.length) : num(totalPontos, 2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {aba === 'pontos' && (
          <p className="border-t border-graf-800 px-4 py-2 text-[11px] text-graf-500">
            Pontos CLARO, pela combinação de O.S. × edificação (D-045). O que a equipe
            recebe ainda não foi levantado — sem ele não dá para mostrar margem.
          </p>
        )}
      </section>
    </>
  )
}
