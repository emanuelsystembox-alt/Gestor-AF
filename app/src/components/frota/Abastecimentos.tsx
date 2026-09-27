import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isoLocal, reais } from '../../lib/formato'
import { Alerta, Vazio } from '../ui'
import {
  CAMPO, COMBUSTIVEL, EXCECAO, SITUACAO_ABASTECIMENTO, km, nomeVeiculo, num,
  traduzirErroFrota, type SituacaoAbastecimento, type TecnicoOpcao, type VeiculoPainel,
} from '../../lib/frota'

/**
 * Abastecimentos — o que a AFLINE de fato usa no concorrente.
 *
 * ┌─ O QUE O DADO DELES MOSTROU (semana de 20 a 26/09) ──────────────┐
 * │ 195 lançamentos · valor FIXO (R$ 150 ou 200: é vale de posto) ·   │
 * │ litros = valor ÷ preço · odômetro em 191 de 195 · 185 ficaram     │
 * │ "aprovado" e só 4 chegaram a "abastecido". Então o padrão aqui é  │
 * │ nascer APROVADO, como lá na prática; "em aberto" e "abastecido"   │
 * │ continuam existindo para quem quiser usar o fluxo inteiro.        │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * O condutor vem sozinho do carro (o técnico com ele hoje) e pode ser
 * trocado no lançamento — o carro às vezes abastece na mão de outro.
 */

interface Linha {
  id: string; data: string; combustivel: string; valor: number; valor_litro: number
  litros: number; hodometro: number | null; posto: string | null; observacao: string | null
  situacao: SituacaoAbastecimento; cancelado_motivo: string | null
  veiculo_id: string; tecnico_id: string | null
  veiculo: { placa: string; apelido: string | null } | null
  tecnico: { nome: string } | null
}
interface Excecao { abastecimento_id: string; tipo: string; detalhe: string }

const inicioDoMes = () => isoLocal().slice(0, 8) + '01'

