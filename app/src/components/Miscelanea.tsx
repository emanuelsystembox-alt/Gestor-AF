import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isoLocal, reais } from '../lib/formato'
import { Alerta, Vazio } from './ui'

/**
 * Miscelânea — o que não tem série, tem quantidade (fase 2, D-154; 089, D-165).
 *
 * ┌─ O SALDO É SOMA, NÃO COLUNA ─────────────────────────────────────┐
 * │ `miscelanea_saldos()` soma o razão a cada chamada. Não existe     │
 * │ campo `saldo` guardado — cache de número que a operação mexe      │
 * │ diverge calado (`traps.md`). A auditoria também não sobrescreve:  │
 * │ lança um AJUSTE com a diferença, e o Kardex mostra de onde veio.  │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O CATÁLOGO VEIO DO CONCORRENTE ─────────────────────────────────┐
 * │ 418 itens ativos do Alfa Gestor da AFLINE (089b): ferramenta, EPI │
 * │ (com o C.A.), material de instalação (com o código SAP e o valor) │
 * │ e acessório. Com esse volume a tela precisa de filtro por tipo e  │
 * │ de busca — a lista de 1 item da fase 2 não precisava.             │
 * └───────────────────────────────────────────────────────────────────┘
 */

type TipoItem = 'MATERIAL' | 'FERRAMENTA' | 'EPI' | 'ACESSORIO'

interface Saldo {
  item_id: string; codigo: string | null; nome: string; unidade: string
  tipo: TipoItem | null; valor: number | null; ca: string | null; consumivel: boolean
  no_almoxarifado: number; com_tecnicos: number
  por_tecnico: { tecnico_id: string; tecnico: string; matricula: string | null; qtd: number }[]
}

interface LinhaKardex {
  quando: string; tipo: string; documento: string; outro_lado: string | null
  saldo_anterior: number; quantidade: number; saldo_atual: number
  motivo: string | null; quem: string | null
}

const TIPOS: { valor: TipoItem; rotulo: string }[] = [
  { valor: 'MATERIAL', rotulo: 'Material de instalação' },
  { valor: 'FERRAMENTA', rotulo: 'Ferramenta' },
  { valor: 'EPI', rotulo: 'EPI / EPC' },
  { valor: 'ACESSORIO', rotulo: 'Acessório' },
]
const rotuloTipo = (t: string | null) => TIPOS.find(x => x.valor === t)?.rotulo ?? 'sem tipo'

const ROTULO_MOV: Record<string, string> = {
  ENTRADA: 'Entrada', ENTREGA: 'Entrega', DEVOLUCAO: 'Devolução', AJUSTE: 'Ajuste',
  TRANSFERENCIA: 'Transferência', CONSUMO: 'Consumo no contrato',
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

const qtd = (n: number) =>
  Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

const menosDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d) }

/** Quantas linhas a tabela desenha de uma vez. 418 itens com a linha
 *  expandida pesa; com a busca, ninguém rola até o 300º. */
const LIMITE = 150

