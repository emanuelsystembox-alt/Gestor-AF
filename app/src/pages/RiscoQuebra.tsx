import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Metrica, Vazio } from '../components/ui'
import { Painel, TabelaSimples } from '../components/graficos'
import { LinkContrato } from '../components/LinkContrato'
import { dataBR } from '../lib/formato'

/**
 * Risco de quebra antes do despacho (181).
 *
 * Os contratos de HOJE ainda não executados (na entrada, atribuídos, a
 * caminho), com a faixa e os motivos. Quem decide a faixa é o banco
 * (`risco_quebra_do_dia`): cada motivo é um fator que, no histórico da
 * própria cidade (60 dias antes de hoje), quebrou acima da taxa da cidade
 * com folga estatística. Nenhum peso escrito à mão.
 *
 * É SUGESTÃO para a gestão, no site (D-262): ligar antes para o cliente ou
 * mandar o técnico mais experiente. Nada muda sozinho e nada vai para o app.
 * Sem histórico suficiente (menos de 300 contratos com resultado), a faixa é
 * "sem histórico" — não "baixo" (regra 6).
 */

type Faixa = 'ALTO' | 'MEDIO' | 'BAIXO' | 'SEM_HISTORICO'

interface Motivo {
  familia: string; valor: string; detalhe: string | null
  taxa: number; razao: number; n: number
}
interface Contrato {
  visita_id: string; contrato: string | null; bairro: string | null; grupo: string | null
  situacao: string; situacao_label: string | null
  janela_inicio: string | null; janela_fim: string | null
  equipe_id: string | null; equipe: string | null; tecnico: string | null
  faixa: Faixa; fator: number | null; motivos: Motivo[]
}
interface Fator { familia: string; valor: string; n: number; quebras: number; taxa: number; razao: number }
interface Risco {
  dia: string; cidade: string | null
  regua: { n: number; quebras: number; taxa: number; de: string; ate: string
    suficiente: boolean; calculado_em: string; fatores: Fator[] } | null
  contratos: Contrato[]
}

const FAIXA: Record<Faixa, { rotulo: string; classe: string }> = {
  ALTO:          { rotulo: 'Alto',          classe: 'bg-af-900/40 text-af-200 ring-1 ring-af-700/50' },
  MEDIO:         { rotulo: 'Médio',         classe: 'bg-amber-900/30 text-amber-200 ring-1 ring-amber-700/50' },
  BAIXO:         { rotulo: 'Baixo',         classe: 'bg-graf-800 text-graf-300' },
  SEM_HISTORICO: { rotulo: 'Sem histórico', classe: 'bg-graf-800 text-graf-300' },
}

const VAI_E_VOLTA: Record<string, string> = { VT_DA_VT: 'VT da VT', RETORNO_DO_RETORNO: 'Retorno do retorno' }

/** O nome do fator como a operação fala. */
function rotuloFator(familia: string, valor: string): string {
  switch (familia) {
    case 'GRUPO': return valor
    case 'BAIRRO': return `Bairro ${valor}`
    case 'JANELA': return `Janela das ${valor}`
    case 'SEGMENTACAO': return `Segmento ${valor}`
    case 'EDIFICACAO': return valor === 'APTO' ? 'Apartamento' : valor === 'LOJA' ? 'Loja' : valor === 'BECO' ? 'Beco' : 'Casa'
    case 'LOG': return `LOG ${valor}`
    case 'ANTERIOR': return 'Passou e não concluiu'
    case 'VAI_E_VOLTA': return VAI_E_VOLTA[valor] ?? valor
    case 'REVISITA': return 'Revisita'
    default: return `${familia} ${valor}`
  }
}

const pctBR = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const vezes = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function Etiqueta({ m }: { m: Motivo }) {
  const dica = `${pctBR(m.taxa)}% quebraram em ${m.n} contratos · ${vezes(m.razao)}× a cidade`
    + (m.detalhe ? ` · ${m.detalhe}` : '')
  return (
    <span title={dica}
      className="inline-flex items-center gap-1 rounded bg-graf-800 px-1.5 py-0.5 text-[11px] text-graf-200">
      {rotuloFator(m.familia, m.valor)}
      <span className="tabular text-graf-300">{pctBR(m.taxa)}%</span>
    </span>
  )
}

