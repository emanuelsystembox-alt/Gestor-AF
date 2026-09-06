import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { lerPlanilha } from '../lib/planilha'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

interface Tec {
  id: string; matricula: string; nome: string; situacao: string
  equipe: { codigo: string; nome: string; supervisor_nome: string | null
            area: { codigo: string; apelido: string | null } | null } | null
}
interface Eq {
  id: string; codigo: string; nome: string; ativo: boolean
  supervisor_nome: string | null
  area: { codigo: string; apelido: string | null } | null
  tecnico: { id: string }[]
}

const COLUNAS_ESPERADAS = ['LOGIN', 'NOME DO TÉCNICO', 'EQUIPE', 'SUPERVISOR', 'ÁREA']

export default function Equipes() {
  const [aba, setAba] = useState<'equipes' | 'tecnicos'>('equipes')
  const [equipes, setEquipes] = useState<Eq[]>([])
  const [tecnicos, setTecnicos] = useState<Tec[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // importação
  const inputRef = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<Record<string, string>[] | null>(null)
  const [faltando, setFaltando] = useState<string[]>([])
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  async function recarregar() {
    setCarregando(true); setErro(null)
    const [e, t] = await Promise.all([
      supabase.from('equipe')
        .select('id, codigo, nome, ativo, supervisor_nome, area:area_id(codigo, apelido), tecnico(id)')
        .order('codigo'),
      supabase.from('tecnico')
        .select(`id, matricula, nome, situacao,
                 equipe:equipe_id ( codigo, nome, supervisor_nome,
                                    area:area_id ( codigo, apelido ) )`)
        .order('matricula'),
    ])
    if (e.error) setErro(e.error.message)
    else setEquipes((e.data ?? []) as unknown as Eq[])
    if (t.data) setTecnicos(t.data as unknown as Tec[])
    setCarregando(false)
  }

  useEffect(() => { recarregar() }, [])

  async function receber(f: File) {
    setErro(null); setResultado(null)
    try {
      const r = await lerPlanilha(f, 'Equipes')
      const falta = COLUNAS_ESPERADAS.filter(c => !r.cabecalhos.includes(c))
      setFaltando(falta)
      setPrevia(r.linhas)
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui ler a planilha.')
    }
  }

  async function importar() {
    if (!previa) return
    setImportando(true); setErro(null)
    try {
      // lotes: 604 linhas num payload só estoura o limite da requisição
      const LOTE = 200
      let ultimo: Record<string, unknown> = {}
      for (let i = 0; i < previa.length; i += LOTE) {
        const { data, error } = await supabase.rpc('importar_equipes', {
          p_linhas: previa.slice(i, i + LOTE),
        })
        if (error) throw new Error(error.message)
        ultimo = data as Record<string, unknown>
      }
      const { data: religadas } = await supabase.rpc('religar_visitas_equipe')
      setResultado(
        `${ultimo.equipes} equipes e ${ultimo.tecnicos} técnicos no cadastro. ` +
        `${religadas ?? 0} visitas já importadas foram religadas à sua equipe.` +
        (Number(ultimo.erros) ? ` ${ultimo.erros} linha(s) com erro.` : ''))
      setPrevia(null)
      if (inputRef.current) inputRef.current.value = ''
      await recarregar()
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Falha ao importar.')
    } finally { setImportando(false) }
  }

  const eqFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return equipes
    return equipes.filter(e => [e.codigo, e.nome, e.supervisor_nome, e.area?.codigo]
      .some(x => x?.toLowerCase().includes(t)))
  }, [equipes, busca])

  const tecFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return tecnicos
    return tecnicos.filter(x => [x.matricula, x.nome, x.equipe?.codigo, x.equipe?.supervisor_nome]
      .some(y => y?.toLowerCase().includes(t)))
  }, [tecnicos, busca])

  const semEquipe = tecnicos.filter(t => !t.equipe).length
  const supervisores = useMemo(() =>
    [...new Set(equipes.map(e => e.supervisor_nome).filter(Boolean) as string[])].length,
    [equipes])

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Equipes e técnicos</h1>
            <p className="mt-0.5 text-sm text-graf-400">
              Sem este cadastro a visita chega sem dono: o despacho, a
              produtividade por equipe e a agenda do técnico ficam vazios.
            </p>
          </div>
          <button onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-af-600 px-4 py-2 text-sm font-medium text-white hover:bg-af-500">
            Importar planilha de equipes
          </button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) receber(f) }} />
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {resultado && <Alerta tipo="ok">{resultado}</Alerta>}

        {/* ---------- prévia da importação ---------- */}
        {previa && (
          <section className="card-controle space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">Prévia da importação</h2>
              <button onClick={() => setPrevia(null)}
                className="text-sm text-graf-400 hover:text-af-400">Cancelar</button>
            </div>

            <p className="text-sm text-graf-300">
              <strong className="tabular text-lg">{previa.length}</strong> linhas lidas.
              Equipe e técnico já existentes são <strong>atualizados</strong>, não duplicados.
            </p>

            {faltando.length > 0 && (
              <Alerta tipo="aviso">
                Colunas esperadas que não encontrei: <strong>{faltando.join(', ')}</strong>.
                A planilha certa é a <code>equipes-manaus.xlsx</code>, aba <code>Equipes</code>.
              </Alerta>
            )}

            <div className="overflow-x-auto rounded-md border border-graf-800">
              <table className="w-full text-xs">
                <thead className="bg-graf-900 text-left text-graf-400">
                  <tr>{COLUNAS_ESPERADAS.map(c => <th key={c} className="px-2 py-1.5">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {previa.slice(0, 5).map((l, i) => (
                    <tr key={i} className="border-t border-graf-800">
                      {COLUNAS_ESPERADAS.map(c => (
                        <td key={c} className="px-2 py-1.5 text-graf-300">{l[c] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={importar} disabled={importando || faltando.length > 0}
              className="toque rounded-lg bg-af-600 px-6 font-semibold text-white
                         hover:bg-af-500 disabled:opacity-50">
              {importando ? 'Importando…' : `Importar ${previa.length} linhas`}
            </button>
          </section>
        )}

        {/* ---------- resumo ---------- */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Equipes', equipes.length],
            ['Técnicos', tecnicos.length],
            ['Supervisores', supervisores],
            ['Técnicos sem equipe', semEquipe],
          ].map(([r, v]) => (
            <div key={r as string}
              className={`card-controle px-3.5 py-3 ${
                r === 'Técnicos sem equipe' && Number(v) > 0 ? 'ring-1 ring-af-600/50' : ''}`}>
              <div className="tabular text-2xl font-semibold leading-none">{v as number}</div>
              <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
                {r as string}
              </div>
            </div>
          ))}
        </section>

        {/* ---------- abas + busca ---------- */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-graf-900 p-0.5">
            {(['equipes', 'tecnicos'] as const).map(a => (
              <button key={a} onClick={() => setAba(a)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                  aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                {a === 'equipes' ? 'Equipes' : 'Técnicos'}
                <span className="tabular ml-1.5 opacity-60">
                  {a === 'equipes' ? equipes.length : tecnicos.length}
                </span>
              </button>
            ))}
          </div>
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar código, nome, matrícula, supervisor, área…"
            className="min-w-64 flex-1 rounded-md border border-graf-700 bg-graf-900 px-3 py-1.5
                       text-sm outline-none placeholder-graf-500 focus:border-af-500" />
        </div>

        {/* ---------- tabelas ---------- */}
        <section className="card-controle overflow-hidden">
          {carregando ? (
            <p className="py-12 text-center text-graf-400">Carregando…</p>
          ) : (aba === 'equipes' ? equipes : tecnicos).length === 0 ? (
            <Vazio
              titulo="Cadastro vazio"
              descricao="Importe a planilha equipes-manaus.xlsx para popular equipes e técnicos de uma vez."
            />
          ) : aba === 'equipes' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-700 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Código</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Área</th>
                    <th className="px-3 py-2 font-medium">Supervisor</th>
                    <th className="px-3 py-2 text-right font-medium">Técnicos</th>
                  </tr>
                </thead>
                <tbody>
                  {eqFiltradas.map(e => (
                    <tr key={e.id} className="border-b border-graf-800 hover:bg-graf-850">
                      <td className="tabular px-3 py-2 font-medium">{e.codigo}</td>
                      <td className="px-3 py-2 text-graf-300">{e.nome}</td>
                      <td className="px-3 py-2 text-xs text-graf-400">
                        {e.area ? `${e.area.apelido ?? ''} · ${e.area.codigo}` :
                          <span className="text-graf-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-graf-300">
                        {e.supervisor_nome ?? <span className="text-graf-600">—</span>}
                      </td>
                      <td className="tabular px-3 py-2 text-right">{e.tecnico?.length ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-700 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Matrícula</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Equipe</th>
                    <th className="px-3 py-2 font-medium">Área</th>
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
          )}
        </section>

        <p className="pb-6 text-center text-xs text-graf-600">
          {aba === 'equipes'
            ? `${eqFiltradas.length} de ${equipes.length} equipes`
            : `${tecFiltrados.length} de ${tecnicos.length} técnicos`}
        </p>
      </div>
    </Shell>
  )
}
