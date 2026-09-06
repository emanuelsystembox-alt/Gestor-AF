/** Teste do leitor da planilha do TOA contra o arquivo real.
 *  Rode com:  npx tsx scripts/testar-parser.ts <caminho.xlsx>  */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { lerPlanilhaTOA, validarPlanilha, contarOS } from '../src/lib/toa'

const caminho = process.argv[2]
if (!caminho) { console.error('Informe o caminho da planilha.'); process.exit(1) }

const buf = readFileSync(caminho)
const arquivo = new File([buf], basename(caminho))

const r = await lerPlanilhaTOA(arquivo)

console.log('Arquivo .............', basename(caminho))
console.log('Colunas .............', r.cabecalhos.length)
console.log('Linhas válidas ......', r.linhas.length)
console.log('Descartadas .........', r.descartadas)
console.log('Cabeçalhos repetidos:', r.duplicados)

const problemas = validarPlanilha(r)
console.log('Validação ...........', problemas.length ? problemas : 'OK')

// O ponto crítico do D-013: as duas colunas "Tipo de Atividade"
const amostra = r.linhas.slice(0, 3)
console.log('\n--- D-013: as duas colunas sobreviveram? ---')
for (const l of amostra) {
  console.log(
    `  categoria="${l['Tipo de Atividade'] ?? '(vazio)'}"`.padEnd(32),
    `tipo real="${l['Tipo de Atividade__2'] ?? '(VAZIO — BUG!)'}"`,
  )
}

const dist: Record<number, number> = {}
for (const l of r.linhas) { const n = contarOS(l); dist[n] = (dist[n] ?? 0) + 1 }
console.log('\nO.S. por visita:', dist)
console.log('Total de O.S. ...', r.linhas.reduce((s, l) => s + contarOS(l), 0))

const tipos = new Set(r.linhas.map(l => l['Tipo de Atividade__2']).filter(Boolean))
console.log('Tipos de atividade distintos:', tipos.size)
