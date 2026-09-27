import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isoLocal, reais } from '../../lib/formato'
import { Alerta, Vazio } from '../ui'
import { CAMPO, km, nomeVeiculo, traduzirErroFrota, type VeiculoPainel } from '../../lib/frota'

/**
 * Manutenções — corretiva ou preventiva, com os serviços e o valor de cada um.
 *
 * ┌─ O QUE O CONCORRENTE ENSINOU ────────────────────────────────────┐
 * │ Lá são 11 manutenções em um ano, e 8 sem valor nenhum: o campo   │
 * │ existia, ninguém preenchia, e o total saía R$ 0,00 — que é uma    │
 * │ afirmação falsa. Aqui serviço sem valor fica "sem valor" e o      │
 * │ total avisa que está incompleto (D-117). O total é SOMA dos       │
 * │ serviços, nunca coluna guardada (D-154).                          │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * A manutenção NÃO muda a situação do carro sozinha: abrir uma não
 * garante que ele saiu de circulação (revisão agendada, orçamento).
 * A tela oferece o atalho; quem decide é quem lança.
 */

interface Item { id?: string; descricao: string; valor: number | null }
interface Linha {
  id: string; veiculo_id: string; tipo: 'PREVENTIVA' | 'CORRETIVA'; data: string
  fornecedor: string | null; hodometro: number | null
  situacao: 'ABERTA' | 'CONCLUIDA' | 'CANCELADA'; observacao: string | null
  cancelado_motivo: string | null
  veiculo: { placa: string; apelido: string | null } | null
  manutencao_item: Item[]
}

const SIT: Record<Linha['situacao'], string> = {
  ABERTA: 'bg-amber-900/40 text-amber-300',
  CONCLUIDA: 'bg-emerald-900/40 text-emerald-300',
  CANCELADA: 'bg-graf-800 text-graf-400',
}

const VAZIO = { veiculo_id: '', tipo: 'CORRETIVA', data: isoLocal(), fornecedor: '',
                hodometro: '', observacao: '' }

