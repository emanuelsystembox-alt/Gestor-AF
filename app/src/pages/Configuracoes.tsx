import { useEffect, useMemo, useState } from 'react'
import { supabase, SITUACOES } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

/**
 * Configurações da operação.
 *
 * Duas coisas que no sistema atual são cadastro e aqui viviam no código:
 *
 * - **Status** (`situacao_visita`): rótulo, cor, fundo, ordem e o tempo
 *   de alerta. É a lista que o técnico vê ao baixar o contrato.
 * - **Indicadores de qualidade** (`indicador_qualidade`): O.S DIGITAL,
 *   GEOLOCALIZAÇÃO, CERTIDÃO… com meta e peso. São eles que viram os
 *   **marcadores** que o analista aponta no contrato do técnico.
 *
 * A permissão real é do banco: as duas tabelas só aceitam escrita de
 * quem tem papel ADMIN (migration 025). A tela não é a barreira.
 */

interface Situacao {
  codigo: string; label: string; cor: string; cor_fundo: string | null
  icone: string | null; ordem: number
  em_aberto: boolean; terminal: boolean
  minutos_alerta: number | null; ativo: boolean
}

interface Indicador {
  id: string; nome: string; meta: number; peso: number
  descricao: string | null; ordem: number; ativo: boolean
}

/** Regra de pontuação: combinação de O.S. x edificação x tipo de pessoa. */
interface Regra {
  id: string
  edificacao: string
  tipo_pessoa: string
  pontos_claro: number | null
  pontos_equipe: number | null
  observacao: string | null
  ativo: boolean
  combinacao: { assinatura: string; qtd_os: number; atendimentos: number } | null
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs ' +
              'outline-none focus:border-af-500'

/** O que cada codigo de baixa significa para a situacao do contrato.
 *  ANALISE = derivado do analitico do ngestor; CADASTRO = alguem
 *  digitou aqui. A diferenca fica na tela porque importa (D-097). */
interface CodigoBaixa {
  id: string
  codigo: number
  descricao: string
  natureza: string | null
  situacao_destino: string | null
  situacao_origem: 'ANALISE' | 'CADASTRO' | null
}

export default function Configuracoes() {
  const [aba, setAba] = useState<'status' | 'indicadores' | 'pontuacao' | 'baixa'>('status')
  const [codigos, setCodigos] = useState<CodigoBaixa[]>([])
  const [buscaCodigo, setBuscaCodigo] = useState('')
  const [soSemDestino, setSoSemDestino] = useState(false)
  const [baixaAuto, setBaixaAuto] = useState<boolean | null>(null)
  const [regras, setRegras] = useState<Regra[]>([])
  const [totalRegras, setTotalRegras] = useState(0)
  const [buscaRegra, setBuscaRegra] = useState('')
  const [soConferir, setSoConferir] = useState(false)
  const [situacoes, setSituacoes] = useState<Situacao[]>([])
  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // edição
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, unknown>>({})

  // novo indicador
  const [novoNome, setNovoNome] = useState('')
  const [novaMeta, setNovaMeta] = useState('100')
  const [novoPeso, setNovoPeso] = useState('1')

  async function recarregar() {
    setCarregando(true); setErro(null)
    const [s, i, cb, pa] = await Promise.all([
      supabase.from('situacao_visita').select('*').order('ordem'),
      supabase.from('indicador_qualidade').select('*').order('ordem'),
      supabase.from('codigo_baixa')
        .select('id, codigo, descricao, natureza, situacao_destino, situacao_origem')
        .order('codigo'),
      supabase.rpc('ler_parametro', { p_chave: 'baixa_automatica' }),
    ])
    if (s.error) setErro(s.error.message)
    else setSituacoes((s.data ?? []) as Situacao[])
    if (i.data) setIndicadores(i.data as Indicador[])
    setCodigos((cb.data ?? []) as CodigoBaixa[])
    setBaixaAuto(pa.data === true)
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [])

  // As regras são ~1.000; carrega sob demanda e por busca.
  useEffect(() => {
    if (aba !== 'pontuacao') return
    let q = supabase.from('regra_pontuacao')
      .select(`id, edificacao, tipo_pessoa, pontos_claro, pontos_equipe,
               observacao, ativo,
               combinacao:combinacao_id ( assinatura, qtd_os, atendimentos )`,
              { count: 'exact' })
    if (soConferir) q = q.not('observacao', 'is', null)
    q.order('pontos_claro', { ascending: false, nullsFirst: false }).limit(120)
      .then(({ data, count, error }) => {
        if (error) { setErro(error.message); return }
        setRegras((data ?? []) as unknown as Regra[])
        setTotalRegras(count ?? 0)
      })
  }, [aba, soConferir])

  /** Declarar o que a baixa significa. Vira CADASTRO e deixa de ser
   *  analise -- o que a pessoa diz vale mais que o que eu deduzi. */
  async function definirDestino(c: CodigoBaixa, situacao: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_situacao_do_codigo', {
      p_codigo: c.codigo, p_situacao: situacao || null,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setCodigos(l => l.map(x => x.codigo === c.codigo
        ? { ...x, situacao_destino: situacao || null,
            situacao_origem: situacao ? 'CADASTRO' : null }
        : x))
      setOk(`${c.codigo} · ${c.descricao} → ${situacao || 'sem destino'}.`)
    }
    setOcupado(false)
  }

