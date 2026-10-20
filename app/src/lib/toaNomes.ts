/**
 * O nome do arquivo do TOA — usado pela web e pela extensão (D-193).
 */

/**
 * O bucket que o NOME do arquivo diz — a mesma leitura de
 * `bucket_do_arquivo()` no banco (103, D-180).
 */
export function bucketDoNome(nome: string): string | null {
  const m = /^Atividades-(.+?)_\d{2}_\d{2}_\d{2}(?:\s*\(\d+\))?\.(?:xlsx|xls|csv)$/i.exec(nome.trim())
  return m ? m[1].toUpperCase() : null
}

/** `Atividades-MAN-AFLINE_19_10_26.xlsx` — o nome que o TOA dá, para quando ele não disser. */
export function nomePadrao(bucket: string, diaIso: string): string {
  const [a, m, d] = diaIso.split('-')
  return `Atividades-${bucket}_${d}_${m}_${a.slice(2)}.xlsx`
}
