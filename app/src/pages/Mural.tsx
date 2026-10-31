import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Shell } from '../components/Shell'
import { Alerta, Esqueleto } from '../components/ui'

/**
 * Mural Nexus — o canal da empresa com quem usa o sistema (163).
 *
 * > "crie um canal de comunicação dentro do site (...) um slide passando
 * >  uma imagem e embaixo vai ter descrições (...) campanhas da empresa,
 * >  ganhadores de cidades, ganhadores de prêmios, semana de segurança,
 * >  setembro amarelo (...) somente o admin poderá enviar conteúdos para
 * >  este local. Todo o restante do time poderá visualizar"
 * >  — Emanuel, 31/10
 *
 * Quem barra a escrita é o banco (policies de `mural_post` e do bucket
 * `mural`, 163): a tela só não oferece o formulário a quem não é ADMIN.
 * O bucket é privado — a imagem sai por URL assinada, como a evidência.
 */

interface Post {
  id: string
  titulo: string
  texto: string | null
  imagem_path: string
  ordem: number
  ativo: boolean
  criado_em: string
  autor: { nome: string } | null
}

/** Quanto tempo cada imagem fica no slide. */
const INTERVALO_MS = 7000
const TAMANHO_MAX = 5 * 1024 * 1024
const TIPOS = ['image/jpeg', 'image/png', 'image/webp']

const dataBr = (s: string) => new Date(s).toLocaleDateString('pt-BR')

export default function Mural() {
  const { temPapel, perfil } = useAuth()
  const admin = temPapel('ADMIN')
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    setErro(null)
    supabase.from('mural_post')
      .select('id, titulo, texto, imagem_path, ordem, ativo, criado_em, autor:criado_por ( nome )')
      .order('ordem').order('criado_em', { ascending: false })
      .then(async ({ data, error }) => {
        if (!vivo) return
        if (error) { setErro(error.message); setPosts([]); return }
        const lista = (data ?? []) as unknown as Post[]
        setPosts(lista)
        if (!lista.length) return
        // O lote inteiro assinado numa ida só (bucket privado).
        const { data: assinadas } = await supabase.storage.from('mural')
          .createSignedUrls(lista.map(p => p.imagem_path), 3600)
        if (!vivo || !assinadas) return
        const m: Record<string, string> = {}
        for (const u of assinadas) if (u.path && u.signedUrl) m[u.path] = u.signedUrl
        setUrls(m)
      })
    return () => { vivo = false }
  }, [versao])

  // O slide mostra só o que está no ar; o admin vê os desligados na lista.
  const noAr = useMemo(() => (posts ?? []).filter(p => p.ativo), [posts])

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Mural Nexus</h1>
          <p className="mt-1 text-sm text-graf-400">
            Campanhas, premiações e recados da AFLINE para o time.
          </p>
        </div>

        {erro && <Alerta tipo="erro">Não consegui carregar o mural: {erro}</Alerta>}

        {posts === null ? (
          <section className="card-controle overflow-hidden">
            <div className="esqueleto aspect-[16/9] w-full rounded-none" />
            <Esqueleto linhas={3} className="p-5" />
          </section>
        ) : noAr.length === 0 ? (
          <section className="card-controle px-6 py-14 text-center">
            <p className="font-medium">Nada no mural ainda.</p>
            <p className="mt-1 text-sm text-graf-400">
              {admin ? 'Publique a primeira imagem logo abaixo.'
                     : 'Quando a AFLINE publicar uma campanha ou um recado, ele aparece aqui.'}
            </p>
          </section>
        ) : (
          <Carrossel posts={noAr} urls={urls} />
        )}

        {admin && perfil && (
          <GestaoDoMural posts={posts ?? []} urls={urls} perfilId={perfil.id}
            aoMudar={() => setVersao(v => v + 1)} />
        )}
      </div>
    </Shell>
  )
}

// ------------------------------------------------------------------ slide

/**
 * As imagens passam sozinhas a cada 7 s; param enquanto o mouse está em
 * cima ou o foco está dentro (quem está lendo o texto não perde a frase).
 * Setas, bolinhas e as teclas ← → trocam à mão. As imagens ficam
 * empilhadas e trocam por opacidade — sem salto de altura entre uma e
 * outra (a caixa tem proporção fixa, e a imagem se ajusta dentro dela).
 */
