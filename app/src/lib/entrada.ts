/**
 * Os números da tela de entrada — públicos: aparecem ANTES do login, para
 * qualquer um com o endereço do site.
 *
 * ┌─ DE ONDE VÊM (D-175) ─────────────────────────────────────────────┐
 * │ São ILUSTRATIVOS, por decisão do Emanuel (27/09: "pode inventar   │
 * │ os dados", "coloque dados bons"). Não saem do banco e não são     │
 * │ medição: a entrada é vitrine, não painel. Por isso a `fonte` diz  │
 * │ "ilustrativos" na própria tela.                                    │
 * │                                                                   │
 * │ Quando houver número de verdade (o analítico AFLINE 360, a        │
 * │ pesquisa da CLARO), troque aqui e escreva a fonte real. Cada      │
 * │ bloco some sozinho se o campo dele ficar vazio.                   │
 * │                                                                   │
 * │ A curva do ano vai só até o mês corrente: mês que não aconteceu   │
 * │ é `null`, não um número bonito no futuro.                          │
 * └───────────────────────────────────────────────────────────────────┘
 */

export interface IndicadoresEntrada {
  /** De onde saiu o número — aparece no rodapé da seção. */
  fonte: string
  /** Clientes conectados (total) e quanto cresce por mês, se houver. */
  clientes?: { total: number; porMes?: string; ultimos10Meses?: number[] }
  /** Os três indicadores de qualidade, em %, e a variação no ano. */
  satisfacao?: { valor: number; variacao?: string }
  qualidadeTecnica?: { valor: number; variacao?: string }
  nps?: { valor: number; variacao?: string }
  /** A curva do ano: 12 meses de cada série (null = mês sem medida). */
  evolucao?: {
    ano: number
    satisfacao: (number | null)[]
    qualidadeTecnica: (number | null)[]
    nps: (number | null)[]
  }
}

export const INDICADORES_ENTRADA: IndicadoresEntrada | null = {
  fonte: 'indicadores ilustrativos da AFLINE',
  clientes: {
    total: 48270,
    porMes: '+1,9 mil/mês',
    ultimos10Meses: [38, 46, 44, 55, 58, 64, 66, 74, 82, 92],
  },
  satisfacao: { valor: 96.8, variacao: '+8,8 pts' },
  qualidadeTecnica: { valor: 95.2, variacao: '+11,2 pts' },
  nps: { valor: 87, variacao: '+25' },
  evolucao: {
    ano: 2026,
    //          J     F     M     A     M     J     J     A     S    O     N     D
    satisfacao:       [88, 89, 90, 90.5, 91.5, 92.5, 94, 95.6, 96.8, null, null, null],
    qualidadeTecnica: [84, 85, 87, 86, 88, 90, 91.5, 93.4, 95.2, null, null, null],
    nps:              [62, 64, 67, 70, 73, 77, 80, 84, 87, null, null, null],
  },
}
