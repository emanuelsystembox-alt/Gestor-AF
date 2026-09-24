import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta, Vazio } from './ui'

/**
 * Romaneios — o documento que move a posse (fase 2, D-154).
 *
 * ┌─ DIREÇÃO: balcão de almoxarifado ────────────────────────────────┐
 * │ > "o almoxarife monta uma carga para o técnico, fecha o documento │
 * │ >  e o técnico confirma" — Emanuel                                │
 * │                                                                   │
 * │ Quem opera isto tem um leitor de código de barras numa mão e a    │
 * │ peça na outra. Então o campo de série é o CENTRO da tela, ele     │
 * │ nasce com o foco, o Enter lança e o foco VOLTA para ele — bipar   │
 * │ trinta peças não pode exigir trinta cliques.                      │
 * │                                                                   │
 * │ A lista cresce de cima para baixo com a última lançada em         │
 * │ primeiro: quem bipa confere o que acabou de bipar, não o que      │
 * │ bipou há dez peças.                                               │
 * └───────────────────────────────────────────────────────────────────┘
 */

interface Tecnico { id: string; nome: string; matricula: string | null }
interface Item { id: string; codigo: string; nome: string; unidade: string }

interface Romaneio {
  id: string; numero: number; tipo: 'ENTREGA' | 'DEVOLUCAO'
  situacao: 'ABERTO' | 'CONFIRMADO' | 'CANCELADO'
  observacao: string | null
  criado_em: string; confirmado_em: string | null
  cancelado_motivo: string | null
  tecnico: { nome: string; matricula: string | null } | null
  romaneio_item: { id: string }[]
}

interface LinhaItem {
  id: string
  quantidade: number
  equipamento: {
    serial: string; tipo: string | null; modelo: string | null
    estado_atlas: string | null
  } | null
  item: { codigo: string; nome: string; unidade: string } | null
}

const ESTADO_RUIM = ['PERDA', 'SUCATA', 'INUTILIZADO', 'COM DEFEITO']

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

