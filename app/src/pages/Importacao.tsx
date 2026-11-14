import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { lerPlanilhaTOA, validarPlanilha, contarOS, semIdDaAtividade, type ResultadoLeitura } from '../lib/toa'
import {
  ETAPAS, importarLinhasToa, reconciliarImportacao, type Resumo, type Desatribuicao,
  type FilaImportacao,
} from '../lib/importarToa'
import { Alerta } from '../components/ui'
import { Shell } from '../components/Shell'
import { isoLocal, dataBR } from '../lib/formato'
import { useCidades, trocarCidade, type Cidade } from '../lib/cidade'

/** De que cidade é o arquivo, pelo bucket do nome (103, D-180). */
interface Origem {
  bucket: string | null; base_id: string | null; cidade: string | null
  acessa: boolean | null; ativo: boolean | null
}

interface CodigoNovo { codigo: number; texto: string; presos: number }

/**
 * ┌─ vários arquivos, uma importação por arquivo ──────────────────────┐
 * │ > "O usuário pode escolher mais de um arquivo para importação, e   │
 * │ >  não apenas um." — Emanuel, 09/11                                │
 * │                                                                    │
 * │ Cada arquivo continua sendo UMA importação: o bucket vem do NOME   │
 * │ de cada um (D-180), e é o bucket que diz a cidade e o que sumiu do │
 * │ TOA (D-191). Elas rodam uma depois da outra, pelo mesmo caminho do │
 * │ arquivo único (`importarLinhasToa`: registrar, linhas, fila da     │
 * │ cidade, `importar_toa`, reconciliação na 2ª chamada — D-181 — e    │
 * │ desatribuição). O dia de atuação escolhido vale para todas. O      │
 * │ arquivo de outra cidade fica de fora sozinho; os outros entram.    │
 * └────────────────────────────────────────────────────────────────────┘
 */
type FaseArq = 'lendo' | 'ilegivel' | 'lida' | 'aguardando' | 'enviando' | 'pronto' | 'falhou'

interface Arq {
  chave: number
  arquivo: File
  fase: FaseArq
  leitura: ResultadoLeitura | null
  problemas: string[]
  origem: Origem | null
  erro: string | null
  resumo: Resumo | null
  /** 116: undefined = ainda não importou; null = a conferência falhou. */
  desatrib: Desatribuicao | null | undefined
  /** Códigos que esta importação trouxe e o cadastro não conhece (108, D-185). */
  codigosNovos: CodigoNovo[]
  /** A reconciliação falhou: os contratos entraram, falta a 2ª parte (104b, D-181). */
  reconciliarPendente: string | null
  /** Andamento visível (D-182). */
  etapa: number
  enviadas: number
  /** 165: na fila da cidade — quem está na frente (nulo = não está esperando). */
  fila: FilaImportacao | null
  inicio: number | null
  /** O dia em que entrou (para o resultado não mudar se a pessoa trocar o dia depois). */
  diaImportado: string | null
}

/**
 * "25/09/26" (como o TOA escreve a coluna Data) → "2026-09-25".
 * Devolve `null` para o que não souber ler — nunca um dia chutado.
 */
