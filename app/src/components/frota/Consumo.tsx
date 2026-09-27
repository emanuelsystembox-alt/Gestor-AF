import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isoLocal, reais } from '../../lib/formato'
import { Alerta, Metrica, Vazio } from '../ui'
import {
  CAMPO, EXCECAO, nomeVeiculo, num, type TecnicoOpcao, type VeiculoPainel,
} from '../../lib/frota'

/**
 * Consumo e exceções — o que o concorrente não entrega.
 *
 * ┌─ POR QUE AQUI HÁ NÚMERO E LÁ HÁ "—" ─────────────────────────────┐
 * │ O "Uso e Consumo" do Alfa Gestor mede o km pela PORTARIA (saída ×  │
 * │ entrada). A portaria está parada desde out/2023, então em 26/09   │
 * │ ele mostrava: 0 de 154 veículos, consumo "—", custo/km "—" — ao   │
 * │ lado de 14.938 L e R$ 108.972 abastecidos no mês.                 │
 * │                                                                   │
 * │ O odômetro, porém, é digitado em CADA abastecimento (191 de 195   │
 * │ na semana). Entre duas leituras válidas o carro andou a diferença │
 * │ com o combustível que entrou no meio. É dessa conta que sai tudo  │
 * │ abaixo (088-G) — e o km/l é do carro, não o 10,00 de fábrica que  │
 * │ o concorrente tem em 154 de 154 cadastros.                        │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Sem km medido, a célula diz "sem km medido" — não zero (D-117).
 */

interface LinhaConsumo {
  veiculo_id: string; abastecimentos: number; litros: number; valor: number
  km: number | null; km_por_litro: number | null; custo_por_km: number | null
  sem_hodometro: number
}
interface Intervalo {
  veiculo_id: string; tecnico_id: string | null; km: number
  litros_anterior: number | null; km_por_litro: number | null
}
interface Excecao {
  abastecimento_id: string; veiculo_id: string; data: string; tecnico_id: string | null
  tipo: string; detalhe: string
}

const menosDias = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d)
}

