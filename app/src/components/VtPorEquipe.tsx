import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isoLocal } from '../lib/formato'

/**
 * VT por equipe (156f) — a segunda aba de Indicadores.
 *
 * > "preciso de todos os logins abertos e mostre quanto é que ele
 * >  concluiu na linha dele (...) o executado e o não executado,
 * >  cancelado e os outros códigos não contabilizam (...) qual é a média
 * >  de execução de cada técnico" — Emanuel, 30/10
 *
 * 156: a régua era o "Status da Atividade" do TOA — e no TOA "concluído"
 * inclui a VT fechada com código improdutivo: 529 × 7 em 14 dias, todo
 * mundo perto de 100%.
 *
 * 161c (31/10, aprovado pelo Emanuel): a régua é o CÓDIGO de baixa da
 * operadora. Executado = código de SUCESSO e nenhum IMPRODUTIVO; não
 * executado = código IMPRODUTIVO (o "quebrado"); cancelado, reagendado e
 * sem código ficam fora. Medido em Manaus, 14 dias: 415 × 54, e a execução
 * vai de 80,9% a 97,6% entre os técnicos — agora a porcentagem separa.
 */
interface LinhaVt {
  tecnico_id: string; nome: string; matricula: string | null; equipe: string | null
  dias: number; executados: number; nao_executados: number; fora_da_conta: number
  pct_execucao: number | null; media_dia: number | null
  por_dia: { dia: string; exe: number; nao: number; fora: number }[]
}

export function VtPorEquipe({ de, ate, equipe, buckets }: {
  de: string; ate: string; equipe: string | null; buckets: string[]
}) {
  const [linhas, setLinhas] = useState<LinhaVt[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('vt_por_equipe', {
      p_de: de, p_ate: ate, p_equipe: equipe, p_buckets: buckets.length ? buckets : null,
    }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else setLinhas((data ?? []) as LinhaVt[])
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate, equipe, buckets])

  const dias = useMemo(() => {
    const out: string[] = []
    const d = new Date(de + 'T12:00'); const fim = new Date(ate + 'T12:00')
    while (d <= fim && out.length < 92) { out.push(isoLocal(d)); d.setDate(d.getDate() + 1) }
    return out
  }, [de, ate])

  const tot = useMemo(() => {
    const exe = linhas.reduce((s, l) => s + l.executados, 0)
    const nao = linhas.reduce((s, l) => s + l.nao_executados, 0)
    const fora = linhas.reduce((s, l) => s + l.fora_da_conta, 0)
    const diasTec = linhas.reduce((s, l) => s + l.dias, 0)
    return { exe, nao, fora, pct: exe + nao ? (100 * exe) / (exe + nao) : null,
             media: diasTec ? exe / diasTec : null }
  }, [linhas])

  if (carregando) return <p className="py-12 text-center text-graf-400">Carregando…</p>
  if (erro) return <p className="py-6 text-sm text-af-400">{erro}</p>

  const n1 = (x: number | null) => x == null ? '—' : x.toFixed(1).replace('.', ',')

  return (
    <div className="space-y-3">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { r: 'Executados', v: String(tot.exe), t: 'Código de baixa de SUCESSO, nenhum improdutivo' },
          { r: 'Não executados', v: String(tot.nao), t: 'Código de baixa IMPRODUTIVO (o contrato quebrado)' },
          { r: 'Média por dia', v: n1(tot.media), t: 'Executados ÷ dias com contrato, somando todos os técnicos' },
          { r: 'Média de execução', v: tot.pct == null ? '—' : `${n1(tot.pct)}%`, t: 'Executados ÷ (executados + não executados)' },
          { r: 'Fora da conta', v: String(tot.fora), t: 'Cancelado, reagendado ou ainda sem código — não entram' },
        ].map(c => (
          <div key={c.r} className="card-controle p-3" title={c.t}>
            <p className="text-[10px] uppercase tracking-wide text-graf-500">{c.r}</p>
            <p className="tabular mt-1 text-2xl font-semibold text-graf-100">{c.v}</p>
          </div>
        ))}
      </section>

      <p className="text-[11px] text-graf-400">
        <strong className="text-graf-300">Como ler:</strong> a régua é o <strong className="text-graf-300">código
        de baixa</strong>, não o status do TOA. Executado = código de sucesso; não executado =
        código improdutivo (o contrato quebrado). Cancelado, reagendado e o que ainda não tem
        código ficam fora da conta.
      </p>

      <section className="card-controle p-4">
        <h2 className="text-sm font-semibold">Todos os técnicos de manutenção — dia a dia</h2>
        <p className="mt-0.5 text-xs text-graf-400">
          Cada célula: executados <span className="text-emerald-300">✓</span> e não executados
          {' '}<span className="text-af-300">✕</span> do dia. Ordenado por quem mais executou.
        </p>
        {linhas.length === 0 ? (
          <p className="py-8 text-center text-sm text-graf-400">
            Nenhum técnico de manutenção ativo neste recorte.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-graf-800 text-left uppercase tracking-wide text-graf-500">
                <tr>
                  <th className="sticky left-0 bg-graf-950 px-2 py-2 font-medium">Técnico</th>
                  <th className="px-2 py-2 text-right font-medium">Dias</th>
                  <th className="px-2 py-2 text-right font-medium">Exec.</th>
                  <th className="px-2 py-2 text-right font-medium">Não exec.</th>
                  <th className="px-2 py-2 text-right font-medium" title="Executados por dia com contrato">Média/dia</th>
                  <th className="px-2 py-2 text-right font-medium">Execução</th>
                  {dias.map(d => (
                    <th key={d} className="px-1 py-2 text-center font-medium">
                      {new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => {
                  const porDia = new Map(l.por_dia.map(x => [x.dia, x]))
                  return (
                    <tr key={l.tecnico_id} className="border-b border-graf-800/60 hover:bg-graf-850">
                      <td className="sticky left-0 bg-graf-950 px-2 py-1.5">
                        <span className="text-graf-200">{l.nome}</span>
                        {l.equipe && <span className="ml-1.5 text-graf-500">{l.equipe}</span>}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right text-graf-300">{l.dias}</td>
                      <td className="tabular px-2 py-1.5 text-right font-semibold text-emerald-300">{l.executados}</td>
                      <td className="tabular px-2 py-1.5 text-right text-af-300">{l.nao_executados}</td>
                      <td className="tabular px-2 py-1.5 text-right text-graf-100">{n1(l.media_dia)}</td>
                      {/* Zero e desconhecido não são a mesma coisa: quem não
                          fechou nada no período fica com travessão, não 0%. */}
                      <td className="tabular px-2 py-1.5 text-right text-graf-300">
                        {l.pct_execucao == null ? <span className="text-graf-500">—</span> : `${n1(Number(l.pct_execucao))}%`}
                      </td>
                      {dias.map(d => {
                        const x = porDia.get(d)
                        return (
                          <td key={d} className="tabular px-1 py-1.5 text-center">
                            {!x ? <span className="text-graf-700">·</span> : (
                              <span title={`${x.exe} executado(s), ${x.nao} não executado(s), ${x.fora} fora da conta`}>
                                <span className="text-emerald-300">{x.exe}</span>
                                {x.nao > 0 && <span className="text-af-300">/{x.nao}</span>}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
