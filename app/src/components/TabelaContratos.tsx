import type { ReactNode } from 'react'
import type { Visita } from '../lib/metricas'
import { SITUACAO_INFO } from '../lib/supabase'
import { Pill } from './ui'
import { FaixaJanela } from './telemetria'
import { dataBR, diaSemana, equipeRotulo, pts } from '../lib/formato'

/**
 * A linha de contrato — uma só, para as duas telas.
 *
 * ┌─ D-095 ─────────────────────────────────────────────────────────┐
 * │ Serviços mostrava o contrato numa tabela com faixa de situação,  │
 * │ O.S. e as duas baixas na própria linha. Equipes, ao abrir uma    │
 * │ equipe, mostrava os MESMOS contratos como cartão empilhado —     │
 * │ outra ordem de leitura, outros rótulos, a mesma informação.      │
 * │                                                                  │
 * │ Duas linguagens para o mesmo objeto obrigam quem opera a         │
 * │ reaprender a ler quando muda de tela. Agora é um componente só.  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * As colunas que dependem do contexto são opcionais: dentro de uma
 * equipe, repetir "Equipe" em toda linha é ruído, e a data é a mesma do
 * painel. O resto é idêntico — de propósito.
 */

/** O que a tabela precisa ler. Quem consulta usa este SELECT para não
 *  descobrir na tela que faltou um campo. */
export const SELECT_CONTRATO = `
  id, toa_atividade_id, wo_numero, contrato, cliente_nome,
  logradouro, complemento, bairro,
  data_agendada, janela_inicio, janela_fim, situacao, bloqueado_em, rota_fixada_em,
  origem, criado_em, inicio, fim, tempo_deslocamento, node, tec1,
  finalizado_toa, produtos_pendentes,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome, prioridade ),
  area:area_id ( codigo, apelido ),
  equipe:equipe_id ( codigo, nome, supervisor_nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula,
                                  supervisor:supervisor_id ( nome ) ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora, ponto, produto_pendente,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade ),
    baixa_afline:codigo_baixa_afline_id ( codigo, descricao, natureza, responsabilidade ),
    sub_falha:sub_falha_id ( nome, categoria ),
    baixa_em
  ),
  visita_marcador ( id, indicador_id, cumprido )
`

/** Baixa é dupla (D-042): a da operadora vem do TOA, a da AFLINE é nossa. */
export type OSDupla = Visita['ordem_servico'][number] & {
  /** O que ainda falta fazer NESTA O.S. -- o primeiro pendente do Ponto
   *  dela (D-107). Os demais ficam em `visita_produto`. */
  produto_pendente: string | null
  ponto: string | null
  baixa_afline: { codigo: number; descricao: string
                  natureza: string | null; responsabilidade: string | null } | null
  sub_falha: { nome: string; categoria: string | null } | null
  baixa_em: string | null
}

export interface Marcador { id: string; indicador_id: string; cumprido: boolean | null }

export type ContratoLinha = Omit<Visita, 'ordem_servico'> & {
  contrato: string | null
  /** Aderencia a janela (D-099). Nulo = a regra nao se aplica. */
  tec1?: 'PADRAO' | 'SEM_PADRAO' | 'EXPURGADA' | null
  /** Um por O.S.: o primeiro pendente do Ponto de cada uma (D-107).
   *  Serve para a visao compacta, onde as O.S. nao aparecem. */
  produtos_pendentes?: string[] | null
  /** O tecnico fechou a atividade no TOA.  vem preenchido mesmo
   *  em atividade so iniciada -- sem isto a tela dizia "encerrou" para
   *  quem nao encerrou (D-103). */
  finalizado_toa?: boolean
  node: string | null
  complemento: string | null
  /** Rota decidida por gente: a importação não remaneja este (066). */
  rota_fixada_em?: string | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null } | null
  /** O técnico do contrato, com o supervisor DECLARADO dele (068) — que
   *  vale mais que o nome herdado da planilha na equipe. */
  tecnico: { nome: string; matricula: string
             supervisor: { nome: string } | null } | null
  ordem_servico: OSDupla[]
  visita_marcador: Marcador[]
}

export interface PontoVisita {
  visita_id: string
  pontos_claro: number | null
  pontos_equipe: number | null
  edificacao: string
  edificacao_de: string
  achou: boolean
}

export const hora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

