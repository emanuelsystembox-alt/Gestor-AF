import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { isoLocal } from '../lib/formato'
import { CarregandoBloco } from './ui'

/**
 * VT por equipe (234, D-343) — a segunda aba de Indicadores.
 *
 * > "atualizar o indicador VT por equipe, pegando as regras conforme esta
 * >  na planilha, e precisa bater com os numeros (...) opção de colocar os
 * >  F em cima das caixinhas para quando for folga" — Emanuel, 09/11
 *
 * Era a contagem de executados pelo código de baixa (161c). Virou a
 * planilha da operação: por login do TOA e dia, a soma dos pontos da 1ª
 * O.S. de cada atividade finalizada ÷ 35, só nos buckets de VT. O banco
 * devolve o valor de cada dia (`vt_por_equipe_mes`); as contas da
 * planilha — DIAS, MÉDIA, SE, SOMA 1/0, equipes — são feitas AQUI, sobre
 * as linhas, do mesmo jeito que as fórmulas dela:
 *
 *   DIAS = dias com valor · MÉDIA = total ÷ DIAS · SE = MÉDIA ≥ meta (5,7)
 *   SOMA 1 = DIAS de quem tem SE · SOMA 0 = DIAS de quem não tem
 *   EQUIPES REALIZADAS = SOMA 1 ÷ 21
 *   PROJETADAS = realizadas ÷ dias corridos × dias do mês
 *
 * A planilha tinha "DIAS = 30" digitado à mão no lugar dos dias corridos;
 * aqui são os dias do mês até hoje (o mês inteiro, num mês fechado).
 *
 * A escala (F, FE, FALTA, ATES.) é marcada clicando na célula. Dia com VT
 * mostra o número, como na planilha (`SE(valor; valor; escala)`).
 *
 * ┌─ 245 (D-357) · o técnico ETN ──────────────────────────────────────┐
 * │ "clicar em cima do nome e dizer se o Técnico é ETN ou não, o ETN a │
 * │  meta dele é 3 (...) opção de duplicar o login, pois ele pode sair │
 * │  de ETN no dia tal e entrar como técnico normal no dia x" —        │
 * │  Emanuel, 10/11. O ETN é PERÍODO do login (`vt_etn`). Os dias      │
 * │  dentro dele vão para uma segunda linha do mesmo login, com a meta │
 * │  `vt_meta_etn` (3, o $AI$3 da planilha); os de fora ficam na linha │
 * │  normal. Cada linha tem DIAS, MÉDIA e SE próprios — a SOMA muda.   │
 * │                                                                     │
 * │ As cores são as da planilha (formatação condicional): o dia acima  │
 * │ de 6 verde, igual a 6 amarelo, abaixo vermelho; a média contra a   │
 * │ meta. O "6" é a meta arredondada para cima — na linha ETN, 3.      │
 * └─────────────────────────────────────────────────────────────────────┘
 */

const ESCALAS = [
  { c: 'F', r: 'Folga', cor: '#64748b' },
  { c: 'FE', r: 'Férias', cor: '#0369a1' },
  { c: 'FALTA', r: 'Falta', cor: '#dc2626' },
  { c: 'ATES.', r: 'Atestado', cor: '#d97706' },
] as const

/** As cores da formatação condicional da planilha — hex fixo, as mesmas nos
 *  dois temas (o tema claro inverte as faixas 200–400/700–900, D-303). */
const TOM = {
  bom: { fundo: '#c6efce', texto: '#006100' },
  meio: { fundo: '#ffeb9c', texto: '#9c5700' },
  ruim: { fundo: '#ffc7ce', texto: '#9c0006' },
}
const COR_ETN = '#6d28d9'

interface LinhaVt {
  login: string; nome: string | null; equipe: string | null
  por_dia: { dia: string; vt: number; atividades: number }[]
  escala: { dia: string; codigo: string }[]
  sem_ponto: number
}
interface PeriodoEtn { id: string; login: string; de: string; ate: string | null }

const n1 = (x: number | null | undefined) =>
  x == null ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(1).replace('.', ',')
const n2 = (x: number | null) => x == null ? '—' : x.toFixed(2).replace('.', ',')
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

/** O tom de um valor do dia: contra o limite (a meta arredondada para cima). */
function tomDoDia(v: number, limite: number) {
  const r = Math.round(v * 10) / 10
  return r > limite ? TOM.bom : r === limite ? TOM.meio : TOM.ruim
}

