import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isoLocal } from '../lib/formato'
import { Alerta, Vazio } from './ui'

/**
 * Movimentações e pesquisa — o "Movimentações", o "Pesquisar Serial" e a
 * "Pesquisa em Lote" do concorrente, numa aba (089-G, D-165).
 *
 * ┌─ UMA HISTÓRIA, QUATRO FONTES ────────────────────────────────────┐
 * │ A vida de uma peça estava espalhada: a carga do Atlas, as        │
 * │ declarações de estado (085), os romaneios e o que o campo lançou │
 * │ na baixa (079). `estoque_historico_serial` junta as quatro em    │
 * │ ordem — a pergunta "onde esta peça esteve?" tem uma resposta só. │
 * └───────────────────────────────────────────────────────────────────┘
 */

interface Mov {
  quando: string; tipo: string; documento: string; serial: string | null; item: string | null
  quantidade: number; de: string | null; para: string | null; quem: string | null
}
interface Evento { quando: string; tipo: string; descricao: string; quem: string | null }
interface Achado {
  serial: string; tipo: string | null; modelo: string | null; estado_atlas: string | null
  estado_afline: string | null; posse: string | null; condicao: string | null
  tecnico: { nome: string } | null
}

const ROTULO: Record<string, string> = {
  ENTREGA: 'Entrega', DEVOLUCAO: 'Devolução', TRANSFERENCIA: 'Transferência',
  ENTRADA: 'Entrada', AJUSTE: 'Ajuste', CONSUMO: 'Consumo no contrato',
  CAMPO_INSTALADO: 'Instalado no cliente', CAMPO_RETIRADO: 'Retirado do cliente',
  CARGA: 'Carga do Atlas', ESTADO: 'Estado', ROMANEIO: 'Romaneio', CAMPO: 'Campo',
}
const POSSE: Record<string, string> = {
  NO_ALMOXARIFADO: 'no almoxarifado', COM_TECNICO: 'com técnico', COM_ASSINANTE: 'com o cliente',
}
const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'
const menosDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d) }
const normalizar = (s: string) => s.toUpperCase().replace(/\s/g, '')

