import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, SITUACOES, EM_ABERTO, type Situacao } from '../lib/supabase'
import type { Visita } from '../lib/metricas'
import { Shell } from '../components/Shell'
import { Alerta, Pill, Vazio } from '../components/ui'

const SELECT = `
  id, toa_atividade_id, wo_numero, cliente_nome, logradouro, bairro,
  data_agendada, janela_inicio, janela_fim, situacao, bloqueado_em,
  origem, criado_em, inicio, fim, tempo_deslocamento,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome ),
  area:area_id ( codigo ),
  equipe:equipe_id ( codigo, nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade )
  )
`

const hojeISO = () => new Date().toISOString().slice(0, 10)

export default function Servicos() {
  const [params] = useSearchParams()
  const [data, setData] = useState(hojeISO())
  const [linhas, setLinhas] = useState<Visita[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Situacao | 'TODAS' | 'ABERTAS'>(
    params.get('filtro') === 'abertas' ? 'ABERTAS' : 'TODAS')
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)
  const [soProdutivas, setSoProdutivas] = useState(true)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.from('visita').select(SELECT)
      .eq('data_agendada', data)
      .order('janela_inicio', { ascending: true, nullsFirst: false })
      .then(({ data: d, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setLinhas((d ?? []) as unknown as Visita[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [data])

  const base = useMemo(() => soProdutivas
    ? linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
    : linhas, [linhas, soProdutivas])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return base.filter(v => {
      if (filtro === 'ABERTAS' && !EM_ABERTO.includes(v.situacao)) return false
      if (filtro !== 'TODAS' && filtro !== 'ABERTAS' && v.situacao !== filtro) return false
      if (!t) return true
      return [
        v.cliente_nome, v.logradouro, v.bairro, v.wo_numero, v.toa_atividade_id,
        v.equipe?.codigo, v.tecnico?.nome, v.tecnico?.matricula,
        ...v.ordem_servico.map(o => o.numero_os),
      ].some(x => x?.toLowerCase().includes(t))
    })
  }, [base, filtro, busca])

  const contagem = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {}
    for (const v of base) c[v.situacao] = (c[v.situacao] ?? 0) + 1
    return c
  }, [base])

  const abertas = base.filter(v => EM_ABERTO.includes(v.situacao)).length

  return (
    <Shell acoes={
      <input type="date" value={data} onChange={e => setData(e.target.value)}
        className="tabular rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1
                   text-xs outline-none focus:border-af-500" />
    }>
      <div className="space-y-3 p-4">
        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* filtros */}
        <section className="flex flex-wrap items-center gap-2">
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar cliente, endereço, WO, O.S., equipe, matrícula…"
            className="min-w-72 flex-1 rounded-md border border-graf-700 bg-graf-900 px-3 py-1.5
                       text-sm outline-none placeholder-graf-500 focus:border-af-500"
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
            <input type="checkbox" checked={soProdutivas}
              onChange={e => setSoProdutivas(e.target.checked)} className="accent-af-600" />
            Ocultar jornada
          </label>
        </section>

        <section className="flex flex-wrap gap-1">
          {(['TODAS', 'ABERTAS', ...SITUACOES] as const).map(s => {
            const n = s === 'TODAS' ? base.length
              : s === 'ABERTAS' ? abertas
              : contagem[s as Situacao] ?? 0
            if (n === 0 && s !== 'TODAS' && s !== 'ABERTAS') return null
            return (
              <button key={s} onClick={() => setFiltro(s)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  filtro === s ? 'bg-af-600 text-white'
                               : 'bg-graf-800 text-graf-300 hover:bg-graf-700'}`}>
                {s === 'TODAS' ? 'Todas' : s === 'ABERTAS' ? 'Em aberto'
                  : s.replace(/_/g, ' ').toLowerCase()}
                <span className="tabular ml-1.5 opacity-60">{n}</span>
              </button>
            )
          })}
        </section>

        {/* tabela */}
        <section className="card-controle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-graf-700 bg-graf-900 text-left">
                <tr className="text-[11px] uppercase tracking-wide text-graf-400">
                  <th className="px-3 py-2 font-medium">Janela</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Endereço</th>
                  <th className="px-3 py-2 font-medium">Equipe</th>
                  <th className="px-3 py-2 font-medium">Área</th>
                  <th className="px-3 py-2 text-center font-medium">O.S.</th>
                  <th className="px-3 py-2 font-medium">WO</th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-graf-400">
                    Carregando…</td></tr>
                )}

                {!carregando && visiveis.length === 0 && (
                  <tr><td colSpan={8}>
                    <Vazio
                      titulo="Nenhuma visita para este filtro"
                      descricao={linhas.length === 0
                        ? 'Não há visitas nesta data.'
                        : 'Ajuste a busca ou o filtro de situação.'}
                      acao={linhas.length === 0
                        ? <Link to="/controle/importar"
                            className="rounded-lg bg-af-600 px-4 py-2 text-sm font-medium text-white
                                       hover:bg-af-500">Importar planilha</Link>
                        : undefined}
                    />
                  </td></tr>
                )}

                {visiveis.map(v => {
                  const expandida = aberta === v.id
                  return (
                    <Fragment key={v.id}>
                      <tr onClick={() => setAberta(expandida ? null : v.id)}
                          className="cursor-pointer border-b border-graf-800 hover:bg-graf-850">
                        <td className="tabular whitespace-nowrap px-3 py-2 text-graf-300">
                          {v.janela_inicio?.slice(0, 5) ?? '—'}
                          {v.janela_fim && <span className="text-graf-500">–{v.janela_fim.slice(0, 5)}</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <Pill situacao={v.situacao} />
                            {v.bloqueado_em && (
                              <span title="Tocada pelo campo — o TOA não sobrescreve mais"
                                    className="text-[10px] text-af-400">●</span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className={v.tipo_atividade?.natureza === 'JORNADA'
                            ? 'italic text-graf-500' : ''}>
                            {v.tipo_atividade?.nome ?? '—'}
                          </span>
                        </td>
                        <td className="max-w-80 truncate px-3 py-2" title={v.logradouro ?? ''}>
                          {v.logradouro ?? <span className="text-graf-600">—</span>}
                          {v.bairro && <span className="ml-1.5 text-xs text-graf-500">{v.bairro}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-graf-300">
                          {v.equipe?.codigo ?? <span className="text-graf-600">sem equipe</span>}
                          {v.tecnico && <span className="ml-1.5 text-xs text-graf-500">{v.tecnico.matricula}</span>}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">
                          {v.area?.codigo ?? '—'}
                        </td>
                        <td className="tabular px-3 py-2 text-center">
                          {v.ordem_servico.length > 0
                            ? <span className="rounded bg-graf-800 px-1.5 py-0.5 text-xs">
                                {v.ordem_servico.length}</span>
                            : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-500">
                          {v.wo_numero?.split('|').pop() ?? '—'}
                        </td>
                      </tr>

                      {expandida && v.ordem_servico.length > 0 && (
                        <tr className="border-b border-graf-800 bg-graf-900">
                          <td colSpan={8} className="px-3 py-2.5">
                            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-graf-400">
                              {v.ordem_servico.length} ordem(ns) de serviço nesta visita
                            </div>
                            <div className="space-y-1">
                              {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
                                <div key={o.id}
                                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded
                                             border border-graf-800 bg-graf-850 px-2.5 py-1.5 text-xs">
                                  <span className="tabular text-graf-500">#{o.sequencia}</span>
                                  <span className="tabular font-medium">{o.numero_os}</span>
                                  <span className="text-graf-300">
                                    {o.tipo_os ? `${o.tipo_os.codigo} · ${o.tipo_os.descricao}` : '—'}
                                  </span>
                                  {o.codigo_baixa && (
                                    <span className={`ml-auto rounded px-1.5 py-0.5 font-medium ${
                                      o.codigo_baixa.natureza === 'SUCESSO'
                                        ? 'bg-emerald-900/40 text-emerald-300'
                                        : o.codigo_baixa.natureza === 'IMPRODUTIVA'
                                        ? 'bg-af-900/40 text-af-300'
                                        : 'bg-graf-800 text-graf-400'}`}>
                                      {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                                      {o.codigo_baixa.responsabilidade &&
                                        <span className="ml-1.5 opacity-70">
                                          ({o.codigo_baixa.responsabilidade.toLowerCase()})
                                        </span>}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="pb-6 text-center text-xs text-graf-600">
          {visiveis.length} de {base.length} visitas
          {soProdutivas && linhas.length !== base.length &&
            ` · ${linhas.length - base.length} apontamentos de jornada ocultos`}
        </p>
      </div>
    </Shell>
  )
}
