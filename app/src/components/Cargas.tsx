import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { imprimirTermo } from '../lib/termo'
import { isoLocal } from '../lib/formato'
import { Alerta, Vazio } from './ui'

/**
 * Cargas por técnico — o "Equipes / Alocações" do concorrente (089-F, D-165).
 *
 * ┌─ A PERGUNTA QUE ESTA TELA RESPONDE ──────────────────────────────┐
 * │ "O que está com cada um?" — sem abrir romaneio por romaneio. No  │
 * │ Alfa Gestor é escolher a equipe e ver a lista; aqui a tabela já  │
 * │ abre com todo mundo que tem alguma coisa, e a linha abre o       │
 * │ detalhe: seriais (com condição e dias) e material com saldo.     │
 * │                                                                   │
 * │ A carga é do TÉCNICO, não da equipe (D-154): a dupla são duas    │
 * │ cargas, e é por isso que dá para cobrar de quem ficou com a peça.│
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Os DIAS são só mostrados. Bloquear quem tem peça parada é o prazo da
 * carga (087-A), que mora em Configurações e hoje está em 0.
 */

interface Carga {
  tecnico_id: string; tecnico: string; matricula: string | null; equipe: string | null
  seriais: number; inicializadas: number; retiradas: number; com_defeito: number
  sem_condicao: number; mais_antiga_dias: number | null; itens_misc: number; qtd_misc: number
}
interface Peca {
  serial: string; tipo: string | null; modelo: string | null; condicao: string | null
  posse_em: string | null; posse_motivo: string | null
}
interface Misc { nome: string; codigo: string | null; unidade: string; qtd: number }

const CONDICAO: Record<string, string> = {
  INICIALIZADO: 'inicializado', RETIRADO: 'retirado', COM_DEFEITO: 'com defeito',
}
const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

