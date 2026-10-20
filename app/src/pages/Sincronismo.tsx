import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCidades } from '../lib/cidade'
import { Shell } from '../components/Shell'
import { Alerta } from '../components/ui'
import { lerPlanilhaTOA, validarPlanilha } from '../lib/toa'
import { importarLinhasToa, impressaoDasLinhas, ErroImportacao } from '../lib/importarToa'
import {
  extensaoPresente, exportarDoToa, bucketDoNome, nomePadrao, type InfoExtensao,
} from '../lib/ponteToa'

/**
 * Sincronismo com o TOA (111, D-189).
 *
 * ┌─ uma tela que configura E sincroniza ────────────────────────────┐
 * │ > "seria bom ter um botão chamado sincronismo (...) conseguimos  │
 * │ >  escolher quanto e quanto tempo queremos que o sistema         │
 * │ >  importe" — Emanuel, 19/10                                     │
 * │                                                                  │
 * │ Quem OPERA (gestão, controlador) liga, desliga, escolhe o        │
 * │ intervalo e os buckets.                                          │
 * │                                                                  │
 * │ E quem tem a extensão no Chrome e o TOA aberto pode clicar em    │
 * │ "Sincronizar por este computador": a tela passa a bater o pulso  │
 * │ a cada minuto, pede à extensão a planilha de cada bucket vencido │
 * │ e importa pelo MESMO caminho da importação manual, com o login   │
 * │ de quem está ali (113: "qual quer um que configurar sua maquina, │
 * │ vai conseguir importar com seu login" — Emanuel). Quem decide o  │
 * │ dia, o que está vencido e DE QUEM É A VEZ é o servidor           │
 * │ (`sincronismo_pulso`): um computador por vez, para não importar  │
 * │ em dobro; o segundo fica de reserva e assume se o primeiro parar.│
 * │                                                                  │
 * │ Zero e desconhecido (regra 6): pulso parado há mais de 3 min não │
 * │ é "sincronizando" — a tela diz "sem sinal há X min".             │
 * └──────────────────────────────────────────────────────────────────┘
 */

interface Config {
  base_id: string; ligado: boolean; intervalo_min: number
  configurado_em: string | null; executor_visto_em: string | null
  executor_info: string | null; toa_sessao: 'OK' | 'CAIU' | null; toa_sessao_em: string | null
  configurador: { nome: string | null } | null
  executor: { nome: string | null } | null
}
interface Bucket {
  id: string; nome: string; ativo: boolean; numero_toa: number | null; sincronizar: boolean
}
interface Rodada {
  id: string; bucket: string; dia: string; iniciada_em: string; terminada_em: string
  resultado: 'IMPORTADA' | 'SEM_MUDANCA' | 'SEM_SESSAO' | 'ERRO'
  mensagem: string | null; linhas: number | null
  importacao: { qtd_criadas: number | null; qtd_atualizadas: number | null; qtd_erro: number | null } | null
}

/** O que o pulso devolve ao robô. */
interface Ordem {
  ligado: boolean; intervalo_min: number; hoje: string; agora: string
  /** A vez é de outro computador, vivo: este espera (113). */
  outro: { nome: string | null; visto_em: string } | null
  buckets: { id: string; nome: string; numero_toa: number; vencido: boolean; impressao: string | null }[]
}

/** 5 e 10 entraram na 114 (Emanuel, 19/10): o igual não reimporta, e a conferência custa < 1 s. */
const INTERVALOS = [5, 10, 15, 30, 60] as const
/** O pulso é de 60 s; três pulsos perdidos é silêncio de verdade, não atraso. */
const SEM_SINAL_MS = 3 * 60_000

const ROTULO: Record<Rodada['resultado'], { texto: string; classe: string }> = {
  IMPORTADA:   { texto: 'Importou',     classe: 'bg-emerald-900/40 text-emerald-300' },
  SEM_MUDANCA: { texto: 'Conferido · sem mudança', classe: 'bg-sky-900/40 text-sky-300' },
  SEM_SESSAO:  { texto: 'TOA deslogou', classe: 'bg-amber-900/40 text-amber-300' },
  ERRO:        { texto: 'Erro',         classe: 'bg-af-900/40 text-af-300' },
}

const hora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
const quando = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'
function ha(ts: string | null, agora: number): string {
  if (!ts) return 'nunca'
  const s = Math.max(0, Math.round((agora - new Date(ts).getTime()) / 1000))
  if (s < 60) return `há ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  return `há ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
}

