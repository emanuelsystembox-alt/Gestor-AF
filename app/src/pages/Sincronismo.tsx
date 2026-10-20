import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCidades } from '../lib/cidade'
import { Shell } from '../components/Shell'
import { Alerta } from '../components/ui'
import { extensaoPresente, extensaoAutonoma, type InfoExtensao } from '../lib/ponteToa'

/**
 * Sincronismo com o TOA (111, D-189).
 *
 * ┌─ uma tela que CONFIGURA e ACOMPANHA ─────────────────────────────┐
 * │ > "seria bom ter um botão chamado sincronismo (...) conseguimos  │
 * │ >  escolher quanto e quanto tempo queremos que o sistema         │
 * │ >  importe" — Emanuel, 19/10                                     │
 * │                                                                  │
 * │ Quem OPERA (gestão, controlador) liga, desliga, escolhe o        │
 * │ intervalo e os buckets.                                          │
 * │                                                                  │
 * │ Quem EXECUTA, desde a 0.3.0, é a extensão do Chrome, sozinha (o  │
 * │ fundo dela, com o login de quem entrou na janelinha): bate o     │
 * │ pulso, baixa, importa pelo MESMO núcleo da importação manual e   │
 * │ varre — com esta tela aberta ou não (D-193). Até a 0.2.0 era     │
 * │ esta tela que trabalhava, e parava quando a pessoa saía dela.    │
 * │ (113: "qual quer um que configurar sua maquina, vai conseguir    │
 * │ importar com seu login" — Emanuel.) Quem decide o               │
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
  /** 117: varredura sozinha a cada 30/60 min; nulo = só no botão. */
  varredura_intervalo_min: number | null
}
interface Bucket {
  id: string; nome: string; ativo: boolean; numero_toa: number | null; sincronizar: boolean
}
interface Rodada {
  id: string; bucket: string; dia: string; iniciada_em: string; terminada_em: string
  resultado: 'IMPORTADA' | 'SEM_MUDANCA' | 'SEM_SESSAO' | 'ERRO' | 'VARREDURA'
  mensagem: string | null; linhas: number | null
  importacao: { qtd_criadas: number | null; qtd_atualizadas: number | null; qtd_erro: number | null } | null
}

/** 5 e 10 entraram na 114 (Emanuel, 19/10): o igual não reimporta, e a conferência custa < 1 s. */
const INTERVALOS = [5, 10, 15, 30, 60] as const
/** O pulso é de 60 s; três pulsos perdidos é silêncio de verdade, não atraso. */
const SEM_SINAL_MS = 3 * 60_000

const ROTULO: Record<Rodada['resultado'], { texto: string; classe: string }> = {
  // 118: a varredura (nome, equipamento, miscelânea) também entra no histórico
  VARREDURA:   { texto: 'Varredura',    classe: 'bg-violet-900/40 text-violet-300' },
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
                 executor:executor_id ( nome ), varredura_intervalo_min`)
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

        {(podeConfigurar || souRobo) && <PainelExtensao />}

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
  const [varrendoCfg, setVarrendoCfg] = useState(false)
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

        {/* 117: a varredura do TOA tem o seu próprio ritmo — ela é lenta (uns
            10 s por contrato) e não precisa acompanhar a baixa. Grava na hora. */}
        <label className="flex items-center gap-1.5 text-xs text-graf-400">
          Varredura do TOA
          <select value={cfg?.varredura_intervalo_min ?? ''} disabled={varrendoCfg}
            onChange={async e => {
              setVarrendoCfg(true); setErro(null)
              const v = e.target.value ? Number(e.target.value) : null
              const { error } = await supabase.rpc('configurar_varredura', { p_base: baseId, p_intervalo: v })
              setVarrendoCfg(false)
              if (error) setErro(error.message); else aoSalvar()
            }}
            className="rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs text-graf-100 outline-none focus:border-af-500">
            <option value="">só no botão</option>
            <option value="30">a cada 30 min</option>
            <option value="60">a cada 1 hora</option>
          </select>
        </label>
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

/* ─────────────────────── quem sincroniza: a extensão ─────────────────────── */

/**
 * Desde a 0.3.0 (D-193) quem sincroniza e varre é a EXTENSÃO, sozinha —
 * com a tela do Gestor AF aberta ou não. Esta tela só diz se o Chrome
 * daqui tem a extensão e como usar; a execução não mora mais aqui.
 *
 * > "se eu sair da tela do afline manager, ela meio que para de atualizar"
 * > — Emanuel, 19/10. Era a tela que trabalhava; saiu dela, parou.
 */
function PainelExtensao() {
  const [ext, setExt] = useState<InfoExtensao | null | undefined>(undefined)
  useEffect(() => { extensaoPresente().then(setExt) }, [])
  const atual = ext && extensaoAutonoma(ext)

  return (
    <section className="card-controle p-4">
      <h2 className="text-sm font-semibold">Quem sincroniza: a extensão do Chrome</h2>
      <p className="mt-1 text-sm text-graf-300">
        A extensão "AFLINE — ponte com o TOA" faz tudo sozinha: baixa a planilha, importa e varre nome,
        equipamento e miscelânea — <strong>com esta tela aberta ou não</strong>. Basta o Chrome aberto,
        logado no TOA. Clique no <strong>ícone da extensão</strong> para entrar com o seu login do Gestor AF,
        ligar "Sincronizar por este computador", ver a % e os resultados.
      </p>
      <div className="mt-3">
        {ext === undefined ? (
          <p className="text-xs text-graf-400">Procurando a extensão neste Chrome…</p>
        ) : atual ? (
          <Alerta tipo="ok">Este Chrome tem a extensão {ext!.versao}. Use o ícone dela.</Alerta>
        ) : ext ? (
          <Alerta tipo="aviso">
            Este Chrome tem a extensão {ext.versao}, que ainda dependia desta tela. Atualize: em
            chrome://extensions clique em recarregar na extensão e recarregue as abas do TOA e do Gestor AF.
          </Alerta>
        ) : (
          <Alerta tipo="info">
            Este Chrome não tem a extensão. Para sincronizar por este computador, instale pela pasta{' '}
            <code>extensao-toa</code> do projeto (chrome://extensions › Modo do desenvolvedor › Carregar sem
            compactação).
          </Alerta>
        )}
      </div>
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
