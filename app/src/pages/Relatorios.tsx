import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase, SITUACOES, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { carregarLocais, type LocalBaixa } from '../lib/localBaixa'
import {
  SELECT_RELATORIO, PONTUACAO_NA_PRIMEIRA, porContrato, porOS, paraCSV,
  type VisitaLinha, type PontoVisita, type Indicador,
} from '../lib/relatorio'
import { Shell } from '../components/Shell'
import { Alerta } from '../components/ui'
import { isoLocal, pts } from '../lib/formato'
import { useAuth } from '../lib/auth'
import { linhasHumor, type HumorLinha } from '../lib/relatorioHumor'
import { linhasMiscelanea, type MiscelaneaLinha } from '../lib/relatorioMiscelanea'

/**
 * Relatórios — por contrato, por O.S. e o humor das equipes.
 *
 * A montagem das linhas mora em `lib/relatorio.ts`; aqui é só a tela:
 * período, filtros, prévia e download. Ver lá o porquê de cada coluna
 * e por que a pontuação sai só na primeira O.S. do endereço.
 *
 * ┌─ 150 · o humor também se baixa ───────────────────────────────────┐
 * │ > "faça o time conseguir baixar essa planilha depois se quiser no │
 * │ >  relatórios, o humor dos técnicos" — Emanuel, 26/10             │
 * │                                                                     │
 * │ A aba só aparece para quem tem `campo.humor`, a MESMA permissão    │
 * │ que abre a tela de Humor (146). Sem isso, qualquer um com          │
 * │ `relatorios.ver` baixaria em planilha o que a tela esconde — e     │
 * │ como o técnico se sente é dado sensível de empregado, não número   │
 * │ de operação.                                                        │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 162 · miscelânea, e o período inteiro ──────────────────────────────┐
 * │ A aba Miscelânea lê `relatorio_miscelanea`: uma linha por item, com  │
 * │ a fonte (TOA ou técnico) — ver lib/relatorioMiscelanea.ts.           │
 * │                                                                       │
 * │ E as leituras passaram a PAGINAR. O PostgREST devolve no máximo mil  │
 * │ linhas por pedido, e esta tela pedia uma vez só: com ~550 contratos  │
 * │ por dia, dois dias já saíam cortados, sem aviso — e a pontuação,     │
 * │ que também é um pedido só, deixava o resto como "SEM REGRA". É a     │
 * │ mesma armadilha do Dashboard (D-221).                                │
 * └───────────────────────────────────────────────────────────────────────┘
 */

const PAGINA = 1000
/** Teto de segurança: 50 mil linhas, muito acima de qualquer mês real. */
const MAX_PAGINAS = 50

/**
 * Pede de mil em mil até o lote vir menor. Passar do teto é ERRO, não
 * corte calado: um relatório pela metade é pior que nenhum.
 */
async function paginar<T>(
  pedir: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  vivo: () => boolean,
): Promise<T[]> {
  const tudo: T[] = []
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await pedir(p * PAGINA, (p + 1) * PAGINA - 1)
    if (error) throw new Error(error.message)
    if (!vivo()) return tudo
    const lote = (data ?? []) as T[]
    tudo.push(...lote)
    if (lote.length < PAGINA) return tudo
  }
  throw new Error(`Período grande demais (mais de ${PAGINA * MAX_PAGINAS} linhas). Escolha um intervalo menor.`)
}

