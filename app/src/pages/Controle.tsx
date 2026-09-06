import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcular, csvPorTipo, type Visita } from '../lib/metricas'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import {
  BarraEmpilhada, BarrasHorizontais, ColunasPorHora,
  Indicador, Painel, TabelaSimples,
} from '../components/graficos'

const SELECT = `
  id, toa_atividade_id, wo_numero, cliente_nome, logradouro, bairro,
  data_agendada, janela_inicio, janela_fim, situacao, bloqueado_em,
  origem, criado_em, inicio, fim, tempo_deslocamento,
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome, prioridade ),
  area:area_id ( codigo ),
  equipe:equipe_id ( codigo, nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade )
  )
`

type Periodo = 'HOJE' | 'SETE' | 'MES' | 'MES_ANTERIOR' | 'PERSONALIZADO'

const iso = (d: Date) => d.toISOString().slice(0, 10)

function intervalo(p: Periodo, de: string, ate: string): [string, string] {
  const hoje = new Date()
  switch (p) {
    case 'HOJE': return [iso(hoje), iso(hoje)]
    case 'SETE': {
      const d = new Date(hoje); d.setDate(d.getDate() - 6)
      return [iso(d), iso(hoje)]
    }
    case 'MES': {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      return [iso(d), iso(hoje)]
    }
    case 'MES_ANTERIOR': {
      const i = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
      const f = new Date(hoje.getFullYear(), hoje.getMonth(), 0)
      return [iso(i), iso(f)]
    }
    default: return [de, ate]
  }
}

const ROTULO_PERIODO: Record<Periodo, string> = {
  HOJE: 'Hoje', SETE: '7 dias', MES: 'Este mês',
  MES_ANTERIOR: 'Mês anterior', PERSONALIZADO: 'Personalizado',
}

