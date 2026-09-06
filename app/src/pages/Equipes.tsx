import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { lerPlanilha } from '../lib/planilha'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

interface EquipeResumo {
  id: string; codigo: string; nome: string; ativo: boolean
  supervisor_nome: string | null; supervisor: string | null
  area: string | null; area_codigo: string | null
  tecnicos: number
  visitas_hoje: number; concluidas_hoje: number; abertas_hoje: number
  ultima_atividade: string | null
}
interface Tec {
  id: string; matricula: string; nome: string; situacao: string
  equipe: { codigo: string; nome: string; supervisor_nome: string | null
            area: { apelido: string | null } | null } | null
}
interface Orfao {
  matricula: string; visitas: number
  primeira: string; ultima: string; equipes_sugeridas: string | null
}

const COLUNAS = ['LOGIN', 'NOME DO TÉCNICO', 'EQUIPE', 'SUPERVISOR', 'ÁREA']

export default function Equipes() {
  const [aba, setAba] = useState<'equipes' | 'tecnicos'>('equipes')
  const [equipes, setEquipes] = useState<EquipeResumo[]>([])
  const [tecnicos, setTecnicos] = useState<Tec[]>([])
  const [orfaos, setOrfaos] = useState<Orfao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // filtros
  const [busca, setBusca] = useState('')
  const [area, setArea] = useState('TODAS')
  const [supervisor, setSupervisor] = useState('TODOS')
  const [soAtivas, setSoAtivas] = useState(false)
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

  async function recarregar() {
    setCarregando(true); setErro(null)
    const [e, t, o] = await Promise.all([
      supabase.from('vw_equipe_resumo').select('*').order('codigo'),
      supabase.from('tecnico')
        .select(`id, matricula, nome, situacao,
                 equipe:equipe_id ( codigo, nome, supervisor_nome,
                                    area:area_id ( apelido ) )`)
        .order('matricula'),
      supabase.rpc('tecnicos_nao_cadastrados'),
    ])
    if (e.error) setErro(e.error.message)
    else setEquipes((e.data ?? []) as unknown as EquipeResumo[])
    if (t.data) setTecnicos(t.data as unknown as Tec[])
    if (o.data) setOrfaos(o.data as Orfao[])
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [])

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
        const { data, error } = await supabase.rpc('importar_equipes',
          { p_linhas: previa.slice(i, i + LOTE) })
        if (error) throw new Error(error.message)
        ultimo = data as Record<string, unknown>
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
    const { data, error } = await supabase.rpc('cadastrar_tecnico_avulso', {
      p_matricula: matricula,
      p_nome: nomeNovo || matricula,
      p_equipe_id: equipeNova || null,
    })
    if (error) setErro(error.message)
    else {
      const r = data as { visitas_religadas: number }
      setOk(`${matricula} cadastrado. ${r.visitas_religadas} visitas religadas a ele.`)
      setCadastrando(null); setNomeNovo(''); setEquipeNova('')
      await recarregar()
    }
    setOcupado(false)
  }

  const areas = useMemo(() =>
    [...new Set(equipes.map(e => e.area).filter(Boolean) as string[])].sort(), [equipes])
  const supervisores = useMemo(() =>
    [...new Set(equipes.map(e => e.supervisor).filter(Boolean) as string[])].sort(), [equipes])

  const eqFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return equipes.filter(e => {
      if (area !== 'TODAS' && e.area !== area) return false
      if (supervisor !== 'TODOS' && e.supervisor !== supervisor) return false
      if (soAtivas && e.visitas_hoje === 0) return false
      if (!t) return true
      return [e.codigo, e.nome, e.supervisor_nome, e.area].some(x => x?.toLowerCase().includes(t))
    })
  }, [equipes, busca, area, supervisor, soAtivas])

  const grupos = useMemo(() => {
    if (agrupar === 'nenhum') return [{ titulo: '', itens: eqFiltradas }]
    const m = new Map<string, EquipeResumo[]>()
    for (const e of eqFiltradas) {
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

  const semTecnico = equipes.filter(e => e.tecnicos === 0).length
  const totalOrfaos = orfaos.reduce((s, o) => s + o.visitas, 0)

  return (
    <Shell acoes={
      <button onClick={() => inputRef.current?.click()}
        className="rounded-md bg-af-600 px-3 py-1 text-xs font-medium text-white hover:bg-af-500">
        Importar planilha
      </button>
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
                          {equipes.map(e => (
                            <option key={e.id} value={e.id}>{e.codigo} · {e.area ?? '—'}</option>
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
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([
            ['Equipes', equipes.length, false],
            ['Técnicos', tecnicos.length, false],
            ['Supervisores', supervisores.length, false],
            ['Equipes sem técnico', semTecnico, semTecnico > 0],
            ['Fora do cadastro', orfaos.length, orfaos.length > 0],
          ] as [string, number, boolean][]).map(([r, v, alerta]) => (
            <div key={r} className={`card-controle px-3.5 py-3 ${alerta ? 'ring-1 ring-af-600/50' : ''}`}>
              <div className="tabular text-2xl font-semibold leading-none"
                   style={alerta ? { color: 'var(--st-conflito)' } : undefined}>{v}</div>
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
                  {a === 'equipes' ? equipes.length : tecnicos.length}
                </span>
              </button>
            ))}
          </div>

          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar código, nome, matrícula, supervisor…"
            className="min-w-56 flex-1 rounded-md border border-graf-700 bg-graf-900 px-3 py-1.5
                       text-sm outline-none placeholder-graf-500 focus:border-af-500" />

          <select value={area} onChange={e => setArea(e.target.value)}
            className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs">
            <option value="TODAS">Todas as áreas</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          {aba === 'equipes' && (
            <>
              <select value={supervisor} onChange={e => setSupervisor(e.target.value)}
                className="max-w-52 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs">
                <option value="TODOS">Todos os supervisores</option>
                {supervisores.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={agrupar} onChange={e => setAgrupar(e.target.value as typeof agrupar)}
                className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs">
                <option value="nenhum">Sem agrupamento</option>
                <option value="supervisor">Agrupar por supervisor</option>
                <option value="area">Agrupar por área</option>
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
                <input type="checkbox" checked={soAtivas}
                  onChange={e => setSoAtivas(e.target.checked)} className="accent-af-600" />
                Só com serviço hoje
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
                descricao={equipes.length === 0
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
                        {g.itens.length} equipe(s) · {g.itens.reduce((s, e) => s + e.tecnicos, 0)} técnicos
                      </span>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-graf-700 bg-graf-900 text-left
                                        text-[11px] uppercase tracking-wide text-graf-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Equipe</th>
                          <th className="px-3 py-2 font-medium">Área</th>
                          {agrupar !== 'supervisor' &&
                            <th className="px-3 py-2 font-medium">Supervisor</th>}
                          <th className="px-3 py-2 text-right font-medium">Técnicos</th>
                          <th className="px-3 py-2 text-right font-medium">Hoje</th>
                          <th className="px-3 py-2 text-right font-medium">Concl.</th>
                          <th className="px-3 py-2 text-right font-medium">Abertas</th>
                          <th className="px-3 py-2 font-medium">Última atividade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.itens.map(e => (
                          <tr key={e.id} className="border-b border-graf-800 hover:bg-graf-850">
                            <td className="px-3 py-2">
                              <span className="tabular font-medium">{e.codigo}</span>
                              {e.tecnicos === 0 && (
                                <span className="ml-2 rounded bg-af-900/40 px-1.5 py-0.5
                                                 text-[10px] font-semibold text-af-300">
                                  sem técnico
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-graf-400">{e.area ?? '—'}</td>
                            {agrupar !== 'supervisor' && (
                              <td className="px-3 py-2 text-xs text-graf-300">
                                {e.supervisor ?? <span className="text-graf-600">—</span>}
                              </td>
                            )}
                            <td className="tabular px-3 py-2 text-right">{e.tecnicos}</td>
                            <td className="tabular px-3 py-2 text-right">{e.visitas_hoje || '—'}</td>
                            <td className="tabular px-3 py-2 text-right text-emerald-400">
                              {e.concluidas_hoje || '—'}
                            </td>
                            <td className="tabular px-3 py-2 text-right text-sky-400">
                              {e.abertas_hoje || '—'}
                            </td>
                            <td className="px-3 py-2 text-xs text-graf-500">
                              {e.ultima_atividade
                                ? new Date(e.ultima_atividade + 'T12:00').toLocaleDateString('pt-BR')
                                : 'nunca'}
                            </td>
                          </tr>
                        ))}
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
            ? `${eqFiltradas.length} de ${equipes.length} equipes`
            : `${tecFiltrados.length} de ${tecnicos.length} técnicos`}
        </p>
      </div>
    </Shell>
  )
}