export function Manutencoes({ veiculos, podeMexer, aoMudar }: {
  veiculos: VeiculoPainel[]; podeMexer: boolean; aoMudar: () => void
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [soAbertas, setSoAbertas] = useState(false)

  const [editando, setEditando] = useState<string | 'nova' | null>(null)
  const [f, setF] = useState({ ...VAZIO })
  const [itens, setItens] = useState<{ descricao: string; valor: string }[]>([{ descricao: '', valor: '' }])
  const [tirarDeCirculacao, setTirarDeCirculacao] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    let q = supabase.from('manutencao')
      .select('id, veiculo_id, tipo, data, fornecedor, hodometro, situacao, observacao, '
            + 'cancelado_motivo, veiculo:veiculo_id ( placa, apelido ), '
            + 'manutencao_item ( id, descricao, valor )')
      .order('data', { ascending: false }).limit(300)
    if (soAbertas) q = q.eq('situacao', 'ABERTA')
    const { data, error } = await q
    if (error) setErro(error.message)
    setLinhas((data ?? []) as unknown as Linha[])
    setCarregando(false)
  }, [soAbertas])
  useEffect(() => { carregar() }, [carregar])

  function abrir(l: Linha | null) {
    setErro(null); setOk(null); setTirarDeCirculacao(false)
    if (!l) {
      setF({ ...VAZIO }); setItens([{ descricao: '', valor: '' }]); setEditando('nova'); return
    }
    setF({ veiculo_id: l.veiculo_id, tipo: l.tipo, data: l.data, fornecedor: l.fornecedor ?? '',
           hodometro: l.hodometro ? String(l.hodometro) : '', observacao: l.observacao ?? '' })
    setItens(l.manutencao_item.length
      ? l.manutencao_item.map(i => ({ descricao: i.descricao, valor: i.valor == null ? '' : String(i.valor) }))
      : [{ descricao: '', valor: '' }])
    setEditando(l.id)
  }

  async function salvar() {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('salvar_manutencao', {
      p_id: editando === 'nova' ? null : editando,
      p_dados: f,
      p_itens: itens.filter(i => i.descricao.trim())
        .map(i => ({ descricao: i.descricao, valor: i.valor.replace(',', '.') })),
    })
    if (error) { setErro(traduzirErroFrota(error.message)); setOcupado(false); return }
    if (tirarDeCirculacao) {
      await supabase.rpc('definir_situacao_veiculo', {
        p_veiculo: f.veiculo_id, p_situacao: 'EM_MANUTENCAO', p_motivo: 'manutenção lançada',
      })
    }
    setOk('Manutenção salva.'); setEditando(null)
    await carregar(); aoMudar()
    setOcupado(false)
  }

  async function mudar(l: Linha, para: 'CONCLUIDA' | 'CANCELADA') {
    let motivo: string | null = null
    if (para === 'CANCELADA') {
      motivo = prompt('Por que esta manutenção está sendo cancelada?')
      if (!motivo) return
    }
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('mudar_manutencao', { p_id: l.id, p_situacao: para, p_motivo: motivo })
    if (error) setErro(traduzirErroFrota(error.message))
    else {
      setOk(para === 'CONCLUIDA'
        ? 'Manutenção concluída. Se o carro voltou a rodar, mude a situação dele em Veículos.'
        : 'Manutenção cancelada.')
      await carregar(); aoMudar()
    }
    setOcupado(false)
  }

  const total = (l: Linha) => {
    const comValor = l.manutencao_item.filter(i => i.valor != null)
    return { soma: comValor.reduce((s, i) => s + Number(i.valor), 0),
             faltam: l.manutencao_item.length - comValor.length }
  }

  return (
    <div className="space-y-3">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-graf-300">
          <input type="checkbox" checked={soAbertas} onChange={e => setSoAbertas(e.target.checked)}
            className="accent-af-600" />
          só as abertas
        </label>
        {podeMexer && !editando && (
          <button onClick={() => abrir(null)} disabled={veiculos.length === 0}
            className="ml-auto rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium text-white
                       hover:bg-af-500 disabled:opacity-40">
            + Manutenção
          </button>
        )}
      </div>

      {editando && (
        <section className="card-controle p-4">
          <h2 className="text-sm font-semibold">{editando === 'nova' ? 'Nova manutenção' : 'Editar manutenção'}</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Veículo *</span>
              <select value={f.veiculo_id} onChange={e => setF(x => ({ ...x, veiculo_id: e.target.value }))}
                className={`${CAMPO} w-full`}>
                <option value="">— escolha —</option>
                {veiculos.map(v => <option key={v.id} value={v.id}>{nomeVeiculo(v)}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Tipo</span>
              <select value={f.tipo} onChange={e => setF(x => ({ ...x, tipo: e.target.value }))}
                className={`${CAMPO} w-full`}>
                <option value="CORRETIVA">Corretiva</option>
                <option value="PREVENTIVA">Preventiva</option>
              </select>
            </label>
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Data</span>
              <input type="date" value={f.data} onChange={e => setF(x => ({ ...x, data: e.target.value }))}
                className={`${CAMPO} w-full`} />
            </label>
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Odômetro (km)</span>
              <input value={f.hodometro} inputMode="numeric"
                onChange={e => setF(x => ({ ...x, hodometro: e.target.value.replace(/\D/g, '') }))}
                className={`${CAMPO} w-full`} />
            </label>
            <label className="text-[11px] text-graf-400 sm:col-span-2">
              <span className="mb-1 block">Fornecedor (oficina, lanterneiro…)</span>
              <input value={f.fornecedor} onChange={e => setF(x => ({ ...x, fornecedor: e.target.value }))}
                className={`${CAMPO} w-full`} />
            </label>
            <label className="text-[11px] text-graf-400 sm:col-span-2">
              <span className="mb-1 block">Observação</span>
              <input value={f.observacao} onChange={e => setF(x => ({ ...x, observacao: e.target.value }))}
                className={`${CAMPO} w-full`} />
            </label>
          </div>

          <h3 className="mt-4 text-[10px] font-medium uppercase tracking-wide text-graf-400">Serviços</h3>
          <div className="mt-1 space-y-1.5">
            {itens.map((it, i) => (
              <div key={i} className="flex gap-2">
                <input value={it.descricao} placeholder="troca de óleo, lanternagem, pneu…"
                  aria-label={`Serviço ${i + 1}`}
                  onChange={e => setItens(l => l.map((x, j) => j === i ? { ...x, descricao: e.target.value } : x))}
                  className={`${CAMPO} flex-1`} />
                <input value={it.valor} placeholder="valor (vazio = sem valor)" inputMode="decimal"
                  aria-label={`Valor do serviço ${i + 1}`}
                  onChange={e => setItens(l => l.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))}
                  className={`${CAMPO} w-44 text-right`} />
                <button onClick={() => setItens(l => l.length > 1 ? l.filter((_, j) => j !== i) : l)}
                  aria-label={`Tirar serviço ${i + 1}`}
                  className="rounded border border-graf-700 px-2 text-[11px] text-graf-400 hover:text-af-400">
                  tirar
                </button>
              </div>
            ))}
            <button onClick={() => setItens(l => [...l, { descricao: '', valor: '' }])}
              className="text-[11px] text-af-400 underline underline-offset-2">
              + serviço
            </button>
          </div>

          {editando === 'nova' && (
            <label className="mt-3 flex items-center gap-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={tirarDeCirculacao}
                onChange={e => setTirarDeCirculacao(e.target.checked)} className="accent-af-600" />
              o carro está parado por isso — marcar como "em manutenção"
            </label>
          )}

          <div className="mt-3 flex gap-2">
            <button onClick={salvar} disabled={ocupado || !f.veiculo_id}
              className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                         hover:bg-af-500 disabled:opacity-40">
              Salvar
            </button>
            <button onClick={() => setEditando(null)}
              className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300">
              Cancelar
            </button>
          </div>
        </section>
      )}

      {carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : linhas.length === 0 ? (
        <Vazio titulo={soAbertas ? 'Nenhuma manutenção aberta' : 'Nenhuma manutenção lançada'} />
      ) : (
        <section className="card-controle overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Veículo</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Serviços</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Fornecedor</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => {
                const t = total(l)
                return (
                  <tr key={l.id} className="border-b border-graf-800 align-top">
                    <td className="tabular px-3 py-1.5 text-xs text-graf-300">
                      {new Date(l.data + 'T12:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-graf-100">
                      {l.veiculo ? nomeVeiculo(l.veiculo) : '—'}
                      {l.hodometro && <span className="block text-[10px] text-graf-400">{km(l.hodometro)}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-graf-300">
                      {l.tipo === 'CORRETIVA' ? 'Corretiva' : 'Preventiva'}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-graf-300">
                      {l.manutencao_item.length === 0 ? '—' : l.manutencao_item.map(i => (
                        <span key={i.id} className="block">
                          {i.descricao}{' '}
                          <span className="text-graf-400">{i.valor == null ? '· sem valor' : `· ${reais(i.valor)}`}</span>
                        </span>
                      ))}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-100">
                      {l.manutencao_item.length === 0 ? '—' : reais(t.soma)}
                      {t.faltam > 0 && (
                        <span className="block text-[10px] text-amber-300">
                          {t.faltam} serviço(s) sem valor
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-graf-400">{l.fornecedor ?? '—'}</td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SIT[l.situacao]}`}
                        title={l.cancelado_motivo ?? undefined}>
                        {l.situacao.toLowerCase()}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      {podeMexer && l.situacao === 'ABERTA' && (<>
                        <button onClick={() => abrir(l)} disabled={ocupado}
                          className="mr-1 rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                     text-graf-300 hover:border-af-600 hover:text-af-400">
                          editar
                        </button>
                        <button onClick={() => mudar(l, 'CONCLUIDA')} disabled={ocupado}
                          className="mr-1 rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                     text-graf-300 hover:border-af-600 hover:text-af-400">
                          concluir
                        </button>
                        <button onClick={() => mudar(l, 'CANCELADA')} disabled={ocupado}
                          className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                     text-graf-400 hover:border-af-600 hover:text-af-400">
                          cancelar
                        </button>
                      </>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