export default function Controle() {
  const [periodo, setPeriodo] = useState<Periodo>('HOJE')
  const [de, setDe] = useState(iso(new Date()))
  const [ate, setAte] = useState(iso(new Date()))
  const [origem, setOrigem] = useState('TODAS')
  const [equipe, setEquipe] = useState('TODAS')
  const [tipo, setTipo] = useState('TODOS')
  const [semEquipe, setSemEquipe] = useState(false)
  const [porGrupo, setPorGrupo] = useState(true)

  const [linhas, setLinhas] = useState<Visita[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizado, setAtualizado] = useState<Date | null>(null)

  const [dtInicio, dtFim] = useMemo(
    () => intervalo(periodo, de, ate), [periodo, de, ate])

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.from('visita').select(SELECT)
      .gte('data_agendada', dtInicio)
      .lte('data_agendada', dtFim)
      .order('data_agendada', { ascending: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else { setLinhas((data ?? []) as unknown as Visita[]); setAtualizado(new Date()) }
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [dtInicio, dtFim])

  const filtradas = useMemo(() => linhas.filter(v => {
    if (origem !== 'TODAS' && v.origem !== origem) return false
    if (equipe !== 'TODAS' && v.equipe?.codigo !== equipe) return false
    if (tipo !== 'TODOS' && v.tipo_atividade?.nome !== tipo) return false
    if (semEquipe && v.equipe) return false
    return true
  }), [linhas, origem, equipe, tipo, semEquipe])

  const m = useMemo(() => calcular(filtradas), [filtradas])

  const equipesDisp = useMemo(() => [...new Set(
    linhas.map(v => v.equipe?.codigo).filter(Boolean) as string[])].sort(), [linhas])
  const tiposDisp = useMemo(() => [...new Set(
    linhas.map(v => v.tipo_atividade?.nome).filter(Boolean) as string[])].sort(), [linhas])

  const temFiltro = origem !== 'TODAS' || equipe !== 'TODAS' || tipo !== 'TODOS' || semEquipe
  function limparFiltros() {
    setOrigem('TODAS'); setEquipe('TODAS'); setTipo('TODOS'); setSemEquipe(false)
  }

  function baixarCSV() {
    const blob = new Blob(['﻿' + csvPorTipo(m, `${dtInicio} a ${dtFim}`)],
      { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `afline-tipos-${dtInicio}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Shell acoes={
      atualizado && (
        <span className="hidden items-center gap-1.5 text-[11px] text-graf-500 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          atualizado {atualizado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )
    }>
      <div className="space-y-4 p-4">

        {/* ================= filtros ================= */}
        <section className="card-controle p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-graf-900 p-0.5">
              {(['HOJE', 'SETE', 'MES', 'MES_ANTERIOR', 'PERSONALIZADO'] as Periodo[]).map(p => (
                <button key={p} onClick={() => setPeriodo(p)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    periodo === p ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                  {ROTULO_PERIODO[p]}
                </button>
              ))}
            </div>

            {periodo === 'PERSONALIZADO' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={de} onChange={e => setDe(e.target.value)}
                  className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs" />
                <span className="text-graf-500">até</span>
                <input type="date" value={ate} onChange={e => setAte(e.target.value)}
                  className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs" />
              </div>
            )}

            <select value={origem} onChange={e => setOrigem(e.target.value)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs">
              <option value="TODAS">Todas as origens</option>
              <option value="TOA">TOA</option>
              <option value="MANUAL">Manual</option>
            </select>

            <select value={tipo} onChange={e => setTipo(e.target.value)}
              className="max-w-48 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs">
              <option value="TODOS">Todos os tipos</option>
              {tiposDisp.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <select value={equipe} onChange={e => setEquipe(e.target.value)}
              className="rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs">
              <option value="TODAS">Todas as equipes</option>
              {equipesDisp.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={semEquipe}
                onChange={e => setSemEquipe(e.target.checked)}
                className="accent-af-600" />
              Sem equipe
            </label>
          </div>

          {/* linha-resumo: o controlador sempre sabe o que está vendo */}
          <p className="mt-2.5 border-t border-graf-800 pt-2.5 text-xs text-graf-400">
            Exibindo <strong className="text-graf-200">{m.produtivas} visitas produtivas</strong>
            {' '}e <strong className="text-graf-200">{m.os} O.S.</strong>
            {m.jornada > 0 && <> · {m.jornada} apontamentos de jornada fora da conta</>}
            {' · '}{origem === 'TODAS' ? 'todas as origens' : origem}
            {' · '}{tipo === 'TODOS' ? 'todos os tipos' : tipo}
            {' · '}{equipe === 'TODAS' ? 'todas as equipes' : `equipe ${equipe}`}
            {' · '}{dtInicio === dtFim
              ? new Date(dtInicio + 'T12:00').toLocaleDateString('pt-BR')
              : `${new Date(dtInicio + 'T12:00').toLocaleDateString('pt-BR')} a ${new Date(dtFim + 'T12:00').toLocaleDateString('pt-BR')}`}
            {temFiltro && (
              <button onClick={limparFiltros}
                className="ml-2 text-af-400 underline underline-offset-2">limpar filtros</button>
            )}
          </p>
        </section>

        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* ================= alerta de janela ================= */}
        {m.emRisco > 0 && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-700/60
                          bg-amber-900/20 px-3.5 py-2.5 text-sm text-amber-200">
            <span aria-hidden className="mt-0.5">⚠</span>
            <p>
              <strong>{m.emRisco} visita(s) com a janela estourando</strong> — menos de 60 min
              para o fim do intervalo combinado com o cliente
              {m.vencidas > 0 && <>, e <strong>{m.vencidas} já passou do horário</strong></>}.
              {' '}
              <Link to="/controle/servicos?filtro=abertas"
                    className="underline underline-offset-2">ver quais</Link>
            </p>
          </div>
        )}

        {carregando && <p className="py-16 text-center text-graf-400">Carregando…</p>}

        {!carregando && linhas.length === 0 && (
          <div className="card-controle">
            <Vazio
              titulo="Nenhuma visita neste período"
              descricao="Importe a planilha de atividades do TOA para começar."
              acao={<Link to="/controle/importar"
                className="rounded-lg bg-af-600 px-4 py-2 text-sm font-medium text-white hover:bg-af-500">
                Importar planilha</Link>}
            />
          </div>
        )}

        {!carregando && linhas.length > 0 && (
          <>
            {/* ================= indicadores ================= */}
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador rotulo="Visitas produtivas" valor={m.produtivas}
                detalhe={`${m.os} O.S. dentro delas`} />
              <Indicador rotulo="Taxa de conclusão"
                valor={m.taxaConclusao.toFixed(1).replace('.', ',')} sufixo="%"
                meta="85%" cor={m.taxaConclusao >= 85 ? 'var(--st-concluida)' : undefined}
                detalhe={`${m.concluidas} de ${m.produtivas}`} />
              <Indicador rotulo="Chegou dentro da janela"
                valor={m.pctNaJanela.toFixed(1).replace('.', ',')} sufixo="%"
                cor={m.pctNaJanela >= 90 ? 'var(--st-concluida)'
                     : m.pctNaJanela >= 75 ? undefined : 'var(--st-reagendamento)'}
                detalhe={`${m.dentroDaJanela} de ${m.comJanela} atendimentos`} />
              <Indicador rotulo="Improdutivas por nossa conta"
                valor={m.nossas}
                cor={m.nossas > 0 ? 'var(--st-conflito)' : 'var(--st-concluida)'}
                alerta={m.nossas > 0}
                detalhe={m.osImprodutivas
                  ? `${((m.nossas / m.osImprodutivas) * 100).toFixed(0)}% do total`
                  : 'nenhuma'} />
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              {/* ================= distribuição ================= */}
              <Painel titulo="Distribuição por situação"
                tabela={<TabelaSimples colunas={['Situação', 'Qtd']}
                  linhas={m.porSituacao.map(s => [s.rotulo, s.valor])} />}>
                <BarraEmpilhada fatias={m.porSituacao} />
              </Painel>

              {/* ========== improdutivas por responsabilidade ==========
                  A pergunta que o sistema atual não responde. */}
              <Painel titulo="Improdutivas por responsabilidade"
                extra={<span className="text-xs text-graf-500">
                  {m.osImprodutivas} de {m.osComBaixa} O.S.
                </span>}
                tabela={<TabelaSimples colunas={['Responsável', 'Qtd']}
                  linhas={m.porResponsabilidade.map(r => [r.rotulo, r.valor])} />}>
                {m.porResponsabilidade.length === 0 ? (
                  <p className="py-6 text-center text-sm text-graf-500">
                    Nenhuma improdutiva no período.
                  </p>
                ) : (
                  <>
                    <BarrasHorizontais dados={m.porResponsabilidade} />
                    <p className="mt-3 border-t border-graf-800 pt-2.5 text-xs text-graf-500">
                      Cada código de baixa da CLARO foi classificado por quem deu causa.
                      Só o que está em <span className="text-af-400">vermelho</span> é
                      cobrável de nós — o resto é argumento na mesa com a operadora.
                    </p>
                  </>
                )}
              </Painel>
            </div>

            {/* ================= encerramentos por hora ================= */}
            <Painel titulo="Encerramentos por hora"
              tabela={<TabelaSimples colunas={['Hora', 'Concluído', 'Improdutivo', 'Impedimento']}
                linhas={m.horas.filter(h =>
                  m.hConcluido[h] || m.hImprodutivo[h] || m.hImpedimento[h])
                  .map(h => [`${String(h).padStart(2, '0')}:00`,
                    m.hConcluido[h], m.hImprodutivo[h], m.hImpedimento[h]])} />}>
              <ColunasPorHora horas={m.horas} series={[
                { rotulo: 'Concluído', cor: 'var(--st-concluida)', valores: m.hConcluido },
                { rotulo: 'Com improdutiva', cor: 'var(--st-reagendamento)', valores: m.hImprodutivo },
                { rotulo: 'Com impedimento', cor: 'var(--st-impedimento)', valores: m.hImpedimento },
              ]} />
            </Painel>

            <div className="grid gap-4 xl:grid-cols-2">
              {/* ================= motivos ================= */}
              <Painel titulo="Motivos de improdutividade"
                tabela={<TabelaSimples colunas={['Motivo', 'Qtd']}
                  linhas={m.motivos.map(x => [x.rotulo, x.valor])} />}>
                <BarrasHorizontais dados={m.motivos} cor="var(--st-conflito)" />
              </Painel>

              {/* ================= tempo por etapa ================= */}
              <Painel titulo="Tempo médio por etapa"
                extra={<span className="text-xs text-graf-500">minutos</span>}
                tabela={<TabelaSimples colunas={['Etapa', 'Minutos']}
                  linhas={m.etapas.map(e => [e.rotulo, e.valor])} />}>
                <BarrasHorizontais dados={m.etapas} sufixo=" min" />
                <p className="mt-3 border-t border-graf-800 pt-2.5 text-xs text-graf-400">
                  <strong className="text-graf-200">Atraso sobre a janela</strong> é quanto
                  tempo depois da abertura do intervalo combinado o técnico começou.
                  Número negativo significa que chegou adiantado.
                  {m.etapas[0].valor > 60 && (
                    <> Acima de 60 min já compromete o horário prometido ao cliente.</>
                  )}
                </p>
              </Painel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {/* ================= equipes ================= */}
              <Painel titulo="Equipes por volume concluído"
                tabela={<TabelaSimples colunas={['Equipe', 'Concluídas']}
                  linhas={m.equipes.map(e => [e.rotulo, e.valor])} />}>
                <BarrasHorizontais dados={m.equipes} cor="var(--st-execucao)" />
              </Painel>

              {/* ================= por tipo ================= */}
              <Painel titulo={porGrupo ? 'Visitas por grupo de serviço' : 'Visitas por tipo de atividade (TOA)'}
                extra={<>
                  <button onClick={() => setPorGrupo(g => !g)}
                    className="text-xs text-graf-400 underline-offset-2 hover:text-af-400 hover:underline">
                    {porGrupo ? 'ver tipo do TOA' : 'ver grupo de serviço'}
                  </button>
                  {
                  <button onClick={baixarCSV}
                    className="text-xs text-graf-400 underline-offset-2 hover:text-af-400 hover:underline">
                    Exportar CSV
                  </button>}
                </>}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-graf-700 text-left text-[11px]
                                     uppercase tracking-wide text-graf-400">
                        <th className="px-2 py-1.5 font-medium">Tipo</th>
                        <th className="px-2 py-1.5 text-right font-medium">Total</th>
                        <th className="px-2 py-1.5 text-right font-medium">Andam.</th>
                        <th className="px-2 py-1.5 text-right font-medium">Concl.</th>
                        <th className="px-2 py-1.5 text-right font-medium">Improd.</th>
                        <th className="px-2 py-1.5 text-right font-medium">% concl.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(porGrupo ? m.porGrupo : m.porTipo).map(t => (
                        <tr key={t.tipo} className="border-b border-graf-800/60">
                          <td className="px-2 py-1.5 text-graf-200">{t.tipo}</td>
                          <td className="tabular px-2 py-1.5 text-right">{t.total}</td>
                          <td className="tabular px-2 py-1.5 text-right text-graf-400">{t.andamento}</td>
                          <td className="tabular px-2 py-1.5 text-right text-emerald-400">{t.concluido}</td>
                          <td className="tabular px-2 py-1.5 text-right text-af-400">{t.improd}</td>
                          <td className="tabular px-2 py-1.5 text-right font-medium">
                            {t.pct.toFixed(1).replace('.', ',')}%
                          </td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="px-2 py-2">Total</td>
                        <td className="tabular px-2 py-2 text-right">{m.produtivas}</td>
                        <td className="tabular px-2 py-2 text-right">{m.emAberto}</td>
                        <td className="tabular px-2 py-2 text-right text-emerald-400">{m.concluidas}</td>
                        <td className="tabular px-2 py-2 text-right text-af-400">{m.osImprodutivas}</td>
                        <td className="tabular px-2 py-2 text-right">
                          {m.taxaConclusao.toFixed(1).replace('.', ',')}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Painel>
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
