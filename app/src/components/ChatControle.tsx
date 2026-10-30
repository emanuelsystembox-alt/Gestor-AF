import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCentral } from '../lib/central'
import { useAuth } from '../lib/auth'
import { Avatar } from './ui'
import { GruposChat } from './GruposChat'

/**
 * A caixa de conversas do controle (091, 133).
 *
 * São DUAS conversas diferentes dentro da mesma gaveta, e elas não se
 * misturam por acidente:
 *
 *  · com o TÉCNICO — uma por técnico, compartilhada por todo controlador
 *    que enxerga a equipe dele: a troca de turno não deixa pergunta numa
 *    caixa que ninguém abre;
 *  · com uma PESSOA da gestão (133) — COP, supervisor ou coordenador da
 *    cidade ativa. Essa é PRIVADA: só as duas leem, nem o ADMIN entra
 *    (Emanuel, 25/10). É o espelho do que o técnico já tinha na 132.
 *
 * Cada mensagem leva o nome de quem escreveu — carimbado pelo servidor,
 * nunca pelo cliente (D-061).
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
  /** Para quem o técnico mandou (132): nulo = o controle todo. */
  para_usuario_id?: string | null
  para?: { nome: string } | null
}
/** Uma conversa com uma pessoa da gestão (133). */
interface ConversaInterna {
  usuario_id: string; nome: string; grupo: string | null; cargo: string | null
  ultima_texto: string; ultima_em: string; ultima_minha: boolean; nao_lidas: number
}
interface MsgInterna {
  id: number; de_usuario_id: string; para_usuario_id: string
  texto: string; criado_em: string; lida_em: string | null
}

/** O que a conversa lê: com o destinatário, que o técnico escolhe desde a 132. */
const SELECT_MSG = 'id, do_campo, autor_nome, texto, criado_em, lida_em, para_usuario_id, para:para_usuario_id ( nome )'
const SELECT_INTERNA = 'id, de_usuario_id, para_usuario_id, texto, criado_em, lida_em'
interface TecnicoOpcao { id: string; nome: string; usuario_id: string | null; equipe: { codigo: string } | null }
interface PessoaOpcao { usuario_id: string; nome: string; grupo: string | null; cargo: string | null }

/** Uma linha da caixa de entrada, venha ela de qual conversa vier. */
interface Entrada {
  tipo: 'TECNICO' | 'PESSOA'; id: string; nome: string; abaixo: string
  texto: string; em: string; minha: boolean; nao_lidas: number
}

