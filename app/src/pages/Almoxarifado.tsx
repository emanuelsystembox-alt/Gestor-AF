import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { lerCargaEstoque, type LeituraEstoque } from '../lib/estoque'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { Romaneios } from '../components/Romaneios'
import { Entrada } from '../components/Entrada'
import { SelecaoMultipla } from '../components/SelecaoMultipla'
import { PecaDetalhe, EstadoAfline } from '../components/PecaDetalhe'
import { Miscelanea } from '../components/Miscelanea'
import { Cargas } from '../components/Cargas'
import { BaixaContrato } from '../components/BaixaContrato'
import { Movimentacoes } from '../components/Movimentacoes'
import { Sinalizacoes } from '../components/Sinalizacoes'
// 182: o que o TOA diz instalado/retirado contra a carga — só acusa (D-262).
import { ConferenciaToa } from '../components/ConferenciaToa'
import { useCentral } from '../lib/central'
import { useCidades } from '../lib/cidade'

/**
 * Almoxarifado — a posição da carga (fase 1 do módulo).
 *
 * ┌─ DIREÇÃO: a mesa do almoxarife, não um dashboard ────────────────┐
 * │ > "imagina você ser o chefe do almoxarifado e precisa controlar   │
 * │ >  miscelâneas e equipamentos" — Emanuel                          │
 * │                                                                   │
 * │ O painel do concorrente é uma parede de 12 cartões coloridos e um │
 * │ donut de 12 fatias — com 68% numa fatia e sete fatias abaixo de   │
 * │ 1%. Um donut com doze fatias não é um gráfico, é uma legenda      │
 * │ redonda: para saber qualquer número, você lê a legenda.           │
 * │                                                                   │
 * │ Aqui a proporção vira BARRA HORIZONTAL ordenada, que é a forma    │
 * │ que responde "quanto de cada" sem legenda e sem cor obrigatória — │
 * │ o rótulo fica na barra e o número ao lado. A cor entra só onde    │
 * │ significa alguma coisa.                                           │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ DOIS EIXOS, e é o produto desta tela ───────────────────────────┐
 * │ O que a CLARO diz (`estado_atlas`) e onde a peça está para nós    │
 * │ (`posse`). Hoje 15.603 peças têm estado e NENHUMA tem posse: a    │
 * │ importação não inventa (D-152). A tela diz isso na cara, porque é │
 * │ exatamente o trabalho que falta fazer.                            │
 * └───────────────────────────────────────────────────────────────────┘
 */

interface Posicao {
  total: number
  sem_posse: number
  /** 085 -- ausentes enquanto a migration não estiver aplicada. */
  com_estado_afline?: number
  divergem_do_atlas?: number
  por_estado: { estado: string; qtd: number }[]
  por_tipo: { tipo: string; qtd: number }[]
  por_posse: { posse: string | null; qtd: number }[]
  por_modelo: { modelo: string; tipo: string; qtd: number }[]
  ultima_importacao: {
    em: string; arquivo: string | null; linhas: number
    criados: number; atualizados: number
  } | null
}

interface Posse { codigo: string; rotulo: string; cor: string | null; ordem: number }

/** 228 (D-339): o painel por situação, com o filtro de tipo e modelo. */
interface Painel {
  total: number
  por_situacao: { situacao: string; rotulo: string; qtd: number }[]
  por_estado: { estado: string; qtd: number }[]
  por_tipo: { tipo: string; qtd: number }[]
  por_modelo: { modelo: string; tipo: string; qtd: number }[]
  opcoes_tipo: { valor: string; qtd: number }[]
  opcoes_modelo: { valor: string; qtd: number }[]
}

/**
 * A SITUAÇÃO da peça (228, D-339) — o nome que o almoxarife já conhece do
 * concorrente ("Com Técnico - Inicializado"), calculado no banco a partir
 * de posse + condição (situacao_estoque). A cor diz o que fazer: verde
 * pronto, azul voltando, vermelho com defeito, âmbar esperando alguém,
 * cinza fora do nosso estoque. Hex fixo: o tema claro inverte (D-303).
 */
