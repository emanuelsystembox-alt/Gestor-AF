import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

/**
 * Administração: usuários, cargos e perfis de acesso.
 *
 * ┌─ D-049 ─────────────────────────────────────────────────────────┐
 * │ PAPEL é a barreira; PERMISSÃO é a granularidade.                │
 * │                                                                  │
 * │ As 66 policies do banco decidem por papel (`tem_papel`). O que   │
 * │ se marca aqui nas caixinhas é camada ADICIONAL: restringe a      │
 * │ tela e as RPCs, nunca amplia o que o RLS já barrou.              │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Criar login exige a `service_role`, que não pode ir para o navegador.
 * Por isso passa pela Edge Function `admin-usuarios`, que confere no
 * banco — não no que o cliente mandou — se quem chamou é ADMIN.
 */

const PAPEIS = ['ADMIN', 'COP', 'CONTROLADOR', 'SUPERVISOR',
                'TECNICO', 'ALMOXARIFE', 'FROTA'] as const

interface Cargo { id: string; nome: string; descricao: string | null; ordem: number; ativo: boolean }
interface PerfilAcesso {
  id: string; nome: string; descricao: string | null
  papel: string | null; ordem: number; ativo: boolean
}
interface Permissao {
  chave: string; modulo: string; rotulo: string
  descricao: string | null; ordem: number; disponivel: boolean
}
interface Usuario {
  id: string; nome: string; email: string; apelido: string | null
  ativo: boolean; atualizado_em: string | null; whatsapp: string | null
  cargo: { nome: string } | null
  perfil_acesso: { nome: string; papel: string | null } | null
}

/** Um supervisor do TOA e o usuário que responde por ele.
 *  `equipe.supervisor_nome` é texto do TOA; `equipe.supervisor_id` é o
 *  login. Sem o segundo, o papel SUPERVISOR entra e não vê nada (D-066). */
interface SupervisorEquipes {
  supervisor_nome: string
  equipes: number
  vinculadas: number
  usuario_id: string | null
  usuario_nome: string | null
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

export default function Administracao() {
  const { perfil, temPapel } = useAuth()
  const souAdmin = temPapel('ADMIN')

  const [aba, setAba] = useState<'usuarios' | 'perfis' | 'cargos' | 'supervisores'>('usuarios')
  const [supers, setSupers] = useState<SupervisorEquipes[]>([])
  const [vinculo, setVinculo] = useState<Record<string, string>>({})
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [papeisPorUsuario, setPapeisPorUsuario] = useState<Map<string, string[]>>(new Map())
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [perfis, setPerfis] = useState<PerfilAcesso[]>([])
  const [permissoes, setPermissoes] = useState<Permissao[]>([])
  const [doPerfil, setDoPerfil] = useState<Map<string, Set<string>>>(new Map())

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [busca, setBusca] = useState('')

  // criação
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState({
    nome: '', email: '', apelido: '', whatsapp: '',
    cargo_id: '', perfil_acesso_id: '', cpf: '', matricula_ponto: '',
  })
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null)

  // edição de usuário
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, unknown>>({})
  const [papeisEdit, setPapeisEdit] = useState<string[]>([])

  // perfil de acesso aberto na matriz
  const [perfilAberto, setPerfilAberto] = useState<string | null>(null)