  async function ligarBaixaAuto(ligar: boolean) {
    if (ligar && !confirm(
      'Ligar a baixa automática?\n\n'
      + 'A partir da próxima importação, o sistema muda a situação do contrato '
      + 'sozinho, pelo código de baixa que vier do TOA. Contrato tocado pelo campo '
      + 'não é sobrescrito, e cada mudança fica no histórico.')) return
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_parametro', {
      p_chave: 'baixa_automatica', p_valor: ligar,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setBaixaAuto(ligar)
      setOk(ligar
        ? 'Baixa automática ligada. Vale a partir da próxima importação.'
        : 'Baixa automática desligada. Quem baixa é o técnico, na tela de campo.')
    }
    setOcupado(false)
  }

  const codigosFiltrados = useMemo(() => {
    const t = buscaCodigo.trim().toLowerCase()
    return codigos.filter(c => {
      if (soSemDestino && c.situacao_destino) return false
      if (!t) return true
      return String(c.codigo).includes(t) || c.descricao.toLowerCase().includes(t)
    })
  }, [codigos, buscaCodigo, soSemDestino])

  const semDestino = codigos.filter(c => !c.situacao_destino).length

  async function salvarRegra(id: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.from('regra_pontuacao').update(rascunho).eq('id', id)
    if (error) setErro(traduzir(error.message))
    else {
      setOk('Regra atualizada. Toda alteração fica no log, com de/para e autor.')
      setEditando(null); setRascunho({})
      setRegras(rs => rs.map(r => r.id === id ? { ...r, ...(rascunho as Partial<Regra>) } : r))
    }
    setOcupado(false)
  }

  async function salvarSituacao(codigo: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.from('situacao_visita')
      .update(rascunho).eq('codigo', codigo)
    if (error) setErro(traduzir(error.message))
    else { setOk(`Status "${codigo}" atualizado. Recarregue para ver a cor nova nas listas.`)
           setEditando(null); setRascunho({}); await recarregar() }
    setOcupado(false)
  }

  async function salvarIndicador(id: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.from('indicador_qualidade')
      .update(rascunho).eq('id', id)
    if (error) setErro(traduzir(error.message))
    else { setOk('Indicador atualizado.'); setEditando(null); setRascunho({}); await recarregar() }
    setOcupado(false)
  }

  async function criarIndicador() {
    if (!novoNome.trim()) return
    setOcupado(true); setErro(null); setOk(null)
    const { data: emp } = await supabase.from('empresa').select('id').maybeSingle()
    const { error } = await supabase.from('indicador_qualidade').insert({
      empresa_id: (emp as { id: string } | null)?.id ?? null,
      nome: novoNome.trim().toUpperCase(),
      meta: Number(novaMeta) || 100,
      peso: Number(novoPeso) || 1,
      ordem: (indicadores.at(-1)?.ordem ?? 0) + 1,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setOk(`Indicador "${novoNome.trim().toUpperCase()}" criado.`)
      setNovoNome(''); setNovaMeta('100'); setNovoPeso('1')
      await recarregar()
    }
    setOcupado(false)
  }

  async function alternarAtivo(i: Indicador) {
    setOcupado(true); setErro(null)
    const { error } = await supabase.from('indicador_qualidade')
      .update({ ativo: !i.ativo }).eq('id', i.id)
    if (error) setErro(traduzir(error.message))
    else await recarregar()
    setOcupado(false)
  }

  /** Erro de RLS chega como texto do Postgres; vira frase de gente. */
  function traduzir(msg: string): string {
    if (/row-level security|violates|permission denied/i.test(msg))
      return 'Seu usuário não tem papel ADMIN — só ele pode alterar cadastro. ' +
             '(a barreira é do banco, não da tela)'
    return msg
  }

  const semCadastro = SITUACOES.filter(s => !situacoes.some(x => x.codigo === s))

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Configurações</h1>
          <p className="mt-1 max-w-2xl text-sm text-graf-400">
            O que a operação ajusta sem recompilar nada. A permissão de
            escrita é do banco: só papel <strong>ADMIN</strong> grava aqui.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        <div className="flex rounded-lg bg-graf-900 p-0.5">
          {([['status', 'Status', situacoes.length],
             ['baixa', 'Baixa e situação', codigos.length],
             ['indicadores', 'Indicadores de qualidade', indicadores.length],
             ['pontuacao', 'Pontuação', totalRegras]] as const).map(
            ([a, rot, n]) => (
              <button key={a} onClick={() => { setAba(a); setEditando(null) }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                {rot}<span className="tabular ml-1.5 opacity-60">{n}</span>
              </button>
            ))}
        </div>

        {carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : aba === 'status' ? (
          <section className="card-controle overflow-hidden">
            <div className="border-b border-graf-800 px-4 py-3">
              <h2 className="text-sm font-semibold">Status do atendimento</h2>
              <p className="mt-1 text-xs text-graf-400">
                É a lista que o técnico vê ao baixar o contrato, e a cor que a
                operação inteira usa. <strong>O código não se edita</strong> —
                ele vem do TOA e mudar quebraria a importação.
              </p>
            </div>

            {semCadastro.length > 0 && (
              <div className="px-4 py-3">
                <Alerta tipo="aviso">
                  Situações que o sistema usa e não estão no cadastro:{' '}
                  <strong>{semCadastro.join(', ')}</strong>. Elas aparecem com a cor
                  padrão até serem cadastradas.
                </Alerta>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Código</th>
                    <th className="px-3 py-2 font-medium">Rótulo</th>
                    <th className="px-3 py-2 font-medium">Cor</th>
                    <th className="px-3 py-2 font-medium">Fundo</th>
                    <th className="px-3 py-2 text-right font-medium">Ordem</th>
                    <th className="px-3 py-2 text-right font-medium">Alerta (min)</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {situacoes.map(s => {
                    const ed = editando === s.codigo
                    return (
                      <tr key={s.codigo} className="border-b border-graf-800">
                        <td className="px-3 py-2">
                          <span className="pill text-[10px]"
                                style={{ ['--pill-cor' as string]: s.cor }}>
                            {s.codigo}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {ed ? (
                            <input defaultValue={s.label} className={`${campo} w-40`}
                              onChange={e => setRascunho(r => ({ ...r, label: e.target.value }))} />
                          ) : s.label}
                        </td>
                        <td className="px-3 py-2">
                          {ed ? (
                            <input defaultValue={s.cor} className={`${campo} w-24`}
                              onChange={e => setRascunho(r => ({ ...r, cor: e.target.value }))} />
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block h-3 w-3 rounded"
                                    style={{ background: s.cor }} />
                              <code className="text-xs text-graf-400">{s.cor}</code>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {ed ? (
                            <input defaultValue={s.cor_fundo ?? ''} className={`${campo} w-24`}
                              onChange={e => setRascunho(r => ({ ...r, cor_fundo: e.target.value }))} />
                          ) : s.cor_fundo ? (
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block h-3 w-3 rounded"
                                    style={{ background: s.cor_fundo }} />
                              <code className="text-xs text-graf-400">{s.cor_fundo}</code>
                            </span>
                          ) : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {ed ? (
                            <input type="number" defaultValue={s.ordem} className={`${campo} w-16 text-right`}
                              onChange={e => setRascunho(r => ({ ...r, ordem: Number(e.target.value) }))} />
                          ) : s.ordem}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {ed ? (
                            <input type="number" defaultValue={s.minutos_alerta ?? ''}
                              className={`${campo} w-16 text-right`}
                              onChange={e => setRascunho(r => ({
                                ...r, minutos_alerta: e.target.value === '' ? null : Number(e.target.value),
                              }))} />
                          ) : s.minutos_alerta ?? <span className="text-graf-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {s.terminal ? 'encerra' : s.em_aberto ? 'em aberto' : 'intermediário'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {ed ? (
                            <span className="flex justify-end gap-1.5">
                              <button disabled={ocupado} onClick={() => salvarSituacao(s.codigo)}
                                className="rounded bg-af-600 px-2.5 py-1 text-[11px] font-medium
                                           text-white hover:bg-af-500 disabled:opacity-50">
                                Salvar
                              </button>
                              <button onClick={() => { setEditando(null); setRascunho({}) }}
                                className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                           text-graf-400">
                                Cancelar
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => { setEditando(s.codigo); setRascunho({}) }}
                              className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                         text-graf-400 hover:border-af-600 hover:text-af-400">
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : aba === 'baixa' ? (
          <div className="space-y-4">
            {/* ---- o interruptor ---- */}
            <section className="card-controle p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-64 flex-1">
                  <h2 className="font-medium">Baixa automática</h2>
                  <p className="mt-1 text-sm text-graf-400">
                    Quando o TOA traz a baixa, o sistema muda a situação do contrato
                    sozinho — pelo <strong>código</strong>, não pelo status.
                    Desligado, a importação só lê códigos, contratos, deslocamento e
                    execução, e quem baixa é o técnico.
                  </p>
                  <p className="mt-1.5 text-xs text-graf-500">
                    Só vale quando <strong>todas</strong> as O.S. da visita têm código
                    com destino declarado — meia baixa não é baixa. Contrato já tocado
                    pelo campo não é sobrescrito, e cada mudança fica no histórico.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    baixaAuto ? 'bg-emerald-900/40 text-emerald-300'
                              : 'bg-graf-800 text-graf-400'}`}>
                    {baixaAuto ? 'LIGADA' : 'DESLIGADA'}
                  </span>
                  <button disabled={ocupado || baixaAuto === null}
                    onClick={() => ligarBaixaAuto(!baixaAuto)}
                    className={`rounded-md px-4 py-1.5 text-xs font-semibold text-white
                                disabled:opacity-40 ${baixaAuto
                                  ? 'bg-graf-700 hover:bg-graf-600'
                                  : 'bg-af-600 hover:bg-af-500'}`}>
                    {baixaAuto ? 'Desligar' : 'Ligar'}
                  </button>
                </div>
              </div>
              {semDestino > 0 && (
                <p className="mt-3 border-t border-graf-800 pt-2.5 text-xs text-amber-400">
                  <strong>{semDestino}</strong> código(s) ainda sem destino. Visita que
                  tiver um deles não é baixada automaticamente — fica esperando alguém.
                </p>
              )}
            </section>

            {/* ---- o de/para ---- */}
            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-3">
                <h2 className="font-medium">O que cada código significa</h2>
                <p className="mt-1 max-w-3xl text-sm text-graf-400">
                  Derivado de <strong>67.485 linhas</strong> do analítico do sistema
                  atual (meses 06 e 07/2026): 203 dos 206 códigos caem{' '}
                  <strong>sempre</strong> na mesma situação. O que está marcado como
                  <span className="mx-1 rounded bg-graf-800 px-1 text-[10px]
                                   font-semibold uppercase text-graf-400">análise</span>
                  veio daí; o que você mudar aqui vira{' '}
                  <span className="mx-0.5 rounded bg-emerald-900/40 px-1 text-[10px]
                                   font-semibold uppercase text-emerald-300">cadastro</span>
                  e não é mais tocado.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input value={buscaCodigo} onChange={e => setBuscaCodigo(e.target.value)}
                    placeholder="Buscar código ou descrição…"
                    className={`${campo} min-w-64 flex-1`} />
                  <label className="flex items-center gap-1.5 text-xs text-graf-300">
                    <input type="checkbox" checked={soSemDestino}
                      onChange={e => setSoSemDestino(e.target.checked)}
                      className="accent-af-600" />
                    Só os sem destino
                  </label>
                </div>
              </div>

              <div className="max-h-[32rem] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-graf-700 bg-graf-900
                                    text-left text-[11px] uppercase tracking-wide text-graf-400">
                    <tr className="[&>th]:border-r [&>th]:border-graf-500/20
                                   [&>th:last-child]:border-r-0">
                      <th className="px-3 py-2 font-medium">Código</th>
                      <th className="px-3 py-2 font-medium">Descrição</th>
                      <th className="px-3 py-2 font-medium">Natureza</th>
                      <th className="px-3 py-2 font-medium">Leva a</th>
                      <th className="px-3 py-2 font-medium">Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codigosFiltrados.map(c => (
                      <tr key={c.id} className="border-b border-graf-500/25
                                                [&>td]:border-r [&>td]:border-graf-500/15
                                                [&>td:last-child]:border-r-0">
                        <td className="tabular px-3 py-1.5 font-medium">{c.codigo}</td>
                        <td className="px-3 py-1.5 text-graf-300">{c.descricao}</td>
                        <td className="px-3 py-1.5 text-xs text-graf-500">
                          {c.natureza ?? '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          <select value={c.situacao_destino ?? ''} disabled={ocupado}
                            onChange={e => definirDestino(c, e.target.value)}
                            className={`${campo} w-44`}>
                            <option value="">— sem destino —</option>
                            <option value="CONCLUIDA">Concluída</option>
                            <option value="REAGENDAMENTO">Reagendamento</option>
                            <option value="CANCELADA">Cancelada</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          {c.situacao_origem === 'CADASTRO' ? (
                            <span title="Alguém desta operação declarou"
                              className="rounded bg-emerald-900/40 px-1.5 text-[10px]
                                         font-semibold uppercase text-emerald-300">
                              cadastro
                            </span>
                          ) : c.situacao_origem === 'ANALISE' ? (
                            <span title="Derivado do analítico do sistema atual"
                              className="rounded bg-graf-800 px-1.5 text-[10px]
                                         font-semibold uppercase text-graf-400">
                              análise
                            </span>
                          ) : <span className="text-xs text-graf-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-graf-800 px-4 py-2.5 text-xs text-graf-500">
                {codigosFiltrados.length} de {codigos.length} códigos · o status da
                operadora <strong>não</strong> decide a situação: no analítico,
                EXECUTADA virou Reagendamento 1.075 vezes e Cancelado 657. Quem decide
                é o código.
              </p>
            </section>
          </div>

        ) : aba === 'indicadores' ? (
          <section className="space-y-4">
            <div className="card-controle p-4">
              <h2 className="text-sm font-semibold">Novo indicador</h2>
              <p className="mt-1 text-xs text-graf-400">
                O indicador vira um <strong>marcador</strong> disponível para o
                analista apontar no contrato, na tela de Serviços.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Nome</span>
                  <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                    placeholder="TESTE DE VELOCIDADE" className={`${campo} w-56`} />
                </label>
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Meta</span>
                  <input value={novaMeta} onChange={e => setNovaMeta(e.target.value)}
                    className={`${campo} w-20 text-right`} />
                </label>
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Peso</span>
                  <input value={novoPeso} onChange={e => setNovoPeso(e.target.value)}
                    className={`${campo} w-20 text-right`} />
                </label>
                <button onClick={criarIndicador} disabled={ocupado || !novoNome.trim()}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Adicionar
                </button>
              </div>
            </div>

            <div className="card-controle overflow-hidden">
              {indicadores.length === 0 ? (
                <Vazio titulo="Nenhum indicador cadastrado"
                  descricao="Sem indicador não há marcador para o analista apontar." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-graf-800 bg-graf-900 text-left
                                      text-[11px] uppercase tracking-wide text-graf-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Indicador</th>
                        <th className="px-3 py-2 text-right font-medium">Meta</th>
                        <th className="px-3 py-2 text-right font-medium">Peso</th>
                        <th className="px-3 py-2 text-right font-medium">Ordem</th>
                        <th className="px-3 py-2 font-medium">Ativo</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {indicadores.map(i => {
                        const ed = editando === i.id
                        return (
                          <tr key={i.id} className="border-b border-graf-800">
                            <td className="px-3 py-2 font-medium">
                              {ed ? (
                                <input defaultValue={i.nome} className={`${campo} w-56`}
                                  onChange={e => setRascunho(r => ({ ...r, nome: e.target.value }))} />
                              ) : i.nome}
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input defaultValue={i.meta} className={`${campo} w-20 text-right`}
                                  onChange={e => setRascunho(r => ({ ...r, meta: Number(e.target.value) }))} />
                              ) : i.meta}
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input defaultValue={i.peso} className={`${campo} w-20 text-right`}
                                  onChange={e => setRascunho(r => ({ ...r, peso: Number(e.target.value) }))} />
                              ) : i.peso}
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input type="number" defaultValue={i.ordem}
                                  className={`${campo} w-16 text-right`}
                                  onChange={e => setRascunho(r => ({ ...r, ordem: Number(e.target.value) }))} />
                              ) : i.ordem}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => alternarAtivo(i)} disabled={ocupado}
                                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                  i.ativo ? 'bg-emerald-900/40 text-emerald-300'
                                          : 'bg-graf-800 text-graf-500'}`}>
                                {i.ativo ? 'ativo' : 'inativo'}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {ed ? (
                                <span className="flex justify-end gap-1.5">
                                  <button disabled={ocupado} onClick={() => salvarIndicador(i.id)}
                                    className="rounded bg-af-600 px-2.5 py-1 text-[11px] font-medium
                                               text-white hover:bg-af-500 disabled:opacity-50">
                                    Salvar
                                  </button>
                                  <button onClick={() => { setEditando(null); setRascunho({}) }}
                                    className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                               text-graf-400">
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <button onClick={() => { setEditando(i.id); setRascunho({}) }}
                                  className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                             text-graf-400 hover:border-af-600 hover:text-af-400">
                                  Editar
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="text-xs text-graf-500">
              Falta combinar: quais indicadores são <strong>exigidos</strong> por tipo de
              serviço, e se o marcador deve ser cumprido/não cumprido em vez de só
              apontado. Nenhuma das duas foi inventada aqui.
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="card-controle p-4">
              <h2 className="text-sm font-semibold">Tabela de pontuação</h2>
              <p className="mt-1 max-w-3xl text-xs text-graf-400">
                A chave é a <strong>combinação de O.S. do atendimento</strong> mais a
                <strong> edificação</strong>. Foi o que o relatório mensal mostrou: a
                mesma combinação vale 1,4648 em casa e 1,2925 em apartamento — e o
                mesmo valor para pessoa física e jurídica. Das 105 combinações que
                aparecem nas duas edificações, <strong>43 mudam de valor</strong>; das
                43 que aparecem nos dois tipos de pessoa, só 5 mudam.
              </p>
              <p className="mt-2 max-w-3xl text-xs text-graf-500">
                <strong className="text-graf-300">Pontos CLARO</strong> é o que a
                operadora paga. <strong className="text-graf-300">Pontos equipe</strong>{' '}
                é o que a equipe recebe — está vazio porque ainda não foi levantado; a
                diferença entre os dois é a margem por atendimento. Toda alteração aqui
                fica no log com de/para e autor (D-018).
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input value={buscaRegra} onChange={e => setBuscaRegra(e.target.value)}
                  placeholder="Filtrar por combinação de O.S…"
                  className={`${campo} min-w-72 flex-1`} />
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
                  <input type="checkbox" checked={soConferir}
                    onChange={e => setSoConferir(e.target.checked)} className="accent-af-600" />
                  Só as que precisam de conferência
                </label>
                <span className="tabular text-xs text-graf-500">
                  {totalRegras} regras no total
                </span>
              </div>
            </div>

            <div className="card-controle overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-graf-800 bg-graf-900 text-left
                                    text-[11px] uppercase tracking-wide text-graf-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Combinação de O.S.</th>
                      <th className="px-3 py-2 text-center font-medium">O.S.</th>
                      <th className="px-3 py-2 font-medium">Edificação</th>
                      <th className="px-3 py-2 font-medium">Pessoa</th>
                      <th className="px-3 py-2 text-right font-medium">Pontos CLARO</th>
                      <th className="px-3 py-2 text-right font-medium">Pontos equipe</th>
                      <th className="px-3 py-2 text-right font-medium">Atend.</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {regras
                      .filter(r => !buscaRegra.trim() ||
                        (r.combinacao?.assinatura ?? '')
                          .toLowerCase().includes(buscaRegra.trim().toLowerCase()))
                      .map(r => {
                        const ed = editando === r.id
                        return (
                          <tr key={r.id} className="border-b border-graf-800 align-top">
                            <td className="max-w-96 px-3 py-2">
                              <div className="text-xs leading-snug">
                                {r.combinacao?.assinatura ?? '—'}
                              </div>
                              {r.observacao && (
                                <div className="mt-1 text-[10px] leading-snug text-amber-400/80">
                                  {r.observacao}
                                </div>
                              )}
                            </td>
                            <td className="tabular px-3 py-2 text-center text-graf-400">
                              {r.combinacao?.qtd_os ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {ed ? (
                                <select defaultValue={r.edificacao} className={campo}
                                  onChange={e => setRascunho(x => ({ ...x, edificacao: e.target.value }))}>
                                  {['CASA', 'APTO', 'COMERCIAL', 'QUALQUER'].map(o =>
                                    <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : (
                                <span className={r.edificacao === 'QUALQUER'
                                  ? 'text-graf-500' : 'text-graf-200'}>{r.edificacao}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-graf-500">{r.tipo_pessoa}</td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input defaultValue={r.pontos_claro ?? ''}
                                  className={`${campo} w-24 text-right`}
                                  onChange={e => setRascunho(x => ({
                                    ...x, pontos_claro: e.target.value === '' ? null : Number(e.target.value),
                                  }))} />
                              ) : r.pontos_claro ?? <span className="text-graf-600">—</span>}
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input defaultValue={r.pontos_equipe ?? ''}
                                  className={`${campo} w-24 text-right`}
                                  onChange={e => setRascunho(x => ({
                                    ...x, pontos_equipe: e.target.value === '' ? null : Number(e.target.value),
                                  }))} />
                              ) : r.pontos_equipe ?? <span className="text-graf-600">—</span>}
                            </td>
                            <td className="tabular px-3 py-2 text-right text-graf-500">
                              {r.combinacao?.atendimentos ?? 0}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {ed ? (
                                <span className="flex justify-end gap-1.5">
                                  <button disabled={ocupado} onClick={() => salvarRegra(r.id)}
                                    className="rounded bg-af-600 px-2.5 py-1 text-[11px] font-medium
                                               text-white hover:bg-af-500 disabled:opacity-50">
                                    Salvar
                                  </button>
                                  <button onClick={() => { setEditando(null); setRascunho({}) }}
                                    className="rounded border border-graf-700 px-2.5 py-1
                                               text-[11px] text-graf-400">
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <button onClick={() => { setEditando(r.id); setRascunho({}) }}
                                  className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                             text-graf-400 hover:border-af-600 hover:text-af-400">
                                  Editar
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
              {regras.length >= 120 && (
                <p className="border-t border-graf-800 px-3 py-2 text-[11px] text-graf-500">
                  Mostrando as 120 de maior pontuação. Use o filtro para achar a combinação.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </Shell>
  )
}
