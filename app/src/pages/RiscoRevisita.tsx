import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Metrica, Vazio, CarregandoBloco } from '../components/ui'
import { Painel, TabelaSimples } from '../components/graficos'
import { LinkContrato } from '../components/LinkContrato'
import { dataBR, diaMes, isoLocal } from '../lib/formato'

/**
 * Risco de revisita na baixa (261, D-375) — fase 2 do pacote preditivo.
 *
 * Os serviços CONCLUÍDOS no dia (VT, instalação e Retorno), com a faixa de
 * risco de voltar em 30 dias e os motivos. Quem decide é o banco
 * (`risco_revisita_do_dia`), com a régua da própria cidade: serviços dos 90
 * dias cuja janela de 30 dias já fechou. Nenhum peso escrito à mão — o
 * método do Risco de quebra (181).
 *
 * É SUGESTÃO para a gestão, no site (D-262). Nada muda sozinho, nada vai para
 * o app. Pouco histórico é "sem histórico", não "baixo" (regra 6). Em dia
 * passado, a coluna "Voltou" mostra o que de fato aconteceu — é a conferência
 * da própria nota.
 *
 * Respostas do Emanuel (12/11): a VT reagendada/cancelada volta "por construção"
 * e fica FORA da nota — num quadro à parte, "Vai voltar"; o Retorno é alto "por ser
 * Retorno" e a tela diz isso; a validação regular do sinal é um selo verde, fora da
 * conta (só o que aumenta o risco pesa, como no Risco de quebra).
 */

type Faixa = 'ALTO' | 'MEDIO' | 'BAIXO' | 'SEM_HISTORICO'
type Servico = 'VT' | 'INST'

interface Motivo {
  familia: string; valor: string; detalhe: string | null
  taxa: number; razao: number; n: number
}
interface Linha {
  visita_id: string; contrato: string | null; servico: Servico; grupo: string | null
  bairro: string | null; situacao: string; situacao_label: string | null
  equipe_id: string | null; equipe: string | null; tecnico: string | null
  baixa: string | null
  faixa: Faixa; fator: number | null; motivos: Motivo[]
  /** a classe da certidão da VT (REGULAR = validado sem falha) — só o selo */
  sinal: string | null
  voltou: { visita_id: string; dia: string; dias: number } | null
}
interface VaiVoltar {
  visita_id: string; contrato: string | null; situacao: string; situacao_label: string | null
  equipe: string | null; tecnico: string | null; baixa: string | null
  voltou: { visita_id: string; dia: string; dias: number } | null
}
interface Fator {
  familia: string; valor: string; rotulo: string | null
  n: number; revisitas: number; taxa: number; razao: number
}
interface Regua {
  n: number; revisitas: number; taxa: number; de: string; ate: string
  suficiente: boolean; calculado_em: string; fatores: Fator[]
}
interface Risco {
  dia: string; hoje: string; cidade: string | null
  reguas: Partial<Record<Servico, Regua>>
  servicos: Linha[]
  vai_voltar?: VaiVoltar[]
}

const FAIXA: Record<Faixa, { rotulo: string; classe: string }> = {
  ALTO:          { rotulo: 'Alto',          classe: 'bg-af-900/40 text-af-200 ring-1 ring-af-700/50' },
  MEDIO:         { rotulo: 'Médio',         classe: 'bg-amber-900/30 text-amber-200 ring-1 ring-amber-700/50' },
  BAIXO:         { rotulo: 'Baixo',         classe: 'bg-graf-800 text-graf-300' },
  SEM_HISTORICO: { rotulo: 'Sem histórico', classe: 'bg-graf-800 text-graf-300' },
}
const SERVICO: Record<Servico, string> = { VT: 'VT', INST: 'Instalação' }

const SINAL: Record<string, string> = {
  REGULAR: 'Validação regular', COM_FALHA: 'Validação com falha', SEM_VALIDACAO: 'Sem validação',
  SEM_LEITURA: 'Sinal não lido', OS_NAO_FINALIZADA: 'O.S. não finalizada no portal',
}
const DURACAO: Record<string, string> = {
  ATE_15: 'Execução até 15 min', '15_30': 'Execução de 15 a 30 min',
  '30_60': 'Execução de 30 a 60 min', '60_MAIS': 'Execução de 60 min ou mais',
}