  async function recarregar() {
    setCarregando(true); setErro(null)
    const [u, up, c, pa, pm, pap, sv] = await Promise.all([
      supabase.from('perfil')
        .select(`id, nome, email, apelido, ativo, atualizado_em, whatsapp,
                 cargo:cargo_id ( nome ),
                 perfil_acesso:perfil_acesso_id ( nome, papel )`)
        .order('nome'),
      supabase.from('usuario_papel').select('usuario_id, papel'),
      supabase.from('cargo').select('*').order('ordem'),
      supabase.from('perfil_acesso').select('*').order('ordem'),
      supabase.from('permissao').select('*').order('modulo').order('ordem'),
      supabase.from('perfil_acesso_permissao').select('perfil_acesso_id, permissao_chave'),
      supabase.rpc('supervisores_das_equipes'),
    ])
    setSupers((sv.data ?? []) as SupervisorEquipes[])
    if (u.error) setErro(u.error.message)
    else setUsuarios((u.data ?? []) as unknown as Usuario[])

    const mp = new Map<string, string[]>()
    for (const r of (up.data ?? []) as { usuario_id: string; papel: string }[]) {
      mp.set(r.usuario_id, [...(mp.get(r.usuario_id) ?? []), r.papel])
    }
    setPapeisPorUsuario(mp)

    setCargos((c.data ?? []) as Cargo[])
    setPerfis((pa.data ?? []) as PerfilAcesso[])
    setPermissoes((pm.data ?? []) as Permissao[])

    const dp = new Map<string, Set<string>>()
    for (const r of (pap.data ?? []) as { perfil_acesso_id: string; permissao_chave: string }[]) {
      if (!dp.has(r.perfil_acesso_id)) dp.set(r.perfil_acesso_id, new Set())
      dp.get(r.perfil_acesso_id)!.add(r.permissao_chave)
    }
    setDoPerfil(dp)
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [])

  const porModulo = useMemo(() => {
    const m = new Map<string, Permissao[]>()
    for (const p of permissoes) m.set(p.modulo, [...(m.get(p.modulo) ?? []), p])
    return [...m.entries()]
  }, [permissoes])

  function traduzir(msg: string): string {
    if (/row-level security|violates row|permission denied/i.test(msg))
      return 'O banco recusou: seu usuário não tem papel ADMIN. A barreira é do RLS, não da tela.'
    if (/duplicate key/i.test(msg)) return 'Já existe um registro com esse nome.'
    return msg
  }

