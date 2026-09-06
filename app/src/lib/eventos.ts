import { SITUACAO_INFO, type Situacao } from './supabase'

/**
 * Leitura do histórico do contrato (`visita_evento`).
 *
 * O sistema atual mostra uma linha por etapa com quem fez — "Entrada -
 * In Box · VERA LUCIA", "Em deslocamento · 007 - EQUIPE". Este módulo
 * é o que traduz o `tipo` (código) para o nome que a operação lê, e é
 * compartilhado pela janela do contrato e pela página cheia: histórico
 * que muda de nome conforme a tela em que se olha não é histórico.
 */

export const EVENTO_ROTULO: Record<string, string> = {
  IMPORTADA:       'Entrada — importada do TOA',
  SITUACAO:        'Mudança de situação',
  CONFLITO_TOA:    'Conflito com o TOA',
  BAIXA:           'Baixa de serviço',
  TRANSFERENCIA:   'Transferência de equipe',
  REVERSAO:        'Contrato voltado',
  EXCLUIDA:        'Excluído',
  RESTAURADA:      'Restaurado',
  CADASTRO_MANUAL: 'Cadastrado à mão',
  EDICAO_CADASTRO: 'Edição de cadastro',
  OS_ADICIONADA:   'O.S. acrescentada',
  OS_REMOVIDA:     'O.S. removida',
  DESLOCAMENTO:    'Saiu para o endereço',
  CHECKIN:         'Chegou e iniciou',
  IMPEDIMENTO:     'Registrou impedimento',
  CONCLUSAO:       'Finalizou a visita',
}

export const rotuloEvento = (tipo: string) =>
  EVENTO_ROTULO[tipo] ?? tipo.replace(/_/g, ' ').toLowerCase()

/**
 * "de → para" legível. Situação vira rótulo de situação; o resto sai
 * como `chave: valor`, que é melhor que despejar só os valores — num
 * evento de edição, "ALVORADA" sozinho não diz que campo mudou.
 */
export function transicaoEvento(e: {
  de: Record<string, unknown> | null
  para: Record<string, unknown> | null
}): string | null {
  const rot = (o: Record<string, unknown> | null) => {
    if (!o) return null
    const s = o.situacao
    if (typeof s === 'string') return SITUACAO_INFO[s as Situacao]?.label ?? s
    const partes = Object.entries(o).map(([k, x]) =>
      `${k}: ${Array.isArray(x) ? x.join(', ') : String(x)}`)
    return partes.length ? partes.join(' · ') : null
  }
  const a = rot(e.de), b = rot(e.para)
  if (a && b) return `${a} → ${b}`
  return b ?? a
}
