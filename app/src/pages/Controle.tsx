import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACOES, EM_ABERTO, type Situacao } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alerta, Marca, Metrica, Pill, Vazio } from '../components/ui'

interface OS {
  id: string
  sequencia: number
  numero_os: string
  status_operadora: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: {
    codigo: number; descricao: string
    natureza: string; responsabilidade: string | null
  } | null
}

interface VisitaLinha {
  id: string
  toa_atividade_id: string | null
  wo_numero: string | null
  cliente_nome: string | null
  logradouro: string | null
  bairro: string | null
  data_agendada: string
  janela_inicio: string | null
  janela_fim: string | null
  situacao: Situacao
  bloqueado_em: string | null
  tipo_atividade: { nome: string; natureza: string } | null
  area: { codigo: string } | null
  equipe: { codigo: string; nome: string } | null
  tecnico: { nome: string; matricula: string } | null
  ordem_servico: OS[]
}

const hojeISO = () => new Date().toISOString().slice(0, 10)

export default function Controle() {
  const { perfil, sair, ehGestor } = useAuth()
  const [data, setData] = useState(hojeISO())
  const [linhas, setLinhas] = useState<VisitaLinha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Situacao | 'TODAS' | 'ABERTAS'>('TODAS')
  const [busca, setBusca] = useState('')
  const [aberta, setAberta] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    supabase
      .from('visita')
      .select(`
        id, toa_atividade_id, wo_numero, cliente_nome, logradouro, bairro,
        data_agendada, janela_inicio, janela_fim, situacao, bloqueado_em,
        tipo_atividade:tipo_atividade_id ( nome, natureza ),
        area:area_id ( codigo ),
        equipe:equipe_id ( codigo, nome ),
        tecnico:tecnico_responsavel_id ( nome, matricula ),
        ordem_servico (
          id, sequencia, numero_os, status_operadora,
          tipo_os:tipo_os_id ( codigo, descricao ),
          codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade )
        )
      `)
      .eq('data_agendada', data)
      .order('janela_inicio', { ascending: true, nullsFirst: false })
      .then(({ data: d, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setLinhas((d ?? []) as unknown as VisitaLinha[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [data])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return linhas.filter(v => {
      if (filtro === 'ABERTAS' && !EM_ABERTO.includes(v.situacao)) return false
      if (filtro !== 'TODAS' && filtro !== 'ABERTAS' && v.situacao !== filtro) return false
      if (!t) return true
      return [
        v.cliente_nome, v.logradouro, v.bairro, v.wo_numero,
        v.equipe?.codigo, v.tecnico?.nome, v.tecnico?.matricula,
        ...v.ordem_servico.map(o => o.numero_os),
      ].some(x => x?.toLowerCase().includes(t))
    })
  }, [linhas, filtro, busca])

  const m = useMemo(() => {
    const produtivas = linhas.filter(v => v.tipo_atividade?.natureza === 'PRODUTIVA')
    const os = linhas.flatMap(v => v.ordem_servico)
    const improd = os.filter(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')
    const porCulpa: Record<string, number> = {}
    for (const o of improd) {
      const k = o.codigo_baixa?.responsabilidade ?? 'SEM CLASSIFICAÇÃO'
      porCulpa[k] = (porCulpa[k] ?? 0) + 1
    }
    return {
      visitas: linhas.length,
      produtivas: produtivas.length,
      jornada: linhas.length - produtivas.length,
      abertas: linhas.filter(v => EM_ABERTO.includes(v.situacao)).length,
      concluidas: linhas.filter(v => v.situacao === 'CONCLUIDA').length,
      os: os.length,
      sucesso: os.filter(o => o.codigo_baixa?.natureza === 'SUCESSO').length,
      improdutivas: improd.length,
      porCulpa,
      travadas: linhas.filter(v => v.bloqueado_em).length,
    }
  }, [linhas])

  const contagem = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {}
    for (const v of linhas) c[v.situacao] = (c[v.situacao] ?? 0) + 1
    return c
  }, [linhas])

  return (
    <div className="sup-controle min-h-screen">
      {/* ---------- barra superior ---------- */}
      <header className="sticky top-0 z-20 border-b border-graf-800 bg-graf-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-2.5">
          <Marca compacto />
          <nav className="flex items-center gap-1 text-sm">
            <span className="rounded-md bg-graf-800 px-2.5 py-1 font-medium">Controle</span>
            {ehGestor && (
              <Link to="/controle/importar"
                    className="rounded-md px-2.5 py-1 text-graf-300 hover:bg-graf-800">
                Importar planilha
              </Link>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <label className="sr-only" htmlFor="data">Data</label>
            <input
              id="data" type="date" value={data}
              onChange={e => setData(e.target.value)}
              className="tabular rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5
                         text-sm outline-none focus:border-af-500"
            />
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium">{perfil?.nome ?? '—'}</div>
              <button onClick={sair} className="text-[11px] text-graf-400 hover:text-af-400">
                Sair
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4">
        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* ---------- métricas ---------- */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Metrica valor={m.visitas} rotulo="Visitas no dia" />
          <Metrica valor={m.produtivas} rotulo="Produtivas" />
          <Metrica valor={m.jornada} rotulo="Jornada" cor="var(--st-entrada)" />
          <Metrica valor={m.abertas} rotulo="Em aberto"
                   cor="var(--st-execucao)" alerta={m.abertas > 0} />
          <Metrica valor={m.concluidas} rotulo="Concluídas" cor="var(--st-concluida)" />
          <Metrica valor={m.os} rotulo="O.S. no total" />
        </section>

        {/* ---------- improdutivas por responsabilidade ----------
             Isto é o que o ngestor não responde: da improdutiva do dia,
             quanto é culpa nossa e quanto é da rede, do cliente ou da CLARO. */}
        {m.improdutivas > 0 && (
          <section className="card-controle p-3.5">
            <div className="mb-2.5 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">Improdutivas por responsabilidade</h2>
              <span className="text-xs text-graf-400">
                {m.improdutivas} de {m.os} O.S.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(m.porCulpa)
                .sort((a, b) => b[1] - a[1])
                .map(([culpa, qtd]) => {
                  const nossa = culpa === 'TECNICO'
                  return (
                    <div key={culpa}
                      className={`rounded-md border px-3 py-2 ${
                        nossa ? 'border-af-600/60 bg-af-900/25' : 'border-graf-700 bg-graf-800'}`}>
                      <div className="tabular text-lg font-semibold leading-none">{qtd}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">
                        {culpa === 'TECNICO' ? 'nossa' : culpa.toLowerCase()}
                      </div>
                    </div>
                  )
                })}
            </div>
          </section>
        )}

        {/* ---------- filtros ---------- */}
        <section className="flex flex-wrap items-center gap-2">
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar cliente, endereço, WO, O.S., equipe…"
            className="min-w-64 flex-1 rounded-md border border-graf-700 bg-graf-900 px-3 py-1.5
                       text-sm outline-none placeholder-graf-500 focus:border-af-500"
          />
          <div className="flex flex-wrap gap-1">
            {(['TODAS', 'ABERTAS', ...SITUACOES] as const).map(s => {
              const n = s === 'TODAS' ? linhas.length
                : s === 'ABERTAS' ? m.abertas
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
          </div>
        </section>

        {/* ---------- tabela densa ---------- */}
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
                    Carregando…
                  </td></tr>
                )}

                {!carregando && visiveis.length === 0 && (
                  <tr><td colSpan={8}>
                    <Vazio
                      titulo="Nenhuma visita para este filtro"
                      descricao={linhas.length === 0
                        ? 'Não há visitas nesta data. Importe a planilha do TOA para começar.'
                        : 'Ajuste a busca ou o filtro de situação.'}
                      acao={linhas.length === 0 && ehGestor
                        ? <Link to="/controle/importar"
                                className="rounded-lg bg-af-600 px-4 py-2 text-sm font-medium text-white hover:bg-af-500">
                            Importar planilha
                          </Link>
                        : undefined}
                    />
                  </td></tr>
                )}

                {visiveis.map(v => {
                  const expandida = aberta === v.id
                  return (
                    <>
                      <tr key={v.id}
                          onClick={() => setAberta(expandida ? null : v.id)}
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
                            ? 'text-graf-500 italic' : ''}>
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
                                {v.ordem_servico.length}
                              </span>
                            : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-500">
                          {v.wo_numero?.split('|').pop() ?? '—'}
                        </td>
                      </tr>

                      {/* as O.S. da visita — o coração do D-001 */}
                      {expandida && v.ordem_servico.length > 0 && (
                        <tr key={v.id + '-os'} className="border-b border-graf-800 bg-graf-900">
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
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <p className="pb-6 text-center text-xs text-graf-600">
          {visiveis.length} de {linhas.length} visitas
          {m.travadas > 0 && ` · ${m.travadas} já tocadas pelo campo`}
        </p>
      </main>
    </div>
  )
}
