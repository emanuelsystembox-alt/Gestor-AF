import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/**
 * O controle vendo o campo agir, sem clicar em atualizar.
 *
 * ┌─ POR QUE `visita_evento`, E NÃO `visita` NEM `aviso` ────────────┐
 * │ `aviso` (059) é cego para `origem = 'MOBILE'` de propósito — o    │
 * │ técnico não precisa ser avisado do que ele mesmo fez. Só que é    │
 * │ exatamente isso que o controlador quer ver: ele saindo,           │
 * │ chegando, baixando.                                                │
 * │                                                                    │
 * │ `visita` traria a linha inteira pela rede a cada mudança — nome,   │
 * │ telefone e endereço de assinante inclusive. `visita_evento` é      │
 * │ magra e não tem nada disso.                                        │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Quem decide quem recebe o quê continua sendo o RLS: a policy
 * `evento_leitura` é avaliada pelo Realtime para cada assinante.
 */

export interface MudancaAoVivo {
  visita_id: string
  tipo: string
  origem: string | null
  criado_em: string
}

/**
 * Junta o que chega numa rajada antes de avisar a tela.
 *
 * Uma importação do TOA insere centenas de eventos em segundos. Sem
 * agrupar, a lista do controlador recarregaria centenas de vezes e a
 * tela ficaria inutilizável justamente no momento de maior movimento.
 */
const AGRUPAR_MS = 1500

export function useMudancasAoVivo(
  aoMudar: (quantas: number, ultimas: MudancaAoVivo[]) => void,
  ligado = true,
) {
  const [conectado, setConectado] = useState(false)
  // O callback muda a cada render; guardar em ref evita reassinar o
  // canal toda vez — reassinar é abrir e fechar conexão no servidor.
  const cb = useRef(aoMudar)
  cb.current = aoMudar

  useEffect(() => {
    if (!ligado) return
    let pendentes: MudancaAoVivo[] = []
    let timer: ReturnType<typeof setTimeout> | null = null

    const canal = supabase
      .channel('controle:eventos')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'visita_evento' },
        carga => {
          const e = carga.new as Record<string, unknown>
          pendentes.push({
            visita_id: String(e.visita_id ?? ''),
            tipo: String(e.tipo ?? ''),
            origem: (e.origem as string) ?? null,
            criado_em: String(e.criado_em ?? new Date().toISOString()),
          })
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const lote = pendentes
            pendentes = []
            timer = null
            cb.current(lote.length, lote)
          }, AGRUPAR_MS)
        },
      )
      .subscribe(estado => setConectado(estado === 'SUBSCRIBED'))

    return () => {
      if (timer) clearTimeout(timer)
      // Sem isto, cada troca de tela deixa uma conexão pendurada no
      // servidor — e o plano tem teto de conexões simultâneas, não de
      // mensagens.
      supabase.removeChannel(canal)
      setConectado(false)
    }
  }, [ligado])

  return conectado
}