const SITUACOES: { codigo: string; cor: string; sempre?: boolean }[] = [
  { codigo: 'ESTOQUE_INICIALIZADO', cor: '#16a34a', sempre: true },
  { codigo: 'TECNICO_INICIALIZADO', cor: '#16a34a', sempre: true },
  { codigo: 'TECNICO_RETIRADO', cor: '#2563eb', sempre: true },
  { codigo: 'ESTOQUE_RETIRADO', cor: '#2563eb' },
  { codigo: 'ESTOQUE_DEFEITO', cor: '#dc2626' },
  { codigo: 'TECNICO_DEFEITO', cor: '#dc2626' },
  { codigo: 'AGUARDANDO_ACEITE', cor: '#d97706', sempre: true },
  { codigo: 'EM_TRANSITO', cor: '#d97706' },
  { codigo: 'NO_CONTRATO', cor: '#64748b' },
  { codigo: 'DEVOLVIDO_CLARO', cor: '#64748b' },
  { codigo: 'SEM_POSSE', cor: '#d97706', sempre: true },
]
const ROTULO_SITUACAO: Record<string, string> = {
  ESTOQUE_INICIALIZADO: 'Em estoque · inicializado', ESTOQUE_RETIRADO: 'Em estoque · retirado',
  ESTOQUE_DEFEITO: 'Em estoque · com defeito', TECNICO_INICIALIZADO: 'Com técnico · inicializado',
  TECNICO_RETIRADO: 'Com técnico · retirado', TECNICO_DEFEITO: 'Com técnico · com defeito',
  AGUARDANDO_ACEITE: 'Aguardando aceite', NO_CONTRATO: 'No contrato (assinante)',
  EM_TRANSITO: 'Em trânsito', DEVOLVIDO_CLARO: 'Devolvido à CLARO', SEM_POSSE: 'Sem posse declarada',
}
const corSituacao = (c: string) => SITUACOES.find(x => x.codigo === c)?.cor ?? '#64748b'

interface Equipamento {
  id: string; serial: string; enderecavel: string | null
  tipo: string | null; modelo: string | null
  estado_atlas: string | null; posse: string | null
  local_atlas: string | null; atlas_em: string | null
  /** O que NÓS afirmamos, ao lado do Atlas (085, D-160). */
  estado_afline: string | null
  estado_afline_em: string | null
  estado_afline_motivo: string | null
  /** 228: da view estoque_peca. */
  situacao: string
  tecnico_nome: string | null
}

const POR_PAGINA = 50

const n = (v: number) => v.toLocaleString('pt-BR')

/**
 * A cor do estado do Atlas.
 *
 * NÃO é uma escala de "bom para ruim" inventada por mim: é o que a
 * própria CLARO já separa. INICIALIZADO é a peça utilizável; PERDA,
 * SUCATA, INUTILIZADO e COM DEFEITO são baixa de patrimônio; o resto
 * está em processo. Quem não estiver na lista sai em cinza — estado
 * novo aparece, não vira palpite.
 */
const COR_ESTADO: Record<string, string> = {
  'INICIALIZADO': 'var(--st-concluida)',
  'PERDA': 'var(--st-conflito)',
  'SUCATA': 'var(--st-conflito)',
  'INUTILIZADO': 'var(--st-conflito)',
  'COM DEFEITO': 'var(--st-impedimento)',
  'SUSPEITO': 'var(--st-reagendamento)',
  'ANALISE DE INVENTARIO': 'var(--st-reagendamento)',
  'TRANSITO REVERSA': 'var(--st-deslocamento)',
  'GARE': 'var(--st-atribuida)',
}

/** Uma barra horizontal com o rótulo dentro e o número fora. */
function Barra({ rotulo, qtd, total, cor, nota }: {
  rotulo: string; qtd: number; total: number; cor?: string; nota?: string
}) {
  const pct = total > 0 ? (100 * qtd) / total : 0
  return (
    <li className="py-1">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-graf-200" title={rotulo}>
          {rotulo}
          {nota && <span className="ml-1.5 text-[10px] text-graf-400">{nota}</span>}
        </span>
        <span className="tabular text-xs font-semibold text-graf-100">{n(qtd)}</span>
        <span className="tabular w-11 text-right text-[10px] text-graf-400">
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-graf-800">
        <div className="h-full rounded-sm"
          style={{ width: `${Math.max(pct, 0.4)}%`,
                   background: cor ?? 'var(--color-graf-500)' }} />
      </div>
    </li>
  )
}

