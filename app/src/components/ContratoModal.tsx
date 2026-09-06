import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACOES, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { Alerta, Pill } from './ui'
import { rotuloEvento, transicaoEvento } from '../lib/eventos'

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
  login: string | null
  de: Record<string, unknown> | null; para: Record<string, unknown> | null
  usuario: { nome: string } | null
  equipe: { codigo: string } | null
  codigo_baixa: { codigo: number; descricao: string } | null
  sub_falha: { nome: string } | null
}
interface Visita {
  id: string; contrato: string | null; wo_numero: string | null
  toa_atividade_id: string | null; cliente_nome: string | null
  tipo_pessoa: string | null; tipo_residencia: string | null; telefones: string[] | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null
  node: string | null; lat: number | null; lng: number | null
  data_agendada: string; janela_inicio: string | null; janela_fim: string | null
  situacao: Situacao; inicio: string | null; fim: string | null
  bloqueado_em: string | null; origem: string | null
  tipo_atividade: { nome: string } | null
  tipo_servico: { nome: string } | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { id: string; codigo: string; nome: string; supervisor_nome: string | null } | null
  tecnico: { nome: string; matricula: string } | null
  ordem_servico: OS[]
  visita_marcador: { id: string; indicador_id: string }[]
  visita_evento: Evento[]
}