export default function Sincronismo() {
  const { ehGestor, temPapel } = useAuth()
  const { ativa } = useCidades()
  const souRobo = temPapel('ROBO')
  const podeConfigurar = ehGestor || temPapel('CONTROLADOR')
  const souAdmin = temPapel('ADMIN')

  const [cfg, setCfg] = useState<Config | null>(null)
  const [buckets, setBuckets] = useState<Bucket[] | null>(null)
  const [rodadas, setRodadas] = useState<Rodada[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [agora, setAgora] = useState(Date.now())

  const carregar = useCallback(async () => {
    // O RLS já devolve só a cidade ativa — sem filtro de tela.
    const [c, b, r] = await Promise.all([
      supabase.from('sincronismo')
        .select(`base_id, ligado, intervalo_min, configurado_em, executor_visto_em,
                 executor_info, toa_sessao, toa_sessao_em, configurador:configurado_por ( nome ),
                 executor:executor_id ( nome )`)
        .maybeSingle(),
      supabase.from('toa_bucket').select('id, nome, ativo, numero_toa, sincronizar').order('nome'),
      supabase.from('sincronismo_rodada')
        .select(`id, bucket, dia, iniciada_em, terminada_em, resultado, mensagem, linhas,
                 importacao:importacao_id ( qtd_criadas, qtd_atualizadas, qtd_erro )`)
        .order('terminada_em', { ascending: false }).limit(40),
    ])
    const falha = c.error ?? b.error ?? r.error
    setErro(falha ? falha.message : null)
    setCfg((c.data ?? null) as unknown as Config | null)
    setBuckets((b.data ?? []) as Bucket[])
    setRodadas((r.data ?? []) as unknown as Rodada[])
  }, [])

  // A tela de quem opera relê a cada 30 s: sem Realtime, que é conexão do
  // teto do plano Free (D-119), e meio minuto basta para "está vivo?".
  useEffect(() => {
    carregar()
    const t = setInterval(() => { carregar(); setAgora(Date.now()) }, 30_000)
    const r = setInterval(() => setAgora(Date.now()), 5_000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [carregar])

  return (
    <Shell>
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold">Sincronismo com o TOA</h1>
          <p className="mt-1 text-sm text-graf-400">
            Um computador com a extensão "AFLINE — ponte com o TOA" e o TOA aberto baixa a planilha
            de Atividades de cada bucket marcado e importa sozinho, com o login de quem está nele, em{' '}
            <strong className="text-graf-200">{ativa?.nome ?? 'nenhuma cidade escolhida'}</strong>,
            no dia de hoje — pelo mesmo caminho da importação manual. Planilha igual à última não
            é importada de novo (a não ser que faça mais de 1 hora).
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        <Estado cfg={cfg} rodadas={rodadas} agora={agora} />

        {(podeConfigurar || souRobo) && ativa && (
          <Executor baseId={ativa.id} dedicado={souRobo && !podeConfigurar} aoRodar={carregar} />
        )}

        {podeConfigurar && ativa && buckets && (
          <Configuracao baseId={ativa.id} cfg={cfg} buckets={buckets}
            souAdmin={souAdmin} aoSalvar={carregar} />
        )}

        <Historico rodadas={rodadas} />
      </div>
    </Shell>
  )
}

/* ─────────────────────────── o estado, para todos ─────────────────────────── */

function Estado({ cfg, rodadas, agora }: { cfg: Config | null; rodadas: Rodada[]; agora: number }) {
  const visto = cfg?.executor_visto_em ? new Date(cfg.executor_visto_em).getTime() : null
  const semSinal = visto == null || agora - visto > SEM_SINAL_MS
  const ultima = rodadas[0] ?? null
  const quem = cfg?.executor?.nome ?? 'alguém'

  let tom: 'ok' | 'aviso' | 'erro' | 'info'
  let titulo: string
  let detalhe: string
  if (!cfg || !cfg.ligado) {
    tom = 'info'; titulo = 'Desligado'
    detalhe = 'Nada é importado sozinho. A importação manual continua funcionando como sempre.'
  } else if (visto == null) {
    tom = 'aviso'; titulo = 'Ligado, mas nenhum computador está sincronizando'
    detalhe = 'Num computador com a extensão instalada e o TOA aberto, abra esta tela e clique em "Sincronizar por este computador".'
  } else if (semSinal) {
    tom = 'erro'; titulo = `Sem sinal ${ha(cfg.executor_visto_em, agora)}`
    detalhe = `O computador de ${quem} desligou, suspendeu, perdeu a internet ou fechou esta tela. `
      + 'Nada está sendo importado até outro computador assumir.'
  } else if (cfg.toa_sessao === 'CAIU') {
    tom = 'erro'; titulo = `A sessão do TOA caiu (${hora(cfg.toa_sessao_em)})`
    detalhe = `O computador de ${quem} está ligado, mas o TOA pediu login de novo. Entre no TOA nesse computador.`
  } else {
    tom = 'ok'; titulo = `Sincronizando a cada ${cfg.intervalo_min} min, pelo computador de ${quem}`
    const imp = rodadas.find(r => r.resultado === 'IMPORTADA')
    detalhe = `Último pulso ${ha(cfg.executor_visto_em, agora)}.`
      + (imp ? ` Última importação às ${hora(imp.terminada_em)}`
               + (imp.importacao ? ` (${imp.importacao.qtd_atualizadas ?? 0} atualizados, ${imp.importacao.qtd_criadas ?? 0} novos)` : '')
               + '.' : '')
      + (ultima ? ` Última rodada às ${hora(ultima.terminada_em)} (${ultima.bucket}: ${ROTULO[ultima.resultado].texto.toLowerCase()}).` : '')
  }

  return (
    <Alerta tipo={tom}>
      <p className="font-medium">{titulo}</p>
      <p className="mt-0.5">{detalhe}</p>
      {cfg?.configurado_em && (
        <p className="mt-1 text-xs opacity-80">
          Configurado por {cfg.configurador?.nome ?? 'alguém'} em {quando(cfg.configurado_em)}
          {cfg.executor_info && !semSinal ? ` · ${cfg.executor_info}` : ''}
        </p>
      )}
    </Alerta>
  )
}

/* ─────────────────────── a configuração, para quem opera ───────────────────── */

function Configuracao({ baseId, cfg, buckets, souAdmin, aoSalvar }: {
  baseId: string; cfg: Config | null; buckets: Bucket[]; souAdmin: boolean; aoSalvar: () => void
}) {
  const [ligado, setLigado] = useState(cfg?.ligado ?? false)
  const [intervalo, setIntervalo] = useState<number>(cfg?.intervalo_min ?? 30)
  const [marcados, setMarcados] = useState<string[]>(buckets.filter(b => b.sincronizar).map(b => b.id))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // Quando outra pessoa salva, a tela relê — e o formulário acompanha, a
  // menos que ESTA pessoa esteja no meio de uma edição.
  const editando = useRef(false)
  useEffect(() => {
    if (editando.current) return
    setLigado(cfg?.ligado ?? false)
    setIntervalo(cfg?.intervalo_min ?? 30)
    setMarcados(buckets.filter(b => b.sincronizar).map(b => b.id))
  }, [cfg, buckets])

  const mexer = <T,>(f: (v: T) => void) => (v: T) => { editando.current = true; setOk(null); f(v) }

  async function salvar() {
    setSalvando(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('configurar_sincronismo', {
      p_base: baseId, p_ligado: ligado, p_intervalo: intervalo, p_buckets: marcados,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    editando.current = false
    setOk(ligado ? `Ligado: a cada ${intervalo} min.` : 'Desligado.')
    aoSalvar()
  }

  return (
    <section className="card-controle p-4">
      <h2 className="text-sm font-semibold">Configuração</h2>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={ligado}
            onChange={e => mexer(setLigado)(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-af-600)]" />
          Sincronismo ligado
        </label>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Intervalo</legend>
          <span className="mr-1 text-xs text-graf-400">Importar a cada</span>
          {INTERVALOS.map(m => (
            <button key={m} type="button" aria-pressed={intervalo === m}
              onClick={() => mexer(setIntervalo)(m)}
              className={`rounded-md border px-2.5 py-1.5 text-xs ${
                intervalo === m ? 'border-af-600 bg-af-600/15 text-af-200'
                                : 'border-graf-700 text-graf-300 hover:bg-graf-800'}`}>
              {m === 60 ? '1 hora' : `${m} min`}
            </button>
          ))}
        </fieldset>
      </div>

      <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-graf-400">
        Buckets que o sincronismo baixa
      </p>
      {buckets.length === 0 ? (
        <p className="text-sm text-graf-400">
          Nenhum bucket cadastrado nesta cidade. O ADMIN cadastra em Configurações › Buckets do TOA.
        </p>
      ) : (
        <ul className="divide-y divide-graf-800 rounded-lg border border-graf-800">
          {buckets.map(b => (
            <LinhaBucket key={b.id} b={b} souAdmin={souAdmin}
              marcado={marcados.includes(b.id)}
              alternar={() => mexer(setMarcados)(
                marcados.includes(b.id) ? marcados.filter(x => x !== b.id) : [...marcados, b.id])}
              aoMudarNumero={aoSalvar} />
          ))}
        </ul>
      )}

      {erro && <div className="mt-3"><Alerta tipo="erro">{erro}</Alerta></div>}
      {ok && <div className="mt-3"><Alerta tipo="ok">{ok}</Alerta></div>}

      <button onClick={salvar} disabled={salvando}
        className="mt-4 rounded-lg bg-af-600 px-5 py-2 text-sm font-semibold text-white
                   hover:bg-af-500 disabled:opacity-50">
        {salvando ? 'Salvando…' : 'Salvar'}
      </button>
    </section>
  )
}

function LinhaBucket({ b, marcado, alternar, souAdmin, aoMudarNumero }: {
  b: Bucket; marcado: boolean; alternar: () => void; souAdmin: boolean; aoMudarNumero: () => void
}) {
  const [numero, setNumero] = useState(b.numero_toa?.toString() ?? '')
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => { setNumero(b.numero_toa?.toString() ?? '') }, [b.numero_toa])
  // Sem número não há o que pedir ao TOA; desligado, a importação recusaria.
  const disponivel = b.ativo && b.numero_toa != null

  async function salvarNumero() {
    setErro(null)
    const n = numero.trim() === '' ? null : Number(numero)
    if (n != null && (!Number.isInteger(n) || n <= 0)) { setErro('Use só o número, ex.: 32041.'); return }
    const { error } = await supabase.rpc('definir_numero_toa', { p_bucket: b.id, p_numero: n })
    if (error) { setErro(error.message); return }
    aoMudarNumero()
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
      <label className={`flex min-w-56 items-center gap-2 ${disponivel ? 'cursor-pointer' : 'opacity-60'}`}>
        <input type="checkbox" checked={marcado && disponivel} disabled={!disponivel}
          onChange={alternar} className="h-4 w-4 accent-[var(--color-af-600)]" />
        <span className="font-mono text-xs">{b.nome}</span>
      </label>
      <span className="text-xs text-graf-400">
        {!b.ativo ? 'bucket desligado'
          : b.numero_toa != null ? <>nº no TOA <span className="tabular text-graf-300">{b.numero_toa}</span></>
          : <span className="text-amber-300">sem o número do TOA — não dá para baixar</span>}
      </span>
      {souAdmin && (
        <span className="ml-auto flex items-center gap-1.5">
          <input value={numero} onChange={e => setNumero(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric" placeholder="nº no TOA" aria-label={`Número de ${b.nome} no TOA`}
            className="tabular w-24 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs
                       outline-none focus:border-af-500" />
          <button onClick={salvarNumero} disabled={numero === (b.numero_toa?.toString() ?? '')}
            className="rounded border border-graf-700 px-2 py-1 text-[11px] text-graf-300
                       hover:border-af-600 hover:text-af-400 disabled:opacity-40">
            gravar
          </button>
        </span>
      )}
      {erro && <p className="w-full text-xs text-af-300">{erro}</p>}
    </li>
  )
}

/* ─────────────────────── este computador sincroniza ─────────────────────── */

interface LinhaLog { em: number; texto: string; tom: 'ok' | 'erro' | 'info' }

/**
 * "Este computador sincroniza" é escolha de quem está NESTE computador —
 * fica no navegador, como o tema (conforto de quem olha, não dado da
 * operação). Quem decide de quem é a VEZ é o servidor.
 */
const chaveEstePc = (base: string) => `afline:sincronismo-este-pc:${base}`
function lerEstePc(base: string): boolean {
  try { return localStorage.getItem(chaveEstePc(base)) === '1' } catch { return false }
}
function gravarEstePc(base: string, sim: boolean) {
  try {
    if (sim) localStorage.setItem(chaveEstePc(base), '1')
    else localStorage.removeItem(chaveEstePc(base))
  } catch { /* sem storage: vale só enquanto a aba estiver aberta */ }
}

function Executor({ baseId, dedicado, aoRodar }: {
  baseId: string
  /** Login do papel ROBO (opcional): o computador dele só existe para isto. */
  dedicado: boolean
  aoRodar: () => void
}) {
  const { perfil } = useAuth()
  const [ext, setExt] = useState<InfoExtensao | null | undefined>(undefined)
  const [estePc, setEstePc] = useState(() => dedicado || lerEstePc(baseId))
  const [ordem, setOrdem] = useState<Ordem | null>(null)
  const [log, setLog] = useState<LinhaLog[]>([])
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [vigilia, setVigilia] = useState<boolean | null>(null)
  /** O que a última rodada deste computador fez, bucket a bucket — à vista. */
  const [resultado, setResultado] = useState<LinhaLog[] | null>(null)
  const rodando = useRef(false)
  const agora = Date.now()

  const anotar = useCallback((texto: string, tom: LinhaLog['tom'] = 'info') =>
    setLog(l => [{ em: Date.now(), texto, tom }, ...l].slice(0, 40)), [])

  async function registrar(base: string, bucketId: string, dia: string, iniciada: string,
                           resultado: Rodada['resultado'], extra: {
                             mensagem?: string; importacao?: string | null; impressao?: string; linhas?: number
                           } = {}) {
    const { error } = await supabase.rpc('sincronismo_registrar_rodada', {
      p_base: base, p_bucket: bucketId, p_dia: dia, p_iniciada_em: iniciada, p_resultado: resultado,
      p_mensagem: extra.mensagem ?? null, p_importacao: extra.importacao ?? null,
      p_impressao: extra.impressao ?? null, p_linhas: extra.linhas ?? null,
    })
    if (error) anotar(`Não consegui registrar a rodada: ${error.message}`, 'erro')
  }

  /**
   * Uma rodada de um bucket: exporta, lê, compara, importa, registra.
   * Devolve a frase do resultado, para a tela dizer o que aconteceu —
   * "sem mudança" calado parecia que nada tinha rodado (Emanuel, 19/10).
   * `forcar` (o botão "Importar agora") importa mesmo com a planilha igual:
   * quem clica quer importar; pular o igual é economia das rodadas sozinhas.
   */
  async function rodarBucket(b: Ordem['buckets'][number], dia: string, forcar: boolean): Promise<LinhaLog> {
    const fim = (texto: string, tom: LinhaLog['tom']): LinhaLog => {
      anotar(texto, tom); return { em: Date.now(), texto, tom }
    }
    const iniciada = new Date().toISOString()
    setOcupado(`${b.nome}: baixando do TOA…`)
    const r = await exportarDoToa(b.numero_toa, dia)
    if (!r.ok) {
      await registrar(baseId, b.id, dia, iniciada, r.motivo === 'SEM_SESSAO' ? 'SEM_SESSAO' : 'ERRO',
                      { mensagem: r.mensagem })
      return fim(`${b.nome}: ${r.mensagem}`, 'erro')
    }
    const nome = r.nome ?? nomePadrao(b.nome, dia)
    // O nome que o TOA deu diz de que bucket o arquivo é DE VERDADE: um
    // número errado no cadastro apareceria aqui, e não como contratos de
    // um bucket entrando no lugar de outro.
    const doNome = bucketDoNome(nome)
    if (doNome && doNome !== b.nome) {
      const msg = `O número ${b.numero_toa} no TOA é do bucket ${doNome}, não de ${b.nome}. Corrija o número nesta tela.`
      await registrar(baseId, b.id, dia, iniciada, 'ERRO', { mensagem: msg })
      return fim(msg, 'erro')
    }

    setOcupado(`${b.nome}: lendo a planilha…`)
    let linhas
    try {
      const leitura = await lerPlanilhaTOA(new File([r.bytes], nome))
      const problemas = validarPlanilha(leitura)
      if (leitura.linhas.length === 0) {
        await registrar(baseId, b.id, dia, iniciada, 'SEM_MUDANCA',
                        { mensagem: 'Planilha sem nenhuma atividade.', linhas: 0 })
        return fim(`${b.nome}: conferido — o TOA não tem atividade neste bucket hoje.`, 'info')
      }
      if (problemas.length) throw new Error(problemas.join(' '))
      linhas = leitura.linhas
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não consegui ler a planilha.'
      // "A planilha está vazia" é o TOA sem atividade, não defeito.
      const vazia = /vazia/i.test(msg)
      await registrar(baseId, b.id, dia, iniciada, vazia ? 'SEM_MUDANCA' : 'ERRO',
                      { mensagem: vazia ? 'Planilha sem nenhuma atividade.' : msg, linhas: vazia ? 0 : undefined })
      return fim(vazia ? `${b.nome}: conferido — o TOA não tem atividade neste bucket hoje.` : `${b.nome}: ${msg}`,
                 vazia ? 'info' : 'erro')
    }

    const impressao = await impressaoDasLinhas(linhas)
    if (!forcar && b.impressao && b.impressao === impressao) {
      await registrar(baseId, b.id, dia, iniciada, 'SEM_MUDANCA', { impressao, linhas: linhas.length })
      return fim(`${b.nome}: conferido no TOA — as ${linhas.length} atividades estão iguais às da última `
        + 'importação. Os contratos já estão em dia.', 'ok')
    }

    try {
      const res = await importarLinhasToa({
        linhas, arquivoNome: nome, baseId, dia, usuarioId: perfil?.id ?? null,
        origem: 'sincronismo', impressao,
        aoAvancar: (_e, n) => setOcupado(`${b.nome}: importando (${n}/${linhas.length})…`),
      })
      const s = res.resumo
      await registrar(baseId, b.id, dia, iniciada, 'IMPORTADA',
                      { importacao: res.importacaoId, impressao, linhas: linhas.length })
      return fim(`${b.nome}: importado com sucesso — ${linhas.length} atividades, ${s.criadas} novas, `
        + `${s.atualizadas} atualizadas` + (s.erros ? `, ${s.erros} com erro` : '')
        + (res.reconciliou ? '.' : '. A segunda parte (TEC1, jornada) não terminou; a próxima rodada refaz.')
        // 116 (D-191): o que saiu do TOA e o que voltou.
        + (res.desatribuicao?.desatribuidos ? ` ${res.desatribuicao.desatribuidos} saíram do TOA e foram desatribuídos (cód. 800).` : '')
        + (res.desatribuicao?.devolvidos ? ` ${res.desatribuicao.devolvidos} voltaram e estão de novo Na entrada.` : '')
        + (res.desatribuicao === null ? ' A conferência do que saiu do TOA não terminou; a próxima rodada confere.' : ''),
        s.erros ? 'erro' : 'ok')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha na importação.'
      await registrar(baseId, b.id, dia, iniciada, 'ERRO', {
        mensagem: msg, importacao: e instanceof ErroImportacao ? e.importacaoId : null, linhas: linhas.length,
      })
      return fim(`${b.nome}: ${msg}`, 'erro')
    }
  }

  /**
   * O ciclo: pulso → ordem do servidor → os buckets vencidos (ou todos, se
   * `forcar`). Se a vez é de outro computador vivo, o servidor devolve
   * `outro` e nenhum bucket: este fica de reserva (113).
   */
  const ciclo = useCallback(async (forcar = false, modo: 'PULSO' | 'ASSUMIR' = 'PULSO') => {
    if (rodando.current) return
    rodando.current = true
    try {
      const e = await extensaoPresente()
      setExt(e)
      // Sem extensão este computador não tem o que fazer: nem pega a vez,
      // para não tirá-la de quem consegue sincronizar.
      if (!e) return
      const navegador = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[0] ?? 'navegador'
      const { data, error } = await supabase.rpc('sincronismo_pulso', {
        p_base: baseId, p_info: `extensão ${e.versao} · ${navegador}`, p_modo: modo,
      })
      if (error) { anotar(`Pulso recusado: ${error.message}`, 'erro'); return }
      const o = data as Ordem
      setOrdem(o)
      if (modo === 'ASSUMIR') anotar('Este computador assumiu o sincronismo.', 'ok')
      // Desligado é desligado, inclusive para o "Importar agora": quem decide
      // é quem configura, não quem está na frente do computador.
      if (!o.ligado || o.outro) return
      const fila = o.buckets.filter(b => forcar || b.vencido)
      const feitos: LinhaLog[] = []
      for (const b of fila) feitos.push(await rodarBucket(b, o.hoje, forcar))
      if (fila.length) { setResultado(feitos); aoRodar() }
    } finally {
      rodando.current = false
      setOcupado(null)
    }
    // rodarBucket lê só props estáveis (baseId, perfil) e setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, anotar, aoRodar])

  // Fora do sincronismo, a tela só pergunta se a extensão está aqui — para
  // oferecer o botão a quem pode usá-lo.
  useEffect(() => {
    if (!estePc) extensaoPresente().then(setExt)
  }, [estePc])

  // O relógio: um pulso por minuto, só neste computador e só se a pessoa
  // escolheu. Aba em segundo plano o Chrome segura a no máximo um disparo
  // por minuto — é por isso que o pulso é de 60 s, e não de 10.
  useEffect(() => {
    if (!estePc) return
    ciclo()
    const t = setInterval(() => ciclo(), 60_000)
    return () => clearInterval(t)
  }, [ciclo, estePc])

  function comecar() {
    gravarEstePc(baseId, true)
    setEstePc(true)
  }
  async function parar() {
    gravarEstePc(baseId, false)
    setEstePc(false)
    setOrdem(null)
    // Devolve a vez já, para outro computador não esperar os 3 min.
    await supabase.rpc('sincronismo_pulso', { p_base: baseId, p_modo: 'SOLTAR' })
    anotar('Este computador parou de sincronizar.')
    aoRodar()
  }

  // Pede ao sistema para não apagar a tela nem suspender enquanto esta aba
  // estiver à frente. Não impede suspender por energia, e some se a aba sair
  // da frente: por isso a tela avisa.
  useEffect(() => {
    if (!estePc) return
    let trava: WakeLockSentinel | null = null
    async function pedir() {
      try {
        if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) { setVigilia(false); return }
        trava = await navigator.wakeLock.request('screen')
        setVigilia(true)
        trava.addEventListener('release', () => setVigilia(false))
      } catch { setVigilia(false) }
    }
    pedir()
    document.addEventListener('visibilitychange', pedir)
    return () => { document.removeEventListener('visibilitychange', pedir); trava?.release().catch(() => {}) }
  }, [estePc])

  const instrucao = (
    <>Instale pela pasta <code>extensao-toa</code> do projeto (Chrome › Extensões › Modo do
      desenvolvedor › Carregar sem compactação), entre no TOA neste Chrome e recarregue esta página.</>
  )

  // Ainda não sincroniza por aqui: só o convite — ou a explicação de
  // como chegar nele.
  if (!estePc) {
    if (ext === undefined) return null
    return (
      <section className="card-controle p-4">
        <h2 className="text-sm font-semibold">Sincronizar por este computador</h2>
        {ext ? (
          <>
            <p className="mt-1 text-sm text-graf-300">
              A extensão está instalada neste Chrome ({ext.versao}). Com o TOA aberto aqui, este
              computador pode baixar e importar sozinho, com o seu login. Um computador sincroniza
              por vez; se outro já estiver, este fica de reserva e assume se o outro parar.
            </p>
            <button onClick={comecar}
              className="mt-3 rounded-lg bg-af-600 px-4 py-2 text-sm font-semibold text-white hover:bg-af-500">
              Sincronizar por este computador
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-graf-400">
            Para este computador sincronizar, ele precisa da extensão "AFLINE — ponte com o TOA". {instrucao}
          </p>
        )}
      </section>
    )
  }

  const espera = ordem?.outro ?? null

  return (
    <section className="card-controle p-4 ring-1 ring-af-600/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            {espera ? 'Este computador está de reserva' : 'Este computador sincroniza'}
          </h2>
          <p className="mt-0.5 text-xs text-graf-400">
            {espera
              ? <>A vez é de <strong className="text-graf-200">{espera.nome ?? 'outro computador'}</strong> (pulso {ha(espera.visto_em, agora)}).
                  Se ele parar por 3 min, este assume sozinho.</>
              : 'Deixe esta aba aberta. O computador não pode desligar nem suspender, e o TOA tem de estar aberto neste Chrome.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {espera ? (
            <button onClick={() => ciclo(false, 'ASSUMIR')} disabled={!!ocupado || !ext}
              className="rounded-lg border border-af-600 px-3 py-1.5 text-xs font-medium text-af-200
                         hover:bg-af-600/15 disabled:opacity-50">
              Assumir agora
            </button>
          ) : (
            <button onClick={() => ciclo(true)} disabled={!!ocupado || !ext || !ordem?.ligado}
              title="Baixa do TOA e importa agora, mesmo que nada tenha mudado"
              className="rounded-lg border border-af-600 px-3 py-1.5 text-xs font-medium text-af-200
                         hover:bg-af-600/15 disabled:opacity-50">
              Importar agora
            </button>
          )}
          {!dedicado && (
            <button onClick={parar} disabled={!!ocupado}
              className="rounded-lg border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-50">
              Parar neste computador
            </button>
          )}
        </div>
      </div>

      <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-3">
        <li className="rounded-lg bg-graf-900 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-graf-400">Extensão</p>
          <p className={ext ? 'text-emerald-400' : ext === null ? 'text-af-300' : 'text-graf-400'}>
            {ext ? `instalada (${ext.versao})` : ext === null ? 'não encontrada' : 'procurando…'}
          </p>
        </li>
        <li className="rounded-lg bg-graf-900 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-graf-400">Ordem do servidor</p>
          <p className="text-graf-200">
            {!ordem ? 'aguardando o primeiro pulso…'
              : !ordem.ligado ? 'desligado — esperando alguém ligar'
              : ordem.outro ? 'de reserva'
              : `${ordem.buckets.length} bucket(s), a cada ${ordem.intervalo_min} min`}
          </p>
        </li>
        <li className="rounded-lg bg-graf-900 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-graf-400">Tela acesa</p>
          <p className={vigilia ? 'text-emerald-400' : 'text-amber-300'}>
            {vigilia ? 'sim, enquanto a aba estiver à frente' : vigilia === false ? 'não — deixe esta aba à frente' : '…'}
          </p>
        </li>
      </ul>

      {resultado && !ocupado && (
        <div className="mt-3">
          <Alerta tipo={resultado.some(r => r.tom === 'erro') ? 'erro' : 'ok'}>
            <p className="font-medium">
              Última rodada às {new Date(resultado[0]?.em ?? agora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {resultado.map((r, k) => <li key={k}>{r.texto}</li>)}
            </ul>
          </Alerta>
        </div>
      )}

      {ext === null && (
        <div className="mt-3">
          <Alerta tipo="erro">
            A extensão "AFLINE — ponte com o TOA" não respondeu nesta aba. {instrucao}
          </Alerta>
        </div>
      )}

      {ocupado && (
        <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-sm text-graf-200">
          <span aria-hidden className="h-4 w-4 rounded-full border-2 border-af-600/25 border-t-af-500
                                       motion-safe:animate-spin" />
          {ocupado}
        </p>
      )}

      {log.length > 0 && (
        <ol className="mt-3 max-h-56 space-y-0.5 overflow-y-auto rounded-lg bg-graf-950/50 p-2 text-xs">
          {log.map((l, k) => (
            <li key={k} className={l.tom === 'erro' ? 'text-af-300' : l.tom === 'ok' ? 'text-emerald-300' : 'text-graf-300'}>
              <span className="tabular text-graf-400">{new Date(l.em).toLocaleTimeString('pt-BR')}</span>{' '}
              {l.texto}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/* ─────────────────────────── o histórico ─────────────────────────── */

/** "346 atividades conferidas no TOA — iguais à importação das 20:44; contratos em dia." */
function semMudanca(r: Rodada, todas: Rodada[]): string {
  // A lista vem da mais nova para a mais velha: a importação de referência é
  // a primeira IMPORTADA do mesmo bucket DEPOIS desta na lista.
  const i = todas.indexOf(r)
  const ref = todas.slice(i + 1).find(x => x.bucket === r.bucket && x.resultado === 'IMPORTADA')
  return `${r.linhas ?? '—'} atividades conferidas no TOA — iguais `
    + (ref ? `à importação das ${hora(ref.terminada_em)}` : 'à última importação')
    + '; contratos em dia.'
}

function Historico({ rodadas }: { rodadas: Rodada[] }) {
  return (
    <section className="card-controle overflow-hidden">
      <div className="border-b border-graf-800 px-4 py-3">
        <h2 className="text-sm font-semibold">Rodadas do sincronismo</h2>
        <p className="mt-0.5 text-xs text-graf-400">
          Cada tentativa, inclusive as que não viraram importação. As importações também aparecem
          no histórico de Importar TOA, em nome de quem estava sincronizando.
        </p>
      </div>
      {rodadas.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-graf-400">Nenhuma rodada ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px] uppercase
                              tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Quando</th>
                <th className="px-3 py-2 font-medium">Bucket</th>
                <th className="px-3 py-2 font-medium">Resultado</th>
                <th className="px-3 py-2 font-medium">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {rodadas.map(r => (
                <tr key={r.id} className="border-b border-graf-800 align-top">
                  <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-graf-400">{quando(r.terminada_em)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.bucket}</td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium ${ROTULO[r.resultado].classe}`}>
                      {ROTULO[r.resultado].texto}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-graf-300">
                    {r.resultado === 'IMPORTADA' && r.importacao
                      ? <>
                          <span className="tabular">{r.linhas ?? '—'}</span> atividades ·{' '}
                          <span className="tabular text-emerald-400">{r.importacao.qtd_criadas ?? 0}</span> novas ·{' '}
                          <span className="tabular text-sky-400">{r.importacao.qtd_atualizadas ?? 0}</span> atualizadas
                          {(r.importacao.qtd_erro ?? 0) > 0 && (
                            <> · <span className="tabular text-af-400">{r.importacao.qtd_erro}</span> erros</>
                          )}
                        </>
                      : r.mensagem ?? (r.resultado === 'SEM_MUDANCA'
                          ? semMudanca(r, rodadas)
                          : r.linhas != null ? `${r.linhas} atividades` : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
