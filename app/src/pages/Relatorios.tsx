import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase, naCidade, SITUACOES, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { carregarLocais, type LocalBaixa } from '../lib/localBaixa'
import {
  SELECT_RELATORIO, porContrato, porOS, paraCSV, supervisorDe,
  type VisitaLinha, type PontoVisita, type Indicador,
} from '../lib/relatorio'
import { Shell } from '../components/Shell'
import { Alerta, CarregandoBloco } from '../components/ui'
import { isoLocal } from '../lib/formato'
import { useAuth } from '../lib/auth'
import { carregarCidades, type Cidade } from '../lib/cidade'
import { linhasHumor, type HumorLinha } from '../lib/relatorioHumor'
import { linhasMiscelanea, type MiscelaneaLinha } from '../lib/relatorioMiscelanea'

/**
 * Relatórios — por contrato, por O.S., miscelânea e o humor das equipes.
 *
 * A montagem das linhas mora em `lib/relatorio.ts`; aqui é só a tela:
 * período, cidades, filtros, o download e o histórico.
 *
 * ┌─ D-259 · nada carrega ao mexer nos filtros; o peso é no "Baixar" ──┐
 * │ > "quando eu selecionar as datas, supervisores, ou algo do tipo o  │
 * │ >  sistema não deve carregar na hora (...) tirar a prévia (...)    │
 * │ >  colocar o status dos download, login que fez o download, igual  │
 * │ >  o da importação (...) animação (...) a % de carregamento (...)  │
 * │ >  campo cidade conforme a permissão de login" — Emanuel, 02/11    │
 * │                                                                      │
 * │ Antes, cada data ou filtro relia o período inteiro (e os filtros de │
 * │ equipe/supervisor saíam desses dados). Agora as listas de filtro    │
 * │ vêm do cadastro, leves, das cidades marcadas; o período só é lido   │
 * │ no clique, com a % de verdade (contagem antes, página a página      │
 * │ depois). Cidades: as que o login acessa (`minhas_cidades`); várias  │
 * │ saem num arquivo só (escolha do Emanuel), cada uma lida pelo        │
 * │ cliente da cidade (`naCidade`, cabeçalho x-afline-cidade, 167) —    │
 * │ sem trocar a cidade do topo. Cada download vira uma linha em        │
 * │ `relatorio_download` (172), gravada pelo servidor.                  │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 150: a aba Humor só aparece para quem tem `campo.humor` (é dado
 * sensível de empregado). 162: as leituras PAGINAM — o PostgREST devolve
 * no máximo mil linhas por pedido (D-221).
 */

const PAGINA = 1000
/** Teto de segurança: 50 mil linhas por cidade, muito acima de um mês real. */
const MAX_PAGINAS = 50
/** GERANDO há mais que isto é download que a pessoa largou (fechou a aba). */
const INTERROMPIDO_MS = 30 * 60_000
/** D-260: até 3 meses para todos; só este login passa disso (Emanuel, 02/11).
 *  Quem decide é o banco (iniciar_download_relatorio); a tela só avisa antes. */
const LOGIN_SEM_LIMITE = 'admin@afline.com.br'
/** Fôlego entre páginas de um pedido grande, e o intervalo do sinal de vida. */
const FOLEGO_GRANDE_MS = 200
const SINAL_MS = 20_000
const passaDe3Meses = (de: string, ate: string) => {
  const [a, m, d] = de.split('-').map(Number)
  const limite = new Date(a, m - 1 + 3, d)
  return new Date(ate + 'T00:00:00') > limite
}

type Tipo = 'contrato' | 'os' | 'miscelanea' | 'humor'
const ROTULO_TIPO: Record<Tipo, string> = {
  contrato: 'Por contrato', os: 'Por O.S.', miscelanea: 'Miscelânea', humor: 'Humor das equipes',
}
const TIPO_BANCO: Record<Tipo, string> = { contrato: 'CONTRATO', os: 'OS', miscelanea: 'MISCELANEA', humor: 'HUMOR' }