const SELECT = `
  id, contrato, wo_numero, toa_atividade_id, cliente_nome,
  tipo_pessoa, tipo_residencia, telefones,
  logradouro, complemento, bairro, cidade, uf, cep, node, lat, lng,
  data_agendada, janela_inicio, janela_fim, situacao, inicio, fim,
  bloqueado_em, origem,
  tipo_atividade:tipo_atividade_id ( nome ),
  tipo_servico:tipo_servico_id ( nome ),
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
    id, tipo, criado_em, observacao, login, de, para,
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

export function ContratoModal({
  id, indicadores, codigos, conjunto, equipes, pontos, onFechar, onMudou,
}: {
  id: string
  indicadores: { id: string; nome: string }[]
  codigos: { codigo: number; descricao: string }[]
  conjunto: string | null
  equipes: { id: string; codigo: string; nome: string }[]
  pontos?: { pontos_claro: number | null; edificacao: string; edificacao_de: string } | null
  onFechar: () => void
  onMudou: () => void
}) {
  const [v, setV] = useState<Visita | null>(null)
  const [aba, setAba] = useState<'detalhe' | 'historico' | 'marcadores'>('detalhe')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [acao, setAcao] = useState<
    'baixar' | 'transferir' | 'excluir' | 'editar' | 'voltar' | 'nova_os' | null>(null)

  // baixa
  const [osAlvo, setOsAlvo] = useState('')
  const [codigoSel, setCodigoSel] = useState('')
  const [subFalhas, setSubFalhas] = useState<{ id: string; nome: string }[]>([])
  const [subSel, setSubSel] = useState('')
  const [obs, setObs] = useState('')
  // transferência
  const [destino, setDestino] = useState('')
  const [motivoT, setMotivoT] = useState('')
  // exclusão
  const [motivoE, setMotivoE] = useState('')
  // edição do cadastro — o que o sistema atual não deixa fazer
  const [ed, setEd] = useState<Record<string, string>>({})
  // voltar contrato
  const [situacaoAlvo, setSituacaoAlvo] = useState<Situacao | ''>('')
  const [motivoV, setMotivoV] = useState('')
  // nova O.S. no contrato existente
  const [tiposOS, setTiposOS] = useState<{ id: string; codigo: number; descricao: string }[]>([])
  const [novaTipo, setNovaTipo] = useState('')
  const [novaNumero, setNovaNumero] = useState('')
  const [novaDescricao, setNovaDescricao] = useState('')

  async function carregar() {
    const { data, error } = await supabase.from('visita').select(SELECT).eq('id', id).single()
    if (error) setErro(error.message)
    else {
      const d = data as unknown as Visita
      setV(d)
      setOsAlvo(d.ordem_servico[0]?.id ?? '')
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

  /** Abre a edição já preenchida com o que está gravado. */
  function abrirEdicao() {
    if (!v) return
    setEd({
      contrato: v.contrato ?? '', wo_numero: v.wo_numero ?? '',
      cliente_nome: v.cliente_nome ?? '', tipo_pessoa: v.tipo_pessoa ?? '',
      tipo_residencia: v.tipo_residencia ?? '',
      telefones: (v.telefones ?? []).join(', '),
      logradouro: v.logradouro ?? '', complemento: v.complemento ?? '',
      bairro: v.bairro ?? '', cidade: v.cidade ?? '', uf: v.uf ?? '',
      cep: v.cep ?? '', node: v.node ?? '',
      data_agendada: v.data_agendada,
      janela_inicio: hhmm(v.janela_inicio) ?? '', janela_fim: hhmm(v.janela_fim) ?? '',
    })
    setAcao(acao === 'editar' ? null : 'editar')
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  useEffect(() => {
    setSubSel('')
    if (!codigoSel) { setSubFalhas([]); return }
    let q = supabase.from('sub_falha').select('id, nome').eq('codigo', Number(codigoSel))
    if (conjunto) q = q.eq('conjunto', conjunto)
    q.order('ordem').then(({ data }) =>
      setSubFalhas((data ?? []) as { id: string; nome: string }[]))
  }, [codigoSel, conjunto])

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

  return (
    <div onClick={onFechar}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto
                 bg-black/70 p-4 backdrop-blur-sm">
      <div onClick={e => e.stopPropagation()}
        style={{ borderTopColor: cor }}
        className="sup-controle mt-6 w-full max-w-5xl rounded-xl border border-graf-700
                   border-t-4 bg-graf-950 shadow-2xl">

        {/* ---------- cabeçalho ---------- */}
        <div className="flex flex-wrap items-center gap-3 border-b border-graf-800 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {v && <Pill situacao={v.situacao} />}
              <h2 className="truncate text-lg font-semibold">
                Contrato {v?.contrato ?? '—'}
              </h2>
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
                ★ {Number(pontos.pontos_claro).toFixed(4)} pts
              </span>
            )}
            <button onClick={abrirEdicao} disabled={!v}
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              Editar
            </button>
            <button onClick={() => setAcao(acao === 'nova_os' ? null : 'nova_os')}
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400">
              + O.S.
            </button>
            <button onClick={() => setAcao(acao === 'voltar' ? null : 'voltar')}
              title="Voltar a situação do contrato — o sistema da CLARO não faz isso"
              className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400">
              Voltar
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
          </div>
        </div>

        {/* ---------- abas ---------- */}
        <div className="flex gap-1 border-b border-graf-800 px-5 pt-2">
          {([['detalhe', 'Detalhe'],
             ['historico', `Histórico (${v?.visita_evento.length ?? 0})`],
             ['marcadores', `Marcadores (${marcados.length})`]] as const).map(([a, rot]) => (
            <button key={a} onClick={() => setAba(a)}
              className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition ${
                aba === a ? 'bg-graf-900 text-af-300' : 'text-graf-400 hover:text-graf-200'}`}>
              {rot}
            </button>
          ))}
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {ok && <Alerta tipo="ok">{ok}</Alerta>}

          {/* ---------- ações ---------- */}
          {acao === 'baixar' && v && (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-2 text-xs font-medium">
                Baixar serviço
                <span className="ml-2 font-normal text-graf-500">
                  esta é a baixa da AFLINE — a da operadora vem do TOA e não se edita
                </span>
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Ordem de serviço</span>
                  <select value={osAlvo} onChange={e => setOsAlvo(e.target.value)}
                    className={`${campo} w-64`}>
                    {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
                      <option key={o.id} value={o.id}>
                        #{o.sequencia} · {o.numero_os} · {o.tipo_os?.descricao ?? '—'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Código de baixa AFLINE</span>
                  <select value={codigoSel} onChange={e => setCodigoSel(e.target.value)}
                    className={`${campo} w-72`}>
                    <option value="">— escolha —</option>
                    {codigos.map(c => (
                      <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">
                    Sub-falha
                    {codigoSel && subFalhas.length === 0 &&
                      <span className="ml-1 text-graf-600">(nenhuma para este código)</span>}
                  </span>
                  <select value={subSel} onChange={e => setSubSel(e.target.value)}
                    disabled={!subFalhas.length} className={`${campo} w-72`}>
                    <option value="">— sem sub-falha —</option>
                    {subFalhas.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                  </select>
                </label>
                <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                  <span className="mb-1 block">Observação</span>
                  <input value={obs} onChange={e => setObs(e.target.value)}
                    className={`${campo} w-full`} />
                </label>
                <button disabled={ocupado || !osAlvo || !codigoSel}
                  onClick={() => comAviso(() => supabase.rpc('baixar_os', {
                    p_os: osAlvo, p_codigo: Number(codigoSel),
                    p_sub_falha: subSel || null, p_observacao: obs || null, p_situacao: null,
                  }), 'Baixa registrada.')}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Confirmar baixa
                </button>
              </div>
            </div>
          )}

          {acao === 'transferir' && v && (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-2 text-xs font-medium">
                Transferir contrato
                <span className="ml-2 font-normal text-graf-500">
                  de {v.equipe?.codigo ?? 'sem equipe'} — fica no histórico
                </span>
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Equipe destino</span>
                  <select value={destino} onChange={e => setDestino(e.target.value)}
                    className={`${campo} w-56`}>
                    <option value="">— escolha —</option>
                    {equipes.filter(e => e.codigo !== v.equipe?.codigo).map(e => (
                      <option key={e.id} value={e.id}>{e.codigo} · {e.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-56 flex-1 text-[11px] text-graf-400">
                  <span className="mb-1 block">Motivo</span>
                  <input value={motivoT} onChange={e => setMotivoT(e.target.value)}
                    placeholder="Por que está transferindo?" className={`${campo} w-full`} />
                </label>
                <button disabled={ocupado || !destino}
                  onClick={() => comAviso(() => supabase.rpc('transferir_visita', {
                    p_visita: id, p_equipe: destino, p_motivo: motivoT || null,
                  }), 'Contrato transferido.')}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Transferir
                </button>
              </div>
            </div>
          )}

          {acao === 'editar' && v && (
            <div className="rounded-lg border border-graf-700 bg-graf-900 p-3">
              <p className="mb-2 text-xs font-medium">
                Editar cadastro
                <span className="ml-2 font-normal text-graf-500">
                  cliente, endereço e agendamento — a diferença fica no histórico.
                  {v.origem === 'TOA' && ' A próxima importação do TOA pode sobrescrever'
                    + ' estes campos enquanto o contrato não estiver bloqueado (D-006).'}
                </span>
              </p>
              <div className="grid gap-2 sm:grid-cols-4">
                {([
                  ['contrato', 'Contrato'], ['wo_numero', 'WO'],
                  ['cliente_nome', 'Nome do cliente'], ['telefones', 'Telefones (vírgula)'],
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
                    <option value="COMERCIAL">Comercial</option>
                    <option value="OUTRO">Outro</option>
                  </select>
                </label>
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
              </div>
              <button disabled={ocupado}
                onClick={() => comAviso(() => supabase.rpc('atualizar_visita_manual', {
                  p_visita: id,
                  p_dados: {
                    ...ed,
                    telefones: ed.telefones
                      ? ed.telefones.split(',').map(t => t.trim()).filter(Boolean)
                      : undefined,
                  },
                }), 'Cadastro atualizado.')}
                className="mt-3 rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500 disabled:opacity-50">
                Salvar cadastro
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

          {acao === 'voltar' && v && (
            <div className="rounded-lg border border-amber-700/60 bg-amber-900/15 p-3">
              <p className="text-xs font-medium text-amber-200">Voltar o contrato</p>
              <p className="mt-1 text-[11px] text-amber-200/80">
                O sistema da CLARO não volta situação. O nosso volta — e por isso
                registra quem voltou, quando e por quê. Está hoje em{' '}
                <strong>{SITUACAO_INFO[v.situacao]?.label ?? v.situacao}</strong>.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Voltar para</span>
                  <select value={situacaoAlvo} className={`${campo} w-48`}
                    onChange={e => setSituacaoAlvo(e.target.value as Situacao)}>
                    <option value="">— escolha —</option>
                    {SITUACOES.filter(s => s !== v.situacao).map(s => (
                      <option key={s} value={s}>{SITUACAO_INFO[s]?.label ?? s}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-64 flex-1 text-[11px] text-graf-400">
                  <span className="mb-1 block">Motivo (obrigatório)</span>
                  <input value={motivoV} onChange={e => setMotivoV(e.target.value)}
                    placeholder="Baixa indevida, técnico marcou errado, reabertura…"
                    className={`${campo} w-full`} />
                </label>
                <button disabled={ocupado || !situacaoAlvo || !motivoV.trim()}
                  onClick={() => comAviso(() => supabase.rpc('reverter_situacao', {
                    p_visita: id, p_situacao: situacaoAlvo, p_motivo: motivoV.trim(),
                  }), 'Contrato voltado.')}
                  className="rounded-md bg-amber-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-amber-500 disabled:opacity-50">
                  Voltar contrato
                </button>
              </div>
            </div>
          )}

          {acao === 'excluir' && (
            <div className="rounded-lg border border-af-700/60 bg-af-900/15 p-3">
              <p className="text-xs font-medium text-af-200">Excluir este contrato?</p>
              <p className="mt-1 text-[11px] text-af-200/80">
                Sai das listas e dos relatórios, mas continua no banco com quem excluiu,
                quando e por quê — e pode ser restaurado.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-64 flex-1 text-[11px] text-graf-400">
                  <span className="mb-1 block">Motivo (obrigatório)</span>
                  <input value={motivoE} onChange={e => setMotivoE(e.target.value)} autoFocus
                    placeholder="Duplicado, aberto por engano, cancelado pela CLARO…"
                    className={`${campo} w-full`} />
                </label>
                <button disabled={ocupado || !motivoE.trim()}
                  onClick={async () => {
                    setOcupado(true); setErro(null)
                    const { error } = await supabase.rpc('excluir_visita',
                      { p_visita: id, p_motivo: motivoE.trim() })
                    if (error) { setErro(error.message); setOcupado(false); return }
                    onMudou(); onFechar()
                  }}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Excluir
                </button>
              </div>
            </div>
          )}

          {!v ? (
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
                </div>
                {(!v.cliente_nome || !v.tipo_pessoa) && (
                  <p className="mt-1.5 text-[11px] text-graf-600">
                    Campos em branco vêm do export do ngestor, que ainda não é importado.
                    Ficam visíveis de propósito: campo vazio que deveria ter valor é informação.
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-500">
                  Atendimento
                </h3>
                <div className="grid gap-3 rounded-lg bg-graf-900 p-3 sm:grid-cols-4">
                  <Dado r="Equipe" v={v.equipe ? `${v.equipe.codigo} · ${v.equipe.nome}` : null} />
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
                        <td className="px-2 py-1.5 text-graf-400">{e.equipe?.codigo ?? '—'}</td>
                        <td className="px-2 py-1.5 text-graf-400">
                          {e.usuario?.nome ?? <span className="text-graf-600">sistema</span>}
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
          )}
        </div>
      </div>
    </div>
  )
}
