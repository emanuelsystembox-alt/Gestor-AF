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

/**
 * A cor do LOG, a mesma no claro e no escuro (hex fixo — as faixas de cor
 * do tema claro invertem, D-303). Nulo = LOG 0, o neutro de sempre.
 *
 * > "log 0 como esta, log 1, amarelo claro, visivel para ler, log 2,
 * >  laranja claro, visivel para ler, log 3, vermelho, log 4 pra cima
 * >  preto" — Emanuel, 06/11 (revê a de 26/10: preto era a partir de 3)
 *
 * `LOG_GRAVE` (3) continua sendo o corte das CONTAGENS ("3 ou mais"); a
 * cor é outra coisa. Vale para o selo e para os marcadores manuais "LOG n".
 */
export const LOG_PRETO = 4
export function corDoLog(n: number | null): { fundo: string; texto: string; borda: string } | null {
  if (n == null || n <= 0) return null
  if (n === 1) return { fundo: '#fef08a', texto: '#713f12', borda: '#eab308' }   // amarelo claro
  if (n === 2) return { fundo: '#fed7aa', texto: '#7c2d12', borda: '#f97316' }   // laranja claro
  if (n < LOG_PRETO) return { fundo: '#dc2626', texto: '#ffffff', borda: '#991b1b' } // vermelho
  return { fundo: '#000000', texto: '#ffffff', borda: '#f59e0b' }                  // preto, aro âmbar
}
