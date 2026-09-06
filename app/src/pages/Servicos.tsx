import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, SITUACOES, EM_ABERTO, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import type { Visita } from '../lib/metricas'
import { Shell } from '../components/Shell'
import { Alerta, Pill, Vazio } from '../components/ui'

const SELECT = `
  id, toa_atividade_id, wo_numero, contrato, cliente_nome,
  logradouro, complemento, bairro,
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
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade ),
    baixa_afline:codigo_baixa_afline_id ( codigo, descricao, natureza, responsabilidade ),
    sub_falha:sub_falha_id ( nome, categoria ),
    baixa_em
  ),
  visita_marcador ( id, indicador_id, cumprido )
`

interface Indicador { id: string; nome: string; meta: number; peso: number; ordem: number }
interface PontoVisita {
  visita_id: string
  pontos_claro: number | null
  pontos_equipe: number | null
  edificacao: string
  edificacao_de: string
  achou: boolean
}
interface Marcador { id: string; indicador_id: string; cumprido: boolean | null }

/** Baixa é dupla (D-042): a da operadora vem do TOA, a da AFLINE é nossa. */
type OSDupla = Visita['ordem_servico'][number] & {
  baixa_afline: { codigo: number; descricao: string
                  natureza: string | null; responsabilidade: string | null } | null
  sub_falha: { nome: string; categoria: string | null } | null
  baixa_em: string | null
}

