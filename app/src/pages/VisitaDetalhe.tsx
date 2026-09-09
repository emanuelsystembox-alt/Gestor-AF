import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { rotuloEvento, transicaoEvento } from '../lib/eventos'
import { Alerta, Pill } from '../components/ui'

interface OS {
  id: string; sequencia: number; numero_os: string; ponto: string | null
  status_operadora: string | null; produto: string | null; observacao: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: { codigo: number; descricao: string; familia: string
                  natureza: string; responsabilidade: string | null } | null
}
interface Evento {
  id: number; tipo: string; observacao: string | null; login: string | null
  de: Record<string, unknown> | null; para: Record<string, unknown> | null
  lat: number | null; lng: number | null; origem: string | null; criado_em: string
  equipe: { codigo: string } | null
  usuario: { nome: string } | null
  sub_falha: { nome: string; categoria: string | null } | null
  codigo_baixa: { codigo: number; descricao: string } | null
}
interface Evidencia {
  id: string; tipo: string; arquivo_path: string; tamanho_bytes: number | null
  lat: number | null; lng: number | null; capturada_em: string | null; criado_em: string
  /** FOTO ou VIDEO — decide se a tela renderiza <img> ou player (055). */
  midia: string; mime: string | null; duracao_seg: number | null
  /** Raio de incerteza do GPS. Foto com 2 km de precisão não prova
   *  presença; quem audita precisa ver isso, não só a coordenada. */
  precisao_m: number | null
  observacao: string | null; login: string | null; origem: string | null
  tecnico: { nome: string; matricula: string } | null
}
interface Det {
  id: string; toa_atividade_id: string | null; wo_numero: string | null
  contrato: string | null; cliente_nome: string | null
  tipo_pessoa: string | null; tipo_residencia: string | null
  telefones: string[] | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null
  lat: number | null; lng: number | null; node: string | null
  data_agendada: string; janela_inicio: string | null; janela_fim: string | null
  inicio: string | null; fim: string | null; tempo_deslocamento: string | null
  situacao: Situacao; bloqueado_em: string | null; origem: string
  observacao: string | null; criado_em: string
  tipo_atividade: { nome: string; natureza: string } | null
  tipo_servico: { nome: string } | null
  segmentacao: { nome: string } | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { id: string; codigo: string; supervisor_nome: string | null } | null
  tecnico: { nome: string; matricula: string } | null
  ordem_servico: OS[]
}

const SELECT = `
  id, toa_atividade_id, wo_numero, contrato, cliente_nome, tipo_pessoa,
  tipo_residencia, telefones, logradouro, complemento, bairro, cidade, uf, cep,
  lat, lng, node, data_agendada, janela_inicio, janela_fim, inicio, fim,
  tempo_deslocamento, situacao, bloqueado_em, origem, observacao, criado_em,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome ),
  segmentacao:segmentacao_id ( nome ),
  area:area_id ( codigo, apelido ),
  equipe:equipe_id ( id, codigo, supervisor_nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  ordem_servico (
    id, sequencia, numero_os, ponto, status_operadora, produto, observacao,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, familia, natureza, responsabilidade )
  )
`

type Aba = 'detalhe' | 'historico' | 'anexos' | 'anteriores'

const dt = (s: string | null) => s
  ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : '—'
const dia = (s: string) => new Date(s + 'T12:00').toLocaleDateString('pt-BR')

function Campo({ r, v, destaque }: { r: string; v: React.ReactNode; destaque?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-graf-500">{r}</dt>
      <dd className={`mt-0.5 text-sm ${destaque ? 'font-semibold text-graf-100' : 'text-graf-200'}`}>
        {v ?? <span className="text-graf-600">—</span>}
      </dd>
    </div>
  )
}

