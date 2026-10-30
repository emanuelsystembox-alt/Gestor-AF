import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Avatar } from './ui'

/**
 * Os GRUPOS do chat (156g).
 *
 * > "o coordenador consiga criar grupos dentro do chat, para falar com o
 * >  COP ou deixar todos os técnicos ali reunidos, sendo assim evitando o
 * >  uso do WhatsApp" — Emanuel, 30/10
 *
 * Todos os membros escrevem (decisão dele, 30/10). O grupo é da cidade
 * ativa — trocar de cidade no topo mostra os grupos da outra. Quem lê é
 * só quem é membro: nem o ADMIN abre grupo do qual não participa.
 *
 * O Realtime traz a mensagem nova; a linha é a verdade (D-119): abrir o
 * grupo relê tudo, e o canal sai no cleanup (canal pendurado é conexão
 * do teto do plano).
 */

interface Grupo {
  grupo_id: string; nome: string; membros: number
  ultima_texto: string | null; ultima_em: string; ultima_autor: string | null
  ultima_minha: boolean | null; nao_lidas: number; posso_gerir: boolean
}
interface MsgGrupo { id: number; usuario_id: string; autor_nome: string | null; texto: string; criado_em: string }
interface Pessoa { usuario_id: string; nome: string; tipo: 'GESTAO' | 'TECNICO'; equipe: string | null }

