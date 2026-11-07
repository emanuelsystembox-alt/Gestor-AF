import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta } from './ui'

/**
 * A ENTRADA de material no estoque da cidade (228, D-339).
 *
 * > "copiar a parte de pagar o técnico, devoluções, entrada de material
 * >  (...) temos que fazer parecido" — Emanuel, 07/11
 *
 * Bipa (ou cola) os seriais — o Enter do leitor já pula a linha na caixa —,
 * diz em que condição chegam (sem padrão, como a devolução) e dá entrada:
 * a peça da carga do Atlas que estava SEM POSSE, em trânsito ou devolvida à
 * CLARO passa a estar NO ALMOXARIFADO. O banco confere peça a peça
 * (`registrar_entrada`): com o técnico volta pela Devolução, no contrato
 * volta pelo técnico, e o que não está na carga do Atlas é recusado — a
 * entrada não inventa peça. Serial ou MAC (o "Endereçável" do Atlas).
 */

type Condicao = 'INICIALIZADO' | 'RETIRADO' | 'COM_DEFEITO'
const CONDICOES: { valor: Condicao; rotulo: string; ajuda: string }[] = [
  { valor: 'INICIALIZADO', rotulo: 'Inicializado', ajuda: 'peça boa, pronta para entregar' },
  { valor: 'RETIRADO', rotulo: 'Retirado', ajuda: 'veio da casa do cliente' },
  { valor: 'COM_DEFEITO', rotulo: 'Com defeito', ajuda: 'não serve para instalar' },
]
const LOTE = 500

interface Linha { serial: string; ok: boolean; erro?: string; alerta?: string | null }
interface Doc {
  id: string; numero: number; condicao: Condicao; observacao: string | null; criado_em: string
  itens: { count: number }[]; autor: { nome: string } | null
}

const separar = (t: string) => [...new Set(t.split(/[\s,;]+/).map(x => x.trim().toUpperCase())
  .filter(x => /[0-9A-Z]{3,}/.test(x)))]

