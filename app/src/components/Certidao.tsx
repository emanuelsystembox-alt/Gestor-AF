import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isoLocal } from '../lib/formato'
import { Painel, TabelaSimples } from './graficos'
import { CarregandoBloco } from './ui'

/**
 * Certidão de Atendimento (235, D-344) — a terceira aba de Indicadores.
 *
 * > "olhar os niveis de sinais que o nosso sistema ja faz (...) o % padrão,
 * >  ou seja, validando (...) validado com falha e validado sem falha que é
 * >  o regular (...) a nota de cada técnico por dia, deve ter grafico
 * >  semanal do mês, e o dia a dia do técnico. % sem validação"
 * >  — Emanuel, 09/11
 *
 * A base é a O.S. finalizada no portal da Claro; a validação (o "depois")
 * é classificada pela cor que o portal manda: verde = sem falha, vermelho =
 * com falha, amarelo = sem validação (D-330, D-332). O banco devolve as
 * contagens por técnico e dia (`certidao_atendimento`); as porcentagens e
 * as semanas são feitas aqui, sempre sobre as contagens — % de média de %
 * mentiria quando um dia tem 1 O.S. e outro tem 10.
 *
 * NOTA = % padrão = validados (com e sem falha) ÷ finalizados.
 */

interface Linha {
  tecnico_id: string; nome: string; matricula: string | null; equipe: string | null
  dia: string; finalizados: number; regular: number; com_falha: number; sem_validacao: number
}
interface Soma { fin: number; reg: number; falha: number; sem: number }

const COR = { reg: '#059669', falha: '#dc2626', sem: '#d97706' }

const soma = (ls: Linha[]): Soma => ls.reduce((s, l) => ({
  fin: s.fin + l.finalizados, reg: s.reg + l.regular,
  falha: s.falha + l.com_falha, sem: s.sem + l.sem_validacao,
}), { fin: 0, reg: 0, falha: 0, sem: 0 })

const pct = (n: number, d: number) => d ? (100 * n) / d : null
const p0 = (x: number | null) => x == null ? '—' : `${Math.round(x)}%`
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Domingo da semana do dia — a semana vai de domingo a sábado, como a
 *  escala da operação. */
function domingoDe(d: string) {
  const x = new Date(d + 'T12:00'); x.setDate(x.getDate() - x.getDay()); return isoLocal(x)
}