const hora = (ts: string) => {
  const d = new Date(ts)
  const hoje = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' }
                                        : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function GruposChat({ fechar, aoMudarNaoLidas }: {
  fechar: () => void
  /** Para a gaveta mostrar o número na chave "Grupos". */
  aoMudarNaoLidas?: (n: number) => void
}) {
  const eu = useAuth().session?.user.id ?? null
  const { pode, temPapel } = useAuth()
  const possoCriar = temPapel('ADMIN', 'COP') || pode('chat.grupos')
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [aberto, setAberto] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<MsgGrupo[]>([])
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // criar / gerir
  const [modo, setModo] = useState<'LISTA' | 'NOVO' | 'MEMBROS'>('LISTA')
  const [candidatos, setCandidatos] = useState<Pessoa[]>([])
  const [membros, setMembros] = useState<Pessoa[]>([])
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [nome, setNome] = useState('')
  const [busca, setBusca] = useState('')
  const fim = useRef<HTMLDivElement>(null)

  const carregarGrupos = useCallback(() => {
    supabase.rpc('grupos_do_chat').then(({ data }) => {
      const g = (data ?? []) as Grupo[]
      setGrupos(g)
      aoMudarNaoLidas?.(g.reduce((s, x) => s + x.nao_lidas, 0))
    })
  }, [aoMudarNaoLidas])

  useEffect(() => { carregarGrupos() }, [carregarGrupos])

  // ---------- o grupo aberto ----------
  useEffect(() => {
    if (!aberto) { setMsgs([]); return }
    let vivo = true
    setErro(null)
    supabase.from('grupo_mensagem').select('id, usuario_id, autor_nome, texto, criado_em')
      .eq('grupo_id', aberto).order('criado_em', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        setMsgs(((data ?? []) as MsgGrupo[]).reverse())
      })
    supabase.rpc('marcar_grupo_lido', { p_grupo: aberto }).then(() => carregarGrupos())

    const canal = supabase.channel(`grupo:${aberto}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'grupo_mensagem', filter: `grupo_id=eq.${aberto}` },
        p => {
          const m = p.new as MsgGrupo
          setMsgs(ms => ms.some(x => x.id === m.id) ? ms : [...ms, m])
          supabase.rpc('marcar_grupo_lido', { p_grupo: aberto })
        })
      .subscribe()
    return () => { vivo = false; supabase.removeChannel(canal) }
  }, [aberto, carregarGrupos])

  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  async function enviar() {
    if (!aberto || !texto.trim()) return
    setEnviando(true); setErro(null)
    const { error } = await supabase.rpc('enviar_ao_grupo', { p_grupo: aberto, p_texto: texto })
    setEnviando(false)
    if (error) { setErro(error.message); return }
    setTexto('')
    // O Realtime traz a mensagem; se o canal falhar, a releitura garante.
    const { data } = await supabase.from('grupo_mensagem').select('id, usuario_id, autor_nome, texto, criado_em')
      .eq('grupo_id', aberto).order('criado_em', { ascending: false }).limit(200)
    setMsgs(((data ?? []) as MsgGrupo[]).reverse())
    carregarGrupos()
  }

  // ---------- criar e gerir ----------
  async function abrirNovo() {
    setModo('NOVO'); setNome(''); setMarcados(new Set()); setBusca(''); setErro(null)
    const { data } = await supabase.rpc('candidatos_do_grupo')
    setCandidatos(((data ?? []) as Pessoa[]).filter(p => p.usuario_id !== eu))
  }
  async function abrirMembros() {
    if (!aberto) return
    setModo('MEMBROS'); setBusca(''); setErro(null)
    const [c, m] = await Promise.all([
      supabase.rpc('candidatos_do_grupo'),
      supabase.rpc('membros_do_grupo', { p_grupo: aberto }),
    ])
    setCandidatos(((c.data ?? []) as Pessoa[]))
    const ms = (m.data ?? []) as Pessoa[]
    setMembros(ms)
    setMarcados(new Set(ms.map(x => x.usuario_id)))
  }
  async function criar() {
    setErro(null)
    const { data, error } = await supabase.rpc('criar_grupo_chat', { p_nome: nome, p_membros: [...marcados] })
    if (error) { setErro(error.message); return }
    setModo('LISTA'); carregarGrupos(); setAberto(data as string)
  }
  async function salvarMembros() {
    if (!aberto) return
    const antes = new Set(membros.map(m => m.usuario_id))
    const entram = [...marcados].filter(id => !antes.has(id))
    const saem = [...antes].filter(id => !marcados.has(id) && id !== eu)
    const { error } = await supabase.rpc('mudar_membros_do_grupo',
      { p_grupo: aberto, p_entram: entram, p_saem: saem })
    if (error) { setErro(error.message); return }
    setModo('LISTA'); carregarGrupos()
  }

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return q ? candidatos.filter(c => c.nome.toLowerCase().includes(q) || (c.equipe ?? '').includes(q)) : candidatos
  }, [candidatos, busca])
  const alternar = (id: string) => setMarcados(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n
  })
  const todosTecnicos = () => setMarcados(s => {
    const n = new Set(s); for (const c of candidatos) if (c.tipo === 'TECNICO') n.add(c.usuario_id); return n
  })

  const grupoAtual = grupos.find(g => g.grupo_id === aberto) ?? null

  // ---------- a escolha de pessoas (novo grupo e membros) ----------
  const escolha = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-graf-800 p-3">
        {modo === 'NOVO' && (
          <input value={nome} onChange={e => setNome(e.target.value)} maxLength={60} autoFocus
            placeholder="Nome do grupo (ex.: VT São Luís, COP da manhã)"
            className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm outline-none focus:border-af-500" />
        )}
        <div className="flex gap-2">
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar pessoa ou equipe…"
            className="min-w-0 flex-1 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs outline-none focus:border-af-500" />
          <button onClick={todosTecnicos}
            className="shrink-0 rounded-md border border-graf-700 px-2 py-1 text-[11px] text-graf-300 hover:border-af-600">
            + todos os técnicos
          </button>
        </div>
        <p className="text-[11px] text-graf-400">
          <strong className="text-graf-200">{marcados.size}</strong> marcado(s). Só aparece quem é desta
          cidade; técnico sem login não entra (não tem como ler).
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(['GESTAO', 'TECNICO'] as const).map(tipo => {
          const lista = filtrados.filter(c => c.tipo === tipo)
          if (!lista.length) return null
          return (
            <div key={tipo}>
              <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-graf-500">
                {tipo === 'GESTAO' ? 'Gestão' : 'Técnicos'}
              </p>
              {lista.map(c => (
                <label key={c.usuario_id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-graf-900">
                  <input type="checkbox" checked={marcados.has(c.usuario_id)} disabled={c.usuario_id === eu}
                    onChange={() => alternar(c.usuario_id)} className="accent-af-600" />
                  <Avatar nome={c.nome} tamanho={22} />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.nome}</span>
                  {c.equipe && <span className="text-[11px] text-graf-400">{c.equipe}</span>}
                </label>
              ))}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-graf-800 p-3">
        {erro && <span className="min-w-0 flex-1 truncate text-xs text-af-400">{erro}</span>}
        <button onClick={() => setModo('LISTA')}
          className="ml-auto rounded-md px-3 py-1.5 text-xs text-graf-400 hover:text-graf-200">Cancelar</button>
        {modo === 'NOVO' ? (
          <button onClick={criar} disabled={!nome.trim()}
            className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-af-500 disabled:opacity-50">
            Criar grupo
          </button>
        ) : (
          <button onClick={salvarMembros}
            className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-af-500">
            Salvar membros
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {/* ---------- a lista de grupos ---------- */}
      <aside className={`flex w-full flex-col border-r border-graf-800 sm:w-72 ${
        aberto || modo !== 'LISTA' ? 'hidden sm:flex' : 'flex'}`}>
        {possoCriar && (
          <div className="border-b border-graf-800 p-2">
            <button onClick={abrirNovo}
              className="w-full rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-300">
              + Novo grupo
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {grupos.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-graf-400">
              {possoCriar
                ? 'Nenhum grupo nesta cidade ainda. Crie um para reunir COP, supervisores e técnicos — sem WhatsApp.'
                : 'Você ainda não está em nenhum grupo desta cidade.'}
            </p>
          ) : grupos.map(g => (
            <button key={g.grupo_id} onClick={() => { setAberto(g.grupo_id); setModo('LISTA') }}
              aria-current={g.grupo_id === aberto ? 'true' : undefined}
              className={`flex w-full items-start gap-2 border-b border-graf-800/60 px-3 py-2.5 text-left
                          hover:bg-graf-900 ${g.grupo_id === aberto ? 'bg-graf-900' : ''}`}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-af-900/50 text-xs font-bold text-af-300">
                {g.nome.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-graf-100">{g.nome}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-graf-500">{hora(g.ultima_em)}</span>
                </span>
                <span className="block truncate text-[11px] text-graf-400">
                  {g.ultima_texto
                    ? `${g.ultima_minha ? 'Você' : g.ultima_autor ?? '—'}: ${g.ultima_texto}`
                    : `${g.membros} membro(s) — nenhuma mensagem ainda`}
                </span>
              </span>
              {g.nao_lidas > 0 && (
                <span className="tabular rounded-full bg-af-600 px-1.5 text-[10px] font-bold text-white">{g.nao_lidas}</span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* ---------- o grupo, ou a escolha de pessoas ---------- */}
      <section className={`min-w-0 flex-1 flex-col ${aberto || modo !== 'LISTA' ? 'flex' : 'hidden sm:flex'}`}>
        <div className="flex items-center gap-2 border-b border-graf-800 px-3 py-3">
          <button onClick={() => { setAberto(null); setModo('LISTA') }} aria-label="Voltar aos grupos"
            className="rounded px-1.5 text-graf-400 hover:text-graf-100 sm:hidden">‹</button>
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {modo === 'NOVO' ? 'Novo grupo'
              : modo === 'MEMBROS' ? `Membros de ${grupoAtual?.nome ?? ''}`
              : grupoAtual ? grupoAtual.nome : 'Grupos'}
            {modo === 'LISTA' && grupoAtual && (
              <span className="ml-2 text-[11px] font-normal text-graf-400">{grupoAtual.membros} membro(s)</span>
            )}
          </h3>
          {modo === 'LISTA' && grupoAtual?.posso_gerir && (
            <button onClick={abrirMembros}
              className="rounded-md border border-graf-700 px-2 py-1 text-[11px] text-graf-300 hover:border-af-600">
              Membros
            </button>
          )}
          <button onClick={fechar} aria-label="Fechar" className="rounded px-2 text-graf-400 hover:text-graf-100">✕</button>
        </div>

        {modo !== 'LISTA' ? escolha : !aberto ? (
          <p className="m-auto px-6 text-center text-sm text-graf-400">Escolha um grupo à esquerda.</p>
        ) : (<>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.length === 0 && (
              <p className="py-8 text-center text-sm text-graf-400">Nenhuma mensagem. Comece a conversa.</p>
            )}
            {msgs.map(m => {
              const minha = m.usuario_id === eu
              return (
                <div key={m.id} className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                    minha ? 'bg-af-700/40 text-graf-100' : 'bg-graf-900 text-graf-100'}`}>
                    {!minha && <p className="text-[10px] font-semibold text-sky-300">{m.autor_nome ?? '—'}</p>}
                    <p className="whitespace-pre-wrap">{m.texto}</p>
                    <p className="mt-0.5 text-right text-[10px] text-graf-500">{hora(m.criado_em)}</p>
                  </div>
                </div>
              )
            })}
            <div ref={fim} />
          </div>
          <div className="border-t border-graf-800 p-2">
            {erro && <p className="mb-1 text-xs text-af-400">{erro}</p>}
            <div className="flex gap-2">
              <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} maxLength={2000}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
                placeholder="Escreva para o grupo… (Enter envia)"
                className="min-w-0 flex-1 resize-none rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5
                           text-sm outline-none focus:border-af-500" />
              <button onClick={enviar} disabled={enviando || !texto.trim()}
                className="self-end rounded-md bg-af-600 px-4 py-2 text-xs font-medium text-white hover:bg-af-500 disabled:opacity-50">
                Enviar
              </button>
            </div>
          </div>
        </>)}
      </section>
    </>
  )
}