function Carrossel({ posts, urls }: { posts: Post[]; urls: Record<string, string> }) {
  const [i, setI] = useState(0)
  const [pausado, setPausado] = useState(false)
  const n = posts.length
  const atual = posts[Math.min(i, n - 1)]

  const ir = useCallback((d: number) => setI(x => (x + d + n) % n), [n])

  useEffect(() => { if (i >= n) setI(0) }, [i, n])
  useEffect(() => {
    if (pausado || n < 2) return
    const t = window.setTimeout(() => ir(1), INTERVALO_MS)
    return () => clearTimeout(t)
  }, [i, pausado, n, ir])

  const caixa = useRef<HTMLElement>(null)
  return (
    <section ref={caixa} className="card-controle overflow-hidden"
      aria-roledescription="carrossel" aria-label="Mural Nexus"
      onMouseEnter={() => setPausado(true)} onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={e => { if (!caixa.current?.contains(e.relatedTarget as Node)) setPausado(false) }}
      onKeyDown={e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); ir(1) }
        if (e.key === 'ArrowLeft') { e.preventDefault(); ir(-1) }
      }}
      tabIndex={0}>
      <div className="relative aspect-[16/9] w-full bg-graf-900">
        {posts.map((p, k) => (
          urls[p.imagem_path] ? (
            <img key={p.id} src={urls[p.imagem_path]} alt={p.titulo}
              aria-hidden={k !== i}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-700
                          ${k === i ? 'opacity-100' : 'opacity-0'}`} />
          ) : k === i ? (
            <div key={p.id} className="esqueleto absolute inset-0 rounded-none" />
          ) : null
        ))}

        {n > 1 && (<>
          <button onClick={() => ir(-1)} aria-label="Imagem anterior"
            className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center
                       rounded-full bg-black/45 text-xl text-white hover:bg-black/65">‹</button>
          <button onClick={() => ir(1)} aria-label="Próxima imagem"
            className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center
                       rounded-full bg-black/45 text-xl text-white hover:bg-black/65">›</button>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {posts.map((p, k) => (
              <button key={p.id} onClick={() => setI(k)}
                aria-label={`Ir para ${k + 1} de ${n}: ${p.titulo}`} aria-current={k === i}
                className={`h-2 rounded-full transition-all ${
                  k === i ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'}`} />
            ))}
          </div>
        </>)}
      </div>

      {/* Os dizeres embaixo. `key` refaz o fade a cada troca. */}
      <div key={atual.id} className="aparece px-5 py-4" aria-live="polite">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">{atual.titulo}</h2>
          <span className="tabular text-xs text-graf-400">
            {dataBr(atual.criado_em)}{n > 1 && ` · ${i + 1} de ${n}`}
          </span>
        </div>
        {atual.texto && (
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-graf-200">{atual.texto}</p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- gestão

/**
 * Só para ADMIN. Publicar = subir a imagem e depois gravar a linha; se a
 * linha falhar, a imagem é apagada (senão sobra arquivo órfão). Tirar =
 * apagar a linha e depois a imagem: se só a imagem sumisse, o slide
 * mostraria um quadro vazio.
 */
function GestaoDoMural({ posts, urls, perfilId, aoMudar }: {
  posts: Post[]; urls: Record<string, string>; perfilId: string; aoMudar: () => void
}) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const previa = useMemo(() => (arquivo ? URL.createObjectURL(arquivo) : null), [arquivo])
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa) }, [previa])

  function escolher(f: File | null) {
    setErro(null); setOk(null)
    if (!f) { setArquivo(null); return }
    if (!TIPOS.includes(f.type)) { setErro('A imagem tem de ser JPG, PNG ou WEBP.'); return }
    if (f.size > TAMANHO_MAX) { setErro('A imagem passa de 5 MB. Reduza e tente de novo.'); return }
    setArquivo(f)
  }

  async function publicar() {
    if (!arquivo || !titulo.trim()) return
    setOcupado(true); setErro(null); setOk(null)
    try {
      // A pasta é a empresa: é o que a policy do bucket confere.
      const { data: eu, error: e0 } = await supabase.from('perfil')
        .select('empresa_id').eq('id', perfilId).single()
      if (e0 || !eu?.empresa_id) throw new Error(e0?.message ?? 'Sem empresa no cadastro.')
      const ext = arquivo.type === 'image/png' ? 'png' : arquivo.type === 'image/webp' ? 'webp' : 'jpg'
      const caminho = `${eu.empresa_id}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('mural').upload(caminho, arquivo, { contentType: arquivo.type })
      if (up.error) throw new Error(up.error.message)
      // Novo entra na frente: ordem menor que a menor de hoje.
      const ordem = posts.length ? Math.min(...posts.map(p => p.ordem)) - 1 : 0
      const { error } = await supabase.from('mural_post').insert({
        titulo: titulo.trim(), texto: texto.trim() || null, imagem_path: caminho, ordem,
      })
      if (error) {
        await supabase.storage.from('mural').remove([caminho])
        throw new Error(error.message)
      }
      setArquivo(null); setTitulo(''); setTexto('')
      if (entrada.current) entrada.current.value = ''
      setOk('Publicado no mural — o time já vê.')
      aoMudar()
    } catch (e) {
      setErro((e as Error).message)
    }
    setOcupado(false)
  }

  async function mudar(p: Post, campos: Partial<Pick<Post, 'titulo' | 'texto' | 'ordem' | 'ativo'>>) {
    setErro(null); setOk(null)
    const { error } = await supabase.from('mural_post').update(campos).eq('id', p.id)
    if (error) { setErro(error.message); return false }
    aoMudar()
    return true
  }

  /** Sobe ou desce um lugar: troca a ordem com o vizinho. */
  async function mover(k: number, d: -1 | 1) {
    const a = posts[k], b = posts[k + d]
    if (!a || !b) return
    // Ordens iguais não trocam nada: usa a posição como ordem.
    const oa = a.ordem === b.ordem ? k : a.ordem
    const ob = a.ordem === b.ordem ? k + d : b.ordem
    setErro(null)
    const r = await Promise.all([
      supabase.from('mural_post').update({ ordem: ob }).eq('id', a.id),
      supabase.from('mural_post').update({ ordem: oa }).eq('id', b.id),
    ])
    const falha = r.find(x => x.error)
    if (falha?.error) setErro(falha.error.message)
    aoMudar()
  }

  async function tirar(p: Post) {
    if (!window.confirm(`Tirar "${p.titulo}" do mural? A imagem é apagada.`)) return
    setErro(null); setOk(null)
    const { error } = await supabase.from('mural_post').delete().eq('id', p.id)
    if (error) { setErro(error.message); return }
    await supabase.storage.from('mural').remove([p.imagem_path])
    setOk('Tirado do mural.')
    aoMudar()
  }

  const campo = 'w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm outline-none focus:border-af-500'

  return (
    <section className="card-controle space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Publicar no mural</h2>
        <p className="mt-0.5 text-xs text-graf-400">
          Só o administrador vê esta parte. Imagem JPG, PNG ou WEBP de até 5 MB — de preferência
          deitada (16:9), que é o formato do slide.
        </p>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <label className="flex aspect-[16/9] cursor-pointer items-center justify-center overflow-hidden
                          rounded-lg border border-dashed border-graf-600 bg-graf-900 text-center
                          text-xs text-graf-400 hover:border-af-600">
          {previa
            ? <img src={previa} alt="Prévia" className="h-full w-full object-contain" />
            : <span className="px-3">Clique para escolher a imagem</span>}
          <input ref={entrada} type="file" accept={TIPOS.join(',')} className="sr-only"
            onChange={e => escolher(e.target.files?.[0] ?? null)} />
        </label>
        <div className="space-y-2">
          <label className="block text-xs text-graf-400">
            <span className="mb-1 block">Título</span>
            <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={120}
              placeholder="Ex.: Setembro Amarelo — cuidar de quem cuida" className={campo} />
          </label>
          <label className="block text-xs text-graf-400">
            <span className="mb-1 block">Dizeres (aparecem embaixo da imagem)</span>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} maxLength={2000} rows={4}
              placeholder="Ex.: Parabéns à equipe de São Luís, campeã de outubro!" className={campo} />
          </label>
          <button onClick={publicar} disabled={ocupado || !arquivo || !titulo.trim()}
            className="rounded-md bg-af-600 px-4 py-1.5 text-sm font-semibold text-white
                       hover:bg-af-500 disabled:opacity-40">
            {ocupado ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      </div>

      {posts.length > 0 && (
        <div className="border-t border-graf-800 pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-graf-400">
            No mural ({posts.length}) — a ordem é a do slide
          </h3>
          <ul className="divide-y divide-graf-800 rounded-lg border border-graf-800">
            {posts.map((p, k) => (
              <li key={p.id} className={`flex flex-wrap items-start gap-3 p-3 ${p.ativo ? '' : 'opacity-60'}`}>
                <div className="h-16 w-28 shrink-0 overflow-hidden rounded bg-graf-900">
                  {urls[p.imagem_path] && (
                    <img src={urls[p.imagem_path]} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-48 flex-1">
                  {editando === p.id ? (
                    <EditarPost p={p} aoSalvar={async c => { if (await mudar(p, c)) setEditando(null) }}
                      aoCancelar={() => setEditando(null)} campo={campo} />
                  ) : (<>
                    <p className="font-medium">{p.titulo}
                      {!p.ativo && <span className="ml-2 rounded bg-graf-800 px-1.5 py-px text-[10px] uppercase text-graf-300">fora do ar</span>}
                    </p>
                    {p.texto && <p className="line-clamp-2 text-xs text-graf-300">{p.texto}</p>}
                    <p className="mt-0.5 text-[11px] text-graf-400">
                      {dataBr(p.criado_em)} · {p.autor?.nome ?? '—'}
                    </p>
                  </>)}
                </div>
                {editando !== p.id && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <button onClick={() => mover(k, -1)} disabled={k === 0} aria-label="Subir"
                      className="rounded border border-graf-700 px-2 py-1 hover:border-af-600 disabled:opacity-30">↑</button>
                    <button onClick={() => mover(k, 1)} disabled={k === posts.length - 1} aria-label="Descer"
                      className="rounded border border-graf-700 px-2 py-1 hover:border-af-600 disabled:opacity-30">↓</button>
                    <button onClick={() => setEditando(p.id)}
                      className="rounded border border-graf-700 px-2 py-1 hover:border-af-600">Editar</button>
                    <button onClick={() => mudar(p, { ativo: !p.ativo })}
                      className="rounded border border-graf-700 px-2 py-1 hover:border-af-600">
                      {p.ativo ? 'Tirar do ar' : 'Pôr no ar'}
                    </button>
                    <button onClick={() => tirar(p)}
                      className="rounded border border-af-800 px-2 py-1 text-af-300 hover:border-af-500">Apagar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function EditarPost({ p, aoSalvar, aoCancelar, campo }: {
  p: Post; campo: string
  aoSalvar: (c: { titulo: string; texto: string | null }) => void
  aoCancelar: () => void
}) {
  const [titulo, setTitulo] = useState(p.titulo)
  const [texto, setTexto] = useState(p.texto ?? '')
  return (
    <div className="space-y-1.5">
      <input value={titulo} onChange={e => setTitulo(e.target.value)} maxLength={120}
        aria-label="Título" className={campo} />
      <textarea value={texto} onChange={e => setTexto(e.target.value)} maxLength={2000} rows={3}
        aria-label="Dizeres" className={campo} />
      <div className="flex gap-2">
        <button onClick={() => aoSalvar({ titulo: titulo.trim(), texto: texto.trim() || null })}
          disabled={!titulo.trim()}
          className="rounded-md bg-af-600 px-3 py-1 text-xs font-semibold text-white hover:bg-af-500 disabled:opacity-40">
          Salvar
        </button>
        <button onClick={aoCancelar}
          className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-300 hover:border-af-600">
          Cancelar
        </button>
      </div>
    </div>
  )
}
