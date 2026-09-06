import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, carregarSituacoes } from './supabase'

export type Papel =
  | 'ADMIN' | 'COP' | 'CONTROLADOR' | 'SUPERVISOR'
  | 'TECNICO' | 'ALMOXARIFE' | 'FROTA'

interface Perfil {
  id: string
  nome: string
  email: string
}

interface Ctx {
  session: Session | null
  perfil: Perfil | null
  papeis: Papel[]
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
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) {
        setPerfil(null)
        setPapeis([])
        setCarregando(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let vivo = true
    ;(async () => {
      setCarregando(true)
      // O cadastro de situação (cor, rótulo) vem junto da sessão: uma
      // consulta, uma vez, e a tela inteira passa a falar a língua do
      // banco em vez da constante compilada.
      carregarSituacoes()
      const [p, r] = await Promise.all([
        supabase.from('perfil').select('id, nome, email').eq('id', session.user.id).maybeSingle(),
        supabase.from('usuario_papel').select('papel').eq('usuario_id', session.user.id),
      ])
      if (!vivo) return
      setPerfil(p.data ?? null)
      setPapeis(((r.data ?? []) as { papel: Papel }[]).map(x => x.papel))
      setCarregando(false)
    })()
    return () => { vivo = false }
  }, [session])

  const temPapel = (...p: Papel[]) => p.some(x => papeis.includes(x))

  const valor: Ctx = {
    session, perfil, papeis, carregando, temPapel,
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
