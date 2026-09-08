import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, SITUACOES, EM_ABERTO, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import type { Visita } from '../lib/metricas'
import { Shell } from '../components/Shell'
import { Alerta, Pill, Vazio } from '../components/ui'
import { ContratoModal } from '../components/ContratoModal'
import { dataBR, diaSemana, isoLocal, pts } from '../lib/formato'
import { NovoContratoModal } from '../components/NovoContratoModal'

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
  // O contrato abre em JANELA, nao em linha expandida (D-056).
  const [modal, setModal] = useState<string | null>(null)
  // Cadastro manual: o serviço que não veio do TOA precisa entrar
  // mesmo assim, senão não é despachado nem cobrado.
  const [novo, setNovo] = useState(false)
  // Sobe de 1 quando o modal muda algo; os carregamentos ouvem.
  const [versao, setVersao] = useState(0)

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

  useEffect(() => {
    supabase.from('indicador_qualidade')
      .select('id, nome, meta, peso, ordem').eq('ativo', true).order('ordem')
      .then(({ data }) => setIndicadores((data ?? []) as Indicador[]))
  }, [])

  const porIndicador = useMemo(
    () => new Map(indicadores.map(i => [i.id, i])), [indicadores])


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
  }, [de, ate, versao])


  // ---- transferência rápida, sem sair da lista ----
  const [equipes, setEquipes] = useState<{ id: string; codigo: string; nome: string }[]>([])

  useEffect(() => {
    supabase.from('equipe').select('id, codigo, nome').eq('ativo', true).order('codigo')
      .then(({ data }) => setEquipes((data ?? []) as { id: string; codigo: string; nome: string }[]))
  }, [])


  // ---- baixa da AFLINE, com sub-falha do código escolhido ----
  const [codigos, setCodigos] = useState<{ codigo: number; descricao: string }[]>([])

  // Os dois conjuntos de sub-falha convivem no banco; só um vale. Sem
  // filtrar pelo vigente, a lista vem em dobro (CASO 1 + NÍVEL HARD).
  const [conjunto, setConjunto] = useState<string | null>(null)

  // ---- histórico do contrato (D-069) ----
  // Buscar um número de contrato deixa de ser filtro do período e passa
  // a ser a pergunta "o que já aconteceu neste contrato". O período
  // esconderia justamente as outras visitas, que são o que interessa
  // quando alguém digita um contrato inteiro.
  const [contratoBuscado, setContratoBuscado] = useState<string | null>(null)

  useEffect(() => {
    const t = busca.trim()
    const alvo = /^\d{6,}$/.test(t) ? t : null
    // Espera o usuário parar de digitar: sem isto, "226803663" dispara
    // nove consultas.
    const id = setTimeout(() => setContratoBuscado(alvo), 350)
    return () => clearTimeout(id)
  }, [busca])

  useEffect(() => {
    supabase.from('codigo_baixa').select('codigo, descricao').order('codigo')
      .then(({ data }) => setCodigos((data ?? []) as { codigo: number; descricao: string }[]))
    supabase.from('empresa').select('conjunto_sub_falha').maybeSingle()
      .then(({ data }) =>
        setConjunto((data as { conjunto_sub_falha: string | null } | null)?.conjunto_sub_falha ?? null))
  }, [])




  useEffect(() => {
    supabase.from('visita').select('data_agendada')
      .order('data_agendada', { ascending: false }).limit(1)
      .then(({ data }) => {
        const ultima = (data as { data_agendada: string }[] | null)?.[0]?.data_agendada ?? isoLocal()
        setDe(ultima); setAte(ultima)
      })
  }, [])

  useEffect(() => {
    if (!contratoBuscado && (!de || !ate)) return
    let vivo = true
    setCarregando(true); setErro(null)

    // Contrato excluido some da lista, mas continua no banco (D-043).
    let q = supabase.from('visita').select(SELECT).is('excluido_em', null)
    q = contratoBuscado
      ? q.eq('contrato', contratoBuscado)
      : q.gte('data_agendada', de).lte('data_agendada', ate)

    q.order('data_agendada', { ascending: false })
      .order('janela_inicio', { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setLinhas((data ?? []) as unknown as V[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [de, ate, versao, contratoBuscado])

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
        <button onClick={() => setNovo(true)}
          className="ml-1 rounded-md bg-af-600 px-3 py-1 text-xs font-semibold text-white
                     hover:bg-af-500">
          + Nova O.S.
        </button>
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

        {/* Quando a busca vira histórico de contrato, a tela precisa
            dizer isso — senão o usuário acha que o filtro de data quebrou. */}
        {contratoBuscado && (
          <Alerta tipo="info">
            Mostrando <strong>todas</strong> as visitas do contrato{' '}
            <strong className="tabular">{contratoBuscado}</strong>, dia a dia, fora do
            período{' '}
            <button onClick={() => setBusca('')}
              className="underline underline-offset-2 hover:text-af-400">
              — voltar ao período
            </button>
          </Alerta>
        )}

        {/* ====== tabela ====== */}
        <section className="card-controle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-graf-700 bg-graf-900 text-left
                                text-[11px] uppercase tracking-wide text-graf-400">
                {/* As divisórias são translúcidas (graf-500 com alpha), não
                    uma cor fixa: a rampa inverte no tema claro e uma borda
                    escura fixa viraria risco preto sobre branco. */}
                <tr className="[&>th]:border-r [&>th]:border-graf-500/20
                               [&>th:last-child]:border-r-0">
                  {/* O contrato vem primeiro: e' por ele que se procura, se
                      fala ao telefone e se confere com a CLARO. A janela e'
                      importante, mas nao e' a identidade da linha. */}
                  <th className="px-3 py-2 font-medium">Contrato</th>
                  <th className="px-3 py-2 font-medium">Janela</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2 font-medium">Grupo</th>
                  <th className="px-3 py-2 font-medium">Endereço</th>
                  <th className="px-3 py-2 font-medium">Equipe</th>
                  <th className="px-3 py-2 font-medium">Área</th>
                  <th className={`px-3 py-2 font-medium ${detalhada ? '' : 'text-center'}`}>
                    {detalhada ? 'Ordens de serviço' : 'O.S.'}
                  </th>
                  <th className="px-3 py-2 font-medium">Data</th>
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
                      <tr onClick={() => setModal(v.id)}
                          onContextMenu={e => {
                            // Botão direito abre as ações do contrato —
                            // é como o COP está acostumado a trabalhar.
                            e.preventDefault()
                            setMenu(menu === v.id ? null : v.id)
                            setMenuXY({ x: e.clientX, y: e.clientY })
                          }}
                          style={{
                            borderLeft: `3px solid ${cor}`,
                            background: `color-mix(in srgb, ${cor} 8%, transparent)`,
                          }}
                          className="cursor-pointer border-b border-graf-500/25
                                     [&>td]:border-r [&>td]:border-graf-500/15
                                     [&>td:last-child]:border-r-0 hover:bg-graf-850">
                        <td className="tabular whitespace-nowrap px-3 py-2 align-top">
                          <div className="font-medium text-graf-200">{v.contrato ?? '—'}</div>
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
                                  ★ {pts(p.pontos_claro)}
                                </span>
                              </div>
                            )
                          })()}
                        </td>
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
                                      <span className="mr-1 opacity-70">Baixa TOA</span>
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
                                      <span className="mr-1 opacity-70">Baixa ngestor</span>
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
                        {/* A data mora onde o contrato morava. Sem ela a
                            busca por contrato -- que traz varias datas --
                            viraria uma pilha de linhas indistinguiveis. */}
                        <td className="tabular whitespace-nowrap px-3 py-2 align-top text-xs text-graf-400">
                          {dataBR(v.data_agendada)}
                          <div className="text-[10px] text-graf-600">
                            {diaSemana(v.data_agendada)}
                          </div>
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
                                onClick={() => { setModal(v.id); setMenu(null) }}
                                className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                           hover:bg-graf-800">
                                Marcadores…
                              </button>
                              <button
                                onClick={() => { setModal(v.id); setMenu(null) }}
                                disabled={v.ordem_servico.length === 0}
                                className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                           hover:bg-graf-800 disabled:opacity-40">
                                Baixar serviço…
                              </button>
                              <button
                                onClick={() => { setModal(v.id); setMenu(null) }}
                                className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                           hover:bg-graf-800">
                                Transferir equipe…
                              </button>
                              <button
                                onClick={() => { setModal(v.id); setMenu(null) }}
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
              {pts(totalPontos)}
            </strong> CLARO no filtro</>
          )}
          {soProdutivas && linhas.length !== base.length &&
            ` · ${linhas.length - base.length} apontamentos de jornada ocultos`}
        </p>
      </div>

      {novo && (
        <NovoContratoModal
          onFechar={() => setNovo(false)}
          onCriado={id => {
            setNovo(false)
            setVersao(x => x + 1)
            // Abre o contrato recém-criado: quem cadastrou quase sempre
            // quer conferir ou já atribuir equipe.
            setModal(id)
          }}
        />
      )}

      {modal && (
        <ContratoModal
          id={modal}
          indicadores={indicadores}
          codigos={codigos}
          conjunto={conjunto}
          equipes={equipes}
          pontos={pontos.get(modal) ?? null}
          onFechar={() => setModal(null)}
          onMudou={() => setVersao(x => x + 1)}
        />
      )}
    </Shell>
  )
}
