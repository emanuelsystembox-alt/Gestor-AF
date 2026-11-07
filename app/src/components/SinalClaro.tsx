import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * O sinal do contrato, lido do Portal Técnico da Claro (222, 223; D-330, D-331).
 *
 * > "quero mostrar em cada contrato, se os niveis estão regular ou
 * >  irregulares, antes e depois da visita (...) e trazer o status de
 * >  pendente, que no caso ele não validou sinal" — Emanuel, 06/11
 * > "é bom mostrar o que ficou fora, se é Virtua, ou TV (...) colocar o
 * >  sinal dele antes e depois" — Emanuel, 06/11
 *
 * ANTES = o Diagnóstico Inicial do portal; DEPOIS = a Validação. O rótulo
 * (Nível Regular/Irregular/Pendente) e a cor de cada canal são da CLARO.
 * O "o que ficou fora" por tipo (`*_resumo`, 223) é o pior aparelho daquele
 * tipo: FORA = canal vermelho da Claro; OFFLINE; ERRO de coleta; OK.
 *
 * Por decisão do Emanuel, só mostra: não avisa e não trava a baixa.
 * Sem registro = o portal ainda não foi lido — o aviso some (regra 6).
 */

type Estado = 'FORA' | 'OFFLINE' | 'ERRO' | 'OK'
interface ResumoTipo { tipo: string; estado: Estado }

/** O resumo que a linha do contrato embute (`SELECT_CONTRATO`). */
export interface SinalResumo {
  inicial_texto: string | null; inicial_cor: string | null
  validacao_texto: string | null; validacao_cor: string | null
  status_os_texto: string | null
  inicial_resumo?: ResumoTipo[] | null; validacao_resumo?: ResumoTipo[] | null
}

interface Canal {
  frequency?: number | null; centerFrequency?: number | null
  txLevel?: number | null; rxLevel?: number | null; snrLevel?: number | null
  signalColor?: { type?: number; color?: string } | null
}
interface Equipamento {
  etapa: string | null; etapa_tipo: number | null; tipo: string | null; status: string | null
  modelo: string | null; mac: string | null; tecnologia: string | null; coletado_em: string | null
  upstreams: Canal[]; downstreams: Canal[]; ofdm: Canal[]; ofdma: Canal[]
}
interface Sinal extends SinalResumo {
  pnm_texto: string | null; atendimento_tipo: string | null; tecnologia: string | null
  equipamentos: Equipamento[] | null; equipamentos_lidos_em: string | null; lido_em: string
}

// ── a cor, igual nos dois temas ────────────────────────────────────────
// Bolinha em hex fixo: as faixas 200–400/700–900 invertem no tema claro (D-303).
type Tom = 'ok' | 'ruim' | 'pendente' | 'neutro'
const BOLINHA: Record<Tom, string> = { ok: '#16a34a', ruim: '#dc2626', pendente: '#d97706', neutro: '#64748b' }
const TEXTO: Record<Tom, string> = {
  ok: 'text-emerald-300', ruim: 'text-af-300', pendente: 'text-amber-300', neutro: 'text-graf-300',
}
const CHIP: Record<Tom, string> = {
  ok: 'bg-emerald-900/30 text-emerald-300 ring-emerald-700/50',
  ruim: 'bg-af-900/40 text-af-200 ring-af-700/50',
  pendente: 'bg-amber-900/30 text-amber-300 ring-amber-700/50',
  neutro: 'bg-graf-800 text-graf-300 ring-graf-600',
}

function tomDaCor(cor: string | null | undefined): Tom {
  const c = (cor ?? '').toLowerCase()
  return c === 'green' ? 'ok' : c === 'red' ? 'ruim' : c === 'yellow' ? 'pendente' : 'neutro'
}
const TOM_ESTADO: Record<Estado, Tom> = { FORA: 'ruim', OFFLINE: 'ruim', ERRO: 'pendente', OK: 'ok' }
const ROTULO_ESTADO: Record<Estado, string> = { FORA: 'fora', OFFLINE: 'offline', ERRO: 'erro na coleta', OK: 'ok' }

/** "Nível Irregular" → "Irregular": na lista cabe pouco. */
const rotuloCurto = (t: string | null) => (t ?? '—').replace(/^n[ií]vel\s+/i, '')
/** INTERNET → Internet, TV → TV (o nome é o do portal). */
const nomeTipo = (t: string | null) => !t ? 'Aparelho' : t.length <= 3 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1).toLowerCase()