const qtd = (n: number) =>
  Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export function Romaneios({ podeMexer }: { podeMexer: boolean }) {
  const [lista, setLista] = useState<Romaneio[]>([])
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // ---- novo ----
  const [novoTipo, setNovoTipo] = useState<'ENTREGA' | 'DEVOLUCAO'>('ENTREGA')
  const [novoTecnico, setNovoTecnico] = useState('')
  const [novaObs, setNovaObs] = useState('')

  // ---- documento aberto na tela ----
  const [aberto, setAberto] = useState<Romaneio | null>(null)
  const [linhas, setLinhas] = useState<LinhaItem[]>([])
  const [serial, setSerial] = useState('')
  const [itemSel, setItemSel] = useState('')
  const [itemQtd, setItemQtd] = useState('1')
  const campoSerial = useRef<HTMLInputElement>(null)
  /** Trava de reentrada do lançamento por série.
   *
   *  ┌─ por que ref e NÃO `disabled` no campo ────────────────────────┐
   *  │ A primeira versão tinha `disabled={ocupado}`. O navegador tira  │
   *  │ o foco de um campo que desabilita, e `.focus()` num elemento    │
   *  │ desabilitado não faz nada — então depois de cada Enter o foco   │
   *  │ ia para o BODY e a peça seguinte não entrava. Bipar trinta      │
   *  │ peças viraria trinta cliques, que é exatamente o contrário do   │
   *  │ que esta tela existe para fazer. MEDIDO na tela, não deduzido.  │
   *  │                                                                 │
   *  │ E leitor de código de barras digita rápido: desabilitar o campo │
   *  │ no meio de uma leitura come caractere. O campo fica sempre       │
   *  │ vivo; quem impede a chamada dupla é esta trava.                  │
   *  └─────────────────────────────────────────────────────────────────┘ */
  const lancando = useRef(false)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    const [r, t, i] = await Promise.all([
      supabase.from('romaneio')
        .select('id, numero, tipo, situacao, observacao, criado_em, confirmado_em, '
              + 'cancelado_motivo, tecnico:tecnico_id ( nome, matricula ), '
              + 'romaneio_item ( id )')
        .order('numero', { ascending: false }).limit(60),
      supabase.from('tecnico').select('id, nome, matricula')
        .eq('situacao', 'ATIVO').order('nome'),
      supabase.from('item_miscelanea').select('id, codigo, nome, unidade')
        .eq('ativo', true).order('nome'),
    ])
    if (r.error) setErro(r.error.message)
    setLista((r.data ?? []) as unknown as Romaneio[])
    setTecnicos((t.data ?? []) as Tecnico[])
    setItens((i.data ?? []) as Item[])
    setCarregando(false)
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  const carregarLinhas = useCallback(async (id: string) => {
    const { data, error } = await supabase.from('romaneio_item')
      .select('id, quantidade, equipamento:equipamento_id ( serial, tipo, modelo, '
            + 'estado_atlas ), item:item_id ( codigo, nome, unidade )')
      .eq('romaneio_id', id).order('criado_em', { ascending: false })
    if (error) setErro(error.message)
    else setLinhas((data ?? []) as unknown as LinhaItem[])
  }, [])

  async function abrirDocumento(r: Romaneio) {
    setAberto(r); setErro(null); setOk(null)
    await carregarLinhas(r.id)
    if (r.situacao === 'ABERTO') setTimeout(() => campoSerial.current?.focus(), 50)
  }

  async function criar() {
    if (!novoTecnico) return
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('abrir_romaneio', {
      p_tipo: novoTipo, p_tecnico: novoTecnico, p_observacao: novaObs || null,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setNovaObs('')
      await recarregar()
      const { data: novo } = await supabase.from('romaneio')
        .select('id, numero, tipo, situacao, observacao, criado_em, confirmado_em, '
              + 'cancelado_motivo, tecnico:tecnico_id ( nome, matricula ), '
              + 'romaneio_item ( id )')
        .eq('id', data as unknown as string).maybeSingle()
      if (novo) await abrirDocumento(novo as unknown as Romaneio)
    }
    setOcupado(false)
  }

  /** O Enter do leitor de código de barras cai aqui. */
  async function lancarSerial() {
    const s = serial.trim()
    if (!s || !aberto || lancando.current) return
    lancando.current = true
    setOcupado(true); setErro(null)
    const { data, error } = await supabase.rpc('romaneio_por_serial', {
      p_romaneio: aberto.id, p_serial: s,
    })
    if (error) setErro(traduzir(error.message))
    else {
      const r = data as { serial: string; alerta: string | null } | null
      // Peça em PERDA/SUCATA ENTRA e a tela grita. O banco não bloqueia
      // porque 48,9% da carga está em PERDA — travar seria travar metade
      // do estoque por uma política que ninguém combinou (078).
      setOk(r?.alerta
        ? `${r.serial} lançada — atenção: está como ${r.alerta} no Atlas.`
        : null)
      await carregarLinhas(aberto.id)
    }
    setSerial('')
    setOcupado(false)
    lancando.current = false
    // Depois do render: o foco volta para o campo, e o leitor de código
    // de barras continua disparando sem ninguém tocar no mouse.
    requestAnimationFrame(() => campoSerial.current?.focus())
  }

  async function lancarItem() {
    if (!aberto || !itemSel) return
    setOcupado(true); setErro(null)
    const { error } = await supabase.rpc('romaneio_por_item', {
      p_romaneio: aberto.id, p_item: itemSel, p_quantidade: Number(itemQtd) || 0,
    })
    if (error) setErro(traduzir(error.message))
    else { setItemQtd('1'); await carregarLinhas(aberto.id) }
    setOcupado(false)
  }

  async function tirar(id: string) {
    setOcupado(true); setErro(null)
    const { error } = await supabase.rpc('romaneio_tirar_item', { p_item_id: id })
    if (error) setErro(traduzir(error.message))
    else if (aberto) await carregarLinhas(aberto.id)
    setOcupado(false)
  }

  async function confirmar() {
    if (!aberto) return
    if (!confirm(
      `Confirmar o romaneio ${aberto.numero}?\n\n`
      + (aberto.tipo === 'ENTREGA'
          ? 'As peças passam para a posse do técnico e a miscelânea sai do almoxarifado.'
          : 'As peças voltam para o almoxarifado e a miscelânea volta ao saldo.')
      + '\n\nDocumento confirmado NÃO se cancela — a correção é um romaneio inverso.'
    )) return
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('confirmar_romaneio', {
      p_romaneio: aberto.id,
    })
    if (error) setErro(traduzir(error.message))
    else {
      const r = data as { numero: number; pecas: number; itens: number } | null
      setOk(`Romaneio ${r?.numero} confirmado: ${r?.pecas} peça(s) e `
            + `${r?.itens} item(ns) de miscelânea.`)
      await recarregar()
      setAberto(null); setLinhas([])
    }
    setOcupado(false)
  }

  async function cancelar() {
    if (!aberto) return
    const motivo = prompt('Por que está cancelando este romaneio?')
    if (motivo === null) return
    setOcupado(true); setErro(null)
    const { error } = await supabase.rpc('cancelar_romaneio', {
      p_romaneio: aberto.id, p_motivo: motivo,
    })
    if (error) setErro(traduzir(error.message))
    else { setOk(`Romaneio ${aberto.numero} cancelado.`); await recarregar()
           setAberto(null); setLinhas([]) }
    setOcupado(false)
  }

  function traduzir(msg: string) {
    return /permiss/i.test(msg)
      ? 'Seu perfil não inclui "Declarar a posse" no almoxarifado. A barreira é do banco.'
      : msg
  }

  const pecas = linhas.filter(l => l.equipamento)
  const misc = linhas.filter(l => l.item)

  return (
    <div className="space-y-4">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      {/* ---------- novo romaneio ---------- */}
      {podeMexer && !aberto && (
        <section className="card-controle p-4">
          <h2 className="text-sm font-semibold">Novo romaneio</h2>
          <p className="mt-1 max-w-3xl text-xs text-graf-400">
            <strong>Entrega</strong> carrega o técnico; <strong>devolutiva</strong>{' '}
            recebe de volta. Nada se move até o documento ser confirmado.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Tipo</span>
              <select value={novoTipo} className={`${campo} w-36`}
                onChange={e => setNovoTipo(e.target.value as 'ENTREGA' | 'DEVOLUCAO')}>
                <option value="ENTREGA">Entrega ao técnico</option>
                <option value="DEVOLUCAO">Devolutiva</option>
              </select>
            </label>
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Técnico</span>
              <select value={novoTecnico} onChange={e => setNovoTecnico(e.target.value)}
                className={`${campo} w-60`}>
                <option value="">— escolha —</option>
                {tecnicos.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nome}{t.matricula ? ` · ${t.matricula}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-52 flex-1 text-[11px] text-graf-400">
              <span className="mb-1 block">Observação</span>
              <input value={novaObs} onChange={e => setNovaObs(e.target.value)}
                placeholder="carga da manhã, troca de veículo…"
                className={`${campo} w-full`} />
            </label>
            <button onClick={criar} disabled={ocupado || !novoTecnico}
              className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                         hover:bg-af-500 disabled:opacity-50">
              Abrir
            </button>
          </div>
        </section>
      )}

      {/* ---------- o documento ---------- */}
      {aberto && (
        <section className="card-controle overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b
                          border-graf-800 px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              Romaneio {aberto.numero}
              <span className="ml-2 rounded bg-graf-800 px-1.5 py-0.5 text-[10px]
                               font-semibold uppercase tracking-wide text-graf-300">
                {aberto.tipo === 'ENTREGA' ? 'entrega' : 'devolutiva'}
              </span>
            </h2>
            <span className="text-xs text-graf-400">
              {aberto.tecnico?.nome ?? 'sem técnico'}
              {aberto.observacao && ` · ${aberto.observacao}`}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase
                              tracking-wide ${
              aberto.situacao === 'ABERTO' ? 'bg-amber-900/40 text-amber-300'
              : aberto.situacao === 'CONFIRMADO' ? 'bg-emerald-900/40 text-emerald-300'
              : 'bg-graf-800 text-graf-400'}`}>
              {aberto.situacao.toLowerCase()}
            </span>
            <button onClick={() => { setAberto(null); setLinhas([]) }}
              className="ml-auto text-xs text-af-400 underline underline-offset-2">
              voltar à lista
            </button>
          </div>

          {aberto.situacao === 'ABERTO' && podeMexer && (
            <div className="border-b border-graf-800 px-4 py-3">
              {/* O campo de série é o centro da tela: nasce com foco, o
                  Enter lança e o foco volta. Bipar 30 peças não pode
                  exigir 30 cliques. */}
              <label className="block text-[11px] text-graf-400">
                <span className="mb-1 block">
                  Número de série — bipe ou digite e tecle Enter
                </span>
                <input ref={campoSerial} value={serial}
                  onChange={e => setSerial(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lancarSerial() } }}
                  placeholder="bipe a peça…"
                  className={`${campo} w-full max-w-md font-mono text-sm`} />
              </label>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Miscelânea</span>
                  <select value={itemSel} onChange={e => setItemSel(e.target.value)}
                    className={`${campo} w-64`}>
                    <option value="">— item —</option>
                    {itens.map(i => (
                      <option key={i.id} value={i.id}>{i.codigo} · {i.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Quantidade</span>
                  <input value={itemQtd} onChange={e => setItemQtd(e.target.value)}
                    inputMode="decimal" className={`${campo} w-24 text-right`} />
                </label>
                <button onClick={lancarItem} disabled={ocupado || !itemSel}
                  className="rounded-md border border-graf-700 px-3 py-1.5 text-xs
                             text-graf-200 hover:border-af-600 disabled:opacity-40">
                  Acrescentar
                </button>
                {itens.length === 0 && (
                  <span className="text-[11px] text-amber-300">
                    Nenhum item cadastrado ainda — veja a aba Miscelânea.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ---- o que está no documento ---- */}
          <div className="grid gap-0 lg:grid-cols-2">
            <div className="border-b border-graf-800 lg:border-b-0 lg:border-r">
              <h3 className="border-b border-graf-800 px-4 py-2 text-[10px] font-medium
                             uppercase tracking-wide text-graf-400">
                Peças com série · {pecas.length}
              </h3>
              {pecas.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-graf-400">
                  Nenhuma peça lançada.
                </p>
              ) : (
                <ul className="max-h-80 overflow-auto">
                  {pecas.map(l => (
                    <li key={l.id} className="flex items-center gap-2 border-b
                                              border-graf-800 px-4 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="tabular block truncate text-xs font-medium
                                         text-graf-100">
                          {l.equipamento?.serial}
                        </span>
                        <span className="block truncate text-[10px] text-graf-400">
                          {l.equipamento?.tipo ?? '—'} · {l.equipamento?.modelo ?? '—'}
                        </span>
                      </span>
                      {l.equipamento?.estado_atlas
                        && ESTADO_RUIM.includes(l.equipamento.estado_atlas) && (
                        <span title="Estado no Atlas — a peça entra, mas fica o aviso"
                          className="shrink-0 rounded bg-af-900/40 px-1.5 text-[9px]
                                     font-semibold uppercase text-af-300">
                          {l.equipamento.estado_atlas}
                        </span>
                      )}
                      {aberto.situacao === 'ABERTO' && podeMexer && (
                        <button onClick={() => tirar(l.id)} disabled={ocupado}
                          aria-label={`Tirar ${l.equipamento?.serial} do romaneio`}
                          className="shrink-0 rounded border border-graf-700 px-1.5 py-0.5
                                     text-[10px] text-graf-400 hover:border-af-600
                                     hover:text-af-400">
                          tirar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="border-b border-graf-800 px-4 py-2 text-[10px] font-medium
                             uppercase tracking-wide text-graf-400">
                Miscelânea · {misc.length}
              </h3>
              {misc.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-graf-400">
                  Nenhum item lançado.
                </p>
              ) : (
                <ul className="max-h-80 overflow-auto">
                  {misc.map(l => (
                    <li key={l.id} className="flex items-center gap-2 border-b
                                              border-graf-800 px-4 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs text-graf-200">
                        <span className="tabular text-graf-400">{l.item?.codigo}</span>
                        {' · '}{l.item?.nome}
                      </span>
                      <span className="tabular shrink-0 text-xs font-semibold text-graf-100">
                        {qtd(l.quantidade)} {l.item?.unidade}
                      </span>
                      {aberto.situacao === 'ABERTO' && podeMexer && (
                        <button onClick={() => tirar(l.id)} disabled={ocupado}
                          aria-label={`Tirar ${l.item?.nome} do romaneio`}
                          className="shrink-0 rounded border border-graf-700 px-1.5 py-0.5
                                     text-[10px] text-graf-400 hover:border-af-600
                                     hover:text-af-400">
                          tirar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {aberto.situacao === 'ABERTO' && podeMexer && (
            <div className="flex flex-wrap items-center gap-2 border-t border-graf-800
                            px-4 py-3">
              <button onClick={confirmar} disabled={ocupado || linhas.length === 0}
                className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-40">
                Confirmar romaneio
              </button>
              <button onClick={cancelar} disabled={ocupado}
                className="rounded-md border border-graf-700 px-3 py-1.5 text-xs
                           text-graf-300 hover:border-graf-600">
                Cancelar
              </button>
              <span className="text-[11px] text-graf-400">
                Enquanto está <strong>aberto</strong>, nada mudou de lugar. A posse e o
                saldo se movem na confirmação — e documento confirmado não se desfaz.
              </span>
            </div>
          )}
          {aberto.situacao === 'CANCELADO' && aberto.cancelado_motivo && (
            <p className="border-t border-graf-800 px-4 py-2 text-[11px] text-graf-400">
              Cancelado: {aberto.cancelado_motivo}
            </p>
          )}
        </section>
      )}

      {/* ---------- a lista ---------- */}
      {!aberto && (carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : lista.length === 0 ? (
        <Vazio titulo="Nenhum romaneio ainda"
          descricao={podeMexer
            ? 'Abra o primeiro acima: escolha entrega ou devolutiva e o técnico.'
            : 'Quem tem a permissão "Declarar a posse" cria os romaneios.'} />
      ) : (
        <section className="card-controle overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Nº</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Técnico</th>
                <th className="px-3 py-2 text-right font-medium">Itens</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Aberto em</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map(r => (
                <tr key={r.id} className="border-b border-graf-800">
                  <td className="tabular px-3 py-1.5 text-xs font-semibold text-graf-100">
                    {r.numero}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">
                    {r.tipo === 'ENTREGA' ? 'Entrega' : 'Devolutiva'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">
                    {r.tecnico?.nome ?? '—'}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-xs text-graf-400">
                    {r.romaneio_item?.length ?? 0}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold
                                      uppercase tracking-wide ${
                      r.situacao === 'ABERTO' ? 'bg-amber-900/40 text-amber-300'
                      : r.situacao === 'CONFIRMADO' ? 'bg-emerald-900/40 text-emerald-300'
                      : 'bg-graf-800 text-graf-400'}`}>
                      {r.situacao.toLowerCase()}
                    </span>
                  </td>
                  <td className="tabular px-3 py-1.5 text-xs text-graf-400">
                    {new Date(r.criado_em).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => abrirDocumento(r)}
                      className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                 text-graf-300 hover:border-af-600 hover:text-af-400">
                      abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
