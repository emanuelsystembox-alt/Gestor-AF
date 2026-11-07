/**
 * O LOG do contrato (144) — quantas vezes ele já voltou para a agenda,
 * pela contagem do TOA ("Contador de log" da planilha, em `dados_origem`).
 *
 * Cópia DECLARADA de `app/src/lib/log.ts` (D-112): mudou lá, mude aqui.
 *
 * > "acima de 2 os log já precisam mudar de cor, de 3 pra cima já precisa
 * >  ficar preto" — Emanuel, 26/10
 *
 * Não é a `reincidencia` (033), que é derivação nossa: o LOG é o número da
 * CLARO e conta o histórico inteiro dela. Os dois podem divergir.
 */

/** A partir daqui o selo fica preto. */
export const LOG_GRAVE = 3

/** Lê o "Contador de log" como veio da planilha. Vazio, ausente e lixo
 *  devolvem NULO — "não sei", nunca zero: zero é a afirmação "nunca
 *  voltou" (regra 6). */
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