  /** Executa uma RPC, mostra o recado e recarrega. Cada tela desta
   *  página repetia esse mesmo bloco de cinco linhas. */
  async function agir(
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    msg: string,
  ) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await fn()
    if (error) setErro(traduzir(error.message))
    else { setOk(msg); await recarregar() }
    setOcupado(false)
  }

  async function criarUsuario() {
    if (!novo.nome.trim() || !novo.email.trim()) return
    setOcupado(true); setErro(null); setOk(null); setSenhaGerada(null)
    const { data, error } = await supabase.functions.invoke('admin-usuarios', {
      body: {
        acao: 'criar',
        nome: novo.nome.trim(),
        email: novo.email.trim().toLowerCase(),
        apelido: novo.apelido.trim() || null,
        whatsapp: novo.whatsapp.trim() || null,
        cpf: novo.cpf.trim() || null,
        matricula_ponto: novo.matricula_ponto.trim() || null,
        cargo_id: novo.cargo_id || null,
        perfil_acesso_id: novo.perfil_acesso_id || null,
      },
    })
    const r = data as { ok?: boolean; erro?: string; senha_gerada?: string | null; email?: string } | null
    if (error || r?.erro) setErro(traduzir(r?.erro ?? error?.message ?? 'Falha ao criar.'))
    else {
      setOk(`Acesso criado para ${novo.email.trim().toLowerCase()}.`)
      if (r?.senha_gerada) setSenhaGerada({ email: r.email!, senha: r.senha_gerada })
      setCriando(false)
      setNovo({ nome: '', email: '', apelido: '', whatsapp: '',
                cargo_id: '', perfil_acesso_id: '', cpf: '', matricula_ponto: '' })
      await recarregar()
    }
    setOcupado(false)
  }

  async function novaSenha(u: Usuario) {
    setOcupado(true); setErro(null); setOk(null); setSenhaGerada(null)
    const { data, error } = await supabase.functions.invoke('admin-usuarios', {
      body: { acao: 'senha', usuario_id: u.id },
    })
    const r = data as { erro?: string; senha_gerada?: string } | null
    if (error || r?.erro) setErro(traduzir(r?.erro ?? error?.message ?? 'Falha.'))
    else if (r?.senha_gerada) setSenhaGerada({ email: u.email, senha: r.senha_gerada })
    setOcupado(false)
  }

  async function salvarUsuario(u: Usuario) {
    setOcupado(true); setErro(null); setOk(null)
    if (Object.keys(rascunho).length) {
      const { error } = await supabase.from('perfil').update(rascunho).eq('id', u.id)
      if (error) { setErro(traduzir(error.message)); setOcupado(false); return }
    }
    const atuais = papeisPorUsuario.get(u.id) ?? []
    if (papeisEdit.sort().join() !== [...atuais].sort().join()) {
      const { error } = await supabase.rpc('definir_papeis',
        { p_usuario: u.id, p_papeis: papeisEdit })
      if (error) { setErro(traduzir(error.message)); setOcupado(false); return }
    }
    setOk(`${u.nome} atualizado.`)
    setEditando(null); setRascunho({}); setPapeisEdit([])
    await recarregar()
    setOcupado(false)
  }

  async function alternarSituacao(u: Usuario) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_situacao_usuario',
      { p_usuario: u.id, p_ativo: !u.ativo })
    if (error) setErro(traduzir(error.message))
    else { setOk(`${u.nome} ${u.ativo ? 'desativado' : 'reativado'}.`); await recarregar() }
    setOcupado(false)
  }

  async function alternarPermissao(pa: PerfilAcesso, chave: string) {
    const tem = doPerfil.get(pa.id)?.has(chave)
    setOcupado(true); setErro(null)
    const { error } = tem
      ? await supabase.from('perfil_acesso_permissao').delete()
          .eq('perfil_acesso_id', pa.id).eq('permissao_chave', chave)
      : await supabase.from('perfil_acesso_permissao')
          .insert({ perfil_acesso_id: pa.id, permissao_chave: chave })
    if (error) setErro(traduzir(error.message))
    else {
      setDoPerfil(m => {
        const n = new Map(m)
        const s = new Set(n.get(pa.id) ?? [])
        if (tem) s.delete(chave); else s.add(chave)
        n.set(pa.id, s)
        return n
      })
    }
    setOcupado(false)
  }

  async function criarCargo(nome: string) {
    if (!nome.trim()) return
    setOcupado(true); setErro(null)
    const { data: emp } = await supabase.from('empresa').select('id').maybeSingle()
    const { error } = await supabase.from('cargo').insert({
      empresa_id: (emp as { id: string } | null)?.id ?? null,
      nome: nome.trim().toUpperCase(),
      ordem: (cargos.at(-1)?.ordem ?? 0) + 1,
    })
    if (error) setErro(traduzir(error.message))
    else { setOk(`Cargo "${nome.trim().toUpperCase()}" criado.`); await recarregar() }
    setOcupado(false)
  }

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return usuarios
    return usuarios.filter(u => [u.nome, u.email, u.apelido, u.cargo?.nome,
      u.perfil_acesso?.nome].some(x => x?.toLowerCase().includes(t)))
  }, [usuarios, busca])

  const [nomeCargo, setNomeCargo] = useState('')

  return (
    <Shell>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Administração</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            Quem entra, com qual cargo e o que enxerga. <strong>O papel é a barreira
            do banco</strong> — as caixinhas de permissão restringem a tela e as ações,
            nunca ampliam o que o RLS já barrou.
          </p>
        </div>

        {!souAdmin && (
          <Alerta tipo="aviso">
            Você está vendo esta tela, mas <strong>não tem papel ADMIN</strong>. O banco
            vai recusar qualquer alteração — e é assim que tem que ser.
          </Alerta>
        )}
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}
        {senhaGerada && (
          <Alerta tipo="aviso">
            <p className="font-medium">Senha temporária de {senhaGerada.email}</p>
            <p className="tabular mt-1 select-all text-lg font-semibold text-graf-100">
              {senhaGerada.senha}
            </p>
            <p className="mt-1">
              Aparece <strong>uma vez só</strong>. Repasse pessoalmente e peça para
              trocar no primeiro acesso.
            </p>
            <button onClick={() => setSenhaGerada(null)}
              className="mt-2 rounded border border-graf-700 px-2.5 py-1 text-xs text-graf-300">
              Já anotei
            </button>
          </Alerta>
        )}

        <div className="flex rounded-lg bg-graf-900 p-0.5">
          {([['usuarios', 'Usuários', usuarios.length],
             ['supervisores', 'Supervisores', supers.length],
             ['perfis', 'Perfis de acesso', perfis.length],
             ['cargos', 'Cargos', cargos.length]] as const).map(([a, rot, n]) => (
            <button key={a} onClick={() => { setAba(a); setEditando(null) }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
              {rot}<span className="tabular ml-1.5 opacity-60">{n}</span>
            </button>
          ))}
        </div>

        {carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : aba === 'usuarios' ? (
          <section className="space-y-4">
            <div className="card-controle p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar nome, e-mail, cargo, perfil…"
                  className={`${campo} min-w-64 flex-1`} />
                <button onClick={() => { setCriando(!criando); setSenhaGerada(null) }}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500">
                  {criando ? 'Cancelar' : 'Novo usuário'}
                </button>
              </div>

              {criando && (
                <div className="mt-3 space-y-3 border-t border-graf-800 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {([['nome', 'Nome completo *'], ['email', 'E-mail *'],
                       ['apelido', 'Apelido'], ['whatsapp', 'WhatsApp'],
                       ['cpf', 'CPF'], ['matricula_ponto', 'Matrícula do ponto'],
                      ] as [keyof typeof novo, string][]).map(([k, rot]) => (
                      <label key={k} className="text-xs text-graf-400">
                        <span className="mb-1 block">{rot}</span>
                        <input value={novo[k]} className={`${campo} w-full`}
                          onChange={e => setNovo(n => ({ ...n, [k]: e.target.value }))} />
                      </label>
                    ))}
                    <label className="text-xs text-graf-400">
                      <span className="mb-1 block">Cargo</span>
                      <select value={novo.cargo_id} className={`${campo} w-full`}
                        onChange={e => setNovo(n => ({ ...n, cargo_id: e.target.value }))}>
                        <option value="">— sem cargo —</option>
                        {cargos.filter(c => c.ativo).map(c =>
                          <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-graf-400">
                      <span className="mb-1 block">Perfil de acesso</span>
                      <select value={novo.perfil_acesso_id} className={`${campo} w-full`}
                        onChange={e => setNovo(n => ({ ...n, perfil_acesso_id: e.target.value }))}>
                        <option value="">— sem perfil —</option>
                        {perfis.filter(p => p.ativo).map(p =>
                          <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="text-xs text-graf-500">
                    O papel vem do perfil de acesso escolhido. A senha é gerada pelo
                    servidor e mostrada uma vez — o sistema nunca guarda senha em texto.
                  </p>
                  <button onClick={criarUsuario}
                    disabled={ocupado || !novo.nome.trim() || !novo.email.trim()}
                    className="rounded-md bg-af-600 px-5 py-2 text-xs font-medium text-white
                               hover:bg-af-500 disabled:opacity-50">
                    {ocupado ? 'Criando…' : 'Criar acesso'}
                  </button>
                </div>
              )}
            </div>

            <div className="card-controle overflow-hidden">
              {visiveis.length === 0 ? (
                <Vazio titulo="Nenhum usuário" descricao="Crie o primeiro acesso acima." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-graf-800 bg-graf-900 text-left
                                      text-[11px] uppercase tracking-wide text-graf-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Pessoa</th>
                        <th className="px-3 py-2 font-medium">Cargo</th>
                        <th className="px-3 py-2 font-medium">Perfil de acesso</th>
                        <th className="px-3 py-2 font-medium">Papéis (o que o banco lê)</th>
                        <th className="px-3 py-2 font-medium">Situação</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map(u => {
                        const ed = editando === u.id
                        const papeis = papeisPorUsuario.get(u.id) ?? []
                        const euMesmo = u.id === perfil?.id
                        return (
                          <tr key={u.id} className="border-b border-graf-800 align-top">
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                {u.nome}
                                {euMesmo && (
                                  <span className="ml-2 rounded bg-graf-800 px-1.5 py-0.5
                                                   text-[10px] text-graf-400">você</span>
                                )}
                              </div>
                              <div className="text-xs text-graf-500">{u.email}</div>
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {ed ? (
                                <select defaultValue={''} className={campo}
                                  onChange={e => setRascunho(r => ({
                                    ...r, cargo_id: e.target.value || null }))}>
                                  <option value="">{u.cargo?.nome ?? '— sem cargo —'}</option>
                                  {cargos.filter(c => c.ativo).map(c =>
                                    <option key={c.id} value={c.id}>{c.nome}</option>)}
                                </select>
                              ) : u.cargo?.nome ?? <span className="text-graf-600">—</span>}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {ed ? (
                                <select defaultValue={''} className={campo}
                                  onChange={e => setRascunho(r => ({
                                    ...r, perfil_acesso_id: e.target.value || null }))}>
                                  <option value="">{u.perfil_acesso?.nome ?? '— sem perfil —'}</option>
                                  {perfis.filter(p => p.ativo).map(p =>
                                    <option key={p.id} value={p.id}>{p.nome}</option>)}
                                </select>
                              ) : u.perfil_acesso?.nome ?? <span className="text-graf-600">—</span>}
                            </td>
                            <td className="px-3 py-2">
                              {ed ? (
                                <div className="flex flex-wrap gap-1">
                                  {PAPEIS.map(p => {
                                    const marcado = papeisEdit.includes(p)
                                    return (
                                      <button key={p}
                                        onClick={() => setPapeisEdit(ps =>
                                          marcado ? ps.filter(x => x !== p) : [...ps, p])}
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium
                                                    ring-1 ${marcado
                                          ? 'bg-af-600/20 text-af-300 ring-af-600/40'
                                          : 'bg-graf-900 text-graf-500 ring-graf-700'}`}>
                                        {p}
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : papeis.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {papeis.map(p => (
                                    <span key={p} className="rounded bg-graf-800 px-1.5 py-0.5
                                                             text-[10px] text-graf-300">{p}</span>
                                  ))}
                                </div>
                              ) : <span className="text-xs text-af-400/70">sem papel</span>}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => alternarSituacao(u)}
                                disabled={ocupado || euMesmo}
                                title={euMesmo ? 'Você não pode desativar a si mesmo' : ''}
                                className={`rounded px-2 py-0.5 text-[11px] font-medium
                                            disabled:opacity-40 ${u.ativo
                                  ? 'bg-emerald-900/40 text-emerald-300'
                                  : 'bg-graf-800 text-graf-500'}`}>
                                {u.ativo ? 'ativo' : 'inativo'}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {ed ? (
                                <span className="flex justify-end gap-1.5">
                                  <button disabled={ocupado} onClick={() => salvarUsuario(u)}
                                    className="rounded bg-af-600 px-2.5 py-1 text-[11px]
                                               font-medium text-white disabled:opacity-50">
                                    Salvar
                                  </button>
                                  <button onClick={() => { setEditando(null); setRascunho({}) }}
                                    className="rounded border border-graf-700 px-2.5 py-1
                                               text-[11px] text-graf-400">
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <span className="flex justify-end gap-1.5">
                                  <button
                                    onClick={() => {
                                      setEditando(u.id); setRascunho({}); setPapeisEdit(papeis)
                                    }}
                                    className="rounded border border-graf-700 px-2.5 py-1
                                               text-[11px] text-graf-400 hover:border-af-600
                                               hover:text-af-400">
                                    Editar
                                  </button>
                                  <button onClick={() => novaSenha(u)} disabled={ocupado}
                                    className="rounded border border-graf-700 px-2.5 py-1
                                               text-[11px] text-graf-400 hover:border-af-600
                                               hover:text-af-400 disabled:opacity-50">
                                    Nova senha
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="text-xs text-graf-500">
              Usuário não se apaga, se <strong>desativa</strong>: apagar levaria junto a
              autoria de cada baixa, marcador, transferência e exclusão que ele fez. E o
              banco não deixa tirar o último ADMIN ativo — nem você desativar a si mesmo.
            </p>
          </section>
        ) : aba === 'supervisores' ? (
          <section className="card-controle overflow-hidden">
            <div className="border-b border-graf-800 px-4 py-2.5">
              <h2 className="text-sm font-semibold">Supervisores e suas equipes</h2>
              <p className="mt-1 max-w-3xl text-xs text-graf-400">
                O TOA manda o <strong>nome</strong> do supervisor em cada equipe. O que
                decide o que ele enxerga no sistema é o <strong>login</strong>. Enquanto
                os dois não estiverem ligados, quem entra com papel SUPERVISOR vê a tela
                vazia — e isso não é defeito, é falta de cadastro.
              </p>
              <p className="mt-1 text-xs text-graf-500">
                Não achou o supervisor na lista de usuários? Crie o login primeiro na aba
                <strong className="text-graf-300"> Usuários</strong>, com o papel
                SUPERVISOR — o vínculo aqui exige o papel.
              </p>
            </div>

            <table className="w-full text-sm">
              <thead className="border-b border-graf-800 bg-graf-900 text-left
                                text-[11px] uppercase tracking-wide text-graf-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Supervisor no TOA</th>
                  <th className="px-3 py-2 text-right font-medium">Equipes</th>
                  <th className="px-3 py-2 font-medium">Login vinculado</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {supers.map(sv => {
                  const cands = usuarios.filter(u =>
                    u.ativo && (papeisPorUsuario.get(u.id) ?? []).includes('SUPERVISOR'))
                  return (
                    <tr key={sv.supervisor_nome} className="border-b border-graf-800/60">
                      <td className="px-3 py-2.5 font-medium">{sv.supervisor_nome}</td>
                      <td className="tabular px-3 py-2.5 text-right text-graf-300">
                        {sv.equipes}
                        {sv.vinculadas > 0 && sv.vinculadas < sv.equipes && (
                          <div className="text-[10px] text-amber-400">
                            {sv.vinculadas} vinculada(s)
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {sv.usuario_nome ? (
                          <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-[11px]
                                           font-medium text-emerald-300">
                            {sv.usuario_nome}
                          </span>
                        ) : cands.length === 0 ? (
                          <span className="text-[11px] text-graf-600">
                            nenhum usuário com papel SUPERVISOR ainda
                          </span>
                        ) : (
                          <select className={`${campo} w-56`}
                            value={vinculo[sv.supervisor_nome] ?? ''}
                            onChange={e => setVinculo(v =>
                              ({ ...v, [sv.supervisor_nome]: e.target.value }))}>
                            <option value="">— escolha o login —</option>
                            {cands.map(u => (
                              <option key={u.id} value={u.id}>{u.nome} · {u.email}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {sv.usuario_id ? (
                          <button disabled={!souAdmin || ocupado}
                            onClick={() => agir(
                              () => supabase.rpc('limpar_supervisor_das_equipes',
                                { p_usuario: sv.usuario_id }),
                              `Vínculo de ${sv.supervisor_nome} desfeito.`)}
                            className="rounded-md border border-graf-700 px-3 py-1 text-xs
                                       text-graf-400 hover:border-af-600 hover:text-af-400
                                       disabled:opacity-40">
                            desvincular
                          </button>
                        ) : (
                          <button
                            disabled={!souAdmin || ocupado || !vinculo[sv.supervisor_nome]}
                            onClick={() => agir(
                              () => supabase.rpc('definir_supervisor_das_equipes', {
                                p_usuario: vinculo[sv.supervisor_nome],
                                p_supervisor_nome: sv.supervisor_nome,
                              }),
                              `${sv.supervisor_nome}: ${sv.equipes} equipe(s) vinculada(s).`)}
                            className="rounded-md bg-af-600 px-3 py-1 text-xs font-medium
                                       text-white hover:bg-af-500 disabled:opacity-40">
                            vincular {sv.equipes} equipe(s)
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ) : aba === 'perfis' ? (
          <section className="space-y-3">
            {perfis.map(pa => {
              const aberto = perfilAberto === pa.id
              const marcadas = doPerfil.get(pa.id)?.size ?? 0
              return (
                <div key={pa.id} className="card-controle overflow-hidden">
                  <button onClick={() => setPerfilAberto(aberto ? null : pa.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left
                               hover:bg-graf-850">
                    <span className="text-graf-500">{aberto ? '▾' : '▸'}</span>
                    <span className="font-medium">{pa.nome}</span>
                    {pa.papel && (
                      <span className="rounded bg-af-600/15 px-1.5 py-0.5 text-[10px]
                                       font-semibold text-af-300 ring-1 ring-af-600/30">
                        papel {pa.papel}
                      </span>
                    )}
                    <span className="text-xs text-graf-500">{pa.descricao}</span>
                    <span className="tabular ml-auto text-xs text-graf-400">
                      {marcadas} permissões
                    </span>
                  </button>

                  {aberto && (
                    <div className="space-y-4 border-t border-graf-800 px-4 py-3">
                      {porModulo.map(([modulo, lista]) => (
                        <div key={modulo}>
                          <p className="mb-1.5 text-[11px] font-semibold uppercase
                                        tracking-widest text-graf-500">{modulo}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {lista.map(p => {
                              const on = doPerfil.get(pa.id)?.has(p.chave) ?? false
                              return (
                                <button key={p.chave} disabled={ocupado || !p.disponivel}
                                  onClick={() => alternarPermissao(pa, p.chave)}
                                  title={p.disponivel
                                    ? (p.descricao ?? p.chave)
                                    : 'Módulo ainda não construído — a chave fica reservada'}
                                  className={`rounded-md px-2.5 py-1 text-[11px] ring-1 transition
                                              disabled:cursor-not-allowed disabled:opacity-40 ${
                                    on ? 'bg-af-600/20 text-af-300 ring-af-600/40'
                                       : 'bg-graf-900 text-graf-400 ring-graf-700 hover:text-graf-200'}`}>
                                  {on && <span className="mr-1">✓</span>}
                                  {p.rotulo}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] text-graf-600">
                        Marcar aqui não dá acesso sozinho: a policy do banco ainda exige o
                        papel <strong>{pa.papel ?? '—'}</strong>. Permissão restringe,
                        nunca amplia.
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="card-controle p-4">
              <h2 className="text-sm font-semibold">Novo cargo</h2>
              <p className="mt-1 text-xs text-graf-400">
                Cargo é função na empresa (INSTALADOR I, TÉCNICO). Não dá acesso a nada —
                quem dá é o perfil de acesso.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <input value={nomeCargo} onChange={e => setNomeCargo(e.target.value)}
                  placeholder="INSTALADOR III" className={`${campo} w-64`} />
                <button onClick={() => { criarCargo(nomeCargo); setNomeCargo('') }}
                  disabled={ocupado || !nomeCargo.trim()}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Adicionar
                </button>
              </div>
            </div>

            <div className="card-controle overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Cargo</th>
                    <th className="px-3 py-2 text-right font-medium">Pessoas</th>
                    <th className="px-3 py-2 font-medium">Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {cargos.map(c => (
                    <tr key={c.id} className="border-b border-graf-800">
                      <td className="px-3 py-2 font-medium">{c.nome}</td>
                      <td className="tabular px-3 py-2 text-right text-graf-400">
                        {usuarios.filter(u => u.cargo?.nome === c.nome).length}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          c.ativo ? 'bg-emerald-900/40 text-emerald-300'
                                  : 'bg-graf-800 text-graf-500'}`}>
                          {c.ativo ? 'ativo' : 'inativo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Shell>
  )
}
