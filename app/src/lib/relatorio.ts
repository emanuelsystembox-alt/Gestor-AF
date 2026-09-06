import { SITUACAO_INFO, type Situacao } from './supabase'

/**
 * Montagem das linhas do relatório.
 *
 * ┌─ POR QUE ISTO SAIU DA TELA ──────────────────────────────────────┐
 * │ O export do sistema atual tem 64 colunas. O nosso tinha 25 e 29. │
 * │ O que faltava não era enfeite: faltava PONTUAÇÃO, faltava a      │
 * │ descrição da O.S. ("ADESAO - INSTALAR PONTO VIRTUA", não só o    │
 * │ número), faltava telefone, faltava equipamento, faltava quem     │
 * │ importou, faltavam os 7 indicadores de qualidade em coluna.      │
 * │                                                                  │
 * │ Com 60+ colunas a função de montagem não cabe mais dentro do     │
 * │ componente sem afogar a tela. Ela mora aqui.                     │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Duas leituras, e a diferença NÃO é cosmética (D-001):
 *
 * - **Por contrato**: uma linha por VISITA. Deslocamento, janela,
 *   produtividade e PONTUAÇÃO. O técnico foi uma vez ao endereço.
 * - **Por O.S.**: uma linha por ORDEM DE SERVIÇO. Baixa e faturamento.
 *
 * Uma visita com 3 O.S. vira 1 linha na primeira e 3 na segunda. Somar
 * pontuação no relatório por O.S. contaria em triplo — por isso a
 * pontuação só aparece na linha da PRIMEIRA O.S. do endereço, e as
 * outras ficam em branco. Ver `PONTUACAO_NA_PRIMEIRA`.
 */

export const PONTUACAO_NA_PRIMEIRA =
  'A pontuação é da VISITA, não da O.S. No relatório por O.S. ela sai ' +
  'só na linha marcada "Primeira do endereço = SIM"; nas demais fica ' +
  'vazia, para a soma da planilha não contar em dobro.'

// ---------------------------------------------------------------- tipos

export interface OSLinha {
  id: string
  sequencia: number
  numero_os: string | null
  descricao: string | null
  origem: string | null
  status_operadora: string | null
  ponto: string | null
  produto: string | null
  observacao: string | null
  baixa_em: string | null
  baixa_observacao: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: BaixaRef | null
  baixa_afline: BaixaRef | null
  sub_falha: { nome: string; categoria: string | null } | null
  baixa_por_perfil: { nome: string; email: string } | null
}

interface BaixaRef {
  codigo: number
  descricao: string
  natureza: string | null
  responsabilidade: string | null
}

export interface VisitaLinha {
  id: string
  toa_atividade_id: string | null
  wo_numero: string | null
  contrato: string | null
  origem: string | null
  cliente_nome: string | null
  tipo_pessoa: string | null
  tipo_residencia: string | null
  telefones: string[] | null
  logradouro: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  node: string | null
  lat: number | null
  lng: number | null
  data_agendada: string
  janela_inicio: string | null
  janela_fim: string | null
  situacao: Situacao
  situacao_em: string | null
  inicio: string | null
  fim: string | null
  tempo_deslocamento: string | null
  observacao: string | null
  bloqueado_em: string | null
  criado_em: string
  tipo_atividade: { nome: string; natureza: string | null } | null
  tipo_servico: { nome: string } | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null
            login_toa: string | null } | null
  tecnico: { nome: string; matricula: string } | null
  base: { nome: string } | null
  importacao: {
    arquivo_nome: string; criado_em: string
    usuario: { nome: string; email: string } | null
  } | null
  criador: { nome: string; email: string } | null
  ordem_servico: OSLinha[]
  visita_marcador: { indicador_id: string; cumprido: boolean | null }[]
  equipamento_movimento: { operacao: string; serial: string
                           tipo: string | null; modelo: string | null }[]
  // `reincidencia` tem UNIQUE(visita_id), e por isso o PostgREST a trata
  // como um-para-um: vem OBJETO ou null, não array. Tratar como array
  // rebentava a tela inteira em `reincidencia[0]`.
  reincidencia: Reincidencia | Reincidencia[] | null
}

interface Reincidencia {
  dias_desde: number | null
  anterior: { data_agendada: string } | null
  equipe_anterior: { codigo: string } | null
  baixa_anterior: { codigo: number; descricao: string } | null
}

export interface PontoVisita {
  visita_id: string
  pontos_claro: number | null
  pontos_equipe: number | null
  edificacao: string
  edificacao_de: string
  achou: boolean
}

