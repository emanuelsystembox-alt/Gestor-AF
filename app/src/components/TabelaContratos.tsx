import type { ReactNode } from 'react'
import type { Visita } from '../lib/metricas'
import { SITUACAO_INFO } from '../lib/supabase'
import { Pill } from './ui'
import { dataBR, diaSemana, pts } from '../lib/formato'

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
  data_agendada, janela_inicio, janela_fim, situacao, bloqueado_em,
  origem, criado_em, inicio, fim, tempo_deslocamento, node,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome, prioridade ),
  area:area_id ( codigo, apelido ),
  equipe:equipe_id ( codigo, nome, supervisor_nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora,
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
  baixa_afline: { codigo: number; descricao: string
                  natureza: string | null; responsabilidade: string | null } | null
  sub_falha: { nome: string; categoria: string | null } | null
  baixa_em: string | null
}

export interface Marcador { id: string; indicador_id: string; cumprido: boolean | null }

export type ContratoLinha = Omit<Visita, 'ordem_servico'> & {
  contrato: string | null
  node: string | null
  complemento: string | null
  area: { codigo: string; apelido: string | null } | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null } | null
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

/** Cor da etiqueta de baixa: verde executou, vermelho improdutiva. */
export function corBaixa(natureza: string | null | undefined): string {
  if (natureza === 'SUCESSO') return 'bg-emerald-900/40 text-emerald-300'
  if (natureza === 'IMPRODUTIVA') return 'bg-af-900/40 text-af-300'
  return 'bg-graf-800 text-graf-400'
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
  carregando?: boolean
  vazio?: ReactNode
}

export function TabelaContratos({
  linhas, detalhada = true, pontos, porIndicador,
  colunas, aoAbrir, aoMenuContexto, renderAcoes, carregando, vazio,
}: Props) {
  const mostra = { equipe: true, area: true, data: true, ...(colunas ?? {}) }
  const nCols = 5 + (mostra.equipe ? 1 : 0) + (mostra.area ? 1 : 0)
                  + (mostra.data ? 1 : 0) + (renderAcoes ? 1 : 0)

  return (
    <table className="w-full text-sm">
      <thead className="border-b border-graf-700 bg-graf-900 text-left
                        text-[11px] uppercase tracking-wide text-graf-400">
        {/* As divisórias são translúcidas (graf-500 com alpha), não uma
            cor fixa: a rampa inverte no tema claro e uma borda escura
            fixa viraria risco preto sobre branco (D-092). */}
        <tr className="[&>th]:border-r [&>th]:border-graf-500/20
                       [&>th:last-child]:border-r-0">
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
          {mostra.data && <th className="px-3 py-2 font-medium">Data</th>}
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
                style={{
                  borderLeft: `3px solid ${cor}`,
                  background: `color-mix(in srgb, ${cor} 8%, transparent)`,
                }}
                className={`border-b border-graf-500/25
                            [&>td]:border-r [&>td]:border-graf-500/15
                            [&>td:last-child]:border-r-0 hover:bg-graf-850
                            ${aoAbrir ? 'cursor-pointer' : ''}`}>
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
                {v.janela_inicio?.slice(0, 5) ?? '—'}
                {v.janela_fim && <span className="text-graf-500">–{v.janela_fim.slice(0, 5)}</span>}
                {detalhada && v.fim && (
                  <div className="text-[10px] text-graf-500">encerrou {hora(v.fim)}</div>
                )}
              </td>

              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Pill situacao={v.situacao} />
                  {v.bloqueado_em && (
                    <span title="Tocada pelo campo — o TOA não sobrescreve mais"
                          className="text-[10px] text-af-400">●</span>
                  )}
                  {improd && (
                    <span title="Tem O.S. improdutiva"
                          className="text-[10px] text-amber-400">▲</span>
                  )}
                </div>
              </td>

              <td className="whitespace-nowrap px-3 py-2 text-xs">
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
                  {v.equipe?.codigo ?? <span className="text-af-400/70">sem equipe</span>}
                  {v.tecnico && (
                    <span className="ml-1.5 text-xs text-graf-500">{v.tecnico.matricula}</span>
                  )}
                  {detalhada && v.equipe?.supervisor_nome && (
                    <div className="max-w-40 truncate text-[10px] text-graf-500"
                         title={v.equipe.supervisor_nome}>
                      {v.equipe.supervisor_nome}
                    </div>
                  )}
                </td>
              )}

              {mostra.area && (
                <td className="px-3 py-2 align-top text-xs text-graf-400">
                  {v.area?.apelido ?? '—'}
                </td>
              )}

              {/* A coluna que o COP mais pediu: a O.S. e a baixa sem abrir nada */}
              <td className={`px-3 py-2 align-top ${detalhada ? '' : 'tabular text-center'}`}>
                {!detalhada ? (
                  v.ordem_servico.length > 0
                    ? <span className="rounded bg-graf-800 px-1.5 py-0.5 text-xs">
                        {v.ordem_servico.length}</span>
                    : <span className="text-graf-600">—</span>
                ) : v.ordem_servico.length === 0 ? (
                  <span className="text-[11px] text-graf-600">—</span>
                ) : (
                  <div className="space-y-0.5">
                    {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(o => (
                      <div key={o.id} className="flex flex-wrap items-center gap-x-2 text-[11px]">
                        <span className="tabular font-medium text-graf-200">
                          {o.numero_os ?? '—'}
                        </span>
                        <span className="text-graf-400">
                          {o.tipo_os ? `${o.tipo_os.codigo} · ${o.tipo_os.descricao}` : '—'}
                        </span>
                        {/* Baixa da OPERADORA — vem do TOA */}
                        {o.codigo_baixa ? (
                          <span title="Baixa da operadora (TOA)"
                            className={`rounded px-1.5 py-0.5 font-medium
                                        ${corBaixa(o.codigo_baixa.natureza)}`}>
                            <span className="mr-1 opacity-70">Baixa TOA</span>
                            {o.codigo_baixa.codigo} · {o.codigo_baixa.descricao}
                          </span>
                        ) : (
                          <span className="text-graf-600">sem baixa do TOA</span>
                        )}
                        {/* Baixa da AFLINE — a nossa, com sub-falha */}
                        {o.baixa_afline && (
                          <span title="Baixa da AFLINE"
                            className={`rounded px-1.5 py-0.5 font-medium ring-1
                                        ring-sky-700/40 ${corBaixa(o.baixa_afline.natureza)}`}>
                            <span className="mr-1 opacity-70">Baixa ngestor</span>
                            {o.baixa_afline.codigo} · {o.baixa_afline.descricao}
                            {o.sub_falha && (
                              <span className="ml-1 font-normal opacity-80">
                                › {o.sub_falha.nome}
                              </span>
                            )}
                          </span>
                        )}
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