export default function RiscoQuebra() {
  const [r, setR] = useState<Risco | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [faixa, setFaixa] = useState<'TODAS' | Faixa>('TODAS')
  const [equipe, setEquipe] = useState('')

  const carregar = useCallback(() => {
    setErro(null); setCarregando(true)
    supabase.rpc('risco_quebra_do_dia').then(({ data, error }) => {
      setCarregando(false)
      if (error) { setErro(error.message); setR(null); return }
      setR((data as Risco | null) ?? null)
    })
  }, [])
  useEffect(carregar, [carregar])

  const contratos = r?.contratos ?? []
  const equipes = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contratos) if (c.equipe_id) m.set(c.equipe_id, c.equipe ?? 'sem código')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [contratos])
  const visiveis = contratos.filter(c =>
    (faixa === 'TODAS' || c.faixa === faixa) && (!equipe || c.equipe_id === equipe))
  const conta = (f: Faixa) => contratos.filter(c => c.faixa === f).length
  const regua = r?.regua ?? null

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Risco de quebra</h1>
            {r && (
              <p className="mt-0.5 text-sm text-graf-400">
                {r.cidade ?? '—'} · hoje, {dataBR(r.dia)} · contratos ainda não executados
              </p>
            )}
          </div>
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
        {r === undefined && <p className="py-10 text-center text-sm text-graf-400">Carregando…</p>}

        {r && regua && !regua.suficiente && (
          <Alerta tipo="info">
            Histórico curto nesta cidade: {regua.n} contratos com resultado de {dataBR(regua.de)} a{' '}
            {dataBR(regua.ate)} (a faixa precisa de 300).
          </Alerta>
        )}

        {r && (<>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metrica valor={contratos.length} rotulo="A executar" />
            <Metrica valor={conta('ALTO')} rotulo="Risco alto" alerta={conta('ALTO') > 0} />
            <Metrica valor={conta('MEDIO')} rotulo="Risco médio" />
            {/* Sem régua, "—": a taxa da cidade é desconhecida, não 0% (regra 6). */}
            <Metrica valor={regua && regua.n > 0 ? `${pctBR(regua.taxa)}%` : '—'}
              rotulo={regua ? `Quebra da cidade · ${regua.n} contratos` : 'Quebra da cidade'} />
          </div>

          <Painel titulo="Contratos por risco"
            dica="Alto = o dobro da quebra da cidade ou mais · médio = algum motivo">
            {visiveis.length === 0
              ? <Vazio titulo={contratos.length === 0 ? 'Nenhum contrato a executar agora' : 'Nenhum contrato neste filtro'} />
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
                        <th className="w-28 py-2 pr-3 font-medium">Faixa</th>
                        <th className="py-2 pr-3 font-medium">Contrato</th>
                        <th className="w-28 py-2 pr-3 font-medium">Janela</th>
                        <th className="w-48 py-2 pr-3 font-medium">Equipe</th>
                        <th className="py-2 font-medium">Motivos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-graf-800">
                      {visiveis.map(c => (
                        <tr key={c.visita_id} className="align-top">
                          <td className="py-2 pr-3">
                            <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${FAIXA[c.faixa].classe}`}
                              title={c.fator != null ? `${vezes(c.fator)}× a quebra da cidade` : undefined}>
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
                          </td>
                          <td className="tabular py-2 pr-3 text-graf-300">
                            {c.janela_inicio ? `${c.janela_inicio}–${c.janela_fim ?? '?'}` : '—'}
                            <div className="text-xs text-graf-400">{c.situacao_label ?? c.situacao}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="truncate text-graf-300">{c.equipe ?? 'sem equipe'}</div>
                            <div className="truncate text-xs text-graf-400">{c.tecnico ?? 'sem técnico'}</div>
                          </td>
                          <td className="py-2">
                            {c.motivos.length === 0
                              ? <span className="text-xs text-graf-400">—</span>
                              : <div className="flex flex-wrap gap-1">
                                  {c.motivos.map(m => <Etiqueta key={`${m.familia}:${m.valor}`} m={m} />)}
                                </div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </Painel>

          {regua && (
            <Painel titulo="O que pesa nesta cidade"
              dica={`Histórico de ${dataBR(regua.de)} a ${dataBR(regua.ate)} · ${regua.quebras} de ${regua.n} quebraram`}>
              {regua.fatores.length === 0
                ? <p className="py-6 text-center text-sm text-graf-400">Nenhum fator acima da quebra da cidade.</p>
                : <TabelaSimples colunas={['Fator', 'Quebra', '× cidade', 'Contratos']}
                    linhas={regua.fatores.map(f => [
                      rotuloFator(f.familia, f.valor), `${pctBR(f.taxa)}%`, `${vezes(f.razao)}×`, f.n,
                    ])} />}
            </Painel>
          )}
        </>)}
      </div>
    </Shell>
  )
}
