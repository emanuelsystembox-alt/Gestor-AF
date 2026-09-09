import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * O que o campo precisa saber sem pedir.
 *
 * ┌─ A LINHA É A VERDADE; O REALTIME É O CARREGADOR ─────────────────┐
 * │ Realtime é *fire-and-forget*: quem estava no elevador, no         │
 * │ subsolo ou sem 4G não recebe o evento, e nunca saberia que ele    │
 * │ existiu. No campo isso não é exceção — é o dia.                   │
 * │                                                                    │
 * │ Por isso o aviso é uma LINHA na tabela `aviso` (migration 059).   │
 * │ O Realtime só encurta o caminho quando há sinal; sem ele, a       │
 * │ próxima leitura traz tudo o que se perdeu.                        │
 * └────────────────────────────────────────────────────────────────────┘
 */

export interface Aviso {
  id: number
  visita_id: string | null
  tipo: 'NOVO' | 'SITUACAO' | 'REABERTO' | 'CANCELADO_OPERADORA' | 'CHEGOU' | 'SAIU'
  titulo: string
  /** A observação que o controlador escreveu ao mudar o status. */
  detalhe: string | null
  situacao_de: string | null
  situacao_para: string | null
  contrato: string | null
  servico: string | null
  autor_login: string | null
  criado_em: string
  lido: boolean
}

/** Quanto cada tipo pesa na tela. `CANCELADO_OPERADORA` é o único que
 *  para o técnico: ele pode estar a caminho do endereço agora. */
export const PESO_AVISO: Record<Aviso['tipo'], 'urgente' | 'atencao' | 'informa'> = {
  CANCELADO_OPERADORA: 'urgente',
  SAIU: 'atencao',
  REABERTO: 'atencao',
  SITUACAO: 'atencao',
  CHEGOU: 'informa',
  NOVO: 'informa',
}

export async function carregarAvisos(limite = 50): Promise<Aviso[]> {
  const { data, error } = await supabase.rpc('meus_avisos', { p_limite: limite })
  if (error) throw new Error(error.message)
  return (data ?? []) as Aviso[]
}

export async function marcarLidos(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  await supabase.rpc('marcar_avisos_lidos', { p_ids: ids })
}

/**
 * Assina os avisos DA EQUIPE, não todos.
 *
 * O filtro no servidor é o que faz isto aguentar 300 técnicos: cada
 * evento vai para os poucos aparelhos daquela equipe, em vez de para os
 * 300 que teriam de receber, avaliar o RLS e descartar.
 *
 * Devolve a função de cancelar. Chamar no cleanup do efeito **não é
 * opcional**: canal que fica aberto depois da tela morrer é conexão
 * pendurada no servidor, e é assim que se estoura o limite do plano.
 */
export function assinarAvisos(
  equipeId: string,
  aoChegar: (a: Aviso) => void,
): () => void {
  let canal: RealtimeChannel | null = null

  // O Realtime precisa do token para o RLS valer do lado dele. O
  // `supabase-js` costuma cuidar disso sozinho, mas em React Native a
  // sessão volta do AsyncStorage depois que o cliente já subiu — sem
  // reforçar aqui, a assinatura entra sem identidade e não recebe nada.
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) supabase.realtime.setAuth(data.session.access_token)

    canal = supabase
      .channel(`avisos:${equipeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'aviso',
          filter: `equipe_id=eq.${equipeId}`,
        },
        carga => {
          const novo = carga.new as Record<string, unknown>
          aoChegar({
            id: Number(novo.id),
            visita_id: (novo.visita_id as string) ?? null,
            tipo: novo.tipo as Aviso['tipo'],
            titulo: String(novo.titulo ?? ''),
            detalhe: (novo.detalhe as string) ?? null,
            situacao_de: (novo.situacao_de as string) ?? null,
            situacao_para: (novo.situacao_para as string) ?? null,
            contrato: (novo.contrato as string) ?? null,
            servico: (novo.servico as string) ?? null,
            autor_login: (novo.autor_login as string) ?? null,
            criado_em: String(novo.criado_em ?? new Date().toISOString()),
            lido: false,
          })
        },
      )
      .subscribe()
  })

  return () => { if (canal) supabase.removeChannel(canal) }
}
