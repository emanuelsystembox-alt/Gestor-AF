import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Shell } from '../components/Shell'
import { Alerta, Avatar } from '../components/ui'
import { isoLocal, num2, pts, reais } from '../lib/formato'

/**
 * Produtividade e comissão.
 *
 * ┌─ POR QUE UMA TELA E NÃO DEZESSEIS ───────────────────────────────┐
 * │ O sistema atual tem 16 itens no menu de Relatórios: Insights, Por │
 * │ Serviços, Por LPU, Por Equipamentos, Batidas de Ponto x Serviço,  │
 * │ Dias Trabalhados, Indicadores de Qualidade, Pontuação Geral,      │
 * │ Pontuação Técnico, Tabela Pontuação, Pontuação Monitor, Período,  │
 * │ Ranking Geral, Log's Retorno, COP 360, Produtividade Geral.       │
 * │                                                                   │
 * │ Boa parte é a MESMA pergunta agrupada de outro jeito. "Pontuação  │
 * │ Técnico", "Pontuação Monitor" e "Ranking Geral" são a mesma soma  │
 * │ por técnico, por supervisor e ordenada.                           │
 * │                                                                   │
 * │ Aqui é uma tela e um seletor de dimensão. Quem procura o ranking  │
 * │ acha na mesma tela em que estava, em vez de voltar ao menu.       │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * **Só conta contrato CONCLUÍDO** — foi o que o Emanuel pediu. Contrato
 * em execução não virou dinheiro, e contá-lo faz a comissão oscilar
 * para baixo quando o contrato cai.
 */

interface Linha {
  tecnico_id: string | null
  tecnico: string | null
  matricula: string | null
  skill: string | null
  equipe_id: string | null
  equipe: string | null
  supervisor: string | null
  area: string | null
  visitas: number
  concluidas: number
  ordens: number
  pontos: number
  dias: number
  meta: number | null
  fator: number | null
  /** pontuação × fator. Nulo quando não há faixa — nulo diz "não há
   *  regra ainda"; zero diria "calculei e deu nada". */
  valor: number | null
}

interface Faixa { id: string; pontos_de: number; pontos_ate: number; fator: number }

type Dimensao = 'tecnico' | 'equipe' | 'supervisor'



/** Primeiro e último dia do mês corrente — comissão é mensal. */
function mesCorrente() {
  const h = new Date()
  return {
    de: isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)),
    ate: isoLocal(new Date(h.getFullYear(), h.getMonth() + 1, 0)),
  }
}

/** Dias úteis do mês, para a previsão. Feriado não entra — não temos
 *  calendário de feriado, e inventar um erraria a previsão em silêncio. */
function diasUteis(de: string, ate: string) {
  let n = 0
  const d = new Date(de + 'T12:00'), f = new Date(ate + 'T12:00')
  while (d <= f) {
    const s = d.getDay()
    if (s !== 0 && s !== 6) n++
    d.setDate(d.getDate() + 1)
  }
  return n
}