/** Finalizada no portal e sem validação: o técnico não validou o sinal. */
export const semValidacao = (s: SinalResumo) =>
  tomDaCor(s.validacao_cor) === 'pendente' && (s.status_os_texto ?? '').toLowerCase() === 'finalizada'

const foraDoResumo = (r: ResumoTipo[] | null | undefined) =>
  (r ?? []).filter(x => x.estado !== 'OK').map(x => `${nomeTipo(x.tipo)} ${ROTULO_ESTADO[x.estado]}`)

// ── o aviso da linha do contrato ───────────────────────────────────────
function LinhaEtapa({ rotulo, texto, tom, fora }: { rotulo: string; texto: string; tom: Tom; fora: string[] }) {
  return (
    <span className="flex items-baseline gap-1.5">
      {/* graf-300, não 400: sobre o fundo do aviso o 400 deu 4,39:1 no escuro (reprova; traps.md) */}
      <span className="w-10 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-graf-300">{rotulo}</span>
      <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full"
        style={{ background: BOLINHA[tom] }} />
      <span className={`font-semibold ${TEXTO[tom]}`}>{texto}</span>
      {fora.length > 0 && <span className="text-graf-300">· {fora.join(', ')}</span>}
    </span>
  )
}

/**
 * O aviso do sinal na linha: Antes em cima, Depois embaixo, numa linha
 * própria acima do relógio de execução ("é bom colocar uma em cima e outra
 * embaixo (...) eu quero que fique bonito os aviso" — Emanuel, 06/11).
 */
export function SeloSinal({ sinal }: { sinal: SinalResumo | null | undefined }) {
  if (!sinal) return null
  const falta = semValidacao(sinal)
  const tomAntes = tomDaCor(sinal.inicial_cor)
  const tomDepois = falta ? 'pendente' : tomDaCor(sinal.validacao_cor)
  const foraAntes = foraDoResumo(sinal.inicial_resumo)
  const foraDepois = falta ? [] : foraDoResumo(sinal.validacao_resumo)
  return (
    <span className="block max-w-full">
      <span
        title={`Sinal no portal Claro — antes: ${sinal.inicial_texto ?? '?'}${foraAntes.length ? ` (${foraAntes.join(', ')})` : ''}; `
          + `depois: ${falta ? 'finalizada sem validação' : sinal.validacao_texto ?? '?'}${foraDepois.length ? ` (${foraDepois.join(', ')})` : ''}`}
        className="inline-flex max-w-full flex-col gap-0.5 rounded-md bg-graf-800/60 px-2 py-1
                   text-[10px] leading-tight ring-1 ring-graf-700">
        <LinhaEtapa rotulo="Antes" texto={rotuloCurto(sinal.inicial_texto)} tom={tomAntes} fora={foraAntes} />
        <LinhaEtapa rotulo="Depois" texto={falta ? 'Sem validação' : rotuloCurto(sinal.validacao_texto)}
          tom={tomDepois} fora={foraDepois} />
      </span>
    </span>
  )
}

// ── a aba do contrato ──────────────────────────────────────────────────
export function useSinalClaro(visitaId: string | undefined) {
  const [s, setS] = useState<Sinal | null | undefined>(undefined)
  useEffect(() => {
    if (!visitaId) return
    let vivo = true
    supabase.from('sinal_claro')
      .select('inicial_texto, inicial_cor, validacao_texto, validacao_cor, status_os_texto, pnm_texto, '
        + 'inicial_resumo, validacao_resumo, atendimento_tipo, tecnologia, equipamentos, equipamentos_lidos_em, lido_em')
      .eq('visita_id', visitaId).maybeSingle()
      .then(({ data }) => { if (vivo) setS((data as Sinal | null) ?? null) })
    return () => { vivo = false }
  }, [visitaId])
  return s
}

const quando = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'
const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const canaisDe = (e: Equipamento) => [...e.upstreams, ...e.downstreams, ...e.ofdm, ...(e.ofdma ?? [])]

/** O estado de UM aparelho — a mesma regra de `resumir_sinal` (223). */
function estadoDo(e: Equipamento): Estado {
  if (canaisDe(e).some(c => (c.signalColor?.color ?? '').toUpperCase() === 'RED')) return 'FORA'
  const st = (e.status ?? '').toLowerCase()
  return st === 'offline' ? 'OFFLINE' : st === 'error' ? 'ERRO' : 'OK'
}

