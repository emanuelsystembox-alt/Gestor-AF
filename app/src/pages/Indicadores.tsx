import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Avatar } from '../components/ui'
import { isoLocal } from '../lib/formato'
import { SeletorBuckets } from '../components/SeletorBuckets'
import { VtPorEquipe } from '../components/VtPorEquipe'
import { LinkContrato } from '../components/LinkContrato'

/**
 * Indicadores (140).
 *
 * ┌─ o primeiro é PRIMEIRA WO ────────────────────────────────────────┐
 * │ > "o primeiro contrato que o técnico chegou na casa do cliente.   │
 * │ >  Ignore os contratos informativos, tem que ser o contrato real  │
 * │ >  mesmo (...) a meta para esse indicador é 8 e vinte (...) uma   │
 * │ >  tabela de todos os técnicos, quem é que mais chega atrasado,   │
 * │ >  fazer gráficos dos 10 piores, para que o coordenador possa     │
 * │ >  atuar" — Emanuel, 25/10                                        │
 * │                                                                    │
 * │ A tela nasce com UM indicador e lugar para os próximos: a aba     │
 * │ existe desde já para o segundo não virar outra tela no menu.      │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * CHEGOU = o `início` da atividade no TOA. É a única fonte que existe
 * PARA TRÁS — o aplicativo começou agora e não tem histórico. Lido em
 * horário de Manaus, nunca em UTC (traps.md).
 *
 * DIA SEM ATENDIMENTO NÃO ENTRA: folga e dia sem rota não são atraso.
 * O gráfico diz quantos dias cada um tem, para ninguém confundir "o
 * pior" com "o que trabalhou mais dias".
 */

interface PorDia {
  tecnico_id: string; nome: string; equipe: string | null
  dia: string; hora: string; visita_id: string; contrato: string | null
  grupo: string | null; endereco: string | null
  minutos_depois: number; dentro: boolean
  /** MANHA ou TARDE, derivado do dado pelo banco (145). */
  turno?: string | null
  /** A meta que valeu para ESTA linha: 08:20 de manhã, 11:20 à tarde. */
  meta?: string | null
}
interface PorTecnico {
  tecnico_id: string; nome: string; equipe: string | null
  dias: number; media_hora: string; pior_hora: string; melhor_hora: string
  dias_dentro: number; dias_fora: number; pct_dentro: number
  media_atraso_min: number | null
  turno?: string | null
  meta?: string | null
}

/**
 * Uma linha da GRADE (155a): o técnico e os dias dele de uma vez.
 *
 * > "todos os técnicos já ficam abertos nessa tabela, onde a gente
 * >  consegue saber ali a média do técnico" — Emanuel, 29/10
 */
interface NaGrade {
  tecnico_id: string; nome: string; matricula: string | null; equipe: string | null
  turno: string | null; meta: string | null
  dias: number; dias_dentro: number
  media_hora: string | null; pct_dentro: number | null; media_atraso_min: number | null
  /** Dias com contrato produtivo na escala — folga não entra. */
  dias_escalado: number
  /** Escalado e não abriu NENHUMA WO. Não é média boa: é buraco. */
  dias_sem_wo: number
  por_dia: { dia: string; hora: string; dentro: boolean; min: number
             visita_id: string; contrato: string | null }[]
}

const hhmm = (t: string | null) => (t ?? '').slice(0, 5) || '—'
const diaBr = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pt-BR',
  { day: '2-digit', month: '2-digit', weekday: 'short' })

/** Média de horas em texto: a conta é em minutos desde a meia-noite. */
function mediaHoras(horas: string[]): string {
  if (horas.length === 0) return '—'
  const m = horas.map(h => {
    const [a, b] = h.split(':')
    return Number(a) * 60 + Number(b)
  })
  const med = Math.round(m.reduce((s, x) => s + x, 0) / m.length)
  return `${String(Math.floor(med / 60)).padStart(2, '0')}:${String(med % 60).padStart(2, '0')}`
}

