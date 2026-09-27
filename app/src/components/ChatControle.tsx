import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCentral } from '../lib/central'
import { Avatar } from './ui'

/**
 * A conversa do controle com o técnico (091).
 *
 * Uma conversa POR TÉCNICO, compartilhada por todo controlador que
 * enxerga a equipe dele: a troca de turno não deixa pergunta numa caixa
 * que ninguém abre. Cada mensagem leva o nome de quem escreveu —
 * carimbado pelo servidor, nunca pelo cliente (D-061).
 *
 * A gaveta abre por cima da tela, sem tirar o controlador do que ele
 * estava olhando: responder um técnico não pode custar perder o filtro
 * da tela de Serviços.
 */

interface Conversa {
  tecnico_id: string; nome: string; equipe: string | null; tem_app: boolean
  ultima_texto: string; ultima_em: string; ultima_do_campo: boolean; nao_lidas: number
}
interface Msg {
  id: number; do_campo: boolean; autor_nome: string | null; texto: string
  criado_em: string; lida_em: string | null
}
interface TecnicoOpcao { id: string; nome: string; usuario_id: string | null; equipe: { codigo: string } | null }

const hora = (ts: string) => {
  const d = new Date(ts)
  const hoje = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' }
                                        : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ChatControle() {
  const { chatAberto, fecharChat, chatTecnico, abrirChat, ultimaMensagem, recarregar } = useCentral()
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [novo, setNovo] = useState(false)
  const [tecnicos, setTecnicos] = useState<TecnicoOpcao[]>([])
  const [busca, setBusca] = useState('')
  const fim = useRef<HTMLDivElement>(null)
  const caixa = useRef<HTMLTextAreaElement>(null)

  const atual = conversas.find(c => c.tecnico_id === chatTecnico)
    ?? (chatTecnico ? (() => {
      const t = tecnicos.find(x => x.id === chatTecnico)
      return t ? { tecnico_id: t.id, nome: t.nome, equipe: t.equipe?.codigo ?? null,
                   tem_app: !!t.usuario_id } as Conversa : null
    })() : null)

  function carregarConversas() {
    supabase.rpc('conversas_do_controle').then(({ data }) =>
      setConversas((data ?? []) as Conversa[]))
  }

  useEffect(() => { if (chatAberto) carregarConversas() }, [chatAberto])

  // Lista de técnicos só quando for começar conversa nova.
  useEffect(() => {
    if (!novo || tecnicos.length) return
    supabase.from('tecnico').select('id, nome, usuario_id, equipe:equipe_id ( codigo )')
      .eq('situacao', 'ATIVO').order('nome')
      .then(({ data }) => setTecnicos((data ?? []) as unknown as TecnicoOpcao[]))
  }, [novo, tecnicos.length])

  useEffect(() => {
    if (!chatAberto || !chatTecnico) { setMsgs([]); return }
    let vivo = true
    setErro(null)
    supabase.from('mensagem').select('id, do_campo, autor_nome, texto, criado_em, lida_em')
      .eq('tecnico_id', chatTecnico).order('criado_em', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        setMsgs(((data ?? []) as Msg[]).reverse())
      })
    supabase.rpc('marcar_conversa_lida', { p_tecnico_id: chatTecnico })
      .then(() => { carregarConversas(); recarregar() })
    setTimeout(() => caixa.current?.focus(), 50)
    return () => { vivo = false }
  }, [chatAberto, chatTecnico, recarregar])

  // O que chega pelo Realtime: entra na conversa aberta, e a lista reordena.
  useEffect(() => {
    if (!ultimaMensagem || !chatAberto) return
    if (ultimaMensagem.tecnico_id === chatTecnico) {
      setMsgs(l => l.some(m => m.id === ultimaMensagem.id) ? l : [...l, ultimaMensagem])
      if (ultimaMensagem.do_campo) supabase.rpc('marcar_conversa_lida', { p_tecnico_id: chatTecnico })
    }
    carregarConversas()
  }, [ultimaMensagem, chatAberto, chatTecnico])

  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  useEffect(() => {
    if (!chatAberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharChat() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [chatAberto, fecharChat])

  const opcoes = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return tecnicos.filter(t => !q || t.nome.toLowerCase().includes(q)
      || (t.equipe?.codigo ?? '').includes(q)).slice(0, 30)
  }, [tecnicos, busca])

  async function enviar() {
    const t = texto.trim()
    if (!t || !chatTecnico || enviando) return
    setEnviando(true); setErro(null)
    const { error } = await supabase.rpc('enviar_mensagem', { p_tecnico_id: chatTecnico, p_texto: t })
    setEnviando(false)
    // Falhou: o texto FICA na caixa. Perder o que foi digitado é pior
    // que o erro.
    if (error) { setErro(error.message); return }
    setTexto('')
    const { data } = await supabase.from('mensagem')
      .select('id, do_campo, autor_nome, texto, criado_em, lida_em')
      .eq('tecnico_id', chatTecnico).order('criado_em', { ascending: false }).limit(200)
    setMsgs(((data ?? []) as Msg[]).reverse())
    carregarConversas()
  }

  if (!chatAberto) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Conversas com o campo">
      <div className="absolute inset-0 bg-black/40" onClick={fecharChat} />
      <div className="sup-controle absolute inset-y-0 right-0 flex w-full max-w-3xl border-l
                      border-graf-800 bg-graf-950 shadow-2xl">
        {/* ---------- a caixa de entrada ---------- */}
        <aside className={`flex w-full flex-col border-r border-graf-800 sm:w-72 ${
          chatTecnico ? 'hidden sm:flex' : 'flex'}`}>
          <div className="flex items-center justify-between border-b border-graf-800 px-3 py-3">
            <h2 className="text-sm font-semibold">Conversas com o campo</h2>
            <button onClick={fecharChat} aria-label="Fechar"
              className="rounded px-2 text-graf-400 hover:text-graf-100 sm:hidden">✕</button>
          </div>
          <div className="border-b border-graf-800 p-2">
            <button onClick={() => setNovo(n => !n)}
              className="w-full rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-300">
              {novo ? 'Voltar às conversas' : '+ Falar com um técnico'}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {novo ? (<>
              <div className="p-2">
                <input value={busca} onChange={e => setBusca(e.target.value)} autoFocus
                  placeholder="Buscar técnico ou equipe…" aria-label="Buscar técnico"
                  className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs
                             outline-none focus:border-af-500" />
              </div>
              {opcoes.map(t => (
                <button key={t.id} onClick={() => { abrirChat(t.id); setNovo(false) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-graf-900">
                  <Avatar nome={t.nome} tamanho={26} />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.nome}</span>
                  <span className="text-[11px] text-graf-400">
                    {t.usuario_id ? t.equipe?.codigo ?? '' : 'sem app'}
                  </span>
                </button>
              ))}
            </>) : conversas.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-graf-400">
                Nenhuma conversa ainda. Quando um técnico escrever pelo aplicativo, ela aparece aqui.
              </p>
            ) : conversas.map(c => (
              <button key={c.tecnico_id} onClick={() => abrirChat(c.tecnico_id)}
                aria-current={c.tecnico_id === chatTecnico ? 'true' : undefined}
                className={`flex w-full items-start gap-2.5 border-b border-graf-800/60 px-3 py-2.5 text-left ${
                  c.tecnico_id === chatTecnico ? 'bg-af-600/10' : 'hover:bg-graf-900'}`}>
                <Avatar nome={c.nome} tamanho={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`truncate text-sm ${c.nao_lidas ? 'font-semibold' : ''}`}>{c.nome}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-graf-400">{hora(c.ultima_em)}</span>
                  </div>
                  <p className="truncate text-xs text-graf-400">
                    {c.ultima_do_campo ? '' : 'Você: '}{c.ultima_texto}
                  </p>
                </div>
                {c.nao_lidas > 0 && (
                  <span className="tabular mt-1 rounded-full bg-af-600 px-1.5 text-[10px] font-semibold text-white">
                    {c.nao_lidas}
                  </span>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* ---------- a conversa ---------- */}
        <section className={`min-w-0 flex-1 flex-col ${chatTecnico ? 'flex' : 'hidden sm:flex'}`}>
          <div className="flex items-center gap-2.5 border-b border-graf-800 px-4 py-3">
            {chatTecnico && (
              <button onClick={() => abrirChat(null)} aria-label="Voltar"
                className="text-graf-400 hover:text-graf-100 sm:hidden">‹</button>
            )}
            {atual ? (<>
              <Avatar nome={atual.nome} tamanho={30} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{atual.nome}</p>
                <p className="text-[11px] text-graf-400">
                  {atual.equipe ? `equipe ${atual.equipe}` : 'sem equipe'}
                  {!atual.tem_app && ' · sem login no aplicativo — não vai ler'}
                </p>
              </div>
            </>) : <p className="text-sm text-graf-400">Escolha uma conversa</p>}
            <button onClick={fecharChat} aria-label="Fechar"
              className="ml-auto hidden rounded px-2 py-1 text-graf-400 hover:text-graf-100 sm:block">✕</button>
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
            {chatTecnico && msgs.length === 0 && (
              <p className="py-10 text-center text-sm text-graf-400">
                Nenhuma mensagem com este técnico. A primeira aparece no aplicativo dele, na aba Conversa.
              </p>
            )}
            {msgs.map((m, i) => {
              const doControle = !m.do_campo
              const mostraAutor = doControle && (i === 0 || msgs[i - 1].autor_nome !== m.autor_nome || msgs[i - 1].do_campo)
              return (
                <div key={m.id} className={`flex flex-col ${doControle ? 'items-end' : 'items-start'}`}>
                  {mostraAutor && <span className="mb-0.5 text-[10px] text-graf-400">{m.autor_nome ?? 'Controle'}</span>}
                  <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
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

          {erro && <p className="border-t border-graf-800 px-4 py-2 text-xs text-af-300">{erro}</p>}
          {chatTecnico && (
            <form className="flex items-end gap-2 border-t border-graf-800 p-3"
              onSubmit={e => { e.preventDefault(); enviar() }}>
              <textarea ref={caixa} value={texto} onChange={e => setTexto(e.target.value)}
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
          )}
        </section>
      </div>
    </div>
  )
}
