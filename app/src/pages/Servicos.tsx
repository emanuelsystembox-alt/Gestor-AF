import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, SITUACOES, EM_ABERTO, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import type { Visita } from '../lib/metricas'
import { Shell } from '../components/Shell'
import { Alerta, Pill, Vazio } from '../components/ui'

const SELECT = `
  id, toa_atividade_id, wo_numero, contrato, cliente_nome, logradouro, bairro,
  data_agendada, janela_inicio, janela_fim, situacao, bloqueado_em,
  origem, criado_em, inicio, fim, tempo_deslocamento, node,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome, prioridade ),
  area:area_id ( codigo, apelido ),
  equipe:equipe_id ( codigo, nome, supervisor_nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade )
  )
`

type V = Visita & {
  contrato: string | null
  node: string | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null } | null
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const hoje = () => iso(new Date())

export default function Servicos() {
  const [params] = useSearchParams()
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())
  const [linhas, setLinhas] = useState<V[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)

  // filtros
  const [situacao, setSituacao] = useState<Situacao | 'TODAS' | 'ABERTAS'>(
    params.get('filtro') === 'abertas' ? 'ABERTAS' : 'TODAS')
  const [busca, setBusca] = useState('')
  const [area, setArea] = useState('TODAS')
  const [supervisor, setSupervisor] = useState('TODOS')
  const [equipe, setEquipe] = useState('TODAS')
  const [grupo, setGrupo] = useState('TODOS')
  const [origem, setOrigem] = useState('TODAS')
  const [resultado, setResultado] = useState<'TODOS' | 'SUCESSO' | 'IMPRODUTIVA' | 'SEM_BAIXA'>('TODOS')
  const [culpa, setCulpa] = useState('TODAS')
  const [soProdutivas, setSoProdutivas] = useState(true)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.from('visita').select(SELECT)
      .gte('data_agendada', de).lte('data_agendada', ate)
      .order('data_agendada', { ascending: false })
      .order('janela_inicio', { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setLinhas((data ?? []) as unknown as V[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [de, ate])

  const base = useMemo(() => soProdutivas
    ? linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
    : linhas, [linhas, soProdutivas])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return base.filter(v => {
      if (situacao === 'ABERTAS' && !EM_ABERTO.includes(v.situacao)) return false
      if (situacao !== 'TODAS' && situacao !== 'ABERTAS' && v.situacao !== situacao) return false
      if (area !== 'TODAS' && v.area?.apelido !== area && v.area?.codigo !== area) return false
      if (supervisor !== 'TODOS' && v.equipe?.supervisor_nome !== supervisor) return false
      if (equipe !== 'TODAS' && v.equipe?.codigo !== equipe) return false
      if (grupo !== 'TODOS' && v.tipo_servico?.nome !== grupo) return false
      if (origem !== 'TODAS' && v.origem !== origem) return false

      if (resultado !== 'TODOS') {
        const comBaixa = v.ordem_servico.filter(o => o.codigo_baixa)
        if (resultado === 'SEM_BAIXA' && comBaixa.length > 0) return false
        if (resultado === 'SUCESSO'
          && !v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'SUCESSO')) return false
        if (resultado === 'IMPRODUTIVA'
          && !v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')) return false
      }
      if (culpa !== 'TODAS'
        && !v.ordem_servico.some(o => o.codigo_baixa?.responsabilidade === culpa)) return false

      if (!t) return true
      return [
        v.cliente_nome, v.logradouro, v.bairro, v.wo_numero, v.contrato,
        v.toa_atividade_id, v.node, v.equipe?.codigo, v.tecnico?.nome, v.tecnico?.matricula,
        ...v.ordem_servico.map(o => o.numero_os),
        ...v.ordem_servico.map(o => o.codigo_baixa
          ? `${o.codigo_baixa.codigo} ${o.codigo_baixa.descricao}` : ''),
      ].some(x => x?.toLowerCase().includes(t))
    })
  }, [base, situacao, busca, area, supervisor, equipe, grupo, origem, resultado, culpa])

  // opções derivadas do que está carregado
  const op = useMemo(() => ({
    areas: [...new Set(base.map(v => v.area?.apelido).filter(Boolean) as string[])].sort(),
    supers: [...new Set(base.map(v => v.equipe?.supervisor_nome).filter(Boolean) as string[])].sort(),
    equipes: [...new Set(base.map(v => v.equipe?.codigo).filter(Boolean) as string[])].sort(),
    grupos: [...new Set(base.map(v => v.tipo_servico?.nome).filter(Boolean) as string[])].sort(),
  }), [base])

  const contagem = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {}
    for (const v of base) c[v.situacao] = (c[v.situacao] ?? 0) + 1
    return c
  }, [base])

  const abertas = base.filter(v => EM_ABERTO.includes(v.situacao)).length
  const filtrando = [situacao !== 'TODAS', area !== 'TODAS', supervisor !== 'TODOS',
    equipe !== 'TODAS', grupo !== 'TODOS', origem !== 'TODAS', resultado !== 'TODOS',
    culpa !== 'TODAS', busca.trim() !== ''].filter(Boolean).length

  function limpar() {
    setSituacao('TODAS'); setArea('TODAS'); setSupervisor('TODOS'); setEquipe('TODAS')
    setGrupo('TODOS'); setOrigem('TODAS'); setResultado('TODOS'); setCulpa('TODAS'); setBusca('')
  }

  function exportar() {
    const cab = ['Data', 'Janela', 'Situação', 'Grupo', 'Tipo atividade', 'Equipe',
      'Supervisor', 'Área', 'Contrato', 'Endereço', 'Bairro', 'O.S.', 'Baixas']
    const linhasCsv = visiveis.map(v => [
      new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR'),
      `${v.janela_inicio?.slice(0, 5) ?? ''}${v.janela_fim ? '-' + v.janela_fim.slice(0, 5) : ''}`,
      SITUACAO_INFO[v.situacao]?.label ?? v.situacao,
      v.tipo_servico?.nome ?? '', v.tipo_atividade?.nome ?? '',
      v.equipe?.codigo ?? '', v.equipe?.supervisor_nome ?? '', v.area?.apelido ?? '',
      v.contrato ?? '', v.logradouro ?? '', v.bairro ?? '',
      v.ordem_servico.map(o => o.numero_os).join(' '),
      v.ordem_servico.map(o => o.codigo_baixa
        ? `${o.codigo_baixa.codigo}-${o.codigo_baixa.descricao}` : '').filter(Boolean).join(' | '),
    ])
    const csv = [cab, ...linhasCsv]
      .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `afline-servicos-${de}${de !== ate ? '-a-' + ate : ''}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs outline-none focus:border-af-500'

  return (
    <Shell acoes={
      <div className="flex items-center gap-1.5">
        <input type="date" value={de} onChange={e => setDe(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        <span className="text-xs text-graf-500">a</span>
        <input type="date" value={ate} onChange={e => setAte(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
      </div>
    }>
      <div className="space-y-3 p-4">
        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* ====== filtros ====== */}
        <section className="card-controle space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Cliente, endereço, WO, contrato, O.S., node, matrícula, código de baixa…"
              className="min-w-72 flex-1 rounded-md border border-graf-700 bg-graf-900 px-3 py-1.5
                         text-sm outline-none placeholder-graf-500 focus:border-af-500" />
            <button onClick={exportar} disabled={visiveis.length === 0}
              className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              Exportar {visiveis.length} linhas
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={grupo} onChange={e => setGrupo(e.target.value)} className={sel}>
              <option value="TODOS">Todo grupo de serviço</option>
              {op.grupos.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={area} onChange={e => setArea(e.target.value)} className={sel}>
              <option value="TODAS">Toda área</option>
              {op.areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={supervisor} onChange={e => setSupervisor(e.target.value)}
              className={`${sel} max-w-52`}>
              <option value="TODOS">Todo supervisor</option>
              {op.supers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={equipe} onChange={e => setEquipe(e.target.value)} className={sel}>
              <option value="TODAS">Toda equipe</option>
              {op.equipes.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={resultado} onChange={e => setResultado(e.target.value as typeof resultado)}
              className={sel}>
              <option value="TODOS">Qualquer resultado</option>
              <option value="SUCESSO">Com O.S. executada</option>
              <option value="IMPRODUTIVA">Com improdutiva</option>
              <option value="SEM_BAIXA">Sem baixa ainda</option>
            </select>
            <select value={culpa} onChange={e => setCulpa(e.target.value)} className={sel}>
              <option value="TODAS">Qualquer responsável</option>
              <option value="TECNICO">Improdutiva nossa</option>
              <option value="CLIENTE">Improdutiva do cliente</option>
              <option value="REDE">Improdutiva de rede</option>
              <option value="OPERADORA">Improdutiva da operadora</option>
              <option value="TERCEIRO">Improdutiva de terceiro</option>
            </select>
            <select value={origem} onChange={e => setOrigem(e.target.value)} className={sel}>
              <option value="TODAS">Toda origem</option>
              <option value="TOA">TOA</option>
              <option value="MANUAL">Manual</option>
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={soProdutivas}
                onChange={e => setSoProdutivas(e.target.checked)} className="accent-af-600" />
              Ocultar jornada
            </label>
            {filtrando > 0 && (
              <button onClick={limpar}
                className="text-xs text-af-400 underline underline-offset-2">
                limpar {filtrando} filtro(s)
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1 border-t border-graf-800 pt-2">
            {(['TODAS', 'ABERTAS', ...SITUACOES] as const).map(s => {
              const n = s === 'TODAS' ? base.length
                : s === 'ABERTAS' ? abertas : contagem[s as Situacao] ?? 0
              if (n === 0 && s !== 'TODAS' && s !== 'ABERTAS') return null
              return (
                <button key={s} onClick={() => setSituacao(s)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    situacao === s ? 'bg-af-600 text-white'
                                   : 'bg-graf-800 text-graf-300 hover:bg-graf-700'}`}>
                  {s === 'TODAS' ? 'Todas' : s === 'ABERTAS' ? 'Em aberto'
                    : SITUACAO_INFO[s as Situacao]?.label ?? s}
                  <span className="tabular ml-1.5 opacity-60">{n}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ====== tabela ====== */}
        <section className="card-controle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-graf-700 bg-graf-900 text-left
                                text-[11px] uppercase tracking-wide text-graf-400">
                <tr>
                  {de !== ate && <th className="px-3 py-2 font-medium">Data</th>}
                  <th className="px-3 py-2 font-medium">Janela</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Grupo</th>
                  <th className="px-3 py-2 font-medium">Endereço</th>
                  <th className="px-3 py-2 font-medium">Equipe</th>
                  <th className="px-3 py-2 font-medium">Área</th>
                  <th className="px-3 py-2 text-center font-medium">O.S.</th>
                  <th className="px-3 py-2 font-medium">Contrato</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {carregando && (
                  <tr><td colSpan={10} className="px-3 py-10 text-center text-graf-400">
                    Carregando…</td></tr>
                )}

                {!carregando && visiveis.length === 0 && (
                  <tr><td colSpan={10}>
                    <Vazio titulo="Nenhuma visita para este filtro"
                      descricao={linhas.length === 0
                        ? 'Não há visitas neste período.'
                        : `${base.length} carregadas, nenhuma passa nos ${filtrando} filtro(s).`}
                      acao={linhas.length === 0
                        ? <Link to="/controle/importar"
                            className="rounded-lg bg-af-600 px-4 py-2 text-sm font-medium text-white
                                       hover:bg-af-500">Importar planilha</Link>
                        : <button onClick={limpar}
                            className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                                       text-graf-300 hover:border-af-600">Limpar filtros</button>} />
                  </td></tr>
                )}

                {visiveis.map(v => {
                  const exp = aberta === v.id
                  const improd = v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')
                  return (
                    <Fragment key={v.id}>
                      <tr onClick={() => setAberta(exp ? null : v.id)}
                          className={`cursor-pointer border-b border-graf-800 hover:bg-graf-850
                                      ${exp ? 'bg-graf-850' : ''}`}>
                        {de !== ate && (
                          <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">
                            {new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR')}
                          </td>
                        )}
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
                            {improd && (
                              <span title="Tem O.S. improdutiva"
                                    className="text-[10px] text-amber-400">▲</span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {v.tipo_servico?.nome ?? <span className="text-graf-600">—</span>}
                          <div className={`text-[10px] ${v.tipo_atividade?.natureza === 'JORNADA'
                            ? 'italic text-graf-600' : 'text-graf-500'}`}>
                            {v.tipo_atividade?.nome}
                          </div>
                        </td>
                        <td className="max-w-72 truncate px-3 py-2" title={v.logradouro ?? ''}>
                          {v.logradouro ?? <span className="text-graf-600">—</span>}
                          {v.bairro && <span className="ml-1.5 text-xs text-graf-500">{v.bairro}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-graf-300">
                          {v.equipe?.codigo ?? <span className="text-af-400/70">sem equipe</span>}
                          {v.tecnico && (
                            <span className="ml-1.5 text-xs text-graf-500">{v.tecnico.matricula}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-400">{v.area?.apelido ?? '—'}</td>
                        <td className="tabular px-3 py-2 text-center">
                          {v.ordem_servico.length > 0
                            ? <span className="rounded bg-graf-800 px-1.5 py-0.5 text-xs">
                                {v.ordem_servico.length}</span>
                            : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-500">
                          {v.contrato ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link to={`/controle/visita/${v.id}`} onClick={e => e.stopPropagation()}
                            className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                       text-graf-400 hover:border-af-600 hover:text-af-400">
                            abrir
                          </Link>
                        </td>
                      </tr>

                      {exp && (
                        <tr className="border-b border-graf-800 bg-graf-900">
                          <td colSpan={10} className="px-3 py-3">
                            <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-graf-400">
                              {v.cliente_nome && <span>Cliente: <span className="text-graf-200">{v.cliente_nome}</span></span>}
                              {v.node && <span>Node: <span className="text-graf-200">{v.node}</span></span>}
                              {v.toa_atividade_id && <span>Atividade TOA: <span className="tabular text-graf-200">{v.toa_atividade_id}</span></span>}
                              {v.wo_numero && <span>WO: <span className="tabular text-graf-200">{v.wo_numero}</span></span>}
                              {v.equipe?.supervisor_nome && <span>Supervisor: <span className="text-graf-200">{v.equipe.supervisor_nome}</span></span>}
                            </div>
                            {v.ordem_servico.length === 0 ? (
                              <p className="text-xs text-graf-500">
                                Nenhuma O.S. — apontamento de jornada.
                              </p>
                            ) : (
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
                                    {o.codigo_baixa ? (
                                      <span className={`ml-auto rounded px-1.5 py-0.5 font-medium ${
                                        o.codigo_baixa.natureza === 'SUCESSO'
                                          ? 'bg-emerald-900/40 text-emerald-300'
                                          : o.codigo_baixa.natureza === 'IMPRODUTIVA'
                                          ? 'bg-af-900/40 text-af-300'
                                          : 'bg-graf-800 text-graf-400'}`}>
                                        {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                                        {o.codigo_baixa.responsabilidade && (
                                          <span className="ml-1.5 opacity-70">
                                            ({o.codigo_baixa.responsabilidade.toLowerCase()})
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      <span className="ml-auto text-graf-600">sem baixa</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
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
