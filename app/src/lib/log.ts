/**
 * O LOG do contrato (144) — quantas vezes ele já voltou para a agenda.
 *
 * > "o log pra você que não sabe é quantas vezes ele já voltou na
 * >  agenda, porém a própria planilha já informa, é só você implantar
 * >  em nossas visões do técnico e serviço" — Emanuel, 26/10
 *
 * ┌─ o dado é do TOA, não é conta nossa ────────────────────────────┐
 * │ Sai da coluna "Contador de log" da planilha, que a importação já │
 * │ guarda em `dados_origem`. Não confundir com a `reincidencia`     │
 * │ (033), que é NOSSA derivação — visita anterior no mesmo contrato │
 * │ dentro do que já importamos. O LOG é o número da CLARO e conta o │
 * │ histórico inteiro dela, inclusive o que nunca passou por aqui.   │
 * │ Os dois podem divergir, e é certo que divirjam.                  │
 * │                                                                   │
 * │ Medido em 26/10, nos últimos dias: 1.964 em LOG 0, 201 em 1, 48  │
 * │ em 2, 6 em 3, 4 em 4, um em 5 e um em 8. A planilha traz a coluna │
 * │ em 2.453 das 2.460 visitas produtivas — e em NENHUMA das 1.003   │
 * │ de jornada, que não são contrato e por isso não têm LOG.         │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Mora em `lib/` e não no componente porque as métricas do Dashboard
 * também contam LOG, e duas cópias da mesma regra divergem.
 */

/** A partir daqui o selo fica preto — decisão do Emanuel (26/10):
 *  "de 3 pra cima já precisa ficar preto". */
export const LOG_GRAVE = 3

/** Lê o "Contador de log" como veio da planilha. Texto vazio, ausente e
 *  lixo devolvem NULO — que a tela escreve como "não sei", nunca como
 *  zero: zero é a afirmação "nunca voltou" (regra 6). */
export function lerLog(bruto?: string | number | null): number | null {
  if (bruto === null || bruto === undefined || bruto === '') return null
  const n = Number(bruto)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}