export function VtPorEquipe() {
  const { temPapel } = useAuth()
  const podeMarcar = temPapel('ADMIN', 'COP', 'CONTROLADOR', 'SUPERVISOR')
  const hoje = isoLocal(new Date())
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const [linhas, setLinhas] = useState<LinhaVt[]>([])
  const [etns, setEtns] = useState<PeriodoEtn[]>([])
  const [meta, setMeta] = useState(5.7)
  const [metaEtn, setMetaEtn] = useState(3)
  const [diasEquipe, setDiasEquipe] = useState(21)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [menu, setMenu] = useState<{ login: string; dia: string; r: DOMRect } | null>(null)
  const [menuEtn, setMenuEtn] = useState<{ login: string; nome: string; r: DOMRect } | null>(null)

  const dias = useMemo(() => {
    const [a, m] = mes.split('-').map(Number)
    const n = new Date(a, m, 0).getDate()
    return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)
  }, [mes])

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    const ini = `${mes}-01`, fim = dias[dias.length - 1]
    Promise.all([
      supabase.rpc('vt_por_equipe_mes', { p_mes: ini }),
      supabase.rpc('ler_parametro', { p_chave: 'vt_meta_media' }),
      supabase.rpc('ler_parametro', { p_chave: 'vt_dias_equipe' }),
      supabase.rpc('ler_parametro', { p_chave: 'vt_meta_etn' }),
      // os períodos ETN que tocam o mês (RLS: só a cidade ativa)
      supabase.from('vt_etn').select('id, login, de, ate')
        .lte('de', fim).or(`ate.is.null,ate.gte.${ini}`).order('de'),
    ]).then(([l, m, d, me, e]) => {
      if (!vivo) return
      if (l.error) setErro(l.error.message)
      else setLinhas((l.data ?? []) as LinhaVt[])
      if (e.error) setErro(e.error.message)
      else setEtns((e.data ?? []) as PeriodoEtn[])
      if (m.data != null && !isNaN(Number(m.data))) setMeta(Number(m.data))
      if (d.data != null && !isNaN(Number(d.data))) setDiasEquipe(Number(d.data))
      if (me.data != null && !isNaN(Number(me.data))) setMetaEtn(Number(me.data))
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [mes, versao, dias])

  // Dias corridos: o mês até hoje; mês fechado conta inteiro; mês futuro, zero.
  const corridos = mes < hoje.slice(0, 7) ? dias.length
    : mes > hoje.slice(0, 7) ? 0 : Number(hoje.slice(8, 10))

  const calc = useMemo(() => {
    // Um login vira uma ou duas linhas: os dias em período ETN e os de fora.
    const rows = linhas.flatMap(l => {
      const per = etns.filter(p => p.login === l.login)
      const ehEtn = (d: string) => per.some(p => d >= p.de && (p.ate == null || d <= p.ate))
      const monta = (etn: boolean, dentro: (d: string) => boolean) => {
        const m = etn ? metaEtn : meta
        const vt = new Map(l.por_dia.filter(x => Number(x.vt) > 0 && dentro(x.dia)).map(x => [x.dia, Number(x.vt)]))
        const at = new Map(l.por_dia.map(x => [x.dia, x.atividades]))
        const esc = new Map(l.escala.filter(x => dentro(x.dia)).map(x => [x.dia, x.codigo]))
        const valores = [...vt.values()]
        const total = valores.reduce((s, x) => s + x, 0)
        const nDias = valores.length
        const media = nDias ? total / nDias : null
        return {
          ...l, chave: `${l.login}|${etn ? 'ETN' : 'N'}`, etn, meta: m, limiteDia: Math.ceil(m),
          dentro, periodos: per, vt, at, esc, total, nDias, media, se: media != null && media >= m,
        }
      }
      if (per.length === 0) return [monta(false, () => true)]
      const linhasDoLogin = [monta(true, ehEtn)]
      // a linha normal só some se o mês inteiro for ETN
      if (!dias.every(ehEtn)) linhasDoLogin.unshift(monta(false, d => !ehEtn(d)))
      return linhasDoLogin
    })
    const soma1 = rows.filter(r => r.se).reduce((s, r) => s + r.nDias, 0)
    const soma0 = rows.filter(r => !r.se).reduce((s, r) => s + r.nDias, 0)
    const realizadas = soma1 / diasEquipe
    const proj = (x: number) => corridos ? (x / corridos) * dias.length : null
    const porDia = dias.map(d => {
      const v = rows.map(r => r.vt.get(d)).filter((x): x is number => x != null)
      return { total: v.reduce((s, x) => s + x, 0), media: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
    })
    return {
      rows, soma1, soma0, geral: soma1 + soma0, realizadas,
      projetadas: proj(realizadas), projetadas10: proj((soma1 + soma0) / diasEquipe),
      porDia, semPonto: linhas.reduce((s, r) => s + r.sem_ponto, 0),
      nEtn: rows.filter(r => r.etn).length,
    }
  }, [linhas, etns, meta, metaEtn, diasEquipe, dias, corridos])

  const marcar = useCallback(async (login: string, dia: string, codigo: string | null) => {
    setMenu(null)
    const { error } = await supabase.rpc('marcar_escala_vt', { p_login: login, p_dia: dia, p_codigo: codigo })
    if (error) setErro(error.message)
    else setVersao(v => v + 1)
  }, [])

  const nomeMes = new Date(`${mes}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const limiteNormal = Math.ceil(meta)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-graf-400">
          Mês
          <input type="month" value={mes} max={hoje.slice(0, 7)} min="2026-11"
            onChange={e => e.target.value && setMes(e.target.value)}
            className="ml-1 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-sm" />
        </label>
        <span className="text-[11px] text-graf-400"
          title="Por login do TOA e dia: soma dos pontos da 1ª O.S. de cada atividade finalizada ÷ 35, nos buckets de VT">
          Buckets de VT · {nomeMes} · {corridos} de {dias.length} dias
        </span>
      </div>

      {erro && <p className="text-sm text-af-400">{erro}</p>}

      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { r: 'Equipes realizadas', v: n2(calc.realizadas), t: `SOMA 1 ÷ ${diasEquipe}`, cor: 'var(--st-execucao)' },
          { r: 'Equipes projetadas', v: n2(calc.projetadas), t: `Realizadas ÷ ${corridos} dias corridos × ${dias.length} dias do mês`, cor: 'var(--st-execucao)' },
          { r: 'Projetadas (SOMA 1 + 0)', v: n2(calc.projetadas10), t: `GERAL ÷ ${diasEquipe} ÷ dias corridos × dias do mês`, cor: 'var(--st-deslocamento)' },
          { r: 'SOMA 1', v: String(calc.soma1), t: 'Dias trabalhados de quem bateu a meta da linha (5,7; ETN 3)', cor: TOM.bom.texto, fundo: TOM.bom.fundo },
          { r: 'SOMA 0', v: String(calc.soma0), t: 'Dias trabalhados de quem não bateu a meta da linha', cor: TOM.ruim.texto, fundo: TOM.ruim.fundo },
          { r: 'Geral', v: String(calc.geral), t: 'SOMA 1 + SOMA 0', cor: 'var(--color-graf-500)' },
        ].map(c => (
          <div key={c.r} className="card-controle relative overflow-hidden p-3 pl-4" title={c.t}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: c.fundo ?? c.cor }} />
            <p className="text-[10px] uppercase tracking-wide text-graf-400">{c.r}</p>
            <p className="tabular mt-1 text-2xl font-semibold">
              {c.fundo
                ? <span className="rounded px-1.5" style={{ background: c.fundo, color: c.cor }}>{c.v}</span>
                : <span className="text-graf-100">{c.v}</span>}
            </p>
          </div>
        ))}
      </section>

      <section className="card-controle p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <h2 className="text-sm font-semibold">
            VT por login — meta média {n1(meta)}
            <span className="ml-1.5 font-normal text-graf-400">· ETN {n1(metaEtn)}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-graf-400">
            {[[TOM.bom, `acima de ${limiteNormal}`], [TOM.meio, `${limiteNormal}`], [TOM.ruim, `abaixo de ${limiteNormal}`]].map(([t, r]) => (
              <span key={r as string} className="flex items-center gap-1">
                <span aria-hidden className="h-3 w-4 rounded-sm"
                  style={{ background: (t as typeof TOM.bom).fundo, boxShadow: `inset 0 0 0 1px ${(t as typeof TOM.bom).texto}33` }} />
                {r as string}
              </span>
            ))}
            <span className="text-graf-500">|</span>
            {ESCALAS.map(e => (
              <span key={e.c} className="flex items-center gap-1">
                <SeloEscala codigo={e.c} /> {e.r}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <SeloEtn /> meta {n1(metaEtn)} ({Math.ceil(metaEtn)} no dia)
            </span>
          </div>
          {calc.semPonto > 0 && (
            <span className="text-[11px] text-amber-300"
              title="A 1ª O.S. é de um tipo que não está na tabela de pontos do VT — conta 0 até ser cadastrado">
              {calc.semPonto} atividade(s) sem ponto na tabela
            </span>
          )}
          {podeMarcar && (
            <span className="ml-auto text-[11px] text-graf-400">Clique no nome para marcar ETN</span>
          )}
        </div>

        {carregando ? (
          <CarregandoBloco className="py-12" />
        ) : calc.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-graf-400">
            Nenhuma atividade finalizada nos buckets de VT em {nomeMes}.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-separate border-spacing-y-px text-xs">
              <thead className="text-graf-400">
                <tr>
                  <th className="sticky left-0 z-10 border-b border-graf-800 bg-graf-950 px-2 py-1.5 text-left font-medium">Técnico</th>
                  {dias.map(d => {
                    const dt = new Date(d + 'T12:00')
                    const fds = dt.getDay() === 0 || dt.getDay() === 6
                    const eHoje = d === hoje
                    return (
                      <th key={d} className={`min-w-[2.4rem] border-b px-0.5 py-1 text-center font-medium ${
                        eHoje ? 'border-af-500 text-af-400' : 'border-graf-800'} ${fds ? 'bg-graf-900/70 text-graf-300' : ''}`}>
                        <span className="block text-[9px] uppercase">
                          {dt.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3)}
                        </span>
                        <span className="tabular">{d.slice(8, 10)}</span>
                      </th>
                    )
                  })}
                  <th className="border-b border-graf-800 px-2 py-1.5 text-right font-medium">Dias</th>
                  <th className="border-b border-graf-800 px-2 py-1.5 text-right font-medium">Total</th>
                  <th className="border-b border-graf-800 px-2 py-1.5 text-right font-medium">Média</th>
                  <th className="border-b border-graf-800 px-2 py-1.5 text-center font-medium" title={`Média ≥ meta da linha (${n1(meta)}; ETN ${n1(metaEtn)})`}>SE</th>
                </tr>
              </thead>
              <tbody>
                {calc.rows.map(l => (
                  <tr key={l.chave} className="hover:bg-graf-850"
                    style={l.etn ? { boxShadow: `inset 3px 0 0 0 ${COR_ETN}` } : undefined}>
                    <td className="sticky left-0 z-10 max-w-60 border-b border-graf-800/60 bg-graf-950 px-2 py-1"
                      title={`${l.nome ?? l.login} · ${l.login}${l.equipe ? ` · equipe ${l.equipe}` : ''}${l.etn ? ` · ETN (meta ${n1(l.meta)})` : ''}`}>
                      <button type="button" disabled={!podeMarcar}
                        onClick={ev => setMenuEtn({ login: l.login, nome: l.nome ?? l.login, r: ev.currentTarget.getBoundingClientRect() })}
                        className={`flex max-w-full items-center gap-1.5 rounded text-left ${podeMarcar
                          ? 'hover:text-af-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-af-500' : 'cursor-default'}`}>
                        {l.etn && <SeloEtn />}
                        <span className="truncate text-graf-200">{l.nome ?? l.login}</span>
                        <span className="shrink-0 text-graf-400">{l.equipe ?? l.login}</span>
                      </button>
                    </td>
                    {dias.map(d => {
                      const dt = new Date(d + 'T12:00')
                      const fds = dt.getDay() === 0 || dt.getDay() === 6
                      // dia que é da OUTRA linha do mesmo login (ETN × normal)
                      if (!l.dentro(d)) {
                        return (
                          <td key={d} className={`border-b border-graf-800/60 px-0.5 py-1 text-center ${fds ? 'bg-graf-900/70' : ''}`}
                            title={l.etn ? 'Dia na linha normal deste login' : 'Dia na linha ETN deste login'}>
                            <span className="text-[10px] text-graf-600">⋯</span>
                          </td>
                        )
                      }
                      const v = l.vt.get(d)
                      const e = l.esc.get(d)
                      const clicavel = podeMarcar && d <= hoje
                      const tom = v != null ? tomDoDia(v, l.limiteDia) : null
                      return (
                        <td key={d} className={`border-b border-graf-800/60 px-0.5 py-1 text-center ${fds ? 'bg-graf-900/70' : ''}`}>
                          <button type="button" disabled={!clicavel}
                            onClick={ev => setMenu({ login: l.login, dia: d, r: ev.currentTarget.getBoundingClientRect() })}
                            title={v != null
                              ? `${v.toFixed(4).replace('.', ',')} VT · ${l.at.get(d) ?? 0} atividade(s)${e ? ` · escala ${e}` : ''}`
                              : e ? `Escala: ${e}` : clicavel ? 'Marcar escala' : ''}
                            className={`tabular w-full rounded px-0.5 py-0.5 ${clicavel ? 'hover:ring-1 hover:ring-graf-500' : 'cursor-default'}`}
                            style={tom ? { background: tom.fundo, color: tom.texto, fontWeight: 600 } : undefined}>
                            {v != null ? n1(v)
                              : e ? <SeloEscala codigo={e} />
                              : <span className="text-graf-700">·</span>}
                          </button>
                        </td>
                      )
                    })}
                    <td className="tabular border-b border-graf-800/60 px-2 py-1 text-right text-graf-300">{l.nDias}</td>
                    <td className="tabular border-b border-graf-800/60 px-2 py-1 text-right text-graf-300">{n1(l.total)}</td>
                    <td className="tabular border-b border-graf-800/60 px-2 py-1 text-right">
                      {l.media == null ? <span className="text-graf-400">—</span> : (
                        <span className="rounded px-1.5 py-0.5 font-semibold"
                          style={{ background: l.se ? TOM.bom.fundo : TOM.ruim.fundo, color: l.se ? TOM.bom.texto : TOM.ruim.texto }}>
                          {n2(l.media)}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-graf-800/60 px-2 py-1 text-center">
                      {l.media == null ? <span className="text-graf-400">—</span> : (
                        <span className="tabular rounded px-1.5 py-0.5 font-semibold text-white"
                          title={`Meta da linha: ${n1(l.meta)}`}
                          style={{ background: l.se ? '#059669' : '#dc2626' }}>{l.se ? 1 : 0}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-graf-300">
                <tr>
                  <td className="sticky left-0 z-10 border-t border-graf-700 bg-graf-950 px-2 py-1 font-medium">Total de pontos</td>
                  {calc.porDia.map((p, i) => (
                    <td key={dias[i]} className="tabular border-t border-graf-700 px-0.5 py-1 text-center font-semibold text-graf-200">
                      {p.total ? n1(p.total) : ''}
                    </td>
                  ))}
                  <td colSpan={4} className="border-t border-graf-700" />
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 bg-graf-950 px-2 py-1 font-medium">Média</td>
                  {calc.porDia.map((p, i) => {
                    const m = p.media == null ? null : Math.round(p.media * 10) / 10
                    const tom = m == null ? null : tomDoDia(m, limiteNormal)
                    return (
                      <td key={dias[i]} className="tabular px-0.5 py-1 text-center">
                        {m != null && (
                          <span className="block rounded px-0.5 font-semibold" style={{ background: tom!.fundo, color: tom!.texto }}>
                            {n1(m)}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {menu && <MenuEscala menu={menu} atual={linhas.find(r => r.login === menu.login)?.escala.find(x => x.dia === menu.dia)?.codigo ?? null}
        aoEscolher={c => marcar(menu.login, menu.dia, c)} aoFechar={() => setMenu(null)} />}
      {menuEtn && (
        <MenuEtn alvo={menuEtn} mes={mes} hoje={hoje} metaEtn={metaEtn}
          periodos={etns.filter(p => p.login === menuEtn.login)}
          aoMudar={() => setVersao(v => v + 1)} aoErro={setErro} aoFechar={() => setMenuEtn(null)} />
      )}
    </div>
  )
}

function SeloEscala({ codigo }: { codigo: string }) {
  const e = ESCALAS.find(x => x.c === codigo)
  return (
    <span className="rounded px-1 text-[10px] font-semibold text-white" style={{ background: e?.cor ?? '#64748b' }}>
      {codigo}
    </span>
  )
}

function SeloEtn() {
  return (
    <span className="shrink-0 rounded px-1 text-[10px] font-bold tracking-wide text-white" style={{ background: COR_ETN }}>
      ETN
    </span>
  )
}

/** Fecha o menu flutuante no clique fora, no Esc e na rolagem. */
function useFecharFora(caixa: React.RefObject<HTMLDivElement | null>, aoFechar: () => void, rolagemFecha = true) {
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) aoFechar() }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    const t = requestAnimationFrame(() => {
      document.addEventListener('mousedown', fora)
      if (rolagemFecha) document.addEventListener('scroll', aoFechar, true)
    })
    document.addEventListener('keydown', tecla)
    return () => {
      cancelAnimationFrame(t)
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('scroll', aoFechar, true)
      document.removeEventListener('keydown', tecla)
    }
  }, [caixa, aoFechar, rolagemFecha])
}

/** O menu da célula vai por portal, preso ao botão — dentro da tabela
 *  com rolagem ele seria recortado (D-169). */
function MenuEscala({ menu, atual, aoEscolher, aoFechar }: {
  menu: { login: string; dia: string; r: DOMRect }
  atual: string | null
  aoEscolher: (codigo: string | null) => void
  aoFechar: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  useFecharFora(caixa, aoFechar)
  const paraCima = menu.r.bottom + 200 > window.innerHeight
  const paraEsquerda = menu.r.left + 160 > window.innerWidth
  return createPortal(
    <div ref={caixa} role="menu"
      style={{
        left: paraEsquerda ? menu.r.right : menu.r.left,
        top: paraCima ? menu.r.top - 4 : menu.r.bottom + 4,
        transform: `translate(${paraEsquerda ? '-100%' : '0'}, ${paraCima ? '-100%' : '0'})`,
      }}
      className="fixed z-50 w-40 overflow-hidden rounded-lg border border-graf-700 bg-graf-900 text-left text-xs shadow-xl">
      <p className="border-b border-graf-800 px-3 py-1.5 text-[11px] text-graf-400">
        {menu.login} · {dm(menu.dia)}
      </p>
      {ESCALAS.map(e => (
        <button key={e.c} role="menuitem" onClick={() => aoEscolher(e.c)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 hover:bg-graf-800 ${atual === e.c ? 'font-semibold' : ''}`}>
          <SeloEscala codigo={e.c} /> <span className="text-graf-200">{e.r}</span>
        </button>
      ))}
      <button role="menuitem" onClick={() => aoEscolher(null)} disabled={!atual}
        className="block w-full border-t border-graf-800 px-3 py-1.5 text-left text-graf-300 hover:bg-graf-800 disabled:opacity-40">
        Limpar
      </button>
    </div>,
    document.querySelector('.sup-controle') ?? document.body,
  )
}

