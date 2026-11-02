import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCidades } from '../lib/cidade'
import { Shell } from '../components/Shell'
import { Alerta } from '../components/ui'
import { extensaoPresente, extensaoAutonoma, type InfoExtensao } from '../lib/ponteToa'

/**
 * Sincronismo com o TOA (111, D-189; por computador desde a 167, D-251).
 *
 * ┌─ esta tela ACOMPANHA; quem configura é a extensão ───────────────┐
 * │ > "quem tiver a extensão ele poderá editar o tempo de importação │
 * │ >  (...) selecionar quais buckets tem disponível no login"       │
 * │ >  — Emanuel, 01/11                                              │
 * │                                                                  │
 * │ Até a 166 esta tela configurava UMA vez por cidade (ligado,      │
 * │ intervalo, buckets) e um computador por cidade tinha a vez.      │
 * │ Desde a 167 cada computador escolhe, no painel da extensão, os   │
 * │ buckets do login dele e os tempos; a vez é por BUCKET            │
 * │ (`sincronismo_bucket_vez`). Aqui se vê, por bucket da cidade,    │
 * │ quem sincroniza, em que ritmo e se está vivo — e o ADMIN acerta  │
 * │ o número do TOA de cada bucket.                                  │
 * │                                                                  │
 * │ Zero e desconhecido (regra 6): sinal parado há mais de 3 min não │
 * │ é "sincronizando" — a tela diz "sem sinal há X min".             │
 * └──────────────────────────────────────────────────────────────────┘
 */

interface Bucket {
  id: string; nome: string; ativo: boolean; numero_toa: number | null
}
interface Vez {
  bucket_id: string; visto_em: string; desde: string; info: string | null
  rota_min: number | null; varredura_min: number | null; toa_sessao: 'OK' | 'CAIU' | null
  executor: { nome: string | null } | null
}
interface Rodada {
  id: string; bucket: string; dia: string; iniciada_em: string; terminada_em: string
  resultado: 'IMPORTADA' | 'SEM_MUDANCA' | 'SEM_SESSAO' | 'ERRO' | 'VARREDURA'
  mensagem: string | null; linhas: number | null
  importacao: { qtd_criadas: number | null; qtd_atualizadas: number | null; qtd_erro: number | null } | null
}

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
const ritmo = (min: number | null) => min == null ? null : min === 60 ? '1 hora' : `${min} min`

export default function Sincronismo() {
  const { ehGestor, temPapel } = useAuth()
  const { ativa } = useCidades()
  const souRobo = temPapel('ROBO')
  const podeVer = ehGestor || temPapel('CONTROLADOR')
  const souAdmin = temPapel('ADMIN')

  const [buckets, setBuckets] = useState<Bucket[] | null>(null)
  const [vezes, setVezes] = useState<Vez[]>([])
  const [rodadas, setRodadas] = useState<Rodada[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [agora, setAgora] = useState(Date.now())

  const carregar = useCallback(async () => {
    // O RLS já devolve só a cidade ativa — sem filtro de tela.
    const [b, v, r] = await Promise.all([
      supabase.from('toa_bucket').select('id, nome, ativo, numero_toa').order('nome'),
      supabase.from('sincronismo_bucket_vez')
        .select('bucket_id, visto_em, desde, info, rota_min, varredura_min, toa_sessao, executor:executor_id ( nome )'),
      supabase.from('sincronismo_rodada')
        .select(`id, bucket, dia, iniciada_em, terminada_em, resultado, mensagem, linhas,
                 importacao:importacao_id ( qtd_criadas, qtd_atualizadas, qtd_erro )`)
        .order('terminada_em', { ascending: false }).limit(40),
    ])
    const falha = b.error ?? v.error ?? r.error
    setErro(falha ? falha.message : null)
    setBuckets((b.data ?? []) as Bucket[])
    setVezes((v.data ?? []) as unknown as Vez[])
    setRodadas((r.data ?? []) as unknown as Rodada[])
  }, [])

  // A tela de quem opera relê a cada 30 s: sem Realtime, que é conexão do
  // teto do plano (D-119), e meio minuto basta para "está vivo?".
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
            Computadores com a extensão "AFLINE — ponte com o TOA" baixam a planilha de Atividades e
            importam sozinhos, pelo mesmo caminho da importação manual. <strong className="text-graf-200">Cada
            computador escolhe no painel da extensão</strong> os buckets do login dele e de quanto em quanto
            tempo importa a rota e varre o TOA; um bucket é sincronizado por um computador por vez. Abaixo,
            os buckets de <strong className="text-graf-200">{ativa?.nome ?? 'nenhuma cidade escolhida'}</strong>.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {(podeVer || souRobo) && <PainelExtensao />}

        {buckets && <Buckets buckets={buckets} vezes={vezes} rodadas={rodadas} agora={agora}
                             souAdmin={souAdmin} aoMudarNumero={carregar} />}

        <Historico rodadas={rodadas} />
      </div>
    </Shell>
  )
}

/* ─────────────────────── os buckets da cidade, e quem sincroniza ─────────────────────── */

