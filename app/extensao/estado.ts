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
  /** 0.10.0 (D-342): cada importação tem o seu Iniciar/Parar e o seu
   *  intervalo — rota (planilha), equipamentos (varredura) e níveis (portal). */
  config: {
    rotaLigada: boolean
    rotaMin: Intervalo
    varreduraLigada: boolean
    varreduraMin: Intervalo
    portalLigado: boolean
    /** o portal da Claro não aceita menos de 15 min (D-342) */
    portalMin: Intervalo
    /** os ids marcados para sincronizar e varrer */
    buckets: string[]
    /** 0.11.0 (D-374): o horário do dia em que as três rodam sozinhas, "HH:MM"
     *  no relógio de Manaus. Nulo = sem limite daquele lado. */
    horaInicio: string | null
    horaFim: string | null
  }
  /** A última rodada de cada importação, feita na hora fim — uma por dia e
   *  por hora fim (mudar a hora fim abre uma nova). */
  fimDoDia: { dia: string; fim: string; feitos: Importacao[] } | null
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
  /** O Portal Técnico da Claro (0.9.0, 222, D-330): o login do líder que a
   *  aba do portal informou, e a última leitura do sinal antes/depois. */
  portal: {
    login: string | null; nome: string | null
    sessao: 'OK' | 'CAIU' | null
    rodando: boolean; ultimaEm: number | null; ultima: string | null
    /** 0.10.0 (D-342): o andamento da rodada, um detalhe por vez */
    feitos: number; total: number
    /** O firewall da Claro bloqueou (ou o portal não respondeu): a extensão
     *  não pede nada até esta hora — insistir estende o bloqueio. */
    pausaAte: number | null; pausaMotivo: string | null
  }
  log: LinhaLog[]
}

export const CHAVE = 'af_estado'

export const ESTADO_VAZIO: Estado = {
  ligado: false, usuario: null, maquina: null,
  config: {
    rotaLigada: true, rotaMin: 60, varreduraLigada: false, varreduraMin: 60,
    portalLigado: true, portalMin: 60, buckets: [], horaInicio: null, horaFim: null,
  },
  fimDoDia: null,
  disponiveis: null, vezes: {}, toaSessao: null, pulsoEm: null,
  baixa: { rodando: false, atual: null, ultimaEm: null, ultima: null },
  varredura: {
    rodando: false, idPedido: null, inicio: null, pausada: false,
    feitos: 0, total: 0, nomes: 0, listas: 0, fora: 0, erros: 0, ultimaEm: null, ultima: null,
  },
  escolha: { oQue: 'TUDO' },
  pendentes: null,
  portal: { login: null, nome: null, sessao: null, rodando: false, ultimaEm: null, ultima: null,
            feitos: 0, total: 0, pausaAte: null, pausaMotivo: null },
  log: [],
}

/**
 * A configuração gravada por uma versão anterior vira a desta: até a 0.9.0
 * `varreduraMin` nulo queria dizer "só no botão" — agora é a varredura
 * PARADA, e o intervalo fica guardado para quando ela for iniciada.
 */
function normalizarConfig(c: Record<string, unknown> | undefined): Estado['config'] {
  const v = ESTADO_VAZIO.config
  const intervalo = (x: unknown, padrao: Intervalo) => INTERVALOS.includes(x as Intervalo) ? x as Intervalo : padrao
  const varAntiga = c?.varreduraMin
  return {
    rotaLigada: typeof c?.rotaLigada === 'boolean' ? c.rotaLigada : v.rotaLigada,
    rotaMin: intervalo(c?.rotaMin, v.rotaMin),
    varreduraLigada: typeof c?.varreduraLigada === 'boolean' ? c.varreduraLigada : varAntiga != null,
    varreduraMin: intervalo(varAntiga, v.varreduraMin),
    portalLigado: typeof c?.portalLigado === 'boolean' ? c.portalLigado : v.portalLigado,
    portalMin: Math.max(15, intervalo(c?.portalMin, v.portalMin)) as Intervalo,
    buckets: Array.isArray(c?.buckets) ? (c.buckets as string[]) : [],
    horaInicio: horaValida(c?.horaInicio) ? c!.horaInicio as string : null,
    horaFim: horaValida(c?.horaFim) ? c!.horaFim as string : null,
  }
}

