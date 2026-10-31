import { SITUACAO_INFO, type Situacao } from './supabase'

/**
 * A miscelânea dos contratos como planilha (162).
 *
 * > "relatório de miscelânea, vamos deixar em relatórios também, uma
 * >  opção para relatórios de miscelâneas. Aí deve mostrar a equipe, a
 * >  WO, contrato, o que ele lançou de cada item" — Emanuel, 30/10
 *
 * Uma linha por item lançado no contrato. A coluna **Fonte** separa o que
 * o TOA mostra (lido pela varredura) do que o técnico baixou pelo
 * aplicativo — as duas não se somam nem se casam: a regra de correção do
 * lançamento ainda está em aberto (D-192), e é a diferença entre elas que
 * a conferência quer ver.
 */

/** A linha que `relatorio_miscelanea` (162) devolve. */
export interface MiscelaneaLinha {
  visita_id: string
  data_agendada: string
  cidade: string | null
  equipe: string | null
  equipe_nome: string | null
  supervisor: string | null
  tecnico: string | null
  matricula: string | null
  wo: string | null
  contrato: string | null
  atividade_toa: string | null
  grupo_servico: string | null
  situacao: string
  fonte: 'TOA' | 'TÉCNICO'
  movimento: 'INSTALADO' | 'RETIRADO'
  tecnologia: string | null
  codigo: string | null
  item: string | null
  unidade: string | null
  quantidade: number | null
  em: string | null
  por: string | null
}

const dia = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pt-BR')
const dt = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''
const qtd = (n: number | null) => (n == null ? '' : String(n).replace('.', ','))

export function linhasMiscelanea(linhas: MiscelaneaLinha[]): string[][] {
  const cab = [
    'Data', 'Cidade', 'Equipe', 'Nome da equipe', 'Supervisor',
    'Técnico', 'Matrícula', 'WO', 'Contrato', 'Tipo de atividade',
    'Grupo de serviço', 'Situação',
    'Fonte', 'Movimento', 'Tecnologia', 'Código SAP', 'Item', 'Unidade',
    'Quantidade', 'Lido/lançado em', 'Lançado por',
  ]
  return [cab, ...linhas.map(l => [
    dia(l.data_agendada), l.cidade ?? '', l.equipe ?? '', l.equipe_nome ?? '',
    l.supervisor ?? '', l.tecnico ?? '', l.matricula ?? '',
    l.wo ?? '', l.contrato ?? '', l.atividade_toa ?? '', l.grupo_servico ?? '',
    SITUACAO_INFO[l.situacao as Situacao]?.label ?? l.situacao,
    // A função devolve 'TÉCNICO'; a planilha escreve MANUAL, a mesma palavra
    // das colunas de equipamento (Emanuel, 30/10: "se for manual, vai manual").
    l.fonte === 'TOA' ? 'TOA' : 'MANUAL', l.movimento, l.tecnologia ?? '',
    // Item do TOA sem código no catálogo sai sem código, não com um
    // inventado — o nome do TOA continua em "Item".
    l.codigo ?? '', l.item ?? '', l.unidade ?? '',
    qtd(l.quantidade), dt(l.em), l.por ?? '',
  ])]
}
