/**
 * O humor das equipes como planilha (150).
 *
 * > "faça o time conseguir baixar essa planilha depois se quiser no
 * >  relatórios, o humor dos técnicos" — Emanuel, 26/10
 *
 * A montagem mora aqui, longe da tela, pelo mesmo motivo de
 * `lib/relatorio.ts`: a coluna é contrato com quem abre o arquivo, e
 * contrato não se escreve no meio do JSX.
 *
 * ⚠ Dado sensível de empregado. Quem baixa precisa de `campo.humor`, a
 * MESMA permissão que abre a tela — senão a planilha entregaria o que a
 * tela esconde.
 */

/** A linha que `humor_das_equipes` (146) devolve. */
export interface HumorLinha {
  dia: string
  tecnico_id: string
  tecnico: string
  equipe: string | null
  base: string | null
  humor: string | null
  respondido_em: string | null
}

/** Os cinco humores, na ordem em que o técnico os vê no aplicativo. */
export const HUMOR_ROTULO: Record<string, string> = {
  FELIZ: 'Feliz',
  INDIFERENTE: 'Indiferente',
  DESANIMADO: 'Desanimado',
  TRISTE: 'Triste',
  ESTRESSADO: 'Estressado',
}

/** Quem pede atenção — a mesma leitura da tela de Humor. */
const PEDE_ATENCAO = new Set(['DESANIMADO', 'TRISTE', 'ESTRESSADO'])

const dataBr = (d: string) =>
  new Date(d + 'T12:00').toLocaleDateString('pt-BR')

const horaBr = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  : ''

/**
 * A planilha: uma linha por técnico por dia.
 *
 * "Sem resposta" vai ESCRITO, e não como célula vazia: vazio no Excel
 * passa por erro de exportação, e aqui é informação — o técnico tinha
 * visita no dia e não respondeu (regra 6, zero não é desconhecido).
 */
export function linhasHumor(linhas: HumorLinha[]): string[][] {
  const cab = [
    'Dia', 'Técnico', 'Equipe', 'Cidade',
    'Como está', 'Pede atenção', 'Respondeu às',
  ]
  const corpo = [...linhas]
    // Mesma ordem da tela: o dia mais recente primeiro, e dentro do dia
    // quem não está bem na frente — a planilha é lida para agir.
    .sort((a, b) => b.dia.localeCompare(a.dia)
      || Number(PEDE_ATENCAO.has(b.humor ?? '')) - Number(PEDE_ATENCAO.has(a.humor ?? ''))
      || a.tecnico.localeCompare(b.tecnico))
    .map(l => [
      dataBr(l.dia),
      l.tecnico,
      l.equipe ?? '',
      l.base ?? '',
      l.humor ? (HUMOR_ROTULO[l.humor] ?? l.humor) : 'Sem resposta',
      l.humor && PEDE_ATENCAO.has(l.humor) ? 'SIM' : '',
      horaBr(l.respondido_em),
    ])
  return [cab, ...corpo]
}
