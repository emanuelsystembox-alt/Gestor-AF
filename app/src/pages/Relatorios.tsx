import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase, SITUACOES, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import {
  SELECT_RELATORIO, PONTUACAO_NA_PRIMEIRA, porContrato, porOS, paraCSV,
  type VisitaLinha, type PontoVisita, type Indicador,
} from '../lib/relatorio'
import { Shell } from '../components/Shell'
import { Alerta } from '../components/ui'

/**
 * Relatórios — por contrato e por O.S.
 *
 * A montagem das linhas mora em `lib/relatorio.ts`; aqui é só a tela:
 * período, filtros, prévia e download. Ver lá o porquê de cada coluna
 * e por que a pontuação sai só na primeira O.S. do endereço.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10)

export default function Relatorios() {
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [tipo, setTipo] = useState<'contrato' | 'os'>('contrato')
  const [formato, setFormato] = useState<'xlsx' | 'csv'>('xlsx')
  const [linhas, setLinhas] = useState<VisitaLinha[]>([])
  const [pontos, setPontos] = useState<Map<string, PontoVisita>>(new Map())
  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // filtros
  const [equipes, setEquipes] = useState<string[]>([])
  const [grupos, setGrupos] = useState<string[]>([])
  const [situacoes, setSituacoes] = useState<Situacao[]>([])
  const [supervisores, setSupervisores] = useState<string[]>([])
  const [semJornada, setSemJornada] = useState(true)

  useEffect(() => {
    supabase.from('visita').select('data_agendada')
      .order('data_agendada', { ascending: false }).limit(1)
      .then(({ data }) => {
        const u = (data as { data_agendada: string }[] | null)?.[0]?.data_agendada ?? iso(new Date())
        setDe(u); setAte(u)
      })
    supabase.from('indicador_qualidade').select('id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => setIndicadores((data ?? []) as Indicador[]))
  }, [])

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    setCarregando(true); setErro(null)

    // Duas chamadas, não uma por linha: a pontuação do período inteiro
    // resolve num RPC só (D-045).
    Promise.all([
      supabase.from('visita').select(SELECT_RELATORIO)
        .is('excluido_em', null)
        .gte('data_agendada', de).lte('data_agendada', ate)
        .order('data_agendada').order('janela_inicio', { nullsFirst: false }),
      supabase.rpc('pontos_por_periodo', { p_de: de, p_ate: ate }),
    ]).then(([v, p]) => {
      if (!vivo) return
      if (v.error) setErro(v.error.message)
      else setLinhas((v.data ?? []) as unknown as VisitaLinha[])
      const m = new Map<string, PontoVisita>()
      for (const x of (p.data ?? []) as PontoVisita[]) m.set(x.visita_id, x)
      setPontos(m)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate])

  const opcoes = useMemo(() => ({
    equipes: [...new Set(linhas.map(l => l.equipe?.codigo).filter(Boolean) as string[])].sort(),
    grupos: [...new Set(linhas.map(l => l.tipo_servico?.nome).filter(Boolean) as string[])].sort(),
    supers: [...new Set(linhas.map(l => l.equipe?.supervisor_nome).filter(Boolean) as string[])].sort(),
  }), [linhas])

  const filtradas = useMemo(() => linhas.filter(l => {
    if (semJornada && l.tipo_atividade?.natureza === 'JORNADA') return false
    if (equipes.length && !equipes.includes(l.equipe?.codigo ?? '')) return false
    if (grupos.length && !grupos.includes(l.tipo_servico?.nome ?? '')) return false
    if (supervisores.length && !supervisores.includes(l.equipe?.supervisor_nome ?? '')) return false
    if (situacoes.length && !situacoes.includes(l.situacao)) return false
    return true
  }), [linhas, semJornada, equipes, grupos, supervisores, situacoes])

  const totalOS = filtradas.reduce((s, l) => s + l.ordem_servico.length, 0)

  const montado = useMemo(
    () => tipo === 'contrato'
      ? porContrato(filtradas, pontos, indicadores)
      : porOS(filtradas, pontos, indicadores),
    [filtradas, pontos, indicadores, tipo])

  const somaPontos = useMemo(() => {
    let s = 0
    for (const v of filtradas) s += Number(pontos.get(v.id)?.pontos_claro ?? 0)
    return s
  }, [filtradas, pontos])

  const semRegra = useMemo(
    () => filtradas.filter(v => {
      const p = pontos.get(v.id)
      return v.tipo_atividade?.natureza !== 'JORNADA' && (!p || !p.achou)
    }).length,
    [filtradas, pontos])

  function baixar() {
    const nome = `afline-relatorio-${tipo}-${de}${de !== ate ? '_a_' + ate : ''}`
    if (formato === 'csv') {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(paraCSV(montado))
      a.download = `${nome}.csv`
      a.click(); URL.revokeObjectURL(a.href)
      return
    }
    const ws = XLSX.utils.aoa_to_sheet(montado)
    // Sem largura mínima o Excel abre 60 colunas de 8 caracteres e nada
    // é legível. Largura pela maior célula, com teto.
    ws['!cols'] = montado[0].map((_, j) => ({
      wch: Math.min(42, Math.max(10,
        ...montado.slice(0, 200).map(l => String(l[j] ?? '').length + 2))),
    }))
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, tipo === 'contrato' ? 'Por contrato' : 'Por O.S.')
    XLSX.writeFile(wb, `${nome}.xlsx`)
  }

  const previa = useMemo(() => montado.slice(0, 8), [montado])
  const totalLinhas = montado.length - 1

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs'
  const multi = (valores: string[], setar: (v: string[]) => void, opts: string[]) => (
    <select multiple value={valores} className={`${sel} h-24 w-full`}
      onChange={e => setar([...e.target.selectedOptions].map(o => o.value))}>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  return (
    <Shell>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Relatórios</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            <strong>Por contrato</strong> dá uma linha por visita — é a leitura de
            deslocamento, janela e pontuação. <strong>Por O.S.</strong> dá uma linha por
            ordem, com o contrato repetido — é a leitura de baixa e faturamento, e
            marca qual O.S. foi a primeira do endereço.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        <section className="card-controle space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-graf-400">
              <span className="mb-1 block">De</span>
              <input type="date" value={de} onChange={e => setDe(e.target.value)}
                className={`tabular ${sel}`} />
            </label>
            <label className="text-xs text-graf-400">
              <span className="mb-1 block">Até</span>
              <input type="date" value={ate} onChange={e => setAte(e.target.value)}
                className={`tabular ${sel}`} />
            </label>

            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Tipo de relatório</span>
              <div className="flex rounded-md bg-graf-900 p-0.5">
                {([['contrato', 'Por contrato'], ['os', 'Por O.S.']] as const).map(([t, rot]) => (
                  <button key={t} onClick={() => setTipo(t)}
                    className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                      tipo === t ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                    {rot}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Formato</span>
              <div className="flex rounded-md bg-graf-900 p-0.5">
                {([['xlsx', 'Excel'], ['csv', 'CSV']] as const).map(([f, rot]) => (
                  <button key={f} onClick={() => setFormato(f)}
                    className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                      formato === f ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                    {rot}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={semJornada}
                onChange={e => setSemJornada(e.target.checked)} className="accent-af-600" />
              Ocultar jornada
            </label>

            <button onClick={baixar} disabled={carregando || totalLinhas === 0}
              className="ml-auto rounded-lg bg-af-600 px-5 py-2 text-sm font-semibold text-white
                         hover:bg-af-500 disabled:opacity-50">
              Baixar {formato === 'xlsx' ? 'Excel' : 'CSV'} · {totalLinhas} linhas ·{' '}
              {montado[0]?.length ?? 0} colunas
            </button>
          </div>

          <div className="grid gap-3 border-t border-graf-800 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Equipes ({equipes.length || 'todas'})</span>
              {multi(equipes, setEquipes, opcoes.equipes)}
            </div>
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Tipo de serviço ({grupos.length || 'todos'})</span>
              {multi(grupos, setGrupos, opcoes.grupos)}
            </div>
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Supervisor ({supervisores.length || 'todos'})</span>
              {multi(supervisores, setSupervisores, opcoes.supers)}
            </div>
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Situação ({situacoes.length || 'todas'})</span>
              <select multiple value={situacoes} className={`${sel} h-24 w-full`}
                onChange={e => setSituacoes([...e.target.selectedOptions]
                  .map(o => o.value as Situacao))}>
                {SITUACOES.map(s => (
                  <option key={s} value={s}>{SITUACAO_INFO[s]?.label ?? s}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-graf-500">
            Segure Ctrl (ou Cmd) para escolher mais de um. Nada selecionado = todos.
          </p>
        </section>

        {/* ---------- o que está indo no arquivo ---------- */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Visitas', String(filtradas.length)],
            ['Ordens de serviço', String(totalOS)],
            ['Pontuação CLARO', somaPontos.toFixed(4).replace('.', ',')],
            ['Sem regra de pontuação', String(semRegra)],
          ].map(([rot, val], i) => (
            <div key={rot} className={`card-controle px-3.5 py-3 ${
              i === 3 && semRegra > 0 ? 'ring-1 ring-amber-600/50' : ''}`}>
              <div className="tabular text-2xl font-semibold leading-none">{val}</div>
              <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">{rot}</div>
            </div>
          ))}
        </section>

        <Alerta tipo="info">{PONTUACAO_NA_PRIMEIRA}</Alerta>

        <section className="card-controle overflow-hidden">
          <div className="border-b border-graf-800 px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              Prévia — {tipo === 'contrato' ? 'por contrato' : 'por O.S.'}
            </h2>
            <p className="mt-0.5 text-xs text-graf-400">
              As 7 primeiras linhas do arquivo, exatamente como vão sair. Role para o
              lado: são {montado[0]?.length ?? 0} colunas.
            </p>
          </div>
          {carregando ? (
            <p className="px-4 py-8 text-center text-sm text-graf-400">Carregando…</p>
          ) : totalLinhas === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-graf-500">
              Nenhuma linha para estes filtros.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  uppercase tracking-wide text-graf-400">
                  <tr>
                    {previa[0].map((c, i) => (
                      <th key={`${c}-${i}`} className="whitespace-nowrap px-2.5 py-2 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previa.slice(1).map((l, i) => (
                    <tr key={i} className="border-b border-graf-800/60">
                      {l.map((c, j) => (
                        <td key={j} className="max-w-56 truncate whitespace-nowrap px-2.5 py-1.5
                                               text-graf-300" title={c}>
                          {c || <span className="text-graf-700">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}
