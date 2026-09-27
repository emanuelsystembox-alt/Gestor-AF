/**
 * Frota — o vocabulário que as quatro abas falam igual (088, D-164).
 *
 * ┌─ DOIS CAMPOS ONDE O CONCORRENTE TEM UM ──────────────────────────┐
 * │ No Alfa Gestor, "origem" mistura DE QUEM É o carro (própria,      │
 * │ alugada, locadora) com ONDE ELE ESTÁ (oficina, lanterneiro,       │
 * │ férias, vendido, DETRAN) — 19 opções num campo só. Aqui são       │
 * │ `propriedade` e `situacao`, e vendido é ARQUIVAR, com motivo.     │
 * └───────────────────────────────────────────────────────────────────┘
 */

export type SituacaoVeiculo = 'ATIVO' | 'NA_GARAGEM' | 'FORA_DA_GARAGEM' | 'EM_MANUTENCAO'

/** Os quatro status do concorrente, com o nome dele. Cor = significado:
 *  verde rodando, cinza parado, âmbar fora sem estar em serviço, vermelho
 *  indisponível. */
export const SITUACAO_VEICULO: Record<SituacaoVeiculo, { rotulo: string; classe: string }> = {
  ATIVO:           { rotulo: 'Ativo',            classe: 'bg-emerald-900/40 text-emerald-300' },
  NA_GARAGEM:      { rotulo: 'Na garagem',       classe: 'bg-graf-800 text-graf-300' },
  FORA_DA_GARAGEM: { rotulo: 'Fora da garagem',  classe: 'bg-amber-900/40 text-amber-300' },
  EM_MANUTENCAO:   { rotulo: 'Em manutenção',    classe: 'bg-af-900/40 text-af-300' },
}

export const PROPRIEDADE: Record<string, string> = {
  PROPRIA: 'Frota própria', LOCADORA: 'Alugado de locadora', TECNICO: 'Alugado do técnico',
}

/** Onde o carro DORME (089-A). "CASA/FROTA PRÓPRIA" no concorrente é
 *  propriedade × pernoite num campo só; o Emanuel quer as duas contas. */
export const PERNOITE: Record<string, string> = {
  CASA: 'Leva para casa', BASE: 'Dorme na base',
}

export const TIPO_VEICULO: Record<string, string> = {
  CARRO: 'Carro', MOTO: 'Moto', CAMINHONETE: 'Caminhonete', VAN: 'Van',
  CAMINHAO: 'Caminhão', OUTRO: 'Outro',
}

export const COMBUSTIVEL: Record<string, string> = {
  GASOLINA_COMUM: 'Gasolina comum', GASOLINA_ADITIVADA: 'Gasolina aditivada',
  ETANOL: 'Etanol', DIESEL: 'Diesel', GNV: 'GNV',
}

export type SituacaoAbastecimento = 'EM_ABERTO' | 'APROVADO' | 'ABASTECIDO' | 'CANCELADO'
export const SITUACAO_ABASTECIMENTO: Record<SituacaoAbastecimento, { rotulo: string; classe: string }> = {
  EM_ABERTO:  { rotulo: 'Em aberto',  classe: 'bg-amber-900/40 text-amber-300' },
  APROVADO:   { rotulo: 'Aprovado',   classe: 'bg-sky-900/40 text-sky-300' },
  ABASTECIDO: { rotulo: 'Abastecido', classe: 'bg-emerald-900/40 text-emerald-300' },
  CANCELADO:  { rotulo: 'Cancelado',  classe: 'bg-graf-800 text-graf-400' },
}

export const EXCECAO: Record<string, { rotulo: string; ajuda: string }> = {
  ODOMETRO_VOLTOU: { rotulo: 'Odômetro voltou',
    ajuda: 'Menor que o maior já lido neste carro — digitação ou carro trocado.' },
  KM_BAIXO:        { rotulo: 'Km muito baixo',
    ajuda: 'O trecho rendeu menos de 1/3 do km/l normal deste mesmo carro.' },
  SEM_HODOMETRO:   { rotulo: 'Sem odômetro',
    ajuda: 'Lançado sem odômetro: o combustível conta, o km não.' },
}

/** Uma linha de `frota_painel()`. */
export interface VeiculoPainel {
  id: string; placa: string; apelido: string | null; modelo: string | null
  tipo: string | null; ano: number | null; propriedade: string | null
  pernoite: string | null
  rastreador: string | null; situacao: SituacaoVeiculo; situacao_em: string
  base_id: string | null; arquivado_em: string | null; arquivado_motivo: string | null
  condutor_id: string | null; condutor_nome: string | null; condutor_desde: string | null
  hodometro_atual: number | null; ultimo_abastecimento: string | null
  manutencao_aberta: boolean
}

export interface TecnicoOpcao { id: string; nome: string; matricula: string | null }

/** "PHY3690" → "PHY-3690" / Mercosul "QZT7D58" fica igual: só o hífen
 *  de leitura no padrão antigo (3 letras + 4 dígitos). */
export function placaLegivel(p: string): string {
  return /^[A-Z]{3}\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p
}

export const nomeVeiculo = (v: { placa: string; apelido: string | null }) =>
  v.apelido ? `${v.apelido} · ${placaLegivel(v.placa)}` : placaLegivel(v.placa)

export const km = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toLocaleString('pt-BR')} km`

export const num = (n: number | string | null | undefined, casas = 2) =>
  n == null ? '—' : Number(n).toLocaleString('pt-BR',
    { minimumFractionDigits: casas, maximumFractionDigits: casas })

/** O banco fala com códigos (42501, 23514); a tela fala com gente. */
export function traduzirErroFrota(msg: string): string {
  if (/Lançar na frota|Sem permissao na frota/i.test(msg))
    return 'Seu perfil não inclui "Lançar na frota". A barreira é do banco.'
  return msg
}

export const CAMPO = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
                     'outline-none focus:border-af-500'
