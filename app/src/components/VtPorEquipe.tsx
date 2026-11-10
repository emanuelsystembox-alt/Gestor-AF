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
 */

const ESCALAS = [
  { c: 'F', r: 'Folga', cor: '#64748b' },
  { c: 'FE', r: 'Férias', cor: '#0369a1' },
  { c: 'FALTA', r: 'Falta', cor: '#dc2626' },
  { c: 'ATES.', r: 'Atestado', cor: '#d97706' },
] as const

interface LinhaVt {
  login: string; nome: string | null; equipe: string | null
  por_dia: { dia: string; vt: number; atividades: number }[]
  escala: { dia: string; codigo: string }[]
  sem_ponto: number
}

const n1 = (x: number | null | undefined) =>
  x == null ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(1).replace('.', ',')
const n2 = (x: number | null) => x == null ? '—' : x.toFixed(2).replace('.', ',')

export function VtPorEquipe() {
  const { temPapel } = useAuth()
  const podeMarcar = temPapel('ADMIN', 'COP', 'CONTROLADOR', 'SUPERVISOR')
  const hoje = isoLocal(new Date())
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const [linhas, setLinhas] = useState<LinhaVt[]>([])
  const [meta, setMeta] = useState(5.7)
  const [diasEquipe, setDiasEquipe] = useState(21)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [menu, setMenu] = useState<{ login: string; dia: string; r: DOMRect } | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    Promise.all([
      supabase.rpc('vt_por_equipe_mes', { p_mes: `${mes}-01` }),
      supabase.rpc('ler_parametro', { p_chave: 'vt_meta_media' }),
      supabase.rpc('ler_parametro', { p_chave: 'vt_dias_equipe' }),
    ]).then(([l, m, d]) => {
      if (!vivo) return
      if (l.error) setErro(l.error.message)
      else setLinhas((l.data ?? []) as LinhaVt[])
      if (m.data != null && !isNaN(Number(m.data))) setMeta(Number(m.data))
      if (d.data != null && !isNaN(Number(d.data))) setDiasEquipe(Number(d.data))
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [mes, versao])

  const dias = useMemo(() => {
    const [a, m] = mes.split('-').map(Number)
    const n = new Date(a, m, 0).getDate()
    return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)
  }, [mes])

  // Dias corridos: o mês até hoje; mês fechado conta inteiro; mês futuro, zero.
  const corridos = mes < hoje.slice(0, 7) ? dias.length
    : mes > hoje.slice(0, 7) ? 0 : Number(hoje.slice(8, 10))

  const calc = useMemo(() => {
    const rows = linhas.map(l => {
      const vt = new Map(l.por_dia.filter(x => Number(x.vt) > 0).map(x => [x.dia, Number(x.vt)]))
      const at = new Map(l.por_dia.map(x => [x.dia, x.atividades]))
      const esc = new Map(l.escala.map(x => [x.dia, x.codigo]))
      const valores = [...vt.values()]
      const total = valores.reduce((s, x) => s + x, 0)
      const nDias = valores.length
      const media = nDias ? total / nDias : null
      return { ...l, vt, at, esc, total, nDias, media, se: media != null && media >= meta }
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
      porDia, semPonto: rows.reduce((s, r) => s + r.sem_ponto, 0),
    }
  }, [linhas, meta, diasEquipe, dias, corridos])

  const marcar = useCallback(async (login: string, dia: string, codigo: string | null) => {
    setMenu(null)
    const { error } = await supabase.rpc('marcar_escala_vt', { p_login: login, p_dia: dia, p_codigo: codigo })
    if (error) setErro(error.message)
    else setVersao(v => v + 1)
  }, [])

  const nomeMes = new Date(`${mes}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

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
          { r: 'Equipes realizadas', v: n2(calc.realizadas), t: `SOMA 1 ÷ ${diasEquipe}` },
          { r: 'Equipes projetadas', v: n2(calc.projetadas), t: `Realizadas ÷ ${corridos} dias corridos × ${dias.length} dias do mês` },
          { r: 'Projetadas (SOMA 1 + 0)', v: n2(calc.projetadas10), t: `GERAL ÷ ${diasEquipe} ÷ dias corridos × dias do mês` },
          { r: 'SOMA 1', v: String(calc.soma1), t: `Dias trabalhados de quem tem média ≥ ${n1(meta)}` },
          { r: 'SOMA 0', v: String(calc.soma0), t: `Dias trabalhados de quem tem média < ${n1(meta)}` },
          { r: 'Geral', v: String(calc.geral), t: 'SOMA 1 + SOMA 0' },
        ].map(c => (
          <div key={c.r} className="card-controle p-3" title={c.t}>
            <p className="text-[10px] uppercase tracking-wide text-graf-400">{c.r}</p>
            <p className="tabular mt-1 text-2xl font-semibold text-graf-100">{c.v}</p>
          </div>
        ))}
      </section>

      <section className="card-controle p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold">VT por login — meta média {n1(meta)}</h2>
          <div className="flex flex-wrap gap-2 text-[11px] text-graf-400">
            {ESCALAS.map(e => (
              <span key={e.c} className="flex items-center gap-1">
                <SeloEscala codigo={e.c} /> {e.r}
              </span>
            ))}
          </div>
          {calc.semPonto > 0 && (
            <span className="text-[11px] text-amber-300"
              title="A 1ª O.S. é de um tipo que não está na tabela de pontos do VT — conta 0 até ser cadastrado">
              {calc.semPonto} atividade(s) sem ponto na tabela
            </span>
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
            <table className="w-full text-xs">
              <thead className="border-b border-graf-800 text-graf-400">
                <tr>
                  <th className="sticky left-0 z-10 bg-graf-950 px-2 py-1.5 text-left font-medium">Técnico</th>
                  {dias.map(d => {
                    const dt = new Date(d + 'T12:00')
                    const fds = dt.getDay() === 0 || dt.getDay() === 6
                    return (
                      <th key={d} className={`min-w-[2.4rem] px-0.5 py-1 text-center font-medium ${fds ? 'text-graf-300' : ''}`}>
                        <span className="block text-[9px] uppercase">
                          {dt.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3)}
                        </span>
                        <span className="tabular">{d.slice(8, 10)}</span>
                      </th>
                    )
                  })}
                  <th className="px-2 py-1.5 text-right font-medium">Dias</th>
                  <th className="px-2 py-1.5 text-right font-medium">Total</th>
                  <th className="px-2 py-1.5 text-right font-medium">Média</th>
                  <th className="px-2 py-1.5 text-center font-medium" title={`Média ≥ ${n1(meta)}`}>SE</th>
                </tr>
              </thead>
              <tbody>
                {calc.rows.map(l => (
                  <tr key={l.login} className="border-b border-graf-800/60 hover:bg-graf-850">
                    <td className="sticky left-0 z-10 max-w-56 truncate bg-graf-950 px-2 py-1"
                      title={`${l.nome ?? l.login} · ${l.login}${l.equipe ? ` · equipe ${l.equipe}` : ''}`}>
                      <span className="text-graf-200">{l.nome ?? l.login}</span>
                      <span className="ml-1.5 text-graf-400">{l.equipe ?? l.login}</span>
                    </td>
                    {dias.map(d => {
                      const v = l.vt.get(d)
                      const e = l.esc.get(d)
                      const clicavel = podeMarcar && d <= hoje
                      return (
                        <td key={d} className="px-0.5 py-1 text-center">
                          <button type="button" disabled={!clicavel}
                            onClick={ev => setMenu({ login: l.login, dia: d, r: ev.currentTarget.getBoundingClientRect() })}
                            title={v != null
                              ? `${v.toFixed(4).replace('.', ',')} VT · ${l.at.get(d) ?? 0} atividade(s)${e ? ` · escala ${e}` : ''}`
                              : e ? `Escala: ${e}` : clicavel ? 'Marcar escala' : ''}
                            className={`tabular w-full rounded px-0.5 py-0.5 ${clicavel ? 'hover:bg-graf-800' : 'cursor-default'}`}>
                            {v != null ? <span className="text-graf-100">{n1(v)}</span>
                              : e ? <SeloEscala codigo={e} />
                              : <span className="text-graf-700">·</span>}
                          </button>
                        </td>
                      )
                    })}
                    <td className="tabular px-2 py-1 text-right text-graf-300">{l.nDias}</td>
                    <td className="tabular px-2 py-1 text-right text-graf-300">{n1(l.total)}</td>
                    <td className="tabular px-2 py-1 text-right font-semibold text-graf-100">
                      {l.media == null ? '—' : n2(l.media)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {l.media == null ? <span className="text-graf-400">—</span> : (
                        <span className="tabular rounded px-1.5 py-0.5 font-semibold text-white"
                          style={{ background: l.se ? '#059669' : '#dc2626' }}>{l.se ? 1 : 0}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-graf-700 text-graf-300">
                <tr>
                  <td className="sticky left-0 z-10 bg-graf-950 px-2 py-1 font-medium">Total de pontos</td>
                  {calc.porDia.map((p, i) => (
                    <td key={dias[i]} className="tabular px-0.5 py-1 text-center">{p.total ? n1(p.total) : ''}</td>
                  ))}
                  <td colSpan={4} />
                </tr>
                <tr>
                  <td className="sticky left-0 z-10 bg-graf-950 px-2 py-1 font-medium">Média</td>
                  {calc.porDia.map((p, i) => (
                    <td key={dias[i]} className="tabular px-0.5 py-1 text-center">{p.media == null ? '' : n1(Math.round(p.media * 10) / 10)}</td>
                  ))}
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {menu && <MenuEscala menu={menu} atual={calc.rows.find(r => r.login === menu.login)?.esc.get(menu.dia) ?? null}
        aoEscolher={c => marcar(menu.login, menu.dia, c)} aoFechar={() => setMenu(null)} />}
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

/** O menu da célula vai por portal, preso ao botão — dentro da tabela
 *  com rolagem ele seria recortado (D-169). */
function MenuEscala({ menu, atual, aoEscolher, aoFechar }: {
  menu: { login: string; dia: string; r: DOMRect }
  atual: string | null
  aoEscolher: (codigo: string | null) => void
  aoFechar: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) aoFechar() }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    const t = requestAnimationFrame(() => {
      document.addEventListener('mousedown', fora)
      document.addEventListener('scroll', aoFechar, true)
    })
    document.addEventListener('keydown', tecla)
    return () => {
      cancelAnimationFrame(t)
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('scroll', aoFechar, true)
      document.removeEventListener('keydown', tecla)
    }
  }, [aoFechar])
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
        {menu.login} · {menu.dia.slice(8, 10)}/{menu.dia.slice(5, 7)}
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