export interface Indicador { id: string; nome: string }

/**
 * O SELECT vive junto do montador porque os dois têm de mudar juntos:
 * coluna nova no relatório sem campo no SELECT sai vazia em silêncio,
 * e foi exatamente assim que a pontuação sumiu do export.
 */
export const SELECT_RELATORIO = `
  id, toa_atividade_id, wo_numero, contrato, origem,
  cliente_nome, tipo_pessoa, tipo_residencia, telefones,
  logradouro, complemento, bairro, cidade, uf, cep, node, lat, lng,
  data_agendada, janela_inicio, janela_fim,
  situacao, situacao_em, inicio, fim, tempo_deslocamento,
  observacao, bloqueado_em, criado_em,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome ),
  area:area_id ( codigo, apelido ),
  equipe:equipe_id ( codigo, nome, supervisor_nome, login_toa ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  base:base_id ( nome ),
  importacao:importacao_id (
    arquivo_nome, criado_em, usuario:usuario_id ( nome, email )
  ),
  criador:criado_por ( nome, email ),
  ordem_servico (
    id, sequencia, numero_os, descricao, origem, status_operadora,
    ponto, produto, observacao, baixa_em, baixa_observacao,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade ),
    baixa_afline:codigo_baixa_afline_id ( codigo, descricao, natureza, responsabilidade ),
    sub_falha:sub_falha_id ( nome, categoria ),
    baixa_por_perfil:baixa_por ( nome, email )
  ),
  visita_marcador ( indicador_id, cumprido ),
  equipamento_movimento ( operacao, serial, tipo, modelo ),
  reincidencia!reincidencia_visita_id_fkey (
    dias_desde,
    anterior:visita_anterior_id ( data_agendada ),
    equipe_anterior:equipe_anterior_id ( codigo ),
    baixa_anterior:codigo_baixa_anterior_id ( codigo, descricao )
  )
`

// ------------------------------------------------------------ formato

const dia = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pt-BR')
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')
const dt = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : ''
const soData = (ts: string | null) =>
  ts ? new Date(ts).toLocaleDateString('pt-BR') : ''
const soHora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR') : ''
const num = (n: number | null | undefined, casas = 4) =>
  n == null ? '' : Number(n).toFixed(casas).replace('.', ',')

/** hh:mm:ss entre dois instantes — a coluna "Tempo De Conclusão". */
function duracao(a: string | null, b: string | null): string {
  if (!a || !b) return ''
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
       + `:${String(s % 60).padStart(2, '0')}`
}

/**
 * Aderência à janela combinada — a métrica que serve, ao contrário de
 * "tempo de fila" medido a partir da importação (ver CLAUDE.md).
 * DENTRO, ANTES ou ATRASO em minutos.
 */
function aderencia(v: VisitaLinha): string {
  if (!v.inicio || !v.janela_inicio || !v.janela_fim) return ''
  const base = new Date(v.data_agendada + 'T00:00')
  const emMin = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const ini = new Date(v.inicio)
  const min = (ini.getTime() - base.getTime()) / 60000
  const de = emMin(v.janela_inicio), ate = emMin(v.janela_fim)
  if (min < de) return `ANTES ${Math.round(de - min)} min`
  if (min > ate) return `ATRASO ${Math.round(min - ate)} min`
  return 'DENTRO'
}

const endereco = (v: VisitaLinha) =>
  [v.logradouro, v.complemento].filter(Boolean).join(', ')

const listaOS = (v: VisitaLinha, f: (o: OSLinha) => string | null | undefined) =>
  [...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia)
    .map(f).filter(Boolean).join(' | ')

const baixaTxt = (b: BaixaRef | null) => (b ? `${b.codigo} - ${b.descricao}` : '')

// ------------------------------------------------------- bloco comum

/**
 * As colunas que descrevem a VISITA. Saem iguais nos dois relatórios —
 * no "por O.S." elas se repetem em cada ordem, como no sistema atual.
 */
