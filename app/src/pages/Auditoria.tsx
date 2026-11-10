import { useEffect, useMemo, useState } from 'react'
import { supabase, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Vazio, CarregandoBloco } from '../components/ui'
import { Painel, TabelaSimples } from '../components/graficos'
import { LinkContrato } from '../components/LinkContrato'
import { diaMes, isoLocal } from '../lib/formato'

/**
 * Auditoria da baixa (179): a fila do que é suspeito, com nota e motivos.
 *
 * > "Conferir sozinho" — pacote de 02/11 (D-262). A fila ACUSA; quem opera
 * > julga. Nada muda no contrato por estar aqui.
 *
 * Cada critério volta SUSPEITO, OK, NAO_AVALIADO ou NAO_SE_APLICA. O "não
 * avaliado" aparece à parte e nunca conta como ok (D-117): sem GPS, sem
 * leitura do TOA, sem foto, grupo sem régua — o sistema diz que não sabe.
 * A nota é a soma dos pesos dos suspeitos; os pesos vêm do banco (proposta,
 * aguardando o Emanuel) e a tela só os mostra.
 */

type Estado = 'SUSPEITO' | 'OK' | 'NAO_AVALIADO' | 'NAO_SE_APLICA'
type Criterio = 'SERIAL' | 'LOCAL' | 'EQUIPAMENTO' | 'DURACAO' | 'GALERIA'

interface Avaliacao {
  s: Estado; t: string
  outros?: { serial: string; contrato: string | null; dia: string; visita_id: string | null }[]
}
interface Item {
  visita_id: string; contrato: string | null; dia: string
  tecnico_id: string | null; tecnico: string | null; equipe: string | null
  grupo: string | null; situacao: string; nota: number
  criterios: Record<Criterio, Avaliacao>
}
interface Regua {
  grupo: string; amostra: number; p10: number | null; p50: number | null; p75: number | null
  suficiente: boolean; de: string; ate: string; calculada_em: string
}
interface Auditoria {
  de: string; ate: string; avaliados: number
  pesos: Record<Criterio, number>
  criterios: Partial<Record<Criterio, Partial<Record<Estado, number>>>>
  regua: Regua[]
  fila: Item[]
}

// Na ordem do peso proposto: o mais forte primeiro.
const CRITERIOS: { k: Criterio; rotulo: string; dica: string }[] = [
  { k: 'SERIAL', rotulo: 'Serial repetido', dica: 'O mesmo serial instalado em outro contrato' },
  { k: 'LOCAL', rotulo: 'Longe do endereço', dica: 'Baixa fora do raio do endereço (D-170)' },
  { k: 'EQUIPAMENTO', rotulo: 'Equipamento ≠ TOA', dica: 'O que o técnico lançou difere do que o TOA mostra' },
  { k: 'DURACAO', rotulo: 'Execução curta', dica: 'Duração do TOA entre os 10% mais curtos do grupo' },
  { k: 'GALERIA', rotulo: 'Foto da galeria', dica: 'Foto enviada da galeria, não da câmera' },
]
const ROTULO = Object.fromEntries(CRITERIOS.map(c => [c.k, c.rotulo])) as Record<Criterio, string>

type Periodo = 'ONTEM' | 'SETE' | 'TRINTA' | 'PERSONALIZADO'
const ROTULO_PERIODO: Record<Periodo, string> = {
  ONTEM: 'Ontem', SETE: '7 dias', TRINTA: '30 dias', PERSONALIZADO: 'Período',
}
const MAX_DIAS = 31

const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs'
const menosDias = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() - n); return isoLocal(d)
}
const diasEntre = (de: string, ate: string) =>
  Math.round((new Date(ate + 'T12:00').getTime() - new Date(de + 'T12:00').getTime()) / 86_400_000)