/** O nome do fator como a operação fala. */
function rotuloFator(familia: string, valor: string, rotulo?: string | null): string {
  switch (familia) {
    // D-375: o Retorno pesa por ser Retorno — a tela diz, para ninguém culpar o técnico por isso
    case 'GRUPO': return valor === 'RETORNO DE CREDENCIADA' ? 'Por ser Retorno' : valor
    case 'CODIGO': return rotulo ?? `Código ${valor}`
    case 'NODE': return `Node ${valor}`
    case 'BAIRRO': return `Bairro ${valor}`
    case 'JANELA': return `Janela das ${valor}`
    case 'TECNICO': return rotulo ?? 'Técnico'
    case 'REINCIDENTE': return 'Já é revisita'
    case 'SINAL': return SINAL[valor] ?? valor
    case 'LOG': return `LOG ${valor}`
    case 'EVIDENCIA': return valor === 'SEM' ? 'Sem foto/vídeo' : 'Com foto/vídeo'
    case 'DURACAO': return DURACAO[valor] ?? valor
    default: return `${familia} ${valor}`
  }
}

const pctBR = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const vezes = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Dia ISO menos n dias, no calendário local (nunca toISOString — D-084). */
function menosDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return isoLocal(new Date(a, m - 1, d - n))
}

function Etiqueta({ m }: { m: Motivo }) {
  const dica = `${pctBR(m.taxa)}% voltaram em ${m.n} serviços · ${vezes(m.razao)}× a cidade`
    + (m.detalhe ? ` · ${m.detalhe}` : '')
  // O técnico e o código vêm no detalhe; o valor cru é um id.
  const nome = m.familia === 'TECNICO' || m.familia === 'CODIGO' ? m.detalhe : null
  return (
    <span title={dica}
      className="inline-flex items-center gap-1 rounded bg-graf-800 px-1.5 py-0.5 text-[11px] text-graf-200">
      {rotuloFator(m.familia, m.valor, nome)}
      <span className="tabular text-graf-300">{pctBR(m.taxa)}%</span>
    </span>
  )
}

