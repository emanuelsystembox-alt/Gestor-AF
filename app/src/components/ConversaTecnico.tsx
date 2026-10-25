import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCentral } from '../lib/central'
import { useAuth } from '../lib/auth'

/**
 * A conversa com o técnico, EMBUTIDA na tela do contrato (133).
 *
 * ┌─ por que a conversa também mora aqui ─────────────────────────────┐
 * │ > "podemos fazer algo parecido (...) onde ver as fotos e histórico │
 * │ >  das conversas em uma única tela, assim fica bem melhor do       │
 * │ >  controlador responder o técnico" — Emanuel, 25/10               │
 * │                                                                    │
 * │ A gaveta do topo continua existindo — é a caixa de entrada de      │
 * │ todas as conversas. O que faltava era responder SEM SAIR do        │
 * │ contrato, com a foto e o histórico do lado.                        │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * É a MESMA conversa da gaveta (091): uma por técnico, compartilhada
 * pelos controladores que enxergam a equipe dele. Não é um canal do
 * contrato — mensagem não tem dono de contrato, e inventar um aqui
 * criaria duas caixas que divergem.
 */

interface Msg {
  id: number; do_campo: boolean; autor_nome: string | null; texto: string
  criado_em: string; lida_em: string | null
  para_usuario_id?: string | null
  para?: { nome: string } | null
}

const SELECT_MSG = 'id, do_campo, autor_nome, texto, criado_em, lida_em, para_usuario_id, para:para_usuario_id ( nome )'

const hora = (ts: string) => {
  const d = new Date(ts)
  const hoje = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' }
                                        : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ConversaTecnico({ tecnicoId, nome, altura = 'h-80' }: {
  tecnicoId: string | null
  nome?: string | null
  /** Classe de altura da área das mensagens — a tela decide o espaço. */
  altura?: string
}) {
  const { ultimaMensagem, recarregar } = useCentral()
  const eu = useAuth().session?.user.id ?? null
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const fim = useRef<HTMLDivElement>(null)

  async function carregar(marcarLida: boolean) {
    if (!tecnicoId) { setMsgs([]); setCarregando(false); return }
    const { data, error } = await supabase.from('mensagem').select(SELECT_MSG)
      .eq('tecnico_id', tecnicoId).order('criado_em', { ascending: false }).limit(200)
    if (error) setErro(error.message)
    setMsgs(((data ?? []) as unknown as Msg[]).reverse())
    setCarregando(false)
    if (marcarLida) {
      await supabase.rpc('marcar_conversa_lida', { p_tecnico_id: tecnicoId })
      recarregar()
    }
  }

  useEffect(() => { setCarregando(true); carregar(true) }, [tecnicoId])

  // O que chega pelo Realtime entra na hora — a linha é a verdade, o
  // Realtime só antecipa (D-119).
  useEffect(() => {
    if (!ultimaMensagem || ultimaMensagem.tecnico_id !== tecnicoId) return
    setMsgs(l => l.some(m => m.id === ultimaMensagem.id) ? l : [...l, ultimaMensagem])
    if (ultimaMensagem.do_campo && tecnicoId) {
      supabase.rpc('marcar_conversa_lida', { p_tecnico_id: tecnicoId }).then(() => recarregar())
    }
  }, [ultimaMensagem, tecnicoId, recarregar])

  // Rola só a caixa das mensagens, nunca a página: `block: 'nearest'`.
  useEffect(() => { fim.current?.scrollIntoView({ block: 'nearest' }) }, [msgs])

  async function enviar() {
    const t = texto.trim()
    if (!t || !tecnicoId || enviando) return
    setEnviando(true); setErro(null)
    const { error } = await supabase.rpc('enviar_mensagem', { p_tecnico_id: tecnicoId, p_texto: t })
    setEnviando(false)
    // Falhou: o texto FICA na caixa.
    if (error) { setErro(error.message); return }
    setTexto('')
    await carregar(false)
  }

  if (!tecnicoId) {
    return (
      <p className="text-sm text-graf-400">
        Este contrato não tem técnico responsável — não há com quem conversar aqui.
        A conversa é POR TÉCNICO, não por contrato.
      </p>
    )
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className={`${altura} min-h-0 space-y-1.5 overflow-y-auto rounded-lg border
                       border-graf-800 bg-graf-900/40 p-3`}>
        {carregando ? (
          <p className="py-8 text-center text-sm text-graf-400">Carregando…</p>
        ) : msgs.length === 0 ? (
          <p className="py-8 text-center text-sm text-graf-400">
            Nenhuma mensagem com {nome?.split(' ')[0] ?? 'este técnico'} ainda.
            A primeira aparece no aplicativo dele, na aba Conversa.
          </p>
        ) : msgs.map((m, i) => {
          const doControle = !m.do_campo
          const mostraAutor = doControle
            && (i === 0 || msgs[i - 1].autor_nome !== m.autor_nome || msgs[i - 1].do_campo)
          return (
            <div key={m.id} className={`flex flex-col ${doControle ? 'items-end' : 'items-start'}`}>
              {mostraAutor && (
                <span className="mb-0.5 text-[10px] text-graf-400">{m.autor_nome ?? 'Controle'}</span>
              )}
              {/* 132: o técnico direcionou a mensagem a uma pessoa. */}
              {m.do_campo && m.para_usuario_id && (
                m.para_usuario_id === eu
                  ? <span className="mb-0.5 rounded bg-af-600 px-1.5 text-[10px] font-semibold text-white">para você</span>
                  : <span className="mb-0.5 text-[10px] text-amber-300">para {m.para?.nome ?? 'outra pessoa da gestão'}</span>
              )}
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                doControle ? 'rounded-br-md bg-af-600 text-white'
                           : 'rounded-bl-md border border-graf-700 bg-graf-900 text-graf-100'}`}>
                {m.texto}
              </div>
              <span className="mt-0.5 text-[10px] text-graf-400">
                {hora(m.criado_em)}{doControle ? (m.lida_em ? ' · lida' : ' · não lida') : ''}
              </span>
            </div>
          )
        })}
        <div ref={fim} />
      </div>

      {erro && <p className="pt-2 text-xs text-af-300">{erro}</p>}

      <form className="flex items-end gap-2 pt-2"
        onSubmit={e => { e.preventDefault(); enviar() }}>
        <textarea value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
          rows={2} maxLength={2000} placeholder="Escreva… (Enter envia, Shift+Enter quebra a linha)"
          aria-label="Mensagem para o técnico"
          className="min-h-10 flex-1 resize-none rounded-lg border border-graf-700 bg-graf-900 px-3 py-2
                     text-sm outline-none focus:border-af-500" />
        <button type="submit" disabled={!texto.trim() || enviando}
          className="rounded-lg bg-af-600 px-4 py-2 text-sm font-semibold text-white
                     hover:bg-af-500 disabled:opacity-50">
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </div>
  )
}
