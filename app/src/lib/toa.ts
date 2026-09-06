
/**
 * Leitor da planilha de atividades do TOA (Oracle Field Service) da CLARO.
 *
 * ┌─ D-013 ─────────────────────────────────────────────────────────┐
 * │ A planilha tem CABEÇALHOS REPETIDOS:                            │
 * │                                                                  │
 * │   índice 10  "Janela de Serviço"                                │
 * │   índice 11  "Janela de Serviço"                                │
 * │   índice 19  "Tipo de Atividade"  → categoria  ("Normal")       │
 * │   índice 20  "Tipo de Atividade"  → tipo real  ("Instalacao")   │
 * │                                                                  │
 * │ Qualquer leitor que monte objeto PELA CHAVE perde a primeira     │
 * │ ocorrência — sem erro, sem aviso. O tipo de atividade viraria    │
 * │ "Normal" para todas as linhas e ninguém notaria por meses.       │
 * │                                                                  │
 * │ Por isso lemos por POSIÇÃO e sufixamos as repetidas com __2,     │
 * │ __3... É o contrato que a função importar_toa() espera no banco. │
 * └──────────────────────────────────────────────────────────────────┘
 */

export type LinhaTOA = Record<string, string>

export interface ResultadoLeitura {
  linhas: LinhaTOA[]
  cabecalhos: string[]
  /** cabeçalhos que vieram repetidos, já com o sufixo aplicado */
  duplicados: string[]
  /** linhas descartadas por não ter "ID da Atividade" */
  descartadas: number
}

/** Aplica sufixo __2, __3… nas colunas de nome repetido, na ordem em que aparecem. */
export function desduplicarCabecalhos(brutos: unknown[]): {
  chaves: string[]
  duplicados: string[]
} {
  const contagem = new Map<string, number>()
  const chaves: string[] = []
  const duplicados: string[] = []

  for (const bruto of brutos) {
    const nome = String(bruto ?? '').trim()
    const n = (contagem.get(nome) ?? 0) + 1
    contagem.set(nome, n)
    if (n === 1) {
      chaves.push(nome)
    } else {
      const sufixado = `${nome}__${n}`
      chaves.push(sufixado)
      duplicados.push(sufixado)
    }
  }
  return { chaves, duplicados }
}

/** Converte a célula para texto limpo. Datas do Excel viram dd/mm/aa. */
function celulaParaTexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, '0')
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const a = String(v.getFullYear()).slice(-2)
    return `${d}/${m}/${a}`
  }
  return String(v).trim()
}

export async function lerPlanilhaTOA(arquivo: File): Promise<ResultadoLeitura> {
  const buffer = await arquivo.arrayBuffer()
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('A planilha não tem nenhuma aba legível.')

  // header:1 devolve MATRIZ (array de arrays), preservando a posição das
  // colunas. É justamente o que impede a perda das colunas repetidas.
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })

  if (matriz.length < 2) throw new Error('A planilha está vazia.')

  const { chaves, duplicados } = desduplicarCabecalhos(matriz[0])

  const linhas: LinhaTOA[] = []
  let descartadas = 0

  for (let i = 1; i < matriz.length; i++) {
    const bruta = matriz[i]
    const obj: LinhaTOA = {}
    for (let c = 0; c < chaves.length; c++) {
      const texto = celulaParaTexto(bruta[c])
      if (texto !== '') obj[chaves[c]] = texto
    }
    // Sem ID da Atividade não há chave de deduplicação (D-004): a linha
    // não pode entrar, senão a reimportação duplicaria.
    if (obj['ID da Atividade']) linhas.push(obj)
    else descartadas++
  }

  return { linhas, cabecalhos: chaves, duplicados, descartadas }
}

/** Confere se a planilha é mesmo do TOA antes de subir qualquer coisa. */
export function validarPlanilha(r: ResultadoLeitura): string[] {
  const problemas: string[] = []
  const obrigatorias = ['ID da Atividade', 'Data', 'Status da Atividade']

  for (const col of obrigatorias) {
    if (!r.cabecalhos.includes(col)) {
      problemas.push(`Coluna obrigatória ausente: "${col}"`)
    }
  }
  if (!r.cabecalhos.includes('Tipo de Atividade__2')) {
    problemas.push(
      'Não encontrei a segunda coluna "Tipo de Atividade". ' +
      'Esta planilha parece ter layout diferente do esperado — ' +
      'o tipo real da atividade ficaria vazio.',
    )
  }
  if (r.linhas.length === 0) {
    problemas.push('Nenhuma linha com "ID da Atividade" preenchido.')
  }
  return problemas
}

/** Quantas O.S. a linha carrega (1..10). Só para mostrar na prévia. */
export function contarOS(linha: LinhaTOA): number {
  let n = 0
  for (let j = 1; j <= 10; j++) if (linha[`Número da O.S ${j}`]) n++
  return n
}
