/**
 * O estado da extensão, guardado em `chrome.storage.local` — o fundo
 * escreve, a janelinha lê e redesenha quando muda (D-193).
 *
 * Fica no armazenamento, e não na memória, porque o Chrome adormece o
 * fundo da extensão quando ele fica parado: o que estava só na memória
 * sumiria entre um alarme e outro.
 *
 * 0.8.0 (167, D-251): a configuração é DESTE COMPUTADOR — os buckets e os
 * tempos — e a vez é por bucket, decidida no servidor. Não existe mais
 * "a cidade" da extensão: cada bucket traz a sua.
 */

export type OQueVarrer = 'TUDO' | 'NOME' | 'EQUIPAMENTO'
export type Intervalo = 5 | 15 | 30 | 60
export const INTERVALOS: Intervalo[] = [5, 15, 30, 60]

export interface LinhaLog { em: number; texto: string; tom: 'ok' | 'erro' | 'info' }

/** Um bucket que este login pode sincronizar (árvore do TOA ∩ cidades do PulsoLine). */
export interface BucketDisponivel {
  id: string; nome: string; numero_toa: number; base_id: string; cidade: string
}
/** Bucket da árvore do TOA que ficou de fora, com o porquê. */
export interface BucketFora {
  numero: number; nome: string
  motivo: 'NAO_CADASTRADO' | 'OUTRA_CIDADE' | 'DESLIGADO' | 'NUMERO_DIFERENTE'
}
/** De quem é a vez de cada bucket marcado, no último pulso (com o bucket, para
 *  a varredura e a lista não dependerem de ter lido a árvore do TOA). */
export interface VezDoBucket extends BucketDisponivel { vez: boolean; outro: string | null; ultima: string | null }

export interface Estado {
  /** "Sincronizar por este computador" — escolha de quem está aqui. */
  ligado: boolean
  usuario: { id: string; nome: string | null; email: string | null } | null
  /** Este computador: sorteado uma vez; a vez de cada bucket é de pessoa + máquina. */
  maquina: string | null
  config: {
    rotaMin: Intervalo
    /** nulo = só no botão */
    varreduraMin: Intervalo | null
    /** os ids marcados para sincronizar e varrer */
    buckets: string[]
  }
  /** O que o login pode sincronizar — lido da árvore do TOA na última vez que houve aba. */
  disponiveis: { em: number; itens: BucketDisponivel[]; fora: BucketFora[] } | null
  vezes: Record<string, VezDoBucket>
  toaSessao: 'OK' | 'CAIU' | null
  pulsoEm: number | null
  baixa: { rodando: boolean; atual: string | null; ultimaEm: number | null; ultima: string | null }
  varredura: {
    rodando: boolean; idPedido: string | null; inicio: number | null
    /** A aba do TOA ficou escondida: o Chrome para a tela, a varredura espera. */
    pausada: boolean
    feitos: number; total: number; nomes: number; listas: number; fora: number; erros: number
    ultimaEm: number | null; ultima: string | null
  }
  /** O que a varredura lê (121, 0.6.0). */
  escolha: { oQue: OQueVarrer }
  /** Quanto falta por bucket (contado agora há pouco), para a lista. */
  pendentes: { em: number; porBucket: { bucket: string; nomes: number; listas: number }[] } | null
  log: LinhaLog[]
}

export const CHAVE = 'af_estado'

export const ESTADO_VAZIO: Estado = {
  ligado: false, usuario: null, maquina: null,
  config: { rotaMin: 60, varreduraMin: null, buckets: [] },
  disponiveis: null, vezes: {}, toaSessao: null, pulsoEm: null,
  baixa: { rodando: false, atual: null, ultimaEm: null, ultima: null },
  varredura: {
    rodando: false, idPedido: null, inicio: null, pausada: false,
    feitos: 0, total: 0, nomes: 0, listas: 0, fora: 0, erros: 0, ultimaEm: null, ultima: null,
  },
  escolha: { oQue: 'TUDO' },
  pendentes: null,
  log: [],
}

export async function lerEstado(): Promise<Estado> {
  const r = await chrome.storage.local.get(CHAVE)
  const e = r[CHAVE] as Partial<Estado> | undefined
  return { ...ESTADO_VAZIO, ...(e ?? {}),
    config: { ...ESTADO_VAZIO.config, ...(e?.config ?? {}) },
    baixa: { ...ESTADO_VAZIO.baixa, ...(e?.baixa ?? {}) },
    varredura: { ...ESTADO_VAZIO.varredura, ...(e?.varredura ?? {}) },
    escolha: { ...ESTADO_VAZIO.escolha, oQue: e?.escolha?.oQue ?? 'TUDO' } }
}

/** Mensagens da janelinha para o fundo. */
export type Pedido =
  | { tipo: 'entrar'; email: string; senha: string }
  | { tipo: 'sair' }
  | { tipo: 'ligar'; sim: boolean }
  | { tipo: 'configurar'; rotaMin: Intervalo; varreduraMin: Intervalo | null; buckets: string[] }
  | { tipo: 'atualizar-buckets' }
  | { tipo: 'sincronizar-agora' }
  | { tipo: 'assumir'; buckets: string[] }
  | { tipo: 'varrer-agora' }
  | { tipo: 'escolher-varredura'; oQue: OQueVarrer }
  | { tipo: 'contar-pendentes' }
  | { tipo: 'parar-varredura' }
  | { tipo: 'abrir-janela-toa' }
