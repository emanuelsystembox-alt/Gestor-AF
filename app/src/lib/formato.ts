/**
 * Formatos que a tela inteira precisa falar igual.
 *
 * Pontuação com quatro casas (`1,4648`) é o que o banco guarda e o que
 * a planilha de faturamento precisa somar. Na TELA, quatro casas só
 * atrapalham: ninguém compara `20,3331` com `17,3176` de relance, e a
 * coluna fica larga à toa. Duas casas e a unidade escrita — `20,33 pts`
 * — é o que se lê.
 *
 * O EXPORT continua com quatro casas, de propósito: arredondar cada
 * linha antes de somar centenas delas move dinheiro de verdade.
 * Ver `lib/relatorio.ts`.
 */

/** `20,33` — duas casas, vírgula decimal. */
export const num2 = (n: number | string | null | undefined) =>
  n == null ? '' : Number(n).toFixed(2).replace('.', ',')

/** `20,33 pts` — como aparece em etiqueta, célula e total. */
export const pts = (n: number | string | null | undefined) =>
  n == null ? '' : `${num2(n)} pts`

/** `R$ 1.157,10` */
export const reais = (n: number | string | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('pt-BR',
    { style: 'currency', currency: 'BRL' })

/** `07/09` — dia e mês, para coluna estreita de lista. */
export const diaMes = (iso: string) =>
  new Date(iso + 'T12:00').toLocaleDateString('pt-BR',
    { day: '2-digit', month: '2-digit' })

/** `07/09/2026` */
export const dataBR = (iso: string) =>
  new Date(iso + 'T12:00').toLocaleDateString('pt-BR')

/** `seg`, `ter`… — ajuda a ler a lista de um contrato dia a dia. */
export const diaSemana = (iso: string) =>
  new Date(iso + 'T12:00')
    .toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')
