import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACOES, SITUACAO_INFO, EM_ABERTO, type Situacao } from '../lib/supabase'
import { MarcadoresDoContrato } from './MarcadoresDoContrato'
import { Alerta, Pill } from './ui'
import { rotuloEvento, transicaoEvento } from '../lib/eventos'
import { equipeRotulo, mascaraTelefone, pts } from '../lib/formato'
import { carregarLocais, type LocalBaixa } from '../lib/localBaixa'
import { SeloLocal } from './TabelaContratos'
import type { AcaoContrato } from './MenuContrato'
import { EquipamentoToa, contagemToa, useEquipamentoToa } from './EquipamentoToa'
import { SinaisContrato, useSinaisDasVisitas } from './SinaisContrato'
import { SeloOuvidoria, SeloSegmento } from './MarcasCliente'

/** O código de baixa com o destino dele (D-097): é o destino que diz
 *  para qual situação final o código serve (098). */
export interface CodigoDeBaixa {
  codigo: number; descricao: string; situacao_destino: string | null
}

/** As três situações que encerram — as únicas com código de baixa (098).
 *  A lista canônica é `situacoes_terminais()` no banco; esta é a cara dela. */
const TERMINAIS = ['CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO'] as const
/** D-306: o Auditar é a Cancelada com o 800 (Desatribuído) em toda O.S. (D-191). */
const AUDITAR = 'AUDITAR'
/** D-306 (208): Cancelado pela central marcado pela baixa — o -1 em toda O.S. e a marca. */
const CENTRAL = 'CENTRAL'
/** D-306: os status que o painel de baixa oferece SEM código — o mesmo
 *  `registrar_etapa` / `reverter_situacao` do "Mudar status". */
const SO_STATUS: Situacao[] = ['ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'EM_EXECUCAO', 'COM_IMPEDIMENTO']

/**
 * O contrato aberto em janela, não em linha expandida (D-056).
 *
 * A expansão empurrava a lista inteira para baixo e ainda assim não
 * cabia o que o COP precisa ver. A janela abre no clique, mostra tudo e
 * fecha sem mexer no scroll de quem está trabalhando na lista.
 *
 * Ela busca o próprio dado: quem chama passa só o id.
 */

interface OS {
  id: string; sequencia: number; numero_os: string | null
  descricao: string | null; origem: string | null
  status_operadora: string | null; ponto: string | null; produto: string | null
  baixa_em: string | null; baixa_observacao: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: { codigo: number; descricao: string; natureza: string | null
                  responsabilidade: string | null } | null
  baixa_afline: { codigo: number; descricao: string; natureza: string | null
                  responsabilidade: string | null } | null
  sub_falha: { nome: string; categoria: string | null } | null
}
interface Evento {
  id: number; tipo: string; criado_em: string; observacao: string | null
  login: string | null; origem: string | null
  de: Record<string, unknown> | null; para: Record<string, unknown> | null
  usuario: { nome: string } | null
  equipe: { codigo: string } | null
  codigo_baixa: { codigo: number; descricao: string } | null
  sub_falha: { nome: string } | null
}
interface Visita {
  id: string; contrato: string | null; wo_numero: string | null
  toa_atividade_id: string | null; cliente_nome: string | null
  /** 117: quando a varredura leu o equipamento no TOA. */
  toa_varrido_em: string | null
  /** 123: como o TOA mandou. */
  segmentacao: { nome: string } | null; ouvidoria: boolean | null
  tipo_pessoa: string | null; tipo_residencia: string | null; telefones: string[] | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null
  node: string | null; lat: number | null; lng: number | null
  data_agendada: string; janela_inicio: string | null; janela_fim: string | null
  situacao: Situacao; inicio: string | null; fim: string | null
  bloqueado_em: string | null; origem: string | null
  /** Enquanto não for nulo, a importação não mexe na equipe nem no
   *  técnico deste contrato (066). O resto continua espelhando o TOA. */
  rota_fixada_em: string | null
  rota_fixada_motivo: string | null
  tipo_atividade: { nome: string } | null
  tipo_servico: { nome: string } | null
  /** O grupo de serviço editável no "Editar serviço". */
  tipo_servico_id: string | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { id: string; codigo: string; nome: string; supervisor_nome: string | null } | null
  tecnico: { nome: string; matricula: string } | null
  ordem_servico: OS[]
  visita_marcador: { id: string; indicador_id: string }[]
  visita_evento: Evento[]
  /** 096. `unique` por visita (é a chave), então o PostgREST devolve
   *  OBJETO ou null — não array (armadilha da `reincidencia`). */
  contato_cliente: { telefone: string | null; login: string | null
                     atualizado_em: string } | null
}

const SELECT = `
  id, contrato, wo_numero, toa_atividade_id, cliente_nome, toa_varrido_em,
  ouvidoria, segmentacao:segmentacao_id ( nome ), tipo_pessoa, tipo_residencia, telefones,
  contato_cliente ( telefone, login, atualizado_em ),
  logradouro, complemento, bairro, cidade, uf, cep, node, lat, lng,
  data_agendada, janela_inicio, janela_fim, situacao, inicio, fim,
  bloqueado_em, origem, rota_fixada_em, rota_fixada_motivo,
  tipo_atividade:tipo_atividade_id ( nome ),
  tipo_servico:tipo_servico_id ( nome ), tipo_servico_id,
  area:area_id ( codigo, apelido ),
  equipe:equipe_id ( id, codigo, nome, supervisor_nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  ordem_servico (
    id, sequencia, numero_os, descricao, origem, status_operadora,
    ponto, produto, baixa_em, baixa_observacao,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade ),
    baixa_afline:codigo_baixa_afline_id ( codigo, descricao, natureza, responsabilidade ),
    sub_falha:sub_falha_id ( nome, categoria )
  ),
  visita_marcador ( id, indicador_id ),
  visita_evento (
    id, tipo, criado_em, observacao, login, de, para, origem,
    usuario:usuario_id ( nome ),
    equipe:equipe_id ( codigo ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao ),
    sub_falha:sub_falha_id ( nome )
  )
`

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)
const quando = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

function corBaixa(n: string | null | undefined) {
  if (n === 'SUCESSO') return 'bg-emerald-900/40 text-emerald-300 ring-emerald-700/40'
  if (n === 'IMPRODUTIVA') return 'bg-af-900/40 text-af-300 ring-af-700/40'
  return 'bg-graf-800 text-graf-400 ring-graf-700'
}

/** O ícone de lixeira (remover telefone, apagar evidência). SVG à mão,
 *  na cor do texto — sem biblioteca de ícone. */
export function Lixeira({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  )
}

function Dado({ r, v, largo }: { r: string; v: React.ReactNode; largo?: boolean }) {
  return (
    <div className={largo ? 'sm:col-span-2' : ''}>
      <div className="text-[10px] uppercase tracking-wide text-graf-500">{r}</div>
      <div className="mt-0.5 text-sm text-graf-200">
        {v || <span className="text-graf-600">—</span>}
      </div>
    </div>
  )
}

/**
 * ┌─ 155 · a janela virou o PAINEL DE AÇÕES da página cheia ──────────┐
 * │ > "o sistema deve desconsiderar essa tela menor. O ideal é        │
 * │ >  aparecer somente a tela maior. A tela de página cheia. Essa    │
 * │ >  sim deve ser a principal, para não ter duas telas que mostrem  │
 * │ >  a mesma informação" — Emanuel, 29/10                           │
 * │                                                                     │
 * │ Apagar a janela e pronto teria TIRADO três comandos: + O.S.,      │
 * │ Mudar status e Excluir só existiam aqui — a página cheia nunca os │
 * │ teve. "Some com a tela menor" não é "some com o que ela fazia".   │
 * │                                                                     │
 * │ Então ela não foi apagada: em `modo="pagina"` ela deixa de ser    │
 * │ sobreposição e vira a barra de ações DENTRO de VisitaDetalhe —    │
 * │ mesmos botões, mesmos painéis, mesmo código. O que a página cheia │
 * │ já mostra (detalhe, histórico, equipamento) fica de fora, que era │
 * │ justamente a duplicação reclamada; Marcadores fica, porque só     │
 * │ existe aqui.                                                       │
 * └─────────────────────────────────────────────────────────────────────┘
 */
