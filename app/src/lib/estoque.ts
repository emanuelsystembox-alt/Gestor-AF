import { lerPlanilha } from './planilha'

/**
 * O leitor da carga do Atlas.
 *
 * ┌─ SÃO DOIS FORMATOS, e os dois entram (como no TOA, D-091) ───────┐
 * │ `CARGA AFLINE.xlsx`   15.603 linhas · a posição inteira da        │
 * │                       empreiteira. Cabeçalho "Número Série",      │
 * │                       "Estado", "Nome do Local", "Responsavél".   │
 * │                                                                   │
 * │ `CONSULTA ATLAS.xlsx` consulta pontual · cabeçalho diferente:     │
 * │                       "Série / Ender. Princ." (os DOIS campos     │
 * │                       colados num só), "Local", "Tipo Local",     │
 * │                       "Contrato NETSMS", "Reusos".                │
 * │                                                                   │
 * │ Descobrir o formato pelo CABEÇALHO, não perguntar ao usuário: a   │
 * │ planilha sabe o que é, e quem exporta não escolhe o formato.      │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * As colunas vêm com os erros de digitação da fonte — `Responsavél`,
 * `Classificacação Material`, `Endereçavel Principal`. Ler pelo nome
 * "certo" perderia a coluna em silêncio, então lê-se pelo nome ERRADO,
 * que é o que está no arquivo.
 */

/** Uma peça, já no vocabulário do nosso banco. */
export interface LinhaEstoque {
  serial: string
  enderecavel?: string
  tipo?: string
  modelo?: string
  item_jde?: string
  material_sap?: string
  operacao?: string
  estado_atlas?: string
  local_atlas?: string
  tipo_local_atlas?: string
  responsavel_atlas?: string
  contrato_atlas?: string
  classificacao?: string
  empresa_material?: string
  reusos?: string
  atlas_em?: string
  /** A linha crua, para o que não soubermos ler hoje não se perder. */
  [extra: string]: string | undefined
}

export type FormatoEstoque = 'CARGA' | 'CONSULTA'

export interface LeituraEstoque {
  formato: FormatoEstoque
  linhas: LinhaEstoque[]
  /** Linhas descartadas por não terem número de série utilizável. */
  semSerial: number
  /** Datas que ficaram NULAS por serem ambíguas — ver `dataAtlas`. */
  dataAmbigua: number
  cabecalhos: string[]
}

/**
 * "18/06/2021 14:50:27" → ISO.  "9/12/26 17:19" → **nulo**.
 *
 * ┌─ por que a segunda não é lida ───────────────────────────────────┐
 * │ `9/12/26` é 9 de dezembro ou 12 de setembro? O primeiro arquivo   │
 * │ usa dia/mês; o segundo veio de uma tela em inglês e provavelmente │
 * │ usa mês/dia. "Provavelmente" não serve para carimbar data de      │
 * │ movimentação de patrimônio: erra em 11 dos 12 meses e ninguém     │
 * │ percebe.                                                          │
 * │                                                                   │
 * │ Então só lê o que é inequívoco: dia/mês/ano com ano de QUATRO     │
 * │ dígitos. O resto fica NULO e continua guardado cru em             │
 * │ `dados_origem` — o dado não se perde, só não vira afirmação       │
 * │ nossa (D-117). A tela escreve quantas ficaram sem data.           │
 * └───────────────────────────────────────────────────────────────────┘
 */
export function dataAtlas(texto: string | undefined): string | null {
  const t = (texto ?? '').trim()
  if (!t) return null

  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    .exec(t)
  if (!m) return null

  // ┌─ A REGRA, em uma linha ────────────────────────────────────────┐
  // │ Ano de 4 dígitos ⇒ é o arquivo `CARGA`, que escreve dia/mês/ano │
  // │ e é inequívoco. Ano de 2 dígitos ⇒ é o arquivo da consulta, que │
  // │ é ambíguo em 11 dos 12 meses: recusa.                           │
  // └─────────────────────────────────────────────────────────────────┘
  if (m[3].length !== 4) return null

  const dia = Number(m[1]), mes = Number(m[2]), ano = Number(m[3])
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const h = Number(m[4] ?? 0), min = Number(m[5] ?? 0), seg = Number(m[6] ?? 0)
  const d = new Date(ano, mes - 1, dia, h, min, seg)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/** Tira o que não é dígito nem letra: leitor de barras mete espaço. */
const limpaSerial = (s: string | undefined) =>
  (s ?? '').replace(/\s+/g, '').toUpperCase()

export async function lerCargaEstoque(arquivo: File): Promise<LeituraEstoque> {
  const { linhas, cabecalhos } = await lerPlanilha(arquivo)

  // O cabeçalho diz qual é o formato. "Série / Ender. Princ." só existe
  // no da consulta; "Número Série" só existe no da carga.
  const temConsulta = cabecalhos.some(c => /S[ée]rie\s*\/\s*Ender/i.test(c))
  const temCarga = cabecalhos.some(c => /N[úu]mero\s+S[ée]rie/i.test(c))
  if (!temConsulta && !temCarga) {
    throw new Error(
      'Não achei a coluna de número de série. Esperava "Número Série" '
      + '(carga) ou "Série / Ender. Princ." (consulta). '
      + 'Colunas lidas: ' + cabecalhos.slice(0, 8).join(', ') + '…')
  }
  const formato: FormatoEstoque = temConsulta ? 'CONSULTA' : 'CARGA'

  const saida: LinhaEstoque[] = []
  let semSerial = 0
  let dataAmbigua = 0

  for (const l of linhas) {
    let serial = ''
    let enderecavel: string | undefined

    if (formato === 'CONSULTA') {
      // "722255161458 / B4F2673499C1" — dois campos num só.
      const bruto = l['Série / Ender. Princ.'] ?? ''
      const [s, e] = bruto.split('/').map(x => x.trim())
      serial = limpaSerial(s)
      enderecavel = e || undefined
    } else {
      serial = limpaSerial(l['Número Série'])
      enderecavel = l['Endereçavel Principal'] || undefined
    }

    if (serial.length < 4) { semSerial++; continue }

    const cru = formato === 'CONSULTA' ? l['Data da Alteração'] : l['Data Última Alteração']
    const em = dataAtlas(cru)
    if (cru && !em) dataAmbigua++

    saida.push({
      serial,
      enderecavel,
      tipo: l['Tipo'],
      modelo: l['Modelo'],
      item_jde: formato === 'CONSULTA' ? l['Item JDE'] : l['Código Item JDE'],
      material_sap: formato === 'CONSULTA' ? l['Material SAP'] : l['Código Material SAP'],
      operacao: l['Operação'],
      estado_atlas: l['Estado'],
      local_atlas: formato === 'CONSULTA' ? l['Local'] : l['Nome do Local'],
      tipo_local_atlas: l['Tipo Local'],
      responsavel_atlas: formato === 'CONSULTA' ? l['Responsável'] : l['Responsavél'],
      contrato_atlas: formato === 'CONSULTA' ? l['Contrato NETSMS'] : l['Número do Contrato'],
      classificacao: formato === 'CONSULTA'
        ? l['Tipo Mercadoria'] : l['Classificacação Material'],
      empresa_material: l['Empresa Material'],
      reusos: l['Reusos'],
      atlas_em: em ?? undefined,
      // A linha inteira, crua, vai junto: `dados_origem` no banco.
      ...Object.fromEntries(
        Object.entries(l).map(([k, v]) => ['bruto_' + k, v])),
    })
  }

  return { formato, linhas: saida, semSerial, dataAmbigua, cabecalhos }
}
