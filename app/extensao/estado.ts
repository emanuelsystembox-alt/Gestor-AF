/**
 * O estado da extensão, guardado em `chrome.storage.local` — o fundo
 * escreve, a janelinha lê e redesenha quando muda (D-193).
 *
 * Fica no armazenamento, e não na memória, porque o Chrome adormece o
 * fundo da extensão quando ele fica parado: o que estava só na memória
 * sumiria entre um alarme e outro.
 */

export interface LinhaLog { em: number; texto: string; tom: 'ok' | 'erro' | 'info' }

export interface Estado {
  /** "Sincronizar por este computador" — escolha de quem está aqui. */
  ligado: boolean
  usuario: { id: string; nome: string | null; email: string | null } | null
  cidade: { id: string; nome: string } | null
  /** De quem é a vez (113): este computador, outro (reserva) ou ninguém. */
  vez: 'ESTE' | 'RESERVA' | null
  reservaDe: string | null
  /** O sincronismo está ligado no servidor (a configuração da cidade)? */
  servidorLigado: boolean | null
  intervalo: number | null
  toaSessao: 'OK' | 'CAIU' | null
  pulsoEm: number | null
  baixa: { rodando: boolean; atual: string | null; ultimaEm: number | null; ultima: string | null }
  varredura: {
    rodando: boolean; idPedido: string | null; inicio: number | null
    feitos: number; total: number; nomes: number; listas: number; fora: number; erros: number
    ultimaEm: number | null; ultima: string | null
  }
  log: LinhaLog[]
}

export const CHAVE = 'af_estado'

export const ESTADO_VAZIO: Estado = {
  ligado: false, usuario: null, cidade: null, vez: null, reservaDe: null,
  servidorLigado: null, intervalo: null, toaSessao: null, pulsoEm: null,
  baixa: { rodando: false, atual: null, ultimaEm: null, ultima: null },
  varredura: {
    rodando: false, idPedido: null, inicio: null,
    feitos: 0, total: 0, nomes: 0, listas: 0, fora: 0, erros: 0, ultimaEm: null, ultima: null,
  },
  log: [],
}

export async function lerEstado(): Promise<Estado> {
  const r = await chrome.storage.local.get(CHAVE)
  const e = r[CHAVE] as Partial<Estado> | undefined
  return { ...ESTADO_VAZIO, ...(e ?? {}),
    baixa: { ...ESTADO_VAZIO.baixa, ...(e?.baixa ?? {}) },
    varredura: { ...ESTADO_VAZIO.varredura, ...(e?.varredura ?? {}) } }
}

/** Mensagens da janelinha para o fundo. */
export type Pedido =
  | { tipo: 'entrar'; email: string; senha: string }
  | { tipo: 'sair' }
  | { tipo: 'ligar'; sim: boolean }
  | { tipo: 'sincronizar-agora' }
  | { tipo: 'assumir' }
  | { tipo: 'varrer-agora' }
  | { tipo: 'parar-varredura' }
