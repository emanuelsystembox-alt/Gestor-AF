import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, carregarSituacoes } from './supabase'

export type Papel =
  | 'ADMIN' | 'COP' | 'CONTROLADOR' | 'SUPERVISOR'
  | 'TECNICO' | 'ALMOXARIFE' | 'FROTA'

interface Perfil {
  id: string
  nome: string
  email: string
  /** Preenchido quando o login é de um técnico. É o que liga a pessoa
   *  à agenda e à própria produção. */
  tecnico_id: string | null
}

interface Ctx {
  session: Session | null
  perfil: Perfil | null
  papeis: Papel[]
  /** Permissões finas do perfil de acesso (D-055). Papel abre a sala;
   *  permissão diz o que se faz dentro. A tela usa isto só para não
   *  mostrar botão que vai falhar — a barreira real é a RPC. */
  permissoes: string[]
  pode: (chave: string) => boolean
  carregando: boolean
  temPapel: (...p: Papel[]) => boolean
  ehGestor: boolean
  ehTecnico: boolean
  sair: () => Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [papeis, setPapeis] = useState<Papel[]>([])
  const [permissoes, setPermissoes] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)

  /**
   * ┌─ POR QUE ESTE useRef EXISTE ─────────────────────────────────────┐
   * │ O `supabase-js` renova o token sozinho e dispara                 │
   * │ `onAuthStateChange` toda vez que a aba volta a receber foco. O   │
   * │ objeto de sessão vem NOVO a cada disparo — mesma pessoa, mesma   │
   * │ permissão, referência diferente.                                 │
   * │                                                                  │
   * │ Guardar esse objeto direto no estado fazia o React remontar a    │
   * │ árvore inteira: a tela piscava o "Carregando…", refazia perfil,  │
   * │ papéis e permissões, e cada página refazia as consultas dela.    │
   * │ Sair para olhar outra coisa e voltar recarregava tudo.           │
   * │                                                                  │
   * │ O que a aplicação usa da sessão é o ID de quem está logado. Se o │
   * │ ID não mudou, nada mudou para a tela — e o token renovado o      │
   * │ próprio cliente já usa por dentro.                               │
   * └──────────────────────────────────────────────────────────────────┘
   */
  const idLogado = useRef<string | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return
      idLogado.current = data.session?.user.id ?? null
      setSession(data.session)
      if (!data.session) setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      const novo = s?.user.id ?? null
      // Token renovado da mesma pessoa: ignora e não re-renderiza nada.
      if (novo === idLogado.current) return
      idLogado.current = novo
      setSession(s)
      if (!s) {
        setPerfil(null)
        setPapeis([])
        setPermissoes([])
        setCarregando(false)
      }
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [])

  // Depende do ID, não do objeto: ver o comentário do `idLogado`.
  const usuarioId = session?.user.id ?? null

  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    ;(async () => {
      setCarregando(true)
      // O cadastro de situação (cor, rótulo) vem junto da sessão: uma
      // consulta, uma vez, e a tela inteira passa a falar a língua do
      // banco em vez da constante compilada.
      carregarSituacoes()
      const [p, r, q] = await Promise.all([
        supabase.from('perfil').select('id, nome, email, tecnico_id').eq('id', usuarioId).maybeSingle(),
        supabase.from('usuario_papel').select('papel').eq('usuario_id', usuarioId),
        supabase.rpc('minhas_permissoes'),
      ])
      if (!vivo) return
      setPerfil(p.data ?? null)
      setPapeis(((r.data ?? []) as { papel: Papel }[]).map(x => x.papel))
      setPermissoes(((q.data ?? []) as { chave: string }[]).map(x => x.chave))
      setCarregando(false)
    })()
    return () => { vivo = false }
  }, [usuarioId])

  const temPapel = (...p: Papel[]) => p.some(x => papeis.includes(x))

  const valor: Ctx = {
    session, perfil, papeis, permissoes, carregando, temPapel,
    pode: (chave: string) => permissoes.includes(chave),
    ehGestor: temPapel('ADMIN', 'COP'),
    ehTecnico: temPapel('TECNICO'),
    sair: async () => { await supabase.auth.signOut() },
  }

  return <AuthCtx.Provider value={valor}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const c = useContext(AuthCtx)
  if (!c) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return c
}
