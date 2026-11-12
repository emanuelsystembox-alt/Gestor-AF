import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Metrica, Vazio, CarregandoBloco } from '../components/ui'
import { Painel } from '../components/graficos'
import { LinkContrato } from '../components/LinkContrato'
import { dataBR, diaMes, isoLocal } from '../lib/formato'

/**
 * Node em degradação (262).
 *
 * VT acumulando no mesmo node com cara de falha de REDE da CLARO, não do
 * técnico. Quem decide é o banco (`nodes_em_degradacao`), com duas regras
 * medidas no histórico (o cabeçalho da 262 tem os números):
 *   · INFRA — 2+ contratos do node baixados INFRA CLARO em 72 h, improvável
 *     por acaso para o tamanho do node (Poisson < 0,01);
 *   · PICO — 3+ contratos em 48 h, muito acima da base do próprio node, com
 *     um indício de rede (1 INFRA CLARO, ou 2 com sinal inicial irregular).
 * Volume sozinho NÃO alerta: no histórico, pico sem indício teve a mesma
 * infra depois que qualquer node.
 *
 * É SUGESTÃO para a gestão, no site (D-262): segurar despacho repetido,
 * juntar prova para contestar indicador, não punir o técnico pela rede.
 * Nada muda sozinho e nada vai para o app.
 *
 * O dia vazio é "hoje" recalculado a cada desenho — a tela fica aberta de um
 * dia para o outro (traps: o "hoje" gravado uma vez, D-342).
 */

type Regra = 'INFRA' | 'PICO'

interface Contrato {
  visita_id: string; contrato: string | null; dia: string
  situacao: string; situacao_label: string | null
  equipe: string | null; codigos: string | null; infra: boolean
  sinal_inicial: string | null
}
interface NodeAlerta {
  node: string; area: string | null
  vt_48h: number; vt_72h: number; base_48h: number; vezes: number | null
  p_volume: number; infra_72h: number; infra_esperado: number | null; p_infra: number | null
  irregular_48h: number; lidos_48h: number; abertos_hoje: number
  regras: Regra[]; porque: string
  ruas: { rua: string; n: number }[]
  contratos: Contrato[]; fora_do_alcance: number
}
interface Resposta {
  dia: string; cidade: string | null
  regua: { de: string; ate: string; vt_por_node_dia: number | null; taxa_infra: number | null
    nodes_avaliados: number; corte: number } | null
  alertas: NodeAlerta[]
}

const REGRA: Record<Regra, { rotulo: string; dica: string; classe: string }> = {
  INFRA: { rotulo: 'Infra Claro', dica: 'Outros contratos do node já baixados como INFRA CLARO',
           classe: 'bg-af-900/40 text-af-200 ring-1 ring-af-700/50' },
  PICO:  { rotulo: 'Pico', dica: 'VT muito acima do normal do node, com indício de rede',
           classe: 'bg-amber-900/30 text-amber-200 ring-1 ring-amber-700/50' },
}

const um = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** O sinal inicial como a Claro escreve; sem leitura, "—" (não "regular"). */
function Sinal({ t }: { t: string | null }) {
  if (!t) return <span className="text-graf-400">—</span>
  const irregular = /irregular/i.test(t)
  return <span className={irregular ? 'text-af-300' : 'text-graf-300'}>{t}</span>
}