const minBR = (n: number | null) =>
  n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`

export default function AuditoriaDaBaixa() {
  const hoje = isoLocal()
  const ontem = menosDias(hoje, 1)
  const [periodo, setPeriodo] = useState<Periodo>('SETE')
  const [deP, setDeP] = useState(menosDias(hoje, 7))
  const [ateP, setAteP] = useState(ontem)
  const [criterio, setCriterio] = useState<Criterio | 'TODOS'>('TODOS')
  const [busca, setBusca] = useState('')
  const [a, setA] = useState<Auditoria | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)

  // Hoje fica de fora dos atalhos: o dia ainda está fechando.
  const [de, ate] = periodo === 'ONTEM' ? [ontem, ontem]
    : periodo === 'SETE' ? [menosDias(hoje, 7), ontem]
    : periodo === 'TRINTA' ? [menosDias(hoje, 30), ontem]
    : [deP, ateP]
  const invalido = !de || !ate || ate < de ? 'Período inválido'
    : diasEntre(de, ate) >= MAX_DIAS ? `Até ${MAX_DIAS} dias por consulta` : null

  useEffect(() => {
    if (invalido) return
    let vivo = true
    setA(undefined); setErro(null)
    supabase.rpc('auditoria_da_baixa', { p_de: de, p_ate: ate }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro(error.message); setA(null); return }
      setA(data as Auditoria)
    })
    return () => { vivo = false }
  }, [de, ate, invalido])

  const fila = useMemo(() => {
    if (!a) return []
    const q = busca.trim().toUpperCase()
    return a.fila.filter(f =>
      (criterio === 'TODOS' || f.criterios[criterio]?.s === 'SUSPEITO')
      && (!q || (f.contrato ?? '').includes(q) || (f.tecnico ?? '').toUpperCase().includes(q)))
  }, [a, criterio, busca])

  const pesos = a ? CRITERIOS.map(c => `${c.rotulo} ${a.pesos[c.k]}`).join(' · ') : ''

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Auditoria da baixa</h1>
            {a && (
              <p className="mt-0.5 text-sm text-graf-400">
                {a.avaliados.toLocaleString('pt-BR')} contratos conferidos · {a.fila.length} na fila
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-graf-900 p-0.5">
              {(Object.keys(ROTULO_PERIODO) as Periodo[]).map(p => (
                <button key={p} onClick={() => setPeriodo(p)} aria-pressed={periodo === p}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    periodo === p ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                  {ROTULO_PERIODO[p]}
                </button>
              ))}
            </div>
            {periodo === 'PERSONALIZADO' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={deP} max={ontem} onChange={e => setDeP(e.target.value)}
                  aria-label="Data inicial" className={`tabular ${sel}`} />
                <span className="text-graf-400">até</span>
                <input type="date" value={ateP} max={hoje} onChange={e => setAteP(e.target.value)}
                  aria-label="Data final" className={`tabular ${sel}`} />
              </div>
            )}
          </div>
        </div>

        {invalido && <Alerta tipo="aviso">{invalido}</Alerta>}
        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {/* Um cartão por critério: suspeitos em destaque, e o que NÃO pôde
            ser conferido logo abaixo — não avaliado não é "ok" (D-117).
            Clicar filtra a fila. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <BotaoCriterio ativo={criterio === 'TODOS'} onClick={() => setCriterio('TODOS')}
            valor={a ? a.fila.length : '—'} rotulo="Na fila" dica={pesos ? `Nota = soma dos pesos: ${pesos}` : undefined} />
          {CRITERIOS.map(c => {
            const n = a?.criterios[c.k]
            const na = n?.NAO_AVALIADO ?? 0
            return (
              <BotaoCriterio key={c.k} ativo={criterio === c.k}
                onClick={() => setCriterio(criterio === c.k ? 'TODOS' : c.k)}
                valor={a ? n?.SUSPEITO ?? 0 : '—'} rotulo={c.rotulo} alerta={(n?.SUSPEITO ?? 0) > 0}
                dica={a ? `${c.dica} · peso ${a.pesos[c.k]} · ok ${n?.OK ?? 0} · não avaliado ${na}`
                        + (n?.NAO_SE_APLICA ? ` · não se aplica ${n.NAO_SE_APLICA}` : '') : c.dica}
                rodape={a && na > 0 ? `${na.toLocaleString('pt-BR')} não avaliado(s)` : undefined} />
            )
          })}
        </div>

        <section className="card-controle p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">
              Fila{criterio !== 'TODOS' && <span className="text-graf-400"> · {ROTULO[criterio]}</span>}
            </h2>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Contrato ou técnico"
              aria-label="Buscar contrato ou técnico" className={`ml-auto w-52 ${sel}`} />
          </div>

          {a === undefined && !invalido && <CarregandoBloco className="py-10" />}
          {a && fila.length === 0 && (
            <Vazio titulo={a.fila.length === 0 ? 'Nada suspeito no período' : 'Nenhum contrato neste filtro'} />
          )}

          {a && fila.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                    <th className="w-14 px-2 py-1.5 text-right font-medium" title={`Soma dos pesos: ${pesos}`}>Nota</th>
                    <th className="w-28 px-2 py-1.5 font-medium">Contrato</th>
                    <th className="w-14 px-2 py-1.5 font-medium">Dia</th>
                    <th className="w-48 px-2 py-1.5 font-medium">Técnico</th>
                    <th className="min-w-72 px-2 py-1.5 font-medium">Motivos</th>
                    <th className="w-44 px-2 py-1.5 font-medium">Não avaliado</th>
                  </tr>
                </thead>
                <tbody>
                  {fila.map(f => {
                    const lista = CRITERIOS.map(c => ({ ...c, av: f.criterios[c.k] })).filter(c => c.av)
                    const suspeitos = lista.filter(c => c.av.s === 'SUSPEITO')
                    const naoAval = lista.filter(c => c.av.s === 'NAO_AVALIADO')
                    return (
                      <tr key={f.visita_id} className="border-b border-graf-800/60 align-top">
                        <td className="tabular px-2 py-2 text-right font-semibold"
                          style={{ color: f.nota >= 50 ? '#f87171' : f.nota >= 30 ? '#fbbf24' : undefined }}>
                          {f.nota}
                        </td>
                        <td className="px-2 py-2">
                          <LinkContrato to={`/controle/visita/${f.visita_id}`} className="tabular hover:underline"
                            title={`${f.grupo ?? 'sem grupo'} · ${SITUACAO_INFO[f.situacao as Situacao]?.label ?? f.situacao}`}>
                            {f.contrato ?? 'sem número'}
                          </LinkContrato>
                          <div className="truncate text-[11px] text-graf-400">{f.grupo ?? 'sem grupo'}</div>
                        </td>
                        <td className="tabular px-2 py-2 text-graf-300">{diaMes(f.dia)}</td>
                        <td className="px-2 py-2">
                          <div className="truncate" title={f.tecnico ?? undefined}>{f.tecnico ?? 'sem técnico'}</div>
                          {f.equipe && <div className="text-[11px] text-graf-400">equipe {f.equipe}</div>}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {suspeitos.map(c => (
                              <span key={c.k} title={`${c.dica} · peso ${a.pesos[c.k]}`}
                                className="rounded-md border border-af-700/60 bg-af-900/25 px-1.5 py-0.5 text-xs text-af-200">
                                <b className="font-semibold">{c.rotulo}</b> · {c.av.t}
                                {c.k === 'SERIAL' && c.av.outros?.filter(o => o.visita_id).map(o => (
                                  <LinkContrato key={o.visita_id!} to={`/controle/visita/${o.visita_id}`}
                                    className="ml-1 underline underline-offset-2" title={`Serial ${o.serial} em ${diaMes(o.dia)}`}>
                                    abrir {o.contrato ?? 'outro'}
                                  </LinkContrato>
                                ))}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            {naoAval.map(c => (
                              <span key={c.k} title={`${c.rotulo}: ${c.av.t}`}
                                className="rounded border border-graf-700 px-1.5 py-0.5 text-[11px] text-graf-400">
                                {c.rotulo}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {a && a.regua.length > 0 && (
          <Painel titulo="Régua de duração" className="max-w-3xl"
            dica={`Duração do TOA, concluídos de ${diaMes(a.regua[0].de)} a ${diaMes(a.regua[0].ate)}`}>
            <TabelaSimples colunas={['Grupo', 'Concluídos', 'Curto (10%)', 'Mediana', '75%']}
              linhas={a.regua.map(r => [
                r.grupo, r.amostra.toLocaleString('pt-BR'),
                r.suficiente ? minBR(r.p10) : 'sem régua', minBR(r.p50), minBR(r.p75),
              ])} />
          </Painel>
        )}
      </div>
    </Shell>
  )
}

function BotaoCriterio({ ativo, onClick, valor, rotulo, dica, rodape, alerta = false }: {
  ativo: boolean; onClick: () => void; valor: number | string; rotulo: string
  dica?: string; rodape?: string; alerta?: boolean
}) {
  return (
    <button onClick={onClick} aria-pressed={ativo} title={dica}
      className={`card-controle px-3.5 py-3 text-left transition hover:ring-1 hover:ring-graf-600 ${
        ativo ? 'ring-2 ring-af-500' : alerta ? 'ring-1 ring-af-600/50' : ''}`}>
      <div className="tabular text-2xl font-semibold leading-none">
        {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">{rotulo}</div>
      {rodape && <div className="mt-1 text-[11px] text-graf-400">{rodape}</div>}
    </button>
  )
}
