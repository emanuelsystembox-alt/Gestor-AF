import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Metrica } from '../components/ui'
import { BarrasHorizontais, Painel, TabelaSimples } from '../components/graficos'
import { LinkContrato } from '../components/LinkContrato'
import { dataBR, diaMes, isoLocal } from '../lib/formato'

/**
 * Revisita por causa (180): de onde vêm as revisitas — por equipamento que
 * ficou no cliente, por técnico que fez o serviço anterior, por área e bairro.
 *
 * A regra da revisita é a da 163 (`revisita_dos_contratos`), e a conta é do
 * banco (`revisita_por_causa`): a tela só desenha. A taxa é revisitas ÷
 * serviços concluídos do mesmo recorte; linha com poucos serviços vem
 * marcada pelo banco e fica FORA do ranking (1 de 3 não é "o pior").
 *
 * O modelo só existe onde a varredura leu o TOA (D-250): o que não foi lido
 * aparece como "NÃO LIDO DO TOA", nunca some (regra 6).
 */

type Recorte = 'modelo' | 'tecnico' | 'area' | 'bairro'

interface Linha {
  recorte: Recorte; chave: string; rotulo: string; detalhe: string
  servicos: number; revisitas: number; taxa: number; vezes: number | null
  amostra_pequena: boolean
}
interface Contrato {
  anterior_id: string; contrato: string; anterior_data: string; anterior_grupo: string | null
  tecnico: string; tecnico_nome: string | null; area: string; bairro: string
  modelos: string[] | null
  visita_id: string; data: string; grupo: string | null; dias: number
}
interface Resposta {
  de: string; ate: string; grupo: string | null; min_amostra: number; completo_ate: string
  geral: { servicos: number; revisitas: number; taxa: number | null }
  cobertura: { servicos: number; lidos: number; com_modelo: number }
  grupos: { grupo: string | null; servicos: number; revisitas: number }[]
  linhas: Linha[]
  contratos: Contrato[]
}

const ABAS: [Recorte, string][] = [
  ['modelo', 'Equipamento'], ['tecnico', 'Técnico'], ['area', 'Área'], ['bairro', 'Bairro'],
]
// O que não é modelo — leitura que faltou — vai em cinza, não em cor de alerta.
const SEM_LEITURA = new Set(['NÃO LIDO DO TOA', 'SEM EQUIPAMENTO NO TOA', 'modelo não informado'])

const pctBR = (n: number | null) =>
  n == null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