class Cancelado extends Error { constructor() { super('Cancelado.') } }

/**
 * Pede de mil em mil até o lote vir menor. Passar do teto é ERRO, não
 * corte calado: um relatório pela metade é pior que nenhum.
 */
async function paginar<T>(
  pedir: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  cancelado: () => boolean,
  aoLote?: (n: number) => void,
  folegoMs = 0,
): Promise<T[]> {
  const tudo: T[] = []
  for (let p = 0; p < MAX_PAGINAS; p++) {
    if (cancelado()) throw new Cancelado()
    // D-260: o pedido grande respira entre as páginas, para o banco atender
    // quem baixa o próprio dia ao mesmo tempo
    if (p > 0 && folegoMs) await new Promise(r => setTimeout(r, folegoMs))
    const { data, error } = await pedir(p * PAGINA, (p + 1) * PAGINA - 1)
    if (error) throw new Error(error.message)
    const lote = (data ?? []) as T[]
    tudo.push(...lote)
    aoLote?.(lote.length)
    if (lote.length < PAGINA) return tudo
  }
  throw new Error(`Período grande demais (mais de ${PAGINA * MAX_PAGINAS} linhas numa cidade). Escolha um intervalo menor.`)
}

/** "PulsoLine_por-contrato_02-11-2026_15h42m07s" — o dia, o mês, o ano e a
 *  hora do download, para nunca sobrescrever o anterior (D-259). */
function nomeDoArquivo(tipo: Tipo, quando: Date): string {
  const d = (n: number) => String(n).padStart(2, '0')
  const slug = ROTULO_TIPO[tipo].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `PulsoLine_${slug}_${d(quando.getDate())}-${d(quando.getMonth() + 1)}-${quando.getFullYear()}`
    + `_${d(quando.getHours())}h${d(quando.getMinutes())}m${d(quando.getSeconds())}s`
}

interface Download {
  id: string; tipo: string; formato: string; de: string; ate: string
  cidades_nomes: string | null; arquivo: string | null; linhas: number | null; colunas: number | null
  status: 'NA_FILA' | 'GERANDO' | 'CONCLUIDO' | 'ERRO' | 'CANCELADO'; mensagem: string | null
  iniciado_em: string; concluido_em: string | null
  usuario: { nome: string | null } | null
}

const ESTADO: Record<string, { texto: string; classe: string }> = {
  NA_FILA:      { texto: 'Na fila',      classe: 'bg-violet-900/40 text-violet-300' },
  GERANDO:      { texto: 'Gerando',      classe: 'bg-sky-900/40 text-sky-300' },
  CONCLUIDO:    { texto: 'Concluído',    classe: 'bg-emerald-900/40 text-emerald-300' },
  SEM_LINHAS:   { texto: 'Sem linhas',   classe: 'bg-graf-800 text-graf-300' },
  ERRO:         { texto: 'Erro',         classe: 'bg-af-900/40 text-af-300' },
  CANCELADO:    { texto: 'Cancelado',    classe: 'bg-amber-900/40 text-amber-300' },
  INTERROMPIDO: { texto: 'Interrompido', classe: 'bg-amber-900/40 text-amber-300' },
}
const TIPO_LEGIVEL: Record<string, string> = {
  CONTRATO: 'Por contrato', OS: 'Por O.S.', MISCELANEA: 'Miscelânea', HUMOR: 'Humor',
}
const quando = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
const diaBr = (iso: string) => iso.split('-').reverse().join('/').slice(0, 5)

