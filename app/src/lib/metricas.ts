import { SITUACAO_INFO, type Situacao } from './supabase'
import { equipeRotulo, horasMin } from './formato'
import { origemCancelada } from './filtroContratos'
import { LOG_GRAVE, lerLog } from './log'

/** A equipe abrigo: onde o contrato para quando ninguém disse de quem é
 *  o login do TOA (ver `agent_docs/business-rules.md`). Mesmo código que
 *  Equipes e Administração já tratam à parte. */
const ABRIGO = 'SEM-LOGIN'

export interface OS {
  id: string
  sequencia: number
  numero_os: string
  status_operadora: string | null
  /** TEC1 desta O.S., calculado AO VIVO pelo banco (109, D-187): PADRAO,
   *  SEM_PADRAO, EXPURGADA, ou nulo = ainda em aberto / sem hora. */
  tec1_ao_vivo?: 'PADRAO' | 'SEM_PADRAO' | 'EXPURGADA' | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: {
    codigo: number; descricao: string
    natureza: string; responsabilidade: string | null
    /** 141: de quem é a culpa, no vocabulário da CLARO (RESPONSAVEL_QUEBRA
     *  e AGRUPAMENTO_QUEBRA da planilha Quebra Qualificada). Nulo = a
     *  CLARO classifica caso a caso; o código sozinho não responde. */
    responsavel_quebra: string | null
    agrupamento_quebra: string | null
    quebra_pct: number | null
    /** 143: código improdutivo que termina em CONCLUIDA não é quebra —
     *  o serviço saiu (570, 582, 583). */
    situacao_destino: string | null
  } | null
  /** A baixa da AFLINE (D-042) — só a lista do TEC1 perdido usa. */
  baixa_afline?: { codigo: number; descricao: string } | null
}

export interface Visita {
  id: string
  toa_atividade_id: string | null
  wo_numero: string | null
  /** Só a lista do TEC1 perdido usa; telas que não pedem vêm sem. */
  contrato?: string | null
  /** "Status da Atividade" do TOA — separa "Cancelado pela central". */
  status_toa?: string | null
  /** "Contador de log" do TOA: quantas vezes o contrato já voltou para a
   *  agenda (144). Nulo = a linha não trouxe a coluna. Nulo não é zero. */
  contador_log?: string | null
  cliente_nome: string | null
  logradouro: string | null
  bairro: string | null
  /** Bucket do TOA da última importação que trouxe o contrato (119). Nulo = manual. */
  toa_bucket?: string | null
  data_agendada: string
  janela_inicio: string | null
  janela_fim: string | null
  /** O TOA mandou "Imediata" no Intervalo de Tempo: sem faixa, mas não "sem janela" (115). */
  janela_imediata?: boolean | null
  situacao: Situacao
  bloqueado_em: string | null
  origem: string
  criado_em: string
  inicio: string | null
  fim: string | null
  tempo_deslocamento: string | null
  tipo_atividade: { nome: string; natureza: string } | null
  tipo_servico: { nome: string; prioridade: number } | null
  area: { codigo: string } | null
  equipe: { codigo: string; nome: string; supervisor_nome?: string | null } | null
  tecnico: { nome: string; matricula: string; supervisor?: { nome: string } | null } | null
  ordem_servico: OS[]
}

/**
 * ┌─ o vocabulário é o da CLARO, não o nosso (141) ───────────────────┐
 * │ > "o certo é dizer exatamente de quem é a culpa (...) essas       │
 * │ >  informações estão na coluna AG e AH, responsável de quebra e   │
 * │ >  agrupamento de quebra" — Emanuel, 25/10                        │
 * │                                                                    │
 * │ O de antes (TECNICO/CLIENTE/REDE/OPERADORA/TERCEIRO) era nosso,   │
 * │ inventado antes de existir a planilha — e era o que classificava  │
 * │ errado: dizia "100% Operadora" onde a CLARO diz Serviços de Campo. │
 * │                                                                    │
 * │ SERVICOS DE CAMPO é a AFLINE: é a única que é NOSSA conta.        │
 * └────────────────────────────────────────────────────────────────────┘
 */