/**
 * QUANDO este contrato foi encerrado, e POR QUEM.
 *
 * ┌─ sao duas baixas, e elas divergem (D-042) ──────────────────────┐
 * │ > "nem sempre vai dar status pelo TOA, pode ser que ele coloque  │
 * │ >  o status manual, entao e bom termos esse horario" -- Emanuel  │
 * │                                                                  │
 * │ A coluna JANELA ja escreve "encerrou HH:MM", e aquilo e SEMPRE o │
 * │ TOA (`visita.fim`). Quando alguem baixa aqui dentro, esse        │
 * │ horario nao existe no TOA -- e a tela nao mostrava a hora de     │
 * │ jeito nenhum.                                                    │
 * │                                                                  │
 * │ A nossa tem precedencia: se alguem DESTA casa declarou, e isso   │
 * │ que vale. Sem a nossa, repete-se a do TOA "so para registro" --  │
 * │ a etiqueta ao lado e o que impede de ler uma como a outra.       │
 * │ Mesma regra que a 074 aplicou em Equipes.                        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * `finalizado_toa` e obrigatorio no ramo do TOA: `fim` vem preenchido
 * mesmo em atividade apenas INICIADA, e sem ele a tela diz que fechou
 * quem nao fechou (D-103).
 */
export function encerramento(v: ContratoLinha):
  { em: string; origem: 'AFLINE' | 'TOA' } | null {
  let af: string | null = null
  for (const o of v.ordem_servico) {
    if (!o.baixa_em) continue
    if (!af || new Date(o.baixa_em).getTime() > new Date(af).getTime()) af = o.baixa_em
  }
  if (af) return { em: af, origem: 'AFLINE' }
  if (v.finalizado_toa && v.fim) return { em: v.fim, origem: 'TOA' }
  return null
}

/**
 * Agrupa os pendentes repetidos: um contrato com 3 pontos traz
 * "NETFLIX INCLUSO" tres vezes, e 72 etiquetas iguais nao se leem.
 * Vira "NETFLIX INCLUSO x3", na ordem em que o TOA mandou.
 */
export function agrupaProdutos(lista: string[] | null | undefined) {
  if (!lista?.length) return []
  const m = new Map<string, number>()
  for (const n of lista) m.set(n, (m.get(n) ?? 0) + 1)
  return [...m.entries()].map(([nome, qtd]) => ({ nome, qtd }))
}

/** Cor da etiqueta de baixa: verde executou, vermelho improdutiva. */
export function corBaixa(natureza: string | null | undefined): string {
  if (natureza === 'SUCESSO') return 'bg-emerald-900/40 text-emerald-300'
  if (natureza === 'IMPRODUTIVA') return 'bg-af-900/40 text-af-300'
  return 'bg-graf-800 text-graf-400'
}

/**
 * A baixa da AFLINE VAZADA, a do TOA cheia (D-109).
 *
 * As duas costumam ter o mesmo código e a mesma cor -- "409 ·
 * INSTALAÇÃO EFETUADA" nas duas --, e lado a lado viravam a mesma
 * etiqueta repetida. Cor não distingue o que é igual em cor: o que
 * distingue é a FORMA. Cheia = veio do TOA, é a palavra da operadora;
 * vazada = é a nossa, digitada aqui.
 */
export function corBaixaAfline(natureza: string | null | undefined): string {
  if (natureza === 'SUCESSO') return 'text-emerald-300 ring-emerald-700/50'
  if (natureza === 'IMPRODUTIVA') return 'text-af-300 ring-af-700/50'
  return 'text-graf-400 ring-graf-600/50'
}

interface Props {
  linhas: ContratoLinha[]
  /** Detalhada traz O.S. e baixa para dentro da linha. */
  detalhada?: boolean
  pontos?: Map<string, PontoVisita>
  porIndicador?: Map<string, { nome: string }>
  /** Colunas de contexto. Dentro de uma equipe, equipe e data são ruído. */
  colunas?: { equipe?: boolean; area?: boolean; data?: boolean }
  aoAbrir?: (v: ContratoLinha) => void
  aoMenuContexto?: (v: ContratoLinha, e: React.MouseEvent) => void
  /** Última célula — cada tela tem as suas ações. */
  renderAcoes?: (v: ContratoLinha) => ReactNode
  /** Seleção em lote. Só aparece quando a tela passa os três. */
  selecionados?: Set<string>
  aoSelecionar?: (id: string, marcado: boolean) => void
  aoSelecionarTodos?: (marcado: boolean) => void
  carregando?: boolean
  vazio?: ReactNode
}

