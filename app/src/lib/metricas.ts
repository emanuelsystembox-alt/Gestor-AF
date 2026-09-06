import { SITUACAO_INFO, type Situacao } from './supabase'

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
  tipo_servico: { nome: string } | null
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

export function calcular(visitas: Visita[], agora = new Date()) {
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

  // Janela em risco: ainda aberta e faltando menos de 60 min para o fim.
  const hojeStr = agora.toISOString().slice(0, 10)
  const emRisco = emAberto.filter(v => {
    if (!v.janela_fim) return false
    // Janela "estourando" so tem sentido para HOJE. Num periodo historico
    // toda visita aberta apareceria como vencida, virando ruido.
    if (v.data_agendada !== hojeStr) return false
    const [h, m] = v.janela_fim.split(':').map(Number)
    const limite = new Date(v.data_agendada + 'T00:00:00')
    limite.setHours(h, m, 0, 0)
    const faltam = (limite.getTime() - agora.getTime()) / 60000
    return faltam <= 60
  })
  const vencidas = emRisco.filter(v => {
    const [h, m] = v.janela_fim!.split(':').map(Number)
    const limite = new Date(v.data_agendada + 'T00:00:00')
    limite.setHours(h, m, 0, 0)
    return limite.getTime() < agora.getTime()
  })

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
  const horas = Array.from({ length: 24 }, (_, i) => i)
  const zeros = () => Array(24).fill(0) as number[]
  const hConcluido = zeros(), hImprodutivo = zeros(), hImpedimento = zeros()
  for (const v of produtivas) {
    if (!v.fim) continue
    const h = new Date(v.fim).getHours()
    if (v.situacao === 'CONCLUIDA') {
      const temImprod = v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')
      if (temImprod) hImprodutivo[h]++ ; else hConcluido[h]++
    } else if (v.situacao === 'COM_IMPEDIMENTO') hImpedimento[h]++
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
  const etapas = [
    { rotulo: 'Atraso sobre a janela', valor: media(atraso), cor: '#f59e0b' },
    { rotulo: 'Deslocamento', valor: media(desloc), cor: '#0ea5e9' },
    { rotulo: 'Execução', valor: media(exec), cor: '#16a34a' },
  ]
  const gargalo = etapas.reduce((a, b) => (b.valor > a.valor ? b : a), etapas[0])

  // ---------- equipes por volume ----------
  const contaEquipe = new Map<string, number>()
  for (const v of concluidas) {
    const k = v.equipe?.codigo ?? '(sem equipe)'
    contaEquipe.set(k, (contaEquipe.get(k) ?? 0) + 1)
  }
  const equipes = [...contaEquipe.entries()]
    .map(([rotulo, valor]) => ({ rotulo, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 8)

  // ---------- por tipo de serviço ----------
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
    emRisco: emRisco.length,
    vencidas: vencidas.length,
    porSituacao,
    porResponsabilidade,
    motivos,
    horas, hConcluido, hImprodutivo, hImpedimento,
    etapas, gargalo, pctNaJanela, dentroDaJanela, comJanela,
    equipes,
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