export default function Almoxarifado() {
  const { pode } = useAuth()
  // 225 (D-336): cada cidade tem o seu estoque; a carga entra na cidade ativa
  const { ativa: cidadeAtiva } = useCidades()
  /** As tres metades do almoxarifado (a terceira e o documento que
   *  liga as duas primeiras). Aba e nao tres telas: o almoxarife
   *  atravessa as tres no mesmo atendimento de balcao. */
  // A central leva direto à aba pelo endereço (?aba=sinalizacoes, 091).
  // 228 (D-339): os menus em abas EM CIMA ("os menus quero que fique em cima e não
  // na lateral" — Emanuel, 07/11), na ordem do trabalho do balcão.
  const [aba, setAba] = useState<'posicao' | 'pagamento' | 'devolucao' | 'transferencia' | 'entrada' | 'cargas' | 'miscelanea' | 'baixa' | 'movimentacoes' | 'sinalizacoes' | 'conferencia'>(
    () => {
      const a = new URLSearchParams(window.location.search).get('aba')
      return a === 'sinalizacoes' || a === 'conferencia' ? a : a === 'romaneios' ? 'pagamento' : 'posicao'
    })
  const { dados: central } = useCentral()
  const [posicao, setPosicao] = useState<Posicao | null>(null)
  const [painel, setPainel] = useState<Painel | null>(null)
  // 228: filtro de tipo e modelo ("deve ter filtro do tipo de equipamento e modelo
  // também" — Emanuel, 07/11): vale para os cartões, os gráficos e a lista
  const [fTipos, setFTipos] = useState<string[]>([])
  const [fModelos, setFModelos] = useState<string[]>([])
  const [fSituacao, setFSituacao] = useState<string | null>(null)
  const [posses, setPosses] = useState<Posse[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // ---- importação ----
  const arquivo = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<
    (LeituraEstoque & { nome: string }) | null>(null)
  const [subindo, setSubindo] = useState(false)
  const [progresso, setProgresso] = useState(0)

  // ---- lista ----
  const [busca, setBusca] = useState('')
  const [fEstado, setFEstado] = useState('TODOS')
  const [lista, setLista] = useState<Equipamento[]>([])
  const [totalLista, setTotalLista] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [carregandoLista, setCarregandoLista] = useState(false)
  /** A peça com a gaveta aberta. */
  const [pecaAberta, setPecaAberta] = useState<string | null>(null)
  /** Recarrega só a lista (a declaração muda a linha, não o painel). */
  const [versaoLista, setVersaoLista] = useState(0)

  const recarregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const [p, ps, pn] = await Promise.all([
      supabase.rpc('estoque_posicao'),
      supabase.from('estoque_posse').select('codigo, rotulo, cor, ordem').order('ordem'),
      supabase.rpc('estoque_painel', { p_tipos: fTipos.length ? fTipos : null, p_modelos: fModelos.length ? fModelos : null }),
    ])
    if (p.error) setErro(p.error.message)
    else setPosicao(p.data as unknown as Posicao)
    if (pn.error) setErro(pn.error.message)
    else setPainel(pn.data as unknown as Painel)
    setPosses((ps.data ?? []) as Posse[])
    setCarregando(false)
  }, [fTipos, fModelos])

  useEffect(() => { recarregar() }, [recarregar])

  // A lista pagina NO BANCO: 15.603 seriais não descem para o navegador
  // para virar 50 linhas na tela. (O contrário da tela de Serviços, e a
  // diferença é o volume: lá são centenas, aqui são dezenas de milhares.)
  useEffect(() => {
    let vivo = true
    setCarregandoLista(true)
    // 228: a lista vem da view estoque_peca (o RLS de equipamento vale), com a situação
    let q = supabase.from('estoque_peca')
      .select('id, serial, enderecavel, tipo, modelo, estado_atlas, posse, ' +
              'local_atlas, atlas_em, estado_afline, estado_afline_em, ' +
              'estado_afline_motivo, situacao, tecnico_nome', { count: 'exact' })
    const t = busca.trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
    // serial ou MAC (o "Endereçável" do Atlas)
    if (t) q = q.or(`serial.like.${t}%,enderecavel.ilike.${t}%`)
    if (fEstado !== 'TODOS') q = q.eq('estado', fEstado)
    if (fTipos.length) q = q.in('tipo', fTipos)
    if (fModelos.length) q = q.in('modelo', fModelos)
    if (fSituacao) q = q.eq('situacao', fSituacao)

    q.order('serial').range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
      .then(({ data, count, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        setLista((data ?? []) as unknown as Equipamento[])
        setTotalLista(count ?? 0)
        setCarregandoLista(false)
      })
    return () => { vivo = false }
  }, [busca, fEstado, fTipos, fModelos, fSituacao, pagina, posicao, versaoLista])

  useEffect(() => { setPagina(1) }, [busca, fEstado, fTipos, fModelos, fSituacao])

  const paginas = Math.max(1, Math.ceil(totalLista / POR_PAGINA))
  const rotuloPosse = useMemo(() => {
    const m = new Map(posses.map(p => [p.codigo, p.rotulo]))
    return (c: string | null) => (c ? m.get(c) ?? c : 'não sabemos')
  }, [posses])

  async function escolher(f: File | undefined) {
    if (!f) return
    setErro(null); setOk(null); setPrevia(null)
    try {
      const l = await lerCargaEstoque(f)
      setPrevia({ ...l, nome: f.name })
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * Sobe em lotes.
   *
   * 15.603 linhas num `jsonb` só é ~8 MB de corpo e um `statement
   * timeout` esperando acontecer. Em lotes de 500 cada chamada é curta,
   * a barra anda, e uma falha no meio não perde o que já entrou — a
   * importação é idempotente pelo serial.
   */
  async function subir() {
    if (!previa) return
    setSubindo(true); setErro(null); setOk(null); setProgresso(0)
    const LOTE = 500
    let criados = 0, atualizados = 0, ignorados = 0
    // 225 (D-336): serial que já é do estoque de OUTRA cidade não é tocado
    let outraCidade = 0
    const seriaisOutra: string[] = []
    try {
      for (let i = 0; i < previa.linhas.length; i += LOTE) {
        const pedaco = previa.linhas.slice(i, i + LOTE)
        const { data, error } = await supabase.rpc('importar_estoque', {
          p_arquivo: previa.nome, p_formato: previa.formato, p_linhas: pedaco,
        })
        if (error) throw new Error(error.message)
        const r = data as { criados: number; atualizados: number; ignorados: number
                            outra_cidade?: number; seriais_outra_cidade?: string[] }
        criados += r.criados; atualizados += r.atualizados; ignorados += r.ignorados
        outraCidade += r.outra_cidade ?? 0
        for (const s of r.seriais_outra_cidade ?? []) if (seriaisOutra.length < 10) seriaisOutra.push(s)
        setProgresso(Math.min(100, Math.round((100 * (i + LOTE)) / previa.linhas.length)))
      }
      setOk(`${n(criados)} peça(s) nova(s), ${n(atualizados)} atualizada(s)`
            + (ignorados ? `, ${n(ignorados)} sem série utilizável` : '')
            + (outraCidade ? `, ${n(outraCidade)} já no estoque de outra cidade (não mexidas: ${seriaisOutra.join(', ')}${outraCidade > seriaisOutra.length ? '…' : ''})` : '')
            + '.')
      setPrevia(null)
      if (arquivo.current) arquivo.current.value = ''
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error
        ? (/permiss/i.test(e.message)
            ? 'Seu perfil não inclui "Importar a carga". A barreira é do banco.'
            : e.message)
        : String(e))
    }
    setSubindo(false)
  }

  const podeImportar = pode('almoxarifado.importar')
  const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
                'outline-none focus:border-af-500'

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Almoxarifado</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            A carga serializada, como o <strong>Atlas</strong> a enxerga e como{' '}
            <strong>nós</strong> a enxergamos. Os dois nem sempre concordam — e é
            justamente onde eles divergem que mora o trabalho.
          </p>
        </div>

        <div className="flex flex-wrap rounded-lg bg-graf-900 p-0.5">
          {/* 228 (D-339): a ordem do balcão do concorrente — painel, saídas
              (pagamento), devoluções, transferências, entradas, alocações,
              movimentações — em ABAS EM CIMA, não na lateral (Emanuel, 07/11).
              D-165: Alocações, Baixar Miscelâneas, Movimentações/Pesquisar
              Serial e Kardex/Auditoria (este dentro de Miscelânea, por item). */}
          {([['posicao', 'Painel'],
             ['pagamento', 'Pagamento'],
             ['devolucao', 'Devolução'],
             ['transferencia', 'Transferência'],
             ['entrada', 'Entrada'],
             ['cargas', 'Equipes / Alocações'],
             ['movimentacoes', 'Movimentações e pesquisa'],
             ['miscelanea', 'Material e ferramenta'],
             ['baixa', 'Baixa por contrato'],
             ['sinalizacoes', 'Sinalizações do campo'],
             ['conferencia', 'Conferência TOA']] as const).map(([a, rot]) => (
            <button key={a} onClick={() => setAba(a)} aria-pressed={aba === a}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
              {rot}
              {a === 'sinalizacoes' && !!central?.material?.length && (
                <span className="tabular ml-1.5 rounded-full bg-af-500 px-1.5 text-[10px] text-white">
                  {central.material.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {aba === 'pagamento' && <Romaneios tipo="ENTREGA" podeMexer={pode('almoxarifado.editar')} />}
        {aba === 'devolucao' && <Romaneios tipo="DEVOLUCAO" podeMexer={pode('almoxarifado.editar')} />}
        {aba === 'transferencia' && <Romaneios tipo="TRANSFERENCIA" podeMexer={pode('almoxarifado.editar')} />}
        {aba === 'miscelanea' && <Miscelanea podeMexer={pode('almoxarifado.editar')} />}
        {aba === 'cargas' && <Cargas />}
        {aba === 'baixa' && <BaixaContrato podeMexer={pode('almoxarifado.editar')} />}
        {aba === 'movimentacoes' && <Movimentacoes />}
        {aba === 'sinalizacoes' && <Sinalizacoes podeMexer={pode('almoxarifado.editar')} />}
        {aba === 'conferencia' && <ConferenciaToa podeTratar={pode('almoxarifado.editar')} />}

        {aba === 'entrada' && (<>
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}
        <Entrada podeMexer={pode('almoxarifado.editar')} />
        {/* ====== importar ====== */}
        {podeImportar && (
          <section className="card-controle p-4">
            <h2 className="text-sm font-semibold">
              Importar a carga do Atlas
              {cidadeAtiva && <span className="font-normal text-graf-300"> · entra em <strong>{cidadeAtiva.nome}</strong></span>}
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-graf-400">
              Aceita os dois relatórios: a <strong>carga</strong> da empreiteira e a{' '}
              <strong>consulta</strong> de posição. O formato é descoberto pelo
              cabeçalho. Reimportar não duplica — o número de série é a chave.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input ref={arquivo} type="file" accept=".xlsx,.xls"
                aria-label="Planilha do Atlas"
                onChange={e => escolher(e.target.files?.[0])}
                className="text-xs text-graf-300 file:mr-3 file:rounded-md
                           file:border file:border-graf-700 file:bg-graf-900
                           file:px-3 file:py-1.5 file:text-xs file:text-graf-200
                           hover:file:border-af-600" />
            </div>

            {previa && (
              <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900 p-3">
                <p className="text-xs text-graf-200">
                  <strong>{previa.nome}</strong> · formato{' '}
                  <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[10px]
                                   font-semibold uppercase tracking-wide">
                    {previa.formato === 'CARGA' ? 'carga' : 'consulta'}
                  </span>
                  {' · '}<span className="tabular">{n(previa.linhas.length)}</span> peça(s)
                </p>
                {/* Zero e desconhecido não são a mesma coisa: o que não
                    entrou sai escrito, com o motivo. */}
                {(previa.semSerial > 0 || previa.dataAmbigua > 0) && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-amber-300">
                    {previa.semSerial > 0 && (
                      <li>{n(previa.semSerial)} linha(s) sem número de série — ficam de fora.</li>
                    )}
                    {previa.dataAmbigua > 0 && (
                      <li>
                        {n(previa.dataAmbigua)} data(s) em formato ambíguo (ex. 9/12/26,
                        que tanto pode ser 9 de dezembro quanto 12 de setembro) — a peça
                        entra, a data fica <strong>vazia</strong>, e o texto original
                        continua guardado.
                      </li>
                    )}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={subir} disabled={subindo}
                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium
                               text-white hover:bg-af-500 disabled:opacity-50">
                    {subindo ? `Subindo… ${progresso}%` : 'Importar'}
                  </button>
                  <button onClick={() => { setPrevia(null)
                                           if (arquivo.current) arquivo.current.value = '' }}
                    disabled={subindo}
                    className="rounded-md border border-graf-700 px-3 py-1.5 text-xs
                               text-graf-300 hover:border-graf-600">
                    Cancelar
                  </button>
                  {subindo && (
                    <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-graf-800">
                      <div className="h-full bg-af-500 transition-[width]"
                        style={{ width: `${progresso}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        </>)}

        {aba === 'posicao' && (<>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {/* ====== o filtro de tipo e modelo (228) ====== */}
        <div className="flex flex-wrap items-center gap-2">
          <SelecaoMultipla rotulo="Tipo" todos="Todo tipo" plural="tipos"
            opcoes={(painel?.opcoes_tipo ?? []).map(o => ({ valor: o.valor, rotulo: o.valor, qtd: o.qtd }))}
            valor={fTipos} onChange={v => { setFTipos(v); setFModelos([]) }} className={campo} />
          <SelecaoMultipla rotulo="Modelo" todos="Todo modelo" plural="modelos"
            opcoes={(painel?.opcoes_modelo ?? []).map(o => ({ valor: o.valor, rotulo: o.valor, qtd: o.qtd }))}
            valor={fModelos} onChange={setFModelos} className={campo} />
          {(fTipos.length > 0 || fModelos.length > 0 || fSituacao) && (
            <button onClick={() => { setFTipos([]); setFModelos([]); setFSituacao(null) }}
              className="text-xs text-af-400 underline underline-offset-2">limpar filtros</button>
          )}
          {painel && (
            <span className="tabular ml-auto text-xs text-graf-400">
              <strong className="text-graf-100">{n(painel.total)}</strong> peça(s)
              {(fTipos.length > 0 || fModelos.length > 0) && ' no filtro'}
            </span>
          )}
        </div>

        {carregando && !painel ? (
          <p className="py-16 text-center text-graf-400" role="status">
            Carregando o painel…
          </p>
        ) : !painel || !posicao || posicao.total === 0 ? (
          <Vazio titulo="Nenhuma peça no estoque ainda"
            descricao={podeImportar
              ? 'Importe o relatório de carga do Atlas na aba Entrada para o almoxarifado começar a existir.'
              : 'Ninguém importou a carga do Atlas ainda. Quem tem a permissão "Importar a carga" faz isso.'} />
        ) : (<>

          {/* ====== a situação, em cartões (228, D-339) — clicar filtra a lista ====== */}
          {/* "diminui um card pra ficar todos na mesma linha" (Emanuel, 07/11):
              na tela larga, uma linha só, os cartões dividindo a largura */}
          <div className="grid gap-2 sm:grid-cols-2 lg:flex">
            {SITUACOES.map(sit => {
              const qtd = painel.por_situacao.find(x => x.situacao === sit.codigo)?.qtd ?? 0
              if (!qtd && !sit.sempre) return null
              const ativo = fSituacao === sit.codigo
              return (
                <button key={sit.codigo} type="button"
                  onClick={() => setFSituacao(ativo ? null : sit.codigo)} aria-pressed={ativo}
                  className={`card-controle flex min-w-0 items-stretch overflow-hidden text-left transition
                              hover:ring-1 hover:ring-graf-600 lg:flex-1 ${ativo ? 'ring-2 ring-af-500' : ''}`}>
                  <span aria-hidden className="w-1.5 shrink-0" style={{ background: sit.cor }} />
                  <span className="min-w-0 flex-1 px-2.5 py-2">
                    <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-graf-300"
                      title={ROTULO_SITUACAO[sit.codigo]}>
                      {ROTULO_SITUACAO[sit.codigo]}
                    </span>
                    <span className="mt-0.5 flex items-baseline gap-2">
                      <span className="tabular text-xl font-semibold leading-none text-graf-100">{n(qtd)}</span>
                      <span className="tabular text-[11px] text-graf-400">
                        {painel.total ? ((100 * qtd) / painel.total).toFixed(1) : '0'}%
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* ====== as três leituras ====== */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold">O que a CLARO diz</h2>
                <p className="mt-0.5 text-[11px] text-graf-400">estado no Atlas (ou o da AFLINE, quando declarado)</p>
              </div>
              <ul className="px-4 py-2">
                {painel.por_estado.map(e => (
                  <Barra key={e.estado} rotulo={e.estado} qtd={e.qtd}
                    total={painel.total} cor={COR_ESTADO[e.estado]} />
                ))}
              </ul>
              {(posicao.com_estado_afline ?? 0) > 0 && (
                <p className="border-t border-graf-800 px-4 py-2 text-[11px] text-graf-400">
                  <strong className="text-graf-200">{n(posicao.com_estado_afline ?? 0)}</strong>{' '}
                  com estado declarado pela AFLINE ·{' '}
                  <strong className={(posicao.divergem_do_atlas ?? 0) > 0
                    ? 'text-amber-400' : 'text-graf-200'}>
                    {n(posicao.divergem_do_atlas ?? 0)}
                  </strong>{' '}
                  divergem do Atlas — é a lista para levar à CLARO.
                </p>
              )}
            </section>

            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold">Por tipo</h2>
                <p className="mt-0.5 text-[11px] text-graf-400">clique para filtrar</p>
              </div>
              <ul className="px-4 py-2">
                {painel.por_tipo.map(t => (
                  <li key={t.tipo} className="cursor-pointer" onClick={() => { setFTipos([t.tipo]); setFModelos([]) }}>
                    <ul><Barra rotulo={t.tipo} qtd={t.qtd} total={painel.total} /></ul>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold">Por modelo</h2>
                <p className="mt-0.5 text-[11px] text-graf-400">os 30 com mais peças · clique para filtrar</p>
              </div>
              <ul className="max-h-80 overflow-y-auto px-4 py-2">
                {painel.por_modelo.map(m => (
                  <li key={m.modelo + m.tipo} className="cursor-pointer" onClick={() => setFModelos([m.modelo])}>
                    <ul><Barra rotulo={m.modelo} nota={m.tipo} qtd={m.qtd} total={painel.total} /></ul>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* ====== a lista ====== */}
          <section className="card-controle overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-graf-800
                            px-4 py-2.5">
              <h2 className="mr-2 text-sm font-semibold">Peça a peça</h2>
              {fSituacao && (
                <button onClick={() => setFSituacao(null)}
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                  style={{ background: corSituacao(fSituacao) }}>
                  {ROTULO_SITUACAO[fSituacao] ?? fSituacao} ✕
                </button>
              )}
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Série ou MAC (começo)…"
                aria-label="Buscar por número de série ou MAC"
                className={`${campo} min-w-52 flex-1`} />
              <select value={fEstado} onChange={e => setFEstado(e.target.value)}
                aria-label="Filtrar por estado no Atlas" className={campo}>
                <option value="TODOS">Todo estado</option>
                {painel.por_estado.map(e => (
                  <option key={e.estado} value={e.estado}>{e.estado}</option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-700 bg-graf-900 text-left
                                  text-[10px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Série · MAC</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Modelo</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="px-3 py-2 font-medium">Estado (Atlas · AFLINE)</th>
                    <th className="px-3 py-2 font-medium">Técnico</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(e => (<Fragment key={e.id}>
                    <tr onClick={() => setPecaAberta(pecaAberta === e.id ? null : e.id)}
                      className={`cursor-pointer border-b border-graf-800 hover:bg-graf-800/40
                                  ${pecaAberta === e.id ? 'bg-graf-800/40' : ''}`}>
                      <td className="tabular px-3 py-1.5 text-xs font-medium text-graf-100">
                        <button onClick={ev => {
                            ev.stopPropagation()
                            setPecaAberta(pecaAberta === e.id ? null : e.id)
                          }}
                          aria-expanded={pecaAberta === e.id}
                          aria-label={`${pecaAberta === e.id ? 'Fechar' : 'Abrir'} a peça ${e.serial}`}
                          className="mr-1.5 text-graf-400 hover:text-af-400">
                          {pecaAberta === e.id ? '▾' : '▸'}
                        </button>
                        {e.serial}
                        {e.enderecavel && (
                          <span className="ml-1.5 text-[10px] text-graf-400">{e.enderecavel}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-graf-300">{e.tipo ?? '—'}</td>
                      <td className="max-w-64 truncate px-3 py-1.5 text-xs text-graf-400"
                        title={e.modelo ?? undefined}>
                        {e.modelo ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-graf-200">
                          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: corSituacao(e.situacao) }} />
                          {ROTULO_SITUACAO[e.situacao] ?? e.situacao}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {e.estado_atlas ? (
                            <span className="pill text-[10px]"
                              style={{ ['--pill-cor' as string]:
                                COR_ESTADO[e.estado_atlas] ?? 'var(--color-graf-500)' }}>
                              {e.estado_atlas}
                            </span>
                          ) : <span className="text-xs text-graf-400">—</span>}
                          {e.estado_afline && (
                            <EstadoAfline estado={e.estado_afline}
                              cor={COR_ESTADO[e.estado_afline] ?? 'var(--color-graf-400)'} />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-graf-300">{e.tecnico_nome ?? '—'}</td>
                    </tr>
                    {pecaAberta === e.id && (
                      <tr className="border-b border-graf-800 bg-graf-900">
                        <td colSpan={6} className="p-0"
                          style={{ boxShadow: 'inset 3px 0 0 0 var(--color-af-500)' }}>
                          <PecaDetalhe peca={e}
                            estados={painel.por_estado.map(x => x.estado)
                              .filter(x => x !== '(sem estado)')}
                            podeMexer={pode('almoxarifado.editar')}
                            corEstado={x => COR_ESTADO[x] ?? 'var(--color-graf-400)'}
                            rotuloPosse={rotuloPosse}
                            aoMudar={() => { setVersaoLista(v => v + 1); recarregar() }} />
                        </td>
                      </tr>
                    )}
                  </Fragment>))}
                  {!carregandoLista && lista.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-xs text-graf-400">
                        Nenhuma peça com esses filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalLista > POR_PAGINA && (
              <nav aria-label="Páginas do estoque"
                className="flex flex-wrap items-center gap-3 border-t border-graf-800
                           px-4 py-2.5 text-xs">
                <span className="tabular text-graf-400">
                  {n((pagina - 1) * POR_PAGINA + 1)}–
                  {n(Math.min(pagina * POR_PAGINA, totalLista))} de {n(totalLista)}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => setPagina(p => Math.max(1, p - 1))}
                    disabled={pagina === 1} aria-label="Página anterior"
                    className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                               hover:border-af-600 hover:text-af-400 disabled:opacity-35">
                    ‹ anterior
                  </button>
                  <span className="tabular px-1 text-graf-200" aria-current="page">
                    {pagina} / {n(paginas)}
                  </span>
                  <button onClick={() => setPagina(p => Math.min(paginas, p + 1))}
                    disabled={pagina >= paginas} aria-label="Próxima página"
                    className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                               hover:border-af-600 hover:text-af-400 disabled:opacity-35">
                    próxima ›
                  </button>
                </span>
              </nav>
            )}
          </section>

          {posicao.ultima_importacao && (
            <p className="pb-6 text-center text-[11px] text-graf-400">
              última carga: {new Date(posicao.ultima_importacao.em).toLocaleString('pt-BR')}
              {posicao.ultima_importacao.arquivo && ` · ${posicao.ultima_importacao.arquivo}`}
              {' · '}{n(posicao.ultima_importacao.criados)} nova(s),{' '}
              {n(posicao.ultima_importacao.atualizados)} atualizada(s)
            </p>
          )}
        </>)}

        </>)}
      </div>
    </Shell>
  )
}