function isoDaPlanilha(txt: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec((txt ?? '').trim())
  if (!m) return null
  const ano = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${ano}-${m[2]}-${m[1]}`
}

function ontem(): string {
  const d = new Date(); d.setDate(d.getDate() - 1); return isoLocal(d)
}

/** Os dias que a coluna "Data" traz, com quantas linhas cada. */
function diasDaPlanilha(l: ResultadoLeitura): [string, number][] {
  return Object.entries(l.linhas.reduce<Record<string, number>>((a, x) => {
    const iso = isoDaPlanilha(x['Data']) ?? 'sem data'
    a[iso] = (a[iso] ?? 0) + 1; return a
  }, {})).sort((a, b) => b[1] - a[1])
}

/** O arquivo é da cidade do topo? Falso enquanto a conferência não voltou. */
function origemOk(o: Origem | null, ativa: Cidade | null): boolean {
  return !!o && !!o.bucket && !!o.base_id && !!o.ativo && !!ativa && o.base_id === ativa.id
}

/** Pronto para entrar: lido, com linha, da cidade do topo. A que falhou pode tentar de novo. */
function importavel(a: Arq, ativa: Cidade | null): boolean {
  return (a.fase === 'lida' || a.fase === 'falhou')
    && !!a.leitura && a.leitura.linhas.length > 0 && origemOk(a.origem, ativa)
}

/** Uma linha do histórico — o "log" que o sistema atual mostra. */
interface Historico {
  id: string
  arquivo_nome: string | null
  status: string | null
  total_linhas: number | null
  qtd_criadas: number | null
  qtd_atualizadas: number | null
  qtd_erro: number | null
  qtd_conflito: number | null
  criado_em: string
  aplicado_em: string | null
  data_atuacao: string | null
  erro_mensagem: string | null
  usuario: { nome: string | null; email: string | null } | null
}

/**
 * O estado de uma importação, lido do STATUS (105, D-182) — antes a tela
 * deduzia de `aplicado_em`, e a que falhou ficava "Processando" para sempre.
 * PROCESSANDO há mais de 10 min sem terminar não está processando: a aba de
 * quem importou fechou ou caiu no meio. A tela diz isso.
 */
type EstadoImp = 'sucesso' | 'com_erro' | 'nao_entrou' | 'nao_terminou' | 'processando'
function estadoDa(h: Historico, agora: number): EstadoImp {
  if (h.status === 'ERRO') return 'nao_entrou'
  if (h.aplicado_em || h.status === 'APLICADA') return (h.qtd_erro ?? 0) > 0 ? 'com_erro' : 'sucesso'
  if (agora - new Date(h.criado_em).getTime() > 10 * 60_000) return 'nao_terminou'
  return 'processando'
}
const ROTULO_ESTADO: Record<EstadoImp, { texto: string; classe: string }> = {
  sucesso:      { texto: 'Sucesso',       classe: 'bg-emerald-900/40 text-emerald-300' },
  com_erro:     { texto: 'Com erro',      classe: 'bg-af-900/40 text-af-300' },
  nao_entrou:   { texto: 'Não entrou',    classe: 'bg-af-900/40 text-af-300' },
  nao_terminou: { texto: 'Não terminou',  classe: 'bg-af-900/40 text-af-300' },
  processando:  { texto: 'Processando',   classe: 'bg-amber-900/40 text-amber-300' },
}

const quando = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—'

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

let proximaChave = 1

export default function Importacao() {
  const { perfil, temPapel, pode } = useAuth()
  // 267 (D-382): a tela antecipa a recusa do banco. Sem a permissão, o supervisor levava
  // "violates row-level security" depois de escolher o arquivo e clicar — sem saber por quê.
  const podeImportar = temPapel('ADMIN') || pode('importacao.executar')
  const navegar = useNavigate()
  /**
   * A importação vai para a CIDADE ATIVA do topo — era `'MAN'` escrito à
   * mão, e qualquer arquivo entrava em Manaus. Em 26/09 o único arquivo
   * do dia foi `Atividades-ARN-AFLINE`, e entrou em Manaus (D-180).
   */
  const { ativa } = useCidades()
  const inputRef = useRef<HTMLInputElement>(null)

  const [arqs, setArqs] = useState<Arq[]>([])
  const [rodando, setRodando] = useState(false)
  /** Qual arquivo da rodada está entrando, de quantos. */
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [reconciliando, setReconciliando] = useState<number | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [historico, setHistorico] = useState<Historico[]>([])
  const [agora, setAgora] = useState(Date.now())
  useEffect(() => {
    if (!rodando) return
    const t = setInterval(() => setAgora(Date.now()), 500)
    return () => clearInterval(t)
  }, [rodando])

  /**
   * O dia em que as visitas vão entrar. Nasce HOJE, e só muda quando a
   * pessoa escolhe (090, D-166):
   *
   * > "mesmo que a data esteja diferente, a importação da rota, ele
   * >  precisa ir para o dia atual, so sera importado para o dia
   * >  anterior quando nos escolhermos a data que vamos atuar" — Emanuel
   *
   * A "Data" da planilha não decide nada: aparece em cada arquivo, ao
   * lado, para a diferença ficar à vista antes do clique.
   */
  const [dia, setDia] = useState(isoLocal)

  const atualizar = (chave: number, p: Partial<Arq>) =>
    setArqs(l => l.map(a => a.chave === chave ? { ...a, ...p } : a))

  /** O log de importações: o que subiu, quem subiu, quando e no que deu. */
  async function carregarHistorico() {
    const { data } = await supabase.from('importacao')
      .select(`id, arquivo_nome, status, total_linhas, qtd_criadas, qtd_atualizadas,
               qtd_erro, qtd_conflito, criado_em, aplicado_em, data_atuacao, erro_mensagem,
               usuario:usuario_id ( nome, email )`)
      .order('criado_em', { ascending: false }).limit(30)
    setHistorico((data ?? []) as unknown as Historico[])
  }
  useEffect(() => { carregarHistorico() }, [])

  function receber(lista: FileList | File[]) {
    if (rodando) return
    setErroGeral(null)
    // O mesmo arquivo escolhido duas vezes não vira duas importações.
    const ja = new Set(arqs.map(a => `${a.arquivo.name}|${a.arquivo.size}|${a.arquivo.lastModified}`))
    const novos: Arq[] = []
    for (const f of Array.from(lista)) {
      const k = `${f.name}|${f.size}|${f.lastModified}`
      if (ja.has(k)) continue
      ja.add(k)
      novos.push({
        chave: proximaChave++, arquivo: f, fase: 'lendo', leitura: null, problemas: [],
        origem: null, erro: null, resumo: null, desatrib: undefined, codigosNovos: [],
        reconciliarPendente: null, etapa: 0, enviadas: 0, fila: null, inicio: null,
        diaImportado: null,
      })
    }
    if (!novos.length) return
    setArqs(l => [...l, ...novos])
    for (const a of novos) {
      // O bucket sai do NOME do arquivo — nenhuma coluna da planilha o traz.
      // A tela pergunta antes de subir as linhas; quem barra é o banco
      // (`importar_toa` confere de novo).
      supabase.rpc('cidade_do_arquivo', { p_arquivo: a.arquivo.name }).then(({ data }) => {
        const o = ((data ?? []) as Origem[])[0]
        atualizar(a.chave, { origem: o ?? { bucket: null, base_id: null, cidade: null, acessa: null, ativo: null } })
      })
      lerPlanilhaTOA(a.arquivo).then(
        r => atualizar(a.chave, { leitura: r, problemas: validarPlanilha(r), fase: 'lida' }),
        e => atualizar(a.chave, {
          fase: 'ilegivel', erro: e instanceof Error ? e.message : 'Não consegui ler a planilha.',
        }),
      )
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  async function enviar() {
    if (!ativa) { setErroGeral('Escolha a cidade no topo da tela antes de importar.'); return }
    // Fotografia no clique: durante o laço não se acrescenta nem se tira arquivo,
    // e o dia fica travado — todos entram no mesmo dia de atuação.
    const vez = arqs.filter(a => importavel(a, ativa))
    if (!vez.length) return
    const diaEscolhido = dia
    setRodando(true); setErroGeral(null)
    setArqs(l => l.map(a => vez.some(v => v.chave === a.chave)
      ? { ...a, fase: 'aguardando', erro: null } : a))

    for (const [i, a] of vez.entries()) {
      setProgresso({ atual: i + 1, total: vez.length })
      atualizar(a.chave, {
        fase: 'enviando', etapa: 0, enviadas: 0, fila: null, inicio: Date.now(),
      })
      document.getElementById(`arq-${a.chave}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      try {
        // O caminho inteiro mora em lib/importarToa.ts — o mesmo do robô (111).
        // A falha já sai de lá gravada na importação (105).
        const r = await importarLinhasToa({
          linhas: a.leitura!.linhas,
          arquivoNome: a.arquivo.name,
          baseId: ativa.id,
          dia: diaEscolhido,
          usuarioId: perfil?.id ?? null,
          origem: 'manual',
          aoAvancar: (e, n) => atualizar(a.chave, { etapa: e, enviadas: n, fila: null }),
          aoEsperar: f => atualizar(a.chave, { fila: f }),
        })
        // 108: o código que o cadastro não conhece não trava nada — o
        // contrato só fica parado. A tela diz qual é, aqui, na hora.
        const { data: novos } = await supabase.rpc('codigos_sem_cadastro', { p_importacao: r.importacaoId })
        atualizar(a.chave, {
          fase: 'pronto', resumo: r.resumo, desatrib: r.desatribuicao,
          reconciliarPendente: r.reconciliou ? null : r.importacaoId,
          codigosNovos: (novos ?? []) as CodigoNovo[], fila: null, diaImportado: diaEscolhido,
        })
      } catch (e) {
        // ErroImportacao já traz o "nada entrou" do estouro de tempo (D-181).
        // Um arquivo que falha não derruba os outros: o laço segue.
        atualizar(a.chave, {
          fase: 'falhou', fila: null,
          erro: e instanceof Error ? e.message : 'Falha na importação.',
        })
      }
      await carregarHistorico()
    }
    setRodando(false); setProgresso(null)
  }

  async function reconciliar(a: Arq) {
    if (!a.reconciliarPendente) return
    setReconciliando(a.chave)
    const ok = await reconciliarImportacao(a.reconciliarPendente)
    setReconciliando(null)
    if (ok) atualizar(a.chave, { reconciliarPendente: null })
  }

  function limpar() {
    if (rodando) return
    setArqs([]); setErroGeral(null)
    // A próxima importação volta a nascer em HOJE: o dia anterior é
    // escolha de uma importação, não um modo que fica ligado.
    setDia(isoLocal())
    if (inputRef.current) inputRef.current.value = ''
  }

  const hoje = isoLocal()
  const nomeDoDia = (iso: string) =>
    iso === hoje ? 'hoje' : iso === ontem() ? 'ontem' : dataBR(iso)

  const prontos = arqs.filter(a => importavel(a, ativa))
  const visitasProntas = prontos.reduce((s, a) => s + (a.leitura?.linhas.length ?? 0), 0)
  const lendo = arqs.some(a => a.fase === 'lendo' || (a.fase === 'lida' && !a.origem))
  const deFora = arqs.filter(a => a.fase === 'ilegivel'
    || (a.fase === 'lida' && !!a.origem && !importavel(a, ativa))).length
  const algumPronto = arqs.some(a => a.fase === 'pronto')

  // 116 (D-191): dois arquivos do MESMO bucket na lista — o segundo importado
  // desatribui o que estava Na entrada só no primeiro.
  const buckets = arqs.reduce<Record<string, number>>((m, a) => {
    if (a.origem?.bucket) m[a.origem.bucket] = (m[a.origem.bucket] ?? 0) + 1
    return m
  }, {})

  const soltar = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); if (!rodando) setArrastando(true) },
    onDragLeave: () => setArrastando(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault(); setArrastando(false)
      if (e.dataTransfer.files.length) receber(e.dataTransfer.files)
    },
  }

  const rotuloBotao = rodando
    ? (progresso && progresso.total > 1 ? `Importando ${progresso.atual} de ${progresso.total}…` : 'Importando…')
    : prontos.length > 1
      ? `Importar ${prontos.length} arquivos · ${visitasProntas} visitas em ${dataBR(dia).slice(0, 5)}`
      : `Importar ${visitasProntas} visitas em ${dataBR(dia).slice(0, 5)}`

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold">Importar planilha do TOA</h1>
          <p className="mt-1 text-sm text-graf-400">
            <code className="text-graf-300">Atividades-&lt;BUCKET&gt;_DD_MM_AA.xlsx</code>, sem renomear ·
            entra em <strong className="text-graf-200">{ativa?.nome ?? 'nenhuma cidade escolhida'}</strong>
          </p>
        </div>

        {!podeImportar && (
          <Alerta tipo="aviso">
            Seu perfil de acesso não inclui <strong>Importar TOA</strong>. Peça ao administrador para
            liberar em Administração › Perfis de acesso.
          </Alerta>
        )}

        {/* ---------- no alto: dia de atuação, arquivos e o botão (090) ---------- */}
        <div {...soltar}
          className={`card-controle p-4 transition ${
            arrastando ? 'ring-2 ring-af-500' : dia !== hoje ? 'ring-1 ring-amber-500/50' : ''}`}>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="dia-atuacao"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-graf-400">
                Dia de atuação
              </label>
              <input id="dia-atuacao" type="date" value={dia} required disabled={rodando}
                onChange={e => setDia(e.target.value || hoje)}
                className="rounded-lg border border-graf-700 bg-graf-900 px-3 py-2 text-sm
                           text-graf-100 outline-none focus:border-af-500 disabled:opacity-60" />
            </div>
            <div className="flex gap-1.5">
              {[['Hoje', hoje], ['Ontem', ontem()]].map(([r, d]) => (
                <button key={r} onClick={() => setDia(d)} aria-pressed={dia === d} disabled={rodando}
                  className={`rounded-md border px-2.5 py-2 text-xs disabled:opacity-60 ${
                    dia === d ? 'border-af-600 bg-af-600/15 text-af-200'
                              : 'border-graf-700 text-graf-300 hover:bg-graf-800'}`}>
                  {r}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => inputRef.current?.click()} disabled={rodando || !podeImportar}
                className="toque rounded-lg border border-graf-700 px-4 text-sm font-medium text-graf-200
                           hover:border-af-600 hover:text-af-300 disabled:opacity-50">
                {arqs.length ? 'Mais arquivos' : 'Escolher arquivos'}
              </button>
              <button onClick={enviar}
                disabled={rodando || lendo || prontos.length === 0 || !dia || !podeImportar}
                className="toque rounded-lg bg-af-600 px-6 font-semibold text-white
                           hover:bg-af-500 disabled:opacity-50">
                {rotuloBotao}
              </button>
            </div>
            <input
              ref={inputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) receber(e.target.files) }}
            />
          </div>
          {dia !== hoje && (
            <p className="mt-2 text-xs text-amber-300">
              Entra em {dataBR(dia)} ({nomeDoDia(dia)}), não hoje.
            </p>
          )}
          {deFora > 0 && !rodando && (
            <p className="mt-2 text-xs text-af-300">
              {plural(deFora, 'arquivo fica', 'arquivos ficam')} de fora — veja abaixo.
            </p>
          )}
        </div>

        {erroGeral && <Alerta tipo="erro">{erroGeral}</Alerta>}

        {rodando && (
          <p role="status" aria-live="polite"
            className="flex items-center gap-2 text-sm font-medium text-graf-100">
            <span aria-hidden
              className="h-4 w-4 shrink-0 rounded-full border-2 border-af-600/25 border-t-af-500
                         motion-safe:animate-spin" />
            Importando — não feche esta aba
          </p>
        )}

        {/* ---------- os arquivos ---------- */}
        {arqs.length === 0 ? (
          <div {...soltar}
            className={`rounded-xl border-2 border-dashed px-6 py-10 text-center text-sm transition ${
              arrastando ? 'border-af-500 bg-af-900/15 text-graf-200' : 'border-graf-700 text-graf-400'}`}>
            Arraste as planilhas aqui
          </div>
        ) : (
          <div className="space-y-3">
            {arqs.map(a => (
              <CartaoArquivo key={a.chave} a={a} ativa={ativa} dia={dia} agora={agora}
                rodando={rodando} repetido={!!a.origem?.bucket && buckets[a.origem.bucket] > 1}
                reconciliando={reconciliando === a.chave}
                aoRemover={() => setArqs(l => l.filter(x => x.chave !== a.chave))}
                aoUsarDia={setDia}
                aoReconciliar={() => reconciliar(a)}
                aoConfigurar={() => navegar('/controle/configuracoes')} />
            ))}
            {!rodando && (
              <div className="flex gap-3">
                {algumPronto && (
                  <button onClick={() => navegar('/controle')}
                    className="toque rounded-lg bg-af-600 px-6 font-semibold text-white hover:bg-af-500">
                    Ver as visitas
                  </button>
                )}
                <button onClick={limpar}
                  className="toque rounded-lg border border-graf-700 px-6 font-medium text-graf-300 hover:bg-graf-800">
                  Limpar a lista
                </button>
              </div>
            )}
          </div>
        )}

        {/* ---------- histórico / log ---------- */}
        <section className="card-controle overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-graf-800 px-4 py-3">
            <h2 className="text-sm font-semibold">Histórico de importações</h2>
            <button onClick={carregarHistorico}
              className="rounded border border-graf-700 px-2.5 py-1 text-[11px] text-graf-400
                         hover:border-af-600 hover:text-af-400">
              atualizar
            </button>
          </div>

          {historico.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-graf-500">
              Nenhuma importação registrada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Arquivo</th>
                    <th className="px-3 py-2 font-medium">Dia</th>
                    <th className="px-3 py-2 font-medium">Resultado</th>
                    <th className="px-3 py-2 font-medium">Criação</th>
                    <th className="px-3 py-2 font-medium">Conclusão</th>
                    <th className="px-3 py-2 font-medium">Quem</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map(h => {
                    const est = estadoDa(h, Date.now())
                    const comErro = (h.qtd_erro ?? 0) > 0
                    return (
                      <tr key={h.id} className="border-b border-graf-800">
                        <td className="max-w-72 truncate px-3 py-2" title={h.arquivo_nome ?? ''}>
                          {h.arquivo_nome ?? '—'}
                        </td>
                        {/* Nula = importação anterior à 090: ninguém
                            escolheu dia nela, e a tela não finge que sim. */}
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-300"
                            title={h.data_atuacao ? 'Dia de atuação escolhido'
                                   : 'Anterior ao dia de atuação: usou a Data da planilha'}>
                          {h.data_atuacao ? dataBR(h.data_atuacao).slice(0, 5)
                            : <span className="text-graf-400">da planilha</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-300">
                          {h.total_linhas
                            ? <>
                                <span className="tabular">{h.total_linhas}</span> linhas ·{' '}
                                <span className="tabular text-emerald-400">{h.qtd_criadas ?? 0}</span> novas ·{' '}
                                <span className="tabular text-sky-400">{h.qtd_atualizadas ?? 0}</span> atualizadas
                                {(h.qtd_conflito ?? 0) > 0 && (
                                  <> · <span className="tabular text-amber-400">
                                    {h.qtd_conflito}</span> conflitos</>
                                )}
                                {comErro && (
                                  <> · <span className="tabular text-af-400">{h.qtd_erro}</span> erros</>
                                )}
                              </>
                            : est === 'nao_entrou' || est === 'nao_terminou'
                              ? <span className="text-af-300">
                                  {h.erro_mensagem ?? (est === 'nao_terminou'
                                    ? 'Começou e não terminou — a aba fechou ou caiu no meio. Nada foi aplicado; importe de novo.'
                                    : 'Não entrou.')}
                                </span>
                              : <span className="text-graf-400">sem contagem gravada</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-xs text-graf-400">{quando(h.criado_em)}</td>
                        <td className="tabular px-3 py-2 text-xs text-graf-400">{quando(h.aplicado_em)}</td>
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {h.usuario?.nome ?? h.usuario?.email ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium ${ROTULO_ESTADO[est].classe}`}>
                            {ROTULO_ESTADO[est].texto}
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

/** Um arquivo da lista: o que ele traz, os avisos, o andamento e o resultado. */
function CartaoArquivo({
  a, ativa, dia, agora, rodando, repetido, reconciliando,
  aoRemover, aoUsarDia, aoReconciliar, aoConfigurar,
}: {
  a: Arq; ativa: Cidade | null; dia: string; agora: number; rodando: boolean
  repetido: boolean; reconciliando: boolean
  aoRemover: () => void; aoUsarDia: (d: string) => void
  aoReconciliar: () => void; aoConfigurar: () => void
}) {
  const l = a.leitura
  const o = a.origem
  const ok = origemOk(o, ativa)
  const antes = a.fase === 'lida' || a.fase === 'falhou'
  const totalOS = l ? l.linhas.reduce((s, x) => s + contarOS(x), 0) : 0
  const dist = l
    ? Object.entries(l.linhas.reduce<Record<number, number>>((m, x) => {
        const n = contarOS(x); m[n] = (m[n] ?? 0) + 1; return m
      }, {})).sort((x, y) => +x[0] - +y[0])
    : []
  const diasPl = l ? diasDaPlanilha(l) : []
  const divergentes = diasPl.filter(([d]) => d !== dia).reduce((s, [, n]) => s + n, 0)
  const temLogin = !!l?.cabecalhos.includes('Login do Técnico')
  const temRecurso = !!l?.cabecalhos.includes('Recurso')
  const r = a.resumo
  const des = a.desatrib

  const anel = a.fase === 'falhou' || a.fase === 'ilegivel' || (antes && o && !ok)
    ? 'ring-1 ring-af-500/60'
    : a.fase === 'pronto' ? 'ring-1 ring-emerald-600/40'
    : a.fase === 'enviando' ? 'ring-1 ring-af-600/50' : ''

  return (
    <div id={`arq-${a.chave}`} className={`card-controle p-4 ${anel}`}>
      {/* cabeçalho: nome, tamanho, bucket e o × */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={a.arquivo.name}>{a.arquivo.name}</p>
          <p className="text-xs text-graf-400">
            {(a.arquivo.size / 1024).toFixed(0)} KB
            {l && <> · {l.cabecalhos.length} colunas</>}
            {o?.bucket && <> · bucket <strong className="text-graf-300">{o.bucket}</strong>
              {o.cidade && <> ({o.cidade})</>}</>}
          </p>
        </div>
        <EstadoArq a={a} ok={ok} />
        {!rodando && a.fase !== 'pronto' && (
          <button onClick={aoRemover} title="Tirar da lista" aria-label={`Tirar ${a.arquivo.name} da lista`}
            className="shrink-0 rounded px-1.5 text-lg leading-none text-graf-500 hover:text-af-400">×</button>
        )}
      </div>

      {a.fase === 'lendo' && <p className="mt-2 text-sm text-graf-400">Lendo a planilha…</p>}
      {a.fase === 'ilegivel' && <p className="mt-2 text-sm text-af-300">{a.erro}</p>}

      {/* ---------- antes de importar: os avisos que impedem erro ---------- */}
      {l && antes && (
        <div className="mt-3 space-y-2 text-xs">
          {o && !ok && (
            <div className="rounded-lg border border-af-700/60 bg-af-900/25 px-3 py-2 text-af-200">
              {!o.bucket ? (
                <>Bucket não reconhecido no nome. Use o arquivo como o TOA gera, sem renomear.</>
              ) : !o.base_id ? (
                <><strong>{o.bucket}</strong> não está cadastrado em nenhuma cidade (ADMIN: Configurações › Buckets do TOA).</>
              ) : !o.ativo ? (
                <><strong>{o.bucket}</strong> está desligado em {o.cidade} (ADMIN: Configurações › Buckets do TOA).</>
              ) : (
                <>
                  É de <strong>{o.cidade}</strong>, não de {ativa?.nome ?? 'nenhuma cidade'}: fica de fora.{' '}
                  {o.acessa ? (
                    <button onClick={() => trocarCidade(o.base_id!)} disabled={rodando}
                      className="font-medium underline underline-offset-2 hover:text-af-100">
                      Trocar para {o.cidade}
                    </button>
                  ) : <>Sem acesso a {o.cidade} (quem libera é o ADMIN).</>}
                  {o.acessa && <span className="text-af-300"> (a página recarrega: escolha os arquivos de novo)</span>}
                </>
              )}
            </div>
          )}

          {/* A diferença fica À VISTA antes do clique: é a única hora em que
              alguém pode perceber que subiu o arquivo errado (D-166). */}
          {divergentes > 0 && (
            <p className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-amber-200">
              Coluna Data:{' '}
              {diasPl.map(([d, n], k) => (
                <span key={d}>
                  {k > 0 && ' · '}
                  <strong>{d === 'sem data' ? 'sem data' : dataBR(d)}</strong>
                  {diasPl.length > 1 && <> ({n})</>}
                </span>
              ))}
              {' '}— entra{divergentes > 1 ? 'm' : ''} em {dataBR(dia)}.
              {diasPl.length === 1 && diasPl[0][0] !== 'sem data' && (
                <>{' '}
                  <button onClick={() => aoUsarDia(diasPl[0][0])} disabled={rodando}
                    className="font-medium underline underline-offset-2 hover:text-amber-100">
                    Atuar em {dataBR(diasPl[0][0]).slice(0, 5)}
                  </button>
                </>
              )}
            </p>
          )}

          {a.problemas.length > 0 && (
            <ul className="list-inside list-disc rounded-lg border border-amber-700/50 bg-amber-950/30
                           px-3 py-2 text-amber-200">
              {a.problemas.map(p => <li key={p}>{p}</li>)}
            </ul>
          )}

          {/* O TOA exporta com e sem "Recurso"; só uma diz o NOME de quem
              estava logado, que resolve o cadastro do login (D-091). */}
          {!temLogin ? (
            <p className="text-amber-300">Sem a coluna <strong>Login do Técnico</strong>: não roteia para equipe.</p>
          ) : !temRecurso && (
            <p className="text-graf-300">Sem a coluna <strong>Recurso</strong>: o login aparece sem nome em Equipes.</p>
          )}

          {/* 187/215: sem o ID, o banco acha o contrato do dia pela WO. */}
          {semIdDaAtividade(l) && (
            <p className="text-amber-300">
              Sem <strong>ID da Atividade</strong>: acha pela WO; o novo entra com chave provisória. Jornada fica de fora.
            </p>
          )}

          {/* 116 (D-191): a comparação do "sumiu do TOA" é com a última
              importação do mesmo bucket. */}
          {repetido && (
            <p className="text-amber-300">
              Outro arquivo da lista é do mesmo bucket: o que estiver Na entrada e faltar no último vai para Auditar.
            </p>
          )}

          {a.fase === 'falhou' && a.erro && <p className="text-af-300">{a.erro}</p>}

          {/* os números do arquivo, por último */}
          <p className="text-graf-400">
            <span className="tabular text-graf-200">{l.linhas.length}</span> visitas ·{' '}
            <span className="tabular text-graf-200">{totalOS}</span> O.S.
            {l.descartadas > 0 && <> · <span className="tabular">{l.descartadas}</span> descartadas</>}
            {l.duplicados.length > 0 && (
              <span title={`Tratadas por posição (D-013): ${l.duplicados.join(' · ')}`}>
                {' '}· <span className="tabular">{l.duplicados.length}</span> coluna(s) repetida(s)
              </span>
            )}
            {dist.length > 0 && <> · O.S. por visita: {dist.map(([n, q]) => `${q}× ${n}`).join(', ')}</>}
          </p>
        </div>
      )}

      {/* ---------- o andamento (D-182) ---------- */}
      {a.fase === 'enviando' && l && (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="text-xs text-graf-300">
            {ETAPAS[a.etapa]}… · <span className="tabular">
              {a.inicio ? Math.max(0, Math.floor((agora - a.inicio) / 1000)) : 0} s
            </span>
            {a.etapa === 1 && <span className="tabular text-graf-400"> — {a.enviadas} de {l.linhas.length}</span>}
          </p>
          <div className="mt-2 flex gap-1" aria-hidden>
            {ETAPAS.map((rot, k) => (
              <span key={rot} title={rot} className={`h-1.5 flex-1 rounded-full ${
                k < a.etapa ? 'bg-emerald-600'
                : k === a.etapa ? 'bg-af-500 motion-safe:animate-pulse' : 'bg-graf-800'}`} />
            ))}
          </div>
          {/* 165: esperando a vez — a tela diz por quem, e que não travou. */}
          {a.fila && !a.fila.vez && (
            <p className="mt-2 text-xs text-amber-200">
              Na fila da cidade{a.fila.posicao ? <> — posição <strong className="tabular">{a.fila.posicao}</strong></> : null}
              {', '}esperando{a.fila.na_frente ? <> <strong>{a.fila.na_frente}</strong></> : ' outra importação'}
              {a.fila.quem ? <> ({a.fila.quem})</> : null}. Começa sozinho.
            </p>
          )}
        </div>
      )}

      {/* ---------- o resultado ---------- */}
      {a.fase === 'pronto' && r && (
        <div className="mt-3 space-y-2 text-xs">
          <p className="text-graf-300">
            {r.dia && <>Em <strong className="text-graf-100">{dataBR(r.dia)}</strong> · </>}
            <span className="tabular" style={{ color: 'var(--st-concluida)' }}>{r.criadas}</span> criadas ·{' '}
            <span className="tabular" style={{ color: 'var(--st-execucao)' }}>{r.atualizadas}</span> atualizadas ·{' '}
            <span className="tabular">{r.ordens_servico}</span> O.S.
            {r.ignoradas > 0 && <> · <span className="tabular">{r.ignoradas}</span> ignoradas</>}
            {!!r.suspensas && <> · <span className="tabular">{r.suspensas}</span> suspensas</>}
            {r.erros > 0 && <> · <span className="tabular" style={{ color: 'var(--st-conflito)' }}>{r.erros}</span> erros</>}
            {r.conflitos > 0 && <> · <span className="tabular" style={{ color: 'var(--st-reagendamento)' }}>{r.conflitos}</span> conflitos com o TOA</>}
          </p>

          {/* 215: o que entrou com chave provisória e o que recebeu o ID. */}
          {(!!r.provisorias || !!r.id_trocado) && (
            <p className="text-graf-300">
              {!!r.provisorias && <><strong>{r.provisorias}</strong> com chave provisória (sem ID da Atividade). </>}
              {!!r.id_trocado && <><strong>{r.id_trocado}</strong> receberam o ID da Atividade.</>}
            </p>
          )}

          {/* 116 (D-191): nulo = a conferência não rodou — não é "nenhum". */}
          {des === null ? (
            <p className="text-amber-300">
              A conferência do que saiu do TOA não terminou; a próxima importação deste bucket confere.
            </p>
          ) : des && (des.desatribuidos > 0 || des.devolvidos > 0 || !!des.sumiram) && (
            <p className="text-graf-300">
              {des.desatribuidos > 0 && <><strong>{des.desatribuidos}</strong> sumiram e foram para Auditar (800). </>}
              {des.devolvidos > 0 && <><strong>{des.devolvidos}</strong> voltaram Na entrada. </>}
              {/* 134: o que sumiu EM ANDAMENTO não é desatribuído — avisado à parte. */}
              {!!des.sumiram && <span className="text-amber-300">
                <strong>{des.sumiram}</strong> sumiram em andamento: nada mudou neles, confira no TOA.</span>}
            </p>
          )}

          {a.codigosNovos.length > 0 && (
            <p className="text-amber-300">
              Código(s) sem cadastro: {a.codigosNovos.map(c => c.texto).join(' · ')}
              {' '}({a.codigosNovos.reduce((t, c) => t + c.presos, 0)} parado(s)).{' '}
              <button onClick={aoConfigurar} className="font-medium underline underline-offset-2">
                Cadastrar
              </button>{' '}e importar de novo.
            </p>
          )}

          {a.reconciliarPendente && (
            <p className="text-amber-300">
              Os contratos entraram; falta a 2ª parte (jornada sem login e TEC1).{' '}
              <button onClick={aoReconciliar} disabled={reconciliando}
                className="font-medium underline underline-offset-2 disabled:opacity-50">
                {reconciliando ? 'Rodando…' : 'Rodar de novo'}
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** O selo do estado de um arquivo da lista. */
function EstadoArq({ a, ok }: { a: Arq; ok: boolean }) {
  const [texto, classe] =
    a.fase === 'lendo' ? ['Lendo', 'bg-graf-800 text-graf-300']
    : a.fase === 'ilegivel' ? ['Não li', 'bg-af-900/40 text-af-300']
    : a.fase === 'aguardando' ? ['Na vez', 'bg-graf-800 text-graf-300']
    : a.fase === 'enviando' ? ['Importando', 'bg-amber-900/40 text-amber-300']
    : a.fase === 'pronto' ? ['Importado', 'bg-emerald-900/40 text-emerald-300']
    : a.fase === 'falhou' ? ['Não entrou', 'bg-af-900/40 text-af-300']
    : !a.origem ? ['Conferindo', 'bg-graf-800 text-graf-300']
    : ok && (a.leitura?.linhas.length ?? 0) > 0 ? ['Pronto', 'bg-emerald-900/40 text-emerald-300']
    : ['Fica de fora', 'bg-af-900/40 text-af-300']
  return (
    <span className={`shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium ${classe}`}>
      {texto}
    </span>
  )
}