function CartaoNode({ a }: { a: NodeAlerta }) {
  return (
    <Painel titulo={`Node ${a.node}`}
      dica={[a.area ?? 'sem área', a.porque].join(' · ')}
      extra={
        <div className="flex flex-wrap gap-1">
          {a.regras.map(r => (
            <span key={r} title={REGRA[r].dica}
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${REGRA[r].classe}`}>
              {REGRA[r].rotulo}
            </span>
          ))}
        </div>
      }>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metrica valor={a.vt_48h} rotulo={`VT em 48 h · normal ${um(a.base_48h)}`} />
        <Metrica valor={a.infra_72h}
          rotulo={a.infra_esperado != null ? `Infra Claro em 72 h · esperado ${um(a.infra_esperado)}` : 'Infra Claro em 72 h'}
          alerta={a.regras.includes('INFRA')} />
        {/* Sem leitura do portal, "—": não se sabe, não é zero (regra 6). */}
        <Metrica valor={a.lidos_48h > 0 ? `${a.irregular_48h}/${a.lidos_48h}` : '—'}
          rotulo="Sinal inicial irregular" />
        <Metrica valor={a.abertos_hoje} rotulo="Em aberto hoje" alerta={a.abertos_hoje > 0} />
      </div>

      {a.ruas.length > 0 && (
        <p className="mb-2 text-xs text-graf-300">
          {a.ruas.map(r => `${r.rua} (${r.n})`).join(' · ')}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-graf-700 text-left text-[11px] uppercase tracking-wide text-graf-400">
              <th className="w-16 py-2 pr-3 font-medium">Dia</th>
              <th className="py-2 pr-3 font-medium">Contrato</th>
              <th className="w-24 py-2 pr-3 font-medium">Equipe</th>
              <th className="w-36 py-2 pr-3 font-medium">Sinal inicial</th>
              <th className="py-2 font-medium">Baixa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-graf-800">
            {a.contratos.map(c => (
              <tr key={c.visita_id} className="align-top">
                <td className="tabular py-2 pr-3 text-graf-300">{diaMes(c.dia)}</td>
                <td className="py-2 pr-3">
                  <LinkContrato to={`/controle/visita/${c.visita_id}`}
                    className="tabular font-medium text-graf-200 hover:underline">
                    {c.contrato ?? 'sem número'}
                  </LinkContrato>
                  <div className="text-xs text-graf-400">{c.situacao_label ?? c.situacao}</div>
                </td>
                <td className="py-2 pr-3 text-graf-300">{c.equipe ?? 'sem equipe'}</td>
                <td className="py-2 pr-3"><Sinal t={c.sinal_inicial} /></td>
                <td className="py-2">
                  {c.codigos
                    ? <span className={c.infra ? 'font-medium text-af-300' : 'text-graf-300'}>{c.codigos}</span>
                    : <span className="text-graf-400">sem baixa</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {a.fora_do_alcance > 0 && (
          <p className="mt-2 text-xs text-graf-400">
            + {a.fora_do_alcance} de equipes fora do seu alcance (contam no alerta)
          </p>
        )}
      </div>
    </Painel>
  )
}

export default function NodeDegradacao() {
  const [r, setR] = useState<Resposta | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  // nulo = hoje (recalculado a cada desenho, não gravado)
  const [dia, setDia] = useState<string | null>(null)
  const hoje = isoLocal()

  const carregar = useCallback(() => {
    setErro(null); setCarregando(true)
    supabase.rpc('nodes_em_degradacao', dia ? { p_dia: dia } : {}).then(({ data, error }) => {
      setCarregando(false)
      if (error) { setErro(error.message); setR(null); return }
      setR((data as Resposta | null) ?? null)
    })
  }, [dia])
  useEffect(carregar, [carregar])

  const alertas = r?.alertas ?? []
  const regua = r?.regua ?? null
  const comInfra = alertas.filter(a => a.regras.includes('INFRA')).length
  const abertos = alertas.reduce((s, a) => s + a.abertos_hoje, 0)

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Node em degradação</h1>
            {r && (
              <p className="mt-0.5 text-sm text-graf-400">
                {r.cidade ?? '—'} · {r.dia === hoje ? 'hoje, ' : ''}{dataBR(r.dia)} · VT de 48 a 72 h por node
              </p>
            )}
          </div>
          <label className="text-xs text-graf-400">
            <span className="sr-only">Dia</span>
            <input type="date" value={dia ?? hoje} max={hoje}
              onChange={e => setDia(e.target.value && e.target.value !== hoje ? e.target.value : null)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm text-graf-100" />
          </label>
          <button onClick={carregar} disabled={carregando}
            className="rounded-md border border-graf-700 px-3 py-1.5 text-sm text-graf-200 hover:bg-graf-800 disabled:opacity-60">
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {r === undefined && <CarregandoBloco className="py-10" />}

        {r && regua && regua.taxa_infra == null && (
          <Alerta tipo="info">
            Sem baixa com código de {dataBR(regua.de)} a {dataBR(regua.ate)}: a regra de Infra Claro não se avalia.
          </Alerta>
        )}

        {r && (<>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metrica valor={alertas.length} rotulo="Nodes em alerta" alerta={alertas.length > 0} />
            <Metrica valor={comInfra} rotulo="Com baixa Infra Claro" />
            <Metrica valor={abertos} rotulo="VT em aberto nesses nodes" />
            {/* Sem régua, "—": a taxa da cidade é desconhecida, não 0% (regra 6). */}
            <Metrica valor={regua?.taxa_infra != null ? `${um(regua.taxa_infra)}%` : '—'}
              rotulo={regua ? `Infra da cidade · ${regua.nodes_avaliados} nodes com VT no dia` : 'Infra da cidade'} />
          </div>

          {alertas.length === 0
            ? <Painel titulo="Nodes"><Vazio titulo="Nenhum node em degradação neste dia" /></Painel>
            : alertas.map(a => <CartaoNode key={a.node} a={a} />)}
        </>)}
      </div>
    </Shell>
  )
}
