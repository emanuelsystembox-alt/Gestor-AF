import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Metrica, Vazio, CarregandoBloco } from '../components/ui'
import { Painel } from '../components/graficos'
import { LinkContrato } from '../components/LinkContrato'
import { dataBR } from '../lib/formato'

/**
 * Previsão do dia (260, D-377) — fase 1 do pacote preditivo.
 *
 * O painel diz como o dia ESTÁ; esta tela diz como ele vai TERMINAR: o TEC1 real do que o
 * TOA já encerrou somado ao previsto do que falta (a fila de cada técnico, a mesma régua do
 * TEC1 em risco, D-264), quais contratos decidem a meta e o que não cabe até o fim da
 * jornada. Tudo do banco (`previsao_do_dia`); a tela não soma nada.
 *
 * "A previsão acerta?" vem da caixa-preta (`foto_do_dia`, uma foto a cada 30 min): a
 * previsão das 10h contra o fechamento real, dia a dia. Previsão que não se mede não
 * merece confiança.
 */

interface Decide {
  visita_id: string; contrato: string | null; grupo: string | null
  equipe: string | null; tecnico: string | null; situacao: string; comecou: boolean
  prev: 'SEM_PADRAO' | 'PADRAO'; nivel: 'PERDIDO' | 'VAI_ESTOURAR' | 'EM_RISCO' | null
  n_os: number; na_frente: number; janela: string | null
  prazo_chegada: string | null; prazo_fim: string | null
  previsto_chegada: string | null; previsto_fim: string | null
  folga_min: number | null; salvavel: boolean
}
interface Fila {
  fila: string; tecnico: string | null; equipe: string | null; abertos: number; depois: number
  fim_previsto: string | null
  itens: { visita_id: string; contrato: string | null; grupo: string | null; previsto_fim: string; janela: string | null }[]
}
interface Previsao {
  dia: string; agora: string; cidade: string | null; meta: number; fim_jornada: string
  tec1: { real_padrao: number; real_sem: number; prev_padrao: number; prev_sem: number
          real_pct: number | null; previsto_pct: number | null; salvar: number }
  abertos: number; sem_fila: number; fim_operacao: string | null; nao_cabem: number
  decidem: Decide[]; filas: Fila[]
}
interface Acerto {
  desde: string | null
  hoje: { hora: string; previsto_pct: number | null; real_pct: number | null; nao_cabem: number }[]
  dias: { dia: string; foto: string; previsto_pct: number | null; real_pct: number | null
          apontados: number; apontados_que_estouraram: number
          estouraram_depois: number; estouraram_depois_apontados: number }[]
}

const pctBR = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** Hora de Manaus — o fuso do banco, não o do navegador. */
const hora = (iso: string | null | undefined) => iso == null ? '—'
  : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(iso))
const minutos = (m: number | null) => m == null ? '—' : `${m > 0 ? '+' : ''}${m} min`

const NIVEL: Record<string, { rotulo: string; cor: string }> = {
  VAI_ESTOURAR: { rotulo: 'vai estourar', cor: 'var(--st-conflito)' },
  PERDIDO:      { rotulo: 'perdido',      cor: 'var(--color-graf-500)' },
  TARDE:        { rotulo: 'começou tarde', cor: 'var(--color-graf-500)' },
  EM_RISCO:     { rotulo: 'em risco',     cor: 'var(--st-reagendamento)' },
}
const nivelDe = (d: Decide) =>
  d.prev === 'SEM_PADRAO' ? (d.nivel ?? 'TARDE') : 'EM_RISCO'

