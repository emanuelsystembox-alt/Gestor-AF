import { useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * A conversa do técnico com o controle (091).
 *
 * Uma conversa só, a DELE: o técnico não escolhe com quem fala — do
 * outro lado, qualquer controlador que enxerga a equipe dele lê e
 * responde, e cada mensagem traz o nome de quem escreveu. Assim a troca
 * de turno não deixa pergunta sem resposta (ver a caixa na migration).
 *
 * Mesma regra dos avisos: a LINHA é a verdade, o Realtime só encurta o
 * caminho. Quem estava sem sinal lê o que perdeu ao abrir a tela.
 */

export interface Mensagem {
  id: number
  do_campo: boolean
  autor_nome: string | null
  texto: string
  criado_em: string
  lida_em: string | null
  /** Para quem o técnico mandou (132). Nulo = o controle todo. */
  para_usuario_id?: string | null
}

/** Alguém da gestão que o técnico pode escolher (132). */
export interface Destinatario {
  usuario_id: string
  nome: string
  grupo: 'COP' | 'SUPERVISOR' | 'COORDENADOR'
  cargo: string | null
}

export async function carregarDestinatarios(): Promise<Destinatario[]> {
  const { data, error } = await supabase.rpc('destinatarios_do_campo')
  if (error) throw new Error(error.message)
  return (data ?? []) as Destinatario[]
}

export interface ColegaDaCidade { tecnico_id: string; nome: string; equipe: string | null }

export async function carregarColegasDaCidade(): Promise<ColegaDaCidade[]> {
  const { data, error } = await supabase.rpc('tecnicos_da_cidade')
  if (error) throw new Error(error.message)
  return (data ?? []) as ColegaDaCidade[]
}

/** Filtra pela conversa DELE mesmo com o RLS já filtrando: um controlador
 *  que também é técnico enxerga as conversas das equipes dele. */
export async function carregarConversa(tecnicoId: string, limite = 200): Promise<Mensagem[]> {
  const { data, error } = await supabase.from('mensagem')
    .select('id, do_campo, autor_nome, texto, criado_em, lida_em, para_usuario_id')
    .eq('tecnico_id', tecnicoId)
    .order('criado_em', { ascending: false }).limit(limite)
  if (error) throw new Error(error.message)
  // Vem do mais novo para o mais velho (o limite corta o antigo); a tela
  // lê de cima para baixo, do mais velho.
  return ((data ?? []) as Mensagem[]).reverse()
}

/** O autor e a conversa são carimbados pelo servidor (D-061). `para` =
 *  a pessoa da gestão escolhida; sem ela, vai para o controle todo (132). */
export async function enviarMensagem(texto: string, para?: string | null): Promise<void> {
  const { error } = await supabase.rpc('enviar_mensagem', {
    p_tecnico_id: null, p_texto: texto, p_para: para ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function marcarLida(): Promise<void> {
  await supabase.rpc('marcar_conversa_lida', { p_tecnico_id: null })
}

/**
 * Assina as mensagens da conversa DELE. O filtro por `tecnico_id` no
 * servidor faz cada mensagem ir para um aparelho, e não para todos.
 * Devolve o cancelamento — chamar no cleanup não é opcional.
 */
export function assinarConversa(tecnicoId: string, aoChegar: (m: Mensagem) => void): () => void {
  let canal: RealtimeChannel | null = null
  let vivo = true
  supabase.auth.getSession().then(({ data }) => {
    if (!vivo) return
    if (data.session) supabase.realtime.setAuth(data.session.access_token)
    canal = supabase
      .channel(`mensagens:${tecnicoId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensagem', filter: `tecnico_id=eq.${tecnicoId}` },
        carga => {
          const n = carga.new as Record<string, unknown>
          aoChegar({
            id: Number(n.id), do_campo: Boolean(n.do_campo),
            autor_nome: (n.autor_nome as string) ?? null, texto: String(n.texto ?? ''),
            criado_em: String(n.criado_em ?? new Date().toISOString()),
            lida_em: (n.lida_em as string) ?? null,
            para_usuario_id: (n.para_usuario_id as string) ?? null,
          })
        })
      .subscribe()
  })
  return () => { vivo = false; if (canal) supabase.removeChannel(canal) }
}

/**
 * Quantas mensagens do controle ele ainda não leu — o selo da barra.
 * `null` enquanto não sabe: o selo não mostra "0" no carregamento.
 */
export function useNaoLidas(tecnicoId: string | null): number | null {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    if (!tecnicoId) return
    let vivo = true
    const contar = () => {
      supabase.from('mensagem').select('id', { count: 'exact', head: true })
        .eq('tecnico_id', tecnicoId).eq('do_campo', false).is('lida_em', null)
        .then(({ count, error }) => { if (vivo) setN(error ? null : count ?? 0) })
    }
    contar()
    const parar = assinarConversa(tecnicoId, m => { if (!m.do_campo) contar() })
    return () => { vivo = false; parar() }
  }, [tecnicoId])
  return n
}
