import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Metrica, Vazio } from '../components/ui'
import { BarrasHorizontais, Painel, TabelaSimples } from '../components/graficos'
import { LinkContrato } from '../components/LinkContrato'
import { ROTULO_SINAL } from '../components/PainelCentral'
import type { Sinal } from '../lib/central'
import { dataBR, isoLocal } from '../lib/formato'

/**
 * O resumo do dia (177): a foto das 18h, por cidade.
 *
 * > "Resumo do dia automático às 18h para a coordenação: TEC1, quebras por
 * >  agrupamento, revisitas, quem ficou abaixo do ritmo, ocorrências do campo
 * >  e humor" — pacote de 02/11 (D-262); "na tela, com aviso no sino".
 *
 * É FOTO, não painel ao vivo: o número é o da hora em que foi gerado (o
 * rodapé diz quando e por quem). "Gerar agora" refaz o de hoje. Humor e
 * ocorrências chegam nulos para quem não tem a permissão — o banco corta.
 */

interface Resumo {
  dia: string; gerado_em: string; pelo_relogio: boolean; gerado_por: string | null; cidade: string
  operacao: {
    contratos: { total: number; concluidos: number; reagendados: number; cancelados: number; em_aberto: number; quebrados: number }
    tec1: { padrao: number; sem_padrao: number; meta: number }
    quebras: { agrupamento: string; quebras: number }[]
    revisitas: { total: number; contratos: { visita_id: string; contrato: string | null; grupo: string | null;
      anterior_grupo: string | null; anterior_tecnico: string | null; dias: number }[] }
    ritmo: { corte: number; abaixo: { tecnico_id: string; nome: string; equipe: string | null;
      feitos: number; esperado: number }[] } | null
    sinais: Record<string, number>
    tec1_risco: { avisados: number; sem_padrao: number; padrao: number }
  }
  humor: { escalados: number; sem_resposta: number; contagem: Record<string, number>;
    atencao: { tecnico: string; humor: string }[] } | null
  ocorrencias: { abertas_hoje: number; por_assunto: Record<string, number> } | null
}

