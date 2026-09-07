import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, SITUACAO_INFO, EM_ABERTO, type Situacao } from '../lib/supabase'
import { lerPlanilha } from '../lib/planilha'
import { Shell } from '../components/Shell'
import { Alerta, Avatar, Pill, Vazio } from '../components/ui'

/**
 * Equipes de campo.
 *
 * A leitura é POR DIA (`painel_equipes(p_data)`), não por CURRENT_DATE:
 * a `vw_equipe_resumo` devolvia zero para tudo sempre que o dia corrente
 * não tinha importação — a tela parecia vazia sem estar errada.
 *
 * Cada equipe abre e mostra os contratos daquele dia, com as O.S.
 * agrupadas por contrato. É a leitura que o COP faz: "o que a 014 tem
 * hoje", não "liste 470 visitas e filtre".
 *
 * OCIOSO (D-026): só vale para o dia corrente — ver D-033 na migration
 * 024. Em dia passado a coluna mostra a hora da última atividade.
 */

interface Periodo { janela: string; qtd: number }
interface SitQtd { situacao: Situacao; qtd: number }

interface EquipePainel {
  equipe_id: string
  codigo: string
  nome: string
  area: string | null
  supervisor: string | null
  login_toa: string | null
  tecnicos: number
  visitas: number
  ordens: number
  periodos: Periodo[] | null
  situacoes: SitQtd[] | null
  ultima_atividade: string | null
  situacao_final: Situacao | null
  minutos_parada: number | null
  ocioso: boolean | null
}

interface OS {
  id: string
  sequencia: number
  numero_os: string | null
  status_operadora: string | null
  ponto: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: { codigo: number; descricao: string; natureza: string | null } | null
}
interface VisitaLinha {
  id: string
  contrato: string | null
  wo_numero: string | null
  logradouro: string | null
  complemento: string | null
  bairro: string | null
  situacao: Situacao
  janela_inicio: string | null
  janela_fim: string | null
  inicio: string | null
  fim: string | null
  bloqueado_em: string | null
  tipo_servico: { nome: string } | null
  tipo_atividade: { nome: string; natureza: string | null } | null
  ordem_servico: OS[]
}

interface Tec {
  id: string; matricula: string; nome: string; situacao: string
  equipe_id: string | null
  foto_url: string | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null
            area: { apelido: string | null } | null } | null
}
interface Orfao {
  matricula: string; visitas: number
  primeira: string; ultima: string; equipes_sugeridas: string | null
}

const COLUNAS = ['LOGIN', 'NOME DO TÉCNICO', 'EQUIPE', 'SUPERVISOR', 'ÁREA']

const SELECT_VISITA = `
  id, contrato, wo_numero, logradouro, complemento, bairro,
  situacao, janela_inicio, janela_fim, inicio, fim, bloqueado_em,
  tipo_servico:tipo_servico_id ( nome ),
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora, ponto,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza )
  )
`

const iso = (d: Date) => d.toISOString().slice(0, 10)
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)
const hora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