function Buckets({ buckets, vezes, rodadas, agora, souAdmin, aoMudarNumero }: {
  buckets: Bucket[]; vezes: Vez[]; rodadas: Rodada[]; agora: number; souAdmin: boolean; aoMudarNumero: () => void
}) {
  return (
    <section className="card-controle p-4">
      <h2 className="text-sm font-semibold">Quem sincroniza cada bucket</h2>
      <p className="mt-0.5 text-xs text-graf-400">
        A vez é de um computador por bucket. Se ele parar por 3 minutos, outro computador que tenha o bucket
        marcado assume sozinho.
      </p>
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-graf-400">
          Nenhum bucket cadastrado nesta cidade. O ADMIN cadastra em Configurações › Buckets do TOA.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-graf-800 rounded-lg border border-graf-800">
          {buckets.map(b => (
            <LinhaBucket key={b.id} b={b} vez={vezes.find(v => v.bucket_id === b.id) ?? null}
              ultima={rodadas.find(r => r.bucket === b.nome) ?? null}
              agora={agora} souAdmin={souAdmin} aoMudarNumero={aoMudarNumero} />
          ))}
        </ul>
      )}
    </section>
  )
}

function LinhaBucket({ b, vez, ultima, agora, souAdmin, aoMudarNumero }: {
  b: Bucket; vez: Vez | null; ultima: Rodada | null; agora: number; souAdmin: boolean; aoMudarNumero: () => void
}) {
  const [numero, setNumero] = useState(b.numero_toa?.toString() ?? '')
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => { setNumero(b.numero_toa?.toString() ?? '') }, [b.numero_toa])

  async function salvarNumero() {
    setErro(null)
    const n = numero.trim() === '' ? null : Number(numero)
    if (n != null && (!Number.isInteger(n) || n <= 0)) { setErro('Use só o número, ex.: 32041.'); return }
    const { error } = await supabase.rpc('definir_numero_toa', { p_bucket: b.id, p_numero: n })
    if (error) { setErro(error.message); return }
    aoMudarNumero()
  }

  const vivo = vez && agora - new Date(vez.visto_em).getTime() <= SEM_SINAL_MS
  let tom: string, texto: string
  if (!b.ativo) { tom = 'text-graf-400'; texto = 'bucket desligado' }
  else if (b.numero_toa == null) { tom = 'text-amber-300'; texto = 'sem o número do TOA — não dá para baixar' }
  else if (!vez) { tom = 'text-graf-400'; texto = 'nenhum computador sincroniza' }
  else if (!vivo) { tom = 'text-af-300'; texto = `sem sinal ${ha(vez.visto_em, agora)} (${vez.executor?.nome ?? 'alguém'})` }
  else if (vez.toa_sessao === 'CAIU') { tom = 'text-af-300'; texto = `${vez.executor?.nome ?? 'alguém'}: a sessão do TOA caiu nesse computador` }
  else {
    tom = 'text-emerald-300'
    texto = `${vez.executor?.nome ?? 'alguém'} · rota a cada ${ritmo(vez.rota_min) ?? '?'}`
      + ` · varredura ${vez.varredura_min ? `a cada ${ritmo(vez.varredura_min)}` : 'só no botão'}`
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
      <span className="w-44 font-mono text-xs">{b.nome}</span>
      <span className="min-w-0 flex-1">
        <span className={`text-xs ${tom}`}>{texto}</span>
        {vivo && (
          <span className="block text-[11px] text-graf-400">
            sinal {ha(vez!.visto_em, agora)}{vez!.info ? ` · ${vez!.info}` : ''}
            {ultima ? ` · última rodada ${hora(ultima.terminada_em)} (${ROTULO[ultima.resultado].texto.toLowerCase()})` : ''}
          </span>
        )}
      </span>
      {souAdmin ? (
        <span className="flex items-center gap-1.5">
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
      ) : b.numero_toa != null && (
        <span className="text-xs text-graf-400">nº no TOA <span className="tabular text-graf-300">{b.numero_toa}</span></span>
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
        logado no TOA. Clique no <strong>ícone da extensão</strong> para entrar com o seu login, ligar
        "Sincronizar por este computador", marcar os buckets do seu login e escolher os tempos da rota
        (5, 15, 30 ou 60 min) e da varredura. O ADMIN enxerga os buckets de todas as cidades; os demais, os
        das cidades que acessam.
      </p>
      <div className="mt-3">
        {ext === undefined ? (
          <p className="text-xs text-graf-400">Procurando a extensão neste Chrome…</p>
        ) : atual ? (
          <Alerta tipo="ok">Este Chrome tem a extensão {ext!.versao}. Use o ícone dela.</Alerta>
        ) : ext ? (
          <Alerta tipo="aviso">
            Este Chrome tem a extensão {ext.versao}, que não sincroniza mais (desde a 0.8.0 a configuração é
            por computador). Atualize: em chrome://extensions clique em recarregar na extensão e recarregue as
            abas do TOA e do PulsoLine.
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
