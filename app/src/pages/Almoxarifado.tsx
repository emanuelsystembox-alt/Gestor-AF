import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { lerCargaEstoque, type LeituraEstoque } from '../lib/estoque'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

/**
 * Almoxarifado — a posição da carga (fase 1 do módulo).
 *
 * ┌─ DIREÇÃO: a mesa do almoxarife, não um dashboard ────────────────┐
 * │ > "imagina você ser o chefe do almoxarifado e precisa controlar   │
 * │ >  miscelâneas e equipamentos" — Emanuel                          │
 * │                                                                   │
 * │ O painel do concorrente é uma parede de 12 cartões coloridos e um │
 * │ donut de 12 fatias — com 68% numa fatia e sete fatias abaixo de   │
 * │ 1%. Um donut com doze fatias não é um gráfico, é uma legenda      │
 * │ redonda: para saber qualquer número, você lê a legenda.           │
 * │                                                                   │
 * │ Aqui a proporção vira BARRA HORIZONTAL ordenada, que é a forma    │
 * │ que responde "quanto de cada" sem legenda e sem cor obrigatória — │
 * │ o rótulo fica na barra e o número ao lado. A cor entra só onde    │
 * │ significa alguma coisa.                                           │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ DOIS EIXOS, e é o produto desta tela ───────────────────────────┐
 * │ O que a CLARO diz (`estado_atlas`) e onde a peça está para nós    │
 * │ (`posse`). Hoje 15.603 peças têm estado e NENHUMA tem posse: a    │
 * │ importação não inventa (D-152). A tela diz isso na cara, porque é │
 * │ exatamente o trabalho que falta fazer.                            │
 * └───────────────────────────────────────────────────────────────────┘
 */

interface Posicao {
  total: number
  sem_posse: number
  por_estado: { estado: string; qtd: number }[]
  por_tipo: { tipo: string; qtd: number }[]
  por_posse: { posse: string | null; qtd: number }[]
  por_modelo: { modelo: string; tipo: string; qtd: number }[]
  ultima_importacao: {
    em: string; arquivo: string | null; linhas: number
    criados: number; atualizados: number
  } | null
}

interface Posse { codigo: string; rotulo: string; cor: string | null; ordem: number }

interface Equipamento {
  id: string; serial: string; enderecavel: string | null
  tipo: string | null; modelo: string | null
  estado_atlas: string | null; posse: string | null
  local_atlas: string | null; atlas_em: string | null
}

const POR_PAGINA = 50

const n = (v: number) => v.toLocaleString('pt-BR')

/**
 * A cor do estado do Atlas.
 *
 * NÃO é uma escala de "bom para ruim" inventada por mim: é o que a
 * própria CLARO já separa. INICIALIZADO é a peça utilizável; PERDA,
 * SUCATA, INUTILIZADO e COM DEFEITO são baixa de patrimônio; o resto
 * está em processo. Quem não estiver na lista sai em cinza — estado
 * novo aparece, não vira palpite.
 */
const COR_ESTADO: Record<string, string> = {
  'INICIALIZADO': 'var(--st-concluida)',
  'PERDA': 'var(--st-conflito)',
  'SUCATA': 'var(--st-conflito)',
  'INUTILIZADO': 'var(--st-conflito)',
  'COM DEFEITO': 'var(--st-impedimento)',
  'SUSPEITO': 'var(--st-reagendamento)',
  'ANALISE DE INVENTARIO': 'var(--st-reagendamento)',
  'TRANSITO REVERSA': 'var(--st-deslocamento)',
  'GARE': 'var(--st-atribuida)',
}

/** Uma barra horizontal com o rótulo dentro e o número fora. */
function Barra({ rotulo, qtd, total, cor, nota }: {
  rotulo: string; qtd: number; total: number; cor?: string; nota?: string
}) {
  const pct = total > 0 ? (100 * qtd) / total : 0
  return (
    <li className="py-1">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-graf-200" title={rotulo}>
          {rotulo}
          {nota && <span className="ml-1.5 text-[10px] text-graf-400">{nota}</span>}
        </span>
        <span className="tabular text-xs font-semibold text-graf-100">{n(qtd)}</span>
        <span className="tabular w-11 text-right text-[10px] text-graf-400">
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-graf-800">
        <div className="h-full rounded-sm"
          style={{ width: `${Math.max(pct, 0.4)}%`,
                   background: cor ?? 'var(--color-graf-500)' }} />
      </div>
    </li>
  )
}