export function Consumo({ veiculos, tecnicos }: { veiculos: VeiculoPainel[]; tecnicos: TecnicoOpcao[] }) {
  const [de, setDe] = useState(menosDias(30))
  const [ate, setAte] = useState(isoLocal())
  const [consumo, setConsumo] = useState<LinhaConsumo[]>([])
  const [intervalos, setIntervalos] = useState<Intervalo[]>([])
  const [excecoes, setExcecoes] = useState<Excecao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [visao, setVisao] = useState<'veiculo' | 'tecnico'>('veiculo')

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const [c, i, e] = await Promise.all([
      supabase.rpc('frota_consumo', { p_de: de, p_ate: ate }),
      supabase.rpc('frota_intervalos', { p_de: de, p_ate: ate }),
      supabase.rpc('frota_excecoes', { p_de: de, p_ate: ate }),
    ])
    if (c.error || i.error || e.error) setErro((c.error ?? i.error ?? e.error)!.message)
    setConsumo((c.data ?? []) as LinhaConsumo[])
    setIntervalos((i.data ?? []) as Intervalo[])
    setExcecoes((e.data ?? []) as Excecao[])
    setCarregando(false)
  }, [de, ate])
  useEffect(() => { carregar() }, [carregar])

  const veic = useMemo(() => new Map(veiculos.map(v => [v.id, v])), [veiculos])
  const tec = useMemo(() => new Map(tecnicos.map(t => [t.id, t.nome])), [tecnicos])

  // Totais da frota: km/l PONDERADO (soma do km ÷ soma do combustível dos
  // trechos medidos), nunca média de médias — carro que andou 50 km não
  // pesa igual ao que andou 3.000.
  const validos = intervalos.filter(i => i.km >= 0 && (i.litros_anterior ?? 0) > 0)
  const kmTotal = validos.reduce((s, i) => s + i.km, 0)
  const litrosMedidos = validos.reduce((s, i) => s + Number(i.litros_anterior), 0)
  const valorTotal = consumo.reduce((s, c) => s + Number(c.valor), 0)
  const litrosTotal = consumo.reduce((s, c) => s + Number(c.litros), 0)
  const valorComKm = consumo.filter(c => (c.km ?? 0) > 0).reduce((s, c) => s + Number(c.valor), 0)
  const semKm = consumo.filter(c => !c.km).length

  /** Por técnico: o trecho vai para quem estava com o carro no abastecimento
   *  que FECHA o trecho — é quem chegou com aquele odômetro. */
  const porTecnico = useMemo(() => {
    const m = new Map<string, { km: number; litros: number; trechos: number }>()
    validos.forEach(i => {
      const k = i.tecnico_id ?? ''
      const x = m.get(k) ?? { km: 0, litros: 0, trechos: 0 }
      x.km += i.km; x.litros += Number(i.litros_anterior); x.trechos++
      m.set(k, x)
    })
    return [...m].map(([id, x]) => ({ id, ...x, kml: x.litros > 0 ? x.km / x.litros : null }))
      .sort((a, b) => (a.kml ?? 99) - (b.kml ?? 99))
  }, [validos])

  const linhasVeiculo = [...consumo].sort((a, b) =>
    (a.km_por_litro ?? 99) - (b.km_por_litro ?? 99))

  return (
    <div className="space-y-3">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">De</span>
          <input type="date" value={de} onChange={e => setDe(e.target.value)} className={CAMPO} />
        </label>
        <label className="text-[11px] text-graf-400">
          <span className="mb-1 block">Até</span>
          <input type="date" value={ate} onChange={e => setAte(e.target.value)} className={CAMPO} />
        </label>
        <p className="max-w-xl text-[11px] text-graf-400">
          Contam os abastecimentos <strong>aprovados</strong> e <strong>abastecidos</strong>.
          O km de cada trecho vai de uma leitura de odômetro válida à seguinte.
        </p>
      </div>

      {carregando ? (
        <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
      ) : consumo.length === 0 ? (
        <Vazio titulo="Nenhum abastecimento no período"
          descricao="O consumo aparece quando houver pelo menos dois abastecimentos do mesmo carro com odômetro." />
      ) : (<>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Metrica valor={reais(valorTotal)} rotulo="Abastecido" />
          <Metrica valor={`${num(litrosTotal, 0)} L`} rotulo="Litros" />
          <Metrica valor={kmTotal > 0 ? `${kmTotal.toLocaleString('pt-BR')} km` : '—'}
            rotulo="Km medido" />
          <Metrica valor={litrosMedidos > 0 ? num(kmTotal / litrosMedidos, 1) : '—'}
            rotulo="Km/l da frota" />
          <Metrica valor={kmTotal > 0 ? `R$ ${num(valorComKm / kmTotal, 2)}` : '—'}
            rotulo="Custo por km" />
          <Metrica valor={excecoes.length} rotulo="Exceções a conferir"
            alerta={excecoes.length > 0} cor={excecoes.length > 0 ? '#fcd34d' : undefined} />
        </div>
        {semKm > 0 && (
          <p className="text-[11px] text-graf-400">
            {semKm} veículo(s) abasteceram no período sem km medido (um abastecimento só, ou sem
            odômetro): entram no valor e nos litros, não no km nem no custo por km.
          </p>
        )}

        {/* ---- exceções primeiro: é o que pede ação ---- */}
        {excecoes.length > 0 && (
          <section className="card-controle overflow-hidden">
            <h2 className="border-b border-graf-800 px-4 py-2 text-sm font-semibold">
              Exceções a conferir · {excecoes.length}
            </h2>
            <p className="border-b border-graf-800 px-4 py-1.5 text-[11px] text-graf-400">
              Não bloqueiam nada — são lançamentos para alguém olhar. "Km muito baixo" compara com
              o próprio carro nos últimos 90 dias (menos de 1/3 do km/l normal dele).
            </p>
            <ul className="max-h-80 overflow-auto">
              {excecoes.sort((a, b) => b.data.localeCompare(a.data)).map(x => {
                const v = veic.get(x.veiculo_id)
                return (
                  <li key={x.abastecimento_id + x.tipo}
                    className="flex flex-wrap items-baseline gap-x-3 border-b border-graf-800 px-4 py-1.5 text-xs">
                    <span className="tabular text-graf-400">
                      {new Date(x.data + 'T12:00').toLocaleDateString('pt-BR')}
                    </span>
                    <span className="font-semibold text-amber-300" title={EXCECAO[x.tipo]?.ajuda}>
                      {EXCECAO[x.tipo]?.rotulo ?? x.tipo}
                    </span>
                    <span className="text-graf-100">{v ? nomeVeiculo(v) : '—'}</span>
                    <span className="text-graf-300">{x.detalhe}</span>
                    <span className="text-graf-400">{x.tecnico_id ? tec.get(x.tecnico_id) : 'sem condutor'}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <div className="flex rounded-lg bg-graf-900 p-0.5 text-xs">
          {([['veiculo', 'Por veículo'], ['tecnico', 'Por condutor (técnico)']] as const).map(([k, r]) => (
            <button key={k} onClick={() => setVisao(k)} aria-pressed={visao === k}
              className={`rounded-md px-3 py-1.5 font-medium ${
                visao === k ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
              {r}
            </button>
          ))}
        </div>

        {visao === 'veiculo' ? (
          <section className="card-controle overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                                uppercase tracking-wide text-graf-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Veículo</th>
                  <th className="px-3 py-2 font-medium">Condutor hoje</th>
                  <th className="px-3 py-2 text-right font-medium">Abast.</th>
                  <th className="px-3 py-2 text-right font-medium">Litros</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 text-right font-medium">Km</th>
                  <th className="px-3 py-2 text-right font-medium">Km/l</th>
                  <th className="px-3 py-2 text-right font-medium">R$/km</th>
                </tr>
              </thead>
              <tbody>
                {linhasVeiculo.map(c => {
                  const v = veic.get(c.veiculo_id)
                  return (
                    <tr key={c.veiculo_id} className="border-b border-graf-800">
                      <td className="px-3 py-1.5 text-xs text-graf-100">{v ? nomeVeiculo(v) : '—'}</td>
                      <td className="px-3 py-1.5 text-xs text-graf-300">{v?.condutor_nome ?? '—'}</td>
                      <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                        {c.abastecimentos}
                        {c.sem_hodometro > 0 && (
                          <span className="ml-1 text-[10px] text-amber-300" title="sem odômetro">
                            ({c.sem_hodometro} s/ odôm.)
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">{num(c.litros, 1)}</td>
                      <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">{reais(c.valor)}</td>
                      <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                        {c.km ? c.km.toLocaleString('pt-BR') : <span className="text-graf-400">sem km medido</span>}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-xs font-semibold text-graf-100">
                        {c.km_por_litro != null ? num(c.km_por_litro, 1) : '—'}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                        {c.custo_por_km != null ? num(c.custo_por_km, 2) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="card-controle overflow-x-auto">
            <p className="border-b border-graf-800 px-4 py-1.5 text-[11px] text-graf-400">
              O trecho conta para quem estava com o carro no abastecimento que fecha o trecho.
              Menor km/l primeiro: é por onde se começa a conversa.
            </p>
            <table className="w-full text-sm">
              <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                                uppercase tracking-wide text-graf-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Técnico</th>
                  <th className="px-3 py-2 text-right font-medium">Trechos</th>
                  <th className="px-3 py-2 text-right font-medium">Km</th>
                  <th className="px-3 py-2 text-right font-medium">Litros</th>
                  <th className="px-3 py-2 text-right font-medium">Km/l</th>
                </tr>
              </thead>
              <tbody>
                {porTecnico.map(t => (
                  <tr key={t.id || 'sem'} className="border-b border-graf-800">
                    <td className="px-3 py-1.5 text-xs text-graf-100">
                      {t.id ? tec.get(t.id) ?? 'técnico desligado' : <span className="text-graf-400">sem condutor declarado</span>}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">{t.trechos}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">{t.km.toLocaleString('pt-BR')}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">{num(t.litros, 1)}</td>
                    <td className="tabular px-3 py-1.5 text-right text-xs font-semibold text-graf-100">
                      {t.kml != null ? num(t.kml, 1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </>)}
    </div>
  )
}
