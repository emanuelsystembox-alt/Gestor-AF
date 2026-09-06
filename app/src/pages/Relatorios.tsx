import { useEffect, useMemo, useState } from 'react'
import { supabase, SITUACOES, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta } from '../components/ui'

/**
 * Relatórios — por contrato e por O.S.
 *
 * A diferença entre os dois não é cosmética (D-001):
 *
 * - **Por contrato**: uma linha por VISITA. É a leitura de deslocamento,
 *   janela e produtividade — o técnico foi uma vez àquele endereço.
 * - **Por O.S.**: uma linha por ORDEM DE SERVIÇO, com o contrato
 *   repetido. É a leitura de baixa e de faturamento.
 *
 * Uma visita com 3 O.S. vira 1 linha no primeiro e 3 no segundo. Contar
 * deslocamento no relatório por O.S. conta em triplo.
 */

const SELECT = `
  id, toa_atividade_id, wo_numero, contrato, cliente_nome,
  logradouro, complemento, bairro, cidade, uf, node,
  data_agendada, janela_inicio, janela_fim, situacao, origem,
  inicio, fim, tempo_deslocamento,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome ),
  area:area_id ( codigo, apelido ),
  equipe:equipe_id ( codigo, nome, supervisor_nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora, ponto, produto,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade ),
    baixa_afline:codigo_baixa_afline_id ( codigo, descricao, natureza, responsabilidade ),
    sub_falha:sub_falha_id ( nome, categoria )
  ),
  visita_marcador ( indicador_id )
`

interface OS {
  id: string; sequencia: number; numero_os: string | null
  status_operadora: string | null; ponto: string | null; produto: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: { codigo: number; descricao: string
                  natureza: string | null; responsabilidade: string | null } | null
  baixa_afline: { codigo: number; descricao: string
                  natureza: string | null; responsabilidade: string | null } | null
  sub_falha: { nome: string; categoria: string | null } | null
}
interface Linha {
  id: string; toa_atividade_id: string | null; wo_numero: string | null
  contrato: string | null; cliente_nome: string | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cidade: string | null; uf: string | null; node: string | null
  data_agendada: string; janela_inicio: string | null; janela_fim: string | null
  situacao: Situacao; origem: string | null
  inicio: string | null; fim: string | null; tempo_deslocamento: string | null
  tipo_atividade: { nome: string; natureza: string | null } | null
  tipo_servico: { nome: string } | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null } | null
  tecnico: { nome: string; matricula: string } | null
  ordem_servico: OS[]
  visita_marcador: { indicador_id: string }[]
}
interface Indicador { id: string; nome: string }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')
const hora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''

