import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta, Vazio } from './ui'
import { imprimirTermo, rotuloAceite } from '../lib/termo'

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

type Tipo = 'ENTREGA' | 'DEVOLUCAO' | 'TRANSFERENCIA'
type Condicao = 'INICIALIZADO' | 'RETIRADO' | 'COM_DEFEITO'

interface Romaneio {
  id: string; numero: number; tipo: Tipo
  situacao: 'ABERTO' | 'CONFIRMADO' | 'CANCELADO'
  observacao: string | null
  criado_em: string; confirmado_em: string | null
  cancelado_motivo: string | null
  /** Quem RECEBE — e quem confirma (079). */
  tecnico_id: string | null
  tecnico: { nome: string; matricula: string | null } | null
  /** Só na transferência: de quem a carga sai (087-C). */
  tecnico_origem_id: string | null
  origem: { nome: string; matricula: string | null } | null
  /** Só na devolutiva: em que condição as peças voltam (087-B). */
  condicao_destino: Condicao | null
  /** APARELHO · SENHA · BALCAO (087-D). */
  confirmado_metodo: string | null
  /** Transferência que o técnico pediu pelo celular (089-C): o destino
   *  aceita e o almoxarifado APROVA — só na aprovação a posse muda. */
  solicitado_por_tecnico: boolean
  aceito_em: string | null
  aceito_metodo: string | null
  romaneio_item: { id: string }[]
}

/** O embed de `tecnico` vai pela COLUNA: com duas FKs para a mesma
 *  tabela, o nome da tabela sozinho deixa o PostgREST ambíguo (traps.md). */
const SELECT_ROMANEIO =
  'id, numero, tipo, situacao, observacao, criado_em, confirmado_em, '
  + 'cancelado_motivo, tecnico_id, tecnico:tecnico_id ( nome, matricula ), '
  + 'tecnico_origem_id, origem:tecnico_origem_id ( nome, matricula ), '
  + 'condicao_destino, confirmado_metodo, solicitado_por_tecnico, aceito_em, aceito_metodo, '
  + 'romaneio_item ( id )'

const ROTULO_TIPO: Record<Tipo, string> = {
  ENTREGA: 'Entrega', DEVOLUCAO: 'Devolutiva', TRANSFERENCIA: 'Transferência',
}

/** Os três botões da devolução do concorrente, com os nomes que o
 *  almoxarife já conhece de lá ("Em Estoque - Inicializado" etc.). */
const CONDICOES: { valor: Condicao; rotulo: string; ajuda: string }[] = [
  { valor: 'INICIALIZADO', rotulo: 'Inicializado', ajuda: 'peça boa, volta para ser entregue de novo' },
  { valor: 'RETIRADO',     rotulo: 'Retirado',     ajuda: 'veio da casa do cliente' },
  { valor: 'COM_DEFEITO',  rotulo: 'Com defeito',  ajuda: 'não serve para instalar' },
]
const rotuloCondicao = (c: string | null | undefined) =>
  CONDICOES.find(x => x.valor === c)?.rotulo.toLowerCase() ?? null

interface LinhaItem {
  id: string
  quantidade: number
  equipamento: {
    serial: string; tipo: string | null; modelo: string | null
    estado_atlas: string | null
    /** O que NÓS afirmamos (085, D-160). Quando existe, é ele que vale
     *  para o aviso -- a peça achada não grita PERDA. */
    estado_afline: string | null
  } | null
  item: { codigo: string; nome: string; unidade: string } | null
}

/** O que está na mão do técnico agora — `posse = COM_TECNICO`. */
interface PecaNaMao {
  id: string; serial: string; tipo: string | null; modelo: string | null
  posse_em: string | null; posse_motivo: string | null
  condicao: Condicao | null
}

/** Resposta de `romaneio_por_seriais` (086): o que entrou, o que não, e por quê. */
interface Relatorio {
  lancadas: number; recusadas: number
  linhas: { serial: string; ok: boolean; erro?: string; alerta?: string | null }[]
}

interface Vencida { limite: number; vencidos: number; mais_antiga: number }

const ESTADO_RUIM = ['PERDA', 'SUCATA', 'INUTILIZADO', 'COM DEFEITO']