export function Movimentacoes() {
  const [de, setDe] = useState(menosDias(7))
  const [ate, setAte] = useState(isoLocal())
  const [filtro, setFiltro] = useState('')
  const [movs, setMovs] = useState<Mov[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [serial, setSerial] = useState('')
  const [historia, setHistoria] = useState<Evento[] | null>(null)

  const [lote, setLote] = useState('')
  const [achados, setAchados] = useState<Achado[] | null>(null)
  const [faltaram, setFaltaram] = useState<string[]>([])

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('estoque_movimentacoes', { p_de: de, p_ate: ate })
    if (error) setErro(error.message)
    setMovs((data ?? []) as Mov[])
    setCarregando(false)
  }, [de, ate])
  useEffect(() => { carregar() }, [carregar])

  const tipos = useMemo(() => [...new Set(movs.map(m => m.tipo))], [movs])
  const lista = filtro ? movs.filter(m => m.tipo === filtro) : movs

  async function pesquisarSerial(s = serial) {
    if (!s.trim()) return
    setSerial(s)
    const { data, error } = await supabase.rpc('estoque_historico_serial', { p_serial: s })
    if (error) setErro(error.message)
    else setHistoria((data ?? []) as Evento[])
  }

  async function pesquisarLote() {
    const seriais = [...new Set(lote.split(/[\s,;]+/).map(normalizar).filter(x => /[0-9A-Z]{3,}/.test(x)))]
    if (seriais.length === 0) return
    const resultado: Achado[] = []
    // Em fatias: 500 seriais na URL de um `in (...)` estoura o limite do GET.
    for (let i = 0; i < seriais.length; i += 150) {
      const { data, error } = await supabase.from('equipamento')
        .select('serial, tipo, modelo, estado_atlas, estado_afline, posse, condicao, tecnico:posse_tecnico_id ( nome )')
        .in('serial', seriais.slice(i, i + 150))
      if (error) { setErro(error.message); return }
      resultado.push(...((data ?? []) as unknown as Achado[]))
    }
    const vistos = new Set(resultado.map(a => a.serial))
    setAchados(resultado)
    setFaltaram(seriais.filter(s => !vistos.has(s)))
  }

  return (
    <div className="space-y-4">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- a vida de um serial ---- */}
        <section className="card-controle p-4">
          <h2 className="text-sm font-semibold">Pesquisar serial</h2>
          <div className="mt-2 flex gap-2">
            <input value={serial} onChange={e => setSerial(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') pesquisarSerial() }}
              placeholder="bipe ou digite o serial" aria-label="Serial"
              className={`${campo} flex-1 font-mono`} />
            <button onClick={() => pesquisarSerial()} disabled={!serial.trim()}
              className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium text-white
                         hover:bg-af-500 disabled:opacity-40">
              ver histórico
            </button>
          </div>
          {historia && (historia.length === 0 ? (
            <p className="mt-2 text-xs text-graf-400">Serial não está na carga.</p>
          ) : (
            <ol className="mt-3 space-y-1.5 border-l border-graf-700 pl-3">
              {historia.map((h, i) => (
                <li key={i} className="text-xs">
                  <span className="tabular text-graf-400">{new Date(h.quando).toLocaleString('pt-BR')}</span>
                  {' · '}<strong className="text-graf-100">{ROTULO[h.tipo] ?? h.tipo}</strong>
                  <span className="block text-graf-300">{h.descricao}</span>
                  {h.quem && <span className="block text-[10px] text-graf-400">{h.quem}</span>}
                </li>
              ))}
            </ol>
          ))}
        </section>

        {/* ---- vários de uma vez ---- */}
        <section className="card-controle p-4">
          <h2 className="text-sm font-semibold">Pesquisa em lote</h2>
          <textarea value={lote} onChange={e => setLote(e.target.value)} rows={4}
            placeholder="cole a coluna de seriais — onde está cada um?"
            aria-label="Seriais para pesquisar" className={`${campo} mt-2 w-full font-mono`} />
          <button onClick={pesquisarLote} disabled={!lote.trim()}
            className="mt-1 rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-200
                       hover:border-af-600 disabled:opacity-40">
            pesquisar
          </button>
          {achados && (
            <div className="mt-2">
              {faltaram.length > 0 && (
                <p className="text-[11px] text-amber-300">
                  {faltaram.length} fora da carga: {faltaram.slice(0, 12).join(', ')}{faltaram.length > 12 && '…'}
                </p>
              )}
              <ul className="mt-1 max-h-60 overflow-auto text-xs">
                {achados.map(a => (
                  <li key={a.serial} className="flex gap-2 border-b border-graf-800 py-1">
                    <button onClick={() => pesquisarSerial(a.serial)}
                      className="tabular w-40 shrink-0 text-left font-mono text-af-300 underline-offset-2 hover:underline">
                      {a.serial}
                    </button>
                    <span className="min-w-0 flex-1 truncate text-graf-300">
                      {a.posse ? POSSE[a.posse] ?? a.posse : 'sem posse declarada'}
                      {a.tecnico && ` (${a.tecnico.nome})`}
                      {a.condicao && ` · ${a.condicao.toLowerCase()}`}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase text-graf-400">
                      {a.estado_afline ?? a.estado_atlas ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ---- tudo o que andou no período ---- */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">De</span>
          <input type="date" value={de} onChange={e => setDe(e.target.value)} className={campo} />
        </label>
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">Até</span>
          <input type="date" value={ate} onChange={e => setAte(e.target.value)} className={campo} />
        </label>
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">Tipo</span>
          <select value={filtro} onChange={e => setFiltro(e.target.value)} className={`${campo} w-48`}>
            <option value="">todos</option>
            {tipos.map(t => <option key={t} value={t}>{ROTULO[t] ?? t}</option>)}
          </select>
        </label>
      </div>

      {carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : lista.length === 0 ? (
        <Vazio titulo="Nenhuma movimentação no período" />
      ) : (
        <section className="card-controle overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Quando</th>
                <th className="px-3 py-2 font-medium">Movimento</th>
                <th className="px-3 py-2 font-medium">O quê</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="px-3 py-2 font-medium">De → Para</th>
                <th className="px-3 py-2 font-medium">Quem</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m, i) => (
                <tr key={i} className="border-b border-graf-800">
                  <td className="tabular px-3 py-1.5 text-xs text-graf-400">{new Date(m.quando).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-1.5 text-xs text-graf-200">
                    {ROTULO[m.tipo] ?? m.tipo}
                    <span className="block text-[10px] text-graf-400">{m.documento}</span>
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {m.serial ? (
                      <button onClick={() => pesquisarSerial(m.serial!)}
                        className="font-mono text-af-300 underline-offset-2 hover:underline">{m.serial}</button>
                    ) : <span className="text-graf-300">{m.item}</span>}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                    {Number(m.quantidade).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">{m.de ?? '—'} → {m.para ?? '—'}</td>
                  <td className="px-3 py-1.5 text-xs text-graf-400">{m.quem ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
