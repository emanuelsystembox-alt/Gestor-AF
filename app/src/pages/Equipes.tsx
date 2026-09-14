import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { lerPlanilha } from '../lib/planilha'
import { dataBR, equipeRotulo, isoLocal } from '../lib/formato'
import { useDiaAnteriorComMovimento } from '../lib/dia'
import { Shell } from '../components/Shell'
import { Alerta, Avatar, Vazio } from '../components/ui'
import { ContratoModal } from '../components/ContratoModal'
import { BarraComposicao, FaixaPeriodos } from '../components/telemetria'
// O contrato aparece aqui do MESMO jeito que na tela de Serviços: uma
// linha só, um componente só (D-095).
import {
  TabelaContratos, SELECT_CONTRATO,
  type ContratoLinha, type PontoVisita,
} from '../components/TabelaContratos'

/**
 * Equipes de campo.
 *
 * A leitura é POR DIA (`painel_equipes(p_data)`), não por CURRENT_DATE:
 * a `vw_equipe_resumo` devolvia zero para tudo sempre que o dia corrente
 * não tinha importação — a tela parecia vazia sem estar errada.
 *
 * Cada equipe abre e mostra os contratos daquele dia, com as O.S.
 * agrupadas por contrato. É a leitura que o COP faz: "o que a 014 tem
 * hoje", não "liste 470 visitas e filtre".
 *
 * OCIOSO (D-026): só vale para o dia corrente — ver D-033 na migration
 * 024. Em dia passado a coluna mostra a hora da última atividade.
 */

interface Periodo { janela: string; qtd: number }
interface SitQtd { situacao: Situacao; qtd: number }

interface EquipePainel {
  equipe_id: string
  codigo: string
  nome: string
  area: string | null
  supervisor: string | null
  /** O supervisor mostrado é alguém DESTA casa — declarado na tela — ou
   *  o texto que veio da planilha de equipes? Sem esta distinção a tela
   *  apresenta um nome de fora como se fosse do time (069). */
  supervisor_declarado: boolean | null
  login_toa: string | null
  tecnicos: number
  visitas: number
  ordens: number
  periodos: Periodo[] | null
  situacoes: SitQtd[] | null
  ultima_atividade: string | null
  situacao_final: Situacao | null
  minutos_parada: number | null
  ocioso: boolean | null
}

interface Tec {
  id: string; matricula: string; nome: string; situacao: string
  equipe_id: string | null
  foto_url: string | null
  /** A OPERAÇÃO: a cidade onde ele atua (migration 063). `regiao` é o
   *  agrupamento comercial, e é nula nas praças que o relatório do
   *  Emanuel não cobria. */
  base: { nome: string; regiao: string | null } | null
  /** O supervisor DECLARADO (068). Tem precedência sobre o nome que vem
   *  da planilha na equipe — e a tela precisa dizer qual dos dois está
   *  mostrando, senão os dois fatos divergem em silêncio. */
  supervisor: { nome: string } | null
  equipe: { codigo: string; nome: string; supervisor_nome: string | null
            area: { apelido: string | null } | null } | null
}
/** De onde veio o login que roteou o contrato para esta equipe.
 *  CADASTRO = alguém digitou. MATRICULA = saiu da planilha de equipes,
 *  pela matrícula do técnico. A diferença importa (D-079). */
interface LoginEquipe {
  equipe_id: string; login: string
  origem: 'CADASTRO' | 'MATRICULA' | 'SEM_CADASTRO'
  visitas: number
}
/** Login que aparece no TOA e ninguém disse de quem é. Enquanto não
 *  disser, o contrato dele fica na equipe "Sem login definido".
 *
 *  Sem sugestão de EQUIPE (D-089): deduzir pela matrícula acerta quase
 *  sempre, e é por isso que ninguém confere. O `nome_toa` é outra
 *  coisa — é a coluna "Recurso" que o próprio TOA emite ao lado do
 *  login (D-091). Dado da fonte, não palpite nosso. */
interface LoginSemDono {
  login: string; visitas: number; primeira: string; ultima: string
  nome_toa: string | null
}
interface Orfao {
  matricula: string; visitas: number
  primeira: string; ultima: string; equipes_sugeridas: string | null
}

const COLUNAS = ['LOGIN', 'NOME DO TÉCNICO', 'EQUIPE', 'SUPERVISOR', 'ÁREA']



const hora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null