const HUMORES: [string, string][] = [
  ['FELIZ', 'Feliz'], ['INDIFERENTE', 'Indiferente'], ['DESANIMADO', 'Desanimado'],
  ['TRISTE', 'Triste'], ['ESTRESSADO', 'Estressado'],
]
const hora = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const pctBR = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export default function ResumoDoDia() {
  const hoje = isoLocal()
  const [dia, setDia] = useState(hoje)
  const [dias, setDias] = useState<string[]>([])
  const [r, setR] = useState<Resumo | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(() => {
    setErro(null)
    supabase.rpc('resumos_guardados').then(({ data }) => setDias((data as string[] | null) ?? []))
    supabase.rpc('resumo_do_dia', { p_dia: dia }).then(({ data, error }) => {
      if (error) { setErro(error.message); setR(null); return }
      setR((data as Resumo | null) ?? null)
    })
  }, [dia])
  useEffect(carregar, [carregar])

  const gerar = async () => {
    setGerando(true); setErro(null)
    const { error } = await supabase.rpc('gerar_resumo_do_dia')
    setGerando(false)
    if (error) setErro(error.message); else carregar()
  }

  const opcoes = Array.from(new Set([hoje, ...dias])).sort().reverse()
  const op = r?.operacao
  const t1 = op ? op.tec1.padrao + op.tec1.sem_padrao : 0
  const tec1 = op && t1 > 0 ? (100 * op.tec1.padrao) / t1 : null

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Resumo do dia</h1>
            {r && (
              <p className="mt-0.5 text-sm text-graf-400">
                {r.cidade} · gerado às {hora(r.gerado_em)} {r.pelo_relogio ? 'pelo relógio' : `por ${r.gerado_por ?? '—'}`}
              </p>
            )}
          </div>
          <label className="text-xs text-graf-400">
            <span className="sr-only">Dia</span>
            <select value={dia} onChange={e => setDia(e.target.value)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm text-graf-100">
              {opcoes.map(d => <option key={d} value={d}>{d === hoje ? `Hoje · ${dataBR(d)}` : dataBR(d)}</option>)}
            </select>
          </label>
          {dia === hoje && (
            <button onClick={gerar} disabled={gerando}
              title="Refaz a foto de hoje com os números de agora"
              className="rounded-md bg-af-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-af-500 disabled:opacity-60">
              {gerando ? 'Gerando…' : 'Gerar agora'}
            </button>
          )}
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {r === undefined && <p className="py-10 text-center text-sm text-graf-400">Carregando…</p>}
        {r === null && !erro && (
          <Vazio titulo={dia === hoje ? 'O resumo de hoje sai às 18h' : 'Sem resumo neste dia'} />
        )}

        {r && op && (<>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metrica valor={op.contratos.total} rotulo="Contratos" />
            <Metrica valor={op.contratos.concluidos} rotulo="Concluídos" />
            <Metrica valor={op.contratos.quebrados} rotulo="Quebrados" alerta={op.contratos.quebrados > 0} />
            <Metrica valor={op.contratos.em_aberto} rotulo="Em aberto" />
            {/* Sem O.S. encerrada no TOA não há TEC1: "—", não 0% (regra 6). */}
            <Metrica valor={tec1 == null ? '—' : `${pctBR(tec1)}%`} rotulo={`TEC1 · meta ${op.tec1.meta}%`}
              cor={tec1 == null ? undefined : tec1 >= op.tec1.meta ? '#34d399' : '#f87171'} />
            <Metrica valor={op.revisitas.total} rotulo="Revisitas" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Painel titulo="Quebras por agrupamento"
              tabela={<TabelaSimples colunas={['Agrupamento', 'Quebras']}
                linhas={op.quebras.map(q => [q.agrupamento, q.quebras])} />}>
              <BarrasHorizontais parte rotuloLargo
                dados={op.quebras.map(q => ({ rotulo: q.agrupamento, valor: q.quebras }))} />
            </Painel>

            <Painel titulo={op.ritmo ? `Abaixo do ritmo até ${op.ritmo.corte}h` : 'Abaixo do ritmo'}>
              {!op.ritmo || op.ritmo.abaixo.length === 0
                ? <p className="py-6 text-center text-sm text-graf-400">Ninguém abaixo do ritmo.</p>
                : <ul className="max-h-72 divide-y divide-graf-800 overflow-y-auto text-sm">
                    {op.ritmo.abaixo.map(a => (
                      <li key={a.tecnico_id} className="flex items-center gap-2 py-1.5">
                        <Link to={`/controle/equipes?tecnico=${a.tecnico_id}`} className="min-w-0 flex-1 truncate hover:underline">
                          {a.nome}
                        </Link>
                        {a.equipe && <span className="text-xs text-graf-400">equipe {a.equipe}</span>}
                        <span className="tabular w-16 text-right text-xs text-graf-300">{a.feitos} de {Number(a.esperado)}</span>
                      </li>
                    ))}
                  </ul>}
            </Painel>

            <Painel titulo="Revisitas" dica="Serviço concluído que voltou em até 30 dias">
              {op.revisitas.contratos.length === 0
                ? <p className="py-6 text-center text-sm text-graf-400">Nenhuma revisita.</p>
                : <ul className="max-h-72 divide-y divide-graf-800 overflow-y-auto text-sm">
                    {op.revisitas.contratos.map(c => (
                      <li key={c.visita_id} className="flex items-center gap-2 py-1.5">
                        <LinkContrato to={`/controle/visita/${c.visita_id}`} className="tabular hover:underline">
                          {c.contrato ?? 'sem número'}
                        </LinkContrato>
                        <span className="min-w-0 flex-1 truncate text-xs text-graf-300"
                          title={`Antes: ${c.anterior_grupo ?? '—'} por ${c.anterior_tecnico ?? '—'}`}>
                          {c.grupo ?? '—'} · antes {c.anterior_grupo ?? '—'}, {c.anterior_tecnico ?? '—'}
                        </span>
                        <span className="tabular text-xs text-graf-400">{c.dias} d</span>
                      </li>
                    ))}
                  </ul>}
            </Painel>

            <Painel titulo="O que a central sinalizou">
              <TabelaSimples colunas={['Sinal', 'Quantos']}
                linhas={Object.entries(op.sinais).sort((a, b) => b[1] - a[1])
                  .map(([tipo, n]) => [ROTULO_SINAL[tipo as Sinal['tipo']] ?? tipo, n])} />
              {op.tec1_risco.avisados > 0 && (
                <p className="mt-3 text-xs text-graf-300">
                  TEC1 em risco: {op.tec1_risco.avisados} avisado(s) · {op.tec1_risco.sem_padrao} fecharam sem padrão ·{' '}
                  {op.tec1_risco.padrao} com padrão
                </p>
              )}
            </Painel>

            {r.humor && (
              <Painel titulo="Humor dos escalados" dica={`${r.humor.escalados} escalado(s)`}>
                <BarrasHorizontais parte rotuloLargo dados={[
                  ...HUMORES.map(([k, rot]) => ({ rotulo: rot, valor: r.humor!.contagem[k] ?? 0 })),
                  { rotulo: 'Sem resposta', valor: r.humor.sem_resposta, cor: 'var(--color-graf-700)' },
                ]} />
                {r.humor.atencao.length > 0 && (
                  <p className="mt-3 text-xs text-graf-300">
                    {r.humor.atencao.map(a => `${a.tecnico} (${a.humor.toLowerCase()})`).join(' · ')}
                  </p>
                )}
              </Painel>
            )}

            {r.ocorrencias && (
              <Painel titulo="Ocorrências do campo" dica={`${r.ocorrencias.abertas_hoje} aberta(s) hoje`}>
                {r.ocorrencias.abertas_hoje === 0
                  ? <p className="py-6 text-center text-sm text-graf-400">Nenhuma ocorrência hoje.</p>
                  : <TabelaSimples colunas={['Assunto', 'Quantas']}
                      linhas={Object.entries(r.ocorrencias.por_assunto)} />}
              </Painel>
            )}
          </div>
        </>)}
      </div>
    </Shell>
  )
}
