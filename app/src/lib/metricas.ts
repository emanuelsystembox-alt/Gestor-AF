import { SITUACAO_INFO, type Situacao } from './supabase'
import { equipeRotulo, horasMin } from './formato'

/** A equipe abrigo: onde o contrato para quando ninguém disse de quem é
 *  o login do TOA (ver `agent_docs/business-rules.md`). Mesmo código que
 *  Equipes e Administração já tratam à parte. */
const ABRIGO = 'SEM-LOGIN'

export interface OS {
  id: string
  sequencia: number
  numero_os: string
  status_operadora: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: {
    codigo: number; descricao: string
    natureza: string; responsabilidade: string | null
  } | null
}

export interface Visita {
  id: string
  toa_atividade_id: string | null
  wo_numero: string | null
  cliente_nome: string | null
  logradouro: string | null
  bairro: string | null
  data_agendada: string
  janela_inicio: string | null
  janela_fim: string | null
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
  equipe: { codigo: string; nome: string } | null
  tecnico: { nome: string; matricula: string } | null
  ordem_servico: OS[]
}

const RESP_ROTULO: Record<string, string> = {
  TECNICO: 'Nossa (técnico)',
  CLIENTE: 'Cliente',
  REDE: 'Rede',
  OPERADORA: 'Operadora (CLARO)',
  TERCEIRO: 'Terceiro / força maior',
  SEM_CLASSIFICACAO: 'Sem classificação',
}
const RESP_COR: Record<string, string> = {
  TECNICO: 'var(--color-af-500)',
  CLIENTE: '#f59e0b',
  REDE: '#0ea5e9',
  OPERADORA: '#8b5cf6',
  TERCEIRO: '#64748b',
  SEM_CLASSIFICACAO: '#3a4150',
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
  const produtivas = visitas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
  const jornada = visitas.filter(v => v.tipo_atividade?.natureza === 'JORNADA')

  const concluidas = produtivas.filter(v => v.situacao === 'CONCLUIDA')
  const emAberto = produtivas.filter(v =>
    !['CONCLUIDA', 'CANCELADA'].includes(v.situacao))

  const os = produtivas.flatMap(v => v.ordem_servico)
  const osComBaixa = os.filter(o => o.codigo_baixa)
  const osSucesso = os.filter(o => o.codigo_baixa?.natureza === 'SUCESSO')
  const osImprodutivas = os.filter(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')

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
    const k = o.codigo_baixa?.responsabilidade ?? 'SEM_CLASSIFICACAO'
    contaResp[k] = (contaResp[k] ?? 0) + 1
  }
  const porResponsabilidade = Object.entries(contaResp)
    .map(([k, valor]) => ({
      chave: k,
      rotulo: RESP_ROTULO[k] ?? k,
      valor,
      cor: RESP_COR[k] ?? '#3a4150',
      nossa: k === 'TECNICO',
    }))
    .sort((a, b) => b.valor - a.valor)

  const nossas = contaResp['TECNICO'] ?? 0

  // ---------- motivos de improdutividade ----------
  const contaMotivo = new Map<string, number>()
  for (const o of osImprodutivas) {
    const k = `${o.codigo_baixa!.codigo} · ${o.codigo_baixa!.descricao}`
    contaMotivo.set(k, (contaMotivo.get(k) ?? 0) + 1)
  }
  const motivos = [...contaMotivo.entries()]
    .map(([rotulo, valor]) => ({ rotulo, valor }))
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

  const desloc = produtivas.map(v => intervParaMin(v.tempo_deslocamento)).filter((x): x is number => x !== null)
  const exec = produtivas.map(v => minEntre(v.inicio, v.fim)).filter((x): x is number => x !== null)
  // O atraso é escrito em HORAS -- "eu quero em horas o atraso sobre a
  // janela, é melhor" (Emanuel, 23/09): 106 min não se lê de relance,
  // 1h46 sim. O `valor` segue em minutos para a barra ficar na mesma
  // escala das outras duas, que são curtas e continuam em minutos.
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
    taxaConclusao,
    porSituacao,
    porResponsabilidade,
    motivos,
    horas, hConcluida, hCancelada, hReagendamento,
    porGrupo,
    etapas, gargalo, pctNaJanela, dentroDaJanela, comJanela,
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
