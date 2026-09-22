import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase, SITUACOES, EM_ABERTO, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { useMudancasAoVivo } from '../lib/tempoReal'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { ContratoModal } from '../components/ContratoModal'
import { dataBR, equipeRotulo, isoLocal, pts } from '../lib/formato'
import { useUltimoDiaComVisita } from '../lib/dia'
import { NovoContratoModal } from '../components/NovoContratoModal'
import { BarraComposicao } from '../components/telemetria'
// A linha do contrato e o SELECT que a alimenta moram no componente —
// Serviços e Equipes mostram o mesmo objeto do mesmo jeito (D-095).
import {
  TabelaContratos, SELECT_CONTRATO,
  type ContratoLinha, type PontoVisita,
} from '../components/TabelaContratos'

const SELECT = SELECT_CONTRATO

/**
 * Quantos contratos por página.
 *
 * > "vamos deixar essa página dos contratos paginada, ex: 1/30 […] de 50
 * >  em 50, quando a operação tiver acima de 50 contratos" — Emanuel
 *
 * ┌─ por que a página é do LADO DE CÁ ───────────────────────────────┐
 * │ Paginar no banco (`range()`) traria 50 linhas e quebraria tudo o  │
 * │ que esta tela faz em cima do conjunto: os nove filtros, a soma de │
 * │ pontos "no filtro", o exportar e o marcar em lote passariam a ver │
 * │ só o pedaço carregado — e continuariam dizendo o total inteiro.   │
 * │ Mentira silenciosa, que é a pior.                                 │
 * │                                                                   │
 * │ Então a consulta continua trazendo o período inteiro e a página é │
 * │ só o RECORTE DA TELA. O custo disso é a consulta: um período      │
 * │ longo carrega muita linha de uma vez. Está medido? Não. Fica      │
 * │ escrito como o próximo lugar a olhar se a tela pesar.             │
 * └───────────────────────────────────────────────────────────────────┘
 */
const POR_PAGINA = 50

/**
 * Quem responde por este contrato.
 *
 * O DECLARADO do técnico primeiro (068); só cai no nome que veio da
 * planilha de equipes quando ninguém declarou. Sem isto, o filtro
 * "Todo supervisor" listava `SUPERVISOR - RAPHAEL FELIPE` para
 * contratos cuja linha já mostrava "Supervisor X" — dois nomes para o
 * mesmo contrato, na mesma tela (D-135).
 */
function supervisorDo(v: V): string | null {
  return v.tecnico?.supervisor?.nome ?? v.equipe?.supervisor_nome ?? null
}

interface Indicador { id: string; nome: string; meta: number; peso: number; ordem: number }
type V = ContratoLinha

