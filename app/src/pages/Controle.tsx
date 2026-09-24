import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACAO_INFO } from '../lib/supabase'
import { calcular, csvPorTipo, type Visita } from '../lib/metricas'
import { Shell } from '../components/Shell'
import { ReguaDoDia, MatrizGrupos } from '../components/PainelDoDia'
import { Alerta, Vazio } from '../components/ui'
import {
  BarrasHorizontais, ColunasPorHora, Painel, TabelaSimples,
} from '../components/graficos'
import { isoLocal, equipeRotulo } from '../lib/formato'

/**
 * O Dashboard — a primeira tela do controle.
 *
 * ┌─ o que esta tela responde, em ordem ─────────────────────────────┐
 * │ 1. O que estou vendo?            → a barra de filtros            │
 * │ 2. Alguma coisa pega fogo agora? → o alerta de janela            │
 * │ 3. Quanto, e como está indo?     → a régua                       │
 * │ 4. Onde está o volume?           → a matriz grupo × situação     │
 * │ 5. Por que o dia não fechou?     → responsabilidade e motivos    │
 * │ 6. Quando e quão rápido?         → hora, etapa, equipe           │
 * │                                                                  │
 * │ A ordem é a hierarquia. Antes desta reforma a tela abria com     │
 * │ onze cartões do mesmo tamanho e repetia os mesmos sete números   │
 * │ três vezes em duas telas de rolagem — o que é o mesmo que não    │
 * │ ter hierarquia nenhuma. Ver D-126.                               │
 * └──────────────────────────────────────────────────────────────────┘
 */

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

function intervalo(p: Periodo, de: string, ate: string): [string, string] {
  const hoje = new Date()
  switch (p) {
    case 'HOJE': return [isoLocal(hoje), isoLocal(hoje)]
    case 'SETE': {
      const d = new Date(hoje); d.setDate(d.getDate() - 6)
      return [isoLocal(d), isoLocal(hoje)]
    }
    case 'MES': {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      return [isoLocal(d), isoLocal(hoje)]
    }
    case 'MES_ANTERIOR': {
      const i = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
      const f = new Date(hoje.getFullYear(), hoje.getMonth(), 0)
      return [isoLocal(i), isoLocal(f)]
    }
    default: return [de, ate]
  }
}

const ROTULO_PERIODO: Record<Periodo, string> = {
  HOJE: 'Hoje', SETE: '7 dias', MES: 'Este mês',
  MES_ANTERIOR: 'Mês anterior', PERSONALIZADO: 'Personalizado',
}

const dataBR = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('pt-BR')

const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs'