export default function Almoxarifado() {
  const { pode } = useAuth()
  const [posicao, setPosicao] = useState<Posicao | null>(null)
  const [posses, setPosses] = useState<Posse[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // ---- importação ----
  const arquivo = useRef<HTMLInputElement>(null)
  const [previa, setPrevia] = useState<
    (LeituraEstoque & { nome: string }) | null>(null)
  const [subindo, setSubindo] = useState(false)
  const [progresso, setProgresso] = useState(0)

  // ---- lista ----
  const [busca, setBusca] = useState('')
  const [fEstado, setFEstado] = useState('TODOS')
  const [fTipo, setFTipo] = useState('TODOS')
  const [fPosse, setFPosse] = useState('TODAS')
  const [lista, setLista] = useState<Equipamento[]>([])
  const [totalLista, setTotalLista] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [carregandoLista, setCarregandoLista] = useState(false)

  const recarregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const [p, ps] = await Promise.all([
      supabase.rpc('estoque_posicao'),
      supabase.from('estoque_posse').select('codigo, rotulo, cor, ordem').order('ordem'),
    ])
    if (p.error) setErro(p.error.message)
    else setPosicao(p.data as unknown as Posicao)
    setPosses((ps.data ?? []) as Posse[])
    setCarregando(false)
  }, [])

  useEffect(() => { recarregar() }, [recarregar])

  // A lista pagina NO BANCO: 15.603 seriais não descem para o navegador
  // para virar 50 linhas na tela. (O contrário da tela de Serviços, e a
  // diferença é o volume: lá são centenas, aqui são dezenas de milhares.)
  useEffect(() => {
    let vivo = true
    setCarregandoLista(true)
    let q = supabase.from('equipamento')
      .select('id, serial, enderecavel, tipo, modelo, estado_atlas, posse, ' +
              'local_atlas, atlas_em', { count: 'exact' })
    const t = busca.trim().toUpperCase().replace(/\s+/g, '')
    if (t) q = q.like('serial', `${t}%`)
    if (fEstado !== 'TODOS') q = q.eq('estado_atlas', fEstado)
    if (fTipo !== 'TODOS') q = q.eq('tipo', fTipo)
    if (fPosse === 'SEM') q = q.is('posse', null)
    else if (fPosse !== 'TODAS') q = q.eq('posse', fPosse)

    q.order('serial').range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1)
      .then(({ data, count, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        setLista((data ?? []) as unknown as Equipamento[])
        setTotalLista(count ?? 0)
        setCarregandoLista(false)
      })
    return () => { vivo = false }
  }, [busca, fEstado, fTipo, fPosse, pagina, posicao])

  useEffect(() => { setPagina(1) }, [busca, fEstado, fTipo, fPosse])

  const paginas = Math.max(1, Math.ceil(totalLista / POR_PAGINA))
  const rotuloPosse = useMemo(() => {
    const m = new Map(posses.map(p => [p.codigo, p.rotulo]))
    return (c: string | null) => (c ? m.get(c) ?? c : 'não sabemos')
  }, [posses])

  async function escolher(f: File | undefined) {
    if (!f) return
    setErro(null); setOk(null); setPrevia(null)
    try {
      const l = await lerCargaEstoque(f)
      setPrevia({ ...l, nome: f.name })
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * Sobe em lotes.
   *
   * 15.603 linhas num `jsonb` só é ~8 MB de corpo e um `statement
   * timeout` esperando acontecer. Em lotes de 500 cada chamada é curta,
   * a barra anda, e uma falha no meio não perde o que já entrou — a
   * importação é idempotente pelo serial.
   */
  async function subir() {
    if (!previa) return
    setSubindo(true); setErro(null); setOk(null); setProgresso(0)
    const LOTE = 500
    let criados = 0, atualizados = 0, ignorados = 0
    try {
      for (let i = 0; i < previa.linhas.length; i += LOTE) {
        const pedaco = previa.linhas.slice(i, i + LOTE)
        const { data, error } = await supabase.rpc('importar_estoque', {
          p_arquivo: previa.nome, p_formato: previa.formato, p_linhas: pedaco,
        })
        if (error) throw new Error(error.message)
        const r = data as { criados: number; atualizados: number; ignorados: number }
        criados += r.criados; atualizados += r.atualizados; ignorados += r.ignorados
        setProgresso(Math.min(100, Math.round((100 * (i + LOTE)) / previa.linhas.length)))
      }
      setOk(`${n(criados)} peça(s) nova(s), ${n(atualizados)} atualizada(s)`
            + (ignorados ? `, ${n(ignorados)} sem série utilizável` : '') + '.')
      setPrevia(null)
      if (arquivo.current) arquivo.current.value = ''
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error
        ? (/permiss/i.test(e.message)
            ? 'Seu perfil não inclui "Importar a carga". A barreira é do banco.'
            : e.message)
        : String(e))
    }
    setSubindo(false)
  }

  const podeImportar = pode('almoxarifado.importar')
  const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
                'outline-none focus:border-af-500'

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Almoxarifado</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            A carga serializada, como o <strong>Atlas</strong> a enxerga e como{' '}
            <strong>nós</strong> a enxergamos. Os dois nem sempre concordam — e é
            justamente onde eles divergem que mora o trabalho.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        {/* ====== importar ====== */}
        {podeImportar && (
          <section className="card-controle p-4">
            <h2 className="text-sm font-semibold">Importar a carga do Atlas</h2>
            <p className="mt-1 max-w-3xl text-xs text-graf-400">
              Aceita os dois relatórios: a <strong>carga</strong> da empreiteira e a{' '}
              <strong>consulta</strong> de posição. O formato é descoberto pelo
              cabeçalho. Reimportar não duplica — o número de série é a chave.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input ref={arquivo} type="file" accept=".xlsx,.xls"
                aria-label="Planilha do Atlas"
                onChange={e => escolher(e.target.files?.[0])}
                className="text-xs text-graf-300 file:mr-3 file:rounded-md
                           file:border file:border-graf-700 file:bg-graf-900
                           file:px-3 file:py-1.5 file:text-xs file:text-graf-200
                           hover:file:border-af-600" />
            </div>

            {previa && (
              <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900 p-3">
                <p className="text-xs text-graf-200">
                  <strong>{previa.nome}</strong> · formato{' '}
                  <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[10px]
                                   font-semibold uppercase tracking-wide">
                    {previa.formato === 'CARGA' ? 'carga' : 'consulta'}
                  </span>
                  {' · '}<span className="tabular">{n(previa.linhas.length)}</span> peça(s)
                </p>
                {/* Zero e desconhecido não são a mesma coisa: o que não
                    entrou sai escrito, com o motivo. */}
                {(previa.semSerial > 0 || previa.dataAmbigua > 0) && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-amber-300">
                    {previa.semSerial > 0 && (
                      <li>{n(previa.semSerial)} linha(s) sem número de série — ficam de fora.</li>
                    )}
                    {previa.dataAmbigua > 0 && (
                      <li>
                        {n(previa.dataAmbigua)} data(s) em formato ambíguo (ex. 9/12/26,
                        que tanto pode ser 9 de dezembro quanto 12 de setembro) — a peça
                        entra, a data fica <strong>vazia</strong>, e o texto original
                        continua guardado.
                      </li>
                    )}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={subir} disabled={subindo}
                    className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium
                               text-white hover:bg-af-500 disabled:opacity-50">
                    {subindo ? `Subindo… ${progresso}%` : 'Importar'}
                  </button>
                  <button onClick={() => { setPrevia(null)
                                           if (arquivo.current) arquivo.current.value = '' }}
                    disabled={subindo}
                    className="rounded-md border border-graf-700 px-3 py-1.5 text-xs
                               text-graf-300 hover:border-graf-600">
                    Cancelar
                  </button>
                  {subindo && (
                    <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-graf-800">
                      <div className="h-full bg-af-500 transition-[width]"
                        style={{ width: `${progresso}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {carregando ? (
          <p className="py-16 text-center text-graf-400" role="status">
            Carregando a posição…
          </p>
        ) : !posicao || posicao.total === 0 ? (
          <Vazio titulo="Nenhuma peça no estoque ainda"
            descricao={podeImportar
              ? 'Importe o relatório de carga do Atlas acima para o almoxarifado começar a existir.'
              : 'Ninguém importou a carga do Atlas ainda. Quem tem a permissão "Importar a carga" faz isso.'} />
        ) : (<>

          {/* ====== os números ====== */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card-controle p-3">
              <div className="tabular text-2xl font-semibold leading-none">
                {n(posicao.total)}
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">
                peças na carga
              </div>
            </div>
            {/* O número que nomeia o trabalho que falta. */}
            <div className="card-controle p-3">
              <div className={`tabular text-2xl font-semibold leading-none ${
                posicao.sem_posse > 0 ? 'text-amber-400' : ''}`}>
                {n(posicao.sem_posse)}
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">
                sem posse declarada
              </div>
              <div className="mt-0.5 text-[10px] text-graf-400">
                o Atlas não sabe onde a peça está — nós ainda também não
              </div>
            </div>
            {(() => {
              const perdidas = posicao.por_estado
                .filter(e => ['PERDA', 'SUCATA', 'INUTILIZADO'].includes(e.estado))
                .reduce((s, e) => s + e.qtd, 0)
              const uteis = posicao.por_estado
                .find(e => e.estado === 'INICIALIZADO')?.qtd ?? 0
              return (<>
                <div className="card-controle p-3">
                  <div className="tabular text-2xl font-semibold leading-none
                                  text-emerald-400">{n(uteis)}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">
                    inicializadas
                  </div>
                  <div className="mt-0.5 text-[10px] text-graf-400">
                    o que a CLARO considera utilizável
                  </div>
                </div>
                <div className="card-controle p-3">
                  <div className="tabular text-2xl font-semibold leading-none text-af-400">
                    {n(perdidas)}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">
                    perda, sucata ou inutilizado
                  </div>
                  <div className="mt-0.5 text-[10px] text-graf-400">
                    {posicao.total > 0
                      ? `${((100 * perdidas) / posicao.total).toFixed(1)}% da carga`
                      : '—'}
                  </div>
                </div>
              </>)
            })()}
          </div>

          {/* ====== as três leituras ====== */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold">O que a CLARO diz</h2>
                <p className="mt-0.5 text-[11px] text-graf-400">
                  estado no Atlas · não se edita aqui
                </p>
              </div>
              <ul className="px-4 py-2">
                {posicao.por_estado.map(e => (
                  <Barra key={e.estado} rotulo={e.estado} qtd={e.qtd}
                    total={posicao.total} cor={COR_ESTADO[e.estado]} />
                ))}
              </ul>
            </section>

            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold">Onde está, para nós</h2>
                <p className="mt-0.5 text-[11px] text-graf-400">
                  posse declarada pelo almoxarifado
                </p>
              </div>
              <ul className="px-4 py-2">
                {posicao.por_posse.map(p => (
                  <Barra key={p.posse ?? 'nulo'}
                    rotulo={p.posse ? rotuloPosse(p.posse) : 'Não sabemos onde está'}
                    nota={p.posse ? undefined : '— ninguém declarou ainda'}
                    qtd={p.qtd} total={posicao.total}
                    cor={p.posse
                      ? posses.find(x => x.codigo === p.posse)?.cor ?? undefined
                      : 'var(--st-reagendamento)'} />
                ))}
              </ul>
              <p className="border-t border-graf-800 px-4 py-2 text-[11px] text-graf-400">
                Declarar a posse peça a peça é a <strong>fase 2</strong> — entrega e
                devolutiva ao técnico por romaneio.
              </p>
            </section>

            <section className="card-controle overflow-hidden">
              <div className="border-b border-graf-800 px-4 py-2.5">
                <h2 className="text-sm font-semibold">Por tipo</h2>
                <p className="mt-0.5 text-[11px] text-graf-400">
                  o que existe na carga
                </p>
              </div>
              <ul className="px-4 py-2">
                {posicao.por_tipo.map(t => (
                  <Barra key={t.tipo} rotulo={t.tipo} qtd={t.qtd} total={posicao.total} />
                ))}
              </ul>
            </section>
          </div>

          {/* ====== a lista ====== */}
          <section className="card-controle overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-graf-800
                            px-4 py-2.5">
              <h2 className="mr-2 text-sm font-semibold">Peça a peça</h2>
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Número de série (começo)…"
                aria-label="Buscar por número de série"
                className={`${campo} min-w-52 flex-1`} />
              <select value={fEstado} onChange={e => setFEstado(e.target.value)}
                aria-label="Filtrar por estado no Atlas" className={campo}>
                <option value="TODOS">Todo estado</option>
                {posicao.por_estado.map(e => (
                  <option key={e.estado} value={e.estado}>{e.estado}</option>
                ))}
              </select>
              <select value={fTipo} onChange={e => setFTipo(e.target.value)}
                aria-label="Filtrar por tipo" className={campo}>
                <option value="TODOS">Todo tipo</option>
                {posicao.por_tipo.map(t => (
                  <option key={t.tipo} value={t.tipo}>{t.tipo}</option>
                ))}
              </select>
              <select value={fPosse} onChange={e => setFPosse(e.target.value)}
                aria-label="Filtrar por posse" className={campo}>
                <option value="TODAS">Toda posse</option>
                <option value="SEM">Sem posse declarada</option>
                {posses.map(p => (
                  <option key={p.codigo} value={p.codigo}>{p.rotulo}</option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-700 bg-graf-900 text-left
                                  text-[10px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Série</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Modelo</th>
                    <th className="px-3 py-2 font-medium">Estado (Atlas)</th>
                    <th className="px-3 py-2 font-medium">Posse (nossa)</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(e => (
                    <tr key={e.id} className="border-b border-graf-800">
                      <td className="tabular px-3 py-1.5 text-xs font-medium text-graf-100">
                        {e.serial}
                        {e.enderecavel && (
                          <span className="ml-1.5 text-[10px] text-graf-400">
                            {e.enderecavel}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-graf-300">{e.tipo ?? '—'}</td>
                      <td className="max-w-64 truncate px-3 py-1.5 text-xs text-graf-400"
                        title={e.modelo ?? undefined}>
                        {e.modelo ?? '—'}
                      </td>
                      <td className="px-3 py-1.5">
                        {e.estado_atlas ? (
                          <span className="pill text-[10px]"
                            style={{ ['--pill-cor' as string]:
                              COR_ESTADO[e.estado_atlas] ?? 'var(--color-graf-500)' }}>
                            {e.estado_atlas}
                          </span>
                        ) : <span className="text-xs text-graf-400">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {e.posse ? (
                          <span className="text-graf-200">{rotuloPosse(e.posse)}</span>
                        ) : (
                          <span className="text-amber-400" title="Ninguém declarou onde esta peça está">
                            não sabemos
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!carregandoLista && lista.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-xs text-graf-400">
                        Nenhuma peça com esses filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalLista > POR_PAGINA && (
              <nav aria-label="Páginas do estoque"
                className="flex flex-wrap items-center gap-3 border-t border-graf-800
                           px-4 py-2.5 text-xs">
                <span className="tabular text-graf-400">
                  {n((pagina - 1) * POR_PAGINA + 1)}–
                  {n(Math.min(pagina * POR_PAGINA, totalLista))} de {n(totalLista)}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => setPagina(p => Math.max(1, p - 1))}
                    disabled={pagina === 1} aria-label="Página anterior"
                    className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                               hover:border-af-600 hover:text-af-400 disabled:opacity-35">
                    ‹ anterior
                  </button>
                  <span className="tabular px-1 text-graf-200" aria-current="page">
                    {pagina} / {n(paginas)}
                  </span>
                  <button onClick={() => setPagina(p => Math.min(paginas, p + 1))}
                    disabled={pagina >= paginas} aria-label="Próxima página"
                    className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300
                               hover:border-af-600 hover:text-af-400 disabled:opacity-35">
                    próxima ›
                  </button>
                </span>
              </nav>
            )}
          </section>

          {posicao.ultima_importacao && (
            <p className="pb-6 text-center text-[11px] text-graf-400">
              última carga: {new Date(posicao.ultima_importacao.em).toLocaleString('pt-BR')}
              {posicao.ultima_importacao.arquivo && ` · ${posicao.ultima_importacao.arquivo}`}
              {' · '}{n(posicao.ultima_importacao.criados)} nova(s),{' '}
              {n(posicao.ultima_importacao.atualizados)} atualizada(s)
            </p>
          )}
        </>)}
      </div>
    </Shell>
  )
}