export default function Relatorios() {
  const { pode } = useAuth()
  const podeHumor = pode('campo.humor')

  const [de, setDe] = useState(isoLocal())
  const [ate, setAte] = useState(isoLocal())
  const [tipo, setTipo] = useState<Tipo>('contrato')
  const [formato, setFormato] = useState<'xlsx' | 'csv'>('xlsx')
  const [erro, setErro] = useState<string | null>(null)
  const [semLimite, setSemLimite] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) =>
      setSemLimite((data.session?.user.email ?? '').toLowerCase() === LOGIN_SEM_LIMITE))
  }, [])

  // cidades: as que o login acessa; abre marcada a cidade ativa
  const [cidades, setCidades] = useState<Cidade[]>([])
  const [marcadas, setMarcadas] = useState<string[]>([])
  useEffect(() => {
    carregarCidades().then(cs => {
      setCidades(cs)
      const ativa = cs.find(c => c.ativa) ?? (cs.length === 1 ? cs[0] : null)
      setMarcadas(ativa ? [ativa.id] : [])
    })
  }, [])

  // filtros
  const [equipes, setEquipes] = useState<string[]>([])
  const [grupos, setGrupos] = useState<string[]>([])
  const [situacoes, setSituacoes] = useState<Situacao[]>([])
  const [supervisores, setSupervisores] = useState<string[]>([])
  const [semJornada, setSemJornada] = useState(true)
  /** 109: separar as adesões GPON (Emanuel, 19/10). */
  const [tecnologia, setTecnologia] = useState<'TODAS' | 'GPON' | 'SEM'>('TODAS')

  // As LISTAS dos filtros vêm do cadastro das cidades marcadas — leve, e
  // não depende do período (D-259: nada pesado carrega ao mexer).
  const [opcoes, setOpcoes] = useState<{ equipes: string[]; grupos: string[]; supers: string[] }>(
    { equipes: [], grupos: [], supers: [] })
  useEffect(() => {
    if (!marcadas.length) { setOpcoes({ equipes: [], grupos: [], supers: [] }); return }
    let vivo = true
    Promise.all([
      ...marcadas.map(id => naCidade(id).from('equipe')
        .select('codigo, supervisor_nome, supervisor:supervisor_id ( nome )')),
      ...marcadas.map(id => naCidade(id).from('tecnico').select('supervisor:supervisor_id ( nome )')),
    ]).then(async rs => {
      const { data: ts } = await supabase.from('tipo_servico').select('nome').order('nome')
      if (!vivo) return
      const eqs = rs.slice(0, marcadas.length).flatMap(r => (r.data ?? []) as unknown as
        { codigo: string | null; supervisor_nome: string | null; supervisor: { nome: string } | null }[])
      const tecs = rs.slice(marcadas.length).flatMap(r => (r.data ?? []) as unknown as
        { supervisor: { nome: string } | null }[])
      // D-260: os nomes que podem sair na coluna Supervisor (supervisorDe)
      const supers = [...tecs.map(t => t.supervisor?.nome), ...eqs.map(e => e.supervisor?.nome ?? e.supervisor_nome)]
      setOpcoes({
        equipes: [...new Set(eqs.map(e => e.codigo).filter(Boolean) as string[])].sort(),
        supers: [...new Set(supers.filter(Boolean) as string[])].sort(),
        grupos: ((ts ?? []) as { nome: string }[]).map(t => t.nome),
      })
    })
    return () => { vivo = false }
  }, [marcadas])

  // ---------- o histórico ----------
  const [historico, setHistorico] = useState<Download[] | null>(null)
  const recarregarHistorico = useCallback(async () => {
    const { data, error } = await supabase.from('relatorio_download')
      .select(`id, tipo, formato, de, ate, cidades_nomes, arquivo, linhas, colunas, status,
               mensagem, iniciado_em, concluido_em, usuario:usuario_id ( nome )`)
      .order('iniciado_em', { ascending: false }).limit(30)
    if (!error) setHistorico((data ?? []) as unknown as Download[])
  }, [])
  useEffect(() => { recarregarHistorico() }, [recarregarHistorico])

  // ---------- o download ----------
  const [progresso, setProgresso] = useState<{ pct: number; texto: string; fila?: boolean } | null>(null)
  const cancelar = useRef(false)
  const gerando = progresso !== null

  // Sair da tela no meio perde o arquivo: o navegador pergunta antes.
  useEffect(() => {
    if (!gerando) return
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [gerando])

  async function gerar() {
    if (!marcadas.length || !de || !ate || de > ate) return
    if (!semLimite && passaDe3Meses(de, ate)) { setErro('O período máximo é de 3 meses.'); return }
    setErro(null)
    cancelar.current = false
    const agora = new Date()
    const nome = nomeDoArquivo(tipo, agora)
    const arquivo = `${nome}.${formato}`
    const sel = cidades.filter(c => marcadas.includes(c.id))
    const filtros = { equipes, grupos, supervisores, situacoes, tecnologia, semJornada }

    // A contagem vem ANTES do registro: é ela que diz se o pedido é grande
    // (vai para a fila) — D-260. Contar é leve (só o número).
    setProgresso({ pct: 0, texto: 'Contando os contratos…' })
    let contagens: { count: number | null }[] = []
    if (tipo === 'contrato' || tipo === 'os') {
      const rs = await Promise.all(sel.map(c => naCidade(c.id).from('visita')
        .select('id', { count: 'exact', head: true })
        .is('excluido_em', null).gte('data_agendada', de).lte('data_agendada', ate)))
      const erroContagem = rs.find(r => r.error)?.error
      if (erroContagem) { setErro(erroContagem.message); setProgresso(null); return }
      contagens = rs
    }
    const totalContado = contagens.reduce((s2, r) => s2 + (r.count ?? 0), 0)

    setProgresso({ pct: 0, texto: 'Registrando o download…' })
    const { data: ini, error: erroInicio } = await supabase.rpc('iniciar_download_relatorio', {
      p_tipo: TIPO_BANCO[tipo], p_formato: formato.toUpperCase(), p_de: de, p_ate: ate,
      p_cidades: sel.map(c => c.id), p_filtros: filtros, p_arquivo: arquivo,
      p_contratos: contagens.length ? totalContado : null,
    })
    if (erroInicio) { setErro(erroInicio.message); setProgresso(null); return }
    const { id: idDownload, pesado } = ini as { id: string; status: string; pesado: boolean }
    recarregarHistorico()

    const fim = async (status: 'CONCLUIDO' | 'ERRO' | 'CANCELADO', linhas?: number, colunas?: number, mensagem?: string) => {
      await supabase.rpc('concluir_download_relatorio', {
        p_id: idDownload, p_status: status, p_linhas: linhas ?? null, p_colunas: colunas ?? null,
        p_mensagem: mensagem ?? null,
      })
      recarregarHistorico()
    }
    const parou = () => cancelar.current
    const folego = pesado ? FOLEGO_GRANDE_MS : 0
    let sinal: ReturnType<typeof setInterval> | null = null

    try {
      // D-260: pedido grande espera a vez — um grande por vez na empresa.
      if (pesado) {
        for (;;) {
          if (parou()) throw new Cancelado()
          const { data: v, error: ev } = await supabase.rpc('vez_do_download', { p_id: idDownload })
          if (ev) throw new Error(ev.message)
          const vez = v as { vez: boolean; posicao?: number; status: string }
          if (vez.status === 'FIM') throw new Error('O pedido saiu da fila.')
          if (vez.vez) break
          setProgresso({ pct: 0, fila: true,
            texto: `Na fila dos downloads grandes: posição ${vez.posicao ?? '?'}. Começa sozinho quando chegar a vez.` })
          await new Promise(r => setTimeout(r, 3000))
        }
        // o sinal de vida enquanto gera: sem ele, a vez é dada como largada
        sinal = setInterval(() => { supabase.rpc('vez_do_download', { p_id: idDownload }) }, SINAL_MS)
      }

      let montado: string[][]
      if (tipo === 'contrato' || tipo === 'os') {
        // A % é de verdade: a contagem já veio; cada visita "custa" 3
        // (a linha, os pontos, o local da baixa).
        const total = Math.max(1, totalContado)
        let feito = 0
        const avancar = (n: number, texto: string) => {
          feito += n
          setProgresso({ pct: Math.min(95, 2 + Math.round((feito / (total * 3)) * 93)), texto })
        }

        const linhas: VisitaLinha[] = []
        const pontos = new Map<string, PontoVisita>()
        const locais = new Map<string, LocalBaixa>()
        for (const [i, c] of sel.entries()) {
          const cli = naCidade(c.id)
          const daCidade = contagens[i].count ?? 0
          let lidas = 0
          const ls = await paginar<VisitaLinha>((a, b) => cli.from('visita').select(SELECT_RELATORIO)
            .is('excluido_em', null).gte('data_agendada', de).lte('data_agendada', ate)
            .order('data_agendada').order('janela_inicio', { nullsFirst: false }).order('id')
            .range(a, b), parou, n => { lidas += n; avancar(n, `${c.nome}: ${lidas} de ${daCidade} contratos`) }, folego)
          const ps = await paginar<PontoVisita>((a, b) => cli.rpc('pontos_por_periodo', { p_de: de, p_ate: ate })
            .order('visita_id').range(a, b), parou, n => avancar(n, `${c.nome}: pontuação`), folego)
          // a pontuação pode vir com menos linhas que as visitas: completa a parte dela
          avancar(Math.max(0, ls.length - ps.length), `${c.nome}: pontuação`)
          if (parou()) throw new Cancelado()
          let ultimo = 0
          const ms = await carregarLocais(ls.map(l => l.id), cli,
            f => { avancar(f - ultimo, `${c.nome}: local da baixa`); ultimo = f })
          avancar(ls.length - ultimo, `${c.nome}: local da baixa`)
          linhas.push(...ls)
          for (const x of ps) pontos.set(x.visita_id, x)
          for (const [k, v] of ms) locais.set(k, v)
        }
        if (parou()) throw new Cancelado()
        const { data: ind } = await supabase.from('indicador_qualidade').select('id, nome').eq('ativo', true).order('ordem')
        const filtradas = linhas.filter(l => {
          if (semJornada && l.tipo_atividade?.natureza === 'JORNADA') return false
          if (equipes.length && !equipes.includes(l.equipe?.codigo ?? '')) return false
          if (grupos.length && !grupos.includes(l.tipo_servico?.nome ?? '')) return false
          if (supervisores.length && !supervisores.includes(supervisorDe(l) ?? '')) return false
          if (situacoes.length && !situacoes.includes(l.situacao)) return false
          if (tecnologia === 'GPON' && l.tecnologia !== 'GPON') return false
          if (tecnologia === 'SEM' && l.tecnologia === 'GPON') return false
          return true
        })
        montado = tipo === 'contrato'
          ? porContrato(filtradas, pontos, (ind ?? []) as Indicador[], locais)
          : porOS(filtradas, pontos, (ind ?? []) as Indicador[], locais)
      } else if (tipo === 'miscelanea') {
        const itens: MiscelaneaLinha[] = []
        for (const [i, c] of sel.entries()) {
          setProgresso({ pct: Math.round(2 + (i / sel.length) * 90), texto: `${c.nome}: miscelânea` })
          itens.push(...await paginar<MiscelaneaLinha>(
            (a, b) => naCidade(c.id).rpc('relatorio_miscelanea', { p_de: de, p_ate: ate }).range(a, b), parou, undefined, folego))
        }
        // Os filtros de cima valem também para a miscelânea — exceto jornada e
        // tecnologia, que são da visita e não vêm na linha do item.
        montado = linhasMiscelanea(itens.filter(l => {
          if (equipes.length && !equipes.includes(l.equipe ?? '')) return false
          if (grupos.length && !grupos.includes(l.grupo_servico ?? '')) return false
          if (supervisores.length && !supervisores.includes(l.supervisor ?? '')) return false
          if (situacoes.length && !situacoes.includes(l.situacao as Situacao)) return false
          return true
        }))
      } else {
        const hs: HumorLinha[] = []
        for (const [i, c] of sel.entries()) {
          if (parou()) throw new Cancelado()
          setProgresso({ pct: Math.round(2 + (i / sel.length) * 90), texto: `${c.nome}: humor das equipes` })
          const { data, error } = await naCidade(c.id).rpc('humor_das_equipes', { p_de: de, p_ate: ate })
          if (error) throw new Error(error.message)
          hs.push(...((data ?? []) as HumorLinha[]))
        }
        montado = linhasHumor(hs)
      }

      if (parou()) throw new Cancelado()
      const totalLinhas = montado.length - 1
      const colunas = montado[0]?.length ?? 0
      if (totalLinhas <= 0) {
        await fim('CONCLUIDO', 0, colunas, 'Nenhuma linha para estes filtros — arquivo não gerado.')
        setErro('Nenhuma linha para estes filtros e cidades no período — o arquivo não foi gerado.')
        return
      }
      setProgresso({ pct: 97, texto: `Montando o arquivo (${totalLinhas} linhas)…` })
      await new Promise(r => setTimeout(r, 30))   // deixa a barra desenhar antes do trabalho pesado
      if (formato === 'csv') {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(paraCSV(montado))
        a.download = arquivo
        a.click(); URL.revokeObjectURL(a.href)
      } else {
        const ws = XLSX.utils.aoa_to_sheet(montado)
        // Sem largura mínima o Excel abre 60 colunas de 8 caracteres e nada
        // é legível. Largura pela maior célula, com teto.
        ws['!cols'] = montado[0].map((_, j) => ({
          wch: Math.min(42, Math.max(10, ...montado.slice(0, 200).map(l => String(l[j] ?? '').length + 2))),
        }))
        ws['!freeze'] = { xSplit: 0, ySplit: 1 }
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, ROTULO_TIPO[tipo])
        XLSX.writeFile(wb, arquivo)
      }
      setProgresso({ pct: 100, texto: `Pronto: ${arquivo}` })
      await fim('CONCLUIDO', totalLinhas, colunas)
      await new Promise(r => setTimeout(r, 900))
    } catch (e) {
      if (e instanceof Cancelado) await fim('CANCELADO', undefined, undefined, 'Cancelado por quem pediu.')
      else {
        const msg = e instanceof Error ? e.message : String(e)
        setErro(msg)
        await fim('ERRO', undefined, undefined, msg)
      }
    } finally {
      if (sinal) clearInterval(sinal)
      setProgresso(null)
    }
  }

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs'
  const multi = (valores: string[], setar: (v: string[]) => void, opts: string[]) => (
    <select multiple value={valores} disabled={gerando} className={`${sel} h-24 w-full`}
      onChange={e => setar([...e.target.selectedOptions].map(o => o.value))}>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
  const acimaDoLimite = !semLimite && !!de && !!ate && passaDe3Meses(de, ate)
  const periodoInvalido = !de || !ate || de > ate || acimaDoLimite

  return (
    <Shell>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Relatórios</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            <strong>Por contrato</strong> dá uma linha por visita — é a leitura de
            deslocamento, janela e pontuação. <strong>Por O.S.</strong> dá uma linha por
            ordem, com o contrato repetido — é a leitura de baixa e faturamento, e
            marca qual O.S. foi a primeira do endereço.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        <section className="card-controle space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-graf-400">
              <span className="mb-1 block">De</span>
              <input type="date" value={de} disabled={gerando} onChange={e => setDe(e.target.value)}
                className={`tabular ${sel}`} />
            </label>
            <label className="text-xs text-graf-400">
              <span className="mb-1 block">Até</span>
              <input type="date" value={ate} disabled={gerando} onChange={e => setAte(e.target.value)}
                className={`tabular ${sel}`} />
            </label>

            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Tipo de relatório</span>
              <div className="flex rounded-md bg-graf-900 p-0.5">
                {(['contrato', 'os', 'miscelanea', ...(podeHumor ? ['humor' as const] : [])] as Tipo[]).map(t => (
                  <button key={t} onClick={() => setTipo(t)} disabled={gerando}
                    className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                      tipo === t ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                    {ROTULO_TIPO[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Formato</span>
              <div className="flex rounded-md bg-graf-900 p-0.5">
                {([['xlsx', 'Excel'], ['csv', 'CSV']] as const).map(([f, rot]) => (
                  <button key={f} onClick={() => setFormato(f)} disabled={gerando}
                    className={`rounded px-3 py-1 text-[11px] font-medium transition ${
                      formato === f ? 'bg-af-600 text-white' : 'text-graf-400 hover:text-graf-200'}`}>
                    {rot}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={semJornada} disabled={gerando}
                onChange={e => setSemJornada(e.target.checked)} className="accent-af-600" />
              Ocultar jornada
            </label>

            <button onClick={gerar} disabled={gerando || !marcadas.length || periodoInvalido}
              className="ml-auto rounded-lg bg-af-600 px-5 py-2 text-sm font-semibold text-white
                         hover:bg-af-500 disabled:opacity-50">
              {gerando ? 'Gerando…' : `Baixar ${formato === 'xlsx' ? 'Excel' : 'CSV'}`}
            </button>
          </div>

          {acimaDoLimite && (
            <p className="text-xs text-amber-300">O período máximo é de 3 meses. Diminua o intervalo.</p>
          )}

          {/* D-259: as cidades que ESTE login acessa; várias saem num arquivo só */}
          <div className="border-t border-graf-800 pt-3 text-xs text-graf-400">
            <span className="mb-1.5 block">
              Cidades ({marcadas.length === cidades.length && cidades.length > 1 ? 'todas' : marcadas.length})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {cidades.length > 1 && (
                <button disabled={gerando}
                  onClick={() => setMarcadas(marcadas.length === cidades.length ? [] : cidades.map(c => c.id))}
                  className="rounded-md border border-graf-700 px-2.5 py-1 text-[11px] text-graf-300 hover:border-af-600">
                  {marcadas.length === cidades.length ? 'Desmarcar todas' : 'Marcar todas'}
                </button>
              )}
              {cidades.map(c => {
                const on = marcadas.includes(c.id)
                return (
                  <button key={c.id} disabled={gerando} aria-pressed={on}
                    onClick={() => setMarcadas(on ? marcadas.filter(x => x !== c.id) : [...marcadas, c.id])}
                    className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                      on ? 'border-af-600 bg-af-600/15 text-af-200' : 'border-graf-700 text-graf-400 hover:text-graf-200'}`}>
                    {c.nome}
                  </button>
                )
              })}
            </div>
            {!marcadas.length && <p className="mt-1 text-amber-300">Marque ao menos uma cidade.</p>}
          </div>

          <div className="grid gap-3 border-t border-graf-800 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Equipes ({equipes.length || 'todas'})</span>
              {multi(equipes, setEquipes, opcoes.equipes)}
            </div>
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Tipo de serviço ({grupos.length || 'todos'})</span>
              {multi(grupos, setGrupos, opcoes.grupos)}
              <span className="mb-1 mt-2 block">Tecnologia</span>
              <select value={tecnologia} disabled={gerando}
                onChange={e => setTecnologia(e.target.value as 'TODAS' | 'GPON' | 'SEM')}
                className="w-full rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs outline-none focus:border-af-500">
                <option value="TODAS">Toda tecnologia</option>
                <option value="GPON">Só GPON</option>
                <option value="SEM">Sem GPON identificado</option>
              </select>
            </div>
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Supervisor ({supervisores.length || 'todos'})</span>
              {multi(supervisores, setSupervisores, opcoes.supers)}
            </div>
            <div className="text-xs text-graf-400">
              <span className="mb-1 block">Situação ({situacoes.length || 'todas'})</span>
              <select multiple value={situacoes} disabled={gerando} className={`${sel} h-24 w-full`}
                onChange={e => setSituacoes([...e.target.selectedOptions].map(o => o.value as Situacao))}>
                {SITUACOES.map(s => (
                  <option key={s} value={s}>{SITUACAO_INFO[s]?.label ?? s}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-graf-500">
            Segure Ctrl (ou Cmd) para escolher mais de um. Nada selecionado = todos.
          </p>
        </section>

        {/* ---------- a geração em andamento ---------- */}
        {progresso && (
          <section className="card-controle p-4" aria-live="polite">
            <div className="flex items-center gap-3">
              <span aria-hidden className="inline-block h-4 w-4 shrink-0 rounded-full border-2
                                           border-af-500 border-t-transparent motion-safe:animate-spin" />
              <p className="min-w-0 flex-1 truncate text-sm text-graf-200">{progresso.texto}</p>
              {progresso.fila
                ? <span className="rounded bg-violet-900/40 px-2 py-0.5 text-[11px] font-medium text-violet-300 motion-safe:animate-pulse">na fila</span>
                : <span className="tabular text-sm font-semibold text-af-300">{progresso.pct}%</span>}
              <button onClick={() => { cancelar.current = true }}
                className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-300 hover:border-af-600">
                Cancelar
              </button>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-graf-800"
              role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progresso.pct}>
              <div className="relative h-full rounded-full bg-af-600 transition-[width] duration-500 ease-out"
                style={{ width: `${progresso.pct}%` }}>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent
                                motion-safe:animate-pulse" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-graf-400">Não feche esta tela até terminar.</p>
          </section>
        )}

        {/* ---------- o histórico, como o da importação ---------- */}
        <section className="card-controle overflow-hidden">
          <div className="flex items-center justify-between border-b border-graf-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Histórico de downloads</h2>
              <p className="mt-0.5 text-xs text-graf-400">O que foi baixado, por quem, quando e no que deu.</p>
            </div>
            <button onClick={recarregarHistorico}
              className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-300 hover:border-af-600">
              atualizar
            </button>
          </div>
          {historico === null ? (
            <CarregandoBloco className="px-4 py-8" />
          ) : historico.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-graf-400">Nenhum download ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px] uppercase
                                  tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Arquivo</th>
                    <th className="px-3 py-2 font-medium">Período</th>
                    <th className="px-3 py-2 font-medium">Cidades</th>
                    <th className="px-3 py-2 font-medium">Resultado</th>
                    <th className="px-3 py-2 font-medium">Início</th>
                    <th className="px-3 py-2 font-medium">Conclusão</th>
                    <th className="px-3 py-2 font-medium">Quem</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map(h => {
                    const largado = (h.status === 'GERANDO' || h.status === 'NA_FILA') && Date.now() - new Date(h.iniciado_em).getTime() > INTERROMPIDO_MS
                    const chave = largado ? 'INTERROMPIDO'
                      : h.status === 'CONCLUIDO' && h.linhas === 0 ? 'SEM_LINHAS' : h.status
                    const est = ESTADO[chave]
                    return (
                      <tr key={h.id} className="border-b border-graf-800 align-top">
                        <td className="max-w-64 truncate px-3 py-2 font-mono text-xs" title={h.arquivo ?? ''}>
                          {h.arquivo ?? '—'}
                          <span className="block font-sans text-[11px] text-graf-400">
                            {TIPO_LEGIVEL[h.tipo] ?? h.tipo} · {h.formato === 'XLSX' ? 'Excel' : 'CSV'}
                          </span>
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-300">
                          {h.de === h.ate ? diaBr(h.de) : `${diaBr(h.de)} a ${diaBr(h.ate)}`}
                        </td>
                        <td className="max-w-48 px-3 py-2 text-xs text-graf-300">{h.cidades_nomes ?? '—'}</td>
                        <td className="px-3 py-2 text-xs text-graf-300">
                          {h.linhas != null
                            ? <><span className="tabular">{h.linhas}</span> linhas · <span className="tabular">{h.colunas ?? '—'}</span> colunas</>
                            : <span className="text-graf-400" title={h.mensagem ?? ''}>{h.mensagem ?? '—'}</span>}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">{quando(h.iniciado_em)}</td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">{quando(h.concluido_em)}</td>
                        <td className="px-3 py-2 text-xs text-graf-300">{h.usuario?.nome ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span title={h.mensagem ?? ''}
                            className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium ${est.classe}`}>
                            {(chave === 'GERANDO' || chave === 'NA_FILA') && (
                              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2 border-current
                                                           border-t-transparent motion-safe:animate-spin" />
                            )}
                            {est.texto}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}