export function TabelaContratos({
  linhas, detalhada = true, pontos, porIndicador,
  colunas, aoAbrir, aoMenuContexto, renderAcoes, carregando, vazio,
  selecionados, aoSelecionar, aoSelecionarTodos,
}: Props) {
  const mostra = { equipe: true, area: true, data: true, ...(colunas ?? {}) }
  const temSelecao = !!(selecionados && aoSelecionar)
  const todosMarcados = temSelecao && linhas.length > 0
    && linhas.every(l => selecionados!.has(l.id))
  const nCols = 5 + (mostra.equipe ? 1 : 0) + (mostra.area ? 1 : 0)
                  + (mostra.data ? 1 : 0) + (renderAcoes ? 1 : 0)
                  + (temSelecao ? 1 : 0)

  return (
    <table className="w-full text-sm">
      <thead className="border-b border-graf-700 bg-graf-900 text-left
                        text-[11px] uppercase tracking-wide text-graf-400">
        {/* As divisórias são translúcidas (graf-500 com alpha), não uma
            cor fixa: a rampa inverte no tema claro e uma borda escura
            fixa viraria risco preto sobre branco (D-092). */}
        <tr className="[&>th]:border-r [&>th]:border-graf-500/20
                       [&>th:last-child]:border-r-0">
          {temSelecao && (
            // "Todos" marca o que está NA TELA, não o que existe no
            // banco: o filtro é o que a pessoa está vendo, e marcar
            // 900 linhas invisíveis seria uma armadilha.
            <th className="w-8 px-2 py-2">
              <input type="checkbox" checked={todosMarcados}
                title={todosMarcados ? 'Desmarcar os desta tela' : 'Marcar os desta tela'}
                onChange={e => aoSelecionarTodos?.(e.target.checked)}
                className="accent-af-600" />
            </th>
          )}
          {/* O contrato vem primeiro: é por ele que se procura, se fala
              ao telefone e se confere com a CLARO. */}
          <th className="px-3 py-2 font-medium">Contrato</th>
          <th className="px-3 py-2 font-medium">Janela</th>
          <th className="px-3 py-2 font-medium">Situação</th>
          <th className="px-3 py-2 font-medium">Grupo</th>
          <th className="px-3 py-2 font-medium">Endereço</th>
          {mostra.equipe && <th className="px-3 py-2 font-medium">Equipe</th>}
          {mostra.area && <th className="px-3 py-2 font-medium">Área</th>}
          <th className={`px-3 py-2 font-medium ${detalhada ? '' : 'text-center'}`}>
            {detalhada ? 'Ordens de serviço' : 'O.S.'}
          </th>
          {/* "Data e baixa": a celula tem duas coisas -- a data agendada
              e a hora em que o contrato foi encerrado, com a procedencia. */}
          {mostra.data && <th className="px-3 py-2 font-medium">Data · baixa</th>}
          {renderAcoes && <th className="px-3 py-2 font-medium"></th>}
        </tr>
      </thead>
      <tbody>
        {carregando && (
          <tr><td colSpan={nCols} className="px-3 py-10 text-center text-graf-400">
            Carregando…</td></tr>
        )}

        {!carregando && linhas.length === 0 && vazio && (
          <tr><td colSpan={nCols}>{vazio}</td></tr>
        )}

        {!carregando && linhas.map(v => {
          const improd = v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')
          const cor = SITUACAO_INFO[v.situacao]?.cor ?? '#64748b'
          // O que está acontecendo AGORA respira: o trilho e a bolinha
          // da etiqueta pulsam. Só estas duas situações — se a lista
          // inteira pulsasse, o pulso não separaria nada.
          const vivo = v.situacao === 'EM_EXECUCAO' || v.situacao === 'EM_DESLOCAMENTO'
          const marcados = (v.visita_marcador ?? [])
            .map(m => ({ m, ind: porIndicador?.get(m.indicador_id) }))
            .filter(x => x.ind)
          return (
            /* A faixa colorida à esquerda separa um contrato do outro e
               diz a situação antes de qualquer leitura. */
            <tr key={v.id}
                onClick={aoAbrir ? () => aoAbrir(v) : undefined}
                onContextMenu={aoMenuContexto ? e => {
                  e.preventDefault(); aoMenuContexto(v, e)
                } : undefined}
                style={{ ['--cor-sit' as string]: cor }}
                className={`linha-contrato ${vivo ? 'linha-viva' : ''}
                            border-b border-graf-500/25
                            [&>td]:border-r [&>td]:border-graf-500/15
                            [&>td:last-child]:border-r-0
                            ${aoAbrir ? 'cursor-pointer' : ''}`}>
              {temSelecao && (
                <td className="px-2 py-2 align-top"
                    onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selecionados!.has(v.id)}
                    onChange={e => aoSelecionar!(v.id, e.target.checked)}
                    className="accent-af-600" />
                </td>
              )}
              <td className="tabular whitespace-nowrap px-3 py-2 align-top">
                <div className="font-medium text-graf-200">{v.contrato ?? '—'}</div>
                {detalhada && v.wo_numero && (
                  <div className="text-[10px] text-graf-600">WO {v.wo_numero}</div>
                )}
                {(() => {
                  const p = pontos?.get(v.id)
                  if (!p?.achou) return null
                  return (
                    <div className="mt-1">
                      <span
                        title={`Edificação ${p.edificacao} (${p.edificacao_de.toLowerCase()})`}
                        className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-[10px]
                                   font-semibold text-emerald-300 ring-1 ring-emerald-700/40">
                        ★ {pts(p.pontos_claro)}
                      </span>
                    </div>
                  )
                })()}
              </td>

              <td className="tabular whitespace-nowrap px-3 py-2 align-top text-graf-300">
                {v.janela_inicio
                  ? <>
                      {v.janela_inicio.slice(0, 5)}
                      {v.janela_fim && (
                        <span className="text-graf-500">–{v.janela_fim.slice(0, 5)}</span>
                      )}
                    </>
                  : <span className="text-graf-600">sem janela</span>}
                {detalhada && v.fim && v.finalizado_toa && (
                  <div className="text-[10px] text-graf-500">encerrou {hora(v.fim)}</div>
                )}
                {/* A régua do dia: onde a janela cai e onde o
                    encerramento caiu dentro dela. O texto acima continua
                    sendo a medida; isto responde "sobrou ou estourou?"
                    sem conta de cabeça, contrato por contrato. */}
                {detalhada && (
                  <FaixaJanela inicio={v.janela_inicio} fim={v.janela_fim}
                    encerrou={v.finalizado_toa ? hora(v.fim) : null} tec1={v.tec1} />
                )}
              </td>

              <td className="px-3 py-2 align-top">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill situacao={v.situacao} vivo={vivo} />
                  {v.bloqueado_em && (
                    <span title="Tocada pelo campo — o TOA não sobrescreve mais"
                          className="text-[10px] text-af-400">●</span>
                  )}
                  {improd && (
                    <span title="Tem O.S. improdutiva"
                          className="text-[10px] text-amber-400">▲</span>
                  )}
                  {/* Rota fixada: a importação não remaneja este contrato.
                      Sem a marca, quem olha a lista não tem como saber por
                      que um contrato não voltou para a equipe do login. */}
                  {v.rota_fixada_em && (
                    <span title="Rota fixada — a importação do TOA não muda a equipe deste contrato"
                          className="text-[10px] text-sky-400">⚲</span>
                  )}
                </div>
                {/* TEC1: sobe junto com a baixa do TOA. Sem etiqueta = a
                    regra não se aplica àquela atividade (D-099). */}
                {v.tec1 === 'PADRAO' && (
                  <span title="Encerrou dentro da janela, ou na carência depois de executar"
                    className="mt-1 inline-block rounded bg-emerald-900/40 px-1.5 py-0.5
                               text-[9px] font-semibold uppercase tracking-wide
                               text-emerald-300">TEC1 · padrão</span>
                )}
                {v.tec1 === 'SEM_PADRAO' && (
                  <span title="Passou da janela e da carência"
                    className="mt-1 inline-block rounded bg-af-900/40 px-1.5 py-0.5
                               text-[9px] font-semibold uppercase tracking-wide
                               text-af-300">TEC1 · sem padrão</span>
                )}
                {v.tec1 === 'EXPURGADA' && (
                  <span title="Fora do cálculo: janela Imediata ou cancelamento no NETSMS"
                    className="mt-1 inline-block rounded bg-graf-800 px-1.5 py-0.5
                               text-[9px] font-semibold uppercase tracking-wide
                               text-graf-400">TEC1 · expurgada</span>
                )}
              </td>

              <td className="whitespace-nowrap px-3 py-2 align-top text-xs">
                {v.tipo_servico?.nome ?? <span className="text-graf-600">—</span>}
                <div className={`text-[10px] ${v.tipo_atividade?.natureza === 'JORNADA'
                  ? 'italic text-graf-600' : 'text-graf-500'}`}>
                  {v.tipo_atividade?.nome}
                </div>
              </td>

              <td className={`px-3 py-2 align-top ${detalhada ? 'max-w-80' : 'max-w-72 truncate'}`}
                  title={v.logradouro ?? ''}>
                <div className={detalhada ? '' : 'truncate'}>
                  {v.logradouro ?? <span className="text-graf-600">—</span>}
                  {detalhada && v.complemento && (
                    <span className="text-graf-400">, {v.complemento}</span>
                  )}
                </div>
                {v.bairro && <div className="text-xs text-graf-500">{v.bairro}</div>}
              </td>

              {mostra.equipe && (
                <td className="whitespace-nowrap px-3 py-2 align-top text-graf-300">
                  {v.equipe
                    ? equipeRotulo(v.equipe.codigo, v.equipe.nome)
                    : <span className="text-af-400/70">sem equipe</span>}
                  {v.tecnico && (
                    <span className="ml-1.5 text-xs text-graf-500">{v.tecnico.matricula}</span>
                  )}
                  {/* O supervisor mostrado é o DECLARADO do técnico deste
                      contrato. Só cai no nome da planilha quando ninguém
                      declarou — e aí sai marcado, para não passar por
                      alguém desta casa (D-135). */}
                  {detalhada && (v.tecnico?.supervisor || v.equipe?.supervisor_nome) && (
                    v.tecnico?.supervisor ? (
                      <div className="max-w-40 truncate text-[10px] text-graf-400"
                           title={`Supervisor: ${v.tecnico.supervisor.nome}`}>
                        {v.tecnico.supervisor.nome}
                      </div>
                    ) : (
                      <div className="max-w-40 truncate text-[10px] text-graf-600"
                           title={`${v.equipe!.supervisor_nome} — nome vindo da planilha de equipes; ninguém desta casa foi declarado supervisor deste técnico`}>
                        {v.equipe!.supervisor_nome} · da planilha
                      </div>
                    )
                  )}
                </td>
              )}

              {mostra.area && (
                <td className="px-3 py-2 align-top text-xs text-graf-400">
                  {v.area?.apelido ?? '—'}
                </td>
              )}

              {/* A coluna que o COP mais pediu: a O.S. e a baixa sem abrir nada */}
              <td className={`px-3 py-2 align-top ${detalhada ? 'min-w-[20rem]' : 'tabular text-center'}`}>
                {!detalhada ? (
                  v.ordem_servico.length > 0
                    ? <span className="rounded bg-graf-800 px-1.5 py-0.5 text-xs">
                        {v.ordem_servico.length}</span>
                    : <span className="text-graf-600">—</span>
                ) : v.ordem_servico.length === 0 ? (
                  <span className="text-[11px] text-graf-600">—</span>
                ) : (
                  /*
                   * Cada O.S. em DUAS LINHAS, com hierarquia (D-108):
                   *
                   *   2607386471  12 · MUDANCA DE ENDERECO      ACESSO VIRTUA
                   *   └ 409 · INSTALAÇÃO EFETUADA
                   *
                   * Linha 1 é a identidade — número, tipo e o que falta
                   * fazer, que é o que o COP procura primeiro. Linha 2 é
                   * o resultado, recuado, porque só interessa depois de
                   * saber de qual O.S. se fala. Tudo em fila única, como
                   * estava, obrigava a ler etiqueta por etiqueta para
                   * achar onde uma O.S. terminava e a outra começava.
                   */
                  <div className="space-y-1.5">
                    {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
                      <div key={o.id}
                        className="border-l-2 border-graf-700/70 pl-2 text-[11px]">
                        {/* ---- linha 1: que O.S. é, e o que falta ---- */}
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="tabular font-semibold text-graf-200">
                            {o.numero_os ?? '—'}
                          </span>
                          <span className="min-w-0 flex-1 text-graf-400">
                            {o.tipo_os ? `${o.tipo_os.codigo} · ${o.tipo_os.descricao}` : '—'}
                          </span>
                          {/* O produto pendente anda junto da O.S. — é o
                              que vai ser feito ali (D-107). */}
                          {o.produto_pendente && (
                            <span title="Produto pendente desta O.S. (pelo Ponto)"
                              className="rounded bg-amber-900/25 px-1.5 py-0.5
                                         font-medium text-amber-200 ring-1 ring-amber-700/30">
                              {o.produto_pendente}
                            </span>
                          )}
                        </div>

                        {/* ---- linha 2: o resultado ---- */}
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          {/* Baixa da OPERADORA — CHEIA. É a palavra do
                              TOA sobre o serviço. */}
                          {o.codigo_baixa ? (
                            <span title="Baixa da operadora, vinda do TOA"
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5
                                          font-medium ${corBaixa(o.codigo_baixa.natureza)}`}>
                              <span className="rounded-sm bg-black/25 px-1 text-[9px]
                                               font-bold uppercase tracking-wider opacity-90">
                                TOA
                              </span>
                              {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                            </span>
                          ) : (
                            <span className="text-graf-600">sem baixa do TOA</span>
                          )}
                          {/* Baixa da AFLINE — VAZADA. É a nossa, digitada
                              aqui, e costuma repetir o código do TOA
                              (D-109). */}
                          {o.baixa_afline && (
                            <span title="Baixa da AFLINE — lançada no nosso sistema"
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5
                                          font-medium ring-1
                                          ${corBaixaAfline(o.baixa_afline.natureza)}`}>
                              <span className="rounded-sm px-1 text-[9px] font-bold uppercase
                                               tracking-wider ring-1 ring-inherit opacity-90">
                                AFLINE
                              </span>
                              {o.baixa_afline.codigo} · {o.baixa_afline.descricao}
                              {o.sub_falha && (
                                <span className="ml-1 font-normal opacity-80">
                                  › {o.sub_falha.nome}
                                </span>
                              )}
                            </span>
                          )}
                          {o.status_operadora === 'NAO_EXECUTADA' && (
                            <span title="O TOA marcou esta O.S. como não executada"
                              className="text-[10px] uppercase tracking-wide text-graf-500">
                              não executada
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Marcadores — os indicadores de qualidade apontados. */}
                {detalhada && marcados.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {marcados.map(({ m, ind }) => (
                      <span key={m.id}
                        className="rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px]
                                   font-medium uppercase tracking-wide text-sky-300
                                   ring-1 ring-sky-700/40">
                        {ind!.nome}
                      </span>
                    ))}
                  </div>
                )}
              </td>

              {/* A data mora onde o contrato morava. Sem ela a busca por
                  contrato — que traz várias datas — viraria uma pilha de
                  linhas indistinguíveis. */}
              {mostra.data && (
                <td className="tabular whitespace-nowrap px-3 py-2 align-top text-xs text-graf-400">
                  {dataBR(v.data_agendada)}
                  <div className="text-[10px] text-graf-600">{diaSemana(v.data_agendada)}</div>
                  {(() => {
                    const e = encerramento(v)
                    if (!e) return null
                    const nossa = e.origem === 'AFLINE'
                    return (
                      <div className="mt-1 flex items-center gap-1"
                        title={nossa
                          ? 'Baixado AQUI, no Gestor AF -- este horario nao existe no TOA'
                          : 'Encerrado no TOA. Ninguem baixou aqui dentro; repetido so para registro'}>
                        <span className={`tabular text-[11px] font-semibold ${
                          nossa ? 'text-emerald-400' : 'text-graf-300'}`}>
                          {hora(e.em)}
                        </span>
                        <span className={`rounded px-1 py-px text-[9px] font-bold tracking-wide ${
                          nossa ? 'bg-emerald-900/40 text-emerald-300'
                                : 'bg-graf-800 text-graf-400'}`}>
                          {nossa ? 'AQUI' : 'TOA'}
                        </span>
                      </div>
                    )
                  })()}
                </td>
              )}

              {renderAcoes && (
                <td className="relative px-3 py-2 text-right align-top">
                  {renderAcoes(v)}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