/** Teto do lote no banco (086-A). A tela fatia antes de mandar. */
const LOTE = 500

/**
 * Quebra o que veio colado em seriais: coluna do Excel (um por linha),
 * lista do WhatsApp, vírgula, ponto e vírgula, tabulação. Pedaço sem ao
 * menos três letras/dígitos seguidos é separador, não serial — o `/` do
 * formato "série / endereçável" da CONSULTA ATLAS, por exemplo (D-152).
 */
function separarSeriais(txt: string): string[] {
  return txt.split(/[\s,;]+/).map(x => x.trim()).filter(x => /[0-9A-Za-z]{3,}/.test(x))
}

/** Dias desde que a peça chegou à mão do técnico, contados no dia LOCAL
 *  — mesma conta de `minha_carga()` no banco (086-B). */
function diasDesde(ts: string | null): number | null {
  if (!ts) return null
  const d = new Date(ts), h = new Date()
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const b = new Date(h.getFullYear(), h.getMonth(), h.getDate()).getTime()
  return Math.round((b - a) / 864e5)
}

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
  const [novoTipo, setNovoTipo] = useState<Tipo>('ENTREGA')
  const [novoTecnico, setNovoTecnico] = useState('')
  const [novaOrigem, setNovaOrigem] = useState('')
  // Sem padrão, de propósito: no concorrente são três botões e nenhum vem
  // marcado. Um padrão faria "inicializado" virar o que ninguém escolheu.
  const [novaCondicao, setNovaCondicao] = useState<Condicao | ''>('')
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

  // ---- vários de uma vez (086) ----
  const [colando, setColando] = useState(false)
  const [colado, setColado] = useState('')
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)
  const [naMao, setNaMao] = useState<PecaNaMao[]>([])
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [soAprovar, setSoAprovar] = useState(false)
  /** Prazo da carga de quem RECEBE (087-A). Nulo = não consultado. */
  const [vencida, setVencida] = useState<Vencida | null>(null)

  const recarregar = useCallback(async () => {
    setCarregando(true)
    const [r, t, i] = await Promise.all([
      supabase.from('romaneio').select(SELECT_ROMANEIO)
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
            + 'estado_atlas, estado_afline ), item:item_id ( codigo, nome, unidade )')
      .eq('romaneio_id', id).order('criado_em', { ascending: false })
    if (error) setErro(error.message)
    else setLinhas((data ?? []) as unknown as LinhaItem[])
  }, [])

  /** A carga que o técnico JÁ tem. Na entrega, o almoxarife vê antes de
   *  mandar mais; na devolutiva, é dela que se marca o que volta — sem
   *  precisar ter cada peça na mão para bipar. */
  const carregarNaMao = useCallback(async (tecnicoId: string | null) => {
    if (!tecnicoId) { setNaMao([]); return }
    const { data, error } = await supabase.from('equipamento')
      .select('id, serial, tipo, modelo, posse_em, posse_motivo, condicao')
      .eq('posse', 'COM_TECNICO').eq('posse_tecnico_id', tecnicoId)
      .order('posse_em').order('serial')
    if (error) setErro(error.message)
    else setNaMao((data ?? []) as PecaNaMao[])
  }, [])

  async function abrirDocumento(r: Romaneio) {
    setAberto(r); setErro(null); setOk(null)
    setColando(false); setColado(''); setRelatorio(null); setMarcadas(new Set())
    setVencida(null)
    // Na transferência, a carga que interessa é a de quem ENTREGA.
    const dono = r.tipo === 'TRANSFERENCIA' ? r.tecnico_origem_id : r.tecnico_id
    await Promise.all([
      carregarLinhas(r.id),
      carregarNaMao(dono),
      // O mesmo aviso do concorrente, ANTES de bipar: "fulano não pode
      // receber equipamentos, pois existem N…". Com o prazo em 0 (como a
      // AFLINE usa lá), a conta devolve zero e nada aparece.
      r.situacao === 'ABERTO' && r.tipo !== 'DEVOLUCAO' && r.tecnico_id
        ? supabase.rpc('carga_vencida', { p_tecnico: r.tecnico_id })
            .then(({ data }) => setVencida(data as Vencida | null))
        : Promise.resolve(),
    ])
    if (r.situacao === 'ABERTO') setTimeout(() => campoSerial.current?.focus(), 50)
  }

  const podeCriar = !!novoTecnico
    && (novoTipo !== 'DEVOLUCAO' || !!novaCondicao)
    && (novoTipo !== 'TRANSFERENCIA' || (!!novaOrigem && novaOrigem !== novoTecnico))

  async function criar() {
    if (!podeCriar) return
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('abrir_romaneio', {
      p_tipo: novoTipo, p_tecnico: novoTecnico, p_observacao: novaObs || null,
      p_condicao: novoTipo === 'DEVOLUCAO' ? novaCondicao : null,
      p_tecnico_origem: novoTipo === 'TRANSFERENCIA' ? novaOrigem : null,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setNovaObs(''); setNovaCondicao(''); setNovaOrigem('')
      await recarregar()
      const { data: novo } = await supabase.from('romaneio').select(SELECT_ROMANEIO)
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
      const r = data as { serial: string; alerta: string | null
                          estado_afline?: string | null } | null
      // Peça em PERDA/SUCATA ENTRA e a tela grita. O banco não bloqueia
      // porque 48,9% da carga está em PERDA — travar seria travar metade
      // do estoque por uma política que ninguém combinou (078).
      setOk(r?.alerta
        ? `${r.serial} lançada — atenção: está como ${r.alerta}`
          + (r.estado_afline ? ' (declarado pela AFLINE).' : ' no Atlas.')
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

  /**
   * Vários seriais numa chamada só — colados ou marcados na carga.
   *
   * ┌─ o que um serial ruim faz com os outros ──────────────────────────┐
   * │ Nada. O banco lança cada um no seu sub-bloco (086-A) e devolve a   │
   * │ lista do que entrou e do que foi recusado, com o motivo. É a       │
   * │ mecânica do "Colar do Excel" do concorrente: dez seriais, um com   │
   * │ dígito trocado, nove entram e o décimo aparece com a razão.        │
   * │ Os recusados VOLTAM para a caixa de colar, para corrigir e mandar  │
   * │ de novo sem redigitar os que já entraram.                          │
   * └────────────────────────────────────────────────────────────────────┘
   */
  async function lancarLote(seriais: string[]) {
    if (!aberto || seriais.length === 0 || lancando.current) return
    lancando.current = true
    setOcupado(true); setErro(null); setOk(null); setRelatorio(null)
    const junto: Relatorio = { lancadas: 0, recusadas: 0, linhas: [] }
    for (let i = 0; i < seriais.length; i += LOTE) {
      const { data, error } = await supabase.rpc('romaneio_por_seriais', {
        p_romaneio: aberto.id, p_seriais: seriais.slice(i, i + LOTE),
      })
      if (error) { setErro(traduzir(error.message)); break }
      const r = data as Relatorio
      junto.lancadas += r.lancadas; junto.recusadas += r.recusadas
      junto.linhas.push(...r.linhas)
    }
    if (junto.linhas.length > 0) setRelatorio(junto)
    const recusados = junto.linhas.filter(l => !l.ok).map(l => l.serial)
    setColado(recusados.join('\n'))
    if (recusados.length === 0) setColando(false)
    setMarcadas(new Set())
    await carregarLinhas(aberto.id)
    setOcupado(false)
    lancando.current = false
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
    if (aberto.solicitado_por_tecnico) {
      if (!aberto.aceito_em) return
      if (!confirm(`Aprovar a transferência ${aberto.numero}?\n\n`
          + `${aberto.origem?.nome} pediu, ${aberto.tecnico?.nome} aceitou no celular. `
          + 'Aprovando, as peças e o material mudam de carga agora.')) return
    } else if (!confirm(
      `Confirmar o romaneio ${aberto.numero}?\n\n`
      + (aberto.tipo === 'ENTREGA'
          ? 'As peças passam para a posse do técnico e a miscelânea sai do almoxarifado.'
          : aberto.tipo === 'TRANSFERENCIA'
          ? `As peças saem da carga de ${aberto.origem?.nome ?? 'origem'} e entram na de ${aberto.tecnico?.nome ?? 'destino'}.`
          : `As peças voltam para o almoxarifado como "${rotuloCondicao(aberto.condicao_destino)}" e a miscelânea volta ao saldo.`)
      + '\n\nConfirmar aqui fica registrado como BALCÃO. O aceite do técnico é pelo celular dele.'
      + '\n\nDocumento confirmado NÃO se cancela — a correção é um romaneio inverso.'
    )) return
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('confirmar_romaneio', {
      p_romaneio: aberto.id,
    })
    if (error) setErro(traduzir(error.message))
    else {
      const r = data as { numero: number; pecas: number; itens: number } | null
      setOk(`Romaneio ${r?.numero} ${aberto.solicitado_por_tecnico ? 'aprovado' : 'confirmado'}: `
            + `${r?.pecas} peça(s) e ${r?.itens} item(ns) de miscelânea.`)
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
  const noDoc = new Set(pecas.map(l => l.equipamento?.serial))
  // Marcar na carga só serve à DEVOLUTIVA: na entrega, o que está com o
  // técnico não pode entrar de novo (o banco recusaria), e a lista é
  // para o almoxarife ver o que ele já leva antes de mandar mais.
  const podeMarcar = (aberto?.tipo === 'DEVOLUCAO' || aberto?.tipo === 'TRANSFERENCIA')
    && aberto.situacao === 'ABERTO' && podeMexer
  /** Dono da carga mostrada: na transferência, quem entrega. */
  const donoCarga = aberto?.tipo === 'TRANSFERENCIA' ? aberto.origem : aberto?.tecnico
  const porCondicao = (['INICIALIZADO', 'RETIRADO', 'COM_DEFEITO', null] as const)
    .map(c => ({ c, n: naMao.filter(p => p.condicao === c).length }))
    .filter(x => x.n > 0)

  function termoDoDocumento() {
    if (!aberto) return
    const recebe = aberto.tecnico ?? { nome: '—', matricula: null }
    const ok = imprimirTermo({
      titulo: 'Termo de responsabilidade',
      referencia: `Romaneio ${aberto.numero} · ${ROTULO_TIPO[aberto.tipo].toLowerCase()}`
        + (aberto.tipo === 'TRANSFERENCIA' ? ` · vindo de ${aberto.origem?.nome ?? '?'}` : ''),
      tecnico: recebe,
      pecas: pecas.map(l => ({ serial: l.equipamento!.serial, tipo: l.equipamento!.tipo,
                               modelo: l.equipamento!.modelo })),
      misc: misc.map(l => ({ codigo: l.item!.codigo, nome: l.item!.nome,
                             quantidade: Number(l.quantidade), unidade: l.item!.unidade })),
      aceite: rotuloAceite(aberto.confirmado_metodo, aberto.confirmado_em),
      observacao: aberto.observacao,
    })
    if (!ok) setErro('O navegador bloqueou a janela do termo. Permita pop-ups para este site.')
  }

  function termoDaCarga() {
    if (!donoCarga) return
    const ok = imprimirTermo({
      titulo: 'Termo de responsabilidade — carga atual',
      referencia: `Carga em ${new Date().toLocaleDateString('pt-BR')}`,
      tecnico: donoCarga,
      pecas: naMao.map(p => ({ serial: p.serial, tipo: p.tipo, modelo: p.modelo,
                               obs: [rotuloCondicao(p.condicao), p.posse_motivo]
                                      .filter(Boolean).join(' · ') })),
    })
    if (!ok) setErro('O navegador bloqueou a janela do termo. Permita pop-ups para este site.')
  }
  const marcaveis = naMao.filter(p => !noDoc.has(p.serial))
  const colados = separarSeriais(colado)

  function alternar(serial: string) {
    setMarcadas(m => {
      const n = new Set(m)
      if (n.has(serial)) n.delete(serial); else n.add(serial)
      return n
    })
  }

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
            recebe de volta; <strong>transferência</strong> passa da carga de um
            técnico para a de outro, sem voltar ao balcão. Nada se move até o
            documento ser confirmado.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Tipo</span>
              <select value={novoTipo} className={`${campo} w-44`}
                onChange={e => setNovoTipo(e.target.value as Tipo)}>
                <option value="ENTREGA">Entrega ao técnico</option>
                <option value="DEVOLUCAO">Devolutiva</option>
                <option value="TRANSFERENCIA">Transferência entre técnicos</option>
              </select>
            </label>
            {novoTipo === 'TRANSFERENCIA' && (
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">De (quem entrega)</span>
                <select value={novaOrigem} onChange={e => setNovaOrigem(e.target.value)}
                  className={`${campo} w-60`}>
                  <option value="">— escolha —</option>
                  {tecnicos.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nome}{t.matricula ? ` · ${t.matricula}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">
                {novoTipo === 'TRANSFERENCIA' ? 'Para (quem recebe e confirma)' : 'Técnico'}
              </span>
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
            <button onClick={criar} disabled={ocupado || !podeCriar}
              className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                         hover:bg-af-500 disabled:opacity-50">
              Abrir
            </button>
          </div>

          {/* A devolutiva diz em que condição a peça volta ANTES de bipar —
              é o passo "Devolução - Situação" do concorrente (087-B). */}
          {novoTipo === 'DEVOLUCAO' && (
            <fieldset className="mt-3">
              <legend className="mb-1 text-[11px] text-graf-400">
                Em que condição as peças voltam?
              </legend>
              <div className="flex flex-wrap gap-2">
                {CONDICOES.map(c => (
                  <button key={c.valor} type="button" onClick={() => setNovaCondicao(c.valor)}
                    aria-pressed={novaCondicao === c.valor}
                    className={`rounded-md border px-3 py-1.5 text-left text-xs ${
                      novaCondicao === c.valor
                        ? 'border-af-500 bg-af-900/30 text-graf-100'
                        : 'border-graf-700 text-graf-300 hover:border-graf-600'}`}>
                    <span className="block font-medium">{c.rotulo}</span>
                    <span className="block text-[10px] text-graf-400">{c.ajuda}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-graf-400">
                Peças em condições diferentes vão em devolutivas separadas.
              </p>
            </fieldset>
          )}
          {novoTipo === 'TRANSFERENCIA' && novaOrigem && novaOrigem === novoTecnico && (
            <p className="mt-2 text-[11px] text-amber-300">
              Origem e destino são o mesmo técnico.
            </p>
          )}
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
                {ROTULO_TIPO[aberto.tipo].toLowerCase()}
              </span>
            </h2>
            <span className="text-xs text-graf-400">
              {aberto.tipo === 'TRANSFERENCIA'
                ? `${aberto.origem?.nome ?? '?'} → ${aberto.tecnico?.nome ?? '?'}`
                : aberto.tecnico?.nome ?? 'sem técnico'}
              {aberto.condicao_destino && ` · volta como ${rotuloCondicao(aberto.condicao_destino)}`}
              {aberto.solicitado_por_tecnico && ' · pedido pelo técnico no celular'}
              {aberto.observacao && ` · ${aberto.observacao}`}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase
                              tracking-wide ${
              aberto.situacao === 'ABERTO' ? 'bg-amber-900/40 text-amber-300'
              : aberto.situacao === 'CONFIRMADO' ? 'bg-emerald-900/40 text-emerald-300'
              : 'bg-graf-800 text-graf-400'}`}>
              {aberto.situacao.toLowerCase()}
            </span>
            {aberto.situacao !== 'CANCELADO' && aberto.tipo !== 'DEVOLUCAO' && (
              <button onClick={termoDoDocumento}
                className="ml-auto rounded border border-graf-700 px-2 py-0.5 text-[11px]
                           text-graf-300 hover:border-af-600 hover:text-af-400">
                imprimir termo A4
              </button>
            )}
            <button onClick={() => { setAberto(null); setLinhas([]) }}
              className={`${aberto.situacao !== 'CANCELADO' && aberto.tipo !== 'DEVOLUCAO'
                ? '' : 'ml-auto '}text-xs text-af-400 underline underline-offset-2`}>
              voltar à lista
            </button>
          </div>
          {aberto.situacao === 'CONFIRMADO' && (
            <p className="border-b border-graf-800 px-4 py-1.5 text-[11px] text-graf-400">
              {rotuloAceite(aberto.confirmado_metodo, aberto.confirmado_em)}
            </p>
          )}

          {/* ┌─ o aviso do concorrente, com o texto dele ─────────────────┐
              │ Aparece antes de bipar. Quem barra é o banco (087-A); aqui │
              │ é só o recado, para ninguém bipar trinta peças à toa.      │
              └────────────────────────────────────────────────────────────┘ */}
          {vencida && vencida.vencidos > 0 && (
            <div role="alert" className="border-b border-graf-800 bg-amber-950/40 px-4 py-2
                                         text-xs text-amber-200">
              <strong>{aberto.tecnico?.nome}</strong> não pode receber equipamentos: tem{' '}
              <strong>{vencida.vencidos}</strong> peça(s) na carga há mais de{' '}
              <strong>{vencida.limite} dias</strong> sem instalar nem devolver (a mais
              antiga, {vencida.mais_antiga} dias). Acerte a carga dele primeiro — o prazo
              fica em Configurações.
            </div>
          )}

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
              <button onClick={() => setColando(c => !c)} aria-expanded={colando}
                className="mt-1.5 text-[11px] text-af-400 underline underline-offset-2">
                {colando ? 'fechar a lista' : 'colar vários seriais de uma vez'}
              </button>

              {colando && (
                <div className="mt-2 max-w-md">
                  <textarea value={colado} onChange={e => setColado(e.target.value)}
                    rows={6} autoFocus
                    aria-label="Seriais colados, um por linha"
                    placeholder={'cole a coluna do Excel ou digite um por linha\n452073483943\n231638456\n…'}
                    className={`${campo} w-full font-mono text-xs`} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button onClick={() => lancarLote(colados)}
                      disabled={ocupado || colados.length === 0}
                      className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium
                                 text-white hover:bg-af-500 disabled:opacity-40">
                      Lançar {colados.length} {colados.length === 1 ? 'serial' : 'seriais'}
                    </button>
                    <span className="text-[11px] text-graf-400">
                      Um serial ruim não trava os outros: o que for recusado volta para
                      esta caixa, com o motivo abaixo.
                    </span>
                  </div>
                </div>
              )}

              {relatorio && (
                <div role="status" className="mt-3 max-w-2xl rounded-md border
                                               border-graf-700 bg-graf-900 p-3">
                  <p className="text-xs">
                    <strong className="text-emerald-300">{relatorio.lancadas} lançada(s)</strong>
                    {relatorio.recusadas > 0 && (
                      <> · <strong className="text-af-300">{relatorio.recusadas} recusada(s)</strong></>
                    )}
                  </p>
                  {relatorio.linhas.some(l => !l.ok || l.alerta) && (
                    <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-[11px]">
                      {relatorio.linhas.filter(l => !l.ok || l.alerta).map((l, i) => (
                        <li key={`${l.serial}-${i}`} className="flex gap-2">
                          <span className="tabular w-40 shrink-0 font-mono text-graf-100">
                            {l.serial}
                          </span>
                          <span className={l.ok ? 'text-amber-300' : 'text-graf-300'}>
                            {l.ok ? `entrou — atenção: está como ${l.alerta}` : l.erro}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

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
                      {(() => {
                        // O estado que VALE: o nosso, se declarado; senão o
                        // do Atlas. Mesma regra de `romaneio_por_serial`.
                        const eq = l.equipamento
                        const vale = eq?.estado_afline ?? eq?.estado_atlas ?? null
                        if (!vale || !ESTADO_RUIM.includes(vale)) {
                          // Declarada boa por nós, ruim no Atlas: não grita,
                          // mas não esconde a divergência.
                          return eq?.estado_afline && eq.estado_atlas
                            && ESTADO_RUIM.includes(eq.estado_atlas) ? (
                            <span title={`O Atlas diz ${eq.estado_atlas}; a AFLINE declarou ${eq.estado_afline}`}
                              className="shrink-0 text-[9px] uppercase text-graf-400">
                              Atlas: {eq.estado_atlas} · AFLINE: {eq.estado_afline}
                            </span>
                          ) : null
                        }
                        return (
                          <span title={eq?.estado_afline
                              ? 'Estado declarado pela AFLINE — a peça entra, mas fica o aviso'
                              : 'Estado no Atlas — a peça entra, mas fica o aviso'}
                            className="shrink-0 rounded bg-af-900/40 px-1.5 text-[9px]
                                       font-semibold uppercase text-af-300">
                            {vale}{eq?.estado_afline ? ' · AFLINE' : ''}
                          </span>
                        )
                      })()}
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

          {/* ┌─ a carga que o técnico JÁ tem ───────────────────────────┐
              │ No concorrente é a aba "Estoque Equipe", embaixo do      │
              │ campo de bipar. Na devolutiva é daqui que se marca o que  │
              │ volta — dez peças, dez caixas, um botão. Na entrega é     │
              │ leitura: o almoxarife vê o que ele leva e há quantos dias │
              │ antes de mandar mais. Os DIAS são só mostrados: bloquear  │
              │ entrega por carga parada é regra que o Emanuel ainda não  │
              │ decidiu (086-B).                                          │
              └───────────────────────────────────────────────────────────┘ */}
          {aberto.situacao === 'ABERTO' && aberto.tecnico_id && (
            <div className="border-t border-graf-800">
              <div className="flex flex-wrap items-center gap-2 border-b border-graf-800
                              px-4 py-2">
                <h3 className="text-[10px] font-medium uppercase tracking-wide text-graf-400">
                  Com {donoCarga?.nome ?? 'o técnico'} agora · {naMao.length}
                </h3>
                {/* O "Resumo" do concorrente: quanto é peça boa e quanto é
                    retirada de cliente (19 / 5 na equipe 001 em 26/09). */}
                {porCondicao.length > 0 && (
                  <span className="text-[11px] text-graf-400">
                    {porCondicao.map(x => `${x.n} ${rotuloCondicao(x.c) ?? 'sem condição'}`).join(' · ')}
                  </span>
                )}
                {naMao.length > 0 && (
                  <button onClick={termoDaCarga}
                    className="text-[11px] text-af-400 underline underline-offset-2">
                    termo da carga
                  </button>
                )}
                {podeMarcar && marcaveis.length > 0 && (<>
                  <button onClick={() => setMarcadas(
                      marcadas.size === marcaveis.length
                        ? new Set() : new Set(marcaveis.map(p => p.serial)))}
                    className="ml-auto text-[11px] text-af-400 underline underline-offset-2">
                    {marcadas.size === marcaveis.length ? 'desmarcar todas' : 'marcar todas'}
                  </button>
                  <button onClick={() => lancarLote([...marcadas])}
                    disabled={ocupado || marcadas.size === 0}
                    className="rounded-md bg-af-600 px-3 py-1 text-xs font-medium text-white
                               hover:bg-af-500 disabled:opacity-40">
                    {aberto.tipo === 'TRANSFERENCIA' ? 'Transferir' : 'Devolver'} as marcadas ({marcadas.size})
                  </button>
                </>)}
              </div>
              {naMao.length === 0 ? (
                <p className="px-4 py-4 text-center text-xs text-graf-400">
                  Nenhuma peça na posse deste técnico.
                </p>
              ) : (
                <ul className="max-h-72 overflow-auto">
                  {naMao.map(p => {
                    const jaNoDoc = noDoc.has(p.serial)
                    const dias = diasDesde(p.posse_em)
                    return (
                      <li key={p.id} className="flex items-center gap-2 border-b
                                                border-graf-800 px-4 py-1.5">
                        {podeMarcar && (
                          <input type="checkbox" disabled={jaNoDoc}
                            checked={jaNoDoc || marcadas.has(p.serial)}
                            onChange={() => alternar(p.serial)}
                            aria-label={`Marcar ${p.serial}`}
                            className="accent-af-600" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="tabular block truncate text-xs font-medium
                                           text-graf-100">{p.serial}</span>
                          <span className="block truncate text-[10px] text-graf-400">
                            {p.tipo ?? '—'} · {p.modelo ?? '—'}
                            {p.condicao && ` · ${rotuloCondicao(p.condicao)}`}
                            {p.posse_motivo && ` · ${p.posse_motivo}`}
                          </span>
                        </span>
                        {jaNoDoc && (
                          <span className="shrink-0 text-[10px] text-graf-400">
                            já neste romaneio
                          </span>
                        )}
                        <span className="tabular shrink-0 text-[11px] text-graf-300"
                          title="Dias desde que a peça chegou à mão dele">
                          {dias == null ? 'sem data' : dias === 0 ? 'hoje' : `${dias} d`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {aberto.situacao === 'ABERTO' && podeMexer && (
            <div className="flex flex-wrap items-center gap-2 border-t border-graf-800
                            px-4 py-3">
              {/* ┌─ três mãos na transferência pedida (089-C) ─────────┐
                  │ Origem pediu → destino aceita no celular → aqui se  │
                  │ APROVA. Antes do aceite o botão não existe: o banco │
                  │ recusaria, e aprovar pelo outro é assinar por ele.  │
                  └─────────────────────────────────────────────────────┘ */}
              {aberto.solicitado_por_tecnico ? (
                aberto.aceito_em ? (
                  <button onClick={confirmar} disabled={ocupado || linhas.length === 0}
                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                               hover:bg-af-500 disabled:opacity-40">
                    Aprovar transferência
                  </button>
                ) : (
                  <span className="rounded-md border border-amber-700/60 px-3 py-1.5 text-xs text-amber-300">
                    aguardando {aberto.tecnico?.nome ?? 'o destino'} aceitar no celular
                  </span>
                )
              ) : (
                <button onClick={confirmar} disabled={ocupado || linhas.length === 0}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-40">
                  Confirmar romaneio
                </button>
              )}
              <button onClick={cancelar} disabled={ocupado}
                className="rounded-md border border-graf-700 px-3 py-1.5 text-xs
                           text-graf-300 hover:border-graf-600">
                {aberto.solicitado_por_tecnico ? 'Recusar' : 'Cancelar'}
              </button>
              {aberto.solicitado_por_tecnico && aberto.aceito_em && (
                <span className="text-[11px] text-emerald-300">
                  aceito {aberto.aceito_metodo === 'APARELHO' ? 'com biometria/bloqueio do celular' : 'com senha'}
                  {' '}em {new Date(aberto.aceito_em).toLocaleString('pt-BR')}
                </span>
              )}
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
          {(() => {
            const pendentes = lista.filter(r => r.situacao === 'ABERTO' && r.solicitado_por_tecnico)
            const prontos = pendentes.filter(r => r.aceito_em).length
            return pendentes.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-graf-800 px-4 py-2">
                <span className="text-xs text-graf-200">
                  <strong className="text-amber-300">{pendentes.length}</strong> transferência(s) pedida(s) por técnicos
                  {' '}· <strong className="text-emerald-300">{prontos}</strong> já aceita(s), esperando aprovação
                </span>
                <button onClick={() => setSoAprovar(v => !v)} aria-pressed={soAprovar}
                  className="ml-auto text-[11px] text-af-400 underline underline-offset-2">
                  {soAprovar ? 'ver todos' : 'ver só os pedidos'}
                </button>
              </div>
            ) : null
          })()}
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
              {lista.filter(r => !soAprovar || (r.situacao === 'ABERTO' && r.solicitado_por_tecnico)).map(r => (
                <tr key={r.id} className="border-b border-graf-800">
                  <td className="tabular px-3 py-1.5 text-xs font-semibold text-graf-100">
                    {r.numero}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">
                    {ROTULO_TIPO[r.tipo]}
                    {r.condicao_destino && (
                      <span className="block text-[10px] text-graf-400">
                        {rotuloCondicao(r.condicao_destino)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">
                    {r.tipo === 'TRANSFERENCIA'
                      ? `${r.origem?.nome ?? '?'} → ${r.tecnico?.nome ?? '?'}`
                      : r.tecnico?.nome ?? '—'}
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
                    {r.situacao === 'ABERTO' && r.solicitado_por_tecnico && (
                      <span className={`ml-1.5 text-[10px] ${r.aceito_em ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {r.aceito_em ? 'aceito · aprovar' : 'aguardando aceite'}
                      </span>
                    )}
                    {r.confirmado_metodo && (
                      <span className="ml-1.5 text-[10px] text-graf-400"
                        title={rotuloAceite(r.confirmado_metodo, r.confirmado_em) ?? undefined}>
                        {r.confirmado_metodo === 'BALCAO' ? 'no balcão' : 'pelo técnico'}
                      </span>
                    )}
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
