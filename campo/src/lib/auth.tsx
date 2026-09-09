import {
  createContext, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Papel =
  | 'ADMIN' | 'COP' | 'CONTROLADOR' | 'SUPERVISOR'
  | 'TECNICO' | 'ALMOXARIFE' | 'FROTA'

export interface Perfil {
  id: string
  nome: string
  email: string
  /** Liga a pessoa à agenda e à própria produção. Nulo = login que não
   *  é de técnico; o aplicativo continua funcionando (um controlador
   *  pode abrir para conferir), mas a agenda vem pelo escopo dele. */
  tecnico_id: string | null
}

interface Ctx {
  session: Session | null
  perfil: Perfil | null
  /** A equipe do técnico. É por ela que o aplicativo assina os avisos
   *  (059) — canal por equipe, não um canal para todo mundo. Nulo para
   *  quem não é técnico. */
  equipeId: string | null
  papeis: Papel[]
  permissoes: string[]
  pode: (chave: string) => boolean
  carregando: boolean
  temPapel: (...p: Papel[]) => boolean
  ehGestor: boolean
  ehCampo: boolean
  entrar: (email: string, senha: string) => Promise<string | null>
  sair: () => Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [papeis, setPapeis] = useState<Papel[]>([])
  const [permissoes, setPermissoes] = useState<string[]>([])
  const [equipeId, setEquipeId] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  /**
   * Guarda o ID, não o objeto de sessão — D-085. No navegador o motivo
   * era o foco da aba; aqui é pior: o Android manda o aplicativo para
   * segundo plano a cada ligação recebida, e o `supabase-js` reemite a
   * sessão na volta. Guardar o objeto remontaria a árvore inteira no
   * meio de um preenchimento de baixa.
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
      if (novo === idLogado.current) return
      idLogado.current = novo
      setSession(s)
      if (!s) {
        setPerfil(null); setPapeis([]); setPermissoes([])
        setEquipeId(null); setCarregando(false)
      }
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [])

  const usuarioId = session?.user.id ?? null

  useEffect(() => {
    if (!usuarioId) return
    let vivo = true
    ;(async () => {
      setCarregando(true)
      const [p, r, q, t] = await Promise.all([
        supabase.from('perfil').select('id, nome, email, tecnico_id')
          .eq('id', usuarioId).maybeSingle(),
        supabase.from('usuario_papel').select('papel').eq('usuario_id', usuarioId),
        supabase.rpc('minhas_permissoes'),
        // Vem de `tecnico`, não de `perfil`: quem manda no escopo é
        // `tecnico.usuario_id` — `perfil.tecnico_id` é conveniência de
        // tela e pode estar vazio.
        supabase.from('tecnico').select('equipe_id')
          .eq('usuario_id', usuarioId).maybeSingle(),
      ])
      if (!vivo) return
      setPerfil((p.data as Perfil | null) ?? null)
      setPapeis(((r.data ?? []) as { papel: Papel }[]).map(x => x.papel))
      setPermissoes(((q.data ?? []) as { chave: string }[]).map(x => x.chave))
      setEquipeId((t.data as { equipe_id: string | null } | null)?.equipe_id ?? null)
      setCarregando(false)
    })()
    return () => { vivo = false }
  }, [usuarioId])

  const temPapel = (...p: Papel[]) => p.some(x => papeis.includes(x))
  const ehGestor = temPapel('ADMIN', 'COP')

  const valor: Ctx = {
    session, perfil, papeis, permissoes, equipeId, carregando, temPapel, ehGestor,
    pode: (chave: string) => permissoes.includes(chave),
    // "Campo" é quem SÓ tem o papel do campo — a mesma conta que o
    // banco faz em `baixar_os` (055-G). Um controlador que também está
    // cadastrado como técnico não perde os poderes de controlador só
    // por abrir o aplicativo.
    ehCampo: temPapel('TECNICO') && !ehGestor
             && !temPapel('CONTROLADOR', 'SUPERVISOR'),
    entrar: async (email, senha) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password: senha,
      })
      if (!error) return null
      // A mensagem crua do Supabase é em inglês e não ajuda ninguém às
      // 7h da manhã na porta de um cliente.
      if (error.message.includes('Invalid login')) return 'E-mail ou senha errados.'
      if (error.message.includes('Email not confirmed')) return 'Login ainda não liberado. Fale com o controlador.'
      if (error.message.toLowerCase().includes('network')) return 'Sem internet. Verifique o sinal e tente de novo.'
      return error.message
    },
    sair: async () => { await supabase.auth.signOut() },
  }

  return <AuthCtx.Provider value={valor}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const c = useContext(AuthCtx)
  if (!c) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return c
}