const CAB_VISITA = [
  'Operação', 'ID Atividade', 'Origem', 'Situação', 'Data situação', 'Hora situação',
  'WO', 'Contrato', 'Grupo de serviço', 'Tipo de atividade', 'Natureza',
  'Data', 'Janela início', 'Janela fim',
  'Supervisor', 'Equipe', 'Nome da equipe', 'Login TOA da equipe',
  'Técnico', 'Matrícula', 'Login',
  'Área', 'Node',
  'Cliente', 'Tipo de pessoa', 'Tipo de residência', 'Telefones',
  'Endereço', 'Bairro', 'CEP', 'Cidade', 'UF', 'Lat', 'Lng',
  'Início', 'Fim', 'Tempo de conclusão', 'Tempo de deslocamento',
  'Aderência à janela',
  'Observação',
  'Equipamento instalado', 'Equipamento retirado',
  'Serviço anterior — data', 'Serviço anterior — dias',
  'Serviço anterior — equipe', 'Serviço anterior — baixa',
  'Bloqueado em', 'Importado por', 'Importado em', 'Arquivo', 'Cadastrado por',
]

function linhaVisita(v: VisitaLinha): string[] {
  const inst = v.equipamento_movimento.filter(e => e.operacao === 'INSTALADO')
  const retr = v.equipamento_movimento.filter(e => e.operacao === 'RETIRADO')
  const eq = (l: typeof inst) =>
    l.map(e => [e.serial, e.tipo, e.modelo].filter(Boolean).join(' - ')).join(' | ')
  const r: Reincidencia | null = Array.isArray(v.reincidencia)
    ? v.reincidencia[0] ?? null
    : v.reincidencia

  return [
    v.base?.nome ?? '',
    v.toa_atividade_id ?? '',
    v.origem ?? '',
    SITUACAO_INFO[v.situacao]?.label ?? v.situacao,
    soData(v.situacao_em), soHora(v.situacao_em),
    v.wo_numero ?? '', v.contrato ?? '',
    v.tipo_servico?.nome ?? '', v.tipo_atividade?.nome ?? '',
    v.tipo_atividade?.natureza ?? '',
    dia(v.data_agendada), hhmm(v.janela_inicio), hhmm(v.janela_fim),
    v.equipe?.supervisor_nome ?? '', v.equipe?.codigo ?? '', v.equipe?.nome ?? '',
    v.equipe?.login_toa ?? '',
    v.tecnico?.nome ?? '', v.tecnico?.matricula ?? '',
    // "Login" no sistema atual é o login do técnico no TOA — que é
    // exatamente a matrícula com que a importação casa o recurso.
    v.tecnico?.matricula ?? '',
    v.area?.apelido ?? v.area?.codigo ?? '', v.node ?? '',
    v.cliente_nome ?? '', v.tipo_pessoa ?? '', v.tipo_residencia ?? '',
    (v.telefones ?? []).join(' | '),
    endereco(v), v.bairro ?? '', v.cep ?? '', v.cidade ?? '', v.uf ?? '',
    v.lat == null ? '' : String(v.lat), v.lng == null ? '' : String(v.lng),
    dt(v.inicio), dt(v.fim), duracao(v.inicio, v.fim),
    v.tempo_deslocamento ?? '',
    aderencia(v),
    v.observacao ?? '',
    eq(inst), eq(retr),
    r?.anterior ? dia(r.anterior.data_agendada) : '',
    r?.dias_desde == null ? '' : String(r.dias_desde),
    r?.equipe_anterior?.codigo ?? '',
    r?.baixa_anterior ? `${r.baixa_anterior.codigo} - ${r.baixa_anterior.descricao}` : '',
    dt(v.bloqueado_em),
    v.importacao?.usuario?.nome ?? '', dt(v.importacao?.criado_em ?? null),
    v.importacao?.arquivo_nome ?? '',
    v.criador?.nome ?? '',
  ]
}

/** Uma coluna SIM/NÃO por indicador — é como o sistema atual entrega. */
function colunasIndicador(v: VisitaLinha, indicadores: Indicador[]): string[] {
  const marcados = new Map(v.visita_marcador.map(m => [m.indicador_id, m.cumprido]))
  return indicadores.map(i => {
    if (!marcados.has(i.id)) return ''
    const c = marcados.get(i.id)
    return c === false ? 'NÃO' : 'SIM'
  })
}

// ------------------------------------------------------ por contrato