export default function Produtividade() {
  const { pode } = useAuth()
  const inicial = mesCorrente()

  const [de, setDe] = useState(inicial.de)
  const [ate, setAte] = useState(inicial.ate)
  const [dim, setDim] = useState<Dimensao>('tecnico')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [faixas, setFaixas] = useState<Faixa[]>([])
  const [meta, setMeta] = useState<number | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // edição da tabela de comissão
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState<Faixa[]>([])
  const [metaNova, setMetaNova] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [ok, setOk] = useState<string | null>(null)

  async function carregarFaixas() {
    const [f, m] = await Promise.all([
      supabase.from('faixa_comissao')
        .select('id, pontos_de, pontos_ate, fator')
        .eq('skill', 'SINGLE MASTER').eq('ativo', true).order('pontos_de'),
      supabase.from('meta_tecnico').select('meta_pontos')
        .eq('skill', 'SINGLE MASTER').eq('ativo', true)
        .order('vigencia_inicio', { ascending: false }).limit(1).maybeSingle(),
    ])
    setFaixas((f.data ?? []) as Faixa[])
    setMeta((m.data as { meta_pontos: number } | null)?.meta_pontos ?? null)
  }

  useEffect(() => { carregarFaixas() }, [])

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('produtividade_periodo', { p_de: de, p_ate: ate })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setLinhas((data ?? []) as Linha[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [de, ate])

  /**
   * Agrupa pela dimensão escolhida. Somar `dias` entre técnicos seria
   * errado — dois técnicos no mesmo dia não são dois dias —, então na
   * visão de equipe e supervisor o que vale é o MAIOR número de dias.
   */
  const agrupadas = useMemo(() => {
    if (dim === 'tecnico') return linhas

    const m = new Map<string, Linha>()
    for (const l of linhas) {
      const chave = dim === 'equipe'
        ? (l.equipe ?? '— sem equipe —')
        : (l.supervisor ?? '— sem supervisor —')
      const a = m.get(chave)
      if (!a) {
        m.set(chave, { ...l, tecnico: chave, matricula: null, tecnico_id: null })
      } else {
        a.visitas += l.visitas; a.concluidas += l.concluidas
        a.ordens += l.ordens; a.pontos = Number(a.pontos) + Number(l.pontos)
        a.dias = Math.max(a.dias, l.dias)
      }
    }
    return [...m.values()].sort((a, b) => Number(b.pontos) - Number(a.pontos))
  }, [linhas, dim])

  const totais = useMemo(() => {
    const t = { visitas: 0, concluidas: 0, ordens: 0, pontos: 0 }
    for (const l of linhas) {
      t.visitas += l.visitas; t.concluidas += l.concluidas
      t.ordens += l.ordens; t.pontos += Number(l.pontos)
    }
    return t
  }, [linhas])

  const uteis = useMemo(() => diasUteis(de, ate), [de, ate])

  /**
   * Vale a MAIOR faixa cujo início já foi alcançado — por piso, não por
   * intervalo fechado. A tabela é escrita em inteiros (190→199, depois
   * 200→219) e a nossa pontuação não é inteira: com intervalo fechado,
   * 199,50 pontos não cairia em faixa nenhuma e o técnico receberia
   * zero. Mesma regra do banco (`fator_da_pontuacao`, migration 038b).
   */
  function fatorDe(pontos: number): number | null {
    let achado: number | null = null
    for (const f of faixas) if (pontos >= Number(f.pontos_de)) achado = Number(f.fator)
    return achado
  }

  async function salvarFaixas() {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_faixas_comissao', {
      p_skill: 'SINGLE MASTER',
      p_faixas: rascunho.map(f => ({
        de: Number(f.pontos_de), ate: Number(f.pontos_ate), fator: Number(f.fator),
      })),
    })
    if (error) { setErro(error.message); setOcupado(false); return }
    if (metaNova.trim()) {
      const { error: e2 } = await supabase.rpc('definir_meta_comissao', {
        p_skill: 'SINGLE MASTER', p_meta: Number(metaNova.replace(',', '.')),
      })
      if (e2) { setErro(e2.message); setOcupado(false); return }
    }
    setOk('Tabela de comissão atualizada.')
    setEditando(false); setOcupado(false); setMetaNova('')
    await carregarFaixas()
  }

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs'
  const rot = { tecnico: 'Técnico', equipe: 'Equipe', supervisor: 'Supervisor' }[dim]

  return (
    <Shell>
      <div className="pagina-entra mx-auto max-w-7xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Produtividade e comissão</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            Uma tela, três dimensões — por técnico, por equipe e por supervisor. Só
            entra <strong>contrato concluído</strong>: contrato em execução ainda não
            virou dinheiro. Jornada não entra em produtividade.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        <section className="card-controle flex flex-wrap items-end gap-3 p-4">
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
          <button onClick={() => { const m = mesCorrente(); setDe(m.de); setAte(m.ate) }}
            className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                       hover:border-af-600 hover:text-af-400">
            Mês corrente
          </button>

          <div className="text-xs text-graf-400">
            <span className="mb-1 block">Ver por</span>
            <div className="flex rounded-md bg-graf-900 p-0.5">
              {(['tecnico', 'equipe', 'supervisor'] as const).map(d => (
                <button key={d} onClick={() => setDim(d)}
                  className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                    dim === d ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                  {{ tecnico: 'Técnico', equipe: 'Equipe', supervisor: 'Supervisor' }[d]}
                </button>
              ))}
            </div>
          </div>

          <p className="ml-auto pb-1.5 text-[11px] text-graf-500">
            {uteis} dias úteis no período
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Concluídos', String(totais.concluidas)],
            ['Visitas', String(totais.visitas)],
            ['Ordens de serviço', String(totais.ordens)],
            ['Pontos CLARO', pts(totais.pontos)],
            ['Meta por técnico', meta == null ? '—' : num2(Number(meta))],
          ].map(([r, v]) => (
            <div key={r} className="card-controle px-3.5 py-3">
              <div className="tabular text-2xl font-semibold leading-none">{v}</div>
              <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">{r}</div>
            </div>
          ))}
        </section>

        <section className="card-controle overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-graf-800 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Por {rot.toLowerCase()}</h2>
            <span className="text-xs text-graf-500">{agrupadas.length} linha(s)</span>
          </div>

          {carregando ? (
            <p className="px-4 py-10 text-center text-sm text-graf-400">Carregando…</p>
          ) : agrupadas.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-graf-500">
              Nenhum contrato concluído no período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">{rot}</th>
                    <th className="px-3 py-2 text-right font-medium">Visitas</th>
                    <th className="px-3 py-2 text-right font-medium">Concluídas</th>
                    <th className="px-3 py-2 text-right font-medium">O.S.</th>
                    <th className="px-3 py-2 text-right font-medium">Pontos</th>
                    <th className="px-3 py-2 text-right font-medium">Dias</th>
                    <th className="px-3 py-2 text-right font-medium">Média/dia</th>
                    <th className="px-3 py-2 text-right font-medium">Previsão</th>
                    <th className="px-3 py-2 font-medium">
                      Meta{dim !== 'tecnico' && <span className="normal-case"> (só por técnico)</span>}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Fator</th>
                    <th className="px-3 py-2 text-right font-medium">A receber</th>
                  </tr>
                </thead>
                <tbody>
                  {agrupadas.map((l, i) => {
                    const p = Number(l.pontos)
                    const media = l.dias > 0 ? p / l.dias : 0
                    // Previsão: o ritmo de hoje até o fim do período.
                    const previsao = media * uteis
                    const alvo = Number(l.meta ?? meta ?? 0)
                    const pct = alvo > 0 ? Math.min(100, (p / alvo) * 100) : 0
                    const fator = fatorDe(p)
                    return (
                      <tr key={`${l.tecnico_id ?? l.tecnico ?? i}`}
                          className="border-b border-graf-800/60">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {dim === 'tecnico' && (
                              <Avatar nome={l.tecnico ?? l.equipe ?? '?'} tamanho={26} />
                            )}
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {l.tecnico ?? <span className="text-graf-600">sem técnico</span>}
                              </div>
                              {dim === 'tecnico' && (
                                <div className="text-[10px] text-graf-500">
                                  {l.matricula ?? '—'}
                                  {l.equipe && ` · equipe ${l.equipe}`}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="tabular px-3 py-2 text-right text-graf-400">{l.visitas}</td>
                        <td className="tabular px-3 py-2 text-right font-medium">{l.concluidas}</td>
                        <td className="tabular px-3 py-2 text-right text-graf-400">{l.ordens}</td>
                        <td className="tabular px-3 py-2 text-right font-semibold text-emerald-400">
                          {pts(p)}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-graf-400">{l.dias}</td>
                        <td className="tabular px-3 py-2 text-right text-graf-300">{num2(media)}</td>
                        <td className="tabular px-3 py-2 text-right text-graf-300">{num2(previsao)}</td>
                        <td className="px-3 py-2">
                          {/* Meta e fator são POR TÉCNICO. Somar os pontos de
                              uma equipe e comparar com a meta individual daria
                              86% para um supervisor de 3 técnicos — número
                              bonito e sem sentido. */}
                          {dim === 'tecnico' && alvo > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-graf-800">
                                <div className="h-full rounded-full bg-af-600"
                                     style={{ width: `${pct}%` }} />
                              </div>
                              <span className="tabular text-[10px] text-graf-500">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          ) : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {dim !== 'tecnico' || fator == null
                            ? <span className="text-graf-600">—</span>
                            : <span className="font-semibold text-emerald-400">{num2(fator)}</span>}
                        </td>
                        {/* A receber = pontuação × fator. Sem faixa não há
                            fator, e sem fator não há valor. */}
                        <td className="tabular px-3 py-2 text-right">
                          {dim !== 'tecnico' || fator == null
                            ? <span className="text-graf-600">—</span>
                            : <span className="font-semibold text-emerald-300">
                                {reais(p * fator)}
                              </span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------- tabela de comissão ---------- */}
        <section className="card-controle overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-graf-800 px-4 py-2.5">
            <div>
              <h2 className="text-sm font-semibold">Tabela de comissão · SINGLE MASTER</h2>
              <p className="mt-0.5 text-xs text-graf-400">
                Meta de <strong className="tabular">{meta == null ? '—' : num2(Number(meta))}</strong>
                {' '}pontos no mês. Abaixo dela não há fator.
              </p>
            </div>
            {/* Quem edita é quem tem a permissão "Editar meta e comissão do
                técnico", concedida na tela de Administração. */}
            {pode('comissao.editar') ? (
              editando ? (
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setEditando(false)}
                    className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300">
                    Cancelar
                  </button>
                  <button onClick={salvarFaixas} disabled={ocupado}
                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-semibold text-white
                               hover:bg-af-500 disabled:opacity-50">
                    {ocupado ? 'Salvando…' : 'Salvar tabela'}
                  </button>
                </div>
              ) : (
                <button onClick={() => { setRascunho(faixas.map(f => ({ ...f }))); setEditando(true) }}
                  className="ml-auto rounded-md border border-graf-700 px-3 py-1.5 text-xs
                             text-graf-300 hover:border-af-600 hover:text-af-400">
                  Editar tabela
                </button>
              )
            ) : (
              <span className="ml-auto text-[11px] text-graf-600">
                somente leitura — precisa da permissão “Editar meta e comissão do técnico”
              </span>
            )}
          </div>

          {editando && (
            <div className="border-b border-graf-800 px-4 py-2.5">
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Nova meta (deixe vazio para não mudar)</span>
                <input value={metaNova} onChange={e => setMetaNova(e.target.value)}
                  placeholder={meta == null ? '120' : num2(Number(meta))}
                  className={`tabular ${sel} w-32`} />
              </label>
              <p className="mt-1.5 text-[11px] text-graf-500">
                A meta não se sobrescreve: a antiga fecha hoje e a nova começa amanhã, para
                não reescrever a comissão de um mês já fechado.
              </p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl text-xs">
              <thead className="border-b border-graf-800 bg-graf-900 text-left
                                uppercase tracking-wide text-graf-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Pontuação inicial</th>
                  <th className="px-3 py-2 font-medium">Pontuação final</th>
                  <th className="px-3 py-2 text-right font-medium">Fator</th>
                </tr>
              </thead>
              <tbody>
                {(editando ? rascunho : faixas).map((f, i) => (
                  <tr key={f.id ?? i} className="border-b border-graf-800/60">
                    {(['pontos_de', 'pontos_ate', 'fator'] as const).map(k => (
                      <td key={k} className={`px-3 py-1.5 ${k === 'fator' ? 'text-right' : ''}`}>
                        {editando ? (
                          <input value={String(f[k])} className={`tabular ${sel} w-24`}
                            onChange={e => setRascunho(r => r.map((x, j) =>
                              j === i ? { ...x, [k]: e.target.value as unknown as number } : x))} />
                        ) : (
                          <span className="tabular">{num2(Number(f[k]))}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Alerta tipo="info">
            <strong>A receber = pontuação × fator.</strong> O fator sai da maior faixa
            cujo início a pontuação do mês já alcançou — por piso, e não por intervalo
            fechado: a tabela é escrita em inteiros (190→199, depois 200→219) e a nossa
            pontuação não é, então com intervalo fechado alguém com 199,50 pontos cairia
            fora de todas as faixas e receberia zero.
          </Alerta>
        </section>
      </div>
    </Shell>
  )
}