export default function Relatorios() {
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [tipo, setTipo] = useState<'contrato' | 'os'>('contrato')
  const [linhas, setLinhas] = useState<Linha[]>([])
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
    supabase.from('indicador_qualidade').select('id, nome').order('ordem')
      .then(({ data }) => setIndicadores((data ?? []) as Indicador[]))
  }, [])

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.from('visita').select(SELECT)
      .is('excluido_em', null)
      .gte('data_agendada', de).lte('data_agendada', ate)
      .order('data_agendada').order('janela_inicio', { nullsFirst: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setLinhas((data ?? []) as unknown as Linha[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [de, ate])

  const nomeIndicador = useMemo(
    () => new Map(indicadores.map(i => [i.id, i.nome])), [indicadores])

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

  function montar(): string[][] {
    const marcadores = (l: Linha) => l.visita_marcador
      .map(m => nomeIndicador.get(m.indicador_id)).filter(Boolean).join(' | ')
    const endereco = (l: Linha) =>
      [l.logradouro, l.complemento, l.bairro, l.cidade, l.uf].filter(Boolean).join(', ')

    if (tipo === 'contrato') {
      const cab = ['Data', 'Janela início', 'Janela fim', 'Situação', 'Grupo de serviço',
        'Tipo de atividade', 'Contrato', 'WO', 'Atividade TOA', 'Cliente', 'Endereço',
        'Node', 'Área', 'Equipe', 'Supervisor', 'Técnico', 'Matrícula', 'Origem',
        'Início', 'Fim', 'Qtd O.S.', 'Baixas TOA', 'Baixas AFLINE', 'Sub-falhas', 'Marcadores']
      return [cab, ...filtradas.map(l => [
        new Date(l.data_agendada + 'T12:00').toLocaleDateString('pt-BR'),
        hhmm(l.janela_inicio), hhmm(l.janela_fim),
        SITUACAO_INFO[l.situacao]?.label ?? l.situacao,
        l.tipo_servico?.nome ?? '', l.tipo_atividade?.nome ?? '',
        l.contrato ?? '', l.wo_numero ?? '', l.toa_atividade_id ?? '',
        l.cliente_nome ?? '', endereco(l), l.node ?? '',
        l.area?.apelido ?? '', l.equipe?.codigo ?? '', l.equipe?.supervisor_nome ?? '',
        l.tecnico?.nome ?? '', l.tecnico?.matricula ?? '', l.origem ?? '',
        hora(l.inicio), hora(l.fim),
        String(l.ordem_servico.length),
        l.ordem_servico.map(o => o.codigo_baixa
          ? `${o.codigo_baixa.codigo} ${o.codigo_baixa.descricao}` : '').filter(Boolean).join(' | '),
        l.ordem_servico.map(o => o.baixa_afline
          ? `${o.baixa_afline.codigo} ${o.baixa_afline.descricao}` : '').filter(Boolean).join(' | '),
        l.ordem_servico.map(o => o.sub_falha?.nome ?? '').filter(Boolean).join(' | '),
        marcadores(l),
      ])]
    }

    const cab = ['Data', 'Janela início', 'Janela fim', 'Situação da visita', 'Contrato', 'WO',
      'Seq', 'Número O.S.', 'Tipo O.S. cód', 'Tipo O.S.', 'Status operadora', 'Ponto', 'Produto',
      'Cód. baixa TOA', 'Baixa TOA', 'Natureza TOA', 'Responsabilidade TOA',
      'Cód. baixa AFLINE', 'Baixa AFLINE', 'Sub-falha', 'Categoria sub-falha',
      'Primeira do endereço',
      'Grupo de serviço', 'Endereço', 'Área', 'Equipe', 'Supervisor', 'Técnico', 'Marcadores']
    const saida: string[][] = [cab]
    for (const l of filtradas) {
      const ordenadas = [...l.ordem_servico].sort((a, b) => a.sequencia - b.sequencia)
      for (const o of ordenadas) {
        saida.push([
          new Date(l.data_agendada + 'T12:00').toLocaleDateString('pt-BR'),
          hhmm(l.janela_inicio), hhmm(l.janela_fim),
          SITUACAO_INFO[l.situacao]?.label ?? l.situacao,
          l.contrato ?? '', l.wo_numero ?? '',
          String(o.sequencia), o.numero_os ?? '',
          o.tipo_os ? String(o.tipo_os.codigo) : '', o.tipo_os?.descricao ?? '',
          o.status_operadora ?? '', o.ponto ?? '', o.produto ?? '',
          o.codigo_baixa ? String(o.codigo_baixa.codigo) : '',
          o.codigo_baixa?.descricao ?? '', o.codigo_baixa?.natureza ?? '',
          o.codigo_baixa?.responsabilidade ?? '',
          o.baixa_afline ? String(o.baixa_afline.codigo) : '',
          o.baixa_afline?.descricao ?? '',
          o.sub_falha?.nome ?? '', o.sub_falha?.categoria ?? '',
          // A LPU distingue DESLOCAMENTO de AGREGADA: a primeira O.S. do
          // endereço paga cheio. Sai marcada para não se perder na conta.
          o.sequencia === ordenadas[0].sequencia ? 'SIM' : 'NAO',
          l.tipo_servico?.nome ?? '', endereco(l),
          l.area?.apelido ?? '', l.equipe?.codigo ?? '',
          l.equipe?.supervisor_nome ?? '', l.tecnico?.nome ?? '',
          marcadores(l),
        ])
      }
    }
    return saida
  }

  function baixar() {
    const csv = montar()
      .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `afline-relatorio-${tipo}-${de}${de !== ate ? '_a_' + ate : ''}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  const previa = useMemo(() => montar().slice(0, 8), [filtradas, tipo, nomeIndicador])
  const totalLinhas = tipo === 'contrato' ? filtradas.length : totalOS

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
            deslocamento e produtividade. <strong>Por O.S.</strong> dá uma linha por
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

            <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={semJornada}
                onChange={e => setSemJornada(e.target.checked)} className="accent-af-600" />
              Ocultar jornada
            </label>

            <button onClick={baixar} disabled={carregando || totalLinhas === 0}
              className="ml-auto rounded-lg bg-af-600 px-5 py-2 text-sm font-semibold text-white
                         hover:bg-af-500 disabled:opacity-50">
              Gerar download · {totalLinhas} linhas
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
            {' '}Carregadas <strong className="tabular">{filtradas.length}</strong> visitas
            {' '}e <strong className="tabular">{totalOS}</strong> O.S. no período.
          </p>
        </section>

        <section className="card-controle overflow-hidden">
          <div className="border-b border-graf-800 px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              Prévia — {tipo === 'contrato' ? 'por contrato' : 'por O.S.'}
            </h2>
            <p className="mt-0.5 text-xs text-graf-400">
              As 7 primeiras linhas do arquivo, exatamente como vão sair.
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
                    {previa[0].map(c => (
                      <th key={c} className="whitespace-nowrap px-2.5 py-2 font-medium">{c}</th>
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