export default function Indicadores() {
  const hoje = isoLocal(new Date())
  const [de, setDe] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 14); return isoLocal(d)
  })
  const [ate, setAte] = useState(hoje)
  const [meta, setMeta] = useState('08:20')
  const [metaTarde, setMetaTarde] = useState('11:20')
  const [dias, setDias] = useState<PorDia[]>([])
  const [tecs, setTecs] = useState<PorTecnico[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  /* 155a: "o filtro do dashboard tem que ir para lá, de equipes e
     buckets" (Emanuel, 29/10). Eles vão para o BANCO, não filtram na
     tela: o turno e a média têm de ser recalculados sobre o recorte,
     senão a tabela mostraria a média de todo mundo com o nome de um. */
  const [equipe, setEquipe] = useState('TODAS')
  const [buckets, setBuckets] = useState<string[]>([])
  const [equipesDisp, setEquipesDisp] = useState<string[]>([])
  const [bucketsDisp, setBucketsDisp] = useState<{ nome: string; qtd: number }[]>([])
  const [verGrade, setVerGrade] = useState(false)
  const [indicador, setIndicador] = useState<'WO' | 'VT'>('WO')
  const [grade, setGrade] = useState<NaGrade[]>([])
  const [carregandoGrade, setCarregandoGrade] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    const filtro = {
      p_de: de, p_ate: ate,
      p_equipe: equipe === 'TODAS' ? null : equipe,
      p_buckets: buckets.length ? buckets : null,
    }
    Promise.all([
      supabase.rpc('primeira_wo_dia', filtro),
      supabase.rpc('primeira_wo_tecnico', filtro),
      supabase.rpc('ler_parametro', { p_chave: 'primeira_wo_meta' }),
      supabase.rpc('ler_parametro', { p_chave: 'primeira_wo_meta_tarde' }),
    ]).then(([d, t, m, mt]) => {
      if (!vivo) return
      if (d.error || t.error) { setErro((d.error ?? t.error)!.message); setCarregando(false); return }
      setDias((d.data ?? []) as PorDia[])
      setTecs((t.data ?? []) as PorTecnico[])
      if (typeof m.data === 'string') setMeta(m.data)
      if (typeof mt.data === 'string') setMetaTarde(mt.data)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate, equipe, buckets])

  /* As opções dos dois filtros saem do próprio período: oferecer bucket
     que não tem contrato no recorte é oferecer tela vazia. */
  useEffect(() => {
    let vivo = true
    supabase.from('visita').select('toa_bucket, equipe:equipe_id ( codigo )')
      .gte('data_agendada', de).lte('data_agendada', ate)
      .then(({ data }) => {
        if (!vivo) return
        const eq = new Set<string>(); const bk = new Map<string, number>()
        for (const l of (data ?? []) as unknown as
             { toa_bucket: string | null; equipe: { codigo: string } | null }[]) {
          if (l.equipe?.codigo) eq.add(l.equipe.codigo)
          if (l.toa_bucket) bk.set(l.toa_bucket, (bk.get(l.toa_bucket) ?? 0) + 1)
        }
        setEquipesDisp([...eq].sort())
        setBucketsDisp([...bk.entries()].map(([nome, qtd]) => ({ nome, qtd }))
          .sort((a, b) => a.nome.localeCompare(b.nome)))
      })
    return () => { vivo = false }
  }, [de, ate])

  /* A grade só é buscada quando pedida: são 67 técnicos x N dias, e
     quem abre Indicadores quase sempre quer só o resumo. */
  useEffect(() => {
    if (!verGrade) return
    let vivo = true
    setCarregandoGrade(true)
    supabase.rpc('primeira_wo_grade', {
      p_de: de, p_ate: ate,
      p_equipe: equipe === 'TODAS' ? null : equipe,
      p_buckets: buckets.length ? buckets : null,
    }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else setGrade((data ?? []) as NaGrade[])
      setCarregandoGrade(false)
    })
    return () => { vivo = false }
  }, [verGrade, de, ate, equipe, buckets])

  const resumo = useMemo(() => {
    const dentro = dias.filter(d => d.dentro).length
    return {
      medicoes: dias.length,
      tecnicos: tecs.length,
      media: mediaHoras(dias.map(d => d.hora)),
      dentro,
      pct: dias.length ? Math.round((100 * dentro) / dias.length) : null,
      atrasoMedio: (() => {
        const fora = dias.filter(d => !d.dentro).map(d => d.minutos_depois)
        return fora.length ? Math.round(fora.reduce((s, x) => s + x, 0) / fora.length) : null
      })(),
    }
  }, [dias, tecs])

  /** Os 10 piores: mais dias fora primeiro, depois o atraso médio maior. */
  const piores = useMemo(() => tecs.filter(t => t.dias_fora > 0).slice(0, 10), [tecs])
  const maiorAtraso = Math.max(1, ...piores.map(p => Number(p.media_atraso_min ?? 0)))

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? tecs.filter(t => t.nome.toLowerCase().includes(q)
      || (t.equipe ?? '').toLowerCase().includes(q)) : tecs
  }, [tecs, busca])

  /** Quantos estão no turno da tarde, no que está na tela (145). */
  const nTarde = useMemo(() => lista.filter(t => t.turno === 'TARDE').length, [lista])

  /** Os dias do recorte, em ordem — as colunas da grade. */
  const diasDoPeriodo = useMemo(() => {
    const out: string[] = []
    const d = new Date(de + 'T12:00'); const fim = new Date(ate + 'T12:00')
    // Trava: 92 colunas já é mais do que cabe em qualquer tela, e o
    // laço sem teto numa data digitada errada trava o navegador.
    while (d <= fim && out.length < 92) {
      out.push(isoLocal(d)); d.setDate(d.getDate() + 1)
    }
    return out
  }, [de, ate])

  const porTecnico = useMemo(() => {
    const m = new Map<string, PorDia[]>()
    for (const d of dias) {
      const l = m.get(d.tecnico_id) ?? []
      l.push(d); m.set(d.tecnico_id, l)
    }
    return m
  }, [dias])

  return (
    <Shell>
      <div className="pagina-entra space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Indicadores</h1>
            <p className="mt-0.5 text-sm text-graf-400">
              <strong className="text-graf-200">Primeira WO</strong> — que horas o técnico
              chega no primeiro cliente do dia. Meta: até{' '}
              <strong className="text-graf-200">{hhmm(meta)}</strong> de manhã e{' '}
              <strong className="text-graf-200">{hhmm(metaTarde)}</strong> à tarde.
            </p>
            {/* 145: a classificação é derivada do dado, não cadastrada —
                e quem lê precisa saber disso para não procurar onde
                mudar. Só aparece quando existe alguém da tarde. */}
            {nTarde > 0 ? (
              <p className="mt-0.5 text-[11px] text-graf-400">
                <strong className="text-graf-300">{nTarde}</strong> de {lista.length} no turno
                da tarde — 3 dias ou mais, nos 30 anteriores, com a primeira janela
                caindo entre 11:00 e 14:00.
              </p>
            ) : lista.length > 0 && (
              <p className="mt-0.5 text-[11px] text-graf-400">
                Ninguém no turno da tarde: ninguém alcançou 3 dias, nos 30 anteriores,
                com a primeira janela entre 11:00 e 14:00.
              </p>
            )}
          </div>
          <label className="text-[11px] text-graf-400">
            De
            <input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)}
              className="ml-1 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-sm" />
          </label>
          <label className="text-[11px] text-graf-400">
            até
            <input type="date" value={ate} min={de} max={hoje} onChange={e => setAte(e.target.value)}
              className="ml-1 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-sm" />
          </label>
          {/* 155a: os mesmos dois filtros do Dashboard. */}
          <select value={equipe} onChange={e => setEquipe(e.target.value)} aria-label="Equipe"
            className="max-w-44 rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs">
            <option value="TODAS">Toda equipe</option>
            {equipesDisp.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <SeletorBuckets opcoes={bucketsDisp} semBucket={0} valor={buckets} onChange={setBuckets}
            className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs" />
        </div>

        {/* A aba existia com um indicador só para o segundo não virar tela
            nova -- e o segundo chegou: VT por equipe (156f), "ao lado da
            primeira WO" (Emanuel, 30/10). Os filtros de cima valem para os dois. */}
        <div className="flex gap-1 border-b border-graf-800">
          {([['WO', 'Primeira WO'], ['VT', 'VT por equipe']] as const).map(([k, r]) => (
            <button key={k} onClick={() => setIndicador(k)} aria-pressed={indicador === k}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${indicador === k
                ? 'border-af-500 font-medium text-graf-100'
                : 'border-transparent text-graf-400 hover:text-graf-200'}`}>
              {r}
            </button>
          ))}
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {indicador === 'VT' ? (
          <VtPorEquipe de={de} ate={ate} equipe={equipe === 'TODAS' ? null : equipe} buckets={buckets} />
        ) : carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : dias.length === 0 ? (
          <Alerta tipo="info">
            Nenhuma primeira WO no período. Só entram contratos <strong>reais</strong>
            {' '}(com número de contrato) e com hora de início vinda do TOA — jornada,
            refeição e apoio ficam de fora de propósito.
          </Alerta>
        ) : (<>
          {/* ---------- os números do período ---------- */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { r: 'Chegada média', v: resumo.media, t: 'Média do horário da primeira WO no período' },
              { r: 'Dentro da meta', v: resumo.pct == null ? '—' : `${resumo.pct}%`,
                t: `${resumo.dentro} de ${resumo.medicoes} dias-técnico dentro de ${hhmm(meta)}`,
                cor: (resumo.pct ?? 0) >= 80 ? 'text-emerald-300' : (resumo.pct ?? 0) >= 50 ? 'text-amber-300' : 'text-af-300' },
              { r: 'Atraso médio', v: resumo.atrasoMedio == null ? 'nenhum' : `${resumo.atrasoMedio} min`,
                t: 'Média dos minutos acima da meta, contando só os dias em que passou dela' },
              { r: 'Técnicos medidos', v: String(resumo.tecnicos), t: 'Quem teve pelo menos um contrato real no período' },
              { r: 'Dias-técnico', v: String(resumo.medicoes), t: 'Cada dia com atendimento de cada técnico. Folga não conta.' },
            ].map(c => (
              <div key={c.r} className="card-controle p-3" title={c.t}>
                <p className="text-[10px] uppercase tracking-wide text-graf-500">{c.r}</p>
                <p className={`tabular mt-1 text-2xl font-semibold ${c.cor ?? 'text-graf-100'}`}>{c.v}</p>
              </div>
            ))}
          </section>

          {/* ---------- a tabela do técnico, dia a dia (155a) ----------
               > "é importante ter uma opção onde o usuário clica em tabela
               >  do técnico (...) onde o usuário consegue visualizar dia a
               >  dia a WO de todos os técnicos de forma aberta, sem precisar
               >  entrar de um por um" — Emanuel, 29/10

               Aberta não é "a lista de baixo expandida": é uma GRADE, um
               técnico por linha e um dia por coluna, onde o olho corre a
               semana inteira de um time sem clicar em nada. E ela traz
               quem a lista de baixo não traz — o técnico que estava
               escalado e não abriu WO nenhuma, que some de toda média. */}
          <section className="card-controle p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold">Tabela do técnico — dia a dia</h2>
              <button onClick={() => setVerGrade(v => !v)}
                className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                           hover:border-af-600 hover:text-af-400">
                {verGrade ? 'Fechar tabela' : 'Abrir tabela'}
              </button>
              {verGrade && grade.length > 0 && (
                <span className="text-[11px] text-graf-500">
                  {grade.length} técnico(s) ativo(s) no recorte · cada célula é a hora da
                  primeira WO daquele dia
                </span>
              )}
            </div>

            {!verGrade ? (
              <p className="mt-1 text-xs text-graf-400">
                Todos os técnicos de uma vez, sem abrir um por um — inclusive os que
                estavam escalados e não abriram nenhuma WO.
              </p>
            ) : carregandoGrade ? (
              <p className="py-8 text-center text-sm text-graf-400">Montando a tabela…</p>
            ) : grade.length === 0 ? (
              <p className="py-8 text-center text-sm text-graf-400">
                Nenhum técnico ativo neste recorte.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-graf-800 text-left uppercase
                                    tracking-wide text-graf-500">
                    <tr>
                      <th className="sticky left-0 bg-graf-950 px-2 py-2 font-medium">Técnico</th>
                      <th className="px-2 py-2 font-medium">Turno</th>
                      <th className="px-2 py-2 font-medium" title="Média do horário da primeira WO no recorte">Média</th>
                      <th className="px-2 py-2 font-medium">Na meta</th>
                      <th className="px-2 py-2 font-medium" title="Dias escalados em que não abriu nenhuma WO">Sem WO</th>
                      {diasDoPeriodo.map(d => (
                        <th key={d} className="px-1 py-2 text-center font-medium">
                          {new Date(d + 'T12:00').toLocaleDateString('pt-BR',
                            { day: '2-digit', month: '2-digit' })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grade.map(g => {
                      const porDia = new Map(g.por_dia.map(x => [x.dia, x]))
                      return (
                        <tr key={g.tecnico_id} className="border-b border-graf-800/60 hover:bg-graf-850">
                          <td className="sticky left-0 bg-graf-950 px-2 py-1.5">
                            <span className="text-graf-200">{g.nome}</span>
                            {g.equipe && <span className="ml-1.5 text-graf-600">{g.equipe}</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={g.turno === 'TARDE' ? 'text-sky-300' : 'text-graf-400'}>
                              {g.turno === 'TARDE' ? 'tarde' : 'manhã'}
                            </span>
                            <span className="tabular ml-1 text-graf-600">{hhmm(g.meta)}</span>
                          </td>
                          <td className="tabular px-2 py-1.5 text-graf-200">{hhmm(g.media_hora)}</td>
                          <td className="tabular px-2 py-1.5">
                            {g.pct_dentro == null ? <span className="text-graf-600">—</span> : (
                              <span className={Number(g.pct_dentro) >= 80 ? 'text-emerald-300'
                                : Number(g.pct_dentro) >= 50 ? 'text-amber-300' : 'text-af-300'}>
                                {g.pct_dentro}%
                              </span>
                            )}
                            <span className="ml-1 text-graf-600">{g.dias_dentro}/{g.dias}</span>
                          </td>
                          {/* Zero e desconhecido não são a mesma coisa: quem
                              não foi escalado mostra travessão, não "0". */}
                          <td className="tabular px-2 py-1.5">
                            {g.dias_escalado === 0 ? <span className="text-graf-600">—</span>
                              : g.dias_sem_wo > 0
                                ? <span className="text-af-300" title={`Escalado em ${g.dias_escalado} dia(s) e sem WO aberta em ${g.dias_sem_wo}`}>{g.dias_sem_wo}</span>
                                : <span className="text-graf-600">0</span>}
                          </td>
                          {diasDoPeriodo.map(d => {
                            const x = porDia.get(d)
                            return (
                              <td key={d} className="tabular px-1 py-1.5 text-center">
                                {!x ? <span className="text-graf-700">·</span> : (
                                  <LinkContrato to={`/controle/visita/${x.visita_id}`}
                                    title={`${x.contrato ?? 'contrato'} · ${x.dentro
                                      ? 'dentro da meta' : `${x.min} min acima da meta`}`}
                                    className={x.dentro ? 'text-emerald-300' : 'text-af-300'}>
                                    {x.hora}
                                  </LinkContrato>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ---------- os 10 piores ---------- */}
          <section className="card-controle p-4">
            <h2 className="text-sm font-semibold">Os 10 que mais chegam atrasados</h2>
            <p className="mt-0.5 text-xs text-graf-400">
              Ordenado por <strong>dias fora da meta</strong>; a barra é o atraso médio em
              minutos. Quem tem poucos dias no período aparece com a contagem ao lado —
              dois dias ruins não são o mesmo problema que dez.
            </p>
            {piores.length === 0 ? (
              <p className="py-6 text-center text-sm text-emerald-300">
                Ninguém fora da meta no período.
              </p>
            ) : (
              <div className="mt-3 space-y-1.5">
                {piores.map(t => {
                  const atraso = Number(t.media_atraso_min ?? 0)
                  const larg = Math.max(4, (atraso / maiorAtraso) * 100)
                  return (
                    <button key={t.tecnico_id}
                      onClick={() => setAberto(a => a === t.tecnico_id ? null : t.tecnico_id)}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-graf-900">
                      <Avatar nome={t.nome} tamanho={24} />
                      <span className="w-48 shrink-0 truncate text-xs">{t.nome}</span>
                      <span className="w-14 shrink-0 text-[11px] text-graf-500">{t.equipe ?? '—'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block h-4 rounded-sm bg-af-600/70"
                          style={{ width: `${larg}%` }} aria-hidden />
                      </span>
                      <span className="tabular w-16 shrink-0 text-right text-xs text-af-300">
                        +{atraso.toFixed(0)} min
                      </span>
                      <span className="tabular w-28 shrink-0 text-right text-[11px] text-graf-400">
                        {t.dias_fora}/{t.dias} dias · {hhmm(t.media_hora)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* ---------- todos os técnicos ---------- */}
          <section className="card-controle overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-graf-800 px-4 py-3">
              <h2 className="text-sm font-semibold">Todos os técnicos</h2>
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar técnico ou equipe…" aria-label="Buscar técnico"
                className="ml-auto min-w-56 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px]
                                  uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Técnico</th>
                    <th className="px-3 py-2 font-medium">Equipe</th>
                    <th className="px-3 py-2 font-medium">Turno</th>
                    <th className="px-3 py-2 text-right font-medium">Dias</th>
                    <th className="px-3 py-2 text-right font-medium">Chegada média</th>
                    <th className="px-3 py-2 text-right font-medium">Mais cedo</th>
                    <th className="px-3 py-2 text-right font-medium">Mais tarde</th>
                    <th className="px-3 py-2 text-right font-medium">Dentro</th>
                    <th className="px-3 py-2 text-right font-medium">Atraso médio</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(t => {
                    const abertoAqui = aberto === t.tecnico_id
                    return (
                      // A chave vai no FRAGMENTO, não na primeira <tr>: a
                      // linha e a gaveta dela são dois filhos do mesmo
                      // item da lista, e o React avisava disso no console.
                      <Fragment key={t.tecnico_id}>
                        <tr
                          onClick={() => setAberto(a => a === t.tecnico_id ? null : t.tecnico_id)}
                          className={`cursor-pointer border-b border-graf-800/60 hover:bg-graf-900 ${
                            abertoAqui ? 'bg-graf-900' : ''}`}>
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2">
                              <Avatar nome={t.nome} tamanho={22} />
                              <span className="truncate">{t.nome}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-graf-400">{t.equipe ?? '—'}</td>
                          <td className="px-3 py-2 text-xs">
                            {/* A meta anda junto do turno: sem ela a coluna
                                diria "TARDE" sem dizer contra o que. */}
                            <span title={`Meta deste técnico: ${hhmm(t.meta ?? null)}`}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold
                                          uppercase tracking-wide ${t.turno === 'TARDE'
                                ? 'bg-violet-900/40 text-violet-300 ring-1 ring-violet-700/40'
                                : 'bg-graf-800 text-graf-300'}`}>
                              {t.turno === 'TARDE' ? 'tarde' : 'manhã'} · {hhmm(t.meta ?? null)}
                            </span>
                          </td>
                          <td className="tabular px-3 py-2 text-right text-xs">{t.dias}</td>
                          <td className="tabular px-3 py-2 text-right font-medium">{hhmm(t.media_hora)}</td>
                          <td className="tabular px-3 py-2 text-right text-xs text-emerald-300">{hhmm(t.melhor_hora)}</td>
                          <td className="tabular px-3 py-2 text-right text-xs text-af-300">{hhmm(t.pior_hora)}</td>
                          <td className="tabular px-3 py-2 text-right">
                            <span className={Number(t.pct_dentro) >= 80 ? 'text-emerald-300'
                              : Number(t.pct_dentro) >= 50 ? 'text-amber-300' : 'text-af-300'}>
                              {Number(t.pct_dentro).toFixed(0)}%
                            </span>
                            <span className="ml-1 text-[11px] text-graf-500">
                              {t.dias_dentro}/{t.dias}
                            </span>
                          </td>
                          <td className="tabular px-3 py-2 text-right text-xs">
                            {t.media_atraso_min == null
                              ? <span className="text-emerald-300">no horário</span>
                              : <span className="text-af-300">+{Number(t.media_atraso_min).toFixed(0)} min</span>}
                          </td>
                        </tr>
                        {abertoAqui && (
                          <tr key={`${t.tecnico_id}-dias`} className="border-b border-graf-800/60 bg-graf-950">
                            <td colSpan={8} className="px-3 py-2">
                              {/* "mostrar no sistema que horas o técnico vem chegando
                                  todos os dias" — dia a dia, com o contrato que ele
                                  abriu, para o coordenador poder conferir. */}
                              <div className="flex flex-wrap gap-1.5">
                                {(porTecnico.get(t.tecnico_id) ?? [])
                                  .slice().sort((a, b) => a.dia.localeCompare(b.dia))
                                  .map(d => (
                                    <LinkContrato key={d.dia} to={`/controle/visita/${d.visita_id}`}
                                      title={`${d.grupo ?? ''} · contrato ${d.contrato ?? '—'} · ${d.endereco ?? ''}`}
                                      className={`rounded-md border px-2 py-1 text-[11px] ${
                                        d.dentro ? 'border-emerald-700/50 bg-emerald-900/25 text-emerald-200'
                                                 : 'border-af-700/50 bg-af-900/25 text-af-200'}`}>
                                      <span className="block text-[10px] uppercase opacity-70">{diaBr(d.dia)}</span>
                                      <span className="tabular font-semibold">{hhmm(d.hora)}</span>
                                      {!d.dentro && <span className="ml-1 opacity-80">+{d.minutos_depois}</span>}
                                    </LinkContrato>
                                  ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-graf-800 px-4 py-2.5 text-xs text-graf-500">
              Clique no técnico para ver <strong>dia a dia</strong> a que horas ele chegou —
              e o contrato que ele abriu. Só entram contratos reais: jornada, refeição e
              apoio a outro técnico ficam de fora.
            </p>
          </section>
        </>)}
      </div>
    </Shell>
  )
}