export default function RiscoRevisita() {
  const [dia, setDia] = useState<string | null>(null)   // nulo = hoje (o banco decide o dia)
  const [r, setR] = useState<Risco | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [faixa, setFaixa] = useState<'TODAS' | Faixa>('TODAS')
  const [servico, setServico] = useState<'TODOS' | Servico>('TODOS')
  const [equipe, setEquipe] = useState('')

  const carregar = useCallback(() => {
    setErro(null); setCarregando(true)
    supabase.rpc('risco_revisita_do_dia', dia ? { p_dia: dia } : {}).then(({ data, error }) => {
      setCarregando(false)
      if (error) { setErro(error.message); setR(null); return }
      setR((data as Risco | null) ?? null)
    })
  }, [dia])
  useEffect(carregar, [carregar])

  const linhas = r?.servicos ?? []
  const equipes = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of linhas) if (c.equipe_id) m.set(c.equipe_id, c.equipe ?? 'sem código')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [linhas])
  const visiveis = linhas.filter(c =>
    (faixa === 'TODAS' || c.faixa === faixa)
    && (servico === 'TODOS' || c.servico === servico)
    && (!equipe || c.equipe_id === equipe))
  const conta = (f: Faixa) => linhas.filter(c => c.faixa === f).length
  const voltaram = linhas.filter(c => c.voltou).length
  const vaiVoltar = r?.vai_voltar ?? []
  const passado = !!r && r.dia !== r.hoje
  const reguas = (['VT', 'INST'] as Servico[])
    .map(s => [s, r?.reguas?.[s]] as const)
    .filter((x): x is readonly [Servico, Regua] => !!x[1])

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Risco de revisita</h1>
            {r && (
              <p className="mt-0.5 text-sm text-graf-400">
                {r.cidade ?? '—'} · {passado ? dataBR(r.dia) : `hoje, ${dataBR(r.dia)}`} · serviços baixados
              </p>
            )}
          </div>
          <label className="text-xs text-graf-400">
            <span className="sr-only">Dia</span>
            <input type="date" value={dia ?? r?.dia ?? ''}
              min={r ? menosDias(r.hoje, 90) : undefined} max={r?.hoje}
              onChange={e => setDia(e.target.value || null)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm text-graf-100" />
          </label>
          <label className="text-xs text-graf-400">
            <span className="sr-only">Serviço</span>
            <select value={servico} onChange={e => setServico(e.target.value as 'TODOS' | Servico)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm text-graf-100">
              <option value="TODOS">VT e instalação</option>
              <option value="VT">VT</option>
              <option value="INST">Instalação e Retorno</option>
            </select>
          </label>
          <label className="text-xs text-graf-400">
            <span className="sr-only">Faixa</span>
            <select value={faixa} onChange={e => setFaixa(e.target.value as 'TODAS' | Faixa)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm text-graf-100">
              <option value="TODAS">Todas as faixas</option>
              <option value="ALTO">Alto</option>
              <option value="MEDIO">Médio</option>
              <option value="BAIXO">Baixo</option>
              <option value="SEM_HISTORICO">Sem histórico</option>
            </select>
          </label>
          <label className="text-xs text-graf-400">
            <span className="sr-only">Equipe</span>
            <select value={equipe} onChange={e => setEquipe(e.target.value)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm text-graf-100">
              <option value="">Todas as equipes</option>
              {equipes.map(([id, cod]) => <option key={id} value={id}>{cod}</option>)}
            </select>
          </label>
          <button onClick={carregar} disabled={carregando}
            className="rounded-md border border-graf-700 px-3 py-1.5 text-sm text-graf-200 hover:bg-graf-800 disabled:opacity-60">
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {r === undefined && <CarregandoBloco className="py-10" />}

        {r && reguas.filter(([, g]) => !g.suficiente).map(([s, g]) => (
          <Alerta key={s} tipo="info">
            {SERVICO[s]}: histórico curto nesta cidade — {g.n} serviços de {dataBR(g.de)} a{' '}
            {dataBR(g.ate)} (a faixa precisa de 300).
          </Alerta>
        ))}

        {r && (<>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Metrica valor={linhas.length} rotulo="Concluídos" />
            <Metrica valor={conta('ALTO')} rotulo="Risco alto" alerta={conta('ALTO') > 0} />
            <Metrica valor={conta('MEDIO')} rotulo="Risco médio" />
            <Metrica valor={vaiVoltar.length} rotulo="VT reagendada/cancelada · vai voltar" />
            {/* Sem régua, "—": a taxa da cidade é desconhecida, não 0% (regra 6). */}
            {(['VT', 'INST'] as Servico[]).map(s => {
              const g = r.reguas?.[s]
              return (
                <Metrica key={s} valor={g && g.n > 0 ? `${pctBR(g.taxa)}%` : '—'}
                  rotulo={`Revisita ${s === 'VT' ? 'VT' : 'instalação'}${g ? ` · ${g.n} serviços` : ''}`} />
              )
            })}
          </div>

          <Painel titulo="Serviços por risco de voltar em 30 dias"
            dica={passado
              ? `Alto = o dobro da revisita da cidade ou mais · ${voltaram} já voltaram`
              : 'Alto = o dobro da revisita da cidade ou mais · médio = algum motivo'}>
            {visiveis.length === 0
              ? <Vazio titulo={linhas.length === 0 ? 'Nenhum serviço baixado neste dia' : 'Nenhum serviço neste filtro'} />
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                        <th className="w-28 py-2 pr-3 font-medium">Faixa</th>
                        <th className="py-2 pr-3 font-medium">Contrato</th>
                        <th className="w-56 py-2 pr-3 font-medium">Baixa</th>
                        <th className="w-48 py-2 pr-3 font-medium">Equipe</th>
                        <th className="min-w-[14rem] py-2 pr-3 font-medium">Motivos</th>
                        <th className="w-28 py-2 font-medium">Voltou</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-graf-800">
                      {visiveis.map(c => (
                        <tr key={c.visita_id} className="align-top">
                          <td className="py-2 pr-3">
                            <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${FAIXA[c.faixa].classe}`}
                              title={c.fator != null ? `${vezes(c.fator)}× a revisita da cidade` : undefined}>
                              {FAIXA[c.faixa].rotulo}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <LinkContrato to={`/controle/visita/${c.visita_id}`} className="tabular font-medium text-graf-200 hover:underline">
                              {c.contrato ?? 'sem número'}
                            </LinkContrato>
                            <div className="text-xs text-graf-400">
                              {[c.grupo, c.bairro].filter(Boolean).join(' · ') || '—'}
                            </div>
                            {c.sinal === 'REGULAR' && (
                              <span title="Validação regular no Portal Técnico da Claro — informativo, fora da conta"
                                className="mt-1 inline-block rounded px-1.5 py-px text-[10px] font-semibold text-white"
                                style={{ background: 'var(--st-concluida)' }}>validado</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="text-graf-300">{c.situacao_label ?? c.situacao}</div>
                            <div className="truncate text-xs text-graf-400" title={c.baixa ?? undefined}>{c.baixa ?? 'sem código'}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="truncate text-graf-300">{c.equipe ?? 'sem equipe'}</div>
                            <div className="truncate text-xs text-graf-400">{c.tecnico ?? 'sem técnico'}</div>
                          </td>
                          <td className="py-2 pr-3">
                            {c.motivos.length === 0
                              ? <span className="text-xs text-graf-400">—</span>
                              : <div className="flex flex-wrap gap-1">
                                  {c.motivos.map(m => <Etiqueta key={`${m.familia}:${m.valor}`} m={m} />)}
                                </div>}
                          </td>
                          <td className="py-2 text-xs">
                            {c.voltou
                              ? <LinkContrato to={`/controle/visita/${c.voltou.visita_id}`}
                                  className="tabular text-af-200 hover:underline" title="A revisita">
                                  {diaMes(c.voltou.dia)} · {c.voltou.dias} d
                                </LinkContrato>
                              : <span className="text-graf-400">não</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </Painel>

          {vaiVoltar.length > 0 && (
            <Painel titulo="Vai voltar · VT reagendada ou cancelada"
              dica="Sem nota: a VT que não foi concluída volta por construção. Sem Auditar e sem cancelado pela central.">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                      <th className="py-2 pr-3 font-medium">Contrato</th>
                      <th className="w-56 py-2 pr-3 font-medium">Baixa</th>
                      <th className="w-48 py-2 pr-3 font-medium">Equipe</th>
                      <th className="w-28 py-2 font-medium">Voltou</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graf-800">
                    {vaiVoltar.map(c => (
                      <tr key={c.visita_id} className="align-top">
                        <td className="py-2 pr-3">
                          <LinkContrato to={`/controle/visita/${c.visita_id}`} className="tabular font-medium text-graf-200 hover:underline">
                            {c.contrato ?? 'sem número'}
                          </LinkContrato>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="text-graf-300">{c.situacao_label ?? c.situacao}</div>
                          <div className="truncate text-xs text-graf-400" title={c.baixa ?? undefined}>{c.baixa ?? 'sem código'}</div>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="truncate text-graf-300">{c.equipe ?? 'sem equipe'}</div>
                          <div className="truncate text-xs text-graf-400">{c.tecnico ?? 'sem técnico'}</div>
                        </td>
                        <td className="py-2 text-xs">
                          {c.voltou
                            ? <LinkContrato to={`/controle/visita/${c.voltou.visita_id}`}
                                className="tabular text-af-200 hover:underline" title="A revisita">
                                {diaMes(c.voltou.dia)} · {c.voltou.dias} d
                              </LinkContrato>
                            : <span className="text-graf-400">não</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Painel>
          )}

          {reguas.map(([s, g]) => (
            <Painel key={s} titulo={`O que pesa nesta cidade · ${SERVICO[s]}`}
              dica={`Serviços de ${dataBR(g.de)} a ${dataBR(g.ate)} · ${g.revisitas} de ${g.n} voltaram`}>
              {g.fatores.length === 0
                ? <p className="py-6 text-center text-sm text-graf-400">Nenhum fator acima da revisita da cidade.</p>
                : <TabelaSimples colunas={['Fator', 'Revisita', '× cidade', 'Serviços']}
                    linhas={g.fatores.map(f => [
                      rotuloFator(f.familia, f.valor, f.rotulo), `${pctBR(f.taxa)}%`, `${vezes(f.razao)}×`, f.n,
                    ])} />}
            </Painel>
          ))}
        </>)}
      </div>
    </Shell>
  )
}