export function ContratoModal({
  id, indicadores, codigos, conjunto, equipes, pontos, onFechar, onMudou, acaoInicial,
  modo = 'janela',
}: {
  id: string
  indicadores: { id: string; nome: string }[]
  codigos: CodigoDeBaixa[]
  conjunto: string | null
  equipes: { id: string; codigo: string; nome: string }[]
  pontos?: { pontos_claro: number | null; edificacao: string; edificacao_de: string } | null
  onFechar: () => void
  onMudou: () => void
  /** Veio do menu do botão direito: abre já na ação escolhida. */
  acaoInicial?: AcaoContrato | null
  /** 155: `pagina` = sem sobreposição, embutida em VisitaDetalhe. */
  modo?: 'janela' | 'pagina'
}) {
  const pagina = modo === 'pagina'
  const [v, setV] = useState<Visita | null>(null)
  const [aba, setAba] = useState<'detalhe' | 'historico' | 'equipamento' | 'miscelanea' | 'marcadores'>(
    acaoInicial === 'marcadores' ? 'marcadores' : 'detalhe')
  // D-252: o que o TOA mostra, lido uma vez para as abas Equipamento e Miscelânea
  const itensToa = useEquipamentoToa(v?.id, v?.toa_varrido_em)
  const sinalDoContrato = useSinaisDasVisitas(v?.id ? [v.id] : [])
  const contaToa = (t: 'EQUIPAMENTO' | 'MISCELANEA') => {
    const n = contagemToa(itensToa, v?.toa_varrido_em, t)
    return n === undefined ? '' : ` (${n})`
  }
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [acao, setAcao] = useState<
    'baixar' | 'transferir' | 'excluir' | 'editar_cliente' | 'editar_servico'
    | 'status' | 'nova_os' | null>(
    acaoInicial && acaoInicial !== 'marcadores' ? acaoInicial : null)

  // Baixa — uma linha por O.S., todas de uma vez.
  //
  // Baixar de uma em uma deixava o contrato meio baixado com uma
  // situacao que dizia "concluido". Agora o usuario informa o codigo de
  // cada O.S. e escolhe a situacao final; o banco recusa situacao
  // terminal com O.S. faltando (`exige_todas_baixadas`).
  type Preenchida = { codigo: string; sub: string; obs: string }
  const [baixas, setBaixas] = useState<Record<string, Preenchida>>({})
  const [subPorCodigo, setSubPorCodigo] =
    useState<Record<string, { id: string; nome: string }[]>>({})
  const [situacaoFinal, setSituacaoFinal] = useState('')
  // transferência
  const [destino, setDestino] = useState('')
  const [motivoT, setMotivoT] = useState('')
  const [diaT, setDiaT] = useState('')
  // exclusão
  const [motivoE, setMotivoE] = useState('')
  const [confirmaE, setConfirmaE] = useState('')
  // edição do cadastro — o que o sistema atual não deixa fazer
  const [ed, setEd] = useState<Record<string, string>>({})
  // Os telefones viraram lista: cada um se edita ou sai (lixeira).
  const [tels, setTels] = useState<string[]>([])
  const [novoTel, setNovoTel] = useState('')
  // O grupo de serviço do "Editar serviço" — carregado só quando abre.
  const [grupos, setGrupos] = useState<{ id: string; nome: string }[]>([])
  // mudar status (o antigo "Voltar")
  const [situacaoAlvo, setSituacaoAlvo] = useState<Situacao | ''>('')
  const [motivoV, setMotivoV] = useState('')
  // nova O.S. no contrato existente
  const [tiposOS, setTiposOS] = useState<{ id: string; codigo: number; descricao: string }[]>([])
  const [novaTipo, setNovaTipo] = useState('')
  const [novaNumero, setNovaNumero] = useState('')
  const [novaDescricao, setNovaDescricao] = useState('')

  // Onde a baixa do campo foi dada (096). Nulo = ninguém baixou pelo celular.
  const [local, setLocal] = useState<LocalBaixa | null>(null)

  async function carregar() {
    carregarLocais([id]).then(m => setLocal(m.get(id) ?? null)).catch(() => setLocal(null))
    const { data, error } = await supabase.from('visita').select(SELECT).eq('id', id).single()
    if (error) setErro(error.message)
    else {
      const d = data as unknown as Visita
      setV(d)
      // Comeca com o que ja esta gravado, para trocar so o que muda.
      setBaixas(Object.fromEntries(d.ordem_servico.map(o => [o.id, {
        codigo: o.baixa_afline ? String(o.baixa_afline.codigo) : '',
        sub: '', obs: o.baixa_observacao ?? '',
      }])))
      // Encerrado: a baixa já parte da situação em que ele está. Aberto:
      // quem baixa escolhe como termina — o sistema não escolhe por ele.
      setSituacaoFinal((TERMINAIS as readonly string[]).includes(d.situacao) ? d.situacao : '')
    }
  }
  useEffect(() => { carregar() }, [id])

  // O catálogo de tipo de O.S. só é preciso quando o usuário vai
  // acrescentar uma — carregar antes seria peso à toa em cada abertura.
  useEffect(() => {
    if (acao !== 'nova_os' || tiposOS.length) return
    supabase.from('tipo_os').select('id, codigo, descricao').order('codigo')
      .then(({ data }) => setTiposOS(
        (data ?? []) as { id: string; codigo: number; descricao: string }[]))
  }, [acao, tiposOS.length])

  /*
   * ┌─ editar cliente ≠ editar serviço ─────────────────────────────────┐
   * │ > "O sistema deve diferenciar entre editar serviço e editar       │
   * │ >  endereço/cliente" — Emanuel, 09/11                             │
   * │                                                                     │
   * │ Era um formulário só, com cliente, endereço e agendamento juntos.  │
   * │ Agora são dois blocos, na MESMA RPC (`atualizar_visita_manual`),   │
   * │ e cada um manda só as chaves dele: a RPC só toca o que veio, então │
   * │ salvar o endereço não regrava a janela, e vice-versa.             │
   * └─────────────────────────────────────────────────────────────────────┘
   */
  function abrirEdicao(qual: 'editar_cliente' | 'editar_servico') {
    if (!v) return
    if (qual === 'editar_cliente') {
      setEd({
        cliente_nome: v.cliente_nome ?? '', tipo_pessoa: v.tipo_pessoa ?? '',
        tipo_residencia: v.tipo_residencia ?? '',
        logradouro: v.logradouro ?? '', complemento: v.complemento ?? '',
        bairro: v.bairro ?? '', cidade: v.cidade ?? '', uf: v.uf ?? '',
        cep: v.cep ?? '', node: v.node ?? '',
      })
      setTels([...(v.telefones ?? [])]); setNovoTel('')
    } else {
      setEd({
        contrato: v.contrato ?? '', wo_numero: v.wo_numero ?? '',
        tipo_servico_id: v.tipo_servico_id ?? '',
        data_agendada: v.data_agendada,
        janela_inicio: hhmm(v.janela_inicio) ?? '', janela_fim: hhmm(v.janela_fim) ?? '',
      })
    }
    setAcao(acao === qual ? null : qual)
  }

  /** Os telefones como vão para o banco: sem espaço sobrando, sem linha vazia. */
  const telsLimpos = () => {
    const extra = novoTel.trim()
    return [...tels, ...(extra ? [extra] : [])].map(t => t.trim()).filter(Boolean)
  }
  /** Só manda `telefones` se a lista mudou — a RPC REESCREVE quando a chave vem. */
  const telsMudaram = () => {
    const a = telsLimpos(), b = v?.telefones ?? []
    return a.length !== b.length || a.some((t, i) => t !== b[i])
  }

  useEffect(() => {
    if (acao !== 'editar_servico' || grupos.length) return
    supabase.from('tipo_servico').select('id, nome').eq('ativo', true).order('nome')
      .then(({ data }) => setGrupos((data ?? []) as { id: string; nome: string }[]))
  }, [acao, grupos.length])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  // Busca a sub-falha de cada codigo escolhido, uma vez por codigo.
  // Os dois conjuntos convivem no banco; sem filtrar pelo vigente a
  // lista vem em dobro.
  useEffect(() => {
    const faltam = [...new Set(Object.values(baixas).map(b => b.codigo).filter(Boolean))]
      .filter(c => !(c in subPorCodigo))
    if (!faltam.length) return
    let vivo = true
    ;(async () => {
      const novo: Record<string, { id: string; nome: string }[]> = {}
      for (const c of faltam) {
        let q = supabase.from('sub_falha').select('id, nome').eq('codigo', Number(c))
          // Excluída em Configurações = `ativo` falso: some da escolha, mas
          // continua no histórico de quem já usou (D-161).
          .eq('ativo', true)
        if (conjunto) q = q.eq('conjunto', conjunto)
        const { data } = await q.order('ordem')
        novo[c] = (data ?? []) as { id: string; nome: string }[]
      }
      if (vivo) setSubPorCodigo(a => ({ ...a, ...novo }))
    })()
    return () => { vivo = false }
  }, [baixas, conjunto, subPorCodigo])

  const marcados = useMemo(() => {
    const nomes = new Map(indicadores.map(i => [i.id, i.nome]))
    return (v?.visita_marcador ?? [])
      .map(m => ({ id: m.id, indicador_id: m.indicador_id, nome: nomes.get(m.indicador_id) }))
      .filter(x => x.nome)
  }, [v, indicadores])

  async function comAviso(
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    msg: string,
  ) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await fn()
    if (error) setErro(error.message)
    else { setOk(msg); setAcao(null); await carregar(); onMudou() }
    setOcupado(false)
  }

  async function alternarMarcador(indicadorId: string) {
    const atual = v?.visita_marcador.find(m => m.indicador_id === indicadorId)
    await comAviso(
      () => atual
        ? supabase.from('visita_marcador').delete().eq('id', atual.id)
        : supabase.from('visita_marcador').insert({ visita_id: id, indicador_id: indicadorId }),
      atual ? 'Marcador removido.' : 'Marcador aplicado.')
  }

  const endereco = v
    ? [v.logradouro, v.complemento, v.bairro, v.cidade, v.uf].filter(Boolean).join(', ')
    : ''
  const cor = v ? SITUACAO_INFO[v.situacao]?.cor ?? '#64748b' : '#64748b'

  const corpo = (
      <div onClick={pagina ? undefined : e => e.stopPropagation()}
        style={{ borderTopColor: cor }}
        className={pagina
          ? 'w-full overflow-hidden rounded-xl border border-graf-700 border-t-4 bg-graf-950'
          : `janela-caixa sup-controle mt-6 w-full max-w-5xl rounded-xl
             border border-graf-700 border-t-4 bg-graf-950 shadow-2xl`}>

        {/* ---------- cabeçalho ---------- */}
        <div className="flex flex-wrap items-center gap-3 border-b border-graf-800 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {v && <Pill situacao={v.situacao} />}
              <h2 className="truncate text-lg font-semibold">
                Contrato {v?.contrato ?? '—'}
              </h2>
              {/* 174 (D-261): prédio, casa e o vai-e-volta, como o TOA */}
              <SinaisContrato s={sinalDoContrato.get(v?.id ?? '')} tamanho="md" />
              <SeloOuvidoria ouvidoria={v?.ouvidoria} grande />
              <SeloSegmento segmentacao={v?.segmentacao?.nome} grande />
            </div>
            <p className="mt-0.5 text-xs text-graf-400">
              {v && new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR')}
              {v?.janela_inicio && ` · ${hhmm(v.janela_inicio)}–${hhmm(v.janela_fim) ?? '?'}`}
              {v?.tipo_servico?.nome && ` · ${v.tipo_servico.nome}`}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {pontos?.pontos_claro != null && (
              <span title={`Edificação ${pontos.edificacao} (${pontos.edificacao_de.toLowerCase()})`}
                className="rounded bg-emerald-900/30 px-2 py-1 text-xs font-semibold
                           text-emerald-300 ring-1 ring-emerald-700/40">
                ★ {pts(pontos.pontos_claro)}
              </span>
            )}
            <button onClick={() => abrirEdicao('editar_cliente')} disabled={!v}
              aria-pressed={acao === 'editar_cliente'}
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              Editar cliente/endereço
            </button>
            <button onClick={() => abrirEdicao('editar_servico')} disabled={!v}
              aria-pressed={acao === 'editar_servico'}
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              Editar serviço
            </button>
            <button onClick={() => setAcao(acao === 'nova_os' ? null : 'nova_os')}
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400">
              + O.S.
            </button>
            {/* 160: os marcadores ao lado do + O.S., numa lista que abre
                (Emanuel, 31/10). Na janela pequena eles têm aba própria. */}
            {/* O "Marcadores…" do botão direito chega aqui como acaoInicial:
                na página cheia não há aba para abrir, então abre a lista. */}
            {pagina && <MarcadoresDoContrato visitaId={id}
              abrirJa={acaoInicial === 'marcadores'} />}
            <button onClick={() => setAcao(acao === 'status' ? null : 'status')}
              title="Levar o contrato para o status que você escolher — o sistema da CLARO não volta status"
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400">
              Mudar status
            </button>
            <button onClick={() => setAcao(acao === 'transferir' ? null : 'transferir')}
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400">
              Transferir
            </button>
            <button onClick={() => setAcao(acao === 'baixar' ? null : 'baixar')}
              disabled={!v?.ordem_servico.length}
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              Baixar serviço
            </button>
            <button onClick={() => setAcao(acao === 'excluir' ? null : 'excluir')}
              className="rounded-md border border-af-800 px-2.5 py-1 text-xs text-af-300
                         hover:border-af-600">
              Excluir
            </button>
            {/* 155: na página cheia estes dois não fazem sentido — ela
                JÁ é a página cheia, e quem fecha é o Esc (ou o Voltar). */}
            {!pagina && <>
              <Link to={`/controle/visita/${id}`}
                className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                           hover:border-af-600 hover:text-af-400">
                Página cheia
              </Link>
              <button onClick={onFechar} title="Fechar (Esc)"
                className="rounded-md px-2 py-1 text-lg leading-none text-graf-500
                           hover:text-graf-200">
                ×
              </button>
            </>}
          </div>
        </div>

        {/* ---------- abas ----------
             155: na página cheia sobra só Marcadores. Detalhe, Histórico e
             Equipamento estão logo abaixo, na própria VisitaDetalhe — e era
             exatamente essa a reclamação ("duas telas que mostram a mesma
             informação"). Marcadores não existe lá, então fica. */}
        {/* 156: na página cheia a aba some de vez -- os marcadores viraram
            um cartão próprio ao lado das O.S. (MarcadoresDoContrato), porque
            atrás de uma aba ninguém os achou (Emanuel, 30/10). */}
        {!pagina && <div className="flex gap-1 border-b border-graf-800 px-5 pt-2">
          {(pagina
            ? [['marcadores', `Marcadores (${marcados.length})`]] as const
            : [['detalhe', 'Detalhe'],
               ['historico', `Histórico (${v?.visita_evento.length ?? 0})`],
               // 133: o equipamento do TOA tem aba própria aqui também.
               ['equipamento', `Equipamento${contaToa('EQUIPAMENTO')}`],
               ['miscelanea', `Miscelânea${contaToa('MISCELANEA')}`],
               ['marcadores', `Marcadores (${marcados.length})`]] as const
          ).map(([a, rot]) => (
            <button key={a} onClick={() => setAba(pagina && aba === a ? 'detalhe' : a)}
              className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition ${
                aba === a ? 'bg-graf-900 text-af-300' : 'text-graf-400 hover:text-graf-200'}`}>
              {rot}
            </button>
          ))}
        </div>}

        <div className={pagina
          ? 'space-y-4 p-5'
          : 'max-h-[70vh] space-y-4 overflow-y-auto p-5'}>
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {ok && <Alerta tipo="ok">{ok}</Alerta>}

          {/* ---------- ações ---------- */}
          {acao === 'baixar' && v && (() => {
            const ordenadas = [...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia)
            const preenchidas = ordenadas.filter(o => baixas[o.id]?.codigo).length
            const faltam = ordenadas.length - preenchidas
            // 098: o código serve a UMA situação final (o destino dele, D-097).
            // 409 não cancela; código de cancelamento não conclui.
            // D-306: Auditar = Cancelada com o 800; "só o status" = sem código
            const auditar = situacaoFinal === AUDITAR
            const central = situacaoFinal === CENTRAL
            const soStatus = (SO_STATUS as string[]).includes(situacaoFinal)
            const destinoReal = auditar || central ? 'CANCELADA' : situacaoFinal
            const doDestino = auditar
              ? codigos.filter(c => c.codigo === 800)
              : codigos.filter(c => c.situacao_destino === destinoReal)
            const destinoDe = new Map(codigos.map(c => [String(c.codigo), c.situacao_destino]))
            const rotuloFinal = auditar ? 'Auditar' : central ? 'Cancelado pela central'
              : SITUACAO_INFO[situacaoFinal as Situacao]?.label ?? situacaoFinal
            const encerrado = !EM_ABERTO.includes(v.situacao)
            const trocarFinal = (s: string) => {
              setSituacaoFinal(s)
              if (s === AUDITAR) {
                // o 800 em todas as O.S. — é isso que faz o contrato "Auditar"
                setBaixas(Object.fromEntries(ordenadas.map(o => [o.id,
                  { codigo: '800', sub: '', obs: baixas[o.id]?.obs ?? '' }])))
                return
              }
              // O código que não serve à situação nova sai — deixá-lo lá seria
              // oferecer um botão que o banco recusa.
              setBaixas(a => Object.fromEntries(Object.entries(a).map(([k, b]) =>
                [k, destinoDe.get(b.codigo) === s && b.codigo !== '800' ? b : { ...b, codigo: '', sub: '' }])))
            }
            const chip = (s: string, rot: string, cor: string) => {
              const ativo = situacaoFinal === s
              return (
                <button key={s} onClick={() => trocarFinal(s)} aria-pressed={ativo}
                  style={ativo ? { borderColor: cor, color: cor } : undefined}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${ativo
                    ? 'bg-graf-850' : 'border-graf-700 text-graf-400 hover:text-graf-200'}`}>
                  {rot}
                </button>
              )
            }

            return (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-1 text-xs font-medium">
                Baixar serviço
                <span className="ml-2 font-normal text-graf-500">
                  esta é a baixa da AFLINE — a da operadora vem do TOA e não se edita
                </span>
              </p>
              {/* ---- 1. o status: com código (encerra) ou sem código ----
                  D-306: "o correto é ter outros status de escolher, em vez de
                  ficar concluído, cancelado, reagendado" (Emanuel, 04/11). */}
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 w-28 text-[11px] text-graf-400"
                  title="Cada código de baixa serve a uma destas situações">Encerrar (com código)</span>
                {TERMINAIS.map(s => chip(s, SITUACAO_INFO[s]?.label ?? s, SITUACAO_INFO[s]?.cor ?? '#64748b'))}
                {chip(CENTRAL, 'Cancelado pela central', '#b65a55')}
                {chip(AUDITAR, 'Auditar', '#b08640')}
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 w-28 text-[11px] text-graf-400"
                  title="Muda o status sem código de baixa">Só o status</span>
                {SO_STATUS.filter(s => s !== v.situacao).map(s =>
                  chip(s, SITUACAO_INFO[s]?.label ?? s, SITUACAO_INFO[s]?.cor ?? '#64748b'))}
              </div>

              {!situacaoFinal ? (
                <p className="rounded-md border border-dashed border-graf-700 px-3 py-4 text-center
                              text-xs text-graf-400">
                  Escolha o status — para encerrar, a lista de códigos depende dele.
                </p>
              ) : central ? (
                // 208: o -1 "Cancelado no Sistema NETSMS" em todas as O.S. e a marca
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-64 flex-1 text-[11px] text-graf-400">
                    <span className="mb-1 block">Observação (opcional — vai em cada O.S.)</span>
                    <input value={motivoV} onChange={e => setMotivoV(e.target.value)}
                      placeholder="Ex.: central cancelou por telefone"
                      className={`${campo} w-full`} />
                  </label>
                  <button disabled={ocupado}
                    title={`Baixa as ${ordenadas.length} O.S. com -1 · Cancelado no Sistema NETSMS`}
                    onClick={() => comAviso(() => supabase.rpc('cancelar_pela_central', {
                      p_visita: id, p_observacao: motivoV.trim() || null,
                    }), 'Contrato cancelado pela central.')}
                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                               hover:bg-af-500 disabled:opacity-50">
                    Cancelar pela central ({ordenadas.length} O.S.)
                  </button>
                </div>
              ) : soStatus ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-64 flex-1 text-[11px] text-graf-400">
                    <span className="mb-1 block">
                      {encerrado ? 'Motivo (obrigatório — o contrato está encerrado)' : 'Observação para o técnico (opcional)'}
                    </span>
                    <input value={motivoV} onChange={e => setMotivoV(e.target.value)}
                      placeholder={encerrado ? 'Baixa indevida, reabertura…' : 'Vai como aviso no celular do técnico'}
                      className={`${campo} w-full`} />
                  </label>
                  <button disabled={ocupado || (encerrado && !motivoV.trim())}
                    onClick={() => comAviso(() => encerrado
                      ? supabase.rpc('reverter_situacao', {
                          p_visita: id, p_situacao: situacaoFinal, p_motivo: motivoV.trim(),
                        })
                      : supabase.rpc('registrar_etapa', {
                          p_visita: id, p_situacao: situacaoFinal,
                          p_observacao: motivoV.trim() || null, p_lat: null, p_lng: null,
                        }), `Status mudado para ${rotuloFinal}.`)}
                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                               hover:bg-af-500 disabled:opacity-50">
                    Mudar para {rotuloFinal.toLowerCase()}
                  </button>
                </div>
              ) : (<>
              <p className="mb-2 text-[11px] text-graf-400">
                {rotuloFinal} exige o código de <strong>todas</strong> as {ordenadas.length} O.S.
                {' '}— {preenchidas} preenchida(s). {doDestino.length} código(s) de
                {' '}{rotuloFinal.toLowerCase()}.
              </p>
              <div className="space-y-2">
                {ordenadas.map(o => {
                  const b = baixas[o.id] ?? { codigo: '', sub: '', obs: '' }
                  const subs = subPorCodigo[b.codigo] ?? []
                  const mudar = (p: Partial<typeof b>) =>
                    setBaixas(a => ({ ...a, [o.id]: { ...b, ...p } }))
                  return (
                    <div key={o.id}
                      className={`rounded-md border p-2.5 ${b.codigo
                        ? 'border-graf-700 bg-graf-850' : 'border-af-800/60 bg-af-900/10'}`}>
                      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="tabular text-[11px] text-graf-500">#{o.sequencia}</span>
                        <span className="tabular text-xs font-medium">{o.numero_os}</span>
                        <span className="text-[11px] text-graf-400">
                          {o.descricao ?? o.tipo_os?.descricao ?? '—'}
                        </span>
                        {o.baixa_afline && (
                          <span className="text-[10px] text-graf-400">
                            baixada em {quando(o.baixa_em)} com {o.baixa_afline.codigo}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[11px] text-graf-400">
                          <span className="mb-1 block">Código de baixa</span>
                          <select value={b.codigo} className={`${campo} w-64`}
                            onChange={e => mudar({ codigo: e.target.value, sub: '' })}>
                            <option value="">— escolha —</option>
                            {doDestino.map(c => (
                              <option key={c.codigo} value={c.codigo}>
                                {c.codigo} · {c.descricao}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px] text-graf-400">
                          <span className="mb-1 block">
                            Sub-falha
                            {b.codigo && subs.length === 0 &&
                              <span className="ml-1 text-graf-400">(nenhuma)</span>}
                          </span>
                          <select value={b.sub} disabled={!subs.length}
                            onChange={e => mudar({ sub: e.target.value })}
                            className={`${campo} w-56`}>
                            <option value="">— sem sub-falha —</option>
                            {subs.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
                          </select>
                        </label>
                        <label className="min-w-48 flex-1 text-[11px] text-graf-400">
                          <span className="mb-1 block">Observação</span>
                          <input value={b.obs} onChange={e => mudar({ obs: e.target.value })}
                            className={`${campo} w-full`} />
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-graf-800 pt-3">
                {faltam > 0 && (
                  <p className="text-[11px] text-amber-300">
                    Faltam {faltam} O.S. sem código de {rotuloFinal.toLowerCase()}.
                  </p>
                )}
                <button disabled={ocupado || faltam > 0}
                  onClick={() => comAviso(() => supabase.rpc('baixar_visita', {
                    p_visita: id,
                    p_itens: ordenadas.map(o => ({
                      os_id: o.id,
                      codigo: Number(baixas[o.id].codigo),
                      sub_falha_id: baixas[o.id].sub || null,
                      observacao: baixas[o.id].obs || null,
                    })),
                    p_situacao: destinoReal,
                  }), `Baixa registrada: ${preenchidas} O.S., contrato ${rotuloFinal.toLowerCase()}.`)}
                  className="ml-auto rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium
                             text-white hover:bg-af-500 disabled:opacity-50">
                  Baixar {ordenadas.length} O.S. como {rotuloFinal.toLowerCase()}
                </button>
              </div>
              </>)}
            </div>
            )
          })()}

          {/* ┌─ a chave da rota deste contrato (066) ──────────────────┐
              │ > "quando eu quiser mandar para outro técnico, o contrato │
              │ >  não deve retornar quando importado de novo" — Emanuel  │
              │                                                           │
              │ Transferir já fixa sozinho. A chave existe para os dois   │
              │ outros casos: soltar de volta ao roteamento automático, e │
              │ segurar um contrato onde ele está SEM transferir.         │
              └───────────────────────────────────────────────────────────┘ */}
          {v && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border
                            border-graf-700 bg-graf-900 px-3 py-2.5">
              <button
                role="switch" aria-checked={!v.rota_fixada_em}
                disabled={ocupado}
                onClick={() => comAviso(() => supabase.rpc('fixar_rota_da_visita', {
                  p_visita: id, p_fixar: !v.rota_fixada_em, p_motivo: null,
                }), v.rota_fixada_em
                  ? 'Roteamento do TOA religado neste contrato.'
                  : 'Rota fixada: a importação não mexe mais na equipe deste contrato.')}
                className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition
                            disabled:opacity-40 ${
                  v.rota_fixada_em ? 'bg-graf-700' : 'bg-emerald-600'}`}>
                <span className={`ml-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  v.rota_fixada_em ? 'translate-x-0' : 'translate-x-4'}`} />
              </button>
              <div className="min-w-0 flex-1 text-[11px] leading-snug">
                {v.rota_fixada_em ? (
                  <>
                    <strong className="text-amber-300">Rota fixada.</strong>{' '}
                    <span className="text-graf-400">
                      A importação do TOA <strong>não</strong> mexe na equipe nem no técnico
                      deste contrato. Situação, janela, endereço e O.S. continuam
                      espelhando o relatório normalmente.
                      {v.rota_fixada_motivo && <> Motivo: {v.rota_fixada_motivo}.</>}
                    </span>
                  </>
                ) : (
                  <>
                    <strong className="text-emerald-400">Roteamento do TOA ligado.</strong>{' '}
                    <span className="text-graf-400">
                      A cada importação a equipe deste contrato volta a ser a do login do
                      técnico no relatório. Desligue para segurá-lo onde está.
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {acao === 'transferir' && v && (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-2 text-xs font-medium">
                Transferir contrato
                <span className="ml-2 font-normal text-graf-500">
                  de {v.equipe ? equipeRotulo(v.equipe.codigo, v.equipe.nome) : 'sem equipe'} — fica no histórico
                </span>
              </p>
              <div className="flex flex-wrap items-end gap-2">
                {/* 236 (D-345): "transferir um contrato de um dia para outro"
                    (Emanuel, 09/11). Troca a equipe, o dia, ou os dois. */}
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Dia</span>
                  <input type="date" value={diaT || v.data_agendada}
                    onChange={e => setDiaT(e.target.value)} className={`${campo} w-40`} />
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Equipe destino</span>
                  <select value={destino} onChange={e => setDestino(e.target.value)}
                    className={`${campo} w-56`}>
                    <option value="">— a mesma —</option>
                    {equipes.filter(e => e.codigo !== v.equipe?.codigo).map(e => (
                      <option key={e.id} value={e.id}>{equipeRotulo(e.codigo, e.nome)}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                  <span className="mb-1 block">Motivo</span>
                  <input value={motivoT} onChange={e => setMotivoT(e.target.value)}
                    placeholder="Por que está transferindo?" className={`${campo} w-full`} />
                </label>
                <button disabled={ocupado || (!destino && (!diaT || diaT === v.data_agendada))}
                  onClick={() => {
                    const outroDia = !!diaT && diaT !== v.data_agendada
                    comAviso(() => supabase.rpc('transferir_visita', {
                      p_visita: id, p_equipe: destino || null, p_motivo: motivoT || null,
                      ...(outroDia ? { p_data: diaT } : {}),
                    }), outroDia
                      ? `Contrato levado para ${new Date(diaT + 'T12:00').toLocaleDateString('pt-BR')}.`
                      : 'Contrato transferido.')
                    setDiaT('')
                  }}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Transferir
                </button>
              </div>
            </div>
          )}

          {acao === 'editar_cliente' && v && (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-2 text-xs font-medium">
                Editar cliente/endereço
                <span className="ml-2 font-normal text-graf-500">
                  a diferença fica no histórico.
                  {v.origem === 'TOA' && ' A próxima importação do TOA pode sobrescrever'
                    + ' estes campos enquanto o contrato não estiver bloqueado (D-006).'}
                </span>
              </p>
              <div className="grid gap-2 sm:grid-cols-4">
                {([
                  ['cliente_nome', 'Nome do cliente'],
                  ['logradouro', 'Endereço'], ['complemento', 'Complemento'],
                  ['bairro', 'Bairro'], ['cep', 'CEP'],
                  ['cidade', 'Cidade'], ['uf', 'UF'], ['node', 'Node'],
                ] as const).map(([k, rot]) => (
                  <label key={k} className="text-[11px] text-graf-400">
                    <span className="mb-1 block">{rot}</span>
                    <input value={ed[k] ?? ''} className={`${campo} w-full`}
                      onChange={e => setEd({ ...ed, [k]: e.target.value })} />
                  </label>
                ))}
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Tipo de pessoa</span>
                  <select value={ed.tipo_pessoa ?? ''} className={`${campo} w-full`}
                    onChange={e => setEd({ ...ed, tipo_pessoa: e.target.value })}>
                    <option value="">—</option>
                    <option value="FISICA">Física</option>
                    <option value="JURIDICA">Jurídica</option>
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  {/* Edificação manda na pontuação (D-045) — por isso é
                      editável aqui, e não só lida do complemento. */}
                  <span className="mb-1 block">Edificação</span>
                  <select value={ed.tipo_residencia ?? ''} className={`${campo} w-full`}
                    onChange={e => setEd({ ...ed, tipo_residencia: e.target.value })}>
                    <option value="">—</option>
                    <option value="CASA">Casa</option>
                    <option value="APTO">Apartamento</option>
                    <option value="BECO">Beco</option>
                    <option value="LOJA">Loja</option>
                    <option value="OUTRO">Outro</option>
                  </select>
                </label>

                {/* Telefones em lista: cada um se corrige na própria linha ou
                    sai pela lixeira. São os do TOA (`visita.telefones`); o
                    melhor contato do técnico mora em `contato_cliente`. */}
                <div className="sm:col-span-4">
                  <span className="mb-1 block text-[11px] text-graf-400">Telefones</span>
                  {tels.length === 0 && (
                    <p className="mb-1 text-[11px] text-graf-400">nenhum telefone</p>
                  )}
                  <ul className="space-y-1">
                    {tels.map((t, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <input value={t} aria-label={`Telefone ${i + 1}`}
                          onChange={e => setTels(tels.map((x, j) => j === i ? e.target.value : x))}
                          className={`${campo} tabular w-52`} />
                        <button type="button" onClick={() => setTels(tels.filter((_, j) => j !== i))}
                          title="Remover este telefone" aria-label={`Remover o telefone ${t}`}
                          className="rounded-md border border-graf-700 p-1.5 text-graf-400
                                     hover:border-af-600 hover:text-af-400">
                          <Lixeira />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input value={novoTel} onChange={e => setNovoTel(e.target.value)}
                      aria-label="Novo telefone" placeholder="novo telefone"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && novoTel.trim()) {
                          setTels([...tels, novoTel.trim()]); setNovoTel('')
                        }
                      }}
                      className={`${campo} tabular w-52`} />
                    <button type="button" disabled={!novoTel.trim()}
                      onClick={() => { setTels([...tels, novoTel.trim()]); setNovoTel('') }}
                      className="rounded-md border border-graf-700 px-2.5 py-1.5 text-xs text-graf-300
                                 hover:border-af-600 hover:text-af-400 disabled:opacity-40">
                      + Adicionar
                    </button>
                  </div>
                </div>
              </div>
              <button disabled={ocupado}
                onClick={() => comAviso(() => supabase.rpc('atualizar_visita_manual', {
                  p_visita: id,
                  p_dados: {
                    ...ed,
                    ...(telsMudaram() ? { telefones: telsLimpos() } : {}),
                  },
                }).then(r => { if (!r.error) setNovoTel(''); return r }), 'Cliente e endereço atualizados.')}
                className="mt-3 rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-50">
                Salvar cliente/endereço
              </button>
            </div>
          )}

          {acao === 'editar_servico' && v && (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-2 text-xs font-medium">
                Editar serviço
                <span className="ml-2 font-normal text-graf-500">
                  a diferença fica no histórico.
                  {v.origem === 'TOA' && ' A próxima importação do TOA pode sobrescrever'
                    + ' estes campos enquanto o contrato não estiver bloqueado (D-006).'}
                </span>
              </p>
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Data agendada</span>
                  <input type="date" value={ed.data_agendada ?? ''} className={`${campo} w-full`}
                    onChange={e => setEd({ ...ed, data_agendada: e.target.value })} />
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Janela início</span>
                  <input type="time" value={ed.janela_inicio ?? ''} className={`${campo} w-full`}
                    onChange={e => setEd({ ...ed, janela_inicio: e.target.value })} />
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Janela fim</span>
                  <input type="time" value={ed.janela_fim ?? ''} className={`${campo} w-full`}
                    onChange={e => setEd({ ...ed, janela_fim: e.target.value })} />
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Grupo de serviço</span>
                  <select value={ed.tipo_servico_id ?? ''} className={`${campo} w-full`}
                    onChange={e => setEd({ ...ed, tipo_servico_id: e.target.value })}>
                    {/* Sem grupo hoje: a opção vazia não APAGA nada (a RPC
                        mantém o que está gravado quando vem vazio). */}
                    {!v.tipo_servico_id && <option value="">—</option>}
                    {/* O grupo gravado continua na lista mesmo se foi desligado. */}
                    {v.tipo_servico_id && !grupos.some(g => g.id === v.tipo_servico_id) && (
                      <option value={v.tipo_servico_id}>{v.tipo_servico?.nome ?? 'atual'}</option>
                    )}
                    {grupos.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
                  </select>
                </label>
                {([['contrato', 'Contrato'], ['wo_numero', 'WO']] as const).map(([k, rot]) => (
                  <label key={k} className="text-[11px] text-graf-400">
                    <span className="mb-1 block">{rot}</span>
                    <input value={ed[k] ?? ''} className={`${campo} w-full`}
                      onChange={e => setEd({ ...ed, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <button disabled={ocupado}
                onClick={() => comAviso(() => supabase.rpc('atualizar_visita_manual', {
                  p_visita: id, p_dados: ed,
                }), 'Serviço atualizado.')}
                className="mt-3 rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-50">
                Salvar serviço
              </button>
            </div>
          )}

          {acao === 'nova_os' && v && (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-2 text-xs font-medium">
                Acrescentar O.S.
                <span className="ml-2 font-normal text-graf-500">
                  deixe o número em branco e o sistema gera um (AF-00000001)
                </span>
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Tipo de O.S.</span>
                  <select value={novaTipo} onChange={e => {
                      setNovaTipo(e.target.value)
                      const t = tiposOS.find(x => x.id === e.target.value)
                      if (t) setNovaDescricao(t.descricao)
                    }} className={`${campo} w-72`}>
                    <option value="">— escolha —</option>
                    {tiposOS.map(t => (
                      <option key={t.id} value={t.id}>{t.codigo} · {t.descricao}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Número da O.S. (opcional)</span>
                  <input value={novaNumero} onChange={e => setNovaNumero(e.target.value)}
                    placeholder="gerado pelo sistema" className={`${campo} w-48`} />
                </label>
                <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                  <span className="mb-1 block">Descrição</span>
                  <input value={novaDescricao} onChange={e => setNovaDescricao(e.target.value)}
                    placeholder="ADESAO - INSTALAR PONTO VIRTUA"
                    className={`${campo} w-full`} />
                </label>
                <button disabled={ocupado || (!novaTipo && !novaDescricao.trim())}
                  onClick={() => comAviso(() => supabase.rpc('adicionar_os', {
                    p_visita: id,
                    p_dados: {
                      tipo_os_id: novaTipo || null,
                      numero_os: novaNumero.trim() || null,
                      descricao: novaDescricao.trim() || null,
                    },
                  }).then(r => { if (!r.error) { setNovaTipo(''); setNovaNumero(''); setNovaDescricao('') } return r }),
                    'O.S. acrescentada.')}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Acrescentar
                </button>
              </div>
            </div>
          )}

          {/* ┌─ Mudar status (o antigo "Voltar") ────────────────────────┐
              │ > "deve aparecer a opção mudar status, para o controlador │
              │ >  devolver para o status que ele achar melhor" — Emanuel │
              │                                                           │
              │ Uma porta na tela, três no banco — quem decide é ele:     │
              │  · concluir/cancelar/reagendar é BAIXA: exige código de   │
              │    todas as O.S., do destino certo (098). Vai para lá.    │
              │  · encerrado voltando: `reverter_situacao`, com motivo    │
              │    obrigatório (D-030).                                   │
              │  · aberto para aberto: `registrar_etapa`, observação      │
              │    opcional — e ela vira aviso no celular do técnico.     │
              └───────────────────────────────────────────────────────────┘ */}
          {acao === 'status' && v && (() => {
            const encerrado = !EM_ABERTO.includes(v.situacao)
            const alvoTerminal = (TERMINAIS as readonly string[]).includes(situacaoAlvo)
            const rotulo = (s: string) => SITUACAO_INFO[s as Situacao]?.label ?? s
            return (
            <div className="rounded-lg border border-amber-700/60 bg-amber-900/15 p-3">
              <p className="text-xs font-medium text-amber-200">Mudar status</p>
              <p className="mt-1 text-[11px] text-amber-200/80">
                Está hoje em <strong>{rotulo(v.situacao)}</strong>. O sistema da CLARO não volta
                status; o nosso volta — e registra quem mudou, quando e por quê.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Novo status</span>
                  <select value={situacaoAlvo} className={`${campo} w-48`}
                    onChange={e => setSituacaoAlvo(e.target.value as Situacao)}>
                    <option value="">— escolha —</option>
                    {SITUACOES.filter(s => s !== v.situacao).map(s => (
                      <option key={s} value={s}>{rotulo(s)}</option>
                    ))}
                  </select>
                </label>

                {alvoTerminal ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <p className="text-[11px] text-amber-200/90">
                      {rotulo(situacaoAlvo)} é baixa: pede o código de cada O.S.
                    </p>
                    <button disabled={!v.ordem_servico.length}
                      onClick={() => {
                        setSituacaoFinal(situacaoAlvo)
                        setBaixas(a => Object.fromEntries(Object.entries(a).map(([k, b]) => [k,
                          codigos.find(c => String(c.codigo) === b.codigo)?.situacao_destino === situacaoAlvo
                            ? b : { ...b, codigo: '', sub: '' }])))
                        setAcao('baixar')
                      }}
                      className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                                 hover:bg-af-500 disabled:opacity-50">
                      Ir para a baixa
                    </button>
                  </div>
                ) : (<>
                  <label className="min-w-64 flex-1 text-[11px] text-graf-400">
                    <span className="mb-1 block">
                      {encerrado ? 'Motivo (obrigatório)' : 'Observação para o técnico (opcional)'}
                    </span>
                    <input value={motivoV} onChange={e => setMotivoV(e.target.value)}
                      placeholder={encerrado
                        ? 'Baixa indevida, técnico marcou errado, reabertura…'
                        : 'Vai como aviso no celular do técnico'}
                      className={`${campo} w-full`} />
                  </label>
                  <button disabled={ocupado || !situacaoAlvo || (encerrado && !motivoV.trim())}
                    onClick={() => comAviso(() => encerrado
                      ? supabase.rpc('reverter_situacao', {
                          p_visita: id, p_situacao: situacaoAlvo, p_motivo: motivoV.trim(),
                        })
                      : supabase.rpc('registrar_etapa', {
                          p_visita: id, p_situacao: situacaoAlvo,
                          p_observacao: motivoV.trim() || null, p_lat: null, p_lng: null,
                        }), `Status mudado para ${rotulo(situacaoAlvo)}.`)}
                    className="rounded-md bg-amber-600 px-4 py-1.5 text-xs font-medium text-white
                               hover:bg-amber-500 disabled:opacity-50">
                    Mudar status
                  </button>
                </>)}
              </div>
            </div>
            )
          })()}

          {/* Exclusao DEFINITIVA (D-101): aqui e no lote, a mesma coisa.
              Duas travas -- motivo e a palavra APAGAR -- porque nao ha
              como desfazer, e o registro de quem apagou fica em
              `exclusao_definitiva`. */}
          {acao === 'excluir' && (
            <div className="rounded-lg border border-af-700/60 bg-af-900/15 p-3">
              <p className="text-xs font-medium text-af-200">
                Apagar este contrato do banco?
              </p>
              <p className="mt-1 text-[11px] text-af-200/80">
                <strong>Não se desfaz.</strong> Somem o contrato, as O.S., o histórico e
                as fotos. Fica registrado quem apagou, quando e por quê — para o dia em
                que alguém precisar investigar.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                  <span className="mb-1 block">Motivo (obrigatório)</span>
                  <input value={motivoE} onChange={e => setMotivoE(e.target.value)} autoFocus
                    placeholder="Duplicado, aberto por engano, cancelado pela CLARO…"
                    className={`${campo} w-full`} />
                </label>
                <label className="w-40 text-[11px] text-graf-400">
                  <span className="mb-1 block">Digite APAGAR</span>
                  <input value={confirmaE} onChange={e => setConfirmaE(e.target.value)}
                    placeholder="APAGAR" className={`${campo} w-full`} />
                </label>
                <button
                  disabled={ocupado || !motivoE.trim()
                            || confirmaE.trim().toUpperCase() !== 'APAGAR'}
                  onClick={async () => {
                    setOcupado(true); setErro(null)
                    const { error } = await supabase.rpc('excluir_visitas_definitivo',
                      { p_visitas: [id], p_motivo: motivoE.trim() })
                    if (error) { setErro(error.message); setOcupado(false); return }
                    onMudou(); onFechar()
                  }}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Apagar do banco
                </button>
              </div>
            </div>
          )}

          {/* 155: na página cheia este bloco é o que duplicava a tela de
              baixo. Só Marcadores sobrevive, e só quando pedido. */}
          {!pagina && (!v ? (
            <p className="py-10 text-center text-sm text-graf-400">Carregando contrato…</p>
          ) : aba === 'detalhe' ? (
            <>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-500">
                  Cliente e endereço
                </h3>
                <div className="grid gap-3 rounded-lg bg-graf-900 p-3 sm:grid-cols-4">
                  <Dado r="Nome" v={v.cliente_nome} largo />
                  <Dado r="Tipo de pessoa" v={v.tipo_pessoa} />
                  <Dado r="Edificação" v={v.tipo_residencia} />
                  <Dado r="Endereço" v={endereco} largo />
                  <Dado r="Telefones" v={v.telefones?.join(' · ')} />
                  <Dado r="CEP" v={v.cep} />
                  {/* 096: a resposta do técnico ao concluir. Três estados,
                      e nenhum deles é "—" calado: informou, disse NÃO, ou
                      nunca foi perguntado (concluído fora do app). */}
                  <Dado r="Melhor contato (técnico)" largo v={
                    v.contato_cliente
                      ? v.contato_cliente.telefone
                        ? <span title={`Informado por ${v.contato_cliente.login ?? '—'} em ${new Date(v.contato_cliente.atualizado_em).toLocaleString('pt-BR')}`}
                            className="font-semibold text-emerald-300">
                            {mascaraTelefone(v.contato_cliente.telefone)}
                            <span className="ml-1.5 text-[11px] font-normal text-graf-400">
                              {v.contato_cliente.login}
                            </span>
                          </span>
                        : <span className="text-amber-300"
                            title={`${v.contato_cliente.login ?? 'O técnico'} respondeu NÃO`}>
                            técnico respondeu NÃO
                          </span>
                      : v.situacao === 'CONCLUIDA'
                        ? <span className="text-graf-400">não perguntado (concluído fora do app)</span>
                        : null} />
                  <Dado r="Local da baixa" largo v={
                    local ? <SeloLocal local={local} />
                      : v.ordem_servico.some(o => o.baixa_afline)
                        ? <span className="text-graf-400">baixa sem GPS (dada pela web)</span>
                        : null} />
                </div>
                {(!v.cliente_nome || !v.tipo_pessoa) && (
                  <p className="mt-1.5 text-[11px] text-graf-400">
                    {!v.cliente_nome
                      ? 'O nome vem da varredura do TOA (Sincronismo); em branco = ainda não varrido. '
                      : ''}
                    Campo vazio que deveria ter valor fica visível de propósito: é informação.
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-500">
                  Atendimento
                </h3>
                <div className="grid gap-3 rounded-lg bg-graf-900 p-3 sm:grid-cols-4">
                  <Dado r="Equipe" v={v.equipe ? equipeRotulo(v.equipe.codigo, v.equipe.nome) : null} />
                  <Dado r="Supervisor" v={v.equipe?.supervisor_nome} />
                  <Dado r="Técnico" v={v.tecnico ? `${v.tecnico.nome} (${v.tecnico.matricula})` : null} />
                  <Dado r="Área" v={v.area?.apelido ?? v.area?.codigo} />
                  <Dado r="Tipo de atividade (TOA)" v={v.tipo_atividade?.nome} />
                  <Dado r="Grupo de serviço" v={v.tipo_servico?.nome} />
                  <Dado r="WO" v={v.wo_numero} />
                  <Dado r="Atividade TOA" v={v.toa_atividade_id} />
                  <Dado r="Node" v={v.node} />
                  <Dado r="Origem" v={v.origem} />
                  <Dado r="Início" v={quando(v.inicio)} />
                  <Dado r="Fim" v={quando(v.fim)} />
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-500">
                  {v.ordem_servico.length} ordem(ns) de serviço
                </h3>
                {v.ordem_servico.length === 0 ? (
                  <p className="rounded-lg bg-graf-900 p-3 text-xs text-graf-500">
                    Sem O.S. — apontamento de jornada.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
                      <div key={o.id} className="rounded-lg bg-graf-900 p-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="tabular text-graf-600">#{o.sequencia}</span>
                          <span className="tabular font-medium">{o.numero_os ?? '—'}</span>
                          {/* A descrição é o que a operação lê; o código é
                              para conferência. O sistema atual mostra as duas. */}
                          <span className="text-graf-300">
                            {o.descricao ?? o.tipo_os?.descricao ?? '—'}
                          </span>
                          {o.tipo_os && (
                            <span className="tabular text-[11px] text-graf-500">
                              tipo {o.tipo_os.codigo}
                            </span>
                          )}
                          {o.origem === 'MANUAL' && (
                            <span className="rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px]
                                             font-semibold uppercase text-sky-300">
                              manual
                            </span>
                          )}
                          {o.status_operadora && (
                            <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[11px] text-graf-400">
                              {o.status_operadora.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-graf-500">
                              Baixa da operadora (TOA)
                            </div>
                            {o.codigo_baixa ? (
                              <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs
                                                font-medium ring-1 ${corBaixa(o.codigo_baixa.natureza)}`}>
                                {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                              </span>
                            ) : <div className="mt-1 text-xs text-graf-600">sem baixa</div>}
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-graf-500">
                              Baixa da AFLINE (ngestor)
                            </div>
                            {o.baixa_afline ? (
                              <div className="mt-1">
                                <span className={`inline-block rounded px-2 py-0.5 text-xs
                                                  font-medium ring-1 ${corBaixa(o.baixa_afline.natureza)}`}>
                                  {o.baixa_afline.codigo} · {o.baixa_afline.descricao}
                                </span>
                                {o.sub_falha && (
                                  <div className="mt-1 text-[11px] text-graf-400">
                                    Sub-falha: <span className="text-graf-200">{o.sub_falha.nome}</span>
                                  </div>
                                )}
                                {o.baixa_observacao && (
                                  <div className="mt-0.5 text-[11px] text-graf-500">
                                    {o.baixa_observacao}
                                  </div>
                                )}
                              </div>
                            ) : <div className="mt-1 text-xs text-graf-600">ainda não baixada</div>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : aba === 'equipamento' ? (
            /* 117 na aba dele (133): a lista de peças não disputa mais
               espaço com os dados do contrato. */
            <EquipamentoToa itens={itensToa} varridoEm={v.toa_varrido_em} tipo="EQUIPAMENTO" />
          ) : aba === 'miscelanea' ? (
            <EquipamentoToa itens={itensToa} varridoEm={v.toa_varrido_em} tipo="MISCELANEA" />
          ) : aba === 'historico' ? (
            v.visita_evento.length === 0 ? (
              <p className="text-sm text-graf-500">Sem histórico registrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-graf-800 text-left uppercase
                                    tracking-wide text-graf-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">Quando</th>
                      <th className="px-2 py-2 font-medium">Etapa</th>
                      <th className="px-2 py-2 font-medium">Situação</th>
                      <th className="px-2 py-2 font-medium">Baixa</th>
                      <th className="px-2 py-2 font-medium">Sub-falha</th>
                      <th className="px-2 py-2 font-medium">Equipe</th>
                      <th className="px-2 py-2 font-medium">Quem</th>
                      <th className="px-2 py-2 font-medium">Login</th>
                      <th className="px-2 py-2 font-medium">Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...v.visita_evento]
                      .sort((a, b) => b.criado_em.localeCompare(a.criado_em)).map(e => (
                      <tr key={e.id} className="border-b border-graf-800/60 align-top">
                        <td className="tabular whitespace-nowrap px-2 py-1.5 text-graf-400">
                          {quando(e.criado_em)}
                        </td>
                        <td className="px-2 py-1.5 font-medium">
                          {rotuloEvento(e.tipo)}
                        </td>
                        <td className="px-2 py-1.5 text-graf-300">{transicaoEvento(e) ?? '—'}</td>
                        <td className="px-2 py-1.5 text-graf-300">
                          {e.codigo_baixa
                            ? `${e.codigo_baixa.codigo} · ${e.codigo_baixa.descricao}` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-graf-300">{e.sub_falha?.nome ?? '—'}</td>
                        <td className="px-2 py-1.5 text-graf-400">
                          {e.equipe ? equipeRotulo(e.equipe.codigo) : '—'}</td>
                        <td className="px-2 py-1.5 text-graf-400">
                          {/* D-252: da importação, quem afirma é a Operadora (o TOA) */}
                          {e.origem === 'IMPORTACAO'
                            ? <span title={e.usuario?.nome ? `Importado por ${e.usuario.nome}` : undefined}>Operadora</span>
                            : e.usuario?.nome ?? <span className="text-graf-600">sistema</span>}
                        </td>
                        {/* O login é o do TOA quando o evento veio da planilha,
                            e o e-mail de quem operou quando veio da tela. */}
                        <td className="px-2 py-1.5 text-graf-400">{e.login ?? '—'}</td>
                        <td className="px-2 py-1.5 text-graf-400">{e.observacao ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <section>
              <p className="mb-2 text-xs text-graf-400">
                Indicadores de qualidade — clique para aplicar ou tirar deste contrato.
              </p>
              {indicadores.length === 0 ? (
                <p className="text-xs text-graf-500">
                  Nenhum indicador cadastrado. Cadastre em Configurações.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {indicadores.map(i => {
                    const on = marcados.some(m => m.indicador_id === i.id)
                    return (
                      <button key={i.id} disabled={ocupado}
                        onClick={() => alternarMarcador(i.id)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium ring-1
                                    transition disabled:opacity-50 ${
                          on ? 'bg-sky-900/40 text-sky-300 ring-sky-700/50'
                             : 'bg-graf-900 text-graf-400 ring-graf-700 hover:text-graf-200'}`}>
                        {on && <span className="mr-1">✓</span>}{i.nome}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
  )

  // 155: a mesma árvore, com ou sem a sobreposição por cima.
  if (pagina) return corpo
  return (
    <div onClick={onFechar}
      className="janela-fundo fixed inset-0 z-50 flex items-start justify-center
                 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      {corpo}
    </div>
  )
}
