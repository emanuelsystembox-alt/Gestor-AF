import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACAO_INFO } from '../lib/supabase'
import { calcular, csvPorTipo, type Visita } from '../lib/metricas'
import { Shell } from '../components/Shell'
import { BotaoAtualizar } from '../components/BotaoAtualizar'
import { ReguaDoDia, MatrizGrupos } from '../components/PainelDoDia'
import { Alerta, Vazio } from '../components/ui'
import {
  BarrasHorizontais, ColunasPorHora, Painel, TabelaSimples,
} from '../components/graficos'
import { isoLocal, equipeRotulo } from '../lib/formato'
import { SeletorBuckets, opcoesDeBucket } from '../components/SeletorBuckets'
import { SEM_BUCKET } from '../lib/filtroContratos'
import { QuebraPorAgrupamento, tabelaQuebra } from '../components/QuebraPorAgrupamento'
import { LinkContrato } from '../components/LinkContrato'

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
  id, toa_atividade_id, wo_numero, contrato, cliente_nome, logradouro, bairro,
  data_agendada, janela_inicio, janela_fim, situacao, bloqueado_em,
  origem, criado_em, inicio, fim, tempo_deslocamento, toa_bucket,
  status_toa:dados_origem->>"Status da Atividade",
  contador_log:dados_origem->>"Contador de log",
  tipo_atividade:tipo_atividade_id ( nome, natureza ),
  tipo_servico:tipo_servico_id ( nome, prioridade ),
  area:area_id ( codigo ),
  equipe:equipe_id ( codigo, nome, supervisor_nome ),
  tecnico:tecnico_responsavel_id ( nome, matricula, supervisor:supervisor_id ( nome ) ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora, tec1_ao_vivo,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( codigo, descricao, natureza, responsabilidade,
                                   responsavel_quebra, agrupamento_quebra, quebra_pct,
                                   situacao_destino ),
    baixa_afline:codigo_baixa_afline_id ( codigo, descricao )
  ),
  evidencia ( count )
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
  /** 141: o motivo aberto no detalhe (contrato, serviço, técnico). */
  const [motivoAberto, setMotivoAberto] = useState<string | null>(null)
  /** A meta da Primeira WO é cadastro (140), não constante: a tela lê. */
  const [textoMeta, setTextoMeta] = useState('08:20')
  useEffect(() => {
    supabase.rpc('ler_parametro', { p_chave: 'primeira_wo_meta' })
      .then(({ data }) => { if (typeof data === 'string') setTextoMeta(data.slice(0, 5)) })
  }, [])
  const metaPrimeiraWo = useMemo(() => {
    const [h, mm] = textoMeta.split(':')
    return Number(h) * 60 + Number(mm || 0)
  }, [textoMeta])
  const [de, setDe] = useState(isoLocal(new Date()))
  const [ate, setAte] = useState(isoLocal(new Date()))
  const [origem, setOrigem] = useState('TODAS')
  const [equipe, setEquipe] = useState('TODAS')
  const [tipo, setTipo] = useState('TODOS')
  const [semEquipe, setSemEquipe] = useState(false)
  // 119 (D-195): mais de um bucket marcado; vazio = todos.
  const [buckets, setBuckets] = useState<string[]>([])

  const [linhas, setLinhas] = useState<Visita[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizado, setAtualizado] = useState<Date | null>(null)
  // 31/10: o Dashboard não tinha Atualizar (Emanuel). Recarrega pelo botão
  // ou pelo relógio que a pessoa ligar nele -- nunca por evento do banco.
  const [versao, setVersao] = useState(0)

  const [dtInicio, dtFim] = useMemo(
    () => intervalo(periodo, de, ate), [periodo, de, ate])

  /*
   * ┌─ o painel estava lendo MIL linhas e chamando de período ─────────┐
   * │ O PostgREST devolve no máximo 1.000 linhas por consulta. Sem     │
   * │ paginar, "7 dias" carregava 1.000 de 2.283 visitas — e TODOS os  │
   * │ números (conclusão, improdutivas, TEC1, tempos, primeira WO)     │
   * │ saíam sobre esse pedaço, sem nada na tela dizendo que faltava.   │
   * │ Achado em 25/10 comparando a tela com o banco: 742 contratos na  │
   * │ régua contra 2.283 no SQL do mesmo intervalo.                    │
   * │                                                                   │
   * │ Agora pagina até acabar. A página é de 1.000 porque é o teto do  │
   * │ servidor; `linhas.length < PAGINA` é o fim — pedir mais uma vez  │
   * │ para confirmar custaria uma viagem a cada carregamento.          │
   * └───────────────────────────────────────────────────────────────────┘
   */
  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    ;(async () => {
      const PAGINA = 1000
      const tudo: Visita[] = []
      for (let p = 0; ; p++) {
        const { data, error } = await supabase.from('visita').select(SELECT)
          .gte('data_agendada', dtInicio)
          .lte('data_agendada', dtFim)
          .order('data_agendada', { ascending: false })
          .order('id')
          .range(p * PAGINA, (p + 1) * PAGINA - 1)
        if (!vivo) return
        if (error) { setErro(error.message); setCarregando(false); return }
        const lote = (data ?? []) as unknown as Visita[]
        tudo.push(...lote)
        if (lote.length < PAGINA) break
        // Trava de segurança: 20 páginas são 20 mil visitas, muito acima
        // de qualquer mês real. Laço infinito aqui travaria a tela.
        if (p >= 19) break
      }
      if (!vivo) return
      setLinhas(tudo); setAtualizado(new Date()); setCarregando(false)
    })()
    return () => { vivo = false }
  }, [dtInicio, dtFim, versao])

  const filtradas = useMemo(() => linhas.filter(v => {
    if (origem !== 'TODAS' && v.origem !== origem) return false
    if (equipe !== 'TODAS' && v.equipe?.codigo !== equipe) return false
    if (tipo !== 'TODOS' && v.tipo_atividade?.nome !== tipo) return false
    if (semEquipe && v.equipe) return false
    if (buckets.length && !buckets.includes(v.toa_bucket ?? SEM_BUCKET)) return false
    return true
  }), [linhas, origem, equipe, tipo, semEquipe, buckets])

  // Contadas sobre as PRODUTIVAS, o mesmo universo do número grande.
  const opBuckets = useMemo(() => opcoesDeBucket(
    linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')), [linhas])

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
    || buckets.length > 0
  function limparFiltros() {
    setOrigem('TODAS'); setEquipe('TODAS'); setTipo('TODOS'); setSemEquipe(false); setBuckets([])
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
  // 155: as duas pontas no mesmo grão (contrato). Com O.S. no numerador
  // e contrato no denominador a nota dizia "outras 281" onde não havia
  // nenhuma de fora.
  const motivosDeFora = Math.max(0, m.contratosQuebrados - motivosSomados)
  /** Quanto as barras de agrupamento somam: passa do total quando um
   *  contrato quebrou por mais de um agrupamento (4 em 409, medido). */
  const somaBarras = m.porAgrupamento.reduce((s, x) => s + x.valor, 0)

  return (
    <Shell acoes={
      <BotaoAtualizar aoAtualizar={() => setVersao(v => v + 1)} carregando={carregando}
        atualizadoEm={atualizado} />
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

            <SeletorBuckets opcoes={opBuckets.buckets} semBucket={opBuckets.semBucket}
              valor={buckets} onChange={setBuckets} className={sel} />

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
                {buckets.length > 0 && ` · ${buckets.map(b => b === SEM_BUCKET ? 'sem bucket' : b).join(', ')}`}
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
            <ReguaDoDia m={m} de={dtInicio} ate={dtFim} linhas={filtradas} />

            {/* ===== 4. onde está o volume ===== */}
            {/* As FILTRADAS, como a régua e os gráficos. Recebia `linhas` (o
                período inteiro) e ignorava bucket, origem, tipo e equipe —
                volume e pontos não mudavam com o filtro (Emanuel, 20/10). */}
            <MatrizGrupos linhas={filtradas} de={dtInicio} ate={dtFim} onCSV={baixarCSV} />

            {/* ===== 5. por que o dia não fechou ===== */}
            {/* 155: o cabeçalho conta CONTRATO, não O.S. — a contagem antiga
                dizia 690 onde há 409 (medido em 14 dias). A de O.S. fica ao
                lado, menor: número que encolhe calado parece defeito. */}
            <div className="sobe sobe-2 grid gap-3 xl:grid-cols-2">
              <Painel titulo="Responsável pela quebra"
                dica="Em que parte do processo o serviço caiu — e quanto isso pesa no total."
                extra={<span className="tabular text-xs text-graf-500">
                  {m.contratosQuebrados} de {m.contratosComBaixa} contratos com baixa
                  <span className="ml-1.5 text-graf-600">({m.osImprodutivas} O.S.)</span>
                </span>}
                tabela={<TabelaSimples
                  colunas={['Agrupamento', 'Quebras', 'Impacto no UN', '% das quebras']}
                  linhas={tabelaQuebra(m.porAgrupamento)} />}
                nota={m.porAgrupamento.length > 0 && <>
                  O <strong className="text-graf-300">agrupamento de quebra</strong> é a
                  classificação da própria CLARO (coluna AH da <em>Quebra Qualificada</em>):
                  cada código de baixa cai no lugar do processo em que o serviço quebrou.
                  {' '}<strong className="text-graf-300">Impacto no UN</strong> é sobre os{' '}
                  <span className="tabular">{m.contratosComBaixa}</span> contratos com baixa
                  do período — o mesmo denominador do cabeçalho.
                  {' '}Passe o mouse na barra para o resumo com os motivos.
                  {somaBarras > m.contratosQuebrados && <>
                    {' '}As barras somam <span className="tabular">{somaBarras}</span> porque{' '}
                    <span className="tabular">{somaBarras - m.contratosQuebrados}</span> contrato(s)
                    quebraram por mais de um agrupamento e aparecem em cada um deles.
                  </>}
                </>}>
                <QuebraPorAgrupamento grupos={m.porAgrupamento} totalUn={m.contratosComBaixa}
                  totalQuebras={m.contratosQuebrados} de={dtInicio} ate={dtFim}
                  temFiltro={temFiltro} />
              </Painel>

              <Painel titulo="Motivos de improdutividade"
                dica="O código de baixa que a CLARO devolveu, do mais frequente ao menos."
                tabela={<TabelaSimples colunas={['Motivo', 'Qtd']}
                  linhas={m.motivos.map(x => [x.rotulo, x.valor])} />}
                nota={motivosDeFora > 0 &&
                  <>Os 10 maiores, em <strong>contratos</strong>. Outros{' '}
                  <strong className="tabular">{motivosDeFora}</strong>{' '}
                  estão espalhados em códigos de menor frequência —
                  o percentual é sobre os {m.contratosQuebrados} do período, não sobre estes dez.</>}>
                <BarrasHorizontais dados={m.motivos} cor="var(--st-conflito)"
                  parte totalRef={m.contratosQuebrados} rotuloLargo
                  aoClicar={r => setMotivoAberto(a => a === r ? null : r)}
                  selecionado={motivoAberto} />
                {/* 141: clicar no motivo abre QUEM deu a quebra — contrato,
                    serviço e técnico. "Caso o coordenador queira detalhar
                    melhor" (Emanuel, 25/10). */}
                {motivoAberto && (() => {
                  const mot = m.motivos.find(x => x.rotulo === motivoAberto)
                  if (!mot) return null
                  return (
                    <div className="mt-3 overflow-hidden rounded-lg border border-graf-800">
                      <p className="flex items-center gap-2 border-b border-graf-800 bg-graf-900
                                    px-3 py-1.5 text-[11px] text-graf-300">
                        <strong>{mot.rotulo}</strong>
                        <span className="tabular text-graf-500">{mot.valor} contrato(s)</span>
                        <button onClick={() => setMotivoAberto(null)}
                          className="ml-auto text-graf-400 hover:text-graf-100">fechar ✕</button>
                      </p>
                      <div className="max-h-64 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-graf-900 text-left text-[10px]
                                            uppercase tracking-wide text-graf-500">
                            <tr>
                              <th className="px-3 py-1.5 font-medium">Contrato</th>
                              <th className="px-3 py-1.5 font-medium">Serviço</th>
                              <th className="px-3 py-1.5 font-medium">Técnico</th>
                              <th className="px-3 py-1.5 font-medium">Responsável</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mot.itens.map((it, i) => (
                              <tr key={`${it.visita_id}-${i}`} className="border-t border-graf-800/60">
                                <td className="px-3 py-1.5">
                                  <LinkContrato to={`/controle/visita/${it.visita_id}`}
                                    className="tabular text-af-400 underline underline-offset-2">
                                    {it.contrato ?? '—'}
                                  </LinkContrato>
                                  {it.os && (
                                    <span className="tabular ml-1.5 text-graf-600"
                                      title={it.oss > 1
                                        ? `${it.oss} O.S. deste contrato caíram neste mesmo motivo`
                                        : undefined}>
                                      O.S. {it.os}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-graf-300">{it.servico ?? '—'}</td>
                                <td className="px-3 py-1.5 text-graf-300">
                                  {it.tecnico ?? <span className="text-graf-600">sem técnico</span>}
                                  {it.equipe && <span className="ml-1.5 text-graf-600">{it.equipe}</span>}
                                </td>
                                <td className="px-3 py-1.5">
                                  {it.responsavel
                                    ? <span className={it.responsavel === 'SERVICOS DE CAMPO'
                                        ? 'text-af-300' : 'text-graf-400'}>{it.responsavel.toLowerCase()}</span>
                                    : <span className="text-graf-600">caso a caso</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })()}
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
                dica="Atraso em horas; as etapas em minutos. Só das visitas que têm as duas pontas medidas."
                tabela={<TabelaSimples colunas={['Etapa', 'Tempo', 'Minutos']}
                  linhas={m.etapas.map(e => [e.rotulo, e.texto, e.valor])} />}
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
                  de 08h–22h dá para começar 1h40 depois da abertura e ainda estar
                  folgadamente no prazo.
                  {' '}As três barras <strong className="text-graf-300">não se somam</strong>:
                  as duas de baixo são etapas do atendimento, esta é a distância até o
                  combinado.
                </>}>
                <BarrasHorizontais dados={m.etapas} />
                {/* 141: "era bom saber quanto o time inteiro se atrasou para
                    chegar na primeira WO" (Emanuel, 25/10). A mesma regra do
                    indicador Primeira WO, no filtro que está na tela. */}
                <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1
                                border-t border-graf-800 pt-3">
                  <span className="text-[10px] uppercase tracking-wide text-graf-500">
                    Primeira WO do time
                  </span>
                  {m.primeiraWo.texto == null ? (
                    <span className="text-sm text-graf-400">sem início medido no período</span>
                  ) : (() => {
                    const atraso = m.primeiraWo.minutos! - metaPrimeiraWo
                    return (<>
                      <span className={`tabular text-xl font-semibold ${
                        atraso <= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {m.primeiraWo.texto}
                      </span>
                      <span className="text-xs text-graf-400">
                        meta <span className="tabular">{textoMeta}</span> ·{' '}
                        {atraso <= 0
                          ? <span className="text-emerald-300">{-atraso} min adiantado</span>
                          : <span className="text-amber-300">{atraso} min depois</span>}
                        {' '}· <span className="tabular">{m.primeiraWo.dias}</span> dias-técnico
                      </span>
                      <Link to="/controle/indicadores"
                        className="ml-auto text-[11px] text-af-400 underline underline-offset-2">
                        ver por técnico
                      </Link>
                    </>)
                  })()}
                </div>
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