export default function Equipes() {
  const [aba, setAba] = useState<'equipes' | 'tecnicos'>('equipes')
  // Vazia até sabermos qual é o último dia com visita. Iniciar em "hoje"
  // e corrigir depois dispara DOIS carregamentos concorrentes, e o mais
  // velho pode chegar por último — a tela ficava com o painel do dia
  // errado e o "Carregando…" preso.
  const [data, setData] = useState<string>('')
  const [painel, setPainel] = useState<EquipePainel[]>([])
  const [tecnicos, setTecnicos] = useState<Tec[]>([])
  const [orfaos, setOrfaos] = useState<Orfao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // expansão sob demanda
  const [aberta, setAberta] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<Record<string, VisitaLinha[]>>({})
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null)

  // filtros
  const [busca, setBusca] = useState('')
  const [area, setArea] = useState('TODAS')
  const [supervisor, setSupervisor] = useState('TODOS')
  // Ligado por padrao: 89 equipes na tela, 7 com servico no dia. Quem
  // nao tem contrato nao tem o que ser olhado -- e as 82 linhas vazias
  // empurravam as 7 que importam para fora da primeira tela.
  const [soAtivas, setSoAtivas] = useState(true)
  const [agrupar, setAgrupar] = useState<'nenhum' | 'supervisor' | 'area'>('nenhum')

  // importação
  const inputRef = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<Record<string, string>[] | null>(null)
  const [faltando, setFaltando] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)

  // cadastro avulso
  const [cadastrando, setCadastrando] = useState<string | null>(null)
  const [nomeNovo, setNomeNovo] = useState('')
  const [equipeNova, setEquipeNova] = useState('')

  // A data padrão é o último dia COM visita — não adianta abrir no dia
  // corrente se a importação mais recente é de anteontem.
  useEffect(() => {
    supabase.from('visita').select('data_agendada')
      .order('data_agendada', { ascending: false }).limit(1)
      .then(({ data: d }) => {
        const ultima = (d as { data_agendada: string }[] | null)?.[0]?.data_agendada
        setData(ultima ?? iso(new Date()))
      })
  }, [])

  // Cada carregamento carimba um número; resposta de pedido velho é
  // descartada. Trocar de data rápido não embaralha mais o painel.
  // Quem aparece na bolinha da equipe: o tecnico dela. Uma equipe pode
  // ter mais de um (a AFLINE trabalha em dupla); mostramos o primeiro e
  // dizemos no title quantos sao.
  const porEquipe = useMemo(() => {
    const m = new Map<string, Tec[]>()
    for (const t of tecnicos) {
      if (!t.equipe_id) continue
      const l = m.get(t.equipe_id) ?? []
      l.push(t)
      m.set(t.equipe_id, l)
    }
    return m
  }, [tecnicos])

  const pedido = useRef(0)

  async function recarregar() {
    if (!data) return
    const meu = ++pedido.current
    setCarregando(true); setErro(null)
    setAberta(null); setDetalhe({})
    const [p, t, o] = await Promise.all([
      supabase.rpc('painel_equipes', { p_data: data }),
      supabase.from('tecnico')
        .select(`id, matricula, nome, situacao, equipe_id, foto_url,
                 equipe:equipe_id ( codigo, nome, supervisor_nome,
                                    area:area_id ( apelido ) )`)
        .order('matricula'),
      supabase.rpc('tecnicos_nao_cadastrados'),
    ])
    if (meu !== pedido.current) return
    if (p.error) setErro(p.error.message)
    else setPainel((p.data ?? []) as EquipePainel[])
    if (t.data) setTecnicos(t.data as unknown as Tec[])
    if (o.data) setOrfaos(o.data as Orfao[])
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [data])

  async function abrir(e: EquipePainel) {
    if (aberta === e.equipe_id) { setAberta(null); return }
    setAberta(e.equipe_id)
    if (detalhe[e.equipe_id]) return
    setCarregandoDetalhe(e.equipe_id)
    const { data: d, error } = await supabase.from('visita').select(SELECT_VISITA)
      .eq('equipe_id', e.equipe_id).eq('data_agendada', data)
      .is('excluido_em', null)
      .order('janela_inicio', { ascending: true, nullsFirst: false })
    if (error) setErro(error.message)
    else setDetalhe(m => ({ ...m, [e.equipe_id]: (d ?? []) as unknown as VisitaLinha[] }))
    setCarregandoDetalhe(null)
  }

  async function receber(f: File) {
    setErro(null); setOk(null)
    try {
      const r = await lerPlanilha(f, 'Equipes')
      setFaltando(COLUNAS.filter(c => !r.cabecalhos.includes(c)))
      setPrevia(r.linhas)
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui ler a planilha.')
    }
  }

  async function importar() {
    if (!previa) return
    setOcupado(true); setErro(null)
    try {
      const LOTE = 200
      let ultimo: Record<string, unknown> = {}
      for (let i = 0; i < previa.length; i += LOTE) {
        const { data: d, error } = await supabase.rpc('importar_equipes',
          { p_linhas: previa.slice(i, i + LOTE) })
        if (error) throw new Error(error.message)
        ultimo = d as Record<string, unknown>
      }
      const { data: religadas } = await supabase.rpc('religar_visitas_equipe')
      setOk(`${ultimo.equipes} equipes e ${ultimo.tecnicos} técnicos no cadastro. `
        + `${religadas ?? 0} visitas religadas.`)
      setPrevia(null)
      if (inputRef.current) inputRef.current.value = ''
      await recarregar()
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Falha ao importar.')
    } finally { setOcupado(false) }
  }

  async function cadastrarAvulso(matricula: string) {
    setOcupado(true); setErro(null)
    const { data: d, error } = await supabase.rpc('cadastrar_tecnico_avulso', {
      p_matricula: matricula,
      p_nome: nomeNovo || matricula,
      p_equipe_id: equipeNova || null,
    })
    if (error) setErro(error.message)
    else {
      const r = d as { visitas_religadas: number }
      setOk(`${matricula} cadastrado. ${r.visitas_religadas} visitas religadas a ele.`)
      setCadastrando(null); setNomeNovo(''); setEquipeNova('')
      await recarregar()
    }
    setOcupado(false)
  }

  const areas = useMemo(() =>
    [...new Set(painel.map(e => e.area).filter(Boolean) as string[])].sort(), [painel])
  const supervisores = useMemo(() =>
    [...new Set(painel.map(e => e.supervisor).filter(Boolean) as string[])].sort(), [painel])

  const eqFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return painel.filter(e => {
      if (area !== 'TODAS' && e.area !== area) return false
      if (supervisor !== 'TODOS' && e.supervisor !== supervisor) return false
      if (soAtivas && e.visitas === 0) return false
      if (!t) return true
      return [e.codigo, e.nome, e.supervisor, e.area, e.login_toa]
        .some(x => x?.toLowerCase().includes(t))
    })
  }, [painel, busca, area, supervisor, soAtivas])

  const grupos = useMemo(() => {
    const ordenadas = [...eqFiltradas].sort((a, b) =>
      b.visitas - a.visitas || a.codigo.localeCompare(b.codigo))
    if (agrupar === 'nenhum') return [{ titulo: '', itens: ordenadas }]
    const m = new Map<string, EquipePainel[]>()
    for (const e of ordenadas) {
      const k = (agrupar === 'supervisor' ? e.supervisor : e.area) ?? '(sem definição)'
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([titulo, itens]) => ({ titulo, itens }))
  }, [eqFiltradas, agrupar])

  const tecFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return tecnicos.filter(x => {
      if (area !== 'TODAS' && x.equipe?.area?.apelido !== area) return false
      if (!t) return true
      return [x.matricula, x.nome, x.equipe?.codigo, x.equipe?.supervisor_nome]
        .some(y => y?.toLowerCase().includes(t))
    })
  }, [tecnicos, busca, area])

  const semTecnico = painel.filter(e => e.tecnicos === 0).length
  const emCampo = painel.filter(e => e.visitas > 0).length
  const ociosas = painel.filter(e => e.ocioso).length
  const totalOrfaos = orfaos.reduce((s, o) => s + o.visitas, 0)
  const ehHoje = data === iso(new Date())

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs'

  return (
    <Shell acoes={
      <div className="flex items-center gap-2">
        <input type="date" value={data} onChange={e => setData(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        <button onClick={() => inputRef.current?.click()}
          className="rounded-md bg-af-600 px-3 py-1 text-xs font-medium text-white hover:bg-af-500">
          Importar planilha
        </button>
      </div>
    }>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) receber(f) }} />

      <div className="space-y-4 p-4">
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        {/* ====== técnicos vistos em campo e fora do cadastro ====== */}
        {orfaos.length > 0 && (
          <section className="rounded-lg border border-amber-700/60 bg-amber-900/15 p-4">
            <h2 className="font-medium text-amber-200">
              {orfaos.length} técnico(s) trabalhando em campo e fora do cadastro
            </h2>
            <p className="mt-1 text-sm text-amber-200/80">
              Apareceram no TOA executando <strong>{totalOrfaos} visitas</strong>, mas não
              estão na planilha de equipes. Enquanto isso, essas visitas ficam sem equipe
              e fora da produtividade.
            </p>
            <div className="mt-3 space-y-1.5">
              {orfaos.map(o => (
                <div key={o.matricula}
                  className="rounded-md border border-amber-800/50 bg-graf-900 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="tabular font-semibold">{o.matricula}</span>
                    <span className="text-graf-400">{o.visitas} visitas</span>
                    <span className="text-xs text-graf-500">
                      {new Date(o.primeira + 'T12:00').toLocaleDateString('pt-BR')}
                      {o.primeira !== o.ultima &&
                        ` a ${new Date(o.ultima + 'T12:00').toLocaleDateString('pt-BR')}`}
                    </span>
                    {o.equipes_sugeridas && (
                      <span className="text-xs text-graf-500">área {o.equipes_sugeridas}</span>
                    )}
                    <button
                      onClick={() => { setCadastrando(cadastrando === o.matricula ? null : o.matricula); setNomeNovo('') }}
                      className="ml-auto rounded-md bg-af-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-af-500">
                      {cadastrando === o.matricula ? 'Cancelar' : 'Cadastrar'}
                    </button>
                  </div>

                  {cadastrando === o.matricula && (
                    <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-graf-800 pt-2.5">
                      <div className="min-w-48 flex-1">
                        <label className="mb-1 block text-[11px] text-graf-400">Nome</label>
                        <input value={nomeNovo} onChange={e => setNomeNovo(e.target.value)}
                          placeholder={o.matricula} autoFocus
                          className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm" />
                      </div>
                      <div className="min-w-40">
                        <label className="mb-1 block text-[11px] text-graf-400">Equipe</label>
                        <select value={equipeNova} onChange={e => setEquipeNova(e.target.value)}
                          className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm">
                          <option value="">Sem equipe por enquanto</option>
                          {painel.map(e => (
                            <option key={e.equipe_id} value={e.equipe_id}>
                              {e.codigo} · {e.area ?? '—'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button disabled={ocupado} onClick={() => cadastrarAvulso(o.matricula)}
                        className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white
                                   hover:bg-emerald-500 disabled:opacity-50">
                        {ocupado ? 'Salvando…' : 'Salvar e religar visitas'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ====== prévia da importação ====== */}
        {previa && (
          <section className="card-controle space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">Prévia da importação</h2>
              <button onClick={() => setPrevia(null)}
                className="text-sm text-graf-400 hover:text-af-400">Cancelar</button>
            </div>
            <p className="text-sm text-graf-300">
              <strong className="tabular text-lg">{previa.length}</strong> linhas.
              Equipe e técnico já existentes são <strong>atualizados</strong>, não duplicados.
            </p>
            {faltando.length > 0 && (
              <Alerta tipo="aviso">
                Colunas ausentes: <strong>{faltando.join(', ')}</strong>.
                Use a <code>equipes-manaus.xlsx</code>, aba <code>Equipes</code>.
              </Alerta>
            )}
            <button onClick={importar} disabled={ocupado || faltando.length > 0}
              className="toque rounded-lg bg-af-600 px-6 font-semibold text-white
                         hover:bg-af-500 disabled:opacity-50">
              {ocupado ? 'Importando…' : `Importar ${previa.length} linhas`}
            </button>
          </section>
        )}

        {/* ====== resumo ====== */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {([
            ['Equipes', painel.length, false],
            ['Com serviço no dia', emCampo, false],
            ['Técnicos', tecnicos.length, false],
            ['Sem técnico', semTecnico, semTecnico > 0],
            ['Fora do cadastro', orfaos.length, orfaos.length > 0],
            [ehHoje ? 'Ociosas agora' : 'Ocioso (só hoje)', ehHoje ? ociosas : 0, ehHoje && ociosas > 0],
          ] as [string, number, boolean][]).map(([r, v, alerta]) => (
            <div key={r} className={`card-controle px-3.5 py-3 ${alerta ? 'ring-1 ring-af-600/50' : ''}`}>
              <div className="tabular text-2xl font-semibold leading-none"
                   style={alerta ? { color: 'var(--st-conflito)' } : undefined}>
                {r.startsWith('Ocioso') ? '—' : v}
              </div>
              <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">{r}</div>
            </div>
          ))}
        </section>

        {/* ====== filtros ====== */}
        <section className="card-controle flex flex-wrap items-center gap-2 p-3">
          <div className="flex rounded-lg bg-graf-900 p-0.5">
            {(['equipes', 'tecnicos'] as const).map(a => (
              <button key={a} onClick={() => setAba(a)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                {a === 'equipes' ? 'Equipes' : 'Técnicos'}
                <span className="tabular ml-1.5 opacity-60">
                  {a === 'equipes' ? painel.length : tecnicos.length}
                </span>
              </button>
            ))}
          </div>

          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar código, login TOA, matrícula, supervisor…"
            className="min-w-56 flex-1 rounded-md border border-graf-700 bg-graf-900 px-3 py-1.5
                       text-sm outline-none placeholder-graf-500 focus:border-af-500" />

          <select value={area} onChange={e => setArea(e.target.value)} className={sel}>
            <option value="TODAS">Todas as áreas</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          {aba === 'equipes' && (
            <>
              <select value={supervisor} onChange={e => setSupervisor(e.target.value)}
                className={`max-w-52 ${sel}`}>
                <option value="TODOS">Todos os supervisores</option>
                {supervisores.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={agrupar} onChange={e => setAgrupar(e.target.value as typeof agrupar)}
                className={sel}>
                <option value="nenhum">Sem agrupamento</option>
                <option value="supervisor">Agrupar por supervisor</option>
                <option value="area">Agrupar por área</option>
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
                <input type="checkbox" checked={soAtivas}
                  onChange={e => setSoAtivas(e.target.checked)} className="accent-af-600" />
                Só com serviço no dia
              </label>
            </>
          )}
        </section>

        {/* ====== conteúdo ====== */}
        {carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : aba === 'equipes' ? (
          eqFiltradas.length === 0 ? (
            <div className="card-controle">
              <Vazio titulo="Nenhuma equipe para este filtro"
                descricao={painel.length === 0
                  ? 'Importe a planilha de equipes para popular o cadastro.'
                  : 'Ajuste a busca ou os filtros.'} />
            </div>
          ) : (
            <div className="space-y-4">
              {grupos.map(g => (
                <section key={g.titulo || 'todos'} className="card-controle overflow-hidden">
                  {g.titulo && (
                    <div className="flex items-baseline gap-2 border-b border-graf-800 bg-graf-900 px-3 py-2">
                      <h3 className="text-sm font-semibold">{g.titulo}</h3>
                      <span className="tabular text-xs text-graf-500">
                        {g.itens.length} equipe(s) ·{' '}
                        {g.itens.reduce((s, e) => s + Number(e.visitas), 0)} contratos no dia
                      </span>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-graf-700 bg-graf-900 text-left
                                        text-[11px] uppercase tracking-wide text-graf-400">
                        <tr>
                          <th className="w-8 px-2 py-2"></th>
                          <th className="px-3 py-2 font-medium">Equipe</th>
                          <th className="px-3 py-2 text-right font-medium">Contratos</th>
                          <th className="px-3 py-2 text-right font-medium">O.S.</th>
                          <th className="px-3 py-2 font-medium">Períodos</th>
                          <th className="px-3 py-2 font-medium">Situação</th>
                          <th className="px-3 py-2 font-medium">
                            {ehHoje ? 'Estado' : 'Última atividade'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.itens.map(e => {
                          const exp = aberta === e.equipe_id
                          return (
                            <Fragment key={e.equipe_id}>
                              <tr onClick={() => abrir(e)}
                                  className={`cursor-pointer border-b border-graf-800 align-top
                                              hover:bg-graf-850 ${exp ? 'bg-graf-850' : ''}`}>
                                <td className="px-2 py-2.5 text-graf-500">{exp ? '▾' : '▸'}</td>

                                <td className="px-3 py-2.5">
                                  <div className="flex items-start gap-2.5">
                                  {(() => {
                                    const ts = porEquipe.get(e.equipe_id) ?? []
                                    const t = ts[0]
                                    return (
                                      <Avatar
                                        nome={t?.nome ?? e.codigo}
                                        foto={t?.foto_url}
                                        tamanho={32}
                                        titulo={ts.length
                                          ? `${ts.map(x => x.nome).join(' · ')}`
                                          : `Equipe ${e.codigo} — sem técnico`} />
                                    )
                                  })()}
                                  <div className="min-w-0">
                                  <div className="flex items-baseline gap-2">
                                    <span className="tabular font-semibold">{e.codigo}</span>
                                    {e.tecnicos === 0 && (
                                      <span className="rounded bg-af-900/40 px-1.5 py-0.5
                                                       text-[10px] font-semibold text-af-300">
                                        sem técnico
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-0.5 text-[11px] leading-relaxed text-graf-400">
                                    {e.login_toa ? (
                                      <span>Login TOA <span className="tabular text-graf-300">
                                        {e.login_toa}</span></span>
                                    ) : (
                                      <span className="text-graf-600">sem login TOA no dia</span>
                                    )}
                                    {e.tecnicos > 0 && <span> · {e.tecnicos} téc.</span>}
                                    <br />
                                    {e.supervisor ?? '—'}
                                    {e.area && <span className="text-graf-500"> · {e.area}</span>}
                                  </div>
                                  </div>
                                  </div>
                                </td>

                                <td className="tabular px-3 py-2.5 text-right">
                                  {e.visitas || <span className="text-graf-600">—</span>}
                                </td>
                                <td className="tabular px-3 py-2.5 text-right text-graf-400">
                                  {e.ordens || <span className="text-graf-600">—</span>}
                                </td>

                                <td className="px-3 py-2.5">
                                  {e.periodos?.length ? (
                                    <div className="space-y-0.5">
                                      {e.periodos.map(p => (
                                        <div key={p.janela} className="tabular text-[11px] text-graf-300">
                                          {p.janela}
                                          <span className="ml-1 text-graf-500">({p.qtd})</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : <span className="text-graf-600">—</span>}
                                </td>

                                <td className="px-3 py-2.5">
                                  {e.situacoes?.length ? (
                                    <div className="flex flex-wrap gap-1">
                                      {e.situacoes.map(s => (
                                        <span key={s.situacao} className="pill text-[10px]"
                                          style={{ ['--pill-cor' as string]:
                                            SITUACAO_INFO[s.situacao]?.cor ?? '#64748b' }}>
                                          {SITUACAO_INFO[s.situacao]?.label ?? s.situacao} ({s.qtd})
                                        </span>
                                      ))}
                                    </div>
                                  ) : <span className="text-graf-600">—</span>}
                                </td>

                                <td className="px-3 py-2.5 text-xs">
                                  {e.ocioso ? (
                                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5
                                                     font-semibold text-amber-300">
                                      OCIOSO {e.minutos_parada}min
                                    </span>
                                  ) : e.ultima_atividade ? (
                                    <span className="tabular text-graf-400">
                                      {hora(e.ultima_atividade)}
                                      {e.situacao_final && (
                                        <span className="ml-1.5 text-graf-500">
                                          {SITUACAO_INFO[e.situacao_final]?.label}
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-graf-600">sem encerramento</span>
                                  )}
                                </td>
                              </tr>

                              {exp && (
                                <tr className="border-b border-graf-800 bg-graf-900">
                                  <td colSpan={7} className="px-3 py-3">
                                    {carregandoDetalhe === e.equipe_id ? (
                                      <p className="text-xs text-graf-400">Carregando contratos…</p>
                                    ) : (detalhe[e.equipe_id]?.length ?? 0) === 0 ? (
                                      <p className="text-xs text-graf-500">
                                        Nenhum contrato para esta equipe em{' '}
                                        {new Date(data + 'T12:00').toLocaleDateString('pt-BR')}.
                                      </p>
                                    ) : (
                                      <div className="space-y-1.5">
                                        {detalhe[e.equipe_id].map(v => (
                                          <ContratoCard key={v.id} v={v} />
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
              ))}
            </div>
          )
        ) : (
          <section className="card-controle overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-700 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Matrícula</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Equipe</th>
                    <th className="px-3 py-2 font-medium">Área</th>
                    <th className="px-3 py-2 font-medium">Supervisor</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {tecFiltrados.map(t => (
                    <tr key={t.id} className="border-b border-graf-800 hover:bg-graf-850">
                      <td className="tabular px-3 py-2 font-medium">{t.matricula}</td>
                      <td className="px-3 py-2 text-graf-300">{t.nome}</td>
                      <td className="px-3 py-2 text-xs text-graf-400">
                        {t.equipe?.codigo ?? <span className="text-af-400">sem equipe</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-graf-400">
                        {t.equipe?.area?.apelido ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-graf-400">
                        {t.equipe?.supervisor_nome ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={t.situacao === 'ATIVO' ? 'text-emerald-400' : 'text-graf-500'}>
                          {t.situacao.toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="pb-6 text-center text-xs text-graf-600">
          {aba === 'equipes'
            ? `${eqFiltradas.length} de ${painel.length} equipes${
                data ? ' · ' + new Date(data + 'T12:00').toLocaleDateString('pt-BR') : ''}`
            : `${tecFiltrados.length} de ${tecnicos.length} técnicos`}
          {aba === 'equipes' && !ehHoje &&
            ' · OCIOSO só é calculado para o dia corrente'}
        </p>
      </div>
    </Shell>
  )
}

/** Um contrato da equipe, com as O.S. agrupadas dentro dele. */
function ContratoCard({ v }: { v: VisitaLinha }) {
  const navegar = useNavigate()
  const endereco = [v.logradouro, v.complemento, v.bairro].filter(Boolean).join(', ')
  const baixa = v.ordem_servico.find(o => o.codigo_baixa)?.codigo_baixa ?? null
  const janela = hhmm(v.janela_inicio)
    ? `${hhmm(v.janela_inicio)}–${hhmm(v.janela_fim) ?? '?'}`
    : 'sem janela'

  return (
    // O cartao inteiro abre o contrato — o botao "abrir" era ruido.
    <div onClick={() => navegar(`/controle/visita/${v.id}`)}
         title="Abrir o contrato"
         className="cursor-pointer rounded-lg border border-graf-800 bg-graf-850
                    transition hover:border-af-700/60 hover:bg-graf-800">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-graf-800 px-3 py-2">
        <Pill situacao={v.situacao} />
        <span className="tabular text-xs font-medium">{v.contrato ?? 'sem contrato'}</span>
        <span className="text-xs text-graf-400">
          {v.tipo_servico?.nome ?? '—'}
          {v.tipo_atividade?.nome && (
            <span className="text-graf-500"> · {v.tipo_atividade.nome}</span>
          )}
        </span>
        <span className="tabular ml-auto text-xs text-graf-400">{janela}</span>
        {v.fim && <span className="tabular text-xs text-graf-500">encerrou {hora(v.fim)}</span>}
        {v.bloqueado_em && (
          <span title="Tocada pelo campo — o TOA não sobrescreve mais"
                className="text-[10px] text-af-400">●</span>
        )}
      </div>

      <div className="px-3 py-2">
        <p className="text-xs text-graf-300">
          {endereco || <span className="text-graf-600">sem endereço</span>}
          {v.wo_numero && <span className="tabular ml-2 text-graf-500">WO {v.wo_numero}</span>}
        </p>

        {v.ordem_servico.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-graf-600">
            Sem O.S. — apontamento de jornada.
          </p>
        ) : (
          <div className="mt-1.5 space-y-1">
            {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
              <div key={o.id}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                <span className="tabular text-graf-600">#{o.sequencia}</span>
                <span className="tabular font-medium text-graf-200">{o.numero_os ?? '—'}</span>
                <span className="text-graf-400">
                  {o.tipo_os ? `${o.tipo_os.codigo} · ${o.tipo_os.descricao}` : '—'}
                </span>
                {o.status_operadora && (
                  <span className="rounded bg-graf-800 px-1.5 py-0.5 text-graf-400">
                    {o.status_operadora}
                  </span>
                )}
                {o.codigo_baixa && (
                  <span className={`ml-auto rounded px-1.5 py-0.5 font-medium ${
                    o.codigo_baixa.natureza === 'SUCESSO'
                      ? 'bg-emerald-900/40 text-emerald-300'
                      : o.codigo_baixa.natureza === 'IMPRODUTIVA'
                      ? 'bg-af-900/40 text-af-300'
                      : 'bg-graf-800 text-graf-400'}`}>
                    {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {!baixa && EM_ABERTO.includes(v.situacao) && (
          <p className="mt-1.5 text-[11px] text-graf-600">Ainda sem código de baixa.</p>
        )}
      </div>
    </div>
  )
}
