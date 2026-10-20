import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { lerPlanilhaTOA, validarPlanilha, contarOS, type ResultadoLeitura } from '../lib/toa'
import {
  ETAPAS, importarLinhasToa, reconciliarImportacao, type Resumo, type Desatribuicao,
} from '../lib/importarToa'
import { Alerta } from '../components/ui'
import { Shell } from '../components/Shell'
import { isoLocal, dataBR } from '../lib/formato'
import { useCidades, trocarCidade } from '../lib/cidade'

/** De que cidade é o arquivo, pelo bucket do nome (103, D-180). */
interface Origem {
  bucket: string | null; base_id: string | null; cidade: string | null
  acessa: boolean | null; ativo: boolean | null
}

type Fase = 'ocioso' | 'lendo' | 'lida' | 'enviando' | 'pronto'

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

export default function Importacao() {
  const { perfil } = useAuth()
  const navegar = useNavigate()
  /**
   * A importação vai para a CIDADE ATIVA do topo — era `'MAN'` escrito à
   * mão, e qualquer arquivo entrava em Manaus. Em 26/09 o único arquivo
   * do dia foi `Atividades-ARN-AFLINE`, e entrou em Manaus (D-180).
   */
  const { ativa } = useCidades()
  const [origem, setOrigem] = useState<Origem | null>(null)
  /**
   * A reconciliação (jornada sem login, tipo de atividade, TEC1) é a
   * SEGUNDA chamada, com os seus próprios 8 s (104b, D-181). Se ela falhar,
   * os contratos já entraram — guarda o id para tentar de novo.
   */
  const [reconciliarPendente, setReconciliarPendente] = useState<string | null>(null)
  /** Códigos que esta importação trouxe e o cadastro não conhece (108, D-185). */
  const [codigosNovos, setCodigosNovos] = useState<{ codigo: number; texto: string; presos: number }[]>([])
  const [reconciliando, setReconciliando] = useState(false)

  async function reconciliar(id: string): Promise<boolean> {
    setReconciliando(true)
    const ok = await reconciliarImportacao(id)
    setReconciliando(false)
    setReconciliarPendente(ok ? null : id)
    return ok
  }
  const inputRef = useRef<HTMLInputElement>(null)

  const [fase, setFase] = useState<Fase>('ocioso')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null)
  const [problemas, setProblemas] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  /** 116: undefined = ainda não importou; null = a conferência falhou. */
  const [desatrib, setDesatrib] = useState<Desatribuicao | null | undefined>(undefined)
  /** Andamento visível (D-182): etapa atual, linhas enviadas, cronômetro. */
  const [etapa, setEtapa] = useState(0)
  const [enviadas, setEnviadas] = useState(0)
  const [inicio, setInicio] = useState<number | null>(null)
  const [agora, setAgora] = useState(Date.now())
  useEffect(() => {
    if (fase !== 'enviando') return
    const t = setInterval(() => setAgora(Date.now()), 500)
    return () => clearInterval(t)
  }, [fase])
  // O painel nasce abaixo da dobra: sem isto, quem clicou não via nada mexer.
  const painelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (fase === 'enviando') painelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [fase])
  const [arrastando, setArrastando] = useState(false)
  const [historico, setHistorico] = useState<Historico[]>([])
  /**
   * O dia em que as visitas vão entrar. Nasce HOJE, e só muda quando a
   * pessoa escolhe (090, D-166):
   *
   * > "mesmo que a data esteja diferente, a importação da rota, ele
   * >  precisa ir para o dia atual, so sera importado para o dia
   * >  anterior quando nos escolhermos a data que vamos atuar" — Emanuel
   *
   * A "Data" da planilha não decide nada: aparece na prévia, ao lado,
   * para a diferença ficar à vista antes do clique.
   */
  const [dia, setDia] = useState(isoLocal)

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

  async function receber(f: File) {
    setErro(null); setResumo(null); setProblemas([]); setOrigem(null)
    setArquivo(f); setFase('lendo')
    // O bucket sai do NOME do arquivo — nenhuma coluna da planilha o traz.
    // A tela pergunta antes de subir as linhas; quem barra é o banco
    // (`importar_toa` confere de novo).
    supabase.rpc('cidade_do_arquivo', { p_arquivo: f.name }).then(({ data }) => {
      const o = ((data ?? []) as Origem[])[0]
      setOrigem(o ?? { bucket: null, base_id: null, cidade: null, acessa: null, ativo: null })
    })
    try {
      const r = await lerPlanilhaTOA(f)
      setLeitura(r)
      setProblemas(validarPlanilha(r))
      setFase('lida')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler a planilha.')
      setFase('ocioso')
    }
  }

  async function enviar() {
    if (!leitura || !arquivo) return
    setFase('enviando'); setErro(null)
    setEtapa(0); setEnviadas(0); setInicio(Date.now()); setAgora(Date.now())
    try {
      if (!ativa) throw new Error('Escolha a cidade no topo da tela antes de importar.')

      // O caminho inteiro mora em lib/importarToa.ts — o mesmo do robô (111).
      // A falha já sai de lá gravada na importação (105).
      const r = await importarLinhasToa({
        linhas: leitura.linhas,
        arquivoNome: arquivo.name,
        baseId: ativa.id,
        dia,
        usuarioId: perfil?.id ?? null,
        origem: 'manual',
        aoAvancar: (e, n) => { setEtapa(e); setEnviadas(n) },
      })
      setReconciliarPendente(r.reconciliou ? null : r.importacaoId)
      // 108: o código que o cadastro não conhece não trava nada — o
      // contrato só fica parado. A tela diz qual é, aqui, na hora.
      const { data: novos } = await supabase.rpc('codigos_sem_cadastro', { p_importacao: r.importacaoId })
      setCodigosNovos((novos ?? []) as { codigo: number; texto: string; presos: number }[])

      setDesatrib(r.desatribuicao)
      setResumo(r.resumo)
      setFase('pronto')
      await carregarHistorico()
    } catch (e) {
      // ErroImportacao já traz o "nada entrou" do estouro de tempo (D-181).
      setErro(e instanceof Error ? e.message : 'Falha na importação.')
      setFase('lida')
      await carregarHistorico()
    }
  }

  function limpar() {
    setFase('ocioso'); setArquivo(null); setLeitura(null)
    setResumo(null); setErro(null); setProblemas([]); setOrigem(null)
    setReconciliarPendente(null); setCodigosNovos([])
    // A próxima importação volta a nascer em HOJE: o dia anterior é
    // escolha de uma importação, não um modo que fica ligado.
    setDia(isoLocal())
    if (inputRef.current) inputRef.current.value = ''
  }

  const dist = leitura
    ? leitura.linhas.reduce<Record<number, number>>((a, l) => {
        const n = contarOS(l); a[n] = (a[n] ?? 0) + 1; return a
      }, {})
    : {}
  const totalOS = leitura ? leitura.linhas.reduce((s, l) => s + contarOS(l), 0) : 0

  /** Os dias que a coluna "Data" traz, com quantas linhas cada. */
  const diasPlanilha = leitura
    ? Object.entries(leitura.linhas.reduce<Record<string, number>>((a, l) => {
        const iso = isoDaPlanilha(l['Data']) ?? 'sem data'
        a[iso] = (a[iso] ?? 0) + 1; return a
      }, {})).sort((a, b) => b[1] - a[1])
    : []
  const hoje = isoLocal()
  const divergentes = diasPlanilha.filter(([d]) => d !== dia)
    .reduce((s, [, n]) => s + n, 0)
  const nomeDoDia = (iso: string) =>
    iso === hoje ? 'hoje' : iso === ontem() ? 'ontem' : dataBR(iso)

  /** O arquivo é desta cidade? Nulo enquanto a conferência não voltou. */
  const origemOk = !!origem && !!origem.bucket && !!origem.base_id && !!origem.ativo
    && !!ativa && origem.base_id === ativa.id

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold">Importar planilha do TOA</h1>
          <p className="mt-1 text-sm text-graf-400">
            O arquivo <code className="text-graf-300">Atividades-&lt;BUCKET&gt;_DD_MM_AA.xlsx</code> exportado
            do sistema da CLARO, com o nome que o TOA dá — é pelo nome que o sistema sabe
            de qual cidade ele é. Entra em{' '}
            <strong className="text-graf-200">{ativa?.nome ?? 'nenhuma cidade escolhida'}</strong>,
            a cidade do topo. Pode subir a mesma planilha várias vezes ao dia:
            a importação atualiza sem duplicar. As visitas entram no <strong
            className="text-graf-200">dia de atuação</strong> que você escolher —
            hoje, a menos que você troque.
          </p>
        </div>

        {/* ---------- área de arquivo ---------- */}
        {fase === 'ocioso' && (
          <div
            onDragOver={e => { e.preventDefault(); setArrastando(true) }}
            onDragLeave={() => setArrastando(false)}
            onDrop={e => {
              e.preventDefault(); setArrastando(false)
              const f = e.dataTransfer.files[0]; if (f) receber(f)
            }}
            className={`rounded-xl border-2 border-dashed px-6 py-14 text-center transition ${
              arrastando ? 'border-af-500 bg-af-900/15' : 'border-graf-700 bg-graf-900'}`}
          >
            <p className="font-medium">Arraste a planilha aqui</p>
            <p className="mt-1 text-sm text-graf-400">ou</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-3 rounded-lg bg-af-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-af-500"
            >
              Escolher arquivo
            </button>
            <input
              ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) receber(f) }}
            />
            <p className="mt-4 text-xs text-graf-500">
              A planilha é lida no seu navegador. Nada sai daqui antes de você confirmar.
            </p>
          </div>
        )}

        {fase === 'lendo' && <Alerta tipo="info">Lendo a planilha…</Alerta>}

        {/* ---------- prévia ---------- */}
        {leitura && (fase === 'lida' || fase === 'enviando') && (
          <div className="space-y-4">
            <div className="card-controle p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{arquivo?.name}</p>
                  <p className="text-xs text-graf-400">
                    {(arquivo!.size / 1024).toFixed(0)} KB · {leitura.cabecalhos.length} colunas
                  </p>
                </div>
                <button onClick={limpar}
                        className="shrink-0 text-sm text-graf-400 hover:text-af-400">
                  Trocar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Visitas', leitura.linhas.length],
                  ['O.S. no total', totalOS],
                  ['Descartadas', leitura.descartadas],
                  ['Colunas repetidas', leitura.duplicados.length],
                ].map(([r, v]) => (
                  <div key={r as string} className="rounded-lg bg-graf-900 px-3 py-2.5">
                    <div className="tabular text-xl font-semibold leading-none">{v}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">{r}</div>
                  </div>
                ))}
              </div>

              {/* O TOA exporta com e sem a coluna "Recurso". As duas
                  entram — mas só uma diz o NOME de quem estava logado,
                  e é esse nome que resolve o cadastro do login (D-091). */}
              {(() => {
                const temLogin   = leitura.cabecalhos.includes('Login do Técnico')
                const temRecurso = leitura.cabecalhos.includes('Recurso')
                if (temLogin && temRecurso) return (
                  <p className="mt-3 text-xs text-emerald-400">
                    Traz <strong>Login do Técnico</strong> e <strong>Recurso</strong> —
                    login e nome de quem executou. É o export completo.
                  </p>
                )
                return (
                  <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900
                                  px-3 py-2.5 text-xs">
                    <p className="text-graf-300">
                      {temLogin
                        ? <>Traz o <strong>Login do Técnico</strong>, mas não a coluna{' '}
                            <strong>Recurso</strong> (o nome de quem estava logado).</>
                        : <>Não traz o <strong>Login do Técnico</strong>.</>}
                    </p>
                    <p className="mt-1 text-graf-500">
                      A importação funciona assim mesmo. O que muda é o cadastro:{' '}
                      {temLogin
                        ? 'na tela de Equipes o login aparece sem nome, e alguém tem de saber de cor de quem ele é.'
                        : 'sem login não há como rotear o contrato para equipe nenhuma.'}
                      {' '}No TOA, marque as duas colunas na exportação.
                    </p>
                  </div>
                )
              })()}

              {/* D-013 visível para quem opera */}
              {leitura.duplicados.length > 0 && (
                <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900 px-3 py-2.5 text-xs">
                  <p className="mb-1 font-medium text-graf-200">
                    Colunas de nome repetido tratadas por posição:
                  </p>
                  <p className="text-graf-400">
                    {leitura.duplicados.join(' · ')}
                  </p>
                  <p className="mt-1.5 text-graf-500">
                    O TOA repete "Tipo de Atividade" (categoria e tipo real). Leitor comum
                    perderia a primeira sem avisar — aqui as duas são preservadas.
                  </p>
                </div>
              )}

              <div className="mt-3 text-xs text-graf-400">
                <span className="font-medium text-graf-300">O.S. por visita:</span>{' '}
                {Object.entries(dist).sort((a, b) => +a[0] - +b[0])
                  .map(([n, q]) => `${q}× com ${n}`).join(' · ')}
              </div>
            </div>

            {/* ---------- de que cidade é o arquivo (103) ---------- */}
            <div className={`card-controle p-4 ${origem && !origemOk ? 'ring-1 ring-af-500/60' : ''}`}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-graf-400">
                Bucket do TOA
              </p>
              {!origem ? (
                <p className="text-sm text-graf-400">Conferindo de qual cidade é o arquivo…</p>
              ) : origemOk ? (
                <p className="text-sm text-emerald-400">
                  <strong>{origem.bucket}</strong> — {origem.cidade}. É a cidade do topo: pode importar.
                </p>
              ) : !origem.bucket ? (
                <p className="text-sm text-af-300">
                  Não reconheci o bucket no nome do arquivo. Use o arquivo com o nome que o
                  TOA gera — <code>Atividades-MAN-AFLINE_17_10_26.xlsx</code>, por exemplo —
                  sem renomear.
                </p>
              ) : !origem.base_id ? (
                <p className="text-sm text-af-300">
                  O bucket <strong>{origem.bucket}</strong> não está cadastrado em nenhuma cidade.
                  O ADMIN cadastra em Configurações › Buckets do TOA.
                </p>
              ) : !origem.ativo ? (
                <p className="text-sm text-af-300">
                  O bucket <strong>{origem.bucket}</strong> está desligado em {origem.cidade}.
                  O ADMIN religa em Configurações › Buckets do TOA.
                </p>
              ) : (
                <div className="text-sm text-af-300">
                  <p>
                    Este arquivo é do bucket <strong>{origem.bucket}</strong>, de{' '}
                    <strong>{origem.cidade}</strong> — e você está em{' '}
                    <strong>{ativa?.nome ?? 'nenhuma cidade'}</strong>. Para não misturar as
                    cidades, ele não entra aqui.
                  </p>
                  {origem.acessa ? (
                    <button onClick={() => trocarCidade(origem.base_id!)}
                      className="mt-2 rounded-md border border-af-600 px-3 py-1.5 text-xs
                                 font-medium text-af-200 hover:bg-af-600/15">
                      Trocar para {origem.cidade} (depois escolha o arquivo de novo)
                    </button>
                  ) : (
                    <p className="mt-1 text-xs text-graf-400">
                      Você não tem acesso a {origem.cidade}. Quem libera é o ADMIN, no cadastro.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ---------- dia de atuação (090) ---------- */}
            <div className={`card-controle p-4 ${dia !== hoje ? 'ring-1 ring-amber-500/50' : ''}`}>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="dia-atuacao"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-graf-400">
                    Dia de atuação
                  </label>
                  <input id="dia-atuacao" type="date" value={dia} required
                    onChange={e => setDia(e.target.value || hoje)}
                    className="rounded-lg border border-graf-700 bg-graf-900 px-3 py-2 text-sm
                               text-graf-100 outline-none focus:border-af-500" />
                </div>
                <div className="flex gap-1.5">
                  {[['Hoje', hoje], ['Ontem', ontem()]].map(([r, d]) => (
                    <button key={r} onClick={() => setDia(d)} aria-pressed={dia === d}
                      className={`rounded-md border px-2.5 py-2 text-xs ${
                        dia === d ? 'border-af-600 bg-af-600/15 text-af-200'
                                  : 'border-graf-700 text-graf-300 hover:bg-graf-800'}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <p className="min-w-0 flex-1 text-sm text-graf-300">
                  As {leitura.linhas.length} visitas entram em{' '}
                  <strong className={dia === hoje ? 'text-graf-100' : 'text-amber-300'}>
                    {dataBR(dia)} ({nomeDoDia(dia)})
                  </strong>.
                </p>
              </div>

              {/* A diferença fica À VISTA antes do clique: é a única
                  hora em que alguém pode perceber que subiu o arquivo
                  errado. */}
              {divergentes > 0 && (
                <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900 px-3 py-2.5 text-xs">
                  <p className="text-graf-200">
                    A coluna <strong>Data</strong> da planilha diz{' '}
                    {diasPlanilha.map(([d, n], k) => (
                      <span key={d}>
                        {k > 0 && ' · '}
                        <strong>{d === 'sem data' ? 'sem data' : dataBR(d)}</strong>
                        {diasPlanilha.length > 1 && <> ({n})</>}
                      </span>
                    ))}.
                    {' '}Vale o dia de atuação: {divergentes} visita(s) entram em {dataBR(dia)}.
                  </p>
                  <p className="mt-1 text-graf-400">
                    A data original não se perde — fica gravada no contrato e no histórico.
                    {diasPlanilha.length === 1 && diasPlanilha[0][0] !== 'sem data' && (
                      <> Se a rota é mesmo de {dataBR(diasPlanilha[0][0])},{' '}
                        <button onClick={() => setDia(diasPlanilha[0][0])}
                          className="text-af-400 underline underline-offset-2 hover:text-af-300">
                          atuar em {dataBR(diasPlanilha[0][0])}
                        </button>.
                      </>
                    )}
                  </p>
                </div>
              )}
              {dia !== hoje && (
                <p className="mt-2 text-xs text-amber-300">
                  Você escolheu um dia que não é hoje. Contrato que já existia muda
                  para {dataBR(dia)} — e fica registrado no histórico dele.
                </p>
              )}
            </div>

            {problemas.length > 0 && (
              <Alerta tipo="aviso">
                <p className="mb-1 font-medium">Confira antes de continuar:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {problemas.map(p => <li key={p}>{p}</li>)}
                </ul>
              </Alerta>
            )}

            {erro && <Alerta tipo="erro">{erro}</Alerta>}

            <div className="flex items-center gap-3">
              <button
                onClick={enviar}
                disabled={fase === 'enviando' || leitura.linhas.length === 0 || !dia || !origemOk}
                className="toque rounded-lg bg-af-600 px-6 font-semibold text-white
                           hover:bg-af-500 disabled:opacity-50"
              >
                {fase === 'enviando' ? 'Importando…'
                  : `Importar ${leitura.linhas.length} visitas em ${dataBR(dia).slice(0, 5)}`}
              </button>
            </div>

            {/* ┌─ o andamento, À VISTA (D-182) ───────────────────────────┐
                │ > "é bom botar uma animação quando estiver importando, │
                │ >  para o time que importou ver que o sistema está     │
                │ >  reagindo" — Emanuel                                 │
                │ Uma frase cinza ao lado do botão não dizia se a tela   │
                │ estava viva. Agora: a roda gira, a etapa da vez está   │
                │ marcada, as linhas têm barra, e o cronômetro corre.    │
                └────────────────────────────────────────────────────────┘ */}
            {fase === 'enviando' && (
              <div ref={painelRef} role="status" aria-live="polite" className="card-controle p-4">
                <div className="mb-3 flex items-center gap-3">
                  <span aria-hidden
                    className="h-6 w-6 shrink-0 rounded-full border-[3px] border-af-600/25 border-t-af-500
                               motion-safe:animate-spin" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-graf-100">Importando — não feche esta aba</p>
                    <p className="text-xs text-graf-400">
                      {ETAPAS[etapa]}… · <span className="tabular">
                        {inicio ? Math.max(0, Math.floor((agora - inicio) / 1000)) : 0} s
                      </span>
                    </p>
                  </div>
                </div>
                <ol className="space-y-1.5 text-sm">
                  {ETAPAS.map((rot, k) => (
                    <li key={rot} className="flex items-center gap-2">
                      <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                        k < etapa ? 'bg-emerald-600 text-white'
                        : k === etapa ? 'bg-af-600 text-white motion-safe:animate-pulse'
                        : 'bg-graf-800 text-graf-500'}`}>
                        {k < etapa ? '✓' : k + 1}
                      </span>
                      <span className={k === etapa ? 'text-graf-100' : k < etapa ? 'text-graf-300' : 'text-graf-500'}>
                        {rot}
                        {k === 1 && leitura && (
                          <span className="tabular text-graf-400"> — {enviadas} de {leitura.linhas.length}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                {etapa === 1 && leitura && leitura.linhas.length > 0 && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-graf-800">
                    <div className="h-full rounded-full bg-af-500 transition-all"
                      style={{ width: `${Math.round((enviadas / leitura.linhas.length) * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------- resultado ---------- */}
        {fase === 'pronto' && resumo && (
          <div className="space-y-4">
            <Alerta tipo="ok">
              Importação concluída
              {resumo.dia && <> — visitas em <strong>{dataBR(resumo.dia)}</strong></>}.
            </Alerta>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ['Criadas', resumo.criadas, 'var(--st-concluida)'],
                ['Atualizadas', resumo.atualizadas, 'var(--st-execucao)'],
                ['O.S. processadas', resumo.ordens_servico, undefined],
                ['Ignoradas', resumo.ignoradas, undefined],
                ['Suspensas (não lidas)', resumo.suspensas ?? 0, undefined],
                ['Erros', resumo.erros, resumo.erros ? 'var(--st-conflito)' : undefined],
                ['Conflitos com o TOA', resumo.conflitos,
                  resumo.conflitos ? 'var(--st-reagendamento)' : undefined],
              ].map(([r, v, c]) => (
                <div key={r as string} className="card-controle px-3.5 py-3">
                  <div className="tabular text-2xl font-semibold leading-none"
                       style={c ? { color: c as string } : undefined}>{v as number}</div>
                  <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
                    {r as string}
                  </div>
                </div>
              ))}
            </div>

            {/* 116 (D-191): o que saiu do TOA e o que voltou. Nulo = a
                conferência não rodou — não é "nenhum". */}
            {desatrib === null ? (
              <Alerta tipo="aviso">
                A conferência do que saiu do TOA não terminou. Os contratos entraram; a próxima
                importação deste bucket confere de novo.
              </Alerta>
            ) : desatrib && (desatrib.desatribuidos > 0 || desatrib.devolvidos > 0) && (
              <Alerta tipo="info">
                {desatrib.desatribuidos > 0 && (
                  <p>
                    <strong>{desatrib.desatribuidos}</strong> contrato(s) Na entrada sumiram desta planilha
                    do TOA e foram <strong>desatribuídos</strong> (cód. 800 → Cancelada). O técnico foi avisado.
                  </p>
                )}
                {desatrib.devolvidos > 0 && (
                  <p>
                    <strong>{desatrib.devolvidos}</strong> contrato(s) desatribuído(s) voltaram na planilha
                    e estão <strong>de volta Na entrada</strong>, com quem o TOA mostra agora.
                  </p>
                )}
              </Alerta>
            )}

            {codigosNovos.length > 0 && (
              <Alerta tipo="aviso">
                <p className="font-medium">
                  {codigosNovos.length === 1 ? 'Um código' : `${codigosNovos.length} códigos`} do TOA
                  sem cadastro: {codigosNovos.map(c => c.texto).join(' · ')}.
                </p>
                <p className="mt-1">
                  A O.S. entrou sem código, e a baixa automática não fecha esse contrato
                  ({codigosNovos.reduce((t, c) => t + c.presos, 0)} parado(s)). Cadastre em{' '}
                  <button onClick={() => navegar('/controle/configuracoes')}
                    className="font-medium underline underline-offset-2">
                    Configurações › Baixa e situação
                  </button>{' '}
                  e importe esta planilha de novo.
                </p>
              </Alerta>
            )}

            {reconciliarPendente && (
              <Alerta tipo="aviso">
                <p className="font-medium">
                  Os contratos entraram, mas a segunda parte não terminou.
                </p>
                <p className="mt-1">
                  Falta ligar a jornada sem login ao técnico e calcular o TEC1. Pode rodar de
                  novo sem medo: não duplica nada.
                </p>
                <button onClick={() => reconciliar(reconciliarPendente)} disabled={reconciliando}
                  className="mt-2 rounded-md border border-amber-500 px-3 py-1.5 text-xs font-medium
                             hover:bg-amber-500/15 disabled:opacity-50">
                  {reconciliando ? 'Rodando…' : 'Rodar a segunda parte de novo'}
                </button>
              </Alerta>
            )}

            {resumo.conflitos > 0 && (
              <Alerta tipo="aviso">
                <p className="font-medium">
                  {resumo.conflitos} visita(s) em que o TOA discorda do que o campo registrou.
                </p>
                <p className="mt-1">
                  O que o técnico registrou foi preservado — o TOA não sobrescreveu.
                  Cada divergência ficou gravada no histórico da visita.
                </p>
              </Alerta>
            )}

            <div className="flex gap-3">
              <button onClick={() => navegar('/controle')}
                      className="toque rounded-lg bg-af-600 px-6 font-semibold text-white hover:bg-af-500">
                Ver as visitas
              </button>
              <button onClick={limpar}
                      className="toque rounded-lg border border-graf-700 px-6 font-medium text-graf-300 hover:bg-graf-800">
                Importar outra
              </button>
            </div>
          </div>
        )}

        {/* ---------- histórico / log ---------- */}
        <section className="card-controle overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-graf-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Histórico de importações</h2>
              <p className="mt-0.5 text-xs text-graf-400">
                O que subiu, quem subiu, quando e no que deu.
              </p>
            </div>
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