export function Miscelanea({ podeMexer }: { podeMexer: boolean }) {
  const [saldos, setSaldos] = useState<Saldo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // filtros
  const [filtroTipo, setFiltroTipo] = useState<TipoItem | ''>('')
  const [busca, setBusca] = useState('')
  const [soComSaldo, setSoComSaldo] = useState(false)

  // painel aberto numa linha: técnicos, kardex ou contagem
  const [aberto, setAberto] = useState<{ id: string; modo: 'tecnicos' | 'kardex' | 'contar' } | null>(null)
  const [kardex, setKardex] = useState<LinhaKardex[]>([])
  const [kLocal, setKLocal] = useState('')          // '' = almoxarifado; senão tecnico_id
  const [contado, setContado] = useState('')
  const [motivoContagem, setMotivoContagem] = useState('')

  // novo item
  const [novo, setNovo] = useState({ codigo: '', nome: '', unidade: 'UN', tipo: '', valor: '', ca: '', consumivel: false })
  const [criando, setCriando] = useState(false)

  // entrada
  const [entItem, setEntItem] = useState('')
  const [entQtd, setEntQtd] = useState('')
  const [entMotivo, setEntMotivo] = useState('')

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

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return saldos.filter(s => {
      if (filtroTipo && s.tipo !== filtroTipo) return false
      if (soComSaldo && s.no_almoxarifado + s.com_tecnicos === 0) return false
      if (!t) return true
      return s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t)
        || (s.ca ?? '').toLowerCase().includes(t)
    })
  }, [saldos, filtroTipo, busca, soComSaldo])

  const porTipo = (t: TipoItem) => saldos.filter(s => s.tipo === t).length
  // Valor parado no almoxarifado: só o que tem valor cadastrado. O resto
  // é "sem valor", não zero (D-117) — e a tela diz quantos são.
  const valorAlmox = saldos.reduce((s, x) => s + (x.valor != null ? x.valor * Math.max(0, x.no_almoxarifado) : 0), 0)
  const semValorComSaldo = saldos.filter(x => x.valor == null && x.no_almoxarifado > 0).length

  async function criarItem() {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('salvar_item_miscelanea', {
      p_id: null,
      p_dados: { ...novo, valor: novo.valor.replace(',', '.'), ativo: true },
    })
    if (error) setErro(traduzir(error.message))
    else {
      setOk(`Item ${novo.nome.toUpperCase()} cadastrado.`)
      setNovo({ codigo: '', nome: '', unidade: 'UN', tipo: '', valor: '', ca: '', consumivel: false })
      setCriando(false)
      await recarregar()
    }
    setOcupado(false)
  }

  async function lancarEntrada() {
    const item = saldos.find(s => `${s.codigo ? s.codigo + ' · ' : ''}${s.nome}` === entItem)
    if (!item) { setErro('Escolha o item na lista (digite parte do nome ou do código).'); return }
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('miscelanea_entrada', {
      p_item: item.item_id, p_quantidade: Number(entQtd.replace(',', '.')) || 0,
      p_motivo: entMotivo || null, p_tipo: 'ENTRADA',
    })
    if (error) setErro(traduzir(error.message))
    else {
      setOk(`Entrada de ${entQtd} ${item.unidade} de ${item.nome}.`)
      setEntQtd(''); setEntMotivo(''); setEntItem('')
      await recarregar()
    }
    setOcupado(false)
  }

  async function abrirKardex(s: Saldo, local: string) {
    setAberto({ id: s.item_id, modo: 'kardex' }); setKLocal(local); setKardex([])
    const { data, error } = await supabase.rpc('miscelanea_kardex', {
      p_item: s.item_id, p_tecnico: local || null, p_de: menosDias(90), p_ate: isoLocal(),
    })
    if (error) setErro(error.message)
    else setKardex((data ?? []) as LinhaKardex[])
  }

  /** Auditoria: o que foi CONTADO vira um ajuste com a diferença. */
  async function registrarContagem(s: Saldo) {
    const n = Number(contado.replace(',', '.'))
    if (!(n >= 0) || !motivoContagem.trim()) return
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('ajustar_saldo_miscelanea', {
      p_item: s.item_id, p_tecnico: kLocal || null, p_contado: n, p_motivo: motivoContagem,
    })
    if (error) setErro(traduzir(error.message))
    else {
      const dif = Number(data)
      const onde = kLocal ? s.por_tecnico.find(t => t.tecnico_id === kLocal)?.tecnico : 'almoxarifado'
      setOk(dif === 0
        ? `Contagem confere: ${qtd(n)} ${s.unidade} de ${s.nome} (${onde}).`
        : `Ajuste de ${dif > 0 ? '+' : ''}${qtd(dif)} ${s.unidade} em ${s.nome} (${onde}). Fica no Kardex.`)
      setContado(''); setMotivoContagem(''); setAberto(null)
      await recarregar()
    }
    setOcupado(false)
  }

  return (
    <div className="space-y-4">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      {/* ---- tipos: os do concorrente, com contagem ---- */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {TIPOS.map(t => (
          <button key={t.valor} onClick={() => setFiltroTipo(f => f === t.valor ? '' : t.valor)}
            aria-pressed={filtroTipo === t.valor}
            className={`card-controle px-3.5 py-3 text-left transition ${
              filtroTipo === t.valor ? 'ring-1 ring-af-500' : 'hover:border-graf-600'}`}>
            <div className="tabular text-2xl font-semibold leading-none">{porTipo(t.valor)}</div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">{t.rotulo}</div>
          </button>
        ))}
        <div className="card-controle px-3.5 py-3">
          <div className="tabular text-2xl font-semibold leading-none">{reais(valorAlmox)}</div>
          <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
            parado no almoxarifado
          </div>
          {semValorComSaldo > 0 && (
            <div className="mt-1 text-[10px] text-amber-300">+ {semValorComSaldo} item(ns) sem valor</div>
          )}
        </div>
      </div>

      {podeMexer && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card-controle p-4">
            <h2 className="text-sm font-semibold">Entrada no almoxarifado</h2>
            {/* Sem entrada não há saída: entrega sem saldo é recusada pelo banco. */}
            <p className="mt-1 text-xs text-graf-400">
              Compra ou recebimento. Para acertar o saldo, use <strong>contar</strong> na
              linha do item: vira ajuste com motivo.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                <span className="mb-1 block">Item (digite nome ou código)</span>
                <input value={entItem} onChange={e => setEntItem(e.target.value)}
                  list="lista-itens-misc" className={`${campo} w-full`} />
                <datalist id="lista-itens-misc">
                  {saldos.map(s => (
                    <option key={s.item_id} value={`${s.codigo ? s.codigo + ' · ' : ''}${s.nome}`} />
                  ))}
                </datalist>
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Quantidade</span>
                <input value={entQtd} onChange={e => setEntQtd(e.target.value)}
                  inputMode="decimal" className={`${campo} w-24 text-right`} />
              </label>
              <label className="min-w-32 flex-1 text-[11px] text-graf-400">
                <span className="mb-1 block">Nota fiscal / motivo</span>
                <input value={entMotivo} onChange={e => setEntMotivo(e.target.value)}
                  placeholder="NF 12345" className={`${campo} w-full`} />
              </label>
              <button onClick={lancarEntrada} disabled={ocupado || !entItem || !entQtd}
                className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-50">
                Lançar
              </button>
            </div>
          </section>

          <section className="card-controle p-4">
            <div className="flex items-center">
              <h2 className="text-sm font-semibold">Cadastro de item</h2>
              <button onClick={() => setCriando(c => !c)}
                className="ml-auto text-[11px] text-af-400 underline underline-offset-2">
                {criando ? 'fechar' : '+ novo item'}
              </button>
            </div>
            {!criando ? (
              <p className="mt-1 text-xs text-graf-400">
                {saldos.length} itens ativos. O catálogo veio do sistema anterior; aqui entra o
                que faltar.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] text-graf-400 sm:col-span-2">
                  <span className="mb-1 block">Nome *</span>
                  <input value={novo.nome} onChange={e => setNovo(n => ({ ...n, nome: e.target.value }))}
                    className={`${campo} w-full`} />
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Tipo</span>
                  <select value={novo.tipo} onChange={e => setNovo(n => ({ ...n, tipo: e.target.value }))}
                    className={`${campo} w-full`}>
                    <option value="">— escolha —</option>
                    {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Código SAP (opcional)</span>
                  <input value={novo.codigo} onChange={e => setNovo(n => ({ ...n, codigo: e.target.value }))}
                    className={`${campo} w-full`} />
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Unidade</span>
                  <input value={novo.unidade} onChange={e => setNovo(n => ({ ...n, unidade: e.target.value }))}
                    className={`${campo} w-full`} />
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Valor unitário (R$)</span>
                  <input value={novo.valor} onChange={e => setNovo(n => ({ ...n, valor: e.target.value }))}
                    inputMode="decimal" placeholder="vazio = sem valor" className={`${campo} w-full`} />
                </label>
                {novo.tipo === 'EPI' && (
                  <label className="text-[11px] text-graf-400">
                    <span className="mb-1 block">C.A. (certificado)</span>
                    <input value={novo.ca} onChange={e => setNovo(n => ({ ...n, ca: e.target.value }))}
                      className={`${campo} w-full`} />
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-xs text-graf-300 sm:col-span-2">
                  <input type="checkbox" checked={novo.consumivel}
                    onChange={e => setNovo(n => ({ ...n, consumivel: e.target.checked }))}
                    className="accent-af-600" />
                  gasta no contrato (pode ser baixado por contrato)
                </label>
                <button onClick={criarItem} disabled={ocupado || !novo.nome.trim()}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50 sm:col-span-2 sm:justify-self-start">
                  Cadastrar
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="buscar por nome, código SAP ou C.A.…" aria-label="Buscar item"
          className={`${campo} w-80`} />
        <label className="flex items-center gap-1.5 text-xs text-graf-300">
          <input type="checkbox" checked={soComSaldo} onChange={e => setSoComSaldo(e.target.checked)}
            className="accent-af-600" />
          só o que tem saldo
        </label>
        <span className="text-[11px] text-graf-400">
          {filtrados.length} de {saldos.length}
          {filtroTipo && ` · ${rotuloTipo(filtroTipo)}`}
        </span>
      </div>

      {carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : filtrados.length === 0 ? (
        <Vazio titulo={saldos.length === 0 ? 'Nenhum item de miscelânea' : 'Nada com esse filtro'} />
      ) : (
        <section className="card-controle overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">No almoxarifado</th>
                <th className="px-3 py-2 text-right font-medium">Com técnicos</th>
                <th className="px-3 py-2 text-right font-medium">Valor un.</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.slice(0, LIMITE).map(s => {
                const aqui = aberto?.id === s.item_id
                return (
                  <tr key={s.item_id} className="border-b border-graf-800 align-top">
                    <td className="px-3 py-2">
                      <span className="block text-xs font-medium text-graf-100">{s.nome}</span>
                      <span className="tabular block text-[10px] text-graf-400">
                        {rotuloTipo(s.tipo)}{s.codigo && ` · SAP ${s.codigo}`}{s.ca && ` · C.A. ${s.ca}`}
                        {' · '}{s.unidade}{s.consumivel && ' · gasta no contrato'}
                      </span>

                      {aqui && aberto.modo === 'tecnicos' && (
                        <ul className="mt-1.5 space-y-0.5">
                          {s.por_tecnico.length === 0 ? (
                            <li className="text-[11px] text-graf-400">Nenhum técnico com este item.</li>
                          ) : s.por_tecnico.map(t => (
                            <li key={t.tecnico_id} className="flex items-center gap-2 text-[11px] text-graf-300">
                              <span className="tabular w-14 text-right font-semibold">{qtd(t.qtd)}</span>
                              <span className="truncate">{t.tecnico}</span>
                              <button onClick={() => abrirKardex(s, t.tecnico_id)}
                                className="text-af-400 underline underline-offset-2">kardex</button>
                            </li>
                          ))}
                        </ul>
                      )}

                      {aqui && aberto.modo === 'kardex' && (
                        <div className="mt-2">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-graf-400">
                            <span>Kardex, 90 dias —</span>
                            <select value={kLocal} onChange={e => abrirKardex(s, e.target.value)}
                              aria-label="De onde" className={`${campo} py-0.5`}>
                              <option value="">almoxarifado</option>
                              {s.por_tecnico.map(t => <option key={t.tecnico_id} value={t.tecnico_id}>{t.tecnico}</option>)}
                            </select>
                            {podeMexer && (
                              <button onClick={() => setAberto({ id: s.item_id, modo: 'contar' })}
                                className="text-af-400 underline underline-offset-2">contar este lugar</button>
                            )}
                          </div>
                          {kardex.length === 0 ? (
                            <p className="mt-1 text-[11px] text-graf-400">Nenhum movimento no período.</p>
                          ) : (
                            <table className="mt-1 w-full text-[11px]">
                              <thead className="text-left text-[10px] uppercase text-graf-400">
                                <tr>
                                  <th className="py-0.5 pr-2 font-medium">Quando</th>
                                  <th className="py-0.5 pr-2 font-medium">Movimento</th>
                                  <th className="py-0.5 pr-2 text-right font-medium">Antes</th>
                                  <th className="py-0.5 pr-2 text-right font-medium">Mov.</th>
                                  <th className="py-0.5 pr-2 text-right font-medium">Depois</th>
                                  <th className="py-0.5 font-medium">Quem</th>
                                </tr>
                              </thead>
                              <tbody>
                                {kardex.map((k, i) => (
                                  <tr key={i} className="border-t border-graf-800 text-graf-300">
                                    <td className="tabular py-0.5 pr-2">{new Date(k.quando).toLocaleString('pt-BR')}</td>
                                    <td className="py-0.5 pr-2">
                                      {ROTULO_MOV[k.tipo] ?? k.tipo} {k.documento}
                                      {k.outro_lado && <span className="text-graf-400"> · {k.quantidade < 0 ? 'para' : 'de'} {k.outro_lado}</span>}
                                      {k.motivo && <span className="block text-graf-400">{k.motivo}</span>}
                                    </td>
                                    <td className="tabular py-0.5 pr-2 text-right">{qtd(k.saldo_anterior)}</td>
                                    <td className={`tabular py-0.5 pr-2 text-right font-semibold ${k.quantidade < 0 ? 'text-af-300' : 'text-emerald-300'}`}>
                                      {k.quantidade > 0 ? '+' : ''}{qtd(k.quantidade)}
                                    </td>
                                    <td className="tabular py-0.5 pr-2 text-right text-graf-100">{qtd(k.saldo_atual)}</td>
                                    <td className="py-0.5 text-graf-400">{k.quem ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}

                      {aqui && aberto.modo === 'contar' && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <span className="text-[11px] text-graf-400">
                            Contagem em <strong className="text-graf-200">
                              {kLocal ? s.por_tecnico.find(t => t.tecnico_id === kLocal)?.tecnico : 'almoxarifado'}
                            </strong> (o sistema diz {qtd(kLocal
                              ? s.por_tecnico.find(t => t.tecnico_id === kLocal)?.qtd ?? 0
                              : s.no_almoxarifado)}):
                          </span>
                          <input value={contado} onChange={e => setContado(e.target.value)} inputMode="decimal"
                            placeholder="contado" aria-label="Quantidade contada"
                            className={`${campo} w-24 text-right`} />
                          <input value={motivoContagem} onChange={e => setMotivoContagem(e.target.value)}
                            placeholder="motivo (inventário, perda…)" aria-label="Motivo do ajuste"
                            className={`${campo} w-56`} />
                          <button onClick={() => registrarContagem(s)}
                            disabled={ocupado || contado === '' || !motivoContagem.trim()}
                            className="rounded-md bg-af-600 px-3 py-1 text-xs font-medium text-white
                                       hover:bg-af-500 disabled:opacity-40">
                            Registrar contagem
                          </button>
                        </div>
                      )}
                    </td>
                    <td className={`tabular px-3 py-2 text-right text-xs font-semibold ${
                      s.no_almoxarifado <= 0 ? 'text-graf-400' : 'text-graf-100'}`}>
                      {qtd(s.no_almoxarifado)}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-xs text-graf-300">{qtd(s.com_tecnicos)}</td>
                    <td className="tabular px-3 py-2 text-right text-xs text-graf-400">
                      {s.valor != null ? reais(s.valor) : 'sem valor'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button onClick={() => setAberto(aqui && aberto.modo === 'tecnicos' ? null : { id: s.item_id, modo: 'tecnicos' })}
                        className="mr-1 rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                   text-graf-300 hover:border-af-600 hover:text-af-400">
                        por técnico
                      </button>
                      <button onClick={() => aqui && aberto.modo === 'kardex' ? setAberto(null) : abrirKardex(s, '')}
                        className="mr-1 rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                   text-graf-300 hover:border-af-600 hover:text-af-400">
                        kardex
                      </button>
                      {podeMexer && (
                        <button onClick={() => { setKLocal(''); setAberto({ id: s.item_id, modo: 'contar' }) }}
                          className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                     text-graf-300 hover:border-af-600 hover:text-af-400">
                          contar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtrados.length > LIMITE && (
            <p className="px-4 py-2 text-[11px] text-graf-400">
              Mostrando {LIMITE} de {filtrados.length}. Use a busca ou o tipo para achar o resto.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