function dias(ts: string | null): number | null {
  if (!ts) return null
  const d = new Date(ts), h = new Date()
  return Math.round((new Date(h.getFullYear(), h.getMonth(), h.getDate()).getTime()
    - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5)
}

/** CSV com ponto e vírgula: é o que o Excel em português abre sem assistente. */
function baixarCsv(nome: string, linhas: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob(['﻿' + linhas.map(l => l.map(esc).join(';')).join('\r\n')],
                        { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = nome; a.click()
  URL.revokeObjectURL(a.href)
}

export function Cargas() {
  const [cargas, setCargas] = useState<Carga[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [pecas, setPecas] = useState<Peca[]>([])
  const [misc, setMisc] = useState<Misc[]>([])

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.rpc('estoque_cargas')
    if (error) setErro(error.message)
    setCargas((data ?? []) as Carga[])
    setCarregando(false)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function abrir(c: Carga) {
    if (aberto === c.tecnico_id) { setAberto(null); return }
    setAberto(c.tecnico_id); setPecas([]); setMisc([])
    const [p, s] = await Promise.all([
      supabase.from('equipamento')
        .select('serial, tipo, modelo, condicao, posse_em, posse_motivo')
        .eq('posse', 'COM_TECNICO').eq('posse_tecnico_id', c.tecnico_id).order('posse_em'),
      supabase.rpc('miscelanea_saldos'),
    ])
    setPecas((p.data ?? []) as Peca[])
    type S = { nome: string; codigo: string | null; unidade: string
               por_tecnico: { tecnico_id: string; qtd: number }[] }
    setMisc(((s.data ?? []) as S[]).flatMap(i => {
      const t = i.por_tecnico.find(x => x.tecnico_id === c.tecnico_id)
      return t && t.qtd > 0 ? [{ nome: i.nome, codigo: i.codigo, unidade: i.unidade, qtd: t.qtd }] : []
    }))
  }

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return cargas.filter(c => !t || c.tecnico.toLowerCase().includes(t)
      || (c.matricula ?? '').toLowerCase().includes(t) || (c.equipe ?? '').toLowerCase().includes(t))
  }, [cargas, busca])

  const tot = {
    tecnicos: cargas.length,
    seriais: cargas.reduce((s, c) => s + c.seriais, 0),
    retiradas: cargas.reduce((s, c) => s + c.retiradas, 0),
    antiga: Math.max(0, ...cargas.map(c => c.mais_antiga_dias ?? 0)),
  }

  function exportar() {
    baixarCsv(`cargas-${isoLocal()}.csv`, [
      ['Técnico', 'Matrícula', 'Equipe', 'Seriais', 'Inicializadas', 'Retiradas', 'Com defeito',
       'Sem condição', 'Mais antiga (dias)', 'Itens de material', 'Qtd de material'],
      ...lista.map(c => [c.tecnico, c.matricula, c.equipe, c.seriais, c.inicializadas, c.retiradas,
                         c.com_defeito, c.sem_condicao, c.mais_antiga_dias, c.itens_misc, c.qtd_misc]),
    ])
  }

  function termo(c: Carga) {
    const ok = imprimirTermo({
      titulo: 'Termo de responsabilidade — carga atual',
      referencia: `Carga em ${new Date().toLocaleDateString('pt-BR')}${c.equipe ? ` · equipe ${c.equipe}` : ''}`,
      tecnico: { nome: c.tecnico, matricula: c.matricula },
      pecas: pecas.map(p => ({ serial: p.serial, tipo: p.tipo, modelo: p.modelo,
                               obs: [p.condicao && CONDICAO[p.condicao], p.posse_motivo].filter(Boolean).join(' · ') })),
      misc: misc.map(m => ({ codigo: m.codigo ?? '—', nome: m.nome, quantidade: m.qtd, unidade: m.unidade })),
    })
    if (!ok) setErro('O navegador bloqueou a janela do termo. Permita pop-ups para este site.')
  }

  return (
    <div className="space-y-3">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {([['técnicos com carga', tot.tecnicos], ['seriais na rua', tot.seriais],
           ['retiradas de cliente', tot.retiradas],
           ['peça mais antiga (dias)', tot.antiga]] as const).map(([r, v]) => (
          <div key={r} className="card-controle px-3.5 py-3">
            <div className="tabular text-2xl font-semibold leading-none">{v}</div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">{r}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="técnico, matrícula ou equipe…" aria-label="Buscar técnico"
          className={`${campo} w-72`} />
        <button onClick={exportar} disabled={lista.length === 0}
          className="ml-auto rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                     hover:border-af-600 disabled:opacity-40">
          exportar planilha
        </button>
      </div>

      {carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : lista.length === 0 ? (
        <Vazio titulo="Ninguém com carga"
          descricao="Quando o almoxarifado entregar peças ou material e o técnico confirmar, ele aparece aqui." />
      ) : (
        <section className="card-controle overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Técnico</th>
                <th className="px-3 py-2 font-medium">Equipe</th>
                <th className="px-3 py-2 text-right font-medium">Seriais</th>
                <th className="px-3 py-2 font-medium">Condição</th>
                <th className="px-3 py-2 text-right font-medium">Mais antiga</th>
                <th className="px-3 py-2 text-right font-medium">Material</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(c => (
                <Fragment key={c.tecnico_id}>
                  <tr className="cursor-pointer border-b border-graf-800 hover:bg-graf-900/60"
                    onClick={() => abrir(c)} aria-expanded={aberto === c.tecnico_id}>
                    <td className="px-3 py-1.5 text-xs text-graf-100">
                      {c.tecnico}
                      {c.matricula && <span className="ml-1 text-graf-400">· {c.matricula}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-graf-400">{c.equipe ?? '—'}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs font-semibold text-graf-100">{c.seriais}</td>
                    <td className="px-3 py-1.5 text-[11px] text-graf-300">
                      {[c.inicializadas && `${c.inicializadas} inicializada(s)`,
                        c.retiradas && `${c.retiradas} retirada(s)`,
                        c.com_defeito && `${c.com_defeito} com defeito`,
                        c.sem_condicao && `${c.sem_condicao} sem condição`].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                      {c.mais_antiga_dias == null ? '—' : `${c.mais_antiga_dias} d`}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                      {c.itens_misc ? `${c.itens_misc} item(ns)` : '—'}
                    </td>
                  </tr>
                  {aberto === c.tecnico_id && (
                    <tr className="border-b border-graf-800 bg-graf-900/50">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="mb-2 flex gap-3">
                          <button onClick={() => termo(c)}
                            className="text-[11px] text-af-400 underline underline-offset-2">
                            imprimir termo da carga
                          </button>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <h3 className="text-[10px] font-medium uppercase tracking-wide text-graf-400">
                              Seriais · {pecas.length}
                            </h3>
                            <ul className="mt-1 max-h-64 overflow-auto text-xs">
                              {pecas.map(p => (
                                <li key={p.serial} className="flex gap-2 border-b border-graf-800 py-1">
                                  <span className="tabular w-40 shrink-0 font-mono text-graf-100">{p.serial}</span>
                                  <span className="min-w-0 flex-1 truncate text-graf-400">
                                    {[p.tipo, p.condicao && CONDICAO[p.condicao], p.posse_motivo].filter(Boolean).join(' · ')}
                                  </span>
                                  <span className="tabular shrink-0 text-graf-300">
                                    {dias(p.posse_em) === 0 ? 'hoje' : `${dias(p.posse_em) ?? '—'} d`}
                                  </span>
                                </li>
                              ))}
                              {pecas.length === 0 && <li className="py-1 text-graf-400">Nenhum serial.</li>}
                            </ul>
                          </div>
                          <div>
                            <h3 className="text-[10px] font-medium uppercase tracking-wide text-graf-400">
                              Material · {misc.length}
                            </h3>
                            <ul className="mt-1 max-h-64 overflow-auto text-xs">
                              {misc.map(m => (
                                <li key={m.nome} className="flex gap-2 border-b border-graf-800 py-1">
                                  <span className="tabular w-20 shrink-0 text-right font-semibold text-graf-100">
                                    {Number(m.qtd).toLocaleString('pt-BR')} {m.unidade}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-graf-300">{m.nome}</span>
                                </li>
                              ))}
                              {misc.length === 0 && <li className="py-1 text-graf-400">Nenhum material.</li>}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