export default function Equipes() {

  /** A tela é só de equipes desde a D-137. `aba` fica como constante
   *  para as condições existentes continuarem legíveis. */
  const aba = 'equipes' as const

  // HOJE, e só. Abria no último dia com visita, o que mostrava o painel
  // de ontem sob a data de hoje (ver lib/dia.ts). Como a data já nasce
  // certa, também some o segundo carregamento que corrigia a primeira.
  const [data, setData] = useState<string>(isoLocal())
  const [painel, setPainel] = useState<EquipePainel[]>([])
  const [tecnicos, setTecnicos] = useState<Tec[]>([])
  const [orfaos, setOrfaos] = useState<Orfao[]>([])
  const [logins, setLogins] = useState<LoginEquipe[]>([])
  const [semDono, setSemDono] = useState<LoginSemDono[]>([])
  const [equipeDoLogin, setEquipeDoLogin] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(true)
  /** Último dia com contrato, quando NÃO é o dia na tela. Vira atalho
   *  no estado vazio — nunca troca a data sozinho (ver lib/dia.ts). */
  const outroDia = useDiaAnteriorComMovimento(data)


  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // Pontuação e marcadores do dia: a linha do contrato mostra os dois
  // (D-095), e sem eles a mesma linha diria menos aqui do que em
  // Serviços. Uma chamada por dia, não uma por equipe aberta.
  const [pontos, setPontos] = useState<Map<string, PontoVisita>>(new Map())
  const [indicadores, setIndicadores] = useState<{ id: string; nome: string }[]>([])
  const porIndicador = useMemo(
    () => new Map(indicadores.map(i => [i.id, i])), [indicadores])

  // O contrato abre em JANELA, como em Serviços (D-056) — e não numa
  // página separada. Era a última diferença entre as duas telas.
  const [modal, setModal] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [menuXY, setMenuXY] = useState<{ x: number; y: number } | null>(null)
  // O que o modal precisa para baixar, transferir e marcar.
  const [codigos, setCodigos] = useState<{ codigo: number; descricao: string }[]>([])
  const [conjunto, setConjunto] = useState<string | null>(null)
  const [equipesLista, setEquipesLista] =
    useState<{ id: string; codigo: string; nome: string }[]>([])

  // expansão sob demanda
  const [aberta, setAberta] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<Record<string, ContratoLinha[]>>({})
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null)

  // filtros
  const [busca, setBusca] = useState('')
  const [area, setArea] = useState('TODAS')
  const [supervisor, setSupervisor] = useState('TODOS')
  // Ligado por padrao: 89 equipes na tela, 7 com servico no dia. Quem
  // nao tem contrato nao tem o que ser olhado -- e as 82 linhas vazias
  // empurravam as 7 que importam para fora da primeira tela.
  const [soAtivas, setSoAtivas] = useState(true)
  const [agrupar, setAgrupar] = useState<'nenhum' | 'supervisor' | 'area'>('nenhum')

  // importação
  const inputRef = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<Record<string, string>[] | null>(null)
  const [faltando, setFaltando] = useState<string[]>([])
  // Arquivo do TOA largado na importação de equipes. Acontece porque os
  // dois botões se chamam "Importar planilha"; dizer "faltam colunas"
  // manda a pessoa procurar defeito num arquivo que está certo — só
  // está na tela errada.
  const [ehArquivoTOA, setEhArquivoTOA] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  // cadastro avulso
  const [cadastrando, setCadastrando] = useState<string | null>(null)
  const [nomeNovo, setNomeNovo] = useState('')
  const [equipeNova, setEquipeNova] = useState('')

  useEffect(() => {
    supabase.from('indicador_qualidade').select('id, nome').eq('ativo', true).order('ordem')
      .then(({ data: d }) => setIndicadores((d ?? []) as { id: string; nome: string }[]))
    supabase.from('codigo_baixa').select('codigo, descricao').order('codigo')
      .then(({ data: d }) => setCodigos((d ?? []) as { codigo: number; descricao: string }[]))
    supabase.from('empresa').select('conjunto_sub_falha').maybeSingle()
      .then(({ data: d }) => setConjunto(
        (d as { conjunto_sub_falha: string | null } | null)?.conjunto_sub_falha ?? null))
    supabase.from('equipe').select('id, codigo, nome').eq('ativo', true).order('codigo')
      .then(({ data: d }) => setEquipesLista(
        (d ?? []) as { id: string; codigo: string; nome: string }[]))
  }, [])

  useEffect(() => {
    if (!data) return
    supabase.rpc('pontos_por_periodo', { p_de: data, p_ate: data }).then(({ data: d }) => {
      const m = new Map<string, PontoVisita>()
      for (const x of (d ?? []) as PontoVisita[]) m.set(x.visita_id, x)
      setPontos(m)
    })
  }, [data])

  // Cada carregamento carimba um número; resposta de pedido velho é
  // descartada. Trocar de data rápido não embaralha mais o painel.
  // Quem aparece na bolinha da equipe: o tecnico dela. Uma equipe pode
  // ter mais de um (a AFLINE trabalha em dupla); mostramos o primeiro e
  // dizemos no title quantos sao.
  const porEquipe = useMemo(() => {
    const m = new Map<string, Tec[]>()
    for (const t of tecnicos) {
      if (!t.equipe_id) continue
      const l = m.get(t.equipe_id) ?? []
      l.push(t)
      m.set(t.equipe_id, l)
    }
    return m
  }, [tecnicos])

  const porLogin = useMemo(() => {
    const m = new Map<string, LoginEquipe[]>()
    for (const l of logins) {
      const a = m.get(l.equipe_id) ?? []
      a.push(l); m.set(l.equipe_id, a)
    }
    return m
  }, [logins])

  const pedido = useRef(0)

  async function recarregar() {
    if (!data) return
    const meu = ++pedido.current
    setCarregando(true); setErro(null)
    setAberta(null); setDetalhe({})
    const [p, t, o, lg, sd] = await Promise.all([
      supabase.rpc('painel_equipes', { p_data: data }),
      supabase.from('tecnico')
        .select(`id, matricula, nome, situacao, equipe_id, foto_url,
                 base:base_id ( nome, regiao ),
                 supervisor:supervisor_id ( nome ),
                 equipe:equipe_id ( codigo, nome, supervisor_nome,
                                    area:area_id ( apelido ) )`)
        .order('matricula'),
      supabase.rpc('tecnicos_nao_cadastrados'),
      supabase.rpc('logins_das_equipes', { p_data: data }),
      supabase.rpc('logins_sem_cadastro'),
    ])
    if (meu !== pedido.current) return
    if (p.error) setErro(p.error.message)
    else {
      /*
       * ┌─ o abrigo só aparece quando está segurando alguma coisa ─────┐
       * │ `SEM-LOGIN` existe uma vez por base — são 18 linhas que não   │
       * │ são equipe de campo: são a sala de espera do contrato cujo    │
       * │ login ninguém declarou. Enquanto havia 107 equipes elas se    │
       * │ diluíam; depois da limpeza viraram 18 de 21, e o painel       │
       * │ passou a dizer "21 equipes, 18 sem técnico" — contando        │
       * │ prateleira vazia como equipe sem gente.                       │
       * │                                                               │
       * │ Abrigo com contrato continua aparecendo, e tem de aparecer:   │
       * │ é o aviso de que há trabalho sem dono.                        │
       * └───────────────────────────────────────────────────────────────┘
       */
      const linhas = (p.data ?? []) as EquipePainel[]
      setPainel(linhas.filter(e => e.codigo !== 'SEM-LOGIN' || e.visitas > 0))
    }
    if (t.data) setTecnicos(t.data as unknown as Tec[])
    if (o.data) setOrfaos(o.data as Orfao[])
    setLogins((lg.data ?? []) as LoginEquipe[])
    setSemDono((sd.data ?? []) as LoginSemDono[])
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [data])

  async function abrir(e: EquipePainel) {
    if (aberta === e.equipe_id) { setAberta(null); return }
    setAberta(e.equipe_id)
    if (detalhe[e.equipe_id]) return
    setCarregandoDetalhe(e.equipe_id)
    const { data: d, error } = await supabase.from('visita').select(SELECT_CONTRATO)
      .eq('equipe_id', e.equipe_id).eq('data_agendada', data)
      .is('excluido_em', null)
      .order('janela_inicio', { ascending: true, nullsFirst: false })
    if (error) setErro(error.message)
    else setDetalhe(m => ({ ...m, [e.equipe_id]: (d ?? []) as unknown as ContratoLinha[] }))
    setCarregandoDetalhe(null)
  }

  async function receber(f: File) {
    setErro(null); setOk(null)
    try {
      const r = await lerPlanilha(f, 'Equipes')
      // A planilha do TOA tem estas duas colunas e a de equipes não tem
      // nenhuma delas — é assinatura suficiente para não confundir.
      const doTOA = r.cabecalhos.includes('ID da Atividade')
                 && r.cabecalhos.includes('Status da Atividade')
      setEhArquivoTOA(doTOA)
      setFaltando(COLUNAS.filter(c => !r.cabecalhos.includes(c)))
      setPrevia(r.linhas)
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui ler a planilha.')
    }
  }

  async function importar() {
    if (!previa) return
    setOcupado(true); setErro(null)
    try {
      const LOTE = 200
      let ultimo: Record<string, unknown> = {}
      for (let i = 0; i < previa.length; i += LOTE) {
        const { data: d, error } = await supabase.rpc('importar_equipes',
          { p_linhas: previa.slice(i, i + LOTE) })
        if (error) throw new Error(error.message)
        ultimo = d as Record<string, unknown>
      }
      const { data: religadas } = await supabase.rpc('religar_visitas_equipe')
      setOk(`${ultimo.equipes} equipes e ${ultimo.tecnicos} técnicos no cadastro. `
        + `${religadas ?? 0} visitas religadas.`)
      setPrevia(null)
      if (inputRef.current) inputRef.current.value = ''
      await recarregar()
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Falha ao importar.')
    } finally { setOcupado(false) }
  }

  async function cadastrarAvulso(matricula: string) {
    setOcupado(true); setErro(null)
    const { data: d, error } = await supabase.rpc('cadastrar_tecnico_avulso', {
      p_matricula: matricula,
      p_nome: nomeNovo || matricula,
      p_equipe_id: equipeNova || null,
    })
    if (error) setErro(error.message)
    else {
      const r = d as { visitas_religadas: number }
      setOk(`${matricula} cadastrado. ${r.visitas_religadas} visitas religadas a ele.`)
      setCadastrando(null); setNomeNovo(''); setEquipeNova('')
      await recarregar()
    }
    setOcupado(false)
  }

  /** Técnico desligado não sai do sistema — some da operação e continua
   *  respondendo pelo que executou. Por isso a única ação aqui é mudar a
   *  situação; apagar nem aparece, e o banco recusa quem tem histórico. */

  const areas = useMemo(() =>
    [...new Set(painel.map(e => e.area).filter(Boolean) as string[])].sort(), [painel])
  const supervisores = useMemo(() =>
    [...new Set(painel.map(e => e.supervisor).filter(Boolean) as string[])].sort(), [painel])

  const eqFiltradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return painel.filter(e => {
      if (area !== 'TODAS' && e.area !== area) return false
      if (supervisor !== 'TODOS' && e.supervisor !== supervisor) return false
      if (soAtivas && e.visitas === 0) return false
      if (!t) return true
      return [e.codigo, e.nome, e.supervisor, e.area, e.login_toa]
        .some(x => x?.toLowerCase().includes(t))
    })
  }, [painel, busca, area, supervisor, soAtivas])

  const grupos = useMemo(() => {
    const ordenadas = [...eqFiltradas].sort((a, b) =>
      b.visitas - a.visitas || a.codigo.localeCompare(b.codigo))
    if (agrupar === 'nenhum') return [{ titulo: '', itens: ordenadas }]
    const m = new Map<string, EquipePainel[]>()
    for (const e of ordenadas) {
      const k = (agrupar === 'supervisor' ? e.supervisor : e.area) ?? '(sem definição)'
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([titulo, itens]) => ({ titulo, itens }))
  }, [eqFiltradas, agrupar])

  const tecFiltrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return tecnicos.filter(x => {
      if (area !== 'TODAS' && x.equipe?.area?.apelido !== area) return false
      if (!t) return true
      return [x.matricula, x.nome, x.base?.nome, x.equipe?.codigo,
              x.supervisor?.nome, x.equipe?.supervisor_nome]
        .some(y => y?.toLowerCase().includes(t))
    })
  }, [tecnicos, busca, area])

  const semTecnico = painel.filter(e => e.tecnicos === 0).length
  const emCampo = painel.filter(e => e.visitas > 0).length
  /** Nenhuma equipe rodou neste dia — diferente de "o filtro escondeu
   *  todas", e o estado vazio precisa dizer qual dos dois é. */
  const diaSemMovimento = emCampo === 0
  const ociosas = painel.filter(e => e.ocioso).length
  const totalOrfaos = orfaos.reduce((s, o) => s + o.visitas, 0)
  const ehHoje = data === isoLocal(new Date())

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs'

  /** Declara de quem é o login e leva os contratos junto — cadastrar e
   *  continuar com 337 contratos no abrigo faria o cadastro parecer
   *  inútil. */
  async function cadastrarLogin(login: string, equipeId: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('cadastrar_login_da_equipe',
      { p_equipe: equipeId, p_login: login })
    if (error) setErro(error.message)
    else {
      const r = data as { equipe: string; contratos_movidos: number; desde: string }
      setOk(`Login ${login} é da equipe ${r.equipe}. `
        + `${r.contratos_movidos} contrato(s) movido(s), desde `
        + new Date(r.desde + 'T12:00').toLocaleDateString('pt-BR') + '.')
      await recarregar()
    }
    setOcupado(false)
  }


  return (
    <Shell acoes={
      <div className="flex items-center gap-2">
        <input type="date" value={data} onChange={e => setData(e.target.value)}
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        <button onClick={() => inputRef.current?.click()}
          className="rounded-md bg-af-600 px-3 py-1 text-xs font-medium text-white hover:bg-af-500">
          Importar planilha
        </button>
      </div>
    }>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) receber(f) }} />

      <div className="space-y-4 p-4">
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        {/* ====== prévia da importação ====== */}
        {previa && (
          <section className="card-controle space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">Prévia da importação</h2>
              <button onClick={() => { setPrevia(null); setEhArquivoTOA(false) }}
                className="text-sm text-graf-400 hover:text-af-400">Cancelar</button>
            </div>
            <p className="text-sm text-graf-300">
              <strong className="tabular text-lg">{previa.length}</strong> linhas.
              Equipe e técnico já existentes são <strong>atualizados</strong>, não duplicados.
            </p>
            {ehArquivoTOA ? (
              <Alerta tipo="aviso">
                <strong>Esta é a planilha de ATIVIDADES do TOA</strong>, não a de
                equipes — ela tem <code>ID da Atividade</code> e{' '}
                <code>Status da Atividade</code>. O arquivo está certo; só está na
                tela errada.{' '}
                <Link to="/controle/importar"
                  className="font-medium underline underline-offset-2 hover:text-af-400">
                  Importar TOA é aqui →
                </Link>
                <span className="mt-1 block text-xs opacity-80">
                  Nesta tela entra a planilha de <strong>equipes</strong>, com as
                  colunas {COLUNAS.join(', ')}.
                </span>
              </Alerta>
            ) : faltando.length > 0 && (
              <Alerta tipo="aviso">
                Colunas ausentes: <strong>{faltando.join(', ')}</strong>.
                Use a <code>equipes-manaus.xlsx</code>, aba <code>Equipes</code>.
              </Alerta>
            )}
            <button onClick={importar} disabled={ocupado || faltando.length > 0}
              className="toque rounded-lg bg-af-600 px-6 font-semibold text-white
                         hover:bg-af-500 disabled:opacity-50">
              {ocupado ? 'Importando…' : `Importar ${previa.length} linhas`}
            </button>
          </section>
        )}

        {/* ====== o estado da operacao ======
            ┌─ por que uma regua e nao seis cartoes ───────────────────┐
            │ Eram seis cartoes iguais, lado a lado, cada um com um    │
            │ numero grande. Seis cartoes iguais dizem "seis coisas    │
            │ igualmente importantes" -- e nao sao. A pergunta de quem │
            │ abre esta tela e UMA: quantas equipes estao rodando hoje │
            │ e o que esta faltando. Entao a primeira celula responde  │
            │ isso com a proporcao desenhada, e o resto e contagem de  │
            │ apoio, menor, na mesma regua.                            │
            │                                                          │
            │ O que e ALERTA acende em vermelho; o que e zero medido   │
            │ fica cinza. E o que NAO SE SABE (ocioso em dia passado)  │
            │ escreve "—" e diz por que -- zero e desconhecido nao sao │
            │ a mesma coisa.                                           │
            └──────────────────────────────────────────────────────────┘ */}
        <section className="painel-estado sobe" aria-label="Estado da operação no dia">
          <div className="flex-[2_1_18rem]">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-2xl font-semibold leading-none">{emCampo}</span>
              <span className="text-sm text-graf-300">
                de <span className="tabular">{painel.length}</span> equipes com serviço no dia
              </span>
            </div>
            <div className="mistura mt-2.5" aria-hidden
              title={`${emCampo} com serviço · ${Math.max(0, painel.length - emCampo)} sem nada no dia`}>
              <span style={{ flex: `${emCampo} 0 0`,
                             ['--fatia-cor' as string]: 'var(--st-execucao)' }} />
              <span style={{ flex: `${Math.max(0, painel.length - emCampo)} 0 0`,
                             ['--fatia-cor' as string]: 'var(--color-graf-700)' }} />
            </div>
          </div>

          {([
            ['Técnicos', tecnicos.length, false, 'Técnicos ativos no cadastro'],
            ['Sem técnico', semTecnico, semTecnico > 0,
              'Equipe cadastrada sem ninguém vinculado — o contrato dela não chega a celular nenhum'],
            ['Fora do cadastro', orfaos.length, orfaos.length > 0,
              'Matrícula que apareceu no TOA e não está na planilha de equipes'],
          ] as [string, number, boolean, string][]).map(([r, v, alerta, dica]) => (
            <div key={r} title={dica}>
              <div className="tabular text-xl font-semibold leading-none"
                   style={alerta ? { color: 'var(--st-conflito)' } : undefined}>
                {v}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] uppercase
                              tracking-wide text-graf-400">
                {alerta && <span aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-af-500" />}
                {r}
              </div>
            </div>
          ))}

          <div title={ehHoje
            ? 'Equipes sem encerramento há mais tempo que o limite'
            : 'OCIOSO só é calculado para o dia corrente — em dia passado não sabemos'}>
            <div className="tabular text-xl font-semibold leading-none"
                 style={ehHoje && ociosas > 0 ? { color: 'var(--st-conflito)' } : undefined}>
              {ehHoje ? ociosas : '—'}
            </div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
              {ehHoje ? 'Ociosas agora' : 'Ocioso · só hoje'}
            </div>
          </div>
        </section>

        {/* ====== filtros ====== */}
        <section className="card-controle flex flex-wrap items-center gap-2 p-3">
          {/* A aba "Técnicos" saiu daqui e foi para Administração (D-137):
              desligar técnico é cadastro, não despacho, e não pode ficar a
              um clique de quem está olhando o dia. */}
          <div className="rounded-lg bg-af-600 px-3 py-1.5 text-xs font-medium text-white">
            Equipes<span className="tabular ml-1.5 opacity-60">{painel.length}</span>
          </div>

          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar código, login TOA, matrícula, supervisor…"
            className="min-w-56 flex-1 rounded-md border border-graf-700 bg-graf-900 px-3 py-1.5
                       text-sm outline-none placeholder-graf-500 focus:border-af-500" />

          <select value={area} onChange={e => setArea(e.target.value)} className={sel}>
            <option value="TODAS">Todas as áreas</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>

          {aba === 'equipes' && (
            <>
              <select value={supervisor} onChange={e => setSupervisor(e.target.value)}
                className={`max-w-52 ${sel}`}>
                <option value="TODOS">Todos os supervisores</option>
                {supervisores.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={agrupar} onChange={e => setAgrupar(e.target.value as typeof agrupar)}
                className={sel}>
                <option value="nenhum">Sem agrupamento</option>
                <option value="supervisor">Agrupar por supervisor</option>
                <option value="area">Agrupar por área</option>
              </select>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
                <input type="checkbox" checked={soAtivas}
                  onChange={e => setSoAtivas(e.target.checked)} className="accent-af-600" />
                Só com serviço no dia
              </label>
            </>
          )}
        </section>

        {/* ====== conteúdo ====== */}
        {carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : aba === 'equipes' ? (
          eqFiltradas.length === 0 ? (
            <div className="card-controle">
              {/* O motivo do vazio não é sempre o mesmo, e dizer o motivo
                  errado manda a pessoa mexer no filtro quando o que falta
                  é a importação do dia. */}
              <Vazio
                titulo={diaSemMovimento
                  ? `Nenhuma equipe com serviço em ${dataBR(data)}`
                  : 'Nenhuma equipe para este filtro'}
                descricao={diaSemMovimento
                  ? `O painel é do dia escolhido, e neste dia não há contrato importado.`
                    + ` As ${painel.length} equipes continuam cadastradas.`
                  : 'Ajuste a busca ou os filtros.'}
                acao={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {diaSemMovimento && soAtivas && painel.length > 0 && (
                      <button onClick={() => setSoAtivas(false)}
                        className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                                   text-graf-300 hover:border-af-600 hover:text-af-400">
                        ver as {painel.length} equipes cadastradas
                      </button>
                    )}
                    {/* O atalho existe; a troca de dia é decisão de quem olha. */}
                    {outroDia && (
                      <button onClick={() => setData(outroDia)}
                        className="rounded-lg border border-graf-700 px-4 py-2 text-sm
                                   text-graf-300 hover:border-af-600 hover:text-af-400">
                        ver {dataBR(outroDia)} — último dia com movimento
                      </button>
                    )}
                  </div>
                } />
            </div>
          ) : (
            <div className="space-y-4">
              {grupos.map(g => (
                <section key={g.titulo || 'todos'} className="card-controle overflow-hidden">
                  {g.titulo && (
                    <div className="flex items-baseline gap-2 border-b border-graf-800 bg-graf-900 px-3 py-2">
                      <h3 className="text-sm font-semibold">{g.titulo}</h3>
                      <span className="tabular text-xs text-graf-500">
                        {g.itens.length} equipe(s) ·{' '}
                        {g.itens.reduce((s, e) => s + Number(e.visitas), 0)} contratos no dia
                      </span>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-graf-700 bg-graf-900 text-left
                                        text-[11px] uppercase tracking-wide text-graf-400">
                        <tr>
                          <th className="w-8 px-2 py-2"></th>
                          <th className="px-3 py-2 font-medium">Equipe</th>
                          <th className="px-3 py-2 text-right font-medium">Contratos</th>
                          <th className="px-3 py-2 text-right font-medium">O.S.</th>
                          <th className="px-3 py-2 font-medium">Períodos</th>
                          <th className="px-3 py-2 font-medium">Situação</th>
                          <th className="px-3 py-2 font-medium">
                            {ehHoje ? 'Estado' : 'Última atividade'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.itens.map(e => {
                          const exp = aberta === e.equipe_id
                          return (
                            <Fragment key={e.equipe_id}>
                              <tr onClick={() => abrir(e)}
                                  className={`linha-equipe cursor-pointer border-b border-graf-800
                                              align-top ${exp ? 'aberta' : ''}`}>
                                {/* A seta e um BOTAO de verdade: a linha inteira
                                    responde ao mouse, mas quem navega por teclado
                                    precisava de um alvo com nome e estado, e
                                    `<tr onClick>` nao e alcancavel por Tab. */}
                                <td className="px-2 py-2.5">
                                  <button
                                    onClick={ev => { ev.stopPropagation(); abrir(e) }}
                                    aria-expanded={exp}
                                    aria-label={`${exp ? 'Fechar' : 'Abrir'} os contratos da equipe ${e.codigo}`}
                                    className={`grid h-6 w-6 place-items-center rounded text-sm
                                                leading-none transition-transform duration-200
                                                hover:text-af-400
                                                ${exp ? 'rotate-90 text-af-400' : 'text-graf-500'}`}>
                                    ▸
                                  </button>
                                </td>

                                <td className="px-3 py-2.5">
                                  <div className="flex items-start gap-2.5">
                                  {(() => {
                                    const ts = porEquipe.get(e.equipe_id) ?? []
                                    const t = ts[0]
                                    return (
                                      <Avatar
                                        nome={t?.nome ?? e.codigo}
                                        foto={t?.foto_url}
                                        tamanho={32}
                                        titulo={ts.length
                                          ? `${ts.map(x => x.nome).join(' · ')}`
                                          : `Equipe ${e.codigo} — sem técnico`} />
                                    )
                                  })()}
                                  <div className="min-w-0">
                                  <div className="flex items-baseline gap-2">
                                    <span className="tabular font-semibold">
                                      {equipeRotulo(e.codigo, e.nome)}
                                    </span>
                                    {e.tecnicos === 0 && (
                                      <span className="rounded bg-af-900/40 px-1.5 py-0.5
                                                       text-[10px] font-semibold text-af-300">
                                        sem técnico
                                      </span>
                                    )}
                                  </div>
                                  {/* ┌─ o cartão da equipe ────────────────────┐
                                      │ > "precisamos melhorar mais essa parte  │
                                      │ >  da foto do técnico, equipe […]       │
                                      │ >  colocar as informações completas"    │
                                      │ >  — Emanuel                            │
                                      │                                         │
                                      │ Era uma linha corrida onde login, nome  │
                                      │ e supervisor se misturavam. Agora é     │
                                      │ rótulo e valor, um por linha: o olho    │
                                      │ acha o LOGIN sempre no mesmo lugar,     │
                                      │ em qualquer equipe da lista.            │
                                      └─────────────────────────────────────────┘ */}
                                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2
                                                 gap-y-0.5 text-[11px] leading-tight">
                                    {(() => {
                                      const ts = porEquipe.get(e.equipe_id) ?? []
                                      const ls = porLogin.get(e.equipe_id) ?? []
                                      // O abrigo não é equipe: é a fila de quem
                                      // ainda não tem dono. Rótulo de técnico ali
                                      // seria inventar gente.
                                      if (e.codigo === 'SEM-LOGIN') return (
                                        <>
                                          <dt className="text-graf-600">AGUARDANDO</dt>
                                          <dd className="text-amber-400">
                                            {ls.length} login(s) esperando cadastro
                                          </dd>
                                        </>
                                      )
                                      return (
                                        <>
                                          <dt className="text-graf-600">NOME</dt>
                                          <dd className="min-w-0 truncate text-graf-200"
                                              title={ts.map(x => x.nome).join(' · ')}>
                                            {ts.length
                                              ? ts.map(x => x.nome).join(' · ')
                                              : <span className="text-af-400">sem técnico cadastrado</span>}
                                          </dd>

                                          <dt className="text-graf-600">LOGIN</dt>
                                          <dd className="min-w-0">
                                            {ls.length === 0 ? (
                                              <span className="text-graf-600">sem login TOA no dia</span>
                                            ) : ls.map(l => (
                                              <span key={l.login} className="mr-2 inline-block">
                                                <span className="tabular text-graf-300">{l.login}</span>
                                                {/* Dizer de onde veio o login é o que
                                                    impede confundir dedução com cadastro. */}
                                                {l.origem === 'CADASTRO' ? (
                                                  <span title="Cadastrado por alguém desta operação"
                                                    className="ml-1 rounded bg-emerald-900/40 px-1
                                                               text-[9px] font-semibold uppercase
                                                               text-emerald-300">cadastrado</span>
                                                ) : (
                                                  <span title="Ninguém disse de quem é este login — o contrato dele está na equipe Sem login definido"
                                                    className="ml-1 rounded bg-amber-900/40 px-1
                                                               text-[9px] font-semibold uppercase
                                                               text-amber-300">sem cadastro</span>
                                                )}
                                              </span>
                                            ))}
                                          </dd>

                                          <dt className="text-graf-600">SUPERVISOR</dt>
                                          <dd className="min-w-0 truncate">
                                            {e.supervisor ? (
                                              e.supervisor_declarado ? (
                                                <span className="text-graf-200">{e.supervisor}</span>
                                              ) : (
                                                <span
                                                  title="Nome que veio da planilha de equipes — ninguém desta casa foi declarado supervisor destes técnicos ainda"
                                                  className="text-graf-500">
                                                  {e.supervisor}
                                                  <span className="ml-1 text-[9px] uppercase
                                                                   tracking-wide text-graf-600">
                                                    da planilha
                                                  </span>
                                                </span>
                                              )
                                            ) : <span className="text-graf-600">não definido</span>}
                                          </dd>

                                        </>
                                      )
                                    })()}
                                  </dl>
                                  </div>
                                  </div>
                                </td>

                                <td className="tabular px-3 py-2.5 text-right">
                                  {e.visitas || <span className="text-graf-600">—</span>}
                                </td>
                                <td className="tabular px-3 py-2.5 text-right text-graf-400">
                                  {e.ordens || <span className="text-graf-600">—</span>}
                                </td>

                                {/* As dez linhas de "08:00 - 11:00 (20)" viravam
                                    meia tela por equipe e nao respondiam a pergunta
                                    ("a manha esta cheia?"). A regua responde; os
                                    numeros continuam escritos embaixo. */}
                                <td className="px-3 py-2.5">
                                  {e.periodos?.length
                                    ? <FaixaPeriodos periodos={e.periodos} />
                                    : <span className="text-graf-600">—</span>}
                                </td>

                                {/* Seis etiquetas do mesmo tamanho para 163 e 17
                                    fazem os dois numeros parecerem vizinhos. A barra
                                    poe cada um no seu tamanho; a contagem embaixo
                                    continua exata, na ordem do maior para o menor. */}
                                <td className="px-3 py-2.5">
                                  {e.situacoes?.length ? (
                                    <div className="min-w-44 max-w-64 space-y-1.5">
                                      <BarraComposicao fatias={[...e.situacoes]
                                        .sort((a, b) => b.qtd - a.qtd)
                                        .map(s => ({
                                          chave: s.situacao,
                                          rotulo: SITUACAO_INFO[s.situacao]?.label ?? s.situacao,
                                          cor: SITUACAO_INFO[s.situacao]?.cor ?? '#64748b',
                                          qtd: s.qtd,
                                        }))} />
                                      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px]">
                                        {[...e.situacoes].sort((a, b) => b.qtd - a.qtd).map(s => (
                                          <span key={s.situacao}
                                            className="inline-flex items-center gap-1 text-graf-400">
                                            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full"
                                              style={{ background:
                                                SITUACAO_INFO[s.situacao]?.cor ?? '#64748b' }} />
                                            <span className="tabular font-semibold text-graf-200">
                                              {s.qtd}
                                            </span>
                                            {(SITUACAO_INFO[s.situacao]?.label ?? s.situacao).toLowerCase()}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : <span className="text-graf-600">—</span>}
                                </td>

                                <td className="px-3 py-2.5 text-xs">
                                  {e.ocioso ? (
                                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5
                                                     font-semibold text-amber-300">
                                      OCIOSO {e.minutos_parada}min
                                    </span>
                                  ) : e.ultima_atividade ? (
                                    <span className="tabular text-graf-400">
                                      {hora(e.ultima_atividade)}
                                      {e.situacao_final && (
                                        <span className="ml-1.5 text-graf-500">
                                          {SITUACAO_INFO[e.situacao_final]?.label}
                                        </span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-graf-600">sem encerramento</span>
                                  )}
                                </td>
                              </tr>

                              {exp && (
                                <tr className="border-b border-graf-800 bg-graf-900">
                                  {/* Mesma linha da tela de Serviços. Só a
                                      coluna Equipe sai — aqui ela repetiria o
                                      cabeçalho em cada linha. A Data fica: o
                                      painel é por dia, mas quem olha o contrato
                                      quer ver a data escrita nele (D-095). */}
                                  <td colSpan={7} className="p-0">
                                    {/* A gaveta e da EQUIPE: o trilho vermelho a
                                        esquerda amarra o painel a linha que o abriu,
                                        em vez de mais uma tabela colada no meio da
                                        outra. E ela rola por dentro -- SEM-LOGIN tem
                                        270 contratos, e despejar 270 linhas no meio
                                        da pagina empurra as outras equipes para
                                        fora do mundo. */}
                                    <div className="sobe border-y border-graf-800"
                                      style={{ boxShadow: 'inset 3px 0 0 0 var(--color-af-500)' }}>
                                      <div className="quadro"
                                        style={{ ['--quadro-altura' as string]: '26rem' }}>
                                      <TabelaContratos
                                        linhas={detalhe[e.equipe_id] ?? []}
                                        colunas={{ equipe: false }}
                                        pontos={pontos}
                                        porIndicador={porIndicador}
                                        carregando={carregandoDetalhe === e.equipe_id}
                                        aoAbrir={v => setModal(v.id)}
                                        aoMenuContexto={(v, ev) => {
                                          setMenu(menu === v.id ? null : v.id)
                                          setMenuXY({ x: ev.clientX, y: ev.clientY })
                                        }}
                                        vazio={
                                          <p className="px-3 py-6 text-center text-xs text-graf-500">
                                            Nenhum contrato para esta equipe em{' '}
                                            {new Date(data + 'T12:00').toLocaleDateString('pt-BR')}.
                                          </p>
                                        }
                                        renderAcoes={v => (<>
                                          <div className="flex items-center justify-end gap-1">
                                            <Link to={`/controle/visita/${v.id}`}
                                              onClick={ev => ev.stopPropagation()}
                                              className="rounded border border-graf-700 px-2 py-0.5
                                                         text-[11px] text-graf-400
                                                         hover:border-af-600 hover:text-af-400">
                                              abrir
                                            </Link>
                                            <button
                                              onClick={ev => {
                                                ev.stopPropagation()
                                                setMenu(menu === v.id ? null : v.id)
                                                setMenuXY({ x: ev.clientX, y: ev.clientY })
                                              }}
                                              title="Ações do contrato"
                                              className="rounded border border-graf-700 px-1.5 py-0.5
                                                         text-[11px] leading-none text-graf-400
                                                         hover:border-af-600 hover:text-af-400">
                                              ⋯
                                            </button>
                                          </div>

                                          {menu === v.id && (
                                            <div onClick={ev => ev.stopPropagation()}
                                              style={menuXY ? {
                                                left: Math.min(menuXY.x, window.innerWidth - 230),
                                                top: Math.min(menuXY.y, window.innerHeight - 250),
                                              } : undefined}
                                              className="fixed z-50 w-52 overflow-hidden rounded-lg
                                                         border border-graf-700 bg-graf-900
                                                         text-left shadow-xl">
                                              <Link to={`/controle/visita/${v.id}`}
                                                className="block px-3 py-2 text-xs text-graf-200
                                                           hover:bg-graf-800">
                                                Abrir contrato
                                              </Link>
                                              <button
                                                onClick={() => { setModal(v.id); setMenu(null) }}
                                                className="block w-full px-3 py-2 text-left text-xs
                                                           text-graf-200 hover:bg-graf-800">
                                                Marcadores…
                                              </button>
                                              <button
                                                onClick={() => { setModal(v.id); setMenu(null) }}
                                                disabled={v.ordem_servico.length === 0}
                                                className="block w-full px-3 py-2 text-left text-xs
                                                           text-graf-200 hover:bg-graf-800
                                                           disabled:opacity-40">
                                                Baixar serviço…
                                              </button>
                                              <button
                                                onClick={() => { setModal(v.id); setMenu(null) }}
                                                className="block w-full px-3 py-2 text-left text-xs
                                                           text-graf-200 hover:bg-graf-800">
                                                Transferir equipe…
                                              </button>
                                              <button
                                                onClick={() => { setModal(v.id); setMenu(null) }}
                                                className="block w-full border-t border-graf-800
                                                           px-3 py-2 text-left text-xs text-af-300
                                                           hover:bg-af-900/20">
                                                Apagar do banco…
                                              </button>
                                            </div>
                                          )}
                                        </>)}
                                      />
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )
        ) : null}

        {/* ====== o que espera cadastro ======
            No fim da página, e não no topo: quem abre Equipes vem ver
            o dia das equipes que EXISTEM. A fila de cadastro é trabalho
            de fundo — importa, aparece, mas não empurra o painel para
            fora da primeira tela. */}
        {/* ====== logins sem dono ======
            O contrato só vai para uma equipe quando alguém diz de quem é
            o login. Até lá fica em "Sem login definido", visível, em vez
            de a gente adivinhar pela matrícula e acertar calado. */}
        {semDono.length > 0 && (
          <section className="rounded-lg border border-amber-700/60 bg-amber-900/15 p-4">
            <h2 className="font-medium text-amber-200">
              {semDono.length} login(s) sem equipe definida
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-amber-200/80">
              Os contratos desses logins estão em{' '}
              <strong>Sem login definido</strong> e ficam fora da produtividade até
              alguém dizer de quem é cada um. O nome ao lado do login é o{' '}
              <strong>Recurso do TOA</strong> — quem estava logado, segundo a
              própria planilha. A equipe, quem diz é você.
            </p>

            <div className="mt-3 space-y-1.5">
              {semDono.map(l => {
                const escolhida = equipeDoLogin[l.login] ?? ''
                return (
                  <div key={l.login}
                    className="rounded-md border border-amber-800/50 bg-graf-900 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="tabular font-semibold">{l.login}</span>
                      {/* Quem o TOA diz que estava logado. Não decide a
                          equipe — diz de quem é o login, que é a pergunta
                          que trava o cadastro. */}
                      {l.nome_toa ? (
                        <span className="text-xs text-graf-300">
                          {l.nome_toa}
                          <span className="ml-1 rounded bg-graf-800 px-1 text-[9px]
                                           font-semibold uppercase text-graf-400">
                            no TOA
                          </span>
                        </span>
                      ) : (
                        <span title="A planilha importada não trazia a coluna Recurso"
                          className="text-xs text-graf-600">nome não veio na planilha</span>
                      )}
                      <span className="text-graf-400">{l.visitas} visitas</span>
                      <span className="text-xs text-graf-600">
                        {new Date(l.primeira + 'T12:00').toLocaleDateString('pt-BR')}
                        {l.primeira !== l.ultima &&
                          ` a ${new Date(l.ultima + 'T12:00').toLocaleDateString('pt-BR')}`}
                      </span>

                      <select value={escolhida} className={`${sel} ml-auto w-56`}
                        onChange={e => setEquipeDoLogin(v =>
                          ({ ...v, [l.login]: e.target.value }))}>
                        <option value="">— escolha a equipe —</option>
                        {painel
                          .filter(e => e.codigo !== 'SEM-LOGIN')
                          .map(e => (
                            <option key={e.equipe_id} value={e.equipe_id}>
                              {equipeRotulo(e.codigo, e.nome)}
                            </option>
                          ))}
                      </select>

                      <button disabled={ocupado || !escolhida}
                        onClick={() => cadastrarLogin(l.login, escolhida)}
                        className="rounded-md bg-af-600 px-3 py-1 text-xs font-medium
                                   text-white hover:bg-af-500 disabled:opacity-40">
                        é desta equipe
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {orfaos.length > 0 && (
          <section className="rounded-lg border border-amber-700/60 bg-amber-900/15 p-4">
            <h2 className="font-medium text-amber-200">
              {orfaos.length} técnico(s) trabalhando em campo e fora do cadastro
            </h2>
            <p className="mt-1 text-sm text-amber-200/80">
              Apareceram no TOA executando <strong>{totalOrfaos} visitas</strong>, mas não
              estão na planilha de equipes. Enquanto isso, essas visitas ficam sem equipe
              e fora da produtividade.
            </p>
            <div className="mt-3 space-y-1.5">
              {orfaos.map(o => (
                <div key={o.matricula}
                  className="rounded-md border border-amber-800/50 bg-graf-900 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="tabular font-semibold">{o.matricula}</span>
                    <span className="text-graf-400">{o.visitas} visitas</span>
                    <span className="text-xs text-graf-500">
                      {new Date(o.primeira + 'T12:00').toLocaleDateString('pt-BR')}
                      {o.primeira !== o.ultima &&
                        ` a ${new Date(o.ultima + 'T12:00').toLocaleDateString('pt-BR')}`}
                    </span>
                    {o.equipes_sugeridas && (
                      <span className="text-xs text-graf-500">área {o.equipes_sugeridas}</span>
                    )}
                    <button
                      onClick={() => { setCadastrando(cadastrando === o.matricula ? null : o.matricula); setNomeNovo('') }}
                      className="ml-auto rounded-md bg-af-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-af-500">
                      {cadastrando === o.matricula ? 'Cancelar' : 'Cadastrar'}
                    </button>
                  </div>

                  {cadastrando === o.matricula && (
                    <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-graf-800 pt-2.5">
                      <div className="min-w-48 flex-1">
                        <label className="mb-1 block text-[11px] text-graf-400">Nome</label>
                        <input value={nomeNovo} onChange={e => setNomeNovo(e.target.value)}
                          placeholder={o.matricula} autoFocus
                          className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm" />
                      </div>
                      <div className="min-w-40">
                        <label className="mb-1 block text-[11px] text-graf-400">Equipe</label>
                        <select value={equipeNova} onChange={e => setEquipeNova(e.target.value)}
                          className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm">
                          <option value="">Sem equipe por enquanto</option>
                          {painel.map(e => (
                            <option key={e.equipe_id} value={e.equipe_id}>
                              {e.codigo} · {e.area ?? '—'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button disabled={ocupado} onClick={() => cadastrarAvulso(o.matricula)}
                        className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white
                                   hover:bg-emerald-500 disabled:opacity-50">
                        {ocupado ? 'Salvando…' : 'Salvar e religar visitas'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}


        <p className="pb-6 text-center text-xs text-graf-600">
          {aba === 'equipes'
            ? `${eqFiltradas.length} de ${painel.length} equipes${
                data ? ' · ' + new Date(data + 'T12:00').toLocaleDateString('pt-BR') : ''}`
            : `${tecFiltrados.length} de ${tecnicos.length} técnicos`}
          {aba === 'equipes' && !ehHoje &&
            ' · OCIOSO só é calculado para o dia corrente'}
        </p>
      </div>

      {modal && (
        <ContratoModal
          id={modal}
          indicadores={indicadores}
          codigos={codigos}
          conjunto={conjunto}
          equipes={equipesLista}
          pontos={pontos.get(modal) ?? null}
          onFechar={() => setModal(null)}
          onMudou={() => { setDetalhe({}); recarregar() }}
        />
      )}
    </Shell>
  )
}