// ── o horário do dia (0.11.0, D-374) ──────────────────────────────────────
/**
 * ┌─ a hora fim faz a ÚLTIMA rodada, não só para ─────────────────────┐
 * │ > "quando der a hora fim o sistema deve fazer a ultima atualização │
 * │ >  independente de quantos minutos faltem" — Emanuel, 12/11       │
 * │ Rota a cada 1 h com fim às 18:00: a das 17:20 não seria a última. │
 * │ Ao dar a hora fim, cada importação ligada roda UMA vez mais, fora  │
 * │ do intervalo, e então para até a hora início do dia seguinte. O    │
 * │ relógio é o de Manaus — o mesmo do "hoje" (hoje_local, D-084) —,   │
 * │ e não o do computador: o Edge da VPS não está em Manaus.           │
 * └────────────────────────────────────────────────────────────────────┘
 */
export const horaValida = (x: unknown): x is string => typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x)

/** Agora em Manaus: o dia ("AAAA-MM-DD") e a hora ("HH:MM"). */
export function agoraManaus(): { dia: string; hhmm: string } {
  const d = new Date()
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(d)
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  return { dia, hhmm }
}

/** Onde o relógio está em relação ao horário: SEM_HORARIO = o dia inteiro. */
export type Janela = 'SEM_HORARIO' | 'ANTES' | 'DENTRO' | 'DEPOIS'
export function janelaAgora(c: Pick<Estado['config'], 'horaInicio' | 'horaFim'>, hhmm = agoraManaus().hhmm): Janela {
  if (!c.horaInicio && !c.horaFim) return 'SEM_HORARIO'
  if (c.horaFim && hhmm >= c.horaFim) return 'DEPOIS'
  if (c.horaInicio && hhmm < c.horaInicio) return 'ANTES'
  return 'DENTRO'
}

/** A última rodada desta importação, na hora fim de hoje, já foi feita? */
export function fimFeito(e: Estado, qual: Importacao): boolean {
  const f = e.fimDoDia
  return !!f && f.dia === agoraManaus().dia && f.fim === e.config.horaFim && f.feitos.includes(qual)
}

export async function lerEstado(): Promise<Estado> {
  const r = await chrome.storage.local.get(CHAVE)
  const e = r[CHAVE] as Partial<Estado> | undefined
  return { ...ESTADO_VAZIO, ...(e ?? {}),
    config: normalizarConfig(e?.config as Record<string, unknown> | undefined),
    baixa: { ...ESTADO_VAZIO.baixa, ...(e?.baixa ?? {}) },
    varredura: { ...ESTADO_VAZIO.varredura, ...(e?.varredura ?? {}) },
    portal: { ...ESTADO_VAZIO.portal, ...(e?.portal ?? {}) },
    fimDoDia: e?.fimDoDia ?? null,
    escolha: { ...ESTADO_VAZIO.escolha, oQue: e?.escolha?.oQue ?? 'TUDO' } }
}

/** Mensagens da janelinha para o fundo. */
export type Pedido =
  | { tipo: 'entrar'; email: string; senha: string }
  | { tipo: 'sair' }
  | { tipo: 'ligar'; sim: boolean }
  /** só o pedaço que mudou; o fundo confere cada campo */
  | { tipo: 'configurar'; config: Partial<Estado['config']> }
  | { tipo: 'atualizar-buckets' }
  | { tipo: 'sincronizar-agora' }
  | { tipo: 'assumir'; buckets: string[] }
  | { tipo: 'varrer-agora' }
  | { tipo: 'escolher-varredura'; oQue: OQueVarrer }
  | { tipo: 'contar-pendentes' }
  | { tipo: 'parar-varredura' }
  | { tipo: 'abrir-janela-toa' }
  | { tipo: 'ler-portal'; dia?: string }
  /** 0.9.0: a rota e o sinal de um dia para trás, escolhido por quem opera (D-166) */
  | { tipo: 'sincronizar-dia'; dia: string }
  /** 0.10.0 (D-342): o menu Importar — Iniciar e Parar de cada importação, no dia escolhido */
  | { tipo: 'iniciar'; oQue: Importacao; dia: string }
  | { tipo: 'parar'; oQue: Importacao }
  /** tirar a pausa do portal antes da hora (quem opera decide) */
  | { tipo: 'retomar-portal' }

export type Importacao = 'ROTA' | 'EQUIPAMENTOS' | 'NIVEIS'
