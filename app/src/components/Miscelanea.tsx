import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta, Vazio } from './ui'

/**
 * Miscelânea — o que não tem série, tem quantidade (fase 2, D-154).
 *
 * ┌─ O SALDO É SOMA, NÃO COLUNA ─────────────────────────────────────┐
 * │ `miscelanea_saldos()` soma o razão a cada chamada. Não existe     │
 * │ campo `saldo` guardado — cache de número que a operação mexe      │
 * │ diverge calado, e num almoxarifado ele diverge no dia em que      │
 * │ alguém mexer num lançamento antigo (`traps.md`).                  │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ DOIS SALDOS POR ITEM, e é o que ele pediu ──────────────────────┐
 * │ > "cada item tem um saldo no almoxarifado e um saldo COM CADA     │
 * │ >  TÉCNICO" — Emanuel                                             │
 * │                                                                   │
 * │ A linha mostra os dois e abre o detalhe por técnico. É o que       │
 * │ responde "quanto de conector o Jeferson gastou" sem planilha.     │
 * └───────────────────────────────────────────────────────────────────┘
 */

interface Saldo {
  item_id: string; codigo: string; nome: string; unidade: string
  no_almoxarifado: number; com_tecnicos: number
  por_tecnico: { tecnico: string; matricula: string | null; qtd: number }[]
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

const qtd = (n: number) =>
  Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export function Miscelanea({ podeMexer }: { podeMexer: boolean }) {
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [detalhe, setDetalhe] = useState<string | null>(null)

  // novo item
  const [codigo, setCodigo] = useState('')
  const [nome, setNome] = useState('')
  const [unidade, setUnidade] = useState('UN')

  // entrada
  const [entItem, setEntItem] = useState('')
  const [entQtd, setEntQtd] = useState('')
  const [entMotivo, setEntMotivo] = useState('')
  const [entTipo, setEntTipo] = useState<'ENTRADA' | 'AJUSTE'>('ENTRADA')

  const recarregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.rpc('miscelanea_saldos')
    if (error) setErro(error.message)
    else setSaldos((data ?? []) as unknown as Saldo[])
    setCarregando(false)
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  function traduzir(msg: string) {
    return /permiss/i.test(msg)
      ? 'Seu perfil não inclui "Declarar a posse" no almoxarifado. A barreira é do banco.'
      : msg
  }

  async function criarItem() {
    if (!codigo.trim() || !nome.trim()) return
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('salvar_item_miscelanea', {
      p_id: null, p_codigo: codigo, p_nome: nome, p_unidade: unidade, p_ativo: true,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setOk(`Item ${codigo.toUpperCase()} cadastrado.`)
      setCodigo(''); setNome(''); setUnidade('UN')
      await recarregar()
    }
    setOcupado(false)
  }

  async function lancarEntrada() {
    if (!entItem || !entQtd) return
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('miscelanea_entrada', {
      p_item: entItem, p_quantidade: Number(entQtd.replace(',', '.')) || 0,
      p_motivo: entMotivo || null, p_tipo: entTipo,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setOk(entTipo === 'ENTRADA' ? 'Entrada lançada.' : 'Ajuste lançado.')
      setEntQtd(''); setEntMotivo('')
      await recarregar()
    }
    setOcupado(false)
  }

  return (
    <div className="space-y-4">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      {podeMexer && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card-controle p-4">
            <h2 className="text-sm font-semibold">Novo item</h2>
            <p className="mt-1 text-xs text-graf-400">
              Conector, cabo, fita — o que não tem número de série.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Código</span>
                <input value={codigo} onChange={e => setCodigo(e.target.value)}
                  placeholder="CON-RG6" className={`${campo} w-32`} />
              </label>
              <label className="min-w-44 flex-1 text-[11px] text-graf-400">
                <span className="mb-1 block">Nome</span>
                <input value={nome} onChange={e => setNome(e.target.value)}
                  placeholder="Conector RG6 compressão" className={`${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Unidade</span>
                <input value={unidade} onChange={e => setUnidade(e.target.value)}
                  placeholder="UN" className={`${campo} w-20`} />
              </label>
              <button onClick={criarItem} disabled={ocupado || !codigo.trim() || !nome.trim()}
                className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-50">
                Cadastrar
              </button>
            </div>
          </section>

          <section className="card-controle p-4">
            <h2 className="text-sm font-semibold">Entrada no almoxarifado</h2>
            {/* Sem entrada não há saída: a primeira entrega de um item
                sem saldo é recusada pelo banco, e conta que começa
                errada nunca mais fecha. */}
            <p className="mt-1 text-xs text-graf-400">
              Compra, recebimento ou acerto. <strong>Ajuste</strong> aceita número
              negativo e <strong>exige motivo</strong>.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Tipo</span>
                <select value={entTipo} className={`${campo} w-28`}
                  onChange={e => setEntTipo(e.target.value as 'ENTRADA' | 'AJUSTE')}>
                  <option value="ENTRADA">Entrada</option>
                  <option value="AJUSTE">Ajuste</option>
                </select>
              </label>
              <label className="min-w-40 flex-1 text-[11px] text-graf-400">
                <span className="mb-1 block">Item</span>
                <select value={entItem} onChange={e => setEntItem(e.target.value)}
                  className={`${campo} w-full`}>
                  <option value="">— escolha —</option>
                  {saldos.map(s => (
                    <option key={s.item_id} value={s.item_id}>
                      {s.codigo} · {s.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Quantidade</span>
                <input value={entQtd} onChange={e => setEntQtd(e.target.value)}
                  inputMode="decimal" className={`${campo} w-24 text-right`} />
              </label>
              <label className="min-w-36 flex-1 text-[11px] text-graf-400">
                <span className="mb-1 block">
                  Motivo{entTipo === 'AJUSTE' && <span className="text-af-400"> *</span>}
                </span>
                <input value={entMotivo} onChange={e => setEntMotivo(e.target.value)}
                  placeholder={entTipo === 'AJUSTE' ? 'obrigatório' : 'nota fiscal…'}
                  className={`${campo} w-full`} />
              </label>
              <button onClick={lancarEntrada}
                disabled={ocupado || !entItem || !entQtd
                          || (entTipo === 'AJUSTE' && !entMotivo.trim())}
                className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-50">
                Lançar
              </button>
            </div>
          </section>
        </div>
      )}

      {carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : saldos.length === 0 ? (
        <Vazio titulo="Nenhum item de miscelânea"
          descricao={podeMexer
            ? 'Cadastre o primeiro acima e lance a entrada — sem saldo, a entrega é recusada.'
            : 'Quem tem a permissão "Declarar a posse" cadastra os itens.'} />
      ) : (
        <section className="card-controle overflow-hidden">
          <div className="border-b border-graf-800 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Saldos</h2>
            <p className="mt-0.5 text-[11px] text-graf-400">
              somados do razão a cada abertura — não há saldo guardado para divergir
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">No almoxarifado</th>
                <th className="px-3 py-2 text-right font-medium">Com técnicos</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {saldos.map(s => (
                <tr key={s.item_id} className="border-b border-graf-800 align-top">
                  <td className="px-3 py-2">
                    <span className="block text-xs font-medium text-graf-100">{s.nome}</span>
                    <span className="tabular block text-[10px] text-graf-400">
                      {s.codigo} · {s.unidade}
                    </span>
                    {detalhe === s.item_id && (
                      <ul className="mt-1.5 space-y-0.5">
                        {s.por_tecnico.length === 0 ? (
                          <li className="text-[11px] text-graf-400">
                            Nenhum técnico com este item.
                          </li>
                        ) : s.por_tecnico.map(t => (
                          <li key={t.matricula ?? t.tecnico}
                            className="flex gap-2 text-[11px] text-graf-300">
                            <span className="tabular w-14 text-right font-semibold">
                              {qtd(t.qtd)}
                            </span>
                            <span className="truncate">{t.tecnico}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={`tabular px-3 py-2 text-right text-xs font-semibold ${
                    s.no_almoxarifado <= 0 ? 'text-af-400' : 'text-graf-100'}`}>
                    {qtd(s.no_almoxarifado)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-xs text-graf-300">
                    {qtd(s.com_tecnicos)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-xs text-graf-400">
                    {qtd(s.no_almoxarifado + s.com_tecnicos)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setDetalhe(detalhe === s.item_id ? null : s.item_id)}
                      aria-expanded={detalhe === s.item_id}
                      className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                 text-graf-300 hover:border-af-600 hover:text-af-400">
                      {detalhe === s.item_id ? 'fechar' : 'por técnico'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
