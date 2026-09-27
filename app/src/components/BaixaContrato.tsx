import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta } from './ui'

/**
 * Baixa de material por contrato — o "Baixar Miscelâneas" do concorrente
 * (089-D, D-165).
 *
 * ┌─ POR QUE EXISTE ─────────────────────────────────────────────────┐
 * │ Sem isto, o conector que o técnico instalou continua no saldo    │
 * │ dele para sempre: a carga só cresce, e ninguém sabe o que foi    │
 * │ gasto de verdade e o que sumiu. A baixa tira do saldo DO TÉCNICO │
 * │ e amarra ao contrato — é o que responde "quanto de conector se   │
 * │ gasta por instalação".                                           │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * O contrato é achado sem trazer nome, telefone nem endereço do
 * assinante (`contrato_para_baixa`): o almoxarifado precisa do serviço e
 * da equipe, não do cliente (LGPD).
 */

interface Contrato {
  visita_id: string; contrato: string; data: string; situacao: string
  servico: string | null; equipe: string | null; tecnicos: { id: string; nome: string }[]
}
interface ItemSaldo { item_id: string; nome: string; codigo: string | null; unidade: string; qtd: number }

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

export function BaixaContrato({ podeMexer }: { podeMexer: boolean }) {
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<Contrato[] | null>(null)
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [tecnico, setTecnico] = useState('')
  const [saldo, setSaldo] = useState<ItemSaldo[]>([])
  const [qtds, setQtds] = useState<Record<string, string>>({})
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function procurar() {
    setErro(null); setOk(null); setContrato(null); setTecnico(''); setSaldo([])
    const { data, error } = await supabase.rpc('contrato_para_baixa', { p_contrato: busca })
    if (error) setErro(error.message)
    else setAchados((data ?? []) as Contrato[])
  }

  async function escolherTecnico(id: string) {
    setTecnico(id); setQtds({}); setSaldo([])
    if (!id) return
    const { data } = await supabase.rpc('miscelanea_saldos')
    type S = { item_id: string; nome: string; codigo: string | null; unidade: string; consumivel: boolean
               por_tecnico: { tecnico_id: string; qtd: number }[] }
    // Só o que o técnico TEM: baixar do que ele não tem é conta errada,
    // e o banco recusaria de qualquer jeito.
    setSaldo(((data ?? []) as S[]).flatMap(i => {
      const t = i.por_tecnico.find(x => x.tecnico_id === id)
      return t && t.qtd > 0 ? [{ item_id: i.item_id, nome: i.nome, codigo: i.codigo, unidade: i.unidade, qtd: t.qtd }] : []
    }))
  }

  async function baixar() {
    if (!contrato || !tecnico) return
    const itens = Object.entries(qtds)
      .map(([item_id, q]) => ({ item_id, quantidade: q.replace(',', '.') }))
      .filter(i => Number(i.quantidade) > 0)
    if (itens.length === 0) return
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('baixar_miscelanea', {
      p_visita: contrato.visita_id, p_tecnico: tecnico, p_itens: itens, p_observacao: obs || null,
    })
    if (error) setErro(/permiss/i.test(error.message)
      ? 'Seu perfil não inclui "Declarar a posse" no almoxarifado. A barreira é do banco.'
      : error.message)
    else {
      setOk(`${data} item(ns) baixado(s) no contrato ${contrato.contrato}. Saiu do saldo do técnico e fica no Kardex.`)
      setQtds({}); setObs('')
      await escolherTecnico(tecnico)
    }
    setOcupado(false)
  }

  return (
    <div className="space-y-3">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      <section className="card-controle p-4">
        <h2 className="text-sm font-semibold">Baixar material gasto no contrato</h2>
        <p className="mt-1 max-w-3xl text-xs text-graf-400">
          O que o técnico usou na instalação sai do saldo <strong>dele</strong> e fica amarrado ao
          contrato. Só aparece o material que ele tem.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-graf-400">
            <span className="mb-1 block">Contrato ou WO</span>
            <input value={busca} onChange={e => setBusca(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') procurar() }}
              className={`${campo} w-48 font-mono`} />
          </label>
          <button onClick={procurar} disabled={!busca.trim()}
            className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-200
                       hover:border-af-600 disabled:opacity-40">
            procurar
          </button>
        </div>

        {achados && achados.length === 0 && (
          <p className="mt-2 text-xs text-graf-400">Nenhum contrato com esse número.</p>
        )}
        {achados && achados.length > 0 && !contrato && (
          <ul className="mt-2 space-y-1">
            {achados.map(c => (
              <li key={c.visita_id}>
                <button onClick={() => { setContrato(c); setTecnico('') }}
                  className="w-full rounded-md border border-graf-700 px-3 py-1.5 text-left text-xs
                             text-graf-200 hover:border-af-600">
                  <strong>{c.contrato}</strong> · {new Date(c.data + 'T12:00').toLocaleDateString('pt-BR')}
                  {' · '}{c.servico ?? 'serviço não informado'} · {c.equipe ?? 'sem equipe'} ·{' '}
                  <span className="text-graf-400">{c.situacao.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {contrato && (
        <section className="card-controle p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-graf-400">Contrato</span>
            <strong className="text-graf-100">{contrato.contrato}</strong>
            <span className="text-graf-400">
              · {new Date(contrato.data + 'T12:00').toLocaleDateString('pt-BR')} · {contrato.equipe ?? 'sem equipe'}
            </span>
            <button onClick={() => setContrato(null)}
              className="ml-auto text-[11px] text-af-400 underline underline-offset-2">trocar</button>
          </div>
          <label className="mt-3 block text-[11px] text-graf-400">
            <span className="mb-1 block">Técnico que gastou</span>
            <select value={tecnico} onChange={e => escolherTecnico(e.target.value)} className={`${campo} w-72`}>
              <option value="">— escolha —</option>
              {contrato.tecnicos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            {contrato.tecnicos.length === 0 && (
              <span className="mt-1 block text-amber-300">
                A equipe deste contrato não tem técnico ativo cadastrado.
              </span>
            )}
          </label>

          {tecnico && (saldo.length === 0 ? (
            <p className="mt-3 text-xs text-graf-400">Este técnico não tem material no saldo.</p>
          ) : (
            <>
              <table className="mt-3 w-full text-sm">
                <thead className="border-b border-graf-700 text-left text-[10px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Material</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Com ele</th>
                    <th className="py-1.5 text-right font-medium">Gastou</th>
                  </tr>
                </thead>
                <tbody>
                  {saldo.map(i => {
                    const q = Number((qtds[i.item_id] ?? '').replace(',', '.'))
                    const passou = q > i.qtd
                    return (
                      <tr key={i.item_id} className="border-b border-graf-800">
                        <td className="py-1 pr-2 text-xs text-graf-200">
                          {i.nome}{i.codigo && <span className="text-graf-400"> · {i.codigo}</span>}
                        </td>
                        <td className="tabular py-1 pr-2 text-right text-xs text-graf-300">
                          {Number(i.qtd).toLocaleString('pt-BR')} {i.unidade}
                        </td>
                        <td className="py-1 text-right">
                          <input value={qtds[i.item_id] ?? ''} inputMode="decimal"
                            onChange={e => setQtds(x => ({ ...x, [i.item_id]: e.target.value }))}
                            aria-label={`Quantidade gasta de ${i.nome}`}
                            className={`${campo} w-20 text-right ${passou ? 'border-af-500' : ''}`} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <input value={obs} onChange={e => setObs(e.target.value)} placeholder="observação (opcional)"
                  aria-label="Observação" className={`${campo} min-w-64 flex-1`} />
                <button onClick={baixar}
                  disabled={!podeMexer || ocupado || !Object.values(qtds).some(q => Number(q.replace(',', '.')) > 0)}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-40">
                  Baixar no contrato
                </button>
              </div>
            </>
          ))}
        </section>
      )}
    </div>
  )
}