export function porContrato(
  visitas: VisitaLinha[],
  pontos: Map<string, PontoVisita>,
  indicadores: Indicador[],
): string[][] {
  const cab = [
    ...CAB_VISITA,
    'Qtd O.S.', 'Números das O.S.', 'Descrições das O.S.', 'Origem das O.S.',
    'Status operadora', 'Baixas TOA', 'Baixas AFLINE', 'Sub-falhas',
    'Pontuação CLARO', 'Pontuação equipe', 'Edificação', 'Edificação lida de',
    'Regra de pontuação',
    ...indicadores.map(i => i.nome),
  ]

  return [cab, ...visitas.map(v => {
    const p = pontos.get(v.id)
    return [
      ...linhaVisita(v),
      String(v.ordem_servico.length),
      listaOS(v, o => o.numero_os),
      listaOS(v, o => o.descricao ?? o.tipo_os?.descricao),
      listaOS(v, o => o.origem),
      listaOS(v, o => o.status_operadora),
      listaOS(v, o => baixaTxt(o.codigo_baixa) || null),
      listaOS(v, o => baixaTxt(o.baixa_afline) || null),
      listaOS(v, o => o.sub_falha?.nome),
      num(p?.pontos_claro), num(p?.pontos_equipe),
      p?.edificacao ?? '', p?.edificacao_de ?? '',
      p ? (p.achou ? 'ENCONTRADA' : 'SEM REGRA') : '',
      ...colunasIndicador(v, indicadores),
    ]
  })]
}

// ----------------------------------------------------------- por O.S.

export function porOS(
  visitas: VisitaLinha[],
  pontos: Map<string, PontoVisita>,
  indicadores: Indicador[],
): string[][] {
  const cab = [
    ...CAB_VISITA,
    'Seq', 'Número O.S.', 'Ordem de serviço', 'Origem da O.S.',
    'Tipo O.S. cód.', 'Tipo O.S.', 'Ponto', 'Produto',
    'Status operadora',
    'Cód. baixa TOA', 'Baixa TOA', 'Natureza TOA', 'Responsabilidade TOA',
    'Cód. baixa AFLINE', 'Baixa AFLINE', 'Natureza AFLINE',
    'Sub-falha', 'Categoria da sub-falha',
    'Baixada em', 'Baixada por', 'Observação da baixa', 'Observação da O.S.',
    'Primeira do endereço',
    'Pontuação CLARO', 'Pontuação equipe', 'Edificação', 'Edificação lida de',
    'Regra de pontuação',
    ...indicadores.map(i => i.nome),
  ]

  const saida: string[][] = [cab]
  for (const v of visitas) {
    const p = pontos.get(v.id)
    const ordenadas = [...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia)
    // Visita sem O.S. ainda tem de aparecer — some-la esconderia
    // justamente o caso que precisa de conferência.
    const lista: (OSLinha | null)[] = ordenadas.length ? ordenadas : [null]

    for (const o of lista) {
      // A LPU distingue DESLOCAMENTO de AGREGADA: a primeira O.S. do
      // endereço paga cheio. E é só nela que a pontuação da visita sai,
      // para a soma da planilha não contar em dobro.
      const primeira = !o || o.sequencia === ordenadas[0].sequencia
      saida.push([
        ...linhaVisita(v),
        o ? String(o.sequencia) : '',
        o?.numero_os ?? '',
        o?.descricao ?? o?.tipo_os?.descricao ?? '',
        o?.origem ?? '',
        o?.tipo_os ? String(o.tipo_os.codigo) : '', o?.tipo_os?.descricao ?? '',
        o?.ponto ?? '', o?.produto ?? '',
        o?.status_operadora ?? '',
        o?.codigo_baixa ? String(o.codigo_baixa.codigo) : '',
        o?.codigo_baixa?.descricao ?? '',
        o?.codigo_baixa?.natureza ?? '', o?.codigo_baixa?.responsabilidade ?? '',
        o?.baixa_afline ? String(o.baixa_afline.codigo) : '',
        o?.baixa_afline?.descricao ?? '', o?.baixa_afline?.natureza ?? '',
        o?.sub_falha?.nome ?? '', o?.sub_falha?.categoria ?? '',
        dt(o?.baixa_em ?? null), o?.baixa_por_perfil?.nome ?? '',
        o?.baixa_observacao ?? '', o?.observacao ?? '',
        primeira ? 'SIM' : 'NAO',
        primeira ? num(p?.pontos_claro) : '',
        primeira ? num(p?.pontos_equipe) : '',
        primeira ? (p?.edificacao ?? '') : '',
        primeira ? (p?.edificacao_de ?? '') : '',
        primeira ? (p ? (p.achou ? 'ENCONTRADA' : 'SEM REGRA') : '') : '',
        ...colunasIndicador(v, indicadores),
      ])
    }
  }
  return saida
}

// ------------------------------------------------------------ arquivo

/** CSV com BOM e ponto-e-vírgula: é o que o Excel pt-BR abre direito. */
export function paraCSV(linhas: string[][]): Blob {
  const csv = linhas
    .map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n')
  return new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
}