/**
 * A hora do dia EM MANAUS, em minutos desde a meia-noite.
 *
 * `getHours()` usaria o fuso de quem abre o navegador — e o indicador
 * Primeira WO (140) calcula em `America/Manaus`, no banco. Duas telas
 * com o mesmo nome dando horas diferentes é o pior dos dois mundos
 * (D-150), então aqui o fuso é o mesmo, fixo.
 */
/**
 * Os "Status da Atividade" do TOA que provam que o técnico CHEGOU (145).
 *
 * PENDENTE e EM ROTA têm `inicio`, mas é o horário que o TOA reservou:
 * promessa, não chegada. CANCELADO entra só quando o TOA o marcou
 * concluído — cancelado pela central ninguém foi ver.
 */
const CHEGOU_NO_TOA = new Set(['CONCLUIDO', 'NAO CONCLUIDO', 'INICIADO'])

/** Mesma normalização do `norm_txt` do banco: sem acento, maiúsculo. */
const normStatusToa = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()

function minutosEmManaus(iso: string): number {
  const t = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

/** Uma O.S. improdutiva por trás do número, para o coordenador atuar (141). */
export interface ItemMotivo {
  visita_id: string; contrato: string | null; os: string | null
  servico: string | null; tecnico: string | null; equipe: string | null
  responsavel: string | null
}

const RESP_ROTULO: Record<string, string> = {
  'SERVICOS DE CAMPO': 'Serviços de campo (nossa)',
  COMERCIAL: 'Comercial',
  DAC: 'DAC',
  REAG_CLIENTE: 'Reagendamento do cliente',
  CLIENTE: 'Cliente',
  USO_INTERNO: 'Uso interno',
  CHUVA: 'Chuva',
  SEM_QUEBRA: 'Sem quebra',
  SEM_CLASSIFICACAO: 'A CLARO classifica caso a caso',
}
const RESP_COR: Record<string, string> = {
  'SERVICOS DE CAMPO': 'var(--color-af-500)',
  COMERCIAL: '#8b5cf6',
  DAC: '#0ea5e9',
  REAG_CLIENTE: '#f59e0b',
  CLIENTE: '#eab308',
  USO_INTERNO: '#64748b',
  CHUVA: '#38bdf8',
  SEM_QUEBRA: '#16a34a',
  SEM_CLASSIFICACAO: '#3a4150',
}
/** A nossa — a que a AFLINE paga. */
export const RESP_NOSSA = 'SERVICOS DE CAMPO'

/** A cor de cada agrupamento de quebra (142). Roxo para o maior ofensor
 *  histórico (agendamento), como no painel da própria CLARO. */
const AGR_COR: Record<string, string> = {
  AGENDAMENTO: '#8b5cf6',
  'PROCESSO VENDA': '#a855f7',
  'INFRA CLARO': '#6366f1',
  'MOVIMENTAÇÕES DE AGENDA': '#0ea5e9',
  TUBULACAO: '#14b8a6',
  'INFRA CLIENTE': '#eab308',
  CHUVA: '#38bdf8',
  'TÉCNICO': 'var(--color-af-500)',
  SEM_QUEBRA: '#16a34a',
  SEM_AGRUPAMENTO: '#3a4150',
}

/** '00:32:00' → 32 (minutos). Postgres devolve interval como texto. */
function intervParaMin(v: string | null): number | null {
  if (!v) return null
  const m = v.match(/^(\d+):(\d+):(\d+)/)
  if (!m) return null
  return +m[1] * 60 + +m[2] + Math.round(+m[3] / 60)
}

function minEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 60000
  return d >= 0 && d < 60 * 24 * 7 ? d : null
}

function media(v: number[]): number {
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0
}

