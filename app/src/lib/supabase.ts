import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. ' +
    'Copie app/.env.example para app/.env e preencha.',
  )
}

/**
 * Cliente único para toda a aplicação.
 *
 * A chave publishable é segura no navegador — ela não dá acesso a nada
 * por si só. Quem decide o que cada pessoa enxerga é o Row Level
 * Security no Postgres (migration 005). Se a interface for burlada, o
 * banco simplesmente não devolve a linha.
 */
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/** Situações possíveis de uma visita (espelha o CHECK da tabela). */
export const SITUACOES = [
  'ENTRADA',
  'ATRIBUIDA',
  'EM_DESLOCAMENTO',
  'EM_EXECUCAO',
  'CONCLUIDA',
  'CANCELADA',
  'REAGENDAMENTO',
  'COM_IMPEDIMENTO',
] as const

export type Situacao = (typeof SITUACOES)[number]

/** Rótulo legível + cor. Mantido em UM lugar só para a tela inteira
 *  falar a mesma língua — tabela, card e futuro mapa. */
export const SITUACAO_INFO: Record<Situacao, { label: string; cor: string }> = {
  ENTRADA:         { label: 'Na entrada',     cor: 'var(--st-entrada)' },
  ATRIBUIDA:       { label: 'Atribuída',      cor: 'var(--st-atribuida)' },
  EM_DESLOCAMENTO: { label: 'Em deslocamento',cor: 'var(--st-deslocamento)' },
  EM_EXECUCAO:     { label: 'Em execução',    cor: 'var(--st-execucao)' },
  CONCLUIDA:       { label: 'Concluída',      cor: 'var(--st-concluida)' },
  CANCELADA:       { label: 'Cancelada',      cor: 'var(--st-cancelada)' },
  REAGENDAMENTO:   { label: 'Reagendamento',  cor: 'var(--st-reagendamento)' },
  COM_IMPEDIMENTO: { label: 'Com impedimento',cor: 'var(--st-impedimento)' },
}

/** Situações que ainda exigem ação — o que o COP precisa olhar. */
export const EM_ABERTO: Situacao[] = [
  'ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'EM_EXECUCAO', 'COM_IMPEDIMENTO',
]
