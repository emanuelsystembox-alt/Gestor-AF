/**
 * O vocabulário do negócio, do lado do celular.
 *
 * Mesmos códigos e mesmas cores da tela web (`app/src/lib/supabase.ts`)
 * — um técnico e um controlador olhando o mesmo contrato têm de ver a
 * mesma palavra. Aqui as cores são literais em vez de `var(--st-*)`
 * porque no React Native não há CSS.
 */

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

export const SITUACAO_INFO: Record<Situacao, { label: string; cor: string }> = {
  ENTRADA:         { label: 'Na entrada',      cor: '#64748b' },
  ATRIBUIDA:       { label: 'Atribuída',       cor: '#8b5cf6' },
  EM_DESLOCAMENTO: { label: 'Em deslocamento', cor: '#0ea5e9' },
  EM_EXECUCAO:     { label: 'Em execução',     cor: '#3b82f6' },
  CONCLUIDA:       { label: 'Concluída',       cor: '#16a34a' },
  // Cancelada nao e cinza -- cinza e a cor do "nao sei". Espelha
  // `--st-cancelada` da web (D-011: a rampa e a mesma nos dois).
  CANCELADA:       { label: 'Cancelada',       cor: '#d9736e' },
  REAGENDAMENTO:   { label: 'Reagendamento',   cor: '#f59e0b' },
  COM_IMPEDIMENTO: { label: 'Com impedimento', cor: '#ea580c' },
}

export function rotuloSituacao(s: string): string {
  return SITUACAO_INFO[s as Situacao]?.label ?? s
}
export function corSituacao(s: string): string {
  return SITUACAO_INFO[s as Situacao]?.cor ?? '#64748b'
}

/** Ainda pede ação do técnico. */
export const EM_ABERTO: string[] = [
  'ENTRADA', 'ATRIBUIDA', 'EM_DESLOCAMENTO', 'EM_EXECUCAO', 'COM_IMPEDIMENTO',
]

/**
 * Encerrado. Espelha `situacoes_terminais()` (migration 035) — e é a
 * lista que o banco usa para recusar a volta pela mão do técnico
 * (migration 055-H). A tela não decide isso; ela só evita mostrar um
 * botão que já se sabe que vai falhar.
 */
export const TERMINAIS: string[] = ['CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO']

export const ehTerminal = (s: string) => TERMINAIS.includes(s)

/**
 * Os tipos de evidência que o TOA/CLARO já pedia no sistema atual, mais
 * `LIVRE`. A coluna `evidencia.tipo` é texto: tipo novo entra sem
 * migration — a lista aqui é só o atalho da tela.
 */
export const TIPOS_EVIDENCIA = [
  { chave: 'GEOLOCALIZACAO', rotulo: 'Chegada / fachada' },
  { chave: 'MEDICAO_SINAL',  rotulo: 'Medição de sinal' },
  { chave: 'TUBULACAO',      rotulo: 'Tubulação / rede' },
  { chave: 'NR35',           rotulo: 'NR-35 (altura)' },
  { chave: 'CLIENTE_AUSENTE',rotulo: 'Cliente ausente' },
  { chave: 'URA',            rotulo: 'URA / protocolo' },
  { chave: 'LIVRE',          rotulo: 'Outra' },
] as const

export function rotuloEvidencia(t: string): string {
  return TIPOS_EVIDENCIA.find(x => x.chave === t)?.rotulo ?? t
}

/** O que o histórico chama cada evento. Igual em `app/src/lib/eventos.ts`. */
export const ROTULO_EVENTO: Record<string, string> = {
  SITUACAO: 'Mudou a situação',
  BAIXA: 'Baixa',
  EVIDENCIA: 'Evidência',
  EQUIPAMENTO: 'Equipamento',
  IMPORTADA: 'Veio do TOA',
  ATRIBUIDA: 'Atribuída',
  TRANSFERIDA: 'Transferida',
  CADASTRO: 'Cadastro manual',
  REVERSAO: 'Situação revertida',
}

export const rotuloEvento = (t: string) => ROTULO_EVENTO[t] ?? t
