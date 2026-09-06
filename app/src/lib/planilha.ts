import * as XLSX from 'xlsx'
import { desduplicarCabecalhos } from './toa'

export interface Leitura {
  linhas: Record<string, string>[]
  cabecalhos: string[]
  duplicados: string[]
  abas: string[]
}

/**
 * Leitor genérico de planilha.
 *
 * Lê por POSIÇÃO e desduplica cabeçalhos repetidos — mesma regra do
 * leitor do TOA (D-013). Nenhuma planilha desta operação pode ser lida
 * "pela chave": mais de uma delas repete nome de coluna.
 */
export async function lerPlanilha(arquivo: File, aba?: string): Promise<Leitura> {
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true })
  const nome = aba && wb.SheetNames.includes(aba) ? aba : wb.SheetNames[0]
  const ws = wb.Sheets[nome]
  if (!ws) throw new Error('A planilha não tem nenhuma aba legível.')

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, raw: false, defval: '', blankrows: false,
  })
  if (matriz.length < 2) throw new Error('A planilha está vazia.')

  const { chaves, duplicados } = desduplicarCabecalhos(matriz[0])
  const linhas: Record<string, string>[] = []

  for (let i = 1; i < matriz.length; i++) {
    const o: Record<string, string> = {}
    let vazia = true
    for (let c = 0; c < chaves.length; c++) {
      const v = matriz[i][c]
      const t = v === null || v === undefined ? '' : String(v).trim()
      if (t !== '') { o[chaves[c]] = t; vazia = false }
    }
    if (!vazia) linhas.push(o)
  }
  return { linhas, cabecalhos: chaves, duplicados, abas: wb.SheetNames }
}