export function Entrada({ podeMexer }: { podeMexer: boolean }) {
  const [texto, setTexto] = useState('')
  const [condicao, setCondicao] = useState<Condicao | ''>('')
  const [obs, setObs] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ numero: number | null; lancadas: number; recusadas: number; linhas: Linha[] } | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('estoque_entrada')
      .select('id, numero, condicao, observacao, criado_em, criado_por, itens:estoque_entrada_item ( count )')
      .order('numero', { ascending: false }).limit(30)
    const lista = (data ?? []) as unknown as (Doc & { criado_por: string | null })[]
    // o autor aponta para auth.users (não há embed para perfil): o nome vem à parte
    const ids = [...new Set(lista.map(d => d.criado_por).filter((x): x is string => !!x))]
    const { data: ps } = ids.length
      ? await supabase.from('perfil').select('id, nome').in('id', ids)
      : { data: [] as { id: string; nome: string }[] }
    const nome = new Map((ps ?? []).map(p => [p.id, p.nome]))
    setDocs(lista.map(d => ({ ...d, autor: d.criado_por ? { nome: nome.get(d.criado_por) ?? '—' } : null })))
  }, [])
  useEffect(() => { carregar() }, [carregar])

  const seriais = separar(texto)

  async function darEntrada() {
    if (!condicao || seriais.length === 0) return
    setOcupado(true); setErro(null); setResultado(null)
    const junto = { numero: null as number | null, lancadas: 0, recusadas: 0, linhas: [] as Linha[] }
    for (let i = 0; i < seriais.length; i += LOTE) {
      const { data, error } = await supabase.rpc('registrar_entrada', {
        p_seriais: seriais.slice(i, i + LOTE), p_condicao: condicao, p_observacao: obs || null,
      })
      if (error) {
        setErro(/permiss/i.test(error.message)
          ? 'Seu perfil não inclui "Declarar a posse" no almoxarifado. A barreira é do banco.' : error.message)
        break
      }
      const r = data as typeof junto
      junto.numero = r.numero ?? junto.numero
      junto.lancadas += r.lancadas; junto.recusadas += r.recusadas; junto.linhas.push(...r.linhas)
    }
    setResultado(junto)
    // os recusados ficam na caixa, para corrigir e mandar de novo
    setTexto(junto.linhas.filter(l => !l.ok).map(l => l.serial).join('\n'))
    await carregar()
    setOcupado(false)
  }

  const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs outline-none focus:border-af-500'

  return (
    <div className="space-y-4">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {podeMexer && (
        <section className="card-controle p-4">
          <h2 className="text-sm font-semibold">Entrada de serializado</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_20rem]">
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 flex items-baseline justify-between">
                Seriais ou MAC — bipe ou cole, um por linha
                <span className="tabular text-graf-300">{seriais.length} serial(is)</span>
              </span>
              <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={8} autoFocus
                className={`${campo} w-full font-mono`} placeholder={'ZTE3ANNT7U40190\n589204039F18\n…'} />
            </label>
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1 text-[11px] text-graf-400">Em que condição chegam?</legend>
                <div className="grid gap-1.5">
                  {CONDICOES.map(c => (
                    <button key={c.valor} type="button" onClick={() => setCondicao(c.valor)}
                      aria-pressed={condicao === c.valor}
                      className={`rounded-md border px-3 py-1.5 text-left text-xs ${
                        condicao === c.valor ? 'border-af-500 bg-af-900/30 text-graf-100'
                                             : 'border-graf-700 text-graf-300 hover:border-graf-600'}`}>
                      <span className="block font-medium">{c.rotulo}</span>
                      <span className="block text-[10px] text-graf-400">{c.ajuda}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="block text-[11px] text-graf-400">
                <span className="mb-1 block">Observação / NF</span>
                <input value={obs} onChange={e => setObs(e.target.value)} className={`${campo} w-full`}
                  placeholder="nota fiscal, remessa da CLARO…" />
              </label>
              <button onClick={darEntrada} disabled={ocupado || !condicao || seriais.length === 0}
                className="w-full rounded-md bg-af-600 px-4 py-2 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-50">
                {ocupado ? 'Dando entrada…' : `Dar entrada${seriais.length ? ` (${seriais.length})` : ''}`}
              </button>
            </div>
          </div>

          {resultado && (
            <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900 p-3 text-xs">
              <p className="text-graf-200">
                {resultado.numero != null && <>Entrada <strong>{resultado.numero}</strong> · </>}
                <strong className="text-emerald-300">{resultado.lancadas}</strong> no estoque
                {resultado.recusadas > 0 && <> · <strong className="text-af-300">{resultado.recusadas}</strong> recusada(s) — ficaram na caixa</>}
              </p>
              {resultado.linhas.some(l => !l.ok || l.alerta) && (
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
                  {resultado.linhas.filter(l => !l.ok || l.alerta).map(l => (
                    <li key={l.serial} className={l.ok ? 'text-amber-300' : 'text-af-300'}>
                      <span className="font-mono">{l.serial}</span> — {l.ok ? `entrou, mas está como ${l.alerta}` : l.erro}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card-controle overflow-hidden">
        <h2 className="border-b border-graf-800 px-4 py-2.5 text-sm font-semibold">Últimas entradas</h2>
        {docs.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-graf-400">Nenhuma entrada ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px] uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Nº</th>
                <th className="px-3 py-2 font-medium">Condição</th>
                <th className="px-3 py-2 text-right font-medium">Peças</th>
                <th className="px-3 py-2 font-medium">Observação</th>
                <th className="px-3 py-2 font-medium">Quem</th>
                <th className="px-3 py-2 font-medium">Quando</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id} className="border-b border-graf-800">
                  <td className="tabular px-3 py-1.5 text-xs font-semibold text-graf-100">{d.numero}</td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">
                    {CONDICOES.find(c => c.valor === d.condicao)?.rotulo ?? d.condicao}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">{d.itens?.[0]?.count ?? 0}</td>
                  <td className="px-3 py-1.5 text-xs text-graf-400">{d.observacao ?? '—'}</td>
                  <td className="px-3 py-1.5 text-xs text-graf-400">{d.autor?.nome ?? '—'}</td>
                  <td className="tabular px-3 py-1.5 text-xs text-graf-400">{new Date(d.criado_em).toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
