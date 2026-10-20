import type { SupabaseClient } from '@supabase/supabase-js'
import type { LinhaTOA } from './toa'

/**
 * O caminho de uma planilha do TOA até os contratos — UM só, para a tela
 * de Importação (gente) e para a extensão do TOA (o sincronismo, 111 e
 * D-193). O cliente do banco vem por PARÂMETRO: a web passa o dela; a
 * extensão passa o seu, logado pela janelinha da extensão.
 *
 * ┌─ por que saiu de dentro da página ───────────────────────────────┐
 * │ Até a 111 isto morava em `pages/Importacao.tsx`. O robô precisa  │
 * │ fazer exatamente o mesmo: registrar, subir as linhas em lotes,   │
 * │ chamar `importar_toa`, depois `reconciliar_importacao` na        │
 * │ SEGUNDA chamada (104b, D-181) e gravar a falha na importação     │
 * │ (105, D-182). Uma cópia na tela do robô divergiria da primeira   │
 * │ no dia em que alguém mexesse numa delas.                         │
 * └──────────────────────────────────────────────────────────────────┘
 */

/** As etapas que a tela mostra enquanto importa. */
export const ETAPAS = [
  'Registrando a importação',
  'Enviando as linhas',
  'Criando e atualizando os contratos',
  'Ligando jornada, tipo de atividade e TEC1',
  'Conferindo o que saiu do TOA',
] as const

/** O que a 3ª chamada fez (116, D-191). */
export interface Desatribuicao { desatribuidos: number; devolvidos: number }

export interface Resumo {
  criadas: number; atualizadas: number; ignoradas: number
  /** Atividades suspensas recusadas na leitura (D-104): tentativa
   *  abortada nao e trabalho, e some da tela -- mas nao daqui. */
  suspensas?: number
  erros: number; conflitos: number; ordens_servico: number
  /** O dia em que as visitas entraram (090). */
  dia?: string
}

export interface PedidoImportacao {
  linhas: LinhaTOA[]
  /** O nome do arquivo como o TOA gera — é por ele que o banco sabe o bucket (D-180). */
  arquivoNome: string
  baseId: string
  /** Dia de atuação (090, D-166). */
  dia: string
  usuarioId: string | null
  /** Caminho de origem para o registro: `manual/…` ou `sincronismo/…`. */
  origem: 'manual' | 'sincronismo'
  /** Impressão digital das linhas (o robô usa para não reimportar o igual). */
  impressao?: string | null
  aoAvancar?: (etapa: number, enviadas: number) => void
}

export interface ResultadoImportacao {
  importacaoId: string
  resumo: Resumo
  /** Falso quando a segunda parte falhou: os contratos entraram, falta reconciliar. */
  reconciliou: boolean
  /** Nulo quando a 3ª chamada falhou: os contratos entraram, a conferência do
   *  que sumiu fica para a próxima importação (não é "zero desatribuídos"). */
  desatribuicao: Desatribuicao | null
}

/** Erro com a importação já registrada (ou não), para quem chamou mostrar e decidir. */
export class ErroImportacao extends Error {
  constructor(mensagem: string, readonly importacaoId: string | null) { super(mensagem) }
}

export async function reconciliarImportacao(cliente: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await cliente.rpc('reconciliar_importacao', { p_importacao_id: id })
  return !error
}

export async function importarLinhasToa(cliente: SupabaseClient, p: PedidoImportacao): Promise<ResultadoImportacao> {
  let etapa = 0
  const avancar = (e: number, enviadas = 0) => { etapa = e; p.aoAvancar?.(e, enviadas) }
  // O id da importação, para gravar a falha nela se der errado depois.
  let impId: string | null = null
  try {
    avancar(0)
    const { data: imp, error: ei } = await cliente
      .from('importacao')
      .insert({
        base_id: p.baseId,
        usuario_id: p.usuarioId,
        arquivo_nome: p.arquivoNome,
        arquivo_path: `${p.origem}/${p.arquivoNome}`,
        arquivo_hash: p.impressao ?? null,
        fonte: 'TOA',
        // 090: quem decide o dia é quem importa, não a coluna Data.
        data_atuacao: p.dia,
      })
      .select('id').single()
    if (ei || !imp) throw new Error(ei?.message ?? 'Falha ao registrar a importação.')
    impId = imp.id
    avancar(1, 0)

    // Em lotes: 349 linhas num único insert estoura o limite da requisição.
    const LOTE = 100
    for (let i = 0; i < p.linhas.length; i += LOTE) {
      const fatia = p.linhas.slice(i, i + LOTE).map((d, k) => ({
        importacao_id: imp.id,
        numero_linha: i + k + 1,
        dados: d,
      }))
      const { error } = await cliente.from('importacao_linha').insert(fatia)
      if (error) throw new Error(`Linha ${i + 1}: ${error.message}`)
      avancar(1, Math.min(i + LOTE, p.linhas.length))
    }

    avancar(2, p.linhas.length)
    const { data: res, error: er } = await cliente.rpc('importar_toa', { p_importacao_id: imp.id })
    if (er) throw new Error(er.message)

    await cliente.from('importacao').update({ total_linhas: p.linhas.length }).eq('id', imp.id)

    // 104b: a segunda parte, numa chamada própria. Os contratos já estão
    // gravados; se esta falhar, quem chamou oferece rodar de novo.
    avancar(3, p.linhas.length)
    const reconciliou = await reconciliarImportacao(cliente, imp.id)

    // 116: a TERCEIRA chamada, com o seu próprio orçamento (D-181). O que
    // sumiu desta planilha e está Na entrada vira Desatribuído (cód. 800);
    // o desatribuído que voltou, volta Na entrada (D-191).
    avancar(4, p.linhas.length)
    const { data: des, error: ed } = await cliente.rpc('desatribuir_ausentes', { p_importacao_id: imp.id })

    return {
      importacaoId: imp.id, resumo: res as Resumo, reconciliou,
      desatribuicao: ed ? null : (des as Desatribuicao),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha na importação.'
    // O banco desfaz a transação inteira quando estoura o tempo: dizer
    // "nada entrou" evita alguém procurar contrato pela metade.
    const texto = /statement timeout/i.test(msg)
      ? 'O banco demorou mais que o limite e desfez a importação inteira — nenhum contrato entrou. Tente de novo; se repetir, avise.'
      : msg
    // 105: a falha fica GRAVADA na importação, para o histórico de todo
    // mundo dizer "não entrou" — e não "Processando" para sempre.
    if (impId) {
      await cliente.from('importacao')
        .update({ status: 'ERRO', erro_mensagem: `${ETAPAS[etapa]}: ${texto}` })
        .eq('id', impId)
    }
    throw new ErroImportacao(texto, impId)
  }
}

/**
 * Impressão digital das linhas lidas — SHA-256 do JSON. É das LINHAS, não
 * dos bytes do arquivo: o .xlsx carrega a hora em que foi gerado, e dois
 * exports do mesmo conteúdo dariam arquivos diferentes.
 */
export async function impressaoDasLinhas(linhas: LinhaTOA[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(linhas))
  const h = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
}