export function Abastecimentos({ veiculos, tecnicos, podeMexer }: {
  veiculos: VeiculoPainel[]; tecnicos: TecnicoOpcao[]; podeMexer: boolean
}) {
  const [de, setDe] = useState(inicioDoMes())
  const [ate, setAte] = useState(isoLocal())
  const [filtroVeiculo, setFiltroVeiculo] = useState('')
  const [filtroSit, setFiltroSit] = useState<SituacaoAbastecimento | ''>('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [excecoes, setExcecoes] = useState<Map<string, Excecao[]>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // lançamento
  const [lancando, setLancando] = useState(false)
  const [f, setF] = useState({
    veiculo_id: '', tecnico_id: '', data: isoLocal(), combustivel: 'GASOLINA_COMUM',
    valor: '', valor_litro: '', hodometro: '', posto: '', observacao: '', situacao: 'APROVADO',
  })

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    let q = supabase.from('abastecimento')
      .select('id, data, combustivel, valor, valor_litro, litros, hodometro, posto, observacao, '
            + 'situacao, cancelado_motivo, veiculo_id, tecnico_id, '
            + 'veiculo:veiculo_id ( placa, apelido ), tecnico:tecnico_id ( nome )')
      .gte('data', de).lte('data', ate)
      .order('data', { ascending: false }).order('criado_em', { ascending: false })
      .limit(1000)
    if (filtroVeiculo) q = q.eq('veiculo_id', filtroVeiculo)
    if (filtroSit) q = q.eq('situacao', filtroSit)
    const [l, e] = await Promise.all([q, supabase.rpc('frota_excecoes', { p_de: de, p_ate: ate })])
    if (l.error) setErro(l.error.message)
    setLinhas((l.data ?? []) as unknown as Linha[])
    const m = new Map<string, Excecao[]>()
    ;((e.data ?? []) as Excecao[]).forEach(x => m.set(x.abastecimento_id, [...(m.get(x.abastecimento_id) ?? []), x]))
    setExcecoes(m)
    setCarregando(false)
  }, [de, ate, filtroVeiculo, filtroSit])
  useEffect(() => { carregar() }, [carregar])

  const veiculoSel = veiculos.find(v => v.id === f.veiculo_id)
  const litrosCalc = Number(f.valor) > 0 && Number(f.valor_litro) > 0
    ? Number(f.valor) / Number(f.valor_litro) : null
  // O odômetro digitado menor que o já conhecido: avisa ANTES de lançar.
  // Não bloqueia — pode ser o conhecido que está errado —, mas vira exceção.
  const odoBaixo = veiculoSel?.hodometro_atual != null && Number(f.hodometro) > 0
    && Number(f.hodometro) < veiculoSel.hodometro_atual

  function abrirLancamento() {
    // O preço do litro repete o último lançado: é o mesmo posto, o mesmo
    // dia, e digitar 7,29 cento e noventa vezes por semana é erro esperando.
    const ultimoPreco = linhas.find(l => l.situacao !== 'CANCELADO')?.valor_litro
    setF(x => ({ ...x, valor_litro: x.valor_litro || (ultimoPreco ? String(ultimoPreco) : '') }))
    setLancando(true); setErro(null); setOk(null)
  }

  function escolherVeiculo(id: string) {
    const v = veiculos.find(x => x.id === id)
    setF(x => ({ ...x, veiculo_id: id, tecnico_id: v?.condutor_id ?? '' }))
  }

  async function lancar() {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('lancar_abastecimento', {
      p_dados: { ...f, valor: f.valor.replace(',', '.'), valor_litro: f.valor_litro.replace(',', '.') },
    })
    if (error) setErro(traduzirErroFrota(error.message))
    else {
      setOk(`Abastecimento de ${veiculoSel ? nomeVeiculo(veiculoSel) : ''} lançado.`)
      // Mantém data, preço e combustível: o próximo lançamento é quase igual.
      setF(x => ({ ...x, veiculo_id: '', tecnico_id: '', valor: '', hodometro: '', posto: '', observacao: '' }))
      await carregar()
    }
    setOcupado(false)
  }

  async function mudar(l: Linha, para: SituacaoAbastecimento) {
    let motivo: string | null = null
    let hodometro: number | null = null
    if (para === 'CANCELADO') {
      motivo = prompt('Por que este abastecimento está sendo cancelado?')
      if (!motivo) return
    }
    if (para === 'ABASTECIDO' && l.hodometro == null) {
      const h = prompt('Odômetro na hora do abastecimento (km) — deixe vazio se não souber:')
      if (h === null) return
      hodometro = Number(h.replace(/\D/g, '')) || null
    }
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('mudar_abastecimento', {
      p_id: l.id, p_situacao: para, p_motivo: motivo, p_hodometro: hodometro,
    })
    if (error) setErro(traduzirErroFrota(error.message))
    else { setOk(`Abastecimento: ${SITUACAO_ABASTECIMENTO[para].rotulo.toLowerCase()}.`); await carregar() }
    setOcupado(false)
  }

  const validos = linhas.filter(l => l.situacao === 'APROVADO' || l.situacao === 'ABASTECIDO')
  const total = useMemo(() => ({
    valor: validos.reduce((s, l) => s + Number(l.valor), 0),
    litros: validos.reduce((s, l) => s + Number(l.litros), 0),
  }), [validos])

  const campo = (k: keyof typeof f, rotulo: string, props: Record<string, unknown> = {}) => (
    <label className="text-[11px] text-graf-400">
      <span className="mb-1 block">{rotulo}</span>
      <input value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))}
        className={`${CAMPO} w-full`} {...props} />
    </label>
  )

  return (
    <div className="space-y-3">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">De</span>
          <input type="date" value={de} onChange={e => setDe(e.target.value)} className={CAMPO} />
        </label>
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">Até</span>
          <input type="date" value={ate} onChange={e => setAte(e.target.value)} className={CAMPO} />
        </label>
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">Veículo</span>
          <select value={filtroVeiculo} onChange={e => setFiltroVeiculo(e.target.value)}
            className={`${CAMPO} w-56`}>
            <option value="">todos</option>
            {veiculos.map(v => <option key={v.id} value={v.id}>{nomeVeiculo(v)}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">Situação</span>
          <select value={filtroSit} onChange={e => setFiltroSit(e.target.value as SituacaoAbastecimento | '')}
            className={`${CAMPO} w-36`}>
            <option value="">todas</option>
            {(Object.keys(SITUACAO_ABASTECIMENTO) as SituacaoAbastecimento[]).map(s => (
              <option key={s} value={s}>{SITUACAO_ABASTECIMENTO[s].rotulo}</option>
            ))}
          </select>
        </label>
        {podeMexer && !lancando && (
          <button onClick={abrirLancamento} disabled={veiculos.length === 0}
            className="ml-auto rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium text-white
                       hover:bg-af-500 disabled:opacity-40">
            + Abastecimento
          </button>
        )}
      </div>

      {lancando && (
        <section className="card-controle p-4">
          <h2 className="text-sm font-semibold">Lançar abastecimento</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Veículo *</span>
              <select value={f.veiculo_id} onChange={e => escolherVeiculo(e.target.value)}
                className={`${CAMPO} w-full`}>
                <option value="">— escolha —</option>
                {veiculos.map(v => <option key={v.id} value={v.id}>{nomeVeiculo(v)}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Condutor (técnico)</span>
              <select value={f.tecnico_id} onChange={e => setF(x => ({ ...x, tecnico_id: e.target.value }))}
                className={`${CAMPO} w-full`}>
                <option value="">— sem condutor —</option>
                {tecnicos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
            {campo('data', 'Data', { type: 'date' })}
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Combustível</span>
              <select value={f.combustivel} onChange={e => setF(x => ({ ...x, combustivel: e.target.value }))}
                className={`${CAMPO} w-full`}>
                {Object.entries(COMBUSTIVEL).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
              </select>
            </label>
            {campo('valor', 'Valor (R$) *', { inputMode: 'decimal', placeholder: '150,00' })}
            {campo('valor_litro', 'Preço do litro (R$) *', { inputMode: 'decimal', placeholder: '7,29' })}
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Odômetro (km)</span>
              <input value={f.hodometro} inputMode="numeric"
                onChange={e => setF(x => ({ ...x, hodometro: e.target.value.replace(/\D/g, '') }))}
                placeholder={veiculoSel?.hodometro_atual ? `último: ${veiculoSel.hodometro_atual}` : ''}
                className={`${CAMPO} w-full ${odoBaixo ? 'border-amber-500' : ''}`} />
            </label>
            {campo('posto', 'Posto')}
            <label className="text-[11px] text-graf-400">
              <span className="mb-1 block">Nasce como</span>
              <select value={f.situacao} onChange={e => setF(x => ({ ...x, situacao: e.target.value }))}
                className={`${CAMPO} w-full`}>
                <option value="APROVADO">Aprovado (vale liberado)</option>
                <option value="EM_ABERTO">Em aberto (pedido, falta aprovar)</option>
                <option value="ABASTECIDO">Abastecido (já no tanque)</option>
              </select>
            </label>
            <div className="sm:col-span-2 lg:col-span-3">
              {campo('observacao', 'Observação')}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-graf-400">
            {litrosCalc != null
              ? <>São <strong className="text-graf-200">{num(litrosCalc, 2)} L</strong> (valor ÷ preço).</>
              : 'Litros = valor ÷ preço do litro.'}
            {!f.hodometro && f.veiculo_id && ' Sem odômetro o combustível conta, mas o km deste trecho não.'}
          </p>
          {odoBaixo && (
            <p className="mt-1 text-[11px] text-amber-300">
              Odômetro menor que o último conhecido deste carro ({km(veiculoSel?.hodometro_atual)}).
              Se lançar assim, ele aparece em Consumo como "odômetro voltou".
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={lancar}
              disabled={ocupado || !f.veiculo_id || !(Number(f.valor.replace(',', '.')) > 0)
                        || !(Number(f.valor_litro.replace(',', '.')) > 0)}
              className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                         hover:bg-af-500 disabled:opacity-40">
              Lançar
            </button>
            <button onClick={() => setLancando(false)}
              className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300">
              Fechar
            </button>
          </div>
        </section>
      )}

      {carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : linhas.length === 0 ? (
        <Vazio titulo="Nenhum abastecimento no período" />
      ) : (
        <section className="card-controle overflow-x-auto">
          <p className="border-b border-graf-800 px-4 py-2 text-xs text-graf-400">
            <strong className="text-graf-200">{linhas.length}</strong> lançamento(s) ·
            aprovado + abastecido: <strong className="text-graf-200">{reais(total.valor)}</strong>
            {' '}· <strong className="text-graf-200">{num(total.litros, 1)} L</strong>
          </p>
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Veículo</th>
                <th className="px-3 py-2 font-medium">Condutor</th>
                <th className="px-3 py-2 font-medium">Combustível</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-3 py-2 text-right font-medium">R$/L</th>
                <th className="px-3 py-2 text-right font-medium">Litros</th>
                <th className="px-3 py-2 text-right font-medium">Odômetro</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => {
                const exc = excecoes.get(l.id) ?? []
                return (
                  <tr key={l.id} className="border-b border-graf-800 align-top">
                    <td className="tabular px-3 py-1.5 text-xs text-graf-300">
                      {new Date(l.data + 'T12:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-graf-100">
                      {l.veiculo ? nomeVeiculo(l.veiculo) : '—'}
                      {exc.map(x => (
                        <span key={x.tipo} title={`${EXCECAO[x.tipo]?.ajuda ?? ''} ${x.detalhe}`}
                          className="mt-0.5 block text-[10px] font-semibold text-amber-300">
                          ⚠ {EXCECAO[x.tipo]?.rotulo ?? x.tipo}: {x.detalhe}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-graf-300">{l.tecnico?.nome ?? '—'}</td>
                    <td className="px-3 py-1.5 text-xs text-graf-400">{COMBUSTIVEL[l.combustivel] ?? l.combustivel}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-100">{reais(l.valor)}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-400">{num(l.valor_litro, 2)}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">{num(l.litros, 2)}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                      {l.hodometro == null ? <span className="text-amber-300">não informado</span> : km(l.hodometro)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase
                                        ${SITUACAO_ABASTECIMENTO[l.situacao].classe}`}
                        title={l.cancelado_motivo ?? undefined}>
                        {SITUACAO_ABASTECIMENTO[l.situacao].rotulo}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      {podeMexer && l.situacao !== 'CANCELADO' && (<>
                        {l.situacao === 'EM_ABERTO' && (
                          <button onClick={() => mudar(l, 'APROVADO')} disabled={ocupado}
                            className="mr-1 rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                       text-graf-300 hover:border-af-600 hover:text-af-400">
                            aprovar
                          </button>
                        )}
                        {l.situacao !== 'ABASTECIDO' && (
                          <button onClick={() => mudar(l, 'ABASTECIDO')} disabled={ocupado}
                            className="mr-1 rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                       text-graf-300 hover:border-af-600 hover:text-af-400">
                            abastecido
                          </button>
                        )}
                        <button onClick={() => mudar(l, 'CANCELADO')} disabled={ocupado}
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