/** "mín a máx", e quantos a Claro pintou de vermelho. */
function Faixa({ rotulo, canais, campo }: { rotulo: string; canais: Canal[]; campo: 'txLevel' | 'rxLevel' | 'snrLevel' }) {
  const v = canais.map(c => c[campo]).filter((x): x is number => typeof x === 'number')
  if (!v.length) return null
  const ruins = canais.filter(c => (c.signalColor?.color ?? '').toUpperCase() === 'RED').length
  const min = Math.min(...v), max = Math.max(...v)
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="w-28 shrink-0 text-xs text-graf-400">{rotulo}</span>
      <span className={`tabular ${ruins ? 'text-af-300' : ''}`}>{min === max ? num(min) : `${num(min)} a ${num(max)}`}</span>
      {v.length > 1 && <span className="text-xs text-graf-400">{v.length} canais</span>}
      {ruins > 0 && <span className="text-xs font-semibold text-af-300">{ruins} fora</span>}
    </div>
  )
}

function Canais({ titulo, canais }: { titulo: string; canais: Canal[] }) {
  if (!canais.length) return null
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-graf-400">{titulo}</p>
      <table className="mt-1 w-full text-xs tabular">
        <thead className="text-graf-400">
          <tr><th className="text-left font-normal">Freq.</th><th className="text-right font-normal">Tx</th>
              <th className="text-right font-normal">Rx</th><th className="text-right font-normal">SNR</th></tr>
        </thead>
        <tbody>
          {canais.map((c, k) => (
            <tr key={k} className={(c.signalColor?.color ?? '').toUpperCase() === 'RED' ? 'font-semibold text-af-300' : ''}>
              <td>{num(c.frequency ?? c.centerFrequency)}</td><td className="text-right">{num(c.txLevel)}</td>
              <td className="text-right">{num(c.rxLevel)}</td><td className="text-right">{num(c.snrLevel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Aparelho({ e }: { e: Equipamento }) {
  const [aberto, setAberto] = useState(false)
  const gpon = (e.tecnologia ?? '').toUpperCase() === 'GPON'
  const est = estadoDo(e)
  const temCanal = canaisDe(e).length > 0
  return (
    <div className="rounded-lg border border-graf-800 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${CHIP[TOM_ESTADO[est]]}`}>
          {ROTULO_ESTADO[est]}
        </span>
        <span className="text-sm font-medium">{e.modelo ?? '—'}</span>
        <span className="ml-auto text-xs text-graf-400">coleta {quando(e.coletado_em)}</span>
      </div>
      {e.mac && <p className="mt-1 font-mono text-[11px] text-graf-400">{e.mac}</p>}
      {temCanal && (
        <div className="mt-2 space-y-0.5">
          {gpon ? (
            <>
              <Faixa rotulo="Rx óptico" canais={e.downstreams} campo="rxLevel" />
              <Faixa rotulo="Tx óptico" canais={e.upstreams} campo="txLevel" />
            </>
          ) : (
            <>
              <Faixa rotulo="Upstream Tx" canais={e.upstreams} campo="txLevel" />
              <Faixa rotulo="Downstream Rx" canais={e.downstreams} campo="rxLevel" />
              <Faixa rotulo="Downstream SNR" canais={e.downstreams} campo="snrLevel" />
              <Faixa rotulo="OFDM Rx" canais={e.ofdm} campo="rxLevel" />
              <Faixa rotulo="OFDMA Tx" canais={e.ofdma ?? []} campo="txLevel" />
            </>
          )}
        </div>
      )}
      {!gpon && temCanal && (
        <>
          <button type="button" onClick={() => setAberto(a => !a)}
            className="mt-2 text-xs text-af-400 hover:underline">{aberto ? 'Esconder canais' : 'Ver canais'}</button>
          {aberto && (
            <>
              <Canais titulo="Upstream" canais={e.upstreams} />
              <Canais titulo="Downstream" canais={e.downstreams} />
              <Canais titulo="OFDM" canais={e.ofdm} />
              <Canais titulo="OFDMA" canais={e.ofdma ?? []} />
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Uma coluna (Antes ou Depois) de um tipo. */
function Coluna({ rotulo, aparelhos, vazio }: { rotulo: string; aparelhos: Equipamento[]; vazio: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-graf-400">{rotulo}</p>
      {aparelhos.length === 0
        ? <p className="rounded-lg border border-dashed border-graf-800 p-3 text-xs text-graf-400">{vazio}</p>
        : <div className="space-y-2">{aparelhos.map((e, k) => <Aparelho key={k} e={e} />)}</div>}
    </div>
  )
}

/** Um tipo (Internet, TV): o antes e o depois lado a lado. */
function Tipo({ tipo, antes, depois, depoisVazio }: {
  tipo: string; antes: Equipamento[]; depois: Equipamento[]; depoisVazio: string
}) {
  const pior = (l: Equipamento[]): Estado | null => {
    if (!l.length) return null
    const e = l.map(estadoDo)
    return e.includes('FORA') ? 'FORA' : e.includes('OFFLINE') ? 'OFFLINE' : e.includes('ERRO') ? 'ERRO' : 'OK'
  }
  const a = pior(antes), d = pior(depois)
  const macs = (l: Equipamento[]) => new Set(l.map(e => e.mac).filter(Boolean))
  const ma = macs(antes), md = macs(depois)
  const trocado = ma.size > 0 && md.size > 0 && ![...md].some(m => ma.has(m))
  const Selo = ({ e }: { e: Estado | null }) => e
    ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${CHIP[TOM_ESTADO[e]]}`}>{ROTULO_ESTADO[e]}</span>
    : <span className="text-[11px] text-graf-400">—</span>
  return (
    <section className="card-controle p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{nomeTipo(tipo)}</h2>
        <span className="flex items-center gap-1.5 text-xs text-graf-400">
          <Selo e={a} /><span aria-hidden>→</span><Selo e={d} />
        </span>
        {trocado && (
          <span title="O MAC medido depois não é o mesmo de antes"
            className="ml-auto rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 ring-1 ring-sky-700/40">
            aparelho trocado
          </span>
        )}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Coluna rotulo="Antes" aparelhos={antes} vazio="Sem medição antes." />
        <Coluna rotulo="Depois" aparelhos={depois} vazio={depoisVazio} />
      </div>
    </section>
  )
}

export function SinalClaro({ sinal }: { sinal: Sinal | null | undefined }) {
  if (sinal === undefined) return <p className="text-sm text-graf-400">Carregando…</p>
  if (sinal === null) return (
    <section className="card-controle p-4">
      <p className="text-sm text-graf-300">Este contrato ainda não foi lido do portal da Claro.</p>
    </section>
  )
  const falta = semValidacao(sinal)
  const eq = sinal.equipamentos
  // os tipos na ordem em que aparecem; INTERNET antes de TV
  const tipos = [...new Set((eq ?? []).map(e => e.tipo ?? '?'))].sort((x, y) => x.localeCompare(y))
  const daEtapa = (t: string, etapa: number) => (eq ?? []).filter(e => (e.tipo ?? '?') === t && Number(e.etapa_tipo) === etapa)
  const tomA = tomDaCor(sinal.inicial_cor), tomD = falta ? 'pendente' : tomDaCor(sinal.validacao_cor)
  return (
    <div className="space-y-3">
      {/* o veredito da Claro, antes → depois */}
      <section className="card-controle flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-graf-400">Antes</p>
          <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-semibold ring-1 ${CHIP[tomA]}`}>
            {sinal.inicial_texto ?? '—'}</span>
        </div>
        <span aria-hidden className="text-graf-400">→</span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-graf-400">Depois</p>
          <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-semibold ring-1 ${CHIP[tomD]}`}>
            {falta ? 'Finalizada sem validação' : sinal.validacao_texto ?? '—'}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-graf-300">
          <span>Portal: <b className="font-semibold text-graf-100">{sinal.status_os_texto ?? '—'}</b></span>
          {sinal.tecnologia && <span>{sinal.tecnologia}</span>}
          <span>PNM: {sinal.pnm_texto ?? '—'}</span>
          {sinal.atendimento_tipo === 'Rede externa' && (
            <span className="rounded bg-sky-900/40 px-1.5 py-0.5 font-semibold text-sky-300 ring-1 ring-sky-700/40">Rede externa</span>
          )}
          <span className="text-graf-400">lido {quando(sinal.lido_em)}</span>
        </div>
      </section>

      {eq == null ? (
        <section className="card-controle p-4"><p className="text-xs text-graf-400">Níveis ainda não lidos do portal.</p></section>
      ) : tipos.length === 0 ? (
        <section className="card-controle p-4"><p className="text-xs text-graf-400">O portal não mediu nenhum aparelho.</p></section>
      ) : tipos.map(t => (
        <Tipo key={t} tipo={t} antes={daEtapa(t, 1)} depois={daEtapa(t, 2)}
          depoisVazio={falta ? 'Não validado pelo técnico.' : 'Sem medição depois.'} />
      ))}
    </div>
  )
}
