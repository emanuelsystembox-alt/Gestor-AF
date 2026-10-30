import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Os GRUPOS do chat (156g) — no aplicativo.
 *
 * > "o coordenador consiga criar grupos dentro do chat (...) deixar todos
 * >  os técnicos ali reunidos, sendo assim evitando o uso do WhatsApp"
 * >  — Emanuel, 30/10
 *
 * O técnico não cria grupo (é a gestão que monta); ele lê e ESCREVE em
 * todo grupo de que é membro — decisão do Emanuel. Quem lê é só quem é
 * membro, e o autor é carimbado pelo servidor (D-061): nenhuma chamada
 * daqui manda `usuario_id`.
 */

export interface Grupo {
  grupo_id: string
  nome: string
  membros: number
  ultima_texto: string | null
  ultima_em: string
  ultima_autor: string | null
  ultima_minha: boolean | null
  nao_lidas: number
}

export interface MensagemGrupo {
  id: number
  usuario_id: string
  autor_nome: string | null
  texto: string
  criado_em: string
}

export async function carregarGrupos(): Promise<Grupo[]> {
  const { data, error } = await supabase.rpc('grupos_do_chat')
  if (error) throw new Error(error.message)
  return (data ?? []) as Grupo[]
}

export async function carregarMensagensGrupo(grupo: string): Promise<MensagemGrupo[]> {
  const { data, error } = await supabase.from('grupo_mensagem')
    .select('id, usuario_id, autor_nome, texto, criado_em')
    .eq('grupo_id', grupo).order('criado_em', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return ((data ?? []) as MensagemGrupo[]).reverse()
}

export async function enviarAoGrupo(grupo: string, texto: string): Promise<void> {
  const { error } = await supabase.rpc('enviar_ao_grupo', { p_grupo: grupo, p_texto: texto })
  if (error) throw new Error(error.message)
}

export async function marcarGrupoLido(grupo: string): Promise<void> {
  await supabase.rpc('marcar_grupo_lido', { p_grupo: grupo })
}

/** Assina o que chega no grupo. Devolve o cancelamento — chamar no
 *  cleanup não é opcional: canal pendurado é conexão do teto do plano. */
export function assinarGrupo(grupo: string, aoChegar: (m: MensagemGrupo) => void): () => void {
  let canal: RealtimeChannel | null = null
  let vivo = true
  supabase.auth.getSession().then(({ data }) => {
    if (!vivo) return
    if (data.session) supabase.realtime.setAuth(data.session.access_token)
    canal = supabase
      .channel(`grupo:${grupo}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'grupo_mensagem', filter: `grupo_id=eq.${grupo}` },
        carga => aoChegar(carga.new as MensagemGrupo))
      .subscribe()
  })
  return () => { vivo = false; if (canal) supabase.removeChannel(canal) }
}