const hora = (ts: string) => {
  const d = new Date(ts)
  const hoje = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' }
                                        : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ChatControle() {
  const {
    chatAberto, fecharChat, chatTecnico, chatPessoa, abrirChat, abrirChatPessoa,
    ultimaMensagem, ultimaInterna, recarregar, recarregarInternas,
  } = useCentral()
  const eu = useAuth().session?.user.id ?? null
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [internas, setInternas] = useState<ConversaInterna[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [msgsInternas, setMsgsInternas] = useState<MsgInterna[]>([])
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [novo, setNovo] = useState(false)
  const [tecnicos, setTecnicos] = useState<TecnicoOpcao[]>([])
  const [pessoas, setPessoas] = useState<PessoaOpcao[]>([])
  const [busca, setBusca] = useState('')
  const fim = useRef<HTMLDivElement>(null)
  const caixa = useRef<HTMLTextAreaElement>(null)
  const [modoChat, setModoChat] = useState<'CONVERSAS' | 'GRUPOS'>('CONVERSAS')
  const [naoLidasGrupos, setNaoLidasGrupos] = useState(0)

  /** Alguma conversa escolhida? A tela do celular depende disso. */
  const escolhida = chatTecnico ?? chatPessoa

  const atual = conversas.find(c => c.tecnico_id === chatTecnico)
    ?? (chatTecnico ? (() => {
      const t = tecnicos.find(x => x.id === chatTecnico)
      return t ? { tecnico_id: t.id, nome: t.nome, equipe: t.equipe?.codigo ?? null,
                   tem_app: !!t.usuario_id } as Conversa : null
    })() : null)

  const atualPessoa = internas.find(c => c.usuario_id === chatPessoa)
    ?? (chatPessoa ? pessoas.find(p => p.usuario_id === chatPessoa) ?? null : null)

  function carregarConversas() {
    supabase.rpc('conversas_do_controle').then(({ data }) =>
      setConversas((data ?? []) as Conversa[]))
    supabase.rpc('conversas_internas').then(({ data }) =>
      setInternas((data ?? []) as ConversaInterna[]))
  }

  useEffect(() => { if (chatAberto) carregarConversas() }, [chatAberto])

  // As duas listas de "com quem falar" só quando for começar conversa nova.
  useEffect(() => {
    if (!novo) return
    if (!tecnicos.length) {
      supabase.from('tecnico').select('id, nome, usuario_id, equipe:equipe_id ( codigo )')
        .eq('situacao', 'ATIVO').order('nome')
        .then(({ data }) => setTecnicos((data ?? []) as unknown as TecnicoOpcao[]))
    }
    if (!pessoas.length) {
      supabase.rpc('destinatarios_da_gestao')
        .then(({ data }) => setPessoas((data ?? []) as PessoaOpcao[]))
    }
  }, [novo, tecnicos.length, pessoas.length])

  // ---------- a conversa com o TÉCNICO ----------
  useEffect(() => {
    if (!chatAberto || !chatTecnico) { setMsgs([]); return }
    let vivo = true
    setErro(null)
    supabase.from('mensagem').select(SELECT_MSG)
      .eq('tecnico_id', chatTecnico).order('criado_em', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        setMsgs(((data ?? []) as unknown as Msg[]).reverse())
      })
    supabase.rpc('marcar_conversa_lida', { p_tecnico_id: chatTecnico })
      .then(() => { carregarConversas(); recarregar() })
    setTimeout(() => caixa.current?.focus(), 50)
    return () => { vivo = false }
  }, [chatAberto, chatTecnico, recarregar])

  // ---------- a conversa com a PESSOA (133) ----------
  useEffect(() => {
    if (!chatAberto || !chatPessoa) { setMsgsInternas([]); return }
    let vivo = true
    setErro(null)
    // O RLS já limita às minhas conversas; o filtro escolhe QUAL delas.
    supabase.from('mensagem_interna').select(SELECT_INTERNA)
      .or(`de_usuario_id.eq.${chatPessoa},para_usuario_id.eq.${chatPessoa}`)
      .order('criado_em', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        setMsgsInternas(((data ?? []) as MsgInterna[]).reverse())
      })
    supabase.rpc('marcar_interna_lida', { p_de: chatPessoa })
      .then(() => { carregarConversas(); recarregarInternas() })
    setTimeout(() => caixa.current?.focus(), 50)
    return () => { vivo = false }
  }, [chatAberto, chatPessoa, recarregarInternas])

  // O que chega pelo Realtime: entra na conversa aberta, e a lista reordena.
  useEffect(() => {
    if (!ultimaMensagem || !chatAberto) return
    if (ultimaMensagem.tecnico_id === chatTecnico) {
      setMsgs(l => l.some(m => m.id === ultimaMensagem.id) ? l : [...l, ultimaMensagem])
      if (ultimaMensagem.do_campo) supabase.rpc('marcar_conversa_lida', { p_tecnico_id: chatTecnico })
    }
    carregarConversas()
  }, [ultimaMensagem, chatAberto, chatTecnico])

  useEffect(() => {
    if (!ultimaInterna || !chatAberto) return
    const daConversa = ultimaInterna.de_usuario_id === chatPessoa
      || ultimaInterna.para_usuario_id === chatPessoa
    if (daConversa) {
      setMsgsInternas(l => l.some(m => m.id === ultimaInterna.id) ? l : [...l, ultimaInterna])
      if (ultimaInterna.de_usuario_id === chatPessoa) {
        supabase.rpc('marcar_interna_lida', { p_de: chatPessoa })
      }
    }
    carregarConversas()
  }, [ultimaInterna, chatAberto, chatPessoa])

  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }) }, [msgs, msgsInternas])

  useEffect(() => {
    if (!chatAberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharChat() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [chatAberto, fecharChat])

  /** A caixa de entrada: as duas conversas na mesma lista, pela hora. */
  const entradas = useMemo<Entrada[]>(() => {
    const a: Entrada[] = conversas.map(c => ({
      tipo: 'TECNICO', id: c.tecnico_id, nome: c.nome,
      abaixo: c.equipe ? `equipe ${c.equipe}` : 'sem equipe',
      texto: c.ultima_texto, em: c.ultima_em, minha: !c.ultima_do_campo,
      nao_lidas: Number(c.nao_lidas),
    }))
    const b: Entrada[] = internas.map(c => ({
      tipo: 'PESSOA', id: c.usuario_id, nome: c.nome,
      abaixo: (c.cargo ?? c.grupo ?? 'gestão').toLowerCase(),
      texto: c.ultima_texto, em: c.ultima_em, minha: c.ultima_minha,
      nao_lidas: Number(c.nao_lidas),
    }))
    return [...a, ...b].sort((x, y) => y.em.localeCompare(x.em))
  }, [conversas, internas])

  const opcoes = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return tecnicos.filter(t => !q || t.nome.toLowerCase().includes(q)
      || (t.equipe?.codigo ?? '').includes(q)).slice(0, 30)
  }, [tecnicos, busca])

  const opcoesPessoas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return pessoas.filter(p => !q || p.nome.toLowerCase().includes(q)
      || (p.cargo ?? '').toLowerCase().includes(q)
      || (p.grupo ?? '').toLowerCase().includes(q))
  }, [pessoas, busca])

  async function enviar() {
    const t = texto.trim()
    if (!t || !escolhida || enviando) return
    setEnviando(true); setErro(null)
    const { error } = chatPessoa
      ? await supabase.rpc('enviar_mensagem_interna', { p_para: chatPessoa, p_texto: t })
      : await supabase.rpc('enviar_mensagem', { p_tecnico_id: chatTecnico, p_texto: t })
    setEnviando(false)
    // Falhou: o texto FICA na caixa. Perder o que foi digitado é pior
    // que o erro.
    if (error) { setErro(error.message); return }
    setTexto('')
    if (chatPessoa) {
      const { data } = await supabase.from('mensagem_interna').select(SELECT_INTERNA)
        .or(`de_usuario_id.eq.${chatPessoa},para_usuario_id.eq.${chatPessoa}`)
        .order('criado_em', { ascending: false }).limit(200)
      setMsgsInternas(((data ?? []) as MsgInterna[]).reverse())
      recarregarInternas()
    } else {
      const { data } = await supabase.from('mensagem')
        .select(SELECT_MSG)
        .eq('tecnico_id', chatTecnico).order('criado_em', { ascending: false }).limit(200)
      setMsgs(((data ?? []) as unknown as Msg[]).reverse())
    }
    carregarConversas()
  }

  if (!chatAberto) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Conversas">
      <div className="absolute inset-0 bg-black/40" onClick={fecharChat} />
      <div className="sup-controle absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l
                      border-graf-800 bg-graf-950 shadow-2xl">
        {/* 156g: duas chaves no topo. Os GRUPOS (todos os membros escrevem)
            não se misturam com as conversas a dois -- cada um é uma caixa. */}
        <div className="flex shrink-0 gap-1 border-b border-graf-800 px-2 pt-2">
          {([['CONVERSAS', 'Conversas'], ['GRUPOS', 'Grupos']] as const).map(([k, r]) => (
            <button key={k} onClick={() => setModoChat(k)} aria-pressed={modoChat === k}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm transition ${
                modoChat === k ? 'border-af-500 font-medium text-graf-100'
                               : 'border-transparent text-graf-400 hover:text-graf-200'}`}>
              {r}
              {k === 'GRUPOS' && naoLidasGrupos > 0 && (
                <span className="tabular rounded-full bg-af-600 px-1.5 text-[10px] font-bold text-white">
                  {naoLidasGrupos}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1">
        {modoChat === 'GRUPOS' ? (
          <GruposChat fechar={fecharChat} aoMudarNaoLidas={setNaoLidasGrupos} />
        ) : (<>
        {/* ---------- a caixa de entrada ---------- */}
        <aside className={`flex w-full flex-col border-r border-graf-800 sm:w-72 ${
          escolhida ? 'hidden sm:flex' : 'flex'}`}>
          <div className="flex items-center justify-between border-b border-graf-800 px-3 py-3">
            <h2 className="text-sm font-semibold">Conversas</h2>
            <button onClick={fecharChat} aria-label="Fechar"
              className="rounded px-2 text-graf-400 hover:text-graf-100 sm:hidden">✕</button>
          </div>
          <div className="border-b border-graf-800 p-2">
            <button onClick={() => setNovo(n => !n)}
              className="w-full rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-300">
              {novo ? 'Voltar às conversas' : '+ Nova conversa'}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {novo ? (<>
              <div className="p-2">
                <input value={busca} onChange={e => setBusca(e.target.value)} autoFocus
                  placeholder="Buscar pessoa, técnico ou equipe…" aria-label="Buscar com quem falar"
                  className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs
                             outline-none focus:border-af-500" />
              </div>

              {/* 133: as pessoas vêm primeiro porque são poucas — e porque
                  é o que esta tela ganhou de novo. */}
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-graf-500">
                Pessoas
              </p>
              {opcoesPessoas.length === 0 ? (
                <p className="px-3 pb-2 text-[11px] text-graf-500">
                  {busca.trim()
                    ? 'Ninguém com esse nome nesta cidade.'
                    : 'Ninguém cadastrado como COP, supervisor ou coordenador nesta cidade ainda.'}
                </p>
              ) : opcoesPessoas.map(p => (
                <button key={p.usuario_id} onClick={() => { abrirChatPessoa(p.usuario_id); setNovo(false) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-graf-900">
                  <Avatar nome={p.nome} tamanho={26} />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.nome}</span>
                  <span className="text-[11px] text-graf-400">
                    {(p.cargo ?? p.grupo ?? '').toLowerCase()}
                  </span>
                </button>
              ))}

              <p className="border-t border-graf-800/60 px-3 pb-1 pt-3 text-[10px] font-semibold
                            uppercase tracking-wide text-graf-500">
                Técnicos
              </p>
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
            </>) : entradas.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-graf-400">
                Nenhuma conversa ainda. Quando um técnico escrever pelo aplicativo, ela aparece
                aqui — ou comece uma em “Nova conversa”.
              </p>
            ) : entradas.map(c => {
              const selecionada = c.tipo === 'TECNICO'
                ? c.id === chatTecnico : c.id === chatPessoa
              return (
                <button key={`${c.tipo}:${c.id}`}
                  onClick={() => c.tipo === 'TECNICO' ? abrirChat(c.id) : abrirChatPessoa(c.id)}
                  aria-current={selecionada ? 'true' : undefined}
                  className={`flex w-full items-start gap-2.5 border-b border-graf-800/60 px-3 py-2.5 text-left ${
                    selecionada ? 'bg-af-600/10' : 'hover:bg-graf-900'}`}>
                  <Avatar nome={c.nome} tamanho={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={`truncate text-sm ${c.nao_lidas ? 'font-semibold' : ''}`}>{c.nome}</span>
                      {c.tipo === 'PESSOA' && (
                        <span title="Conversa entre vocês dois — ninguém mais lê"
                          className="shrink-0 rounded bg-graf-800 px-1 text-[9px] font-semibold
                                     uppercase text-graf-300">pessoa</span>
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-graf-400">{hora(c.em)}</span>
                    </div>
                    <p className="truncate text-xs text-graf-400">
                      {c.minha ? 'Você: ' : ''}{c.texto}
                    </p>
                  </div>
                  {c.nao_lidas > 0 && (
                    <span className="tabular mt-1 rounded-full bg-af-600 px-1.5 text-[10px] font-semibold text-white">
                      {c.nao_lidas}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </aside>

        {/* ---------- a conversa ---------- */}
        <section className={`min-w-0 flex-1 flex-col ${escolhida ? 'flex' : 'hidden sm:flex'}`}>
          <div className="flex items-center gap-2.5 border-b border-graf-800 px-4 py-3">
            {escolhida && (
              <button onClick={() => chatPessoa ? abrirChatPessoa(null) : abrirChat(null)}
                aria-label="Voltar"
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
            </>) : atualPessoa ? (<>
              <Avatar nome={atualPessoa.nome} tamanho={30} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{atualPessoa.nome}</p>
                <p className="text-[11px] text-graf-400">
                  {(atualPessoa.cargo ?? atualPessoa.grupo ?? 'gestão').toLowerCase()}
                  {' · '}conversa entre vocês dois
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
            {chatPessoa && msgsInternas.length === 0 && (
              <p className="py-10 text-center text-sm text-graf-400">
                Nenhuma mensagem com esta pessoa ainda. Só vocês dois leem esta conversa.
              </p>
            )}

            {chatTecnico && msgs.map((m, i) => {
              const doControle = !m.do_campo
              const mostraAutor = doControle && (i === 0 || msgs[i - 1].autor_nome !== m.autor_nome || msgs[i - 1].do_campo)
              return (
                <div key={m.id} className={`flex flex-col ${doControle ? 'items-end' : 'items-start'}`}>
                  {mostraAutor && <span className="mb-0.5 text-[10px] text-graf-400">{m.autor_nome ?? 'Controle'}</span>}
                  {/* 132: o técnico direcionou a mensagem a uma pessoa. */}
                  {m.do_campo && m.para_usuario_id && (
                    m.para_usuario_id === eu
                      ? <span className="mb-0.5 rounded bg-af-600 px-1.5 text-[10px] font-semibold text-white">para você</span>
                      : <span className="mb-0.5 text-[10px] text-amber-300">para {m.para?.nome ?? 'outra pessoa da gestão'}</span>
                  )}
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

            {chatPessoa && msgsInternas.map(m => {
              const minha = m.de_usuario_id === eu
              return (
                <div key={m.id} className={`flex flex-col ${minha ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                    minha ? 'rounded-br-md bg-af-600 text-white'
                          : 'rounded-bl-md border border-graf-700 bg-graf-900 text-graf-100'}`}>
                    {m.texto}
                  </div>
                  <span className="mt-0.5 text-[10px] text-graf-400">
                    {hora(m.criado_em)}{minha ? (m.lida_em ? ' · lida' : ' · não lida') : ''}
                  </span>
                </div>
              )
            })}
            <div ref={fim} />
          </div>

          {erro && <p className="border-t border-graf-800 px-4 py-2 text-xs text-af-300">{erro}</p>}
          {escolhida && (
            <form className="flex items-end gap-2 border-t border-graf-800 p-3"
              onSubmit={e => { e.preventDefault(); enviar() }}>
              <textarea ref={caixa} value={texto} onChange={e => setTexto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
                rows={2} maxLength={2000} placeholder="Escreva… (Enter envia, Shift+Enter quebra a linha)"
                aria-label={chatPessoa ? 'Mensagem para a pessoa' : 'Mensagem para o técnico'}
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
        </>)}
        </div>
      </div>
    </div>
  )
}
