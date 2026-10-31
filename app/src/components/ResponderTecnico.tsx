import { useMemo, useState } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { supabase, SITUACAO_INFO, SITUACOES, EM_ABERTO, type Situacao } from '../lib/supabase'
import { useCentral } from '../lib/central'
import { rotuloEvento, transicaoEvento } from '../lib/eventos'
import { Alerta } from './ui'

/**
 * Responder ao técnico — o bloco que muda o status com a resposta colada
 * na mudança (Emanuel, 27/09), agora com o CONTEXTO em cima (133).
 *
 * ┌─ por que as duas últimas atualizações aparecem aqui ───────────────┐
 * │ > "é importante ver as duas últimas atualizações do histórico do   │
 * │ >  contrato para poder o controlador responder (...) essa resposta │
 * │ >  não tá muito clara" — Emanuel, 25/10                            │
 * │                                                                     │
 * │ Antes, o bloco só destacava o pedido de ajuda — e só quando o       │
 * │ contrato estava EM impedimento. Quem respondia tinha de abrir a aba │
 * │ Histórico, ler, voltar e lembrar. Responder sem o que acabou de     │
 * │ acontecer é responder no escuro.                                    │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Não é um canal novo: a observação da mudança JÁ vira aviso no celular
 * do técnico (059, `aviso_do_evento`). Contrato aberto muda por
 * `registrar_etapa` (encerrar exige todas as O.S. baixadas — a mesma
 * trava do campo); contrato encerrado só volta por `reverter_situacao`,
 * que exige motivo (D-030). A tela escolhe a porta; quem decide é o banco.
 */

/** O que este bloco precisa de um evento do histórico. */
export interface EventoResumo {
  id: number; tipo: string; observacao: string | null; origem: string | null
  criado_em: string
  de: Record<string, unknown> | null
  para: Record<string, unknown> | null
  usuario: { nome: string } | null
  login: string | null
  equipe?: { codigo: string } | null
  codigo_baixa?: { codigo: number; descricao: string } | null
  sub_falha?: { nome: string; categoria: string | null } | null
}

export interface VisitaResumo {
  id: string; situacao: Situacao
  tecnico_responsavel_id: string | null
  tecnico: { nome: string } | null
}

const quando = (s: string) =>
  new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** As últimas linhas do histórico, do jeito que a aba Histórico as conta. */
export function UltimasAtualizacoes({ eventos, quantas = 2 }:
  { eventos: EventoResumo[]; quantas?: number }) {
  const ultimos = useMemo(() => eventos.slice(0, quantas), [eventos, quantas])
  if (ultimos.length === 0) {
    return <p className="text-xs text-graf-400">Nenhum evento registrado neste contrato ainda.</p>
  }
  return (
    <ol className="space-y-1.5">
      {ultimos.map(e => (
        <li key={e.id} className="rounded-lg border border-graf-800 bg-graf-900/60 px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[11px] font-medium">
              {rotuloEvento(e.tipo)}
            </span>
            {transicaoEvento(e) && (
              <span className="text-[11px] text-graf-300">{transicaoEvento(e)}</span>
            )}
            {e.codigo_baixa && (
              <span className="text-[11px] text-graf-300">
                · {e.codigo_baixa.codigo} {e.codigo_baixa.descricao}
              </span>
            )}
            {e.sub_falha && (
              <span className="text-[11px] text-amber-300">· {e.sub_falha.nome}</span>
            )}
            <span className="tabular ml-auto text-[10px] text-graf-400">{quando(e.criado_em)}</span>
          </div>
          {/* A observação é o que o técnico escreveu — é ela que o
              controlador responde. Vazia não vira texto inventado. */}
          {e.observacao
            ? <p className="mt-1 text-sm text-graf-100">“{e.observacao}”</p>
            : <p className="mt-1 text-xs text-graf-400">sem observação</p>}
          <p className="mt-0.5 text-[10px] text-graf-400">
            {e.usuario?.nome ?? e.login ?? 'sistema'}
            {e.origem === 'MOBILE' ? ' · pelo celular do técnico'
              : e.origem ? ` · ${e.origem.toLowerCase()}` : ''}
          </p>
        </li>
      ))}
    </ol>
  )
}