export function Certidao({ de, ate, equipe, buckets }: {
  de: string; ate: string; equipe: string | null; buckets: string[]
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('certidao_atendimento', {
      p_de: de, p_ate: ate, p_equipe: equipe, p_buckets: buckets.length ? buckets : null,
    }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else setLinhas((data ?? []) as Linha[])
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate, equipe, buckets])

  const tot = useMemo(() => soma(linhas), [linhas])

  const semanas = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const l of linhas) {
      const k = domingoDe(l.dia)
      m.set(k, [...(m.get(k) ?? []), l])
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ini, ls]) => {
      const fim = new Date(ini + 'T12:00'); fim.setDate(fim.getDate() + 6)
      const f = isoLocal(fim)
      return { rotulo: `${ddmm(ini < de ? de : ini)}–${ddmm(f > ate ? ate : f)}`, ...soma(ls) }
    })
  }, [linhas, de, ate])

  const dias = useMemo(() => [...new Set(linhas.map(l => l.dia))].sort(), [linhas])

  const tecnicos = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const l of linhas) m.set(l.tecnico_id, [...(m.get(l.tecnico_id) ?? []), l])
    return [...m.values()].map(ls => {
      const s = soma(ls)
      return { id: ls[0].tecnico_id, nome: ls[0].nome, equipe: ls[0].equipe,
               porDia: new Map(ls.map(l => [l.dia, l])), ...s,
               nota: pct(s.reg + s.falha, s.fin) }
    }).sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || b.fin - a.fin)
  }, [linhas])

  if (carregando) return <CarregandoBloco className="py-12" />
  if (erro) return <p className="py-6 text-sm text-af-400">{erro}</p>
  if (linhas.length === 0) return (
    <p className="py-8 text-center text-sm text-graf-400">
      Nenhuma O.S. finalizada com sinal lido do portal da Claro neste período.
    </p>
  )

  return (
    <div className="space-y-3">
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { r: 'Finalizadas', v: String(tot.fin), t: 'O.S. finalizadas no portal da Claro, com o sinal lido', cor: undefined },
          { r: '% padrão', v: p0(pct(tot.reg + tot.falha, tot.fin)), t: 'Validadas (com e sem falha) ÷ finalizadas', cor: undefined },
          { r: 'Validado sem falha', v: p0(pct(tot.reg, tot.fin)), t: `${tot.reg} · Nível Regular`, cor: COR.reg },
          { r: 'Validado com falha', v: p0(pct(tot.falha, tot.fin)), t: `${tot.falha} · Nível Irregular ou Erro na Coleta`, cor: COR.falha },
          { r: 'Sem validação', v: p0(pct(tot.sem, tot.fin)), t: `${tot.sem} · finalizada com a validação pendente`, cor: COR.sem },
        ].map(c => (
          <div key={c.r} className="card-controle p-3" title={c.t}>
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-graf-400">
              {c.cor && <span className="h-2 w-2 rounded-sm" style={{ background: c.cor }} />}{c.r}
            </p>
            <p className="tabular mt-1 text-2xl font-semibold text-graf-100">{c.v}</p>
          </div>
        ))}
      </section>

      <Painel titulo="Semana a semana" dica="% padrão no alto; a barra divide as finalizadas"
        tabela={<TabelaSimples colunas={['Semana', 'Finalizadas', '% padrão', 'Sem falha', 'Com falha', 'Sem validação']}
          linhas={semanas.map(s => [s.rotulo, s.fin, p0(pct(s.reg + s.falha, s.fin)),
            `${s.reg} · ${p0(pct(s.reg, s.fin))}`, `${s.falha} · ${p0(pct(s.falha, s.fin))}`,
            `${s.sem} · ${p0(pct(s.sem, s.fin))}`])} />}>
        <div className="flex h-44 items-stretch gap-3 border-b border-graf-800 pt-5">
          {semanas.map(s => (
            <div key={s.rotulo} className="relative flex h-full flex-1 flex-col justify-end"
              title={`${s.rotulo}: ${s.fin} finalizada(s) — ${s.reg} sem falha, ${s.falha} com falha, ${s.sem} sem validação`}>
              <span className="tabular absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-semibold text-graf-100">
                {p0(pct(s.reg + s.falha, s.fin))}
              </span>
              {([['sem', s.sem], ['falha', s.falha], ['reg', s.reg]] as const).map(([k, v]) => v > 0 && (
                <div key={k} className="first:rounded-t-[2px]"
                  style={{ height: `${(v / s.fin) * 100}%`, background: COR[k], minHeight: 3 }} />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3">
          {semanas.map(s => (
            <span key={s.rotulo} className="tabular flex-1 text-center text-[11px] text-graf-400">
              {s.rotulo} <span className="text-graf-400">· {s.fin}</span>
            </span>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-graf-300">
          {([['reg', 'Sem falha'], ['falha', 'Com falha'], ['sem', 'Sem validação']] as const).map(([k, r]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR[k] }} />{r}
            </span>
          ))}
        </div>
      </Painel>

      <section className="card-controle p-4">
        <h2 className="text-sm font-semibold">Nota do técnico, dia a dia</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-graf-800 text-left text-graf-400">
              <tr>
                <th className="sticky left-0 z-10 bg-graf-950 px-2 py-1.5 font-medium">Técnico</th>
                <th className="px-2 py-1.5 text-right font-medium" title="% padrão no período">Nota</th>
                <th className="px-2 py-1.5 text-right font-medium">Finaliz.</th>
                <th className="px-2 py-1.5 text-right font-medium" style={{ color: COR.reg }}>Sem falha</th>
                <th className="px-2 py-1.5 text-right font-medium" style={{ color: COR.falha }}>Com falha</th>
                <th className="px-2 py-1.5 text-right font-medium" style={{ color: COR.sem }}>Sem valid.</th>
                {dias.map(d => (
                  <th key={d} className="px-1 py-1.5 text-center font-medium">
                    <span className="block text-[9px] uppercase">
                      {new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3)}
                    </span>
                    <span className="tabular">{ddmm(d)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tecnicos.map(t => (
                <tr key={t.id} className="border-b border-graf-800/60 hover:bg-graf-850">
                  <td className="sticky left-0 z-10 max-w-56 truncate bg-graf-950 px-2 py-1.5">
                    <span className="text-graf-200">{t.nome}</span>
                    {t.equipe && <span className="ml-1.5 text-graf-400">{t.equipe}</span>}
                  </td>
                  <td className="tabular px-2 py-1.5 text-right font-semibold text-graf-100">{p0(t.nota)}</td>
                  <td className="tabular px-2 py-1.5 text-right text-graf-300">{t.fin}</td>
                  <td className="tabular px-2 py-1.5 text-right text-graf-300">{t.reg}</td>
                  <td className="tabular px-2 py-1.5 text-right text-graf-300">{t.falha}</td>
                  <td className="tabular px-2 py-1.5 text-right text-graf-300">{t.sem}</td>
                  {dias.map(d => {
                    const x = t.porDia.get(d)
                    return (
                      <td key={d} className="tabular px-1 py-1.5 text-center"
                        title={x ? `${x.finalizados} finalizada(s): ${x.regular} sem falha, ${x.com_falha} com falha, ${x.sem_validacao} sem validação` : ''}>
                        {x ? <span className="text-graf-100">{p0(pct(x.regular + x.com_falha, x.finalizados))}</span>
                          : <span className="text-graf-700">·</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