type V = Omit<Visita, 'ordem_servico'> & {
  contrato: string | null
  node: string | null
  complemento: string | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null } | null
  ordem_servico: OSDupla[]
  visita_marcador: Marcador[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const hoje = () => iso(new Date())
const hora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

/** Cor da etiqueta de baixa: verde executou, vermelho improdutiva. */
function corBaixa(natureza: string | null | undefined): string {
  if (natureza === 'SUCESSO') return 'bg-emerald-900/40 text-emerald-300'
  if (natureza === 'IMPRODUTIVA') return 'bg-af-900/40 text-af-300'
  return 'bg-graf-800 text-graf-400'
}

export default function Servicos() {
  const [params] = useSearchParams()
  // Vazias até sabermos o último dia COM visita. Abrir sempre em "hoje"
  // mostrava tela vazia toda vez que a importação mais recente era de
  // ontem — e a tela não estava errada, só olhando o dia errado.
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
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
  // Quanto a linha mostra. "Detalhada" traz a O.S. e o código de baixa
  // para a própria linha — sem isso o COP precisava abrir uma por uma
  // só para saber por que a visita não fechou.
  const [densidade, setDensidade] = useState<'detalhada' | 'compacta'>('detalhada')
  const detalhada = densidade === 'detalhada'

  // Marcadores (indicadores de qualidade) — o analista aponta no contrato
  // qual foi cumprido. Catálogo vem de `indicador_qualidade` (025).
  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  const [menu, setMenu] = useState<string | null>(null)
  // Onde desenhar o menu: o sistema atual abre onde o mouse esta, nao
  // encostado na borda direita da tabela.
  const [menuXY, setMenuXY] = useState<{ x: number; y: number } | null>(null)
  const [painelMarcador, setPainelMarcador] = useState<string | null>(null)
  const [salvandoMarcador, setSalvandoMarcador] = useState(false)

  useEffect(() => {
    supabase.from('indicador_qualidade')
      .select('id, nome, meta, peso, ordem').eq('ativo', true).order('ordem')
      .then(({ data }) => setIndicadores((data ?? []) as Indicador[]))
  }, [])

  const porIndicador = useMemo(
    () => new Map(indicadores.map(i => [i.id, i])), [indicadores])

  // ---- exclusão de contrato (D-043: arquiva, não apaga) ----
  const [painelExcluir, setPainelExcluir] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')

  async function excluir(v: V) {
    if (!motivo.trim()) return
    setSalvandoMarcador(true); setErro(null)
    const { error } = await supabase.rpc('excluir_visita',
      { p_visita: v.id, p_motivo: motivo.trim() })
    if (error) setErro(error.message)
    else {
      setLinhas(ls => ls.filter(x => x.id !== v.id))
      setPainelExcluir(null); setMotivo(''); setMenu(null)
    }
    setSalvandoMarcador(false)
  }

  // ---- pontuação do contrato (D-045) ----
  // Uma chamada por período, não uma por linha: `pontos_por_periodo`
  // resolve as ~90 visitas do dia de uma vez.
  const [pontos, setPontos] = useState<Map<string, PontoVisita>>(new Map())

  useEffect(() => {
    if (!de || !ate) return
    supabase.rpc('pontos_por_periodo', { p_de: de, p_ate: ate }).then(({ data }) => {
      const m = new Map<string, PontoVisita>()
      for (const p of (data ?? []) as PontoVisita[]) m.set(p.visita_id, p)
      setPontos(m)
    })
  }, [de, ate])


  // ---- transferência rápida, sem sair da lista ----
  const [painelTransferir, setPainelTransferir] = useState<string | null>(null)
  const [equipes, setEquipes] = useState<{ id: string; codigo: string; nome: string }[]>([])
  const [equipeDestino, setEquipeDestino] = useState('')
  const [motivoTransf, setMotivoTransf] = useState('')

  useEffect(() => {
    supabase.from('equipe').select('id, codigo, nome').eq('ativo', true).order('codigo')
      .then(({ data }) => setEquipes((data ?? []) as { id: string; codigo: string; nome: string }[]))
  }, [])

  async function transferir(v: V) {
    if (!equipeDestino) return
    setSalvandoMarcador(true); setErro(null)
    const { error } = await supabase.rpc('transferir_visita', {
      p_visita: v.id, p_equipe: equipeDestino, p_motivo: motivoTransf || null,
    })
    if (error) setErro(error.message)
    else {
      setPainelTransferir(null); setEquipeDestino(''); setMotivoTransf('')
      const { data } = await supabase.from('visita').select(SELECT).eq('id', v.id).single()
      if (data) setLinhas(ls => ls.map(x => x.id === v.id ? (data as unknown as V) : x))
    }
    setSalvandoMarcador(false)
  }

  // ---- baixa da AFLINE, com sub-falha do código escolhido ----
  const [painelBaixa, setPainelBaixa] = useState<string | null>(null)
  const [codigos, setCodigos] = useState<{ codigo: number; descricao: string }[]>([])
  const [osAlvo, setOsAlvo] = useState<string>('')
  const [codigoSel, setCodigoSel] = useState<string>('')
  const [subFalhas, setSubFalhas] = useState<{ id: string; nome: string }[]>([])
  const [subSel, setSubSel] = useState<string>('')
  const [obsBaixa, setObsBaixa] = useState('')

  // Os dois conjuntos de sub-falha convivem no banco; só um vale. Sem
  // filtrar pelo vigente, a lista vem em dobro (CASO 1 + NÍVEL HARD).
  const [conjunto, setConjunto] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('codigo_baixa').select('codigo, descricao').order('codigo')
      .then(({ data }) => setCodigos((data ?? []) as { codigo: number; descricao: string }[]))
    supabase.from('empresa').select('conjunto_sub_falha').maybeSingle()
      .then(({ data }) =>
        setConjunto((data as { conjunto_sub_falha: string | null } | null)?.conjunto_sub_falha ?? null))
  }, [])

  // A sub-falha depende do código: trocou o código, a lista muda.
  useEffect(() => {
    setSubSel('')
    if (!codigoSel) { setSubFalhas([]); return }
    let q = supabase.from('sub_falha').select('id, nome').eq('codigo', Number(codigoSel))
    if (conjunto) q = q.eq('conjunto', conjunto)
    q.order('ordem').then(({ data }) =>
      setSubFalhas((data ?? []) as { id: string; nome: string }[]))
  }, [codigoSel, conjunto])

  async function gravarBaixa(v: V) {
    if (!osAlvo || !codigoSel) return
    setSalvandoMarcador(true); setErro(null)
    const { error } = await supabase.rpc('baixar_os', {
      p_os: osAlvo,
      p_codigo: Number(codigoSel),
      p_sub_falha: subSel || null,
      p_observacao: obsBaixa || null,
      p_situacao: null,
    })
    if (error) setErro(error.message)
    else {
      setPainelBaixa(null); setOsAlvo(''); setCodigoSel(''); setSubSel(''); setObsBaixa('')
      // recarrega só a visita tocada
      const { data } = await supabase.from('visita').select(SELECT).eq('id', v.id).single()
      if (data) setLinhas(ls => ls.map(x => x.id === v.id ? (data as unknown as V) : x))
    }
    setSalvandoMarcador(false)
  }

  /** Liga/desliga um marcador no contrato e atualiza a linha na hora. */
  async function alternarMarcador(v: V, ind: Indicador) {
    const atual = v.visita_marcador?.find(m => m.indicador_id === ind.id)
    setSalvandoMarcador(true)
    try {
      if (atual) {
        const { error } = await supabase.from('visita_marcador')
          .delete().eq('id', atual.id)
        if (error) throw new Error(error.message)
        setLinhas(ls => ls.map(x => x.id === v.id
          ? { ...x, visita_marcador: x.visita_marcador.filter(m => m.id !== atual.id) }
          : x))
      } else {
        const { data, error } = await supabase.from('visita_marcador')
          .insert({ visita_id: v.id, indicador_id: ind.id })
          .select('id, indicador_id, cumprido').single()
        if (error) throw new Error(error.message)
        setLinhas(ls => ls.map(x => x.id === v.id
          ? { ...x, visita_marcador: [...x.visita_marcador, data as Marcador] }
          : x))
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gravar o marcador.')
    } finally {
      setSalvandoMarcador(false)
    }
  }

  useEffect(() => {
    supabase.from('visita').select('data_agendada')
      .order('data_agendada', { ascending: false }).limit(1)
      .then(({ data }) => {
        const ultima = (data as { data_agendada: string }[] | null)?.[0]?.data_agendada ?? hoje()
        setDe(ultima); setAte(ultima)
      })
  }, [])

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.from('visita').select(SELECT)
      // Contrato excluido some da lista, mas continua no banco (D-043).
      .is('excluido_em', null)
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

  const totalPontos = useMemo(
    () => visiveis.reduce((soma, v) => soma + Number(pontos.get(v.id)?.pontos_claro ?? 0), 0),
    [visiveis, pontos])

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
            <div className="flex rounded-md bg-graf-900 p-0.5">
              {(['detalhada', 'compacta'] as const).map(d => (
                <button key={d} onClick={() => setDensidade(d)}
                  title={d === 'detalhada'
                    ? 'Mostra O.S. e código de baixa na própria linha'
                    : 'Uma linha por visita, só o essencial'}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    densidade === d ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                  {d === 'detalhada' ? 'Detalhada' : 'Compacta'}
                </button>
              ))}
            </div>
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
                  <th className={`px-3 py-2 font-medium ${detalhada ? '' : 'text-center'}`}>
                    {detalhada ? 'Ordens de serviço' : 'O.S.'}
                  </th>
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
                  const cor = SITUACAO_INFO[v.situacao]?.cor ?? '#64748b'
                  const marcados = (v.visita_marcador ?? [])
                    .map(m => ({ m, ind: porIndicador.get(m.indicador_id) }))
                    .filter(x => x.ind)
                  return (
                    <Fragment key={v.id}>
                      {/* A faixa colorida à esquerda separa um contrato do
                          outro e diz a situação antes de qualquer leitura.
                          Antes a lista era um bloco só, tudo da mesma cor. */}
                      <tr onClick={() => setAberta(exp ? null : v.id)}
                          onContextMenu={e => {
                            // Botão direito abre as ações do contrato —
                            // é como o COP está acostumado a trabalhar.
                            e.preventDefault()
                            setMenu(menu === v.id ? null : v.id)
                            setMenuXY({ x: e.clientX, y: e.clientY })
                            setPainelMarcador(null); setPainelExcluir(null); setPainelBaixa(null)
                          }}
                          style={{
                            borderLeft: `3px solid ${cor}`,
                            background: exp
                              ? undefined
                              : `color-mix(in srgb, ${cor} 5%, transparent)`,
                          }}
                          className={`cursor-pointer border-b-2 border-graf-900 hover:bg-graf-850
                                      ${exp ? 'bg-graf-850' : ''}`}>
                        {de !== ate && (
                          <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">
                            {new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR')}
                          </td>
                        )}
                        <td className="tabular whitespace-nowrap px-3 py-2 align-top text-graf-300">
                          {v.janela_inicio?.slice(0, 5) ?? '—'}
                          {v.janela_fim && <span className="text-graf-500">–{v.janela_fim.slice(0, 5)}</span>}
                          {detalhada && v.fim && (
                            <div className="text-[10px] text-graf-500">encerrou {hora(v.fim)}</div>
                          )}
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
                        <td className={`px-3 py-2 align-top ${detalhada ? 'max-w-80' : 'max-w-72 truncate'}`}
                            title={v.logradouro ?? ''}>
                          <div className={detalhada ? '' : 'truncate'}>
                            {v.logradouro ?? <span className="text-graf-600">—</span>}
                            {detalhada && v.complemento && (
                              <span className="text-graf-400">, {v.complemento}</span>
                            )}
                          </div>
                          {v.bairro && <div className="text-xs text-graf-500">{v.bairro}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-top text-graf-300">
                          {v.equipe?.codigo ?? <span className="text-af-400/70">sem equipe</span>}
                          {v.tecnico && (
                            <span className="ml-1.5 text-xs text-graf-500">{v.tecnico.matricula}</span>
                          )}
                          {detalhada && v.equipe?.supervisor_nome && (
                            <div className="max-w-40 truncate text-[10px] text-graf-500"
                                 title={v.equipe.supervisor_nome}>
                              {v.equipe.supervisor_nome}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-graf-400">
                          {v.area?.apelido ?? '—'}
                        </td>

                        {/* A coluna que o COP mais pediu: a O.S. e a baixa sem abrir nada */}
                        <td className={`px-3 py-2 align-top ${detalhada ? '' : 'tabular text-center'}`}>
                          {!detalhada ? (
                            v.ordem_servico.length > 0
                              ? <span className="rounded bg-graf-800 px-1.5 py-0.5 text-xs">
                                  {v.ordem_servico.length}</span>
                              : <span className="text-graf-600">—</span>
                          ) : v.ordem_servico.length === 0 ? (
                            <span className="text-[11px] text-graf-600">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
                                <div key={o.id}
                                     className="flex flex-wrap items-center gap-x-2 text-[11px]">
                                  <span className="tabular font-medium text-graf-200">
                                    {o.numero_os ?? '—'}
                                  </span>
                                  <span className="text-graf-400">
                                    {o.tipo_os ? `${o.tipo_os.codigo} · ${o.tipo_os.descricao}` : '—'}
                                  </span>
                                  {/* Baixa da OPERADORA — vem do TOA */}
                                  {o.codigo_baixa ? (
                                    <span title="Baixa da operadora (TOA)"
                                      className={`rounded px-1.5 py-0.5 font-medium
                                                  ${corBaixa(o.codigo_baixa.natureza)}`}>
                                      <span className="mr-1 opacity-60">TOA</span>
                                      {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                                    </span>
                                  ) : (
                                    <span className="text-graf-600">sem baixa do TOA</span>
                                  )}
                                  {/* Baixa da AFLINE — a nossa, com sub-falha */}
                                  {o.baixa_afline && (
                                    <span title="Baixa da AFLINE"
                                      className={`rounded px-1.5 py-0.5 font-medium ring-1
                                                  ring-sky-700/40 ${corBaixa(o.baixa_afline.natureza)}`}>
                                      <span className="mr-1 opacity-60">AF</span>
                                      {o.baixa_afline.codigo} · {o.baixa_afline.descricao}
                                      {o.sub_falha && (
                                        <span className="ml-1 font-normal opacity-80">
                                          › {o.sub_falha.nome}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Marcadores — os indicadores de qualidade que o
                              analista apontou neste contrato. */}
                          {detalhada && marcados.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {marcados.map(({ m, ind }) => (
                                <span key={m.id}
                                  className="rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px]
                                             font-medium uppercase tracking-wide text-sky-300
                                             ring-1 ring-sky-700/40">
                                  {ind!.nome}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 align-top text-xs text-graf-500">
                          {v.contrato ?? '—'}
                          {detalhada && v.wo_numero && (
                            <div className="text-[10px] text-graf-600">WO {v.wo_numero}</div>
                          )}
                          {(() => {
                            const p = pontos.get(v.id)
                            if (!p?.achou) return null
                            return (
                              <div className="mt-1">
                                <span
                                  title={`Edificação ${p.edificacao} (${p.edificacao_de.toLowerCase()})`}
                                  className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-[10px]
                                             font-semibold text-emerald-300 ring-1 ring-emerald-700/40">
                                  ★ {Number(p.pontos_claro).toFixed(4)}
                                </span>
                              </div>
                            )
                          })()}
                        </td>
                        <td className="relative px-3 py-2 text-right align-top">
                          <div className="flex items-center justify-end gap-1">
                            <Link to={`/controle/visita/${v.id}`} onClick={e => e.stopPropagation()}
                              className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                         text-graf-400 hover:border-af-600 hover:text-af-400">
                              abrir
                            </Link>
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                setMenu(menu === v.id ? null : v.id)
                                setMenuXY({ x: e.clientX, y: e.clientY })
                                setPainelMarcador(null)
                              }}
                              title="Ações do contrato"
                              className="rounded border border-graf-700 px-1.5 py-0.5 text-[11px]
                                         leading-none text-graf-400 hover:border-af-600
                                         hover:text-af-400">
                              ⋯
                            </button>
                          </div>

                          {menu === v.id && (
                            <div onClick={e => e.stopPropagation()}
                              style={menuXY ? {
                                left: Math.min(menuXY.x, window.innerWidth - 230),
                                top: Math.min(menuXY.y, window.innerHeight - 250),
                              } : undefined}
                              className="fixed z-50 w-52 overflow-hidden rounded-lg border
                                         border-graf-700 bg-graf-900 text-left shadow-xl">
                              <Link to={`/controle/visita/${v.id}`}
                                className="block px-3 py-2 text-xs text-graf-200 hover:bg-graf-800">
                                Abrir contrato
                              </Link>
                              <button
                                onClick={() => {
                                  setPainelMarcador(painelMarcador === v.id ? null : v.id)
                                  setAberta(v.id); setMenu(null)
                                }}
                                className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                           hover:bg-graf-800">
                                Marcadores…
                              </button>
                              <button
                                onClick={() => {
                                  setPainelBaixa(v.id); setAberta(v.id); setMenu(null)
                                  setPainelTransferir(null); setPainelExcluir(null)
                                  setOsAlvo(v.ordem_servico[0]?.id ?? '')
                                }}
                                disabled={v.ordem_servico.length === 0}
                                className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                           hover:bg-graf-800 disabled:opacity-40">
                                Baixar serviço…
                              </button>
                              <button
                                onClick={() => {
                                  setPainelTransferir(v.id); setAberta(v.id); setMenu(null)
                                  setEquipeDestino(''); setMotivoTransf('')
                                }}
                                className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                           hover:bg-graf-800">
                                Transferir equipe…
                              </button>
                              <button
                                onClick={() => {
                                  setPainelExcluir(v.id); setAberta(v.id); setMenu(null); setMotivo('')
                                }}
                                className="block w-full border-t border-graf-800 px-3 py-2
                                           text-left text-xs text-af-300 hover:bg-af-900/20">
                                Excluir contrato…
                              </button>
                              <div className="border-t border-graf-800 px-3 py-2 text-[10px]
                                              leading-snug text-graf-600">
                                Editar não existe: o cadastro vem do TOA e é reescrito a cada
                                importação.
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>

                      {exp && (
                        <tr className="border-b border-graf-800 bg-graf-900">
                          <td colSpan={10} className="px-3 py-3">
                            {/* ---- transferência rápida ---- */}
                            {painelTransferir === v.id && (
                              <div className="mb-3 rounded-lg border border-graf-700 bg-graf-850 p-3">
                                <p className="mb-2 text-xs font-medium text-graf-200">
                                  Transferir contrato
                                  <span className="ml-2 font-normal text-graf-500">
                                    de {v.equipe?.codigo ?? 'sem equipe'} para outra equipe — fica no histórico
                                  </span>
                                </p>
                                <div className="flex flex-wrap items-end gap-2">
                                  <label className="text-[11px] text-graf-400">
                                    <span className="mb-1 block">Equipe destino</span>
                                    <select value={equipeDestino}
                                      onChange={e => setEquipeDestino(e.target.value)}
                                      className={`${sel} w-56`}>
                                      <option value="">— escolha —</option>
                                      {equipes.filter(e => e.codigo !== v.equipe?.codigo).map(e => (
                                        <option key={e.id} value={e.id}>{e.codigo} · {e.nome}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                                    <span className="mb-1 block">Motivo</span>
                                    <input value={motivoTransf}
                                      onChange={e => setMotivoTransf(e.target.value)}
                                      placeholder="Por que está transferindo?"
                                      className={`${sel} w-full`} />
                                  </label>
                                  <button onClick={() => transferir(v)}
                                    disabled={salvandoMarcador || !equipeDestino}
                                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium
                                               text-white hover:bg-af-500 disabled:opacity-50">
                                    Transferir
                                  </button>
                                  <button onClick={() => setPainelTransferir(null)}
                                    className="rounded-md border border-graf-700 px-3 py-1.5
                                               text-xs text-graf-400">
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* ---- baixa da AFLINE (D-042) ---- */}
                            {painelBaixa === v.id && (
                              <div className="mb-3 rounded-lg border border-graf-700 bg-graf-850 p-3">
                                <p className="mb-2 text-xs font-medium text-graf-200">
                                  Baixar serviço
                                  <span className="ml-2 font-normal text-graf-500">
                                    esta é a baixa da AFLINE — a da operadora vem do TOA e não se edita
                                  </span>
                                </p>
                                <div className="flex flex-wrap items-end gap-2">
                                  <label className="text-[11px] text-graf-400">
                                    <span className="mb-1 block">O.S.</span>
                                    <select value={osAlvo} onChange={e => setOsAlvo(e.target.value)}
                                      className={`${sel} w-64`}>
                                      {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia)
                                        .map(o => (
                                          <option key={o.id} value={o.id}>
                                            #{o.sequencia} · {o.numero_os} ·{' '}
                                            {o.tipo_os?.descricao ?? '—'}
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                  <label className="text-[11px] text-graf-400">
                                    <span className="mb-1 block">Código de baixa</span>
                                    <select value={codigoSel} onChange={e => setCodigoSel(e.target.value)}
                                      className={`${sel} w-72`}>
                                      <option value="">— escolha —</option>
                                      {codigos.map(c => (
                                        <option key={c.codigo} value={c.codigo}>
                                          {c.codigo} · {c.descricao}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-[11px] text-graf-400">
                                    <span className="mb-1 block">
                                      Sub-falha
                                      {codigoSel && subFalhas.length === 0 && (
                                        <span className="ml-1 text-graf-600">
                                          (nenhuma para este código)
                                        </span>
                                      )}
                                    </span>
                                    <select value={subSel} onChange={e => setSubSel(e.target.value)}
                                      disabled={!subFalhas.length} className={`${sel} w-72`}>
                                      <option value="">— sem sub-falha —</option>
                                      {subFalhas.map(s => (
                                        <option key={s.id} value={s.id}>{s.nome}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                                    <span className="mb-1 block">Observação</span>
                                    <input value={obsBaixa} onChange={e => setObsBaixa(e.target.value)}
                                      className={`${sel} w-full`} />
                                  </label>
                                  <button onClick={() => gravarBaixa(v)}
                                    disabled={salvandoMarcador || !osAlvo || !codigoSel}
                                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium
                                               text-white hover:bg-af-500 disabled:opacity-50">
                                    Confirmar baixa
                                  </button>
                                  <button onClick={() => setPainelBaixa(null)}
                                    className="rounded-md border border-graf-700 px-3 py-1.5
                                               text-xs text-graf-400">
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* ---- exclusão (D-043) ---- */}
                            {painelExcluir === v.id && (
                              <div className="mb-3 rounded-lg border border-af-700/60 bg-af-900/15 p-3">
                                <p className="text-xs font-medium text-af-200">
                                  Excluir o contrato {v.contrato ?? v.toa_atividade_id}?
                                </p>
                                <p className="mt-1 text-[11px] text-af-200/80">
                                  Ele sai das listas e dos relatórios, mas continua no banco com
                                  quem excluiu, quando e por quê — e pode ser restaurado. Apagar
                                  de verdade levaria junto as O.S., o histórico e a base de um mês
                                  já faturado.
                                </p>
                                <div className="mt-2 flex flex-wrap items-end gap-2">
                                  <label className="min-w-64 flex-1 text-[11px] text-graf-400">
                                    <span className="mb-1 block">Motivo (obrigatório)</span>
                                    <input value={motivo} onChange={e => setMotivo(e.target.value)}
                                      autoFocus placeholder="Duplicado, aberto por engano, cancelado pela CLARO…"
                                      className={`${sel} w-full`} />
                                  </label>
                                  <button onClick={() => excluir(v)}
                                    disabled={salvandoMarcador || !motivo.trim()}
                                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium
                                               text-white hover:bg-af-500 disabled:opacity-50">
                                    Excluir
                                  </button>
                                  <button onClick={() => { setPainelExcluir(null); setMotivo('') }}
                                    className="rounded-md border border-graf-700 px-3 py-1.5
                                               text-xs text-graf-400">
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Anexo 8: os indicadores de qualidade são o que
                                o analista aponta no contrato do técnico. */}
                            {painelMarcador === v.id && (
                              <div className="mb-3 rounded-lg border border-graf-700 bg-graf-850 p-3">
                                <p className="mb-2 text-xs font-medium text-graf-200">
                                  Marcadores de qualidade
                                  <span className="ml-2 font-normal text-graf-500">
                                    clique para ligar ou desligar neste contrato
                                  </span>
                                </p>
                                {indicadores.length === 0 ? (
                                  <p className="text-xs text-graf-500">
                                    Nenhum indicador cadastrado. Cadastre em Configurações.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {indicadores.map(ind => {
                                      const ligado = (v.visita_marcador ?? [])
                                        .some(m => m.indicador_id === ind.id)
                                      return (
                                        <button key={ind.id} disabled={salvandoMarcador}
                                          onClick={() => alternarMarcador(v, ind)}
                                          title={`Meta ${ind.meta} · peso ${ind.peso}`}
                                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium
                                                      ring-1 transition disabled:opacity-50 ${
                                            ligado
                                              ? 'bg-sky-900/40 text-sky-300 ring-sky-700/50'
                                              : 'bg-graf-900 text-graf-400 ring-graf-700 hover:text-graf-200'}`}>
                                          {ligado && <span className="mr-1">✓</span>}
                                          {ind.nome}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
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
          {totalPontos > 0 && (
            <> · <strong className="tabular text-emerald-400">
              {totalPontos.toFixed(4)}
            </strong> pontos CLARO no filtro</>
          )}
          {soProdutivas && linhas.length !== base.length &&
            ` · ${linhas.length - base.length} apontamentos de jornada ocultos`}
        </p>
      </div>
    </Shell>
  )
}