export function ResponderTecnico({ visita, eventos, aoMudar, semMoldura }: {
  visita: VisitaResumo
  eventos: EventoResumo[]
  aoMudar: () => void | Promise<void>
  /** Dentro de um cartão que já existe, não desenha o seu. */
  semMoldura?: boolean
}) {
  const { abrirChat, recarregar: recarregarCentral } = useCentral()
  // 162: "Quando clico em abrir conversa (...) ele abre a janela por trás,
  // mas não fecha essa" (Emanuel, 30/10). Na JANELA do contrato (rota com
  // fundo, App.tsx) a conversa abria atrás dela. Agora a janela fecha e
  // volta para a lista de fundo — direto para ela, e não `-1`, que numa
  // pilha de "Serviços anteriores" cairia em outro contrato. Na página
  // cheia não há janela a fechar: a conversa abre por cima, como sempre.
  const rota = useLocation()
  const navegar = useNavigate()
  const fundo = (rota.state as { fundo?: Location } | null)?.fundo
  function abrirConversa(tecnicoId: string) {
    if (fundo) {
      navegar({ pathname: fundo.pathname, search: fundo.search, hash: fundo.hash },
              { state: fundo.state })
    }
    abrirChat(tecnicoId)
  }
  const [novaSituacao, setNovaSituacao] = useState('')
  const [resposta, setResposta] = useState('')
  const [respondendo, setRespondendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  /** O último pedido de ajuda do campo: Impedimento registrado pelo celular. */
  const pedidoDeAjuda = useMemo(() => {
    const ev = eventos.find(e => (e.para as { situacao?: string } | null)?.situacao === 'COM_IMPEDIMENTO')
    return ev && ev.origem === 'MOBILE' && visita.situacao === 'COM_IMPEDIMENTO' ? ev : null
  }, [eventos, visita.situacao])

  async function responder() {
    if (!novaSituacao) return
    // Encerrado = fora de EM_ABERTO: a lista que a web já tem, sem cópia nova.
    const encerrado = !EM_ABERTO.includes(visita.situacao)
    if (encerrado && !resposta.trim()) {
      setErro('Contrato encerrado só volta com motivo — escreva a resposta.')
      return
    }
    setRespondendo(true); setErro(null); setOk(null)
    const { error } = encerrado
      ? await supabase.rpc('reverter_situacao', {
          p_visita: visita.id, p_situacao: novaSituacao, p_motivo: resposta.trim(),
        })
      : await supabase.rpc('registrar_etapa', {
          p_visita: visita.id, p_situacao: novaSituacao,
          p_observacao: resposta.trim() || null, p_lat: null, p_lng: null,
        })
    setRespondendo(false)
    if (error) { setErro(error.message); return }
    setOk(`Status mudado para ${SITUACAO_INFO[novaSituacao as Situacao]?.label ?? novaSituacao}`
      + (resposta.trim() ? ' — o técnico recebe a resposta como aviso no celular.' : '.'))
    setNovaSituacao(''); setResposta('')
    await aoMudar()
    recarregarCentral()
  }

  const corpo = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Responder ao técnico</h2>
        {visita.tecnico_responsavel_id && (
          <button onClick={() => abrirConversa(visita.tecnico_responsavel_id!)}
            className="ml-auto rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                       hover:border-af-600 hover:text-af-400">
            Abrir conversa com {visita.tecnico?.nome?.split(' ')[0] ?? 'o técnico'}
          </button>
        )}
      </div>

      {erro && <div className="mb-2"><Alerta tipo="erro">{erro}</Alerta></div>}
      {ok && <div className="mb-2"><Alerta tipo="ok">{ok}</Alerta></div>}

      {pedidoDeAjuda && (
        <div className="mb-3 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2.5">
          <p className="text-xs font-semibold text-orange-300">
            Ticket de suporte aberto pelo campo · {quando(pedidoDeAjuda.criado_em)}
          </p>
          <p className="mt-0.5 text-sm text-graf-100">
            {pedidoDeAjuda.observacao
              ? `“${pedidoDeAjuda.observacao}”`
              : 'O técnico registrou impedimento sem observação.'}
          </p>
        </div>
      )}

      {/* 162: o formulário EM CIMA, o histórico embaixo — "novo status e
          resposta ao técnico devem ficar em cima (...) do histórico de
          conversa" (Emanuel, 30/10). Em 133 a ordem era a inversa ("ler,
          depois responder"); quem usa todo dia preferiu a resposta à mão.
          O pedido de ajuda continua no topo: é o que está sendo respondido. */}
      <p className="mb-3 text-xs text-graf-400">
        Escolha o status que faz sentido e escreva a resposta: ela chega no celular do
        técnico como aviso, junto com a mudança. Encerrar exige todas as O.S. baixadas;
        contrato já encerrado só volta com motivo.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-44">
          <label htmlFor={`nova-situacao-${visita.id}`} className="mb-1 block text-[11px] text-graf-400">
            Novo status
          </label>
          <select id={`nova-situacao-${visita.id}`} value={novaSituacao}
            onChange={e => setNovaSituacao(e.target.value)}
            className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm">
            <option value="">Selecione…</option>
            {SITUACOES.filter(s => s !== visita.situacao).map(s => (
              <option key={s} value={s}>{SITUACAO_INFO[s].label}</option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label htmlFor={`resposta-tecnico-${visita.id}`} className="mb-1 block text-[11px] text-graf-400">
            Resposta ao técnico
          </label>
          <input id={`resposta-tecnico-${visita.id}`} value={resposta}
            onChange={e => setResposta(e.target.value)} maxLength={500}
            onKeyDown={e => { if (e.key === 'Enter') responder() }}
            placeholder="Ex.: pode seguir, liguei para o cliente e ele está em casa"
            className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm" />
        </div>
        <button onClick={responder} disabled={!novaSituacao || respondendo}
          className="rounded-md bg-af-600 px-4 py-1.5 text-sm font-medium text-white
                     hover:bg-af-500 disabled:opacity-40">
          {respondendo ? 'Enviando…' : 'Responder e mudar status'}
        </button>
      </div>

      <p className="mb-1.5 mt-4 text-[10px] uppercase tracking-wide text-graf-500">
        As duas últimas atualizações do contrato
      </p>
      <UltimasAtualizacoes eventos={eventos} />
    </>
  )

  if (semMoldura) return <div>{corpo}</div>
  return (
    <section className={`card-controle p-4 ${pedidoDeAjuda ? 'ring-1 ring-orange-500/60' : ''}`}>
      {corpo}
    </section>
  )
}