const vezesBR = (n: number | null) =>
  n == null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`
const menosDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d) }

const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm text-graf-100'

export default function RevisitaCausa() {
  const [de, setDe] = useState(() => menosDias(30))
  const [ate, setAte] = useState(() => isoLocal())
  const [grupo, setGrupo] = useState('')
  const [minAmostra, setMinAmostra] = useState(20)
  const [aba, setAba] = useState<Recorte>('modelo')
  const [tipo, setTipo] = useState('')
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [r, setR] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('revisita_por_causa', {
      p_de: de, p_ate: ate, p_grupo: grupo || null, p_min_amostra: minAmostra,
    }).then(({ data, error }) => {
      if (!vivo) return
      setCarregando(false)
      if (error) { setErro(error.message); setR(null); return }
      setR(data as Resposta)
    })
    return () => { vivo = false }
  }, [de, ate, grupo, minAmostra])

  // Trocar de aba ou de filtro desfaz a linha escolhida.
  useEffect(() => { setEscolhida(null) }, [aba, tipo, de, ate, grupo, minAmostra])

  const preset = (n: number) => { setDe(menosDias(n)); setAte(isoLocal()) }
  const presetAtivo = (n: number) => de === menosDias(n) && ate === isoLocal()

  const linhas = useMemo(() => (r?.linhas ?? []).filter(l =>
    l.recorte === aba && (aba !== 'modelo' || !tipo || l.detalhe === tipo)), [r, aba, tipo])
  const tipos = useMemo(() => Array.from(new Set((r?.linhas ?? [])
    .filter(l => l.recorte === 'modelo' && l.detalhe).map(l => l.detalhe))).sort(), [r])

  // O rótulo da barra tem de ser único ("modelo não informado" repete por tipo).
  const rotuloDe = (l: Linha) => {
    if (aba === 'modelo') return l.detalhe ? `${l.rotulo} · ${l.detalhe}` : l.rotulo
    if (aba === 'area' && l.detalhe && l.detalhe !== l.rotulo) return `${l.rotulo} · ${l.detalhe}`
    return l.rotulo
  }
  const ranqueadas = linhas.filter(l => !l.amostra_pequena)
  const pequenas = linhas.filter(l => l.amostra_pequena)
  const porRotulo = new Map(linhas.map(l => [rotuloDe(l), l]))
  const linhaEscolhida = escolhida ? linhas.find(l => l.chave === escolhida) ?? null : null

  const contratos = useMemo(() => {
    const todos = r?.contratos ?? []
    if (!linhaEscolhida) return todos
    const k = linhaEscolhida.chave
    return todos.filter(c =>
      aba === 'modelo' ? (c.modelos ?? []).includes(k)
      : aba === 'tecnico' ? c.tecnico === k
      : aba === 'area' ? c.area === k
      : c.bairro === k)
  }, [r, linhaEscolhida, aba])

  const geral = r?.geral
  const cob = r?.cobertura
  const janelaAberta = r ? ate > r.completo_ate : false

  const tabela = (
    <TabelaSimples colunas={[ABAS.find(a => a[0] === aba)![1], 'Serviços', 'Revisitas', 'Taxa', '× geral']}
      linhas={linhas.map(l => [
        `${rotuloDe(l)}${l.amostra_pequena ? ' (amostra pequena)' : ''}`,
        l.servicos, l.revisitas, pctBR(l.taxa), vezesBR(l.vezes),
      ])} />
  )

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Revisita por causa</h1>
            {r && (
              <p className="mt-0.5 text-sm text-graf-400">
                {dataBR(r.de)} a {dataBR(r.ate)} · retorno em até 30 dias
              </p>
            )}
          </div>
          <div className="flex rounded-md border border-graf-700 p-0.5">
            {[30, 60, 90].map(n => (
              <button key={n} onClick={() => preset(n)} aria-pressed={presetAtivo(n)}
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  presetAtivo(n) ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                {n} dias
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={de} max={ate} onChange={e => e.target.value && setDe(e.target.value)}
              aria-label="Data inicial" className={`tabular ${sel}`} />
            <span className="text-graf-400">até</span>
            <input type="date" value={ate} min={de} onChange={e => e.target.value && setAte(e.target.value)}
              aria-label="Data final" className={`tabular ${sel}`} />
          </div>
          <select value={grupo} onChange={e => setGrupo(e.target.value)} aria-label="Serviço anterior" className={sel}>
            <option value="">Todo serviço anterior</option>
            {(r?.grupos ?? []).filter(g => g.grupo).map(g => (
              <option key={g.grupo!} value={g.grupo!}>{g.grupo} ({g.servicos})</option>
            ))}
            {grupo && !(r?.grupos ?? []).some(g => g.grupo === grupo) && <option value={grupo}>{grupo}</option>}
          </select>
          <select value={minAmostra} onChange={e => setMinAmostra(Number(e.target.value))}
            aria-label="Amostra mínima" title="Abaixo disso a linha não entra no ranking" className={sel}>
            {[10, 20, 30, 50].map(n => <option key={n} value={n}>mín. {n} serviços</option>)}
          </select>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {janelaAberta && r && (
          <Alerta tipo="aviso">
            Serviços depois de {dataBR(r.completo_ate)} ainda não fecharam os 30 dias: a taxa pode subir.
          </Alerta>
        )}

        {carregando && !r && <p className="py-10 text-center text-sm text-graf-400">Carregando…</p>}

        {r && geral && cob && (<>
          <div className={`grid grid-cols-2 gap-3 sm:grid-cols-4 ${carregando ? 'opacity-60' : ''}`}>
            <Metrica valor={geral.servicos} rotulo="Serviços concluídos" />
            <Metrica valor={geral.revisitas} rotulo="Voltaram em revisita" />
            {/* Sem serviço no período não há taxa: "—", não 0% (regra 6). */}
            <Metrica valor={pctBR(geral.taxa)} rotulo="Taxa de revisita" />
            <Metrica
              valor={cob.servicos ? pctBR(Math.round((1000 * cob.com_modelo) / cob.servicos) / 10) : '—'}
              rotulo={`Com modelo · ${cob.com_modelo} de ${cob.servicos}`} />
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-graf-800">
            <div className="flex gap-1">
              {ABAS.map(([k, rot]) => (
                <button key={k} onClick={() => setAba(k)} aria-pressed={aba === k}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${aba === k
                    ? 'border-af-500 font-medium text-graf-100'
                    : 'border-transparent text-graf-400 hover:text-graf-200'}`}>
                  {rot}
                </button>
              ))}
            </div>
            {aba === 'modelo' && tipos.length > 0 && (
              <select value={tipo} onChange={e => setTipo(e.target.value)} aria-label="Tipo de equipamento"
                className="mb-1 ml-auto rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs text-graf-100">
                <option value="">Todos os tipos</option>
                {tipos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Painel
              titulo={`Taxa de revisita por ${ABAS.find(a => a[0] === aba)![1].toLowerCase()}`}
              dica={`Geral ${pctBR(geral.taxa)} · ${ranqueadas.length} com ${r.min_amostra}+ serviços`}
              tabela={tabela}>
              <BarrasHorizontais rotuloLargo
                selecionado={linhaEscolhida ? rotuloDe(linhaEscolhida) : null}
                aoClicar={rot => {
                  const l = porRotulo.get(rot)
                  if (l) setEscolhida(c => (c === l.chave ? null : l.chave))
                }}
                dados={ranqueadas.map(l => ({
                  rotulo: rotuloDe(l),
                  valor: l.taxa,
                  texto: pctBR(l.taxa),
                  nota: `${l.revisitas} de ${l.servicos}`,
                  cor: SEM_LEITURA.has(l.rotulo) ? 'var(--color-graf-600)'
                    : geral.taxa != null && l.taxa > geral.taxa ? 'var(--color-af-600)'
                    : 'var(--color-graf-500)',
                }))} />
              {pequenas.length > 0 && (
                <details className="mt-3 border-t border-graf-800 pt-2.5">
                  <summary className="cursor-pointer text-xs text-graf-400 hover:text-graf-200">
                    Amostra pequena · {pequenas.length} fora do ranking
                  </summary>
                  <ul className="mt-2 max-h-56 divide-y divide-graf-800 overflow-y-auto text-xs">
                    {pequenas.map(l => (
                      <li key={l.chave}>
                        <button type="button" onClick={() => setEscolhida(c => (c === l.chave ? null : l.chave))}
                          aria-pressed={escolhida === l.chave}
                          className={`flex w-full items-center gap-2 px-1 py-1.5 text-left hover:bg-graf-900 ${
                            escolhida === l.chave ? 'bg-graf-900 ring-1 ring-graf-700' : ''}`}>
                          <span className="min-w-0 flex-1 truncate text-graf-300" title={rotuloDe(l)}>{rotuloDe(l)}</span>
                          <span className="tabular text-graf-400">{l.revisitas} de {l.servicos}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Painel>

            <Painel
              titulo={linhaEscolhida ? `Revisitas · ${rotuloDe(linhaEscolhida)}` : 'Revisitas do período'}
              dica={linhaEscolhida
                ? `${linhaEscolhida.revisitas} de ${linhaEscolhida.servicos} serviços voltaram`
                : `${contratos.length} retorno(s)`}
              extra={linhaEscolhida && (
                <button onClick={() => setEscolhida(null)}
                  className="text-xs text-graf-400 underline-offset-2 hover:text-af-400 hover:underline">
                  Todas
                </button>
              )}>
              {contratos.length === 0
                ? <p className="py-6 text-center text-sm text-graf-400">Nenhuma revisita.</p>
                : <ul className="max-h-[28rem] divide-y divide-graf-800 overflow-y-auto text-sm">
                    {contratos.map(c => (
                      <li key={c.visita_id} className="flex items-center gap-2 py-1.5">
                        <LinkContrato to={`/controle/visita/${c.visita_id}`}
                          className="tabular w-20 shrink-0 hover:underline" title="Abrir a revisita">
                          {c.contrato}
                        </LinkContrato>
                        <span className="min-w-0 flex-1 truncate text-xs text-graf-300"
                          title={`${c.anterior_grupo ?? 'sem grupo'} em ${dataBR(c.anterior_data)} por ${c.tecnico_nome ?? 'sem técnico'} → ${c.grupo ?? 'sem grupo'} em ${dataBR(c.data)}`}>
                          <LinkContrato to={`/controle/visita/${c.anterior_id}`} className="hover:underline"
                            title="Abrir o serviço anterior">
                            {diaMes(c.anterior_data)} {c.anterior_grupo ?? 'sem grupo'}
                          </LinkContrato>
                          {' → '}{diaMes(c.data)} {c.grupo ?? 'sem grupo'} · {c.tecnico_nome ?? 'sem técnico'}
                        </span>
                        <span className="tabular w-10 shrink-0 text-right text-xs text-graf-400">{c.dias} d</span>
                      </li>
                    ))}
                  </ul>}
            </Painel>
          </div>
        </>)}
      </div>
    </Shell>
  )
}