export default function Servicos() {
  const [params] = useSearchParams()
  // ┌─ o Dashboard entra aqui pela URL ────────────────────────────────┐
  // │ Clicar em "Cancelada 41" no painel tem de cair nas 41 canceladas │
  // │ DAQUELE período. Sem `de`/`ate` a lista abria em hoje e mostrava │
  // │ outro número — o drill-down mentia sobre o que tinha sido        │
  // │ clicado. Os parâmetros são validados: data fora do formato ou    │
  // │ situação que não existe voltam ao padrão em vez de filtrar por   │
  // │ lixo e devolver tela vazia sem explicação.                      │
  // └──────────────────────────────────────────────────────────────────┘
  const paramData = (chave: string) => {
    const v = params.get(chave)
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  }
  // HOJE, sempre. Abria no último dia COM visita, e isso fazia a tela
  // mostrar o movimento de ontem sob a data de hoje (ver lib/dia.ts).
  // Dia sem importação aparece VAZIO, que é a informação certa.
  const [de, setDe] = useState(paramData('de') ?? isoLocal())
  const [ate, setAte] = useState(paramData('ate') ?? isoLocal())
  const [linhas, setLinhas] = useState<V[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  // O contrato abre em JANELA, nao em linha expandida (D-056).
  const [modal, setModal] = useState<string | null>(null)
  // Cadastro manual: o serviço que não veio do TOA precisa entrar
  // mesmo assim, senão não é despachado nem cobrado.
  const [novo, setNovo] = useState(false)
  // Sobe de 1 quando o modal muda algo; os carregamentos ouvem.
  const [versao, setVersao] = useState(0)
  /** Mudanças que chegaram ao vivo enquanto o controlador estava com
   *  contratos marcados. Ver o bloco de tempo real mais abaixo. */
  const [mudancasEmEspera, setMudancasEmEspera] = useState(0)

  // filtros
  const [situacao, setSituacao] = useState<Situacao | 'TODAS' | 'ABERTAS'>(() => {
    if (params.get('filtro') === 'abertas') return 'ABERTAS'
    const s = params.get('situacao')
    return s && (SITUACOES as readonly string[]).includes(s) ? s as Situacao : 'TODAS'
  })
  const [busca, setBusca] = useState('')
  const [area, setArea] = useState('TODAS')
  const [supervisor, setSupervisor] = useState('TODOS')
  const [equipe, setEquipe] = useState('TODAS')
  const [grupo, setGrupo] = useState(params.get('grupo') ?? 'TODOS')
  const [origem, setOrigem] = useState('TODAS')
  const [resultado, setResultado] = useState<'TODOS' | 'SUCESSO' | 'IMPRODUTIVA' | 'SEM_BAIXA'>('TODOS')
  const [culpa, setCulpa] = useState('TODAS')
  const [soProdutivas, setSoProdutivas] = useState(true)
  // Quanto a linha mostra. "Detalhada" traz a O.S. e o código de baixa
  // para a própria linha — sem isso o COP precisava abrir uma por uma
  // só para saber por que a visita não fechou.
  const [densidade, setDensidade] = useState<'detalhada' | 'compacta'>('detalhada')
  const detalhada = densidade === 'detalhada'

  // Marcadores (indicadores de qualidade) — o analista aponta no contrato
  // qual foi cumprido. Catálogo vem de `indicador_qualidade` (025).
  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  const [menu, setMenu] = useState<string | null>(null)
  // Onde desenhar o menu: o sistema atual abre onde o mouse esta, nao
  // encostado na borda direita da tabela.
  const [menuXY, setMenuXY] = useState<{ x: number; y: number } | null>(null)

  // Selecao em lote. Guarda IDs, nao objetos: a lista e recarregada e
  // objeto novo com conteudo igual nao e o mesmo objeto (D-085).
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [excluindo, setExcluindo] = useState(false)

  useEffect(() => {
    supabase.from('indicador_qualidade')
      .select('id, nome, meta, peso, ordem').eq('ativo', true).order('ordem')
      .then(({ data }) => setIndicadores((data ?? []) as Indicador[]))
  }, [])

  function alternarSelecao(id: string, marcado: boolean) {
    setSelecionados(s => {
      const n = new Set(s)
      if (marcado) n.add(id); else n.delete(id)
      return n
    })
  }

  /**
   * Exclusao em lote — DELETE de verdade (D-101).
   *
   * Duas confirmacoes, porque nao se desfaz: o motivo (que o banco
   * exige) e a palavra APAGAR digitada. Clicar duas vezes em "ok" e
   * facil de fazer sem ler; digitar, nao.
   */
  async function excluirSelecionados() {
    const ids = [...selecionados]
    if (!ids.length) return

    const motivo = prompt(
      `APAGAR ${ids.length} contrato(s) do banco.\n\n`
      + 'Isto NÃO se desfaz: some o contrato, as O.S., o histórico e as fotos.\n'
      + 'Fica registrado quem apagou, quando e por quê.\n\n'
      + 'Informe o motivo:')
    if (!motivo || !motivo.trim()) return

    const confirma = prompt(
      `Última confirmação.\n\n`
      + `${ids.length} contrato(s) serão apagados e não voltam.\n`
      + 'Digite APAGAR para continuar:')
    if ((confirma ?? '').trim().toUpperCase() !== 'APAGAR') return

    setExcluindo(true)
    const { data, error } = await supabase.rpc('excluir_visitas_definitivo',
      { p_visitas: ids, p_motivo: motivo.trim() })
    if (error) {
      setErro(error.message)
    } else {
      const r = data as { apagados: number }
      setErro(null)
      setSelecionados(new Set())
      setVersao(v => v + 1)
      alert(`${r.apagados} contrato(s) apagado(s) do banco.`)
    }
    setExcluindo(false)
  }

  const porIndicador = useMemo(
    () => new Map(indicadores.map(i => [i.id, i])), [indicadores])

  /** O último dia que tem contrato. NÃO é para onde a tela abre — é o
   *  atalho que a tela oferece quando o dia escolhido está vazio. Quem
   *  decide mudar de dia é quem está olhando (ver lib/dia.ts). */
  const ultimoDia = useUltimoDiaComVisita()


  // ---- pontuação do contrato (D-045) ----
  // Uma chamada por período, não uma por linha: `pontos_por_periodo`
  // resolve as ~90 visitas do dia de uma vez.
  const [pontos, setPontos] = useState<Map<string, PontoVisita>>(new Map())

  useEffect(() => {
    if (!de || !ate) return
    supabase.rpc('pontos_por_periodo', { p_de: de, p_ate: ate }).then(({ data }) => {
      const m = new Map<string, PontoVisita>()
      for (const p of (data ?? []) as PontoVisita[]) m.set(p.visita_id, p)
      setPontos(m)
    })
  }, [de, ate, versao])


  // ---- transferência rápida, sem sair da lista ----
  const [equipes, setEquipes] = useState<{ id: string; codigo: string; nome: string }[]>([])

  useEffect(() => {
    supabase.from('equipe').select('id, codigo, nome').eq('ativo', true).order('codigo')
      .then(({ data }) => setEquipes((data ?? []) as { id: string; codigo: string; nome: string }[]))
  }, [])


  // ---- baixa da AFLINE, com sub-falha do código escolhido ----
  const [codigos, setCodigos] = useState<{ codigo: number; descricao: string }[]>([])

  // Os dois conjuntos de sub-falha convivem no banco; só um vale. Sem
  // filtrar pelo vigente, a lista vem em dobro (CASO 1 + NÍVEL HARD).
  const [conjunto, setConjunto] = useState<string | null>(null)

  // ---- histórico do contrato (D-069) e busca em GRUPO (D-105) ----
  // Um número de contrato inteiro deixa de ser filtro do período e vira
  // a pergunta "o que já aconteceu neste contrato" — o período
  // esconderia justamente as outras visitas.
  //
  // Vários números, separados por espaço, vírgula ou linha, são um
  // GRUPO: o COP cola a lista que recebeu e vê os contratos dela. Aí o
  // período volta a valer por padrão, porque quem cola 40 contratos
  // quase sempre quer o dia (ou o mês) que está na tela — e pode
  // desligar isso num clique.
  const [contratosBuscados, setContratosBuscados] = useState<string[]>([])
  /** Na busca por contrato, respeitar o período escolhido em cima. */
  const [contratoNoPeriodo, setContratoNoPeriodo] = useState(false)

  useEffect(() => {
    const achados = (busca.match(/\d{6,}/g) ?? [])
    const t = busca.trim()
    // Só vale como lista de contrato se a busca for SÓ números e
    // separadores — senão "R JOAO 123456" viraria busca de contrato.
    const soNumeros = t.length > 0 && /^[\d\s,;\n\r.-]+$/.test(t)
    const alvo = soNumeros ? [...new Set(achados)] : []
    // Espera o usuário parar de digitar: sem isto, "226803663" dispara
    // nove consultas.
    const id = setTimeout(() => {
      setContratosBuscados(alvo)
      // Um contrato só: histórico completo, como sempre foi.
      // Vários: o padrão é o período da tela.
      if (alvo.length <= 1) setContratoNoPeriodo(false)
      else setContratoNoPeriodo(true)
    }, 350)
    return () => clearTimeout(id)
  }, [busca])

  useEffect(() => {
    supabase.from('codigo_baixa').select('codigo, descricao').order('codigo')
      .then(({ data }) => setCodigos((data ?? []) as { codigo: number; descricao: string }[]))
    supabase.from('empresa').select('conjunto_sub_falha').maybeSingle()
      .then(({ data }) =>
        setConjunto((data as { conjunto_sub_falha: string | null } | null)?.conjunto_sub_falha ?? null))
  }, [])




  useEffect(() => {
    if (!contratosBuscados.length && (!de || !ate)) return
    let vivo = true
    setCarregando(true); setErro(null)

    // Contrato excluido some da lista, mas continua no banco (D-043).
    let q = supabase.from('visita').select(SELECT).is('excluido_em', null)
    if (contratosBuscados.length) {
      q = contratosBuscados.length === 1
        ? q.eq('contrato', contratosBuscados[0])
        : q.in('contrato', contratosBuscados)
      // O grupo pode ser lido dentro do período ou dia a dia, como o
      // histórico de um contrato só.
      if (contratoNoPeriodo && de && ate) {
        q = q.gte('data_agendada', de).lte('data_agendada', ate)
      }
    } else {
      q = q.gte('data_agendada', de).lte('data_agendada', ate)
    }

    q.order('data_agendada', { ascending: false })
      .order('janela_inicio', { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setLinhas((data ?? []) as unknown as V[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [de, ate, versao, contratosBuscados, contratoNoPeriodo])

  /**
   * ┌─ O CONTROLE DEIXA DE CLICAR EM ATUALIZAR ─────────────────────┐
   * │ O técnico sai, chega e baixa; a lista aqui reflete na hora.    │
   * │                                                                 │
   * │ Mas recarregar por baixo de quem está trabalhando é pior que    │
   * │ o botão: se o controlador tem contratos MARCADOS, ele está a    │
   * │ um clique de transferir ou apagar em lote — trocar as linhas    │
   * │ nesse instante é como puxar o papel da mesa.                    │
   * │                                                                 │
   * │ Então: lista livre recarrega sozinha; lista com seleção guarda  │
   * │ o aviso e deixa ele decidir quando.                             │
   * └─────────────────────────────────────────────────────────────────┘
   */
  const temSelecao = useRef(false)
  temSelecao.current = selecionados.size > 0

  const aoVivo = useMudancasAoVivo(quantas => {
    if (temSelecao.current) setMudancasEmEspera(n => n + quantas)
    else setVersao(v => v + 1)
  })

  function aplicarMudancas() {
    setMudancasEmEspera(0)
    setVersao(v => v + 1)
  }

  const base = useMemo(() => soProdutivas
    ? linhas.filter(v => v.tipo_atividade?.natureza !== 'JORNADA')
    : linhas, [linhas, soProdutivas])

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return base.filter(v => {
      if (situacao === 'ABERTAS' && !EM_ABERTO.includes(v.situacao)) return false
      if (situacao !== 'TODAS' && situacao !== 'ABERTAS' && v.situacao !== situacao) return false
      if (area !== 'TODAS' && v.area?.apelido !== area && v.area?.codigo !== area) return false
      if (supervisor !== 'TODOS' && supervisorDo(v) !== supervisor) return false
      if (equipe !== 'TODAS' && v.equipe?.codigo !== equipe) return false
      if (grupo !== 'TODOS' && v.tipo_servico?.nome !== grupo) return false
      if (origem !== 'TODAS' && v.origem !== origem) return false

      if (resultado !== 'TODOS') {
        const comBaixa = v.ordem_servico.filter(o => o.codigo_baixa)
        if (resultado === 'SEM_BAIXA' && comBaixa.length > 0) return false
        if (resultado === 'SUCESSO'
          && !v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'SUCESSO')) return false
        if (resultado === 'IMPRODUTIVA'
          && !v.ordem_servico.some(o => o.codigo_baixa?.natureza === 'IMPRODUTIVA')) return false
      }
      if (culpa !== 'TODAS'
        && !v.ordem_servico.some(o => o.codigo_baixa?.responsabilidade === culpa)) return false

      if (!t) return true
      return [
        v.cliente_nome, v.logradouro, v.bairro, v.wo_numero, v.contrato,
        v.toa_atividade_id, v.node, v.equipe?.codigo, v.tecnico?.nome, v.tecnico?.matricula,
        ...v.ordem_servico.map(o => o.numero_os),
        ...v.ordem_servico.map(o => o.codigo_baixa
          ? `${o.codigo_baixa.codigo} ${o.codigo_baixa.descricao}` : ''),
      ].some(x => x?.toLowerCase().includes(t))
    })
  }, [base, situacao, busca, area, supervisor, equipe, grupo, origem, resultado, culpa])

  // ---- paginação ----
  const [pagina, setPagina] = useState(1)
  const paginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA))
  // Filtro que muda joga de volta para a primeira: continuar na página 7
  // de um filtro que agora tem 2 páginas é cair num vazio sem explicação.
  useEffect(() => { setPagina(1) },
    [situacao, busca, area, supervisor, equipe, grupo, origem, resultado,
     culpa, soProdutivas, de, ate])
  // A lista pode encolher por baixo (chegou baixa ao vivo, filtro do
  // Realtime): a página nunca passa do fim.
  const paginaAtual = Math.min(pagina, paginas)
  const inicio = (paginaAtual - 1) * POR_PAGINA
  const naPagina = useMemo(
    () => (visiveis.length > POR_PAGINA
      ? visiveis.slice(inicio, inicio + POR_PAGINA)
      : visiveis),
    [visiveis, inicio])

  const totalPontos = useMemo(
    () => visiveis.reduce((soma, v) => soma + Number(pontos.get(v.id)?.pontos_claro ?? 0), 0),
    [visiveis, pontos])

  // opções derivadas do que está carregado
  const op = useMemo(() => ({
    areas: [...new Set(base.map(v => v.area?.apelido).filter(Boolean) as string[])].sort(),
    supers: [...new Set(base.map(supervisorDo).filter(Boolean) as string[])].sort(),
    equipes: [...new Set(base.map(v => v.equipe?.codigo).filter(Boolean) as string[])].sort(),
    grupos: [...new Set(base.map(v => v.tipo_servico?.nome).filter(Boolean) as string[])].sort(),
  }), [base])

  const contagem = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {}
    for (const v of base) c[v.situacao] = (c[v.situacao] ?? 0) + 1
    return c
  }, [base])

  /** As fatias da barra de composicao, na ordem do dominio -- da
   *  entrada ao impedimento. Situacao sem nenhuma linha nao vira fatia
   *  de largura zero: ela simplesmente nao esta no dia. */
  const fatias = useMemo(() => SITUACOES.map(s => ({
    chave: s as string,
    rotulo: SITUACAO_INFO[s]?.label ?? s,
    cor: SITUACAO_INFO[s]?.cor ?? '#64748b',
    qtd: contagem[s] ?? 0,
  })), [contagem])

  const abertas = base.filter(v => EM_ABERTO.includes(v.situacao)).length
  const filtrando = [situacao !== 'TODAS', area !== 'TODAS', supervisor !== 'TODOS',
    equipe !== 'TODAS', grupo !== 'TODOS', origem !== 'TODAS', resultado !== 'TODOS',
    culpa !== 'TODAS', busca.trim() !== ''].filter(Boolean).length

  function limpar() {
    setSituacao('TODAS'); setArea('TODAS'); setSupervisor('TODOS'); setEquipe('TODAS')
    setGrupo('TODOS'); setOrigem('TODAS'); setResultado('TODOS'); setCulpa('TODAS'); setBusca('')
  }

  function exportar() {
    const cab = ['Data', 'Janela', 'Situação', 'Grupo', 'Tipo atividade', 'Equipe',
      'Supervisor', 'Área', 'Contrato', 'Endereço', 'Bairro', 'O.S.', 'Baixas']
    const linhasCsv = visiveis.map(v => [
      new Date(v.data_agendada + 'T12:00').toLocaleDateString('pt-BR'),
      `${v.janela_inicio?.slice(0, 5) ?? ''}${v.janela_fim ? '-' + v.janela_fim.slice(0, 5) : ''}`,
      SITUACAO_INFO[v.situacao]?.label ?? v.situacao,
      v.tipo_servico?.nome ?? '', v.tipo_atividade?.nome ?? '',
      v.equipe?.codigo ?? '', supervisorDo(v) ?? '', v.area?.apelido ?? '',
      v.contrato ?? '', v.logradouro ?? '', v.bairro ?? '',
      v.ordem_servico.map(o => o.numero_os).join(' '),
      v.ordem_servico.map(o => o.codigo_baixa
        ? `${o.codigo_baixa.codigo}-${o.codigo_baixa.descricao}` : '').filter(Boolean).join(' | '),
    ])
    const csv = [cab, ...linhasCsv]
      .map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `afline-servicos-${de}${de !== ate ? '-a-' + ate : ''}.csv`
    a.click(); URL.revokeObjectURL(a.href)
  }

  /**
   * `/` foca a busca, `Esc` limpa e sai.
   *
   * O controlador trabalha muito mais rapido no teclado que no mouse --
   * o proprio design system diz isso na regra de foco visivel. Levar a
   * mao ao mouse para clicar num campo de busca que ja esta na tela e o
   * tipo de atrito que custa segundos, 200 vezes por turno.
   */
  const buscaRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null
      const digitando = !!alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)
      if (e.key === '/' && !digitando) {
        e.preventDefault()
        buscaRef.current?.focus()
        buscaRef.current?.select()
      }
      if (e.key === 'Escape' && alvo === buscaRef.current) {
        setBusca('')
        buscaRef.current?.blur()
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs outline-none focus:border-af-500'

  return (
    <Shell acoes={
      <div className="flex items-center gap-1.5">
        <input type="date" value={de} onChange={e => setDe(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        <span className="text-xs text-graf-500">a</span>
        <input type="date" value={ate} onChange={e => setAte(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        <button onClick={() => setNovo(true)}
          className="ml-1 rounded-md bg-af-600 px-3 py-1 text-xs font-semibold text-white
                     hover:bg-af-500">
          + Nova O.S.
        </button>
      </div>
    }>
      <div className="space-y-3 p-4">
        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {/* ====== filtros ====== */}
        <section className="card-controle sobe space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-72 flex-1">
              <input ref={buscaRef} value={busca} onChange={e => setBusca(e.target.value)}
                aria-label="Buscar contrato, cliente, endereço, WO, O.S., node ou matrícula"
                placeholder="Cliente, endereço, WO, contrato (ou vários, colados), O.S., node, matrícula…"
                className="w-full rounded-md border border-graf-700 bg-graf-900 py-1.5 pl-3 pr-16
                           text-sm outline-none placeholder-graf-500 focus:border-af-500" />
              {/* A tecla fica escrita: atalho que ninguem descobre nao
                  existe. Some quando o campo esta em uso. */}
              {!busca && (
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2
                                rounded border border-graf-700 bg-graf-800 px-1.5 py-0.5
                                text-[10px] font-medium text-graf-500">
                  / buscar
                </kbd>
              )}
            </div>
            <button onClick={exportar} disabled={visiveis.length === 0}
              className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              Exportar {visiveis.length} linhas
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select value={grupo} onChange={e => setGrupo(e.target.value)} className={sel}>
              <option value="TODOS">Todo grupo de serviço</option>
              {op.grupos.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={area} onChange={e => setArea(e.target.value)} className={sel}>
              <option value="TODAS">Toda área</option>
              {op.areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={supervisor} onChange={e => setSupervisor(e.target.value)}
              className={`${sel} max-w-52`}>
              <option value="TODOS">Todo supervisor</option>
              {op.supers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={equipe} onChange={e => setEquipe(e.target.value)} className={sel}>
              <option value="TODAS">Toda equipe</option>
              {op.equipes.map(e => (
                <option key={e} value={e}>{equipeRotulo(e)}</option>))}
            </select>
            <select value={resultado} onChange={e => setResultado(e.target.value as typeof resultado)}
              className={sel}>
              <option value="TODOS">Qualquer resultado</option>
              <option value="SUCESSO">Com O.S. executada</option>
              <option value="IMPRODUTIVA">Com improdutiva</option>
              <option value="SEM_BAIXA">Sem baixa ainda</option>
            </select>
            <select value={culpa} onChange={e => setCulpa(e.target.value)} className={sel}>
              <option value="TODAS">Qualquer responsável</option>
              <option value="TECNICO">Improdutiva nossa</option>
              <option value="CLIENTE">Improdutiva do cliente</option>
              <option value="REDE">Improdutiva de rede</option>
              <option value="OPERADORA">Improdutiva da operadora</option>
              <option value="TERCEIRO">Improdutiva de terceiro</option>
            </select>
            <select value={origem} onChange={e => setOrigem(e.target.value)} className={sel}>
              <option value="TODAS">Toda origem</option>
              <option value="TOA">TOA</option>
              <option value="MANUAL">Manual</option>
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={soProdutivas}
                onChange={e => setSoProdutivas(e.target.checked)} className="accent-af-600" />
              Ocultar jornada
            </label>
            <div className="flex rounded-md bg-graf-900 p-0.5">
              {(['detalhada', 'compacta'] as const).map(d => (
                <button key={d} onClick={() => setDensidade(d)}
                  title={d === 'detalhada'
                    ? 'Mostra O.S. e código de baixa na própria linha'
                    : 'Uma linha por visita, só o essencial'}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    densidade === d ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                  {d === 'detalhada' ? 'Detalhada' : 'Compacta'}
                </button>
              ))}
            </div>
            {filtrando > 0 && (
              <button onClick={limpar}
                className="text-xs text-af-400 underline underline-offset-2">
                limpar {filtrando} filtro(s)
              </button>
            )}
          </div>

          {/* ====== a composicao do dia ======
              A barra e a proporcao; os botoes sao o comando. 165
              concluidas e 13 canceladas escritas em etiquetas do mesmo
              tamanho parecem numeros vizinhos -- na barra, uma fatia e
              treze vezes a outra, e isso se ve antes de ler.

              A barra e decorativa de proposito (aria-hidden): filtrar
              e trabalho dos botoes abaixo, que tem nome, contagem e
              `aria-pressed`. Fatia de 5% e alvo de clique ruim para
              qualquer pessoa. */}
          <div className="space-y-2 border-t border-graf-800 pt-2.5">
            <BarraComposicao fatias={fatias}
              ativa={situacao !== 'TODAS' && situacao !== 'ABERTAS' ? situacao : null} />

            <div className="flex flex-wrap gap-1.5">
              {(['TODAS', 'ABERTAS', ...SITUACOES] as const).map(s => {
                const n = s === 'TODAS' ? base.length
                  : s === 'ABERTAS' ? abertas : contagem[s as Situacao] ?? 0
                if (n === 0 && s !== 'TODAS' && s !== 'ABERTAS') return null
                const ativo = situacao === s
                // A cor do botao e a cor da SITUACAO, nao a da marca:
                // "Concluida" ligada nao pode acender em vermelho.
                const cor = s === 'TODAS' ? 'var(--color-graf-400)'
                  : s === 'ABERTAS' ? 'var(--st-execucao)'
                  : SITUACAO_INFO[s as Situacao]?.cor ?? '#64748b'
                return (
                  <button key={s} onClick={() => setSituacao(s)} aria-pressed={ativo}
                    style={{ ['--pill-cor' as string]: cor }}
                    className={`pill pill-filtro ${ativo ? 'pill-ativo' : 'pill-apagada'}`}>
                    {s === 'TODAS' ? 'Todas' : s === 'ABERTAS' ? 'Em aberto'
                      : SITUACAO_INFO[s as Situacao]?.label ?? s}
                    <span className="tabular font-bold opacity-70">{n}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* Quando a busca vira histórico de contrato, a tela precisa
            dizer isso — senão o usuário acha que o filtro de data quebrou. */}
        {contratosBuscados.length > 0 && (
          <Alerta tipo="info">
            {contratosBuscados.length === 1 ? (
              <>Contrato <strong className="tabular">{contratosBuscados[0]}</strong></>
            ) : (
              <><strong className="tabular">{contratosBuscados.length}</strong> contratos
                na busca</>
            )}
            {contratoNoPeriodo
              ? <> — mostrando só o que está <strong>no período</strong> escolhido.</>
              : <> — mostrando <strong>todas</strong> as visitas, dia a dia,
                  fora do período.</>}
            {' '}
            <button onClick={() => setContratoNoPeriodo(p => !p)}
              className="underline underline-offset-2 hover:text-af-400">
              {contratoNoPeriodo ? 'ver todas as datas' : 'limitar ao período'}
            </button>
            {' · '}
            <button onClick={() => setBusca('')}
              className="underline underline-offset-2 hover:text-af-400">
              limpar
            </button>
          </Alerta>
        )}

        {/* ====== o pulso do tempo real ====== */}
        {/* A bolinha existe para o controlador saber em que mundo ele
            está: verde, a tela se atualiza sozinha; apagada, ele voltou
            a depender do F5 e precisa saber disso. Silêncio de rede é
            indistinguível de silêncio de operação. */}
        <div className="flex flex-wrap items-center gap-3 px-0.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-graf-500">
            <span className={`h-1.5 w-1.5 rounded-full ${
              aoVivo ? 'ponto-vivo bg-emerald-500' : 'bg-graf-600'}`} />
            {aoVivo ? 'ao vivo' : 'sem conexão ao vivo — recarregue a página'}
          </span>

          {mudancasEmEspera > 0 && (
            <button
              onClick={aplicarMudancas}
              className="rounded-md bg-af-600 px-2.5 py-1 text-[11px] font-semibold
                         text-white hover:bg-af-500"
            >
              {mudancasEmEspera === 1
                ? '1 mudança no campo — atualizar'
                : `${mudancasEmEspera} mudanças no campo — atualizar`}
            </button>
          )}
        </div>

        {/* ====== tabela ====== */}
        <section className="card-controle sobe sobe-2 overflow-hidden">
          {/* A barra do lote fica FORA do quadro, presa no topo do
              cartao: ela fala das linhas selecionadas, e sumir de vista
              enquanto se rola a lista que ela apaga e o pior lugar
              possivel para um botao que nao se desfaz. */}
          {selecionados.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-af-700/40
                            bg-af-900/20 px-4 py-2.5">
              <span className="text-sm font-medium text-af-300">
                {selecionados.size} contrato(s) selecionado(s)
              </span>
              <button onClick={() => setSelecionados(new Set())}
                className="text-xs text-graf-400 underline underline-offset-2
                           hover:text-graf-200">
                limpar seleção
              </button>
              <span className="text-xs text-graf-400">
                apagar aqui é definitivo — não se desfaz
              </span>
              <button onClick={excluirSelecionados} disabled={excluindo}
                className="ml-auto rounded-md bg-af-600 px-4 py-1.5 text-xs font-semibold
                           text-white hover:bg-af-500 disabled:opacity-50">
                {excluindo ? 'Apagando…' : `Apagar ${selecionados.size} do banco`}
              </button>
            </div>
          )}

          {/* O quadro rola por dentro e o cabecalho fica: na segunda
              tela de 265 linhas, a coluna do meio sem cabecalho e um
              numero sem nome. */}
          <div className="quadro">
            {/* A caixa do cabeçalho marca O QUE SE VÊ — a página. Antes
                ela marcava o filtro inteiro, e com 1.400 linhas invisíveis
                isso é um botão de apagar em lote apontado para o escuro.
                Para marcar o filtro todo existe o botão explícito na barra
                de páginas, com o número escrito nele. */}
            <TabelaContratos
              linhas={naPagina}
              selecionados={selecionados}
              aoSelecionar={alternarSelecao}
              aoSelecionarTodos={marcado => setSelecionados(
                marcado ? new Set(naPagina.map(v => v.id)) : new Set())}
              detalhada={detalhada}
              pontos={pontos}
              porIndicador={porIndicador}
              carregando={carregando}
              aoAbrir={v => setModal(v.id)}
              aoMenuContexto={(v, e) => {
                // Botão direito abre as ações do contrato — é como o COP
                // está acostumado a trabalhar.
                setMenu(menu === v.id ? null : v.id)
                setMenuXY({ x: e.clientX, y: e.clientY })
              }}
              vazio={
                <Vazio
                  titulo={linhas.length === 0
                    ? (de === ate ? `Nenhuma visita em ${dataBR(de)}`
                                  : 'Nenhuma visita neste período')
                    : 'Nenhuma visita para este filtro'}
                  descricao={linhas.length === 0
                    ? 'Dia sem importação aparece vazio — e vazio aqui quer dizer'
                      + ' que ainda não chegou nada, não que deu erro.'
                    : `${base.length} carregadas, nenhuma passa nos ${filtrando} filtro(s).`}
                  acao={linhas.length === 0
                    ? <div className="flex flex-wrap items-center justify-center gap-2">
                        <Link to="/controle/importar"
                          className="rounded-lg bg-af-600 px-4 py-2 text-sm font-medium text-white
                                     hover:bg-af-500">Importar planilha</Link>
                        {/* O atalho para o último dia com movimento existe,
                            mas quem clica é o usuário: a tela não troca a
                            data dele por conta própria. */}
                        {ultimoDia && ultimoDia !== de && (
                          <button onClick={() => { setDe(ultimoDia); setAte(ultimoDia) }}
                            className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                                       text-graf-300 hover:border-af-600 hover:text-af-400">
                            ver {dataBR(ultimoDia)} — último dia com movimento
                          </button>
                        )}
                      </div>
                    : <button onClick={limpar}
                        className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                                   text-graf-300 hover:border-af-600">Limpar filtros</button>} />
              }
              renderAcoes={v => (<>
                <div className="flex items-center justify-end gap-1">
                  <Link to={`/controle/visita/${v.id}`} onClick={e => e.stopPropagation()}
                    className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                               text-graf-400 hover:border-af-600 hover:text-af-400">
                    abrir
                  </Link>
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      setMenu(menu === v.id ? null : v.id)
                      setMenuXY({ x: e.clientX, y: e.clientY })
                    }}
                    title="Ações do contrato"
                    className="rounded border border-graf-700 px-1.5 py-0.5 text-[11px]
                               leading-none text-graf-400 hover:border-af-600
                               hover:text-af-400">
                    ⋯
                  </button>
                </div>

                {menu === v.id && (
                  <div onClick={e => e.stopPropagation()}
                    style={menuXY ? {
                      left: Math.min(menuXY.x, window.innerWidth - 230),
                      top: Math.min(menuXY.y, window.innerHeight - 250),
                    } : undefined}
                    className="fixed z-50 w-52 overflow-hidden rounded-lg border
                               border-graf-700 bg-graf-900 text-left shadow-xl">
                    <Link to={`/controle/visita/${v.id}`}
                      className="block px-3 py-2 text-xs text-graf-200 hover:bg-graf-800">
                      Abrir contrato
                    </Link>
                    <button
                      onClick={() => { setModal(v.id); setMenu(null) }}
                      className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                 hover:bg-graf-800">
                      Marcadores…
                    </button>
                    <button
                      onClick={() => { setModal(v.id); setMenu(null) }}
                      disabled={v.ordem_servico.length === 0}
                      className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                 hover:bg-graf-800 disabled:opacity-40">
                      Baixar serviço…
                    </button>
                    <button
                      onClick={() => { setModal(v.id); setMenu(null) }}
                      className="block w-full px-3 py-2 text-left text-xs text-graf-200
                                 hover:bg-graf-800">
                      Transferir equipe…
                    </button>
                    <button
                      onClick={() => { setModal(v.id); setMenu(null) }}
                      className="block w-full border-t border-graf-800 px-3 py-2
                                 text-left text-xs text-af-300 hover:bg-af-900/20">
                      Apagar do banco…
                    </button>
                    <div className="border-t border-graf-800 px-3 py-2 text-[10px]
                                    leading-snug text-graf-600">
                      Editar não existe: o cadastro vem do TOA e é reescrito a cada
                      importação.
                    </div>
                  </div>
                )}
              </>)}
            />
          </div>

          {/* Só existe quando há o que paginar (D-151). Abaixo de 50
              contratos a barra seria ruído: uma página de uma. */}
          {visiveis.length > POR_PAGINA && (
            <nav aria-label="Páginas de contratos"
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t
                         border-graf-800 px-4 py-2.5 text-xs">
              <span className="tabular text-graf-400">
                {inicio + 1}–{Math.min(inicio + POR_PAGINA, visiveis.length)}
                {' de '}{visiveis.length}
              </span>

              <span className="ml-auto flex items-center gap-1.5">
                <button onClick={() => setPagina(1)} disabled={paginaAtual === 1}
                  aria-label="Primeira página"
                  className="rounded-md border border-graf-700 px-2 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  «
                </button>
                <button onClick={() => setPagina(p => Math.max(1, p - 1))}
                  disabled={paginaAtual === 1} aria-label="Página anterior"
                  className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  ‹ anterior
                </button>

                {/* O "1/30" que ele pediu, e que também é o campo de pulo:
                    com 30 páginas, clicar 14 vezes em "próxima" é trabalho. */}
                <span className="tabular flex items-center gap-1 px-1 text-graf-200"
                  aria-current="page">
                  <label className="sr-only" htmlFor="pagina-atual">Ir para a página</label>
                  <input id="pagina-atual" type="number" min={1} max={paginas}
                    value={paginaAtual}
                    onChange={e => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n)) setPagina(Math.min(paginas, Math.max(1, n)))
                    }}
                    className="tabular w-12 rounded-md border border-graf-700 bg-graf-900
                               px-1.5 py-1 text-center outline-none focus:border-af-500" />
                  <span className="text-graf-400">/ {paginas}</span>
                </span>

                <button onClick={() => setPagina(p => Math.min(paginas, p + 1))}
                  disabled={paginaAtual === paginas} aria-label="Próxima página"
                  className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  próxima ›
                </button>
                <button onClick={() => setPagina(paginas)} disabled={paginaAtual === paginas}
                  aria-label="Última página"
                  className="rounded-md border border-graf-700 px-2 py-1 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-35
                             disabled:hover:border-graf-700 disabled:hover:text-graf-300">
                  »
                </button>
              </span>

              {/* Marcar além do que se vê só acontece dizendo o número. */}
              <button
                onClick={() => setSelecionados(
                  selecionados.size === visiveis.length
                    ? new Set()
                    : new Set(visiveis.map(v => v.id)))}
                className="w-full text-left text-[11px] text-af-400 underline
                           underline-offset-2 sm:w-auto">
                {selecionados.size === visiveis.length
                  ? 'desmarcar tudo'
                  : `marcar os ${visiveis.length} do filtro, não só esta página`}
              </button>
            </nav>
          )}
        </section>

        <p className="pb-6 text-center text-xs text-graf-600">
          {visiveis.length > POR_PAGINA && (
            <>página {paginaAtual} de {paginas} · </>
          )}
          {visiveis.length} de {base.length} visitas
          {totalPontos > 0 && (
            <> · <strong className="tabular text-emerald-400">
              {pts(totalPontos)}
            </strong> CLARO no filtro</>
          )}
          {soProdutivas && linhas.length !== base.length &&
            ` · ${linhas.length - base.length} apontamentos de jornada ocultos`}
        </p>
      </div>

      {novo && (
        <NovoContratoModal
          onFechar={() => setNovo(false)}
          onCriado={id => {
            setNovo(false)
            setVersao(x => x + 1)
            // Abre o contrato recém-criado: quem cadastrou quase sempre
            // quer conferir ou já atribuir equipe.
            setModal(id)
          }}
        />
      )}

      {modal && (
        <ContratoModal
          id={modal}
          indicadores={indicadores}
          codigos={codigos}
          conjunto={conjunto}
          equipes={equipes}
          pontos={pontos.get(modal) ?? null}
          onFechar={() => setModal(null)}
          onMudou={() => setVersao(x => x + 1)}
        />
      )}
    </Shell>
  )
}