export default function PrevisaoDia() {
  const [p, setP] = useState<Previsao | null | undefined>(undefined)
  const [a, setA] = useState<Acerto | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)

  const carregar = useCallback(() => {
    setErro(null); setCarregando(true)
    Promise.all([supabase.rpc('previsao_do_dia'), supabase.rpc('acerto_da_previsao')])
      .then(([pr, ac]) => {
        setCarregando(false)
        if (pr.error) { setErro(pr.error.message); setP(null); return }
        setP((pr.data as Previsao | null) ?? null)
        if (!ac.error) setA(ac.data as Acerto)
      })
  }, [])
  useEffect(carregar, [carregar])

  const t = p?.tec1
  const naMeta = t?.previsto_pct != null && p != null && t.previsto_pct >= p.meta
  const salvaveis = p?.decidem.filter(d => d.prev === 'SEM_PADRAO' && d.salvavel).length ?? 0
  const filasDepois = p?.filas.filter(f => f.depois > 0) ?? []

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Previsão do dia</h1>
            {p && (
              <p className="mt-0.5 text-sm text-graf-400">
                {p.cidade ?? '—'} · hoje, {dataBR(p.dia)} · previsto às {hora(p.agora)}
              </p>
            )}
          </div>
          <button onClick={carregar} disabled={carregando}
            className="rounded-md border border-graf-700 px-3 py-1.5 text-sm text-graf-200 hover:bg-graf-800 disabled:opacity-60">
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {p === undefined && <CarregandoBloco className="py-10" />}

        {p && t && (<>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Metrica valor={t.real_pct == null ? '—' : `${pctBR(t.real_pct)}%`}
              rotulo={`TEC1 agora · ${t.real_padrao + t.real_sem} O.S.`} />
            <Metrica valor={t.previsto_pct == null ? '—' : `${pctBR(t.previsto_pct)}%`}
              rotulo={`TEC1 no fechamento · meta ${p.meta}%`}
              cor={t.previsto_pct == null ? undefined : naMeta ? 'var(--st-concluida)' : 'var(--st-conflito)'}
              alerta={t.previsto_pct != null && !naMeta} />
            <Metrica valor={t.salvar === 0 ? 'na meta' : t.salvar}
              rotulo={t.salvar === 0 ? 'nenhuma O.S. a salvar'
                : `O.S. a salvar · ${salvaveis} contrato(s) ainda salváveis`}
              alerta={t.salvar > 0} />
            <Metrica valor={p.nao_cabem} rotulo={`não cabem até ${p.fim_jornada} · de ${p.abertos} abertos`}
              alerta={p.nao_cabem > 0} />
            <Metrica valor={hora(p.fim_operacao)} rotulo="fim previsto da operação" />
          </div>

          {p.sem_fila > 0 && (
            <Alerta tipo="aviso">
              {p.sem_fila} contrato(s) em aberto sem técnico nem equipe: ficam fora da previsão.
            </Alerta>
          )}

          <div className="grid gap-3 xl:grid-cols-5">
            <Painel dicaLinhas={2} className="xl:col-span-3" titulo="Contratos que decidem o TEC1"
              dica={`Previstos fora do prazo e os com folga curta. Fora do prazo: ${t.prev_sem} O.S.; dentro: ${t.prev_padrao}.`}>
              {p.decidem.length === 0
                ? <Vazio titulo="Nenhum contrato aberto ameaça o TEC1" />
                : <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                          <th className="w-28 py-2 pr-3 font-medium">Previsão</th>
                          <th className="py-2 pr-3 font-medium">Contrato</th>
                          <th className="w-32 py-2 pr-3 font-medium">Janela</th>
                          <th className="w-32 py-2 pr-3 font-medium" title="Chegada e fim previstos pela fila do técnico">Previsto</th>
                          <th className="w-20 py-2 pr-3 text-right font-medium" title="Quanto sobra até o prazo do TEC1 (negativo = estoura)">Folga</th>
                          <th className="w-44 py-2 font-medium">Equipe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-graf-800">
                        {p.decidem.map(d => {
                          const nv = NIVEL[nivelDe(d)]
                          return (
                            <tr key={d.visita_id} className="align-top">
                              <td className="py-2 pr-3">
                                <span className="font-semibold" style={{ color: nv.cor }}>{nv.rotulo}</span>
                                {d.prev === 'SEM_PADRAO' && (
                                  <div className="text-[11px] text-graf-400">{d.salvavel ? 'dá para salvar' : 'não dá mais'}</div>
                                )}
                              </td>
                              <td className="py-2 pr-3">
                                <LinkContrato to={`/controle/visita/${d.visita_id}`} className="tabular font-medium text-graf-200 hover:underline">
                                  {d.contrato ?? 'sem número'}
                                </LinkContrato>
                                <div className="text-xs text-graf-400">
                                  {[d.grupo, `${d.n_os} O.S.`].filter(Boolean).join(' · ')}
                                </div>
                              </td>
                              <td className="tabular py-2 pr-3 text-graf-300">
                                {d.janela ?? '—'}
                                <div className="text-xs text-graf-400">{d.comecou ? 'em execução' : d.na_frente ? `${d.na_frente} na frente` : 'é o próximo'}</div>
                              </td>
                              <td className="tabular py-2 pr-3 text-graf-300">
                                {d.comecou ? '—' : hora(d.previsto_chegada)} → {hora(d.previsto_fim)}
                              </td>
                              <td className="tabular py-2 pr-3 text-right"
                                style={{ color: d.folga_min != null && d.folga_min < 0 ? 'var(--st-conflito)' : undefined }}>
                                {minutos(d.folga_min)}
                              </td>
                              <td className="py-2">
                                <div className="truncate text-graf-300">{d.equipe ? `equipe ${d.equipe}` : 'sem equipe'}</div>
                                <div className="truncate text-xs text-graf-400">{d.tecnico ?? 'sem técnico'}</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>}
            </Painel>

            <Painel dicaLinhas={2} className="xl:col-span-2" titulo={`Não cabe até ${p.fim_jornada}`}
              dica="Por técnico (sem técnico, a equipe): quando a fila dele acaba e quantos ficam para depois.">
              {filasDepois.length === 0
                ? <Vazio titulo={`A fila de todo mundo acaba até ${p.fim_jornada}`} />
                : <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                        <th className="py-2 pr-3 font-medium">Quem</th>
                        <th className="w-24 py-2 pr-3 text-right font-medium">Depois</th>
                        <th className="w-20 py-2 text-right font-medium">Acaba</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-graf-800">
                      {filasDepois.map(f => (
                        <Fragment key={f.fila}>
                          <tr className="cursor-pointer hover:bg-graf-900" aria-expanded={aberta === f.fila}
                            onClick={() => setAberta(x => x === f.fila ? null : f.fila)}>
                            <td className="py-2 pr-3">
                              <div className="truncate text-graf-200">{f.tecnico ?? (f.equipe ? `equipe ${f.equipe}` : 'sem equipe')}</div>
                              {f.tecnico && <div className="truncate text-xs text-graf-400">{f.equipe ? `equipe ${f.equipe}` : 'sem equipe'}</div>}
                            </td>
                            <td className="tabular py-2 pr-3 text-right">
                              <span className="font-semibold" style={{ color: 'var(--st-conflito)' }}>{f.depois}</span>
                              <span className="text-graf-400"> de {f.abertos}</span>
                            </td>
                            <td className="tabular py-2 text-right text-graf-200">{hora(f.fim_previsto)}</td>
                          </tr>
                          {aberta === f.fila && (
                            <tr className="bg-graf-900/60">
                              <td colSpan={3} className="px-2 py-2">
                                <div className="flex flex-wrap gap-1.5">
                                  {f.itens.map(i => (
                                    <span key={i.visita_id} className="inline-flex items-center gap-1.5 rounded bg-graf-800 px-2 py-0.5 text-xs">
                                      <LinkContrato to={`/controle/visita/${i.visita_id}`}
                                        className="tabular text-af-400 underline underline-offset-2">{i.contrato ?? 'sem número'}</LinkContrato>
                                      <span className="tabular text-graf-300">{i.janela ?? 'sem janela'} · acaba {hora(i.previsto_fim)}</span>
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>}
            </Painel>
          </div>

          <Painel dicaLinhas={2} titulo="A previsão acerta?"
            dica="A previsão da primeira foto depois das 10h contra o TEC1 real do fechamento; e, contrato a contrato, quem foi apontado e estourou.">
            {!a ? <p className="py-4 text-center text-sm text-graf-400">Sem leitura da caixa-preta.</p> : (<>
              {a.hoje.length > 0 && (
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-graf-300">
                  <span className="font-semibold uppercase tracking-wide text-graf-200">Hoje</span>
                  {a.hoje.map(h => (
                    <span key={h.hora} className="tabular" title={`real até ${h.hora}: ${pctBR(h.real_pct)}%`}>
                      {h.hora} <strong>{pctBR(h.previsto_pct)}%</strong>
                    </span>
                  ))}
                </div>
              )}
              {a.dias.length === 0
                ? <p className="py-4 text-center text-sm text-graf-400">
                    {a.desde
                      ? `A caixa-preta começou em ${dataBR(a.desde)}: o primeiro dia inteiro medido aparece amanhã.`
                      : 'A caixa-preta ainda não tirou nenhuma foto nesta cidade.'}
                  </p>
                : <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                          <th className="py-2 pr-3 font-medium">Dia</th>
                          <th className="py-2 pr-3 text-right font-medium">Previsto</th>
                          <th className="py-2 pr-3 text-right font-medium">Real</th>
                          <th className="py-2 pr-3 text-right font-medium">Erro</th>
                          <th className="py-2 pr-3 text-right font-medium" title="Dos contratos apontados como fora do prazo na foto, quantos estouraram mesmo">Apontados que estouraram</th>
                          <th className="py-2 text-right font-medium" title="Dos que estouraram depois da foto, quantos a previsão tinha apontado">Estourados que foram apontados</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-graf-800">
                        {a.dias.map(d => {
                          const erroPts = d.previsto_pct != null && d.real_pct != null ? d.previsto_pct - d.real_pct : null
                          return (
                            <tr key={d.dia}>
                              <td className="tabular py-2 pr-3 text-graf-200">{dataBR(d.dia)} <span className="text-xs text-graf-400">foto {d.foto}</span></td>
                              <td className="tabular py-2 pr-3 text-right">{pctBR(d.previsto_pct)}%</td>
                              <td className="tabular py-2 pr-3 text-right">{pctBR(d.real_pct)}%</td>
                              <td className="tabular py-2 pr-3 text-right text-graf-300">
                                {erroPts == null ? '—' : `${erroPts > 0 ? '+' : ''}${pctBR(erroPts)} pt`}
                              </td>
                              <td className="tabular py-2 pr-3 text-right">{d.apontados_que_estouraram} de {d.apontados}</td>
                              <td className="tabular py-2 text-right">{d.estouraram_depois_apontados} de {d.estouraram_depois}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>}
            </>)}
          </Painel>
        </>)}
      </div>
    </Shell>
  )
}