// `agora` era parametro so por causa da janela em risco, que saiu
// (D-153). Nenhum chamador passava: `Controle.tsx` sempre chamou
// `calcular(filtradas)`. Parametro que ninguem usa e assinatura que
// mente sobre o que a funcao depende.
export function calcular(visitas: Visita[]) {
  // D-011/D-001: jornada NUNCA entra no denominador de produtividade.
  // "Na Base" e "Refeição" somaram 94 dos 349 apontamentos do dia 04/09 —
  // deixá-los dentro derruba a taxa de conclusão artificialmente.
  /*
   * ┌─ 152 · o que ninguém foi fazer sai de TODAS as contas ───────────┐
   * │ > "cancelado pela central e desatribuído (...) ambos não entram  │
   * │ >  na porcentagem de conclusão e não entram em nada dos dados    │
   * │ >  mostrados nessa tela do dashboard. Mas é bom a pessoa ver o   │
   * │ >  que foi cancelado pela central e o que foi desatribuído"      │
   * │ >  — Emanuel, 26/10                                              │
   * │                                                                    │
   * │ A D-223 já os tinha tirado da QUEBRA e a D-225 da conta da        │
   * │ equipe; faltava o Dashboard, que ainda os somava em "visitas      │
   * │ produtivas" e portanto no denominador da conclusão, no TEC1, nas  │
   * │ improdutivas e no LOG. Medido em 26/10: 343 viravam 291.          │
   * │                                                                    │
   * │ Eles NÃO somem da tela: a matriz ganhou duas colunas só para      │
   * │ eles, fora do total e fora do % concluído. Ver é diferente de     │
   * │ contar.                                                            │
   * └────────────────────────────────────────────────────────────────────┘
   */
  const naoJornada = visitas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
  const foraDaConta = naoJornada.filter(v => origemCancelada(v) != null)
  const produtivas = naoJornada.filter(v => origemCancelada(v) == null)
  const canceladoCentral = foraDaConta.filter(v => origemCancelada(v) === 'CANCELADO_CENTRAL').length
  const desatribuido = foraDaConta.filter(v => origemCancelada(v) === 'DESATRIBUIDO').length
  const jornada = visitas.filter(v => v.tipo_atividade?.natureza === 'JORNADA')

  const concluidas = produtivas.filter(v => v.situacao === 'CONCLUIDA')
  const emAberto = produtivas.filter(v =>
    !['CONCLUIDA', 'CANCELADA'].includes(v.situacao))

  const os = produtivas.flatMap(v => v.ordem_servico)
  const osComBaixa = os.filter(o => o.codigo_baixa)
  const osSucesso = os.filter(o => o.codigo_baixa?.natureza === 'SUCESSO')
  /*
   * ┌─ o que é QUEBRA, e o que só parece (143) ────────────────────────┐
   * │ > "isso é válido somente para contratos improdutivos; concluídos,│
   * │ >  auditoria e cancelado central não entram" — Emanuel, 26/10    │
   * │                                                                   │
   * │ Três coisas saem da conta, e cada uma por um motivo:             │
   * │  · CONCLUÍDO — há código improdutivo cuja baixa leva a CONCLUIDA │
   * │    (570 refazer coaxial, 582 roteador, 583 refazer óptico): o    │
   * │    serviço saiu. A própria CLARO os marca SEM_QUEBRA;            │
   * │  · AUDITAR — o 800 é desatribuição nossa (116), não quebra da    │
   * │    operação;                                                      │
   * │  · CANCELADO PELA CENTRAL — quem cancelou foi a central no TOA,  │
   * │    antes de o técnico ir. Cobrar isso de quem executa é errado.  │
   * └───────────────────────────────────────────────────────────────────┘
   */
  // 152: `produtivas` já exclui cancelado pela central e desatribuído,
  // então o filtro que a D-223 fazia aqui virou redundante -- e deixá-lo
  // seria a mesma regra escrita duas vezes, para divergir um dia.
  const osImprodutivas = produtivas.flatMap(v =>
    v.ordem_servico.filter(o =>
      o.codigo_baixa?.natureza === 'IMPRODUTIVA'
      && o.codigo_baixa.agrupamento_quebra !== 'SEM_QUEBRA'
      && o.codigo_baixa.situacao_destino !== 'CONCLUIDA'))

  /*
   * ┌─ 144 · o LOG, que é da CLARO e não nosso ────────────────────────┐
   * │ > "ao lado de improdutivas, coloque a tag log, preciso saber     │
   * │ >  igual ao tec1, os log acima de 0 devem aparecer, log de       │
   * │ >  visita técnica - log de adesão, de mudança de pacote"         │
   * │ >  — Emanuel, 26/10                                              │
   * │                                                                   │
   * │ O número que o card mostra é de CONTRATO, não de O.S.: o LOG     │
   * │ conta idas à agenda, e uma ida é uma visita. Jornada fica fora   │
   * │ (não é contrato e a planilha nem traz a coluna nela).            │
   * │                                                                   │
   * │ `logSemInfo` existe porque zero e desconhecido não são a mesma   │
   * │ coisa: contrato sem a coluna não entra em "LOG 0", entra aqui —  │
   * │ senão o card afirmaria "nunca voltou" sobre o que ele não sabe.  │
   * └───────────────────────────────────────────────────────────────────┘
   */
  const logs = produtivas.map(v => ({ v, n: lerLog(v.contador_log) }))
  const logComRetorno = logs.filter(l => l.n != null && l.n > 0).length
  const logGraves = logs.filter(l => l.n != null && l.n >= LOG_GRAVE).length
  const logSemInfo = logs.filter(l => l.n == null).length
  const logMedidos = logs.length - logSemInfo
  const logRetornos = logs.reduce((t, l) => t + (l.n ?? 0), 0)
  const pctLog = logMedidos ? (logComRetorno * 100) / logMedidos : 0

  const taxaConclusao = produtivas.length
    ? (concluidas.length / produtivas.length) * 100 : 0

  // "Janela em risco" (menos de 60 min para o fim) foi retirada a pedido
  // em 23/09 — ver D-153. A conta saiu junto com o aviso: metrica que
  // ninguem le e calculo rodando a cada render por nada.

  // ---------- distribuição por situação ----------
  const porSituacao = (Object.keys(SITUACAO_INFO) as Situacao[]).map(s => ({
    rotulo: SITUACAO_INFO[s].label,
    valor: produtivas.filter(v => v.situacao === s).length,
    cor: SITUACAO_INFO[s].cor,
  }))

  // ---------- improdutivas por responsabilidade (nosso diferencial) ----------
  const contaResp: Record<string, number> = {}
  for (const o of osImprodutivas) {
    const k = o.codigo_baixa?.responsavel_quebra ?? 'SEM_CLASSIFICACAO'
    contaResp[k] = (contaResp[k] ?? 0) + 1
  }
  const porResponsabilidade = Object.entries(contaResp)
    .map(([k, valor]) => ({
      chave: k,
      rotulo: RESP_ROTULO[k] ?? k,
      valor,
      cor: RESP_COR[k] ?? '#3a4150',
      nossa: k === RESP_NOSSA,
    }))
    .sort((a, b) => b.valor - a.valor)

  const nossas = contaResp[RESP_NOSSA] ?? 0

  /*
   * ┌─ a quebra por AGRUPAMENTO, no formato da CLARO (142) ────────────┐
   * │ > "preciso desse painel alinhado igual ao do anexo 2 (...) temos │
   * │ >  o maior ofensor como agendamento, depois processo de venda,   │
   * │ >  depois infra claro (...) quando eu botar o mouse em cima      │
   * │ >  dessas barras, a ideia é aparecer também um resumo"           │
   * │ >  — Emanuel, 26/10                                              │
   * │                                                                   │
   * │ O painel dele não é por RESPONSÁVEL (Comercial, DAC…): é por     │
   * │ AGRUPAMENTO — em que parte do processo a quebra aconteceu. Cada  │
   * │ barra traz o impacto sobre o total de UN, a fatia das quebras e  │
   * │ os cinco motivos que mais pesam dentro dela.                     │
   * │                                                                   │
   * │ UN = O.S. COM BAIXA, o mesmo denominador que a tela já mostra    │
   * │ em "328 de 2305 O.S. com baixa" — dois denominadores na mesma    │
   * │ tela seria a contradição da D-150 de novo.                       │
   * └───────────────────────────────────────────────────────────────────┘
   */
  const agrupados = new Map<string, { volume: number; motivos: Map<string, number> }>()
  for (const o of osImprodutivas) {
    const k = o.codigo_baixa?.agrupamento_quebra ?? 'SEM_AGRUPAMENTO'
    const g = agrupados.get(k) ?? { volume: 0, motivos: new Map<string, number>() }
    g.volume += 1
    const mot = `${o.codigo_baixa!.codigo} · ${o.codigo_baixa!.descricao}`
    g.motivos.set(mot, (g.motivos.get(mot) ?? 0) + 1)
    agrupados.set(k, g)
  }
  const totalUn = osComBaixa.length
  const porAgrupamento = [...agrupados.entries()]
    .map(([chave, g]) => ({
      chave,
      rotulo: chave === 'SEM_AGRUPAMENTO' ? 'sem agrupamento' : chave.toLowerCase(),
      valor: g.volume,
      pctUn: totalUn ? (g.volume * 100) / totalUn : 0,
      pctQuebras: osImprodutivas.length ? (g.volume * 100) / osImprodutivas.length : 0,
      cor: AGR_COR[chave] ?? '#8b5cf6',
      motivos: [...g.motivos.entries()]
        .map(([rotulo, qtd]) => ({ rotulo, qtd }))
        .sort((a, b) => b.qtd - a.qtd)
        .slice(0, 5),
    }))
    .sort((a, b) => b.valor - a.valor)

  // ---------- motivos de improdutividade ----------
  // 141: cada motivo leva junto QUAIS contratos são — "quando o usuário
  // clicar em cima, aparecer o contrato, o tipo de serviço e o técnico
  // que deu a quebra" (Emanuel, 25/10). Sem isso o coordenador vê o
  // número e não tem onde atuar.
  const contaMotivo = new Map<string, ItemMotivo[]>()
  for (const v of produtivas) {
    for (const o of v.ordem_servico) {
      if (o.codigo_baixa?.natureza !== 'IMPRODUTIVA') continue
      const k = `${o.codigo_baixa.codigo} · ${o.codigo_baixa.descricao}`
      const l = contaMotivo.get(k) ?? []
      l.push({
        visita_id: v.id, contrato: v.contrato ?? null, os: o.numero_os ?? null,
        servico: v.tipo_servico?.nome ?? v.tipo_atividade?.nome ?? null,
        tecnico: v.tecnico?.nome ?? null, equipe: v.equipe?.codigo ?? null,
        responsavel: o.codigo_baixa.responsavel_quebra ?? null,
      })
      contaMotivo.set(k, l)
    }
  }
  const motivos = [...contaMotivo.entries()]
    .map(([rotulo, itens]) => ({ rotulo, valor: itens.length, itens }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 10)

  // ---------- encerramentos por hora ----------
  //
  // ┌─ a cor passa a ser a SITUAÇÃO ───────────────────────────────────┐
  // │ > "quero colocar as cores por hora: cancelado vermelho, verde    │
  // │ >  executado, e amarelo reagendado" — Emanuel, 23/09             │
  // │                                                                  │
  // │ Antes as três séries eram "concluído / com improdutiva / com     │
  // │ impedimento": a primeira cor era situação e as outras duas eram  │
  // │ OUTRO eixo (que tipo de baixa a O.S. teve). Misturar os dois no  │
  // │ mesmo empilhado fazia o gráfico responder meia pergunta — e      │
  // │ CANCELADA, que é 8 de 24 hoje, não aparecia em lugar nenhum.     │
  // │                                                                  │
  // │ Agora é um eixo só: as três situações TERMINAIS, nas mesmas      │
  // │ cores que a tela inteira usa (`SITUACAO_INFO`). A leitura de     │
  // │ improdutiva continua inteira no painel de responsabilidade.      │
  // └──────────────────────────────────────────────────────────────────┘
  //
  // Encerramento é `fim`. Conferido no dia 23/09: as três situações
  // terminais têm `fim` em 100% das linhas (14 / 8 / 1), então nenhuma
  // barra nasce vazia por falta de dado.
  const horas = Array.from({ length: 24 }, (_, i) => i)
  const zeros = () => Array(24).fill(0) as number[]
  const hConcluida = zeros(), hCancelada = zeros(), hReagendamento = zeros()
  for (const v of produtivas) {
    if (!v.fim) continue
    const h = new Date(v.fim).getHours()
    if (v.situacao === 'CONCLUIDA') hConcluida[h]++
    else if (v.situacao === 'CANCELADA') hCancelada[h]++
    else if (v.situacao === 'REAGENDAMENTO') hReagendamento[h]++
  }

  // ---------- tempo médio por etapa ----------
  // NÃO medimos "fila" a partir de criado_em: essa é a hora da IMPORTAÇÃO.
  // Também não serve medir da atribuição no TOA — ela acontece às 00:23 da
  // madrugada, então estaríamos medindo a noite inteira (deu 878 min no dia
  // 04/09) e nenhum controlador pode agir sobre isso.
  //
  // A métrica que a operação consegue usar é a aderência à janela combinada
  // com o cliente: quanto depois do início do intervalo o técnico chegou.
  const atraso = produtivas
    .map(v => {
      if (!v.inicio || !v.janela_inicio) return null
      const [h, mi] = v.janela_inicio.split(':').map(Number)
      const abertura = new Date(v.data_agendada + 'T00:00:00')
      abertura.setHours(h, mi, 0, 0)
      const d = (new Date(v.inicio).getTime() - abertura.getTime()) / 60000
      return Math.abs(d) < 60 * 14 ? d : null
    })
    .filter((x): x is number => x !== null)

  const dentroDaJanela = produtivas.filter(v => {
    if (!v.inicio || !v.janela_inicio || !v.janela_fim) return false
    const t = new Date(v.inicio)
    const [hi, mi] = v.janela_inicio.split(':').map(Number)
    const [hf, mf] = v.janela_fim.split(':').map(Number)
    const ini = new Date(v.data_agendada + 'T00:00:00'); ini.setHours(hi, mi, 0, 0)
    const fim = new Date(v.data_agendada + 'T00:00:00'); fim.setHours(hf, mf, 0, 0)
    return t >= ini && t <= fim
  }).length
  const comJanela = produtivas.filter(v => v.inicio && v.janela_inicio && v.janela_fim).length
  const pctNaJanela = comJanela ? (dentroDaJanela / comJanela) * 100 : 0

  /*
   * ┌─ TEC1 · Atendimento no Prazo (D-187) ───────────────────────────┐
   * │ A conta oficial da CLARO: COM PADRÃO / (COM PADRÃO + SEM        │
   * │ PADRÃO), POR O.S. — expurgada não entra, e o que ainda está em  │
   * │ aberto também não ("o cálculo é pra fazer em tudo que foi       │
   * │ encerrado", Emanuel, 19/10). A classe de cada O.S. vem do banco │
   * │ (tec1_da_os, pelo livro "Indicadores COP - TEC1").              │
   * └─────────────────────────────────────────────────────────────────┘
   */
  const tec1Padrao = os.filter(o => o.tec1_ao_vivo === 'PADRAO').length
  const tec1SemPadrao = os.filter(o => o.tec1_ao_vivo === 'SEM_PADRAO').length
  const tec1Expurgadas = os.filter(o => o.tec1_ao_vivo === 'EXPURGADA').length
  const tec1EmAberto = os.filter(o => o.tec1_ao_vivo == null).length
  const tec1Medidas = tec1Padrao + tec1SemPadrao
  const pctTec1 = tec1Medidas ? (tec1Padrao / tec1Medidas) * 100 : 0

  const desloc = produtivas.map(v => intervParaMin(v.tempo_deslocamento)).filter((x): x is number => x !== null)
  const exec = produtivas.map(v => minEntre(v.inicio, v.fim)).filter((x): x is number => x !== null)
  // O atraso é escrito em HORAS -- "eu quero em horas o atraso sobre a
  // janela, é melhor" (Emanuel, 23/09): 106 min não se lê de relance,
  // 1h46 sim. O `valor` segue em minutos para a barra ficar na mesma
  // escala das outras duas, que são curtas e continuam em minutos.
  /*
   * ┌─ a PRIMEIRA WO do time (141) ────────────────────────────────────┐
   * │ > "era bom saber quanto o time inteiro se atrasou para chegar na │
   * │ >  primeira WO (...) qual é o tempo médio de deslocamento de     │
   * │ >  todas as equipes? E qual é o tempo de execução, conforme o    │
   * │ >  filtro lá em cima?" — Emanuel, 25/10                          │
   * │                                                                   │
   * │ Mesma regra do indicador (140): a primeira visita PRODUTIVA com  │
   * │ contrato de cada técnico em cada dia, pela hora de início do     │
   * │ TOA. A média é do time inteiro, no filtro que está na tela.      │
   * └───────────────────────────────────────────────────────────────────┘
   */
  const primeiraDoDia = new Map<string, number>()
  for (const v of produtivas) {
    // O mesmo filtro do indicador (140): natureza PRODUTIVA de verdade,
    // não "tudo que não é jornada". Sem isto as duas telas dão horas
    // diferentes para o mesmo nome.
    if (v.tipo_atividade?.natureza !== 'PRODUTIVA') continue
    if (!v.inicio || !v.contrato || !v.tecnico?.matricula) continue
    // 145: `inicio` preenchido NÃO é prova de chegada — o TOA o preenche
    // com o horário PLANEJADO. Só conta o que ele ABRIU. Medido em 14
    // dias: 292 PENDENTE (um deles às 20:27) e 28 EM ROTA entravam na
    // média. Mesma lista do indicador (145), para as duas telas não
    // darem horas diferentes para o mesmo nome.
    if (!CHEGOU_NO_TOA.has(normStatusToa(v.status_toa))) continue
    const chave = `${v.tecnico.matricula}|${v.data_agendada}`
    const min = minutosEmManaus(v.inicio)
    const atual = primeiraDoDia.get(chave)
    if (atual == null || min < atual) primeiraDoDia.set(chave, min)
  }
  const chegadas = [...primeiraDoDia.values()]
  // Nulo quando ninguém tem início medido: zero diria "chegaram à
  // meia-noite", que é pior que não dizer (regra 6).
  const primeiraWoMin = chegadas.length
    ? Math.round(chegadas.reduce((a, b) => a + b, 0) / chegadas.length) : null
  const primeiraWo = {
    minutos: primeiraWoMin,
    dias: chegadas.length,
    texto: primeiraWoMin == null ? null
      : `${String(Math.floor(primeiraWoMin / 60)).padStart(2, '0')}:${String(primeiraWoMin % 60).padStart(2, '0')}`,
  }

  const mAtraso = media(atraso)
  const etapas: { rotulo: string; valor: number; cor: string; texto: string }[] = [
    { rotulo: 'Atraso sobre a janela', valor: mAtraso, cor: '#f59e0b', texto: horasMin(mAtraso) },
    { rotulo: 'Deslocamento', valor: media(desloc), cor: '#0ea5e9', texto: `${media(desloc)} min` },
    { rotulo: 'Execução', valor: media(exec), cor: '#16a34a', texto: `${media(exec)} min` },
  ]
  const gargalo = etapas.reduce((a, b) => (b.valor > a.valor ? b : a), etapas[0])

  // ---------- equipes por volume ----------
  // ┌─ por que o abrigo sai do ranking ────────────────────────────────┐
  // │ 96% das concluídas do mês caem em `SEM-LOGIN` ("Sem login       │
  // │ definido") ou em visita sem equipe nenhuma. Desenhadas na mesma  │
  // │ escala das equipes de verdade, elas viram UMA barra cheia e duas │
  // │ riscas — o gráfico deixa de ser ranking e vira o retrato de um   │
  // │ cadastro incompleto.                                            │
  // │                                                                 │
  // │ Some com ele? Não: some com a única coisa acionável da tela. Ele │
  // │ sai do ranking e vira CONTAGEM à parte, escrita, com o caminho   │
  // │ do conserto. Zero e desconhecido não são a mesma coisa — e aqui  │
  // │ o desconhecido é a maioria.                                     │
  // └─────────────────────────────────────────────────────────────────┘
  const contaEquipe = new Map<string, { rotulo: string; valor: number }>()
  let semDono = 0
  for (const v of concluidas) {
    const cod = v.equipe?.codigo ?? null
    if (!cod || cod === ABRIGO) { semDono++; continue }
    const e = contaEquipe.get(cod) ?? { rotulo: equipeRotulo(cod, v.equipe?.nome), valor: 0 }
    e.valor++
    contaEquipe.set(cod, e)
  }
  const equipes = [...contaEquipe.values()]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)
  /** Concluídas que o ranking acima NÃO explica. */
  const concluidasSemDono = semDono

  // ---------- por GRUPO DE SERVIÇO (agrupamento de negócio) ----------
  // Diferente de tipo_atividade: este é como a operação e a CLARO
  // enxergam. Derivado do cruzamento TOA × ngestor (ver migration 014).
  const grupos = new Map<string, { total: number; andamento: number; concluido: number; improd: number; imped: number; prio: number }>()
  for (const v of produtivas) {
    const k = v.tipo_servico?.nome ?? '(sem grupo)'
    const g = grupos.get(k) ?? { total: 0, andamento: 0, concluido: 0, improd: 0, imped: 0, prio: v.tipo_servico?.prioridade ?? 99 }
    g.total++
    if (v.situacao === 'CONCLUIDA') {
      if (v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')) g.improd++
      else g.concluido++
    } else if (v.situacao === 'COM_IMPEDIMENTO') g.imped++
    else if (v.situacao !== 'CANCELADA') g.andamento++
    grupos.set(k, g)
  }
  const porGrupo = [...grupos.entries()]
    .map(([grupo, g]) => ({ tipo: grupo, ...g, pct: g.total ? (g.concluido / g.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total)

  // ---------- por tipo de atividade (nomenclatura do TOA) ----------
  const tipos = new Map<string, { total: number; andamento: number; concluido: number; improd: number; imped: number }>()
  for (const v of produtivas) {
    const k = v.tipo_atividade?.nome ?? '(sem tipo)'
    const t = tipos.get(k) ?? { total: 0, andamento: 0, concluido: 0, improd: 0, imped: 0 }
    t.total++
    if (v.situacao === 'CONCLUIDA') {
      if (v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')) t.improd++
      else t.concluido++
    } else if (v.situacao === 'COM_IMPEDIMENTO') t.imped++
    else if (!['CANCELADA'].includes(v.situacao)) t.andamento++
    tipos.set(k, t)
  }
  const porTipo = [...tipos.entries()]
    .map(([tipo, t]) => ({
      tipo, ...t,
      pct: t.total ? ((t.concluido / t.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  return {
    visitas: visitas.length,
    produtivas: produtivas.length,
    jornada: jornada.length,
    concluidas: concluidas.length,
    emAberto: emAberto.length,
    os: os.length,
    osComBaixa: osComBaixa.length,
    osSucesso: osSucesso.length,
    osImprodutivas: osImprodutivas.length,
    nossas,
    // 152: aparecem na matriz, não entram em conta nenhuma.
    foraDaConta: foraDaConta.length, canceladoCentral, desatribuido,
    logComRetorno, logGraves, logSemInfo, logMedidos, logRetornos, pctLog,
    taxaConclusao,
    porSituacao,
    porResponsabilidade,
    porAgrupamento, totalUn,
    motivos,
    horas, hConcluida, hCancelada, hReagendamento,
    porGrupo,
    etapas, gargalo, primeiraWo, pctNaJanela, dentroDaJanela, comJanela,
    tec1Padrao, tec1SemPadrao, tec1Expurgadas, tec1EmAberto, tec1Medidas, pctTec1,
    equipes, concluidasSemDono,
    porTipo,
    listaProdutivas: produtivas,
  }
}

export type Metricas = ReturnType<typeof calcular>

/** Exporta a tabela por tipo como CSV — o controlador leva para a reunião. */
export function csvPorTipo(m: Metricas, data: string): string {
  const linhas = [
    ['Tipo', 'Total', 'Em andamento', 'Concluído', 'Improdutivo', 'Impedimento', '% conclusão'],
    ...m.porTipo.map(t => [
      t.tipo, t.total, t.andamento, t.concluido, t.improd, t.imped,
      t.pct.toFixed(1).replace('.', ',') + '%',
    ]),
    ['Total', m.produtivas, m.produtivas - m.concluidas, m.concluidas, m.osImprodutivas, '',
      m.taxaConclusao.toFixed(1).replace('.', ',') + '%'],
  ]
  return `AFLINE Manager - Ordens por tipo - ${data}\n` +
    linhas.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
}
