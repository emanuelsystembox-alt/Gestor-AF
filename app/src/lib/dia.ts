import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { isoLocal } from './formato'

/**
 * O dia da tela é HOJE. Ponto.
 *
 * ┌─ o que mudou, e por quê ─────────────────────────────────────────┐
 * │ Serviços, Equipes, Rota e Relatórios abriam no ÚLTIMO DIA COM     │
 * │ VISITA, não em hoje. A intenção era boa: se a importação mais     │
 * │ recente é de ontem, abrir em hoje mostra tela vazia.              │
 * │                                                                   │
 * │ Só que o preço disso é a tela MENTIR a data. Em 10/09 o painel    │
 * │ abria mostrando o movimento de 09/09 — com o número 09/09 escrito │
 * │ num campo pequeno no topo, que ninguém lê quando os números       │
 * │ abaixo parecem os de hoje. Um COP olha "165 concluídas" e         │
 * │ entende "165 concluídas hoje".                                    │
 * │                                                                   │
 * │ > "preciso que nosso sistema quando virar o dia ele mostre        │
 * │ >  somente coisas do dia, se não tiver nada, ele não mostra nada" │
 * │ >  — Emanuel                                                      │
 * │                                                                   │
 * │ Então: hoje é hoje, e dia vazio aparece vazio. Tela vazia é uma   │
 * │ INFORMAÇÃO ("ainda não importaram"), não um defeito a esconder —  │
 * │ é a mesma regra do D-117: quando o sistema não sabe, ele diz que  │
 * │ não sabe, em vez de mostrar outro número no lugar.                │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * O que se perdeu com isso — descobrir sozinho qual foi o último dia
 * com movimento — volta como ATALHO, não como padrão: este hook diz
 * qual é esse dia, e a tela oferece um clique para ir até lá. A
 * diferença é quem decide.
 */
export function useUltimoDiaComVisita(): string | null {
  const [dia, setDia] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.from('visita').select('data_agendada')
      .is('excluido_em', null)
      .order('data_agendada', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (!vivo) return
        const d = (data as { data_agendada: string }[] | null)?.[0]?.data_agendada ?? null
        setDia(d)
      })
    return () => { vivo = false }
  }, [])

  return dia
}

/**
 * O último dia com movimento, mas só quando ele é OUTRO dia.
 *
 * Serve para a tela não oferecer "ir para 10/09" no dia 10/09 — atalho
 * que não leva a lugar nenhum é ruído, e ensina a ignorar o aviso.
 */
export function useDiaAnteriorComMovimento(dataNaTela: string): string | null {
  const ultimo = useUltimoDiaComVisita()
  if (!ultimo) return null
  if (!dataNaTela || ultimo === dataNaTela) return null
  return ultimo
}

/** `hoje`, do relógio de quem olha — nunca `toISOString()` (D-084). */
export const hoje = () => isoLocal()