export default function Relatorios() {
  const [de, setDe] = useState(isoLocal())
  const [ate, setAte] = useState(isoLocal())
  const { pode } = useAuth()
  const podeHumor = pode('campo.humor')
  const [tipo, setTipo] = useState<'contrato' | 'os' | 'miscelanea' | 'humor'>('contrato')
  const [humor, setHumor] = useState<HumorLinha[]>([])
  const [misc, setMisc] = useState<MiscelaneaLinha[]>([])
  const [formato, setFormato] = useState<'xlsx' | 'csv'>('xlsx')
  const [linhas, setLinhas] = useState<VisitaLinha[]>([])
  const [pontos, setPontos] = useState<Map<string, PontoVisita>>(new Map())
  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  const [carregando, setCarregando] = useState(false)
  const [carregandoMisc, setCarregandoMisc] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // filtros
  const [equipes, setEquipes] = useState<string[]>([])
  const [grupos, setGrupos] = useState<string[]>([])
  const [situacoes, setSituacoes] = useState<Situacao[]>([])
  const [supervisores, setSupervisores] = useState<string[]>([])
  const [semJornada, setSemJornada] = useState(true)
  /** 109: separar as adesões GPON (Emanuel, 19/10). */
  const [tecnologia, setTecnologia] = useState<'TODAS' | 'GPON' | 'SEM'>('TODAS')

  useEffect(() => {
    // O período abre em HOJE (ver lib/dia.ts). Antes vinha do último dia
    // com visita, e um relatório que abre num dia que ninguém escolheu é
    // um relatório que alguém exporta achando que é de hoje.
    supabase.from('indicador_qualidade').select('id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => setIndicadores((data ?? []) as Indicador[]))
  }, [])

  const [locais, setLocais] = useState<Map<string, LocalBaixa>>(new Map())

  // O humor vem de uma RPC própria (146) e só é pedido quando a aba
  // está escolhida: é dado sensível, não se carrega "por via das dúvidas".
  useEffect(() => {
    if (tipo !== 'humor' || !podeHumor || !de || !ate) return
    let vivo = true
    supabase.rpc('humor_das_equipes', { p_de: de, p_ate: ate }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro(error.message); return }
      setHumor((data ?? []) as HumorLinha[])
    })
    return () => { vivo = false }
  }, [tipo, podeHumor, de, ate])

  // A miscelânea também só é pedida com a aba escolhida.
  useEffect(() => {
    if (tipo !== 'miscelanea' || !de || !ate) return
    let vivo = true
    setCarregandoMisc(true); setErro(null)
    paginar<MiscelaneaLinha>(
      (a, b) => supabase.rpc('relatorio_miscelanea', { p_de: de, p_ate: ate }).range(a, b),
      () => vivo,
    ).then(ls => { if (vivo) setMisc(ls) })
      .catch((e: Error) => { if (vivo) { setMisc([]); setErro(e.message) } })
      .finally(() => { if (vivo) setCarregandoMisc(false) })
    return () => { vivo = false }
  }, [tipo, de, ate])

  useEffect(() => {
    if (!de || !ate) return
    let vivo = true
    setCarregando(true); setErro(null)

    // Duas leituras, não uma por linha: a pontuação do período inteiro
    // resolve num RPC só (D-045). As duas paginam (162), e a ordem termina
    // num campo único: sem desempate, a página seguinte repete ou pula linha.
    Promise.all([
      paginar<VisitaLinha>((a, b) => supabase.from('visita').select(SELECT_RELATORIO)
        .is('excluido_em', null)
        .gte('data_agendada', de).lte('data_agendada', ate)
        .order('data_agendada').order('janela_inicio', { nullsFirst: false }).order('id')
        .range(a, b), () => vivo),
      paginar<PontoVisita>((a, b) => supabase.rpc('pontos_por_periodo', { p_de: de, p_ate: ate })
        .order('visita_id').range(a, b), () => vivo),
    ]).then(([ls, ps]) => {
      if (!vivo) return
      setLinhas(ls)
      // Onde a baixa do campo foi dada (096) — colunas do analítico.
      carregarLocais(ls.map(l => l.id)).then(m => { if (vivo) setLocais(m) })
        .catch(() => { if (vivo) setLocais(new Map()) })
      const m = new Map<string, PontoVisita>()
      for (const x of ps) m.set(x.visita_id, x)
      setPontos(m)
    }).catch((e: Error) => {
      if (vivo) { setLinhas([]); setPontos(new Map()); setErro(e.message) }
    }).finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [de, ate])

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
    if (tecnologia === 'GPON' && l.tecnologia !== 'GPON') return false
    if (tecnologia === 'SEM' && l.tecnologia === 'GPON') return false
    return true
  }), [linhas, semJornada, equipes, grupos, supervisores, situacoes, tecnologia])

  // Os filtros de cima valem também para a miscelânea — exceto jornada e
  // tecnologia, que são da visita e não vêm na linha do item.
  const miscFiltrada = useMemo(() => misc.filter(l => {
    if (equipes.length && !equipes.includes(l.equipe ?? '')) return false
    if (grupos.length && !grupos.includes(l.grupo_servico ?? '')) return false
    if (supervisores.length && !supervisores.includes(l.supervisor ?? '')) return false
    if (situacoes.length && !situacoes.includes(l.situacao as Situacao)) return false
    return true
  }), [misc, equipes, grupos, supervisores, situacoes])

  const totalOS = filtradas.reduce((s, l) => s + l.ordem_servico.length, 0)

  const montado = useMemo(
    () => tipo === 'humor' ? linhasHumor(humor)
      : tipo === 'miscelanea' ? linhasMiscelanea(miscFiltrada)
      : tipo === 'contrato'
        ? porContrato(filtradas, pontos, indicadores, locais)
        : porOS(filtradas, pontos, indicadores, locais),
    [filtradas, pontos, indicadores, tipo, locais, humor, miscFiltrada])

  const somaPontos = useMemo(() => {
    let s = 0
    for (const v of filtradas) s += Number(pontos.get(v.id)?.pontos_claro ?? 0)
    return s
  }, [filtradas, pontos])

  const semRegra = useMemo(
    () => filtradas.filter(v => {
      const p = pontos.get(v.id)
      return v.tipo_atividade?.natureza !== 'JORNADA' && (!p || !p.achou)
    }).length,
    [filtradas, pontos])

  function baixar() {
    const nome = `afline-relatorio-${tipo}-${de}${de !== ate ? '_a_' + ate : ''}`
    if (formato === 'csv') {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(paraCSV(montado))
      a.download = `${nome}.csv`
      a.click(); URL.revokeObjectURL(a.href)
      return
    }
    const ws = XLSX.utils.aoa_to_sheet(montado)
    // Sem largura mínima o Excel abre 60 colunas de 8 caracteres e nada
    // é legível. Largura pela maior célula, com teto.
    ws['!cols'] = montado[0].map((_, j) => ({
      wch: Math.min(42, Math.max(10,
        ...montado.slice(0, 200).map(l => String(l[j] ?? '').length + 2))),
    }))
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws,
      tipo === 'humor' ? 'Humor das equipes'
        : tipo === 'miscelanea' ? 'Miscelânea'
        : tipo === 'contrato' ? 'Por contrato' : 'Por O.S.')
    XLSX.writeFile(wb, `${nome}.xlsx`)
  }

  const previa = useMemo(() => montado.slice(0, 8), [montado])
  // A miscelânea tem leitura própria: o relatório não está pronto enquanto
  // ela não chega, mesmo que as visitas já tenham chegado.
  const ocupado = carregando || (tipo === 'miscelanea' && carregandoMisc)
  const totalLinhas = montado.length - 1

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
            deslocamento, janela e pontuação. <strong>Por O.S.</strong> dá uma linha por
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
                {([['contrato', 'Por contrato'], ['os', 'Por O.S.'],
                   ['miscelanea', 'Miscelânea'],
                   ...(podeHumor ? [['humor', 'Humor das equipes'] as const] : []),
                  ] as const).map(([t, rot]) => (
                  <button key={t} onClick={() => setTipo(t)}
                    className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                      tipo === t ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                    {rot}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Formato</span>
              <div className="flex rounded-md bg-graf-900 p-0.5">
                {([['xlsx', 'Excel'], ['csv', 'CSV']] as const).map(([f, rot]) => (
                  <button key={f} onClick={() => setFormato(f)}
                    className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                      formato === f ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
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

            <button onClick={baixar} disabled={ocupado || totalLinhas === 0}
              className="ml-auto rounded-lg bg-af-600 px-5 py-2 text-sm font-semibold text-white
                         hover:bg-af-500 disabled:opacity-50">
              Baixar {formato === 'xlsx' ? 'Excel' : 'CSV'} · {totalLinhas} linhas ·{' '}
              {montado[0]?.length ?? 0} colunas
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
              <span className="mb-1 mt-2 block">Tecnologia</span>
              <select value={tecnologia} onChange={e => setTecnologia(e.target.value as 'TODAS' | 'GPON' | 'SEM')}
                className="w-full rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs outline-none focus:border-af-500">
                <option value="TODAS">Toda tecnologia</option>
                <option value="GPON">Só GPON</option>
                <option value="SEM">Sem GPON identificado</option>
              </select>
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
          </p>
        </section>

        {/* ---------- o que está indo no arquivo ---------- */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Visitas', String(filtradas.length)],
            ['Ordens de serviço', String(totalOS)],
            ['Pontuação CLARO', pts(somaPontos)],
            ['Sem regra de pontuação', String(semRegra)],
          ].map(([rot, val], i) => (
            <div key={rot} className={`card-controle px-3.5 py-3 ${
              i === 3 && semRegra > 0 ? 'ring-1 ring-amber-600/50' : ''}`}>
              <div className="tabular text-2xl font-semibold leading-none">{val}</div>
              <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">{rot}</div>
            </div>
          ))}
        </section>

        {tipo === 'miscelanea' ? (
          <Alerta tipo="info">
            Uma linha por item lançado no contrato. <strong>Fonte TOA</strong> é o que a
            varredura leu do TOA; <strong>Fonte MANUAL</strong> é o que o técnico baixou
            pelo aplicativo. As duas não se somam: contrato que o TOA ainda não leu não
            tem linha TOA. {miscFiltrada.length} itens em{' '}
            {new Set(miscFiltrada.map(l => l.visita_id)).size} contratos.
          </Alerta>
        ) : (
          <Alerta tipo="info">{PONTUACAO_NA_PRIMEIRA}</Alerta>
        )}

        <section className="card-controle overflow-hidden">
          <div className="border-b border-graf-800 px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              Prévia — {tipo === 'contrato' ? 'por contrato'
                : tipo === 'os' ? 'por O.S.'
                : tipo === 'miscelanea' ? 'miscelânea' : 'humor das equipes'}
            </h2>
            <p className="mt-0.5 text-xs text-graf-400">
              As 7 primeiras linhas do arquivo, exatamente como vão sair. Role para o
              lado: são {montado[0]?.length ?? 0} colunas.
            </p>
          </div>
          {ocupado ? (
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
                    {previa[0].map((c, i) => (
                      <th key={`${c}-${i}`} className="whitespace-nowrap px-2.5 py-2 font-medium">
                        {c}
                      </th>
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
