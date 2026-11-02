import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Os sinais do contrato, como o TOA mostra no Gantt (174, D-261): prédio,
 * casa e o vai-e-volta da revisita.
 *
 * > "precisamos sinalizar nossos contratos igual ao do TOA" — Emanuel, 02/11
 *
 * Quem decide é o banco (`sinais_das_visitas`): a edificação pela regra da
 * D-198 (APTO/LOJA = prédio; CASA/BECO = casa) e o vai-e-volta pela regra
 * que o Emanuel ditou — VT da VT, retorno do retorno, ou a mesma O.S. de
 * instalação que já veio e não foi concluída, nos 30 dias antes. Não é a
 * revisita da D-245 (a do card do técnico): não troque uma pela outra.
 *
 * Desenhos em SVG, não emoji: emoji muda de cara em cada sistema e some no
 * tema escuro. A cor do vai-e-volta é a laranja do TOA, para quem vem de lá
 * reconhecer de primeira.
 */

export interface SinalContrato {
  visita_id: string
  edificacao: 'PREDIO' | 'CASA' | null
  revisita: boolean
  revisita_motivo: 'VT_DA_VT' | 'RETORNO_DO_RETORNO' | 'OS_NAO_CONCLUIDA' | null
  anterior_data: string | null
  anterior_situacao: string | null
  anterior_grupo: string | null
}

const MOTIVO: Record<string, string> = {
  VT_DA_VT: 'VT da VT',
  RETORNO_DO_RETORNO: 'retorno do retorno',
  OS_NAO_CONCLUIDA: 'a mesma O.S. já veio e não foi concluída',
}
const SITUACAO: Record<string, string> = {
  ENTRADA: 'na entrada', ATRIBUIDA: 'atribuída', EM_DESLOCAMENTO: 'em deslocamento',
  EM_EXECUCAO: 'em execução', CONCLUIDA: 'concluída', CANCELADA: 'cancelada',
  REAGENDAMENTO: 'reagendada', COM_IMPEDIMENTO: 'com ticket',
}

/** O texto da dica do vai-e-volta: o porquê e a visita anterior. */
export function textoRevisita(s: SinalContrato): string {
  const quando = s.anterior_data ? s.anterior_data.split('-').reverse().join('/') : '?'
  return `Revisita: ${MOTIVO[s.revisita_motivo ?? ''] ?? 'voltou'} — anterior em ${quando}`
    + (s.anterior_grupo ? `, ${s.anterior_grupo}` : '')
    + (s.anterior_situacao ? ` (${SITUACAO[s.anterior_situacao] ?? s.anterior_situacao.toLowerCase()})` : '')
}

/** Lê os sinais em lote (como o local da baixa). `versao` força reler. */
const LOTE = 400
export function useSinaisDasVisitas(ids: string[], versao = 0): Map<string, SinalContrato> {
  const [m, setM] = useState<Map<string, SinalContrato>>(new Map())
  // A chave é o conjunto, não a referência do array (refeito a cada render).
  const chave = ids.join(',')
  useEffect(() => {
    if (!chave) { setM(new Map()); return }
    let vivo = true
    ;(async () => {
      const lista = chave.split(',')
      const novo = new Map<string, SinalContrato>()
      for (let i = 0; i < lista.length; i += LOTE) {
        const { data, error } = await supabase.rpc('sinais_das_visitas', { p_visitas: lista.slice(i, i + LOTE) })
        if (error || !vivo) return
        for (const s of (data ?? []) as SinalContrato[]) novo.set(s.visita_id, s)
      }
      if (vivo) setM(novo)
    })()
    return () => { vivo = false }
  }, [chave, versao])
  return m
}

const Predio = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="h-full w-full" fill="currentColor">
    <path d="M3 1.5h7v13H3zM10 5.5h3v9h-3z" opacity=".25" />
    <path d="M3 1h7.5v4H13.5v10H2.5V1zm1 1v12h2v-2.5h1.5V14h2V2zm6.5 4.5V14h2V6.5zM5 3h1v1.2H5zm2 0h1v1.2H7zM5 5.4h1v1.2H5zm2 0h1v1.2H7zM5 7.8h1V9H5zm2 0h1V9H7zm4.2.2h.9v1.2h-.9zm0 2.4h.9v1.2h-.9z" />
  </svg>
)
const Casa = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="h-full w-full" fill="currentColor">
    <path d="M8 2 2 7.2V14h4.5v-4h3v4H14V7.2z" opacity=".25" />
    <path d="M8 1.3 1 7.4l.7.8.8-.7V14.5h4.5v-4h2v4h4.5V7.5l.8.7.7-.8zM12.5 6.6v6.9h-2.5v-4H6v4H3.5V6.6L8 2.6z" />
  </svg>
)
const VaiEVolta = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="h-full w-full" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6.5h9.5l-2.5-2.5M13.5 9.5H4l2.5 2.5" />
  </svg>
)

/**
 * Os sinais lado a lado. `tamanho`: sm = linha de tabela e cartão da Rota;
 * md = cabeçalho do contrato. Sem sinal, não desenha nada (não ocupa lugar).
 */
export function SinaisContrato({ s, tamanho = 'sm' }: { s?: SinalContrato; tamanho?: 'sm' | 'md' }) {
  if (!s || (!s.edificacao && !s.revisita)) return null
  const caixa = tamanho === 'md' ? 'h-5 w-5 p-0.5' : 'h-4 w-4 p-[1px]'
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 align-middle">
      {s.edificacao && (
        <span role="img" title={s.edificacao === 'PREDIO' ? 'Prédio (apartamento ou loja)' : 'Casa'}
          aria-label={s.edificacao === 'PREDIO' ? 'Prédio' : 'Casa'}
          className={`${caixa} inline-block rounded-sm bg-graf-800 text-graf-300`}>
          {s.edificacao === 'PREDIO' ? <Predio /> : <Casa />}
        </span>
      )}
      {s.revisita && (
        <span role="img" title={textoRevisita(s)} aria-label={textoRevisita(s)}
          className={`${caixa} inline-block rounded-sm bg-orange-500 text-white`}>
          <VaiEVolta />
        </span>
      )}
    </span>
  )
}