/**
 * O ETN do login (245, D-357): os períodos que já existem (com Remover) e um
 * período novo. Sem "até" = em aberto. Dois períodos do mesmo login não se
 * sobrepõem — o banco recusa e o recado aparece aqui.
 */
function MenuEtn({ alvo, mes, hoje, metaEtn, periodos, aoMudar, aoErro, aoFechar }: {
  alvo: { login: string; nome: string; r: DOMRect }
  mes: string; hoje: string; metaEtn: number
  periodos: PeriodoEtn[]
  aoMudar: () => void; aoErro: (m: string | null) => void; aoFechar: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  useFecharFora(caixa, aoFechar, false)
  const [de, setDe] = useState(hoje.slice(0, 7) === mes ? hoje : `${mes}-01`)
  const [ate, setAte] = useState('')
  const [gravando, setGravando] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)

  async function salvar() {
    setGravando(true); setRecado(null)
    const { error } = await supabase.rpc('definir_etn_vt', { p_login: alvo.login, p_de: de, p_ate: ate || null })
    setGravando(false)
    if (error) { setRecado(error.message); return }
    aoErro(null); aoMudar(); aoFechar()
  }
  const [encerrando, setEncerrando] = useState<string | null>(null)
  const [fimEtn, setFimEtn] = useState(hoje)
  async function encerrar(id: string) {
    setGravando(true); setRecado(null)
    const { error } = await supabase.rpc('encerrar_etn_vt', { p_id: id, p_ate: fimEtn })
    setGravando(false)
    if (error) { setRecado(error.message); return }
    aoErro(null); aoMudar(); aoFechar()
  }
  async function remover(id: string) {
    setGravando(true); setRecado(null)
    const { error } = await supabase.rpc('remover_etn_vt', { p_id: id })
    setGravando(false)
    if (error) { setRecado(error.message); return }
    aoErro(null); aoMudar(); aoFechar()
  }

  const paraCima = alvo.r.bottom + 300 > window.innerHeight
  return createPortal(
    <div ref={caixa} role="dialog" aria-label={`Técnico ETN: ${alvo.nome}`}
      style={{
        left: alvo.r.left,
        top: paraCima ? alvo.r.top - 4 : alvo.r.bottom + 4,
        transform: paraCima ? 'translateY(-100%)' : undefined,
      }}
      className="fixed z-50 w-72 overflow-hidden rounded-lg border border-graf-700 bg-graf-900 text-left text-xs shadow-xl">
      <div className="flex items-center gap-2 border-b border-graf-800 px-3 py-2">
        <SeloEtn />
        <span className="min-w-0 flex-1 truncate font-semibold text-graf-100">{alvo.nome}</span>
        <span className="text-[10px] text-graf-400">{alvo.login}</span>
      </div>
      <p className="px-3 pt-2 text-[11px] text-graf-400">
        No período ETN a meta é <strong className="text-graf-200">{metaEtn.toLocaleString('pt-BR')}</strong>;
        os outros dias ficam na linha normal.
      </p>

      <div className="px-3 py-2">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-graf-400">Períodos ETN</p>
        {periodos.length === 0 ? (
          <p className="text-[11px] text-graf-400">Não é ETN neste mês.</p>
        ) : (
          <ul className="space-y-1">
            {periodos.map(p => (
              <li key={p.id} className="rounded bg-graf-850 px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="tabular text-graf-200">{dm(p.de)} → {p.ate ? dm(p.ate) : 'em aberto'}</span>
                  {!p.ate && encerrando !== p.id && (
                    <button type="button" disabled={gravando} onClick={() => { setEncerrando(p.id); setFimEtn(hoje < p.de ? p.de : hoje) }}
                      className="ml-auto text-[11px] text-graf-200 hover:underline disabled:opacity-40">Encerrar</button>
                  )}
                  <button type="button" disabled={gravando} onClick={() => remover(p.id)}
                    className={`${!p.ate && encerrando !== p.id ? '' : 'ml-auto'} text-[11px] text-af-400 hover:underline disabled:opacity-40`}>Remover</button>
                </div>
                {encerrando === p.id && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <label htmlFor="etn-fim" className="text-[10px] text-graf-400">Último dia ETN</label>
                    <input id="etn-fim" type="date" value={fimEtn} min={p.de} onChange={e => setFimEtn(e.target.value)}
                      className="tabular min-w-0 flex-1 rounded border border-graf-700 bg-graf-950 px-1.5 py-0.5" />
                    <button type="button" disabled={gravando || !fimEtn} onClick={() => encerrar(p.id)}
                      className="rounded px-2 py-0.5 font-semibold text-white disabled:opacity-50" style={{ background: COR_ETN }}>OK</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-graf-800 px-3 py-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-graf-400">Novo período ETN</p>
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="etn-de">Primeiro dia ETN</label>
          <input id="etn-de" type="date" value={de} onChange={e => setDe(e.target.value)}
            className="tabular min-w-0 flex-1 rounded border border-graf-700 bg-graf-950 px-1.5 py-1" />
          <span className="text-graf-400">até</span>
          <label className="sr-only" htmlFor="etn-ate">Último dia ETN (vazio = em aberto)</label>
          <input id="etn-ate" type="date" value={ate} min={de} onChange={e => setAte(e.target.value)}
            className="tabular min-w-0 flex-1 rounded border border-graf-700 bg-graf-950 px-1.5 py-1" />
        </div>
        <p className="mt-1 text-[10px] text-graf-400">Sem o último dia, fica ETN até alguém encerrar.</p>
        {recado && <p className="mt-1.5 text-[11px] text-af-400" role="alert">{recado}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={aoFechar}
            className="rounded border border-graf-700 px-2.5 py-1 text-graf-300 hover:border-graf-500">Fechar</button>
          <button type="button" onClick={salvar} disabled={gravando || !de}
            className="rounded px-2.5 py-1 font-semibold text-white disabled:opacity-50" style={{ background: COR_ETN }}>
            {gravando ? 'Salvando…' : 'Marcar ETN'}
          </button>
        </div>
      </div>
    </div>,
    document.querySelector('.sup-controle') ?? document.body,
  )
}
