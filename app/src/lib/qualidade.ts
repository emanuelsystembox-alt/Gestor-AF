/**
 * O vocabulário e as contas da Qualidade (148).
 *
 * > "as palavras parece meio amadoras (...) precisa usar palavras mais
 * >  técnicas e mais bonitas para o sistema" — Emanuel, 26/10
 *
 * Mora em `lib/` e não na tela porque o banco conta as mesmas coisas
 * (`qualidade_contatado`, `qualidade_conclusivo`): duas cópias da regra
 * divergem, e é a tela que acabaria mentindo.
 */

/** Os nove desfechos, na ordem em que a central do Emanuel os mostra. */
export interface Desfecho {
  v: string
  /** O rótulo na tela — o dele, palavra por palavra. */
  r: string
  cor: string
  /** Houve veredito técnico sobre o serviço (entra na conformidade). */
  conclusivo: boolean
  /** Falou-se com alguém. */
  contatado: boolean
  /** Quando o analista deve usar — a dica do botão. */
  quando: string
}

export const DESFECHOS: Desfecho[] = [
  { v: 'NORMALIZADO', r: 'Normalizado', cor: 'var(--st-concluida)',
    conclusivo: true, contatado: true,
    quando: 'O serviço está funcionando como deveria. É o desfecho que conta a favor da conformidade.' },
  { v: 'SERVICO_FALHA', r: 'Serviço com falha', cor: '#dc2626',
    conclusivo: true, contatado: true,
    quando: 'Funciona, mas com defeito: oscila, cai, lentidão, canal faltando.' },
  { v: 'PROBLEMA_CRITICO', r: 'Problema crítico (sem serviço)', cor: '#b91c1c',
    conclusivo: true, contatado: true,
    quando: 'O assinante está totalmente sem o serviço depois da visita. Prioridade máxima.' },
  { v: 'SEM_ATIVO', r: 'Sem ativo', cor: '#dc2626',
    conclusivo: true, contatado: true,
    quando: 'O equipamento ou o produto contratado não ficou no cliente.' },
  { v: 'DESEJA_CANCELAMENTO', r: 'Deseja cancelamento', cor: '#dc2626',
    conclusivo: true, contatado: true,
    quando: 'O assinante quer cancelar. Conta como não conforme e vai para a retenção.' },
  { v: 'REDE_EXTERNA', r: 'Rede externa', cor: 'var(--st-reagendamento)',
    conclusivo: false, contatado: true,
    quando: 'O problema é da planta da CLARO, não da execução. FICA FORA da conformidade.' },
  { v: 'NAO_QUIS_RESPONDER', r: 'Cliente não quis responder', cor: 'var(--color-graf-400)',
    conclusivo: false, contatado: true,
    quando: 'Atendeu, mas recusou a pesquisa. Conta como contato, não como veredito.' },
  { v: 'NAO_ATENDEU', r: 'Não atendeu', cor: 'var(--color-graf-400)',
    conclusivo: false, contatado: false,
    quando: 'Ligou e não houve atendimento. Registre para a próxima tentativa ficar contada.' },
  { v: 'SEM_NUMERO', r: 'Sem número / número inválido', cor: 'var(--color-graf-400)',
    conclusivo: false, contatado: false,
    quando: 'Não há telefone, ou o número não existe mais.' },
]

export const DESFECHO_POR_CHAVE: Record<string, Desfecho> =
  Object.fromEntries(DESFECHOS.map(d => [d.v, d]))

/** Os que o painel chama de PROBLEMA: conclusivo e não normalizado. */
export const ehProblema = (v: string | null) =>
  !!v && (DESFECHO_POR_CHAVE[v]?.conclusivo ?? false) && v !== 'NORMALIZADO'

/** Os grupos da barra de triagem no topo da fila. */
export type Triagem = 'PENDENTE' | 'NORMALIZADO' | 'PROBLEMA' | 'REDE_EXTERNA' | 'SEM_APURACAO' | 'TODOS'

export const TRIAGEM: { v: Triagem; r: string; cor: string }[] = [
  { v: 'PENDENTE',     r: 'Pendentes',    cor: 'var(--color-graf-500)' },
  { v: 'NORMALIZADO',  r: 'Normalizados', cor: 'var(--st-concluida)' },
  { v: 'PROBLEMA',     r: 'Problemas',    cor: '#dc2626' },
  { v: 'REDE_EXTERNA', r: 'Rede externa', cor: 'var(--st-reagendamento)' },
  { v: 'SEM_APURACAO', r: 'Sem apuração', cor: 'var(--color-graf-500)' },
  { v: 'TODOS',        r: 'Todos',        cor: 'var(--color-graf-400)' },
]

export function naTriagem(desfecho: string | null, t: Triagem): boolean {
  switch (t) {
    case 'TODOS': return true
    case 'PENDENTE': return desfecho == null
    case 'NORMALIZADO': return desfecho === 'NORMALIZADO'
    case 'PROBLEMA': return ehProblema(desfecho)
    case 'REDE_EXTERNA': return desfecho === 'REDE_EXTERNA'
    case 'SEM_APURACAO':
      return !!desfecho && !DESFECHO_POR_CHAVE[desfecho]?.contatado
        || desfecho === 'NAO_QUIS_RESPONDER'
  }
}

/** A situação do contrato, no vocabulário do controle. */
export const SITUACAO_CONTRATO: Record<string, string> = {
  CONCLUIDA: 'Concluído',
  CANCELADA: 'Cancelado',
  REAGENDAMENTO: 'Reagendado',
}

/** Só os dígitos, com o 55 do Brasil — é o que o wa.me aceita. */
export function linkWhatsApp(tel: string, contrato: string | null): string | null {
  const d = tel.replace(/\D/g, '')
  if (d.length < 10) return null
  const num = d.startsWith('55') ? d : `55${d}`
  const texto = 'Olá! Aqui é da AFLINE, prestadora da CLARO.'
    + ` Estamos confirmando se o atendimento${contrato ? ` do contrato ${contrato}` : ''}`
    + ' ficou resolvido. Pode falar agora?'
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`
}

/** 11 dígitos → (92) 99999-9999. Abaixo disso, devolve como veio. */
export function formataTel(t: string): string {
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

export const pct = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(1).replace('.', ',')}%`

export const num1 = (n: number | null | undefined) =>
  n == null ? '—' : n.toFixed(1).replace('.', ',')

export const num2 = (n: number | null | undefined) =>
  n == null ? '—' : n.toFixed(2).replace('.', ',')