export default function VisitaDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()

  // Esc volta para onde a pessoa estava. Na janela do contrato o Esc já
  // fechava; abrir a página cheia e ficar preso nela quebrava o hábito.
  // Não intercepta quem está digitando — Esc dentro de campo tem dono.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const alvo = e.target as HTMLElement | null
      const digitando = alvo && (
        alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' ||
        alvo.tagName === 'SELECT' || alvo.isContentEditable)
      if (digitando) return
      navegar(-1)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [navegar])
  const [aba, setAba] = useState<Aba>('detalhe')
  const [v, setV] = useState<Det | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [anexos, setAnexos] = useState<Evidencia[]>([])
  /**
   * ┌─ POR QUE PRECISA DE URL ASSINADA ──────────────────────────────┐
   * │ O bucket `evidencia` é PRIVADO (055-C). Um `<img src>` apontando │
   * │ para o caminho cru volta 400 e a tela mostra um quadrado cinza   │
   * │ sem explicação — que é pior que não mostrar nada.                │
   * │                                                                   │
   * │ `createSignedUrls` assina o LOTE inteiro numa ida só. Assinar     │
   * │ uma a uma seriam N viagens para abrir uma aba.                    │
   * └───────────────────────────────────────────────────────────────────┘
   */
  const [urls, setUrls] = useState<Record<string, string>>({})
  /** A evidência aberta em tela cheia. */
  const [ampliada, setAmpliada] = useState<Evidencia | null>(null)

  useEffect(() => {
    const caminhos = anexos.map(a => a.arquivo_path)
    if (caminhos.length === 0) return
    let vivo = true
    supabase.storage.from('evidencia').createSignedUrls(caminhos, 3600)
      .then(({ data }) => {
        if (!vivo || !data) return
        const mapa: Record<string, string> = {}
        for (const u of data) if (u.path && u.signedUrl) mapa[u.path] = u.signedUrl
        setUrls(mapa)
      })
    return () => { vivo = false }
  }, [anexos])
  const [anteriores, setAnteriores] = useState<Det[]>([])
  const [equipes, setEquipes] = useState<{ id: string; codigo: string }[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [transferindo, setTransferindo] = useState(false)
  const [novaEquipe, setNovaEquipe] = useState('')
  const [motivo, setMotivo] = useState('')

  async function carregar() {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.from('visita').select(SELECT).eq('id', id!).maybeSingle()
    if (error) { setErro(error.message); setCarregando(false); return }
    if (!data) { setErro('Visita não encontrada — ou fora do seu acesso.'); setCarregando(false); return }
    const d = data as unknown as Det
    setV(d)

    const [ev, an, eq] = await Promise.all([
      supabase.from('visita_evento')
        .select(`id, tipo, observacao, login, de, para, lat, lng, origem, criado_em,
                 equipe:equipe_id ( codigo ),
                 usuario:usuario_id ( nome ),
                 sub_falha:sub_falha_id ( nome, categoria ),
                 codigo_baixa:codigo_baixa_id ( codigo, descricao )`)
        .eq('visita_id', id!).order('criado_em', { ascending: false }),
      supabase.from('evidencia')
        .select(`id, tipo, arquivo_path, tamanho_bytes, lat, lng, capturada_em, criado_em,
                 midia, mime, duracao_seg, precisao_m, observacao, login, origem,
                 tecnico:tecnico_id ( nome, matricula )`)
        .eq('visita_id', id!).order('criado_em'),
      supabase.from('equipe').select('id, codigo').order('codigo'),
    ])
    setEventos((ev.data ?? []) as unknown as Evento[])
    setAnexos((an.data ?? []) as unknown as Evidencia[])
    setEquipes((eq.data ?? []) as { id: string; codigo: string }[])

    if (d.contrato) {
      const { data: ant } = await supabase.from('visita').select(SELECT)
        .eq('contrato', d.contrato).neq('id', d.id)
        .order('data_agendada', { ascending: false }).limit(20)
      setAnteriores((ant ?? []) as unknown as Det[])
    }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [id])

  async function transferir() {
    if (!novaEquipe) return
    setTransferindo(true); setErro(null)
    const { data, error } = await supabase.rpc('transferir_visita', {
      p_visita: id, p_equipe: novaEquipe, p_motivo: motivo || null,
    })
    if (error) setErro(error.message)
    else {
      const r = data as { mudou: boolean; de?: string; para?: string }
      setOk(r.mudou ? `Transferida de ${r.de ?? '(sem equipe)'} para ${r.para}.`
                    : 'Já era essa equipe.')
      setNovaEquipe(''); setMotivo('')
      await carregar()
    }
    setTransferindo(false)
  }

  const resumo = useMemo(() => {
    if (!v) return null
    const os = v.ordem_servico
    return {
      total: os.length,
      executadas: os.filter(o => o.codigo_baixa?.natureza === 'SUCESSO').length,
      improdutivas: os.filter(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA').length,
      semBaixa: os.filter(o => !o.codigo_baixa).length,
    }
  }, [v])

  if (carregando) return <Shell><p className="p-12 text-center text-graf-400">Carregando…</p></Shell>
  if (!v) return (
    <Shell><div className="p-4">
      <Alerta tipo="erro">{erro}</Alerta>
      <Link to="/controle/servicos" className="mt-4 inline-block text-af-400 underline">
        Voltar para Serviços</Link>
    </div></Shell>
  )

  const abas: [Aba, string, number?][] = [
    ['detalhe', 'Detalhe'],
    ['historico', 'Histórico', eventos.length],
    ['anexos', 'Anexos', anexos.length],
    ['anteriores', 'Serviços anteriores', anteriores.length],
  ]

  return (
    <Shell>
      <div className="pagina-entra space-y-3 p-4">
        {/* ---------- cabeçalho ---------- */}
        <div className="flex flex-wrap items-start gap-3">
          <button onClick={() => navegar(-1)}
            className="-ml-1 rounded-md px-2 py-1 text-xl leading-none text-graf-400 hover:text-graf-100"
            title="Voltar (Esc)" aria-label="Voltar">‹</button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">
                {v.tipo_servico?.nome ?? v.tipo_atividade?.nome ?? 'Visita'}
              </h1>
              <Pill situacao={v.situacao} />
              {v.bloqueado_em && (
                <span title={`Campo tocou em ${dt(v.bloqueado_em)} — o TOA não sobrescreve mais`}
                  className="rounded bg-af-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-af-300">
                  protegida do TOA
                </span>
              )}
              {v.tipo_atividade?.natureza === 'JORNADA' && (
                <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[10px] text-graf-400">
                  jornada · fora da produtividade
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-graf-400">
              {dia(v.data_agendada)}
              {v.janela_inicio && ` · ${v.janela_inicio.slice(0, 5)}`}
              {v.janela_fim && `–${v.janela_fim.slice(0, 5)}`}
              {v.contrato && <> · contrato <span className="tabular">{v.contrato}</span></>}
            </p>
          </div>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        {/* ---------- abas ---------- */}
        <div className="flex flex-wrap gap-1 border-b border-graf-800">
          {abas.map(([k, r, n]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                aba === k ? 'border-af-500 font-medium text-graf-100'
                          : 'border-transparent text-graf-400 hover:text-graf-200'}`}>
              {r}{n !== undefined && <span className="tabular ml-1.5 text-xs opacity-60">{n}</span>}
            </button>
          ))}
        </div>

        {/* ================= DETALHE ================= */}
        {aba === 'detalhe' && (
          <div className="space-y-3">
            <section className="card-controle p-4">
              <h2 className="mb-3 text-sm font-semibold">Cliente e endereço</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <Campo r="Nome" v={v.cliente_nome} destaque />
                </div>
                <Campo r="Tipo de pessoa" v={v.tipo_pessoa} />
                <Campo r="Edificação" v={v.tipo_residencia} />
                <div className="sm:col-span-2">
                  <Campo r="Endereço" v={
                    v.logradouro ? <>
                      {v.logradouro}{v.complemento && `, ${v.complemento}`}
                      <div className="text-graf-400">
                        {[v.bairro, v.cidade, v.uf].filter(Boolean).join(' · ')}
                        {v.cep && ` · ${v.cep}`}
                      </div>
                    </> : null} />
                </div>
                <Campo r="Telefones" v={v.telefones?.length
                  ? v.telefones.join(' · ') : null} />
                <Campo r="Coordenadas" v={v.lat && v.lng
                  ? <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}
                       target="_blank" rel="noopener noreferrer"
                       className="tabular text-af-400 underline underline-offset-2">
                      {v.lat}, {v.lng}
                    </a> : null} />
              </dl>
            </section>

            <section className="card-controle p-4">
              <h2 className="mb-3 text-sm font-semibold">Atendimento</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                <Campo r="Equipe" v={v.equipe
                  ? <>{v.equipe.codigo}
                      {v.equipe.supervisor_nome &&
                        <div className="text-xs text-graf-500">{v.equipe.supervisor_nome}</div>}
                    </> : <span className="text-af-400">sem equipe</span>} destaque />
                <Campo r="Técnico" v={v.tecnico
                  ? `${v.tecnico.nome} (${v.tecnico.matricula})` : null} />
                <Campo r="Área" v={v.area ? `${v.area.apelido ?? ''} · ${v.area.codigo}` : null} />
                <Campo r="Node" v={v.node} />
                <Campo r="Segmentação" v={v.segmentacao?.nome} />
                <Campo r="Tipo de atividade (TOA)" v={v.tipo_atividade?.nome} />
                <Campo r="Grupo de serviço" v={v.tipo_servico?.nome} />
                <Campo r="Origem" v={v.origem} />
                <Campo r="WO" v={v.wo_numero} />
                <Campo r="Atividade TOA" v={v.toa_atividade_id} />
                <Campo r="Início" v={dt(v.inicio)} />
                <Campo r="Fim" v={dt(v.fim)} />
                <Campo r="Deslocamento" v={v.tempo_deslocamento?.slice(0, 5)} />
                <Campo r="Importada em" v={dt(v.criado_em)} />
                <Campo r="Protegida desde" v={v.bloqueado_em ? dt(v.bloqueado_em) : null} />
              </dl>
              {v.observacao && (
                <div className="mt-3 border-t border-graf-800 pt-3">
                  <Campo r="Observação" v={v.observacao} />
                </div>
              )}
            </section>

            {/* ---------- ordens de serviço ---------- */}
            <section className="card-controle overflow-hidden">
              <div className="flex flex-wrap items-baseline gap-3 border-b border-graf-800 px-4 py-3">
                <h2 className="text-sm font-semibold">
                  {resumo!.total} ordem(ns) de serviço
                </h2>
                <div className="flex flex-wrap gap-3 text-xs text-graf-400">
                  {resumo!.executadas > 0 && <span className="text-emerald-400">{resumo!.executadas} executada(s)</span>}
                  {resumo!.improdutivas > 0 && <span className="text-af-400">{resumo!.improdutivas} improdutiva(s)</span>}
                  {resumo!.semBaixa > 0 && <span>{resumo!.semBaixa} sem baixa</span>}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-graf-800 bg-graf-900 text-left
                                    text-[11px] uppercase tracking-wide text-graf-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Número O.S.</th>
                      <th className="px-3 py-2 font-medium">Ordem de serviço</th>
                      <th className="px-3 py-2 font-medium">Ponto</th>
                      <th className="px-3 py-2 font-medium">Código de baixa</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                      <th className="px-3 py-2 font-medium">Responsável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
                      <tr key={o.id} className="border-b border-graf-800/60">
                        <td className="tabular px-3 py-2 text-graf-500">{o.sequencia}</td>
                        <td className="tabular px-3 py-2 font-medium">{o.numero_os}</td>
                        <td className="px-3 py-2 text-graf-300">
                          {o.tipo_os
                            ? <><span className="tabular text-graf-500">{o.tipo_os.codigo}</span>
                                {' · '}{o.tipo_os.descricao}</>
                            : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-xs text-graf-500">{o.ponto ?? '—'}</td>
                        <td className="px-3 py-2">
                          {o.codigo_baixa ? (
                            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              o.codigo_baixa.natureza === 'SUCESSO'
                                ? 'bg-emerald-900/40 text-emerald-300'
                                : o.codigo_baixa.natureza === 'IMPRODUTIVA'
                                ? 'bg-af-900/40 text-af-300' : 'bg-graf-800 text-graf-400'}`}>
                              {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                            </span>
                          ) : <span className="text-xs text-graf-600">sem baixa</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {o.status_operadora === 'EXECUTADA'
                            ? <span className="text-emerald-400">Executada</span>
                            : o.status_operadora === 'NAO_EXECUTADA'
                            ? <span className="text-af-400">Não executada</span>
                            : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {o.codigo_baixa?.responsabilidade
                            ? o.codigo_baixa.responsabilidade === 'TECNICO'
                              ? <span className="font-medium text-af-400">nossa</span>
                              : o.codigo_baixa.responsabilidade.toLowerCase()
                            : '—'}
                        </td>
                      </tr>
                    ))}
                    {v.ordem_servico.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-graf-500">
                        Nenhuma O.S. — apontamento de jornada.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-graf-800 px-4 py-2.5 text-xs text-graf-500">
                As colunas <strong>Item</strong>, <strong>Consolidado</strong>,
                <strong> Valor</strong> e <strong>Pontos</strong> entram quando a
                regra de pontuação for definida — ver <code>docs/06-PONTUACAO.md</code>.
              </p>
            </section>

            {/* ---------- transferir equipe ---------- */}
            <section className="card-controle p-4">
              <h2 className="mb-1 text-sm font-semibold">Transferir para outra equipe</h2>
              <p className="mb-3 text-xs text-graf-500">
                A transferência fica registrada no histórico, com a equipe de origem,
                quem transferiu e o motivo.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40">
                  <label className="mb-1 block text-[11px] text-graf-400">Equipe destino</label>
                  <select value={novaEquipe} onChange={e => setNovaEquipe(e.target.value)}
                    className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm">
                    <option value="">Selecione…</option>
                    {equipes.filter(e => e.id !== v.equipe?.id)
                      .map(e => <option key={e.id} value={e.id}>{e.codigo}</option>)}
                  </select>
                </div>
                <div className="min-w-56 flex-1">
                  <label className="mb-1 block text-[11px] text-graf-400">Motivo</label>
                  <input value={motivo} onChange={e => setMotivo(e.target.value)}
                    placeholder="Por que está transferindo?"
                    className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm" />
                </div>
                <button onClick={transferir} disabled={!novaEquipe || transferindo}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-sm font-medium text-white
                             hover:bg-af-500 disabled:opacity-40">
                  {transferindo ? 'Transferindo…' : 'Transferir'}
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ================= HISTÓRICO ================= */}
        {aba === 'historico' && (
          <section className="card-controle overflow-hidden">
            {eventos.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-graf-500">
                Nenhum evento registrado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-graf-800 bg-graf-900 text-left
                                    text-[11px] uppercase tracking-wide text-graf-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Quando</th>
                      <th className="px-3 py-2 font-medium">Evento</th>
                      <th className="px-3 py-2 font-medium">Código de baixa</th>
                      <th className="px-3 py-2 font-medium">Sub-falha</th>
                      <th className="px-3 py-2 font-medium">Equipe</th>
                      <th className="px-3 py-2 font-medium">Observação</th>
                      <th className="px-3 py-2 font-medium">Quem</th>
                      <th className="px-3 py-2 font-medium">Login</th>
                      <th className="px-3 py-2 text-center font-medium">Geo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventos.map(e => (
                      <tr key={e.id} className="border-b border-graf-800/60 align-top">
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">
                          {dt(e.criado_em)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[11px] font-medium">
                            {rotuloEvento(e.tipo)}
                          </span>
                          {transicaoEvento(e) && (
                            <div className="mt-1 text-[11px] text-graf-500">
                              {transicaoEvento(e)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-300">
                          {e.codigo_baixa
                            ? `${e.codigo_baixa.codigo} · ${e.codigo_baixa.descricao}`
                            : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {e.sub_falha ? (
                            <>
                              <span className="text-amber-300">{e.sub_falha.nome}</span>
                              {e.sub_falha.categoria && (
                                <div className="text-[10px] text-graf-500">{e.sub_falha.categoria}</div>
                              )}
                            </>
                          ) : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-300">
                          {e.equipe?.codigo ?? <span className="text-graf-600">—</span>}
                        </td>
                        <td className="max-w-72 px-3 py-2 text-xs text-graf-300">
                          {e.observacao ?? <span className="text-graf-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {e.usuario?.nome ?? <span className="text-graf-600">sistema</span>}
                          {e.origem && <div className="text-[10px] text-graf-600">{e.origem.toLowerCase()}</div>}
                        </td>
                        {/* O login do TOA quando o evento veio da planilha; o
                            e-mail de quem operou quando veio da tela. */}
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {e.login ?? <span className="text-graf-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {e.lat && e.lng ? (
                            <a href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}
                               target="_blank" rel="noopener noreferrer"
                               title={`${e.lat}, ${e.lng}`} className="text-af-400">◉</a>
                          ) : <span className="text-graf-700">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ================= ANEXOS ================= */}
        {/* Antes esta aba listava NOME DE ARQUIVO: o controlador sabia
            que a foto existia e não conseguia olhar. Meia
            funcionalidade — servia para o técnico cumprir, não para a
            AFLINE provar nada para a CLARO. */}
        {aba === 'anexos' && (
          <section className="card-controle p-4">
            {anexos.length === 0 ? (
              <p className="py-10 text-center text-sm text-graf-500">
                Nenhuma evidência anexada nesta visita.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {anexos.map(a => {
                  const url = urls[a.arquivo_path]
                  const ehVideo = a.midia === 'VIDEO'
                  return (
                    <button
                      key={a.id} onClick={() => setAmpliada(a)}
                      className="group overflow-hidden rounded-lg border border-graf-800
                                 bg-graf-900 text-left transition hover:border-graf-600"
                    >
                      <div className="relative flex h-36 items-center justify-center
                                      overflow-hidden bg-graf-950">
                        {url && !ehVideo && (
                          <img src={url} alt={a.tipo} loading="lazy"
                               className="h-full w-full object-cover transition
                                          group-hover:scale-105" />
                        )}
                        {url && ehVideo && <span className="text-2xl text-graf-400">▶</span>}
                        {!url && <span className="text-[11px] text-graf-600">carregando…</span>}

                        {/* Foto sem coordenada é prova fraca, e a tela
                            diz isso em vez de sumir com a informação. */}
                        {!a.lat && (
                          <span className="absolute right-1.5 top-1.5 rounded bg-amber-500/90
                                           px-1.5 py-0.5 text-[10px] font-bold text-graf-950">
                            sem GPS
                          </span>
                        )}
                      </div>

                      <div className="p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[10px]
                                           font-semibold uppercase text-graf-300">
                            {a.tipo.replace(/_/g, ' ')}
                          </span>
                          {ehVideo && a.duracao_seg && (
                            <span className="tabular text-[10px] text-graf-400">
                              {Math.floor(a.duracao_seg / 60)}:
                              {String(a.duracao_seg % 60).padStart(2, '0')}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-[11px] text-graf-500">
                          {dt(a.capturada_em ?? a.criado_em)}
                          {a.tamanho_bytes ? ` · ${(a.tamanho_bytes / 1024).toFixed(0)} KB` : ''}
                        </p>
                        <p className="truncate text-[11px] text-graf-500">
                          {a.tecnico?.nome ?? a.login ?? '—'}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* ---------- a evidência em tela cheia ---------- */}
        {ampliada && (
          <div
            onClick={() => setAmpliada(null)}
            className="fixed inset-0 z-50 flex items-center justify-center
                       bg-graf-950/95 p-4 backdrop-blur"
          >
            <div onClick={e => e.stopPropagation()}
                 className="flex max-h-full w-full max-w-6xl flex-col gap-3
                            lg:flex-row lg:items-start">
              <div className="flex min-h-0 flex-1 items-center justify-center">
                {ampliada.midia === 'VIDEO' ? (
                  <video src={urls[ampliada.arquivo_path]} controls autoPlay
                         className="max-h-[80vh] w-full rounded-lg bg-black" />
                ) : (
                  <img src={urls[ampliada.arquivo_path]} alt={ampliada.tipo}
                       className="max-h-[85vh] rounded-lg object-contain" />
                )}
              </div>

              {/* A ficha da prova. Coordenada sem PRECISÃO não prova
                  presença: ±8 m é o técnico na porta, ±2.000 m é a
                  antena mais próxima. */}
              <aside className="card-controle w-full shrink-0 p-4 text-sm lg:w-72">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="font-semibold uppercase tracking-wide text-graf-300">
                    {ampliada.tipo.replace(/_/g, ' ')}
                  </h3>
                  <button onClick={() => setAmpliada(null)}
                          className="text-lg leading-none text-graf-400 hover:text-graf-200">
                    ✕
                  </button>
                </div>

                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="text-graf-500">Quem registrou</dt>
                    <dd>{ampliada.tecnico
                      ? `${ampliada.tecnico.nome} (${ampliada.tecnico.matricula})`
                      : ampliada.login ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-graf-500">Quando</dt>
                    <dd className="tabular">
                      {dt(ampliada.capturada_em ?? ampliada.criado_em)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-graf-500">Onde</dt>
                    <dd>
                      {ampliada.lat && ampliada.lng ? (
                        <>
                          <a href={`https://www.google.com/maps?q=${ampliada.lat},${ampliada.lng}`}
                             target="_blank" rel="noopener noreferrer"
                             className="tabular text-af-400 underline">
                            {Number(ampliada.lat).toFixed(5)}, {Number(ampliada.lng).toFixed(5)}
                          </a>
                          {ampliada.precisao_m != null && (
                            <span className="ml-1 text-graf-500">
                              ±{Math.round(Number(ampliada.precisao_m))} m
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-amber-400">
                          sem coordenada — não prova presença
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-graf-500">Origem</dt>
                    <dd>{ampliada.origem === 'MOBILE' ? 'aplicativo do técnico' : 'web'}</dd>
                  </div>
                  {ampliada.observacao && (
                    <div>
                      <dt className="text-graf-500">Observação</dt>
                      <dd>{ampliada.observacao}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-graf-500">Arquivo</dt>
                    <dd className="break-all text-graf-400">
                      {ampliada.arquivo_path.split('/').pop()}
                      {ampliada.tamanho_bytes
                        ? ` · ${(ampliada.tamanho_bytes / 1024).toFixed(0)} KB` : ''}
                    </dd>
                  </div>
                </dl>

                {urls[ampliada.arquivo_path] && (
                  <a href={urls[ampliada.arquivo_path]} target="_blank"
                     rel="noopener noreferrer"
                     className="mt-4 block rounded-md border border-graf-700 py-2
                                text-center text-xs font-semibold hover:bg-graf-800">
                    Abrir original
                  </a>
                )}
              </aside>
            </div>
          </div>
        )}

        {/* ================= SERVIÇOS ANTERIORES ================= */}
        {aba === 'anteriores' && (
          <section className="card-controle overflow-hidden">
            {anteriores.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-graf-500">
                {v.contrato
                  ? 'Nenhum outro serviço neste contrato.'
                  : 'Visita sem contrato — não há como cruzar histórico.'}
              </p>
            ) : (
              <>
                <p className="border-b border-graf-800 px-4 py-2.5 text-xs text-graf-400">
                  {anteriores.length} outro(s) atendimento(s) no contrato{' '}
                  <span className="tabular text-graf-200">{v.contrato}</span>.
                  Reincidência curta é sinal de serviço mal resolvido.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-graf-800 bg-graf-900 text-left
                                      text-[11px] uppercase tracking-wide text-graf-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Data</th>
                        <th className="px-3 py-2 font-medium">Dias antes</th>
                        <th className="px-3 py-2 font-medium">Grupo</th>
                        <th className="px-3 py-2 font-medium">Situação</th>
                        <th className="px-3 py-2 font-medium">Equipe</th>
                        <th className="px-3 py-2 font-medium">Baixas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anteriores.map(a => {
                        const dias = Math.round(
                          (new Date(v.data_agendada).getTime() - new Date(a.data_agendada).getTime())
                          / 86400000)
                        return (
                          <tr key={a.id} className="border-b border-graf-800/60">
                            <td className="tabular px-3 py-2">{dia(a.data_agendada)}</td>
                            <td className="tabular px-3 py-2 text-xs">
                              <span className={dias > 0 && dias <= 30 ? 'text-af-400' : 'text-graf-400'}>
                                {dias > 0 ? `${dias} dias antes` : `${-dias} dias depois`}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-graf-300">
                              {a.tipo_servico?.nome ?? a.tipo_atividade?.nome ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {SITUACAO_INFO[a.situacao]?.label ?? a.situacao}
                            </td>
                            <td className="px-3 py-2 text-xs text-graf-400">
                              {a.equipe?.codigo ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-xs text-graf-400">
                              {a.ordem_servico.map(o => o.codigo_baixa?.codigo).filter(Boolean).join(', ') || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </Shell>
  )
}