export default function Controle() {
  const [periodo, setPeriodo] = useState<Periodo>('HOJE')
  const [de, setDe] = useState(isoLocal(new Date()))
  const [ate, setAte] = useState(isoLocal(new Date()))
  const [origem, setOrigem] = useState('TODAS')
  const [equipe, setEquipe] = useState('TODAS')
  const [tipo, setTipo] = useState('TODOS')
  const [semEquipe, setSemEquipe] = useState(false)

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

  /** Código → rótulo com três dígitos e nome, como no resto do sistema.
   *  O select trazia "074" e "SEM-LOGIN" crus; em Equipes a mesma coisa
   *  se lê "074 - EQUIPE" e "Sem login definido". */
  const equipesDisp = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of linhas) {
      if (v.equipe?.codigo) m.set(v.equipe.codigo, equipeRotulo(v.equipe.codigo, v.equipe.nome))
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [linhas])

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

  /** Quantas improdutivas o gráfico de motivos deixou de fora: ele
   *  mostra os 10 maiores de propósito, e cortar sem dizer que cortou
   *  faz a lista parecer o universo. */
  const motivosSomados = m.motivos.reduce((s, x) => s + x.valor, 0)
  const motivosDeFora = m.osImprodutivas - motivosSomados

  return (
    <Shell acoes={
      atualizado && (
        <span className="hidden items-center gap-1.5 text-[11px] text-graf-500 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          atualizado {atualizado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )
    }>
      <div className="space-y-3 p-4">

        {/* ================= filtros ================= */}
        <section className="card-controle sobe p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-graf-900 p-0.5">
              {(['HOJE', 'SETE', 'MES', 'MES_ANTERIOR', 'PERSONALIZADO'] as Periodo[]).map(p => (
                <button key={p} onClick={() => setPeriodo(p)} aria-pressed={periodo === p}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    periodo === p ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                  {ROTULO_PERIODO[p]}
                </button>
              ))}
            </div>

            {periodo === 'PERSONALIZADO' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={de} onChange={e => setDe(e.target.value)}
                  aria-label="Data inicial" className={`tabular ${sel}`} />
                <span className="text-graf-500">até</span>
                <input type="date" value={ate} onChange={e => setAte(e.target.value)}
                  aria-label="Data final" className={`tabular ${sel}`} />
              </div>
            )}

            <select value={origem} onChange={e => setOrigem(e.target.value)}
              aria-label="Origem" className={sel}>
              <option value="TODAS">Todas as origens</option>
              <option value="TOA">TOA</option>
              <option value="MANUAL">Manual</option>
            </select>

            <select value={tipo} onChange={e => setTipo(e.target.value)}
              aria-label="Tipo de atividade" className={`max-w-48 ${sel}`}>
              <option value="TODOS">Todos os tipos</option>
              {tiposDisp.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <select value={equipe} onChange={e => setEquipe(e.target.value)}
              aria-label="Equipe" className={`max-w-52 ${sel}`}>
              <option value="TODAS">Todas as equipes</option>
              {equipesDisp.map(([cod, rot]) => <option key={cod} value={cod}>{rot}</option>)}
            </select>

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={semEquipe}
                onChange={e => setSemEquipe(e.target.checked)}
                className="accent-af-600" />
              Sem equipe
            </label>

            {/* A linha-resumo virou UMA frase, no fim da barra: a régua
                logo abaixo já diz quantas visitas e quantas O.S., e
                repetir número que está 40px adiante é ruído. O que
                sobra aqui é o RECORTE — a única coisa que a régua não
                consegue dizer sobre si mesma. */}
            <span className="ml-auto text-[11px] text-graf-500">
              {dtInicio === dtFim ? dataBR(dtInicio) : `${dataBR(dtInicio)} a ${dataBR(dtFim)}`}
              {temFiltro && <>
                {origem !== 'TODAS' && ` · ${origem}`}
                {tipo !== 'TODOS' && ` · ${tipo}`}
                {equipe !== 'TODAS' && ` · ${equipesDisp.find(([c]) => c === equipe)?.[1] ?? equipe}`}
                {semEquipe && ' · sem equipe'}
                <button onClick={limparFiltros}
                  className="ml-2 text-af-400 underline underline-offset-2">limpar</button>
              </>}
            </span>
          </div>
        </section>

        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* O alerta de "janela estourando" ficava aqui e SAIU a pedido
            (D-153): "não acho viável ou interessante por enquanto nesse
            cenário" — Emanuel, 23/09. Ele acendia com 60 min para o fim
            da janela, e num dia em que quase tudo tem janela 08–22 isso
            acende no fim da tarde para a operação inteira: alarme que
            toca sempre é alarme que ninguém olha. A regra e a conta
            saíram junto, para não ficar cálculo morto rodando a cada
            render. O git guarda as duas se um dia voltar. */}
        {carregando && (
          <div className="card-controle grid place-items-center gap-3 py-20">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-graf-700 border-t-af-500" />
            <p className="text-sm text-graf-400">Carregando o período…</p>
          </div>
        )}

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

        {/* Carregou, mas o filtro não deixou nada passar. É diferente de
            "não há dado no período", e a tela diz qual dos dois é. */}
        {!carregando && linhas.length > 0 && m.produtivas === 0 && (
          <div className="card-controle">
            <Vazio
              titulo="Nenhuma visita produtiva passa nos filtros"
              descricao={`${linhas.length} carregada(s) no período. ${
                m.jornada > 0 ? `${m.jornada} são apontamento de jornada, que nunca entra em produtividade.` : ''}`}
              acao={temFiltro ? (
                <button onClick={limparFiltros}
                  className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                             text-graf-300 hover:border-af-600">Limpar filtros</button>
              ) : undefined}
            />
          </div>
        )}

        {!carregando && m.produtivas > 0 && (
          <>
            {/* ===== 3. quanto, e como está indo ===== */}
            <ReguaDoDia m={m} de={dtInicio} ate={dtFim} />

            {/* ===== 4. onde está o volume ===== */}
            <MatrizGrupos linhas={linhas} de={dtInicio} ate={dtFim} onCSV={baixarCSV} />

            {/* ===== 5. por que o dia não fechou ===== */}
            <div className="sobe sobe-2 grid gap-3 xl:grid-cols-2">
              <Painel titulo="Improdutivas por responsabilidade"
                dica="De quem foi a causa — e, portanto, quem paga."
                extra={<span className="tabular text-xs text-graf-500">
                  {m.osImprodutivas} de {m.osComBaixa} O.S. com baixa
                </span>}
                tabela={<TabelaSimples colunas={['Responsável', 'Qtd']}
                  linhas={m.porResponsabilidade.map(r => [r.rotulo, r.valor])} />}
                nota={m.porResponsabilidade.length > 0 && <>
                  Cada código de baixa da CLARO foi classificado por quem deu causa.
                  Só o que está em <span className="text-af-400">vermelho</span> é
                  cobrável de nós — o resto é argumento na mesa com a operadora.
                </>}>
                {m.porResponsabilidade.length === 0 ? (
                  <p className="py-6 text-center text-sm text-graf-500">
                    Nenhuma improdutiva no período.
                  </p>
                ) : (
                  <BarrasHorizontais dados={m.porResponsabilidade}
                    parte totalRef={m.osImprodutivas} />
                )}
              </Painel>

              <Painel titulo="Motivos de improdutividade"
                dica="O código de baixa que a CLARO devolveu, do mais frequente ao menos."
                tabela={<TabelaSimples colunas={['Motivo', 'Qtd']}
                  linhas={m.motivos.map(x => [x.rotulo, x.valor])} />}
                nota={motivosDeFora > 0 &&
                  <>Os 10 maiores. Outras <strong className="tabular">{motivosDeFora}</strong>{' '}
                  O.S. improdutivas estão espalhadas em códigos de menor frequência —
                  o percentual é sobre as {m.osImprodutivas} do período, não sobre estas dez.</>}>
                <BarrasHorizontais dados={m.motivos} cor="var(--st-conflito)"
                  parte totalRef={m.osImprodutivas} rotuloLargo />
              </Painel>
            </div>

            {/* ===== 6. quando, quão rápido, e por quem ===== */}
            <div className="sobe sobe-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
              <Painel className="lg:col-span-2" titulo="Encerramentos por hora"
                dica="Em que horas o dia fecha, e como fecha."
                tabela={<TabelaSimples colunas={['Hora', 'Concluída', 'Cancelada', 'Reagendamento', 'Total']}
                  linhas={m.horas.filter(h =>
                    m.hConcluida[h] || m.hCancelada[h] || m.hReagendamento[h])
                    .map(h => [`${String(h).padStart(2, '0')}:00`,
                      m.hConcluida[h], m.hCancelada[h], m.hReagendamento[h],
                      m.hConcluida[h] + m.hCancelada[h] + m.hReagendamento[h]])} />}>
                {/* As cores são as de `SITUACAO_INFO`, não escolhidas aqui:
                    a mesma verde/vermelha/âmbar da tabela, da Rota e do
                    aplicativo. Gráfico com paleta própria obriga a ler a
                    legenda duas vezes. */}
                <ColunasPorHora horas={m.horas} series={[
                  { rotulo: 'Concluída', cor: SITUACAO_INFO.CONCLUIDA.cor,
                    valores: m.hConcluida },
                  { rotulo: 'Cancelada', cor: SITUACAO_INFO.CANCELADA.cor,
                    valores: m.hCancelada },
                  { rotulo: 'Reagendamento', cor: SITUACAO_INFO.REAGENDAMENTO.cor,
                    valores: m.hReagendamento },
                ]} />
              </Painel>

              <Painel titulo="Tempo médio por etapa"
                dica="Minutos. Só das visitas que têm as duas pontas medidas."
                tabela={<TabelaSimples colunas={['Etapa', 'Minutos']}
                  linhas={m.etapas.map(e => [e.rotulo, e.valor])} />}
                nota={<>
                  {/* ┌─ o rotulo enganava, e ele perguntou ─────────────┐
                      │ > "o atraso sobre a janela é quanto tempo médio a │
                      │ >  operação demorou a iniciar o outro contrato    │
                      │ >  após baixado? não entendi" — Emanuel, 23/09    │
                      │                                                   │
                      │ Nao e. E `inicio - janela_inicio`. E o texto      │
                      │ anterior ainda afirmava que "acima de 60 min      │
                      │ compromete o horario prometido" -- o que e FALSO  │
                      │ numa janela de 08 as 22, que tem 840 min de       │
                      │ folga e domina esta operacao. A nota passa a      │
                      │ explicar a aparente contradicao com o cartao      │
                      │ "chegou dentro da janela", em vez de criar uma.   │
                      └───────────────────────────────────────────────────┘ */}
                  <strong className="text-graf-300">Atraso sobre a janela</strong> é
                  quanto tempo <em>depois da abertura</em> do intervalo combinado o
                  técnico começou — não é o tempo entre um contrato e o seguinte.
                  Negativo significa que chegou adiantado.
                  {' '}Por isso ele convive com “chegou dentro da janela”: numa janela
                  de 08h–22h dá para começar 100 min depois da abertura e ainda estar
                  folgadamente no prazo.
                  {' '}As três barras <strong className="text-graf-300">não se somam</strong>:
                  as duas de baixo são etapas do atendimento, esta é a distância até o
                  combinado.
                </>}>
                <BarrasHorizontais dados={m.etapas} sufixo=" min" />
              </Painel>

              {/* ===== equipes: o ranking que ainda não dá para fazer ===== */}
              <Painel titulo="Concluídas por equipe"
                dica="Só as equipes identificadas entram no ranking."
                tabela={<TabelaSimples colunas={['Equipe', 'Concluídas']}
                  linhas={m.equipes.map(e => [e.rotulo, e.valor])} />}
                nota={m.concluidasSemDono > 0 && <>
                  <strong className="tabular text-amber-400">{m.concluidasSemDono}</strong>{' '}
                  concluída(s) do período estão em <strong>Sem login definido</strong> ou
                  sem equipe nenhuma — ninguém disse ainda de quem é o login do TOA.
                  Enquanto isso não for cadastrado, este ranking cobre só uma parte.{' '}
                  <Link to="/controle/equipes"
                    className="text-af-400 underline underline-offset-2">cadastrar em Equipes →</Link>
                </>}>
                {m.equipes.length === 0 ? (
                  <p className="py-6 text-center text-sm text-graf-500">
                    Nenhuma conclusão em equipe identificada no período.
                  </p>
                ) : (
                  <BarrasHorizontais dados={m.equipes} cor="var(--st-execucao)" />
                )}
              </Painel>
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
