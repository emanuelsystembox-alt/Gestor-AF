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
