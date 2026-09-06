import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { lerPlanilha, type Leitura } from '../lib/planilha'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

/**
 * Importação das sub-falhas da CLARO (D-027).
 *
 * A sub-falha é o segundo nível da causa: o código de baixa diz O QUÊ
 * ("107 - Entrada Não Autorizada"), a sub-falha diz POR QUÊ
 * ("RESTRIÇÃO HORÁRIO CONDOMÍNIO").
 *
 * ┌─ D-032 ─────────────────────────────────────────────────────────┐
 * │ O arquivo da CLARO é LARGO, não longo:                          │
 * │                                                                  │
 * │   Categoria | Código | Descrição | Subfalha 1 | … | Subfalha 7   │
 * │   IMPRODUTIVOS | 100 | Agendamento Não Cumprido | Atraso… | …    │
 * │                                                                  │
 * │ Uma linha por CÓDIGO, com as sub-falhas espalhadas em colunas.   │
 * │ Ler "uma linha = um par" traria 147 pares em vez de 938 — e a    │
 * │ conta fecharia sozinha, sem erro nenhum na tela.                 │
 * │                                                                  │
 * │ `Descrição` é a descrição do CÓDIGO, não da sub-falha. Ela não   │
 * │ é importada (já vive em codigo_baixa); aparece na prévia só      │
 * │ para quem confere não se enganar.                                │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * O arquivo traz DOIS conjuntos — `CASO 1` e `NÍVEL HARD`, um por aba.
 * Esta tela não escolhe por ninguém: importa os dois, mostra o que cada
 * um cobre, e deixa a escolha do vigente com quem responde pela operação.
 *
 * O mapeamento de colunas é manual de propósito. O arquivo é da CLARO;
 * o cabeçalho muda sem aviso, e adivinhar em silêncio é como se perde
 * uma coluna sem ninguém notar (mesmo risco do D-013, no leitor do TOA).
 */

interface Resumo {
  conjunto: string
  sub_falhas: number
  codigos_de_baixa: number
  categorias: number
  sem_codigo_de_baixa: number
}

type Formato = 'largo' | 'longo'

interface Mapa {
  codigo: string
  categoria: string
  descricao: string
  /** só no formato longo */
  nome: string
  /** só no formato longo */
  ordem: string
}
interface Par {
  codigo: number | null
  nome: string
  categoria: string | null
  ordem: number
  descricao: string
}

const VAZIO: Mapa = { codigo: '', categoria: '', descricao: '', nome: '', ordem: '' }

/** Sem acento, maiúsculo, espaços colapsados. Só para comparar cabeçalho. */
function chave(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim()
}

/** Colunas do tipo "Subfalha 1", "SUBFALHA 2"… na ordem em que aparecem. */
function colunasDeSubfalha(cabecalhos: string[]): string[] {
  return cabecalhos.filter(h => /^SUB ?FALHA ?\d+$/.test(chave(h)))
}

/** Palpite de mapeamento. É sugestão — a tela mostra e deixa corrigir. */
function adivinhar(cabecalhos: string[]): Mapa {
  const achar = (...testes: ((k: string) => boolean)[]) => {
    for (const teste of testes) {
      const c = cabecalhos.find(h => teste(chave(h)))
      if (c) return c
    }
    return ''
  }
  const subs = colunasDeSubfalha(cabecalhos)
  return {
    codigo: achar(k => k === 'CODIGO' || k === 'COD', k => k.includes('COD')),
    categoria: achar(k => k.includes('CATEGORIA'), k => k.includes('GRUPO')),
    descricao: achar(k => k.includes('DESCRI')),
    // No formato longo a sub-falha é uma coluna só; não confundir com as
    // colunas numeradas do formato largo.
    nome: subs.length >= 2
      ? ''
      : achar(k => k.includes('SUBFALHA') || k.includes('SUB FALHA'),
              k => k.includes('FALHA'), k => k.includes('NOME')),
    ordem: achar(k => k === 'ORDEM' || k.startsWith('SEQ')),
  }
}

/** Converte a planilha para o formato que `importar_sub_falhas` espera. */
function normalizar(
  linhas: Record<string, string>[],
  m: Mapa,
  formato: Formato,
  subs: string[],
): Par[] {
  const saida: Par[] = []
  const contador = new Map<number, number>()

  for (const l of linhas) {
    const bruto = m.codigo ? (l[m.codigo] ?? '') : ''
    const achado = bruto.match(/\d+/)
    const codigo = achado ? parseInt(achado[0], 10) : null
    const categoria = m.categoria ? (l[m.categoria] ?? '').trim() || null : null
    const descricao = m.descricao ? (l[m.descricao] ?? '').trim() : ''

    if (formato === 'largo') {
      // Uma linha vira até N pares — a posição da coluna vira a ordem.
      subs.forEach((col, i) => {
        const nome = (l[col] ?? '').trim()
        if (nome) saida.push({ codigo, nome, categoria, ordem: i + 1, descricao })
      })
      continue
    }

    const nome = (m.nome ? (l[m.nome] ?? '') : '').trim()
    let ordem: number
    if (m.ordem) {
      ordem = parseInt((l[m.ordem] ?? '').replace(/\D/g, ''), 10) || 0
    } else if (codigo !== null) {
      // Sem coluna de ordem, preserva a ordem do arquivo dentro do código.
      const n = (contador.get(codigo) ?? 0) + 1
      contador.set(codigo, n)
      ordem = n
    } else ordem = 0
    saida.push({ codigo, nome, categoria, ordem, descricao })
  }
  return saida
}

export default function SubFalhas() {
  const inputRef = useRef<HTMLInputElement>(null)

  const [resumo, setResumo] = useState<Resumo[]>([])
  const [vigente, setVigente] = useState<string | null>(null)
  const [codigosBaixa, setCodigosBaixa] = useState<Set<number>>(new Set())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [progresso, setProgresso] = useState('')

  // leitura do arquivo
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [leitura, setLeitura] = useState<Leitura | null>(null)
  const [aba, setAba] = useState('')
  const [conjunto, setConjunto] = useState('')
  const [formato, setFormato] = useState<Formato>('largo')
  const [mapa, setMapa] = useState<Mapa>(VAZIO)
  const [subs, setSubs] = useState<string[]>([])
  const [arrastando, setArrastando] = useState(false)

  async function recarregar() {
    setCarregando(true); setErro(null)
    const [r, e, c] = await Promise.all([
      supabase.rpc('resumo_sub_falhas'),
      supabase.from('empresa').select('conjunto_sub_falha').maybeSingle(),
      supabase.from('codigo_baixa').select('codigo'),
    ])
    if (r.error) setErro(r.error.message)
    else setResumo((r.data ?? []) as Resumo[])
    setVigente((e.data as { conjunto_sub_falha: string | null } | null)?.conjunto_sub_falha ?? null)
    setCodigosBaixa(new Set(((c.data ?? []) as { codigo: number }[]).map(x => x.codigo)))
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [])

  async function receber(f: File, qualAba?: string) {
    setErro(null); setOk(null)
    try {
      const r = await lerPlanilha(f, qualAba)
      const usada = qualAba && r.abas.includes(qualAba) ? qualAba : r.abas[0]
      const colunas = colunasDeSubfalha(r.cabecalhos)
      setArquivo(f); setLeitura(r); setAba(usada)
      setSubs(colunas)
      setFormato(colunas.length >= 2 ? 'largo' : 'longo')
      setMapa(adivinhar(r.cabecalhos))
      setConjunto(usada.toUpperCase())
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui ler a planilha.')
    }
  }

  const pares = useMemo(
    () => (leitura ? normalizar(leitura.linhas, mapa, formato, subs) : []),
    [leitura, mapa, formato, subs],
  )
  const validos = useMemo(
    () => pares.filter(p => p.codigo !== null && p.nome !== ''),
    [pares],
  )
  const analise = useMemo(() => {
    const codigos = new Set(validos.map(p => p.codigo as number))
    const desconhecidos = [...codigos].filter(c => !codigosBaixa.has(c)).sort((a, b) => a - b)
    const chaves = new Set(validos.map(p => `${p.codigo}|${p.nome.toUpperCase()}`))
    return {
      codigos: codigos.size,
      categorias: new Set(validos.map(p => p.categoria).filter(Boolean)).size,
      repetidas: validos.length - chaves.size,
      desconhecidos,
    }
  }, [validos, codigosBaixa])

  const pronto = !!mapa.codigo && (formato === 'largo' ? subs.length > 0 : !!mapa.nome)

  async function importar() {
    if (!validos.length || !conjunto.trim()) return
    setOcupado(true); setErro(null); setOk(null)
    try {
      const LOTE = 300
      let gravadas = 0, erros = 0
      let ultimo: Record<string, unknown> = {}
      for (let i = 0; i < validos.length; i += LOTE) {
        setProgresso(`Enviando ${i + 1}–${Math.min(i + LOTE, validos.length)} de ${validos.length}…`)
        // A função só usa codigo/nome/categoria/ordem; `descricao` fica de fora.
        const fatia = validos.slice(i, i + LOTE).map(p => ({
          codigo: p.codigo, nome: p.nome, categoria: p.categoria, ordem: p.ordem,
        }))
        const { data, error } = await supabase.rpc('importar_sub_falhas', {
          p_conjunto: conjunto.trim(), p_linhas: fatia,
        })
        if (error) throw new Error(error.message)
        ultimo = (data ?? {}) as Record<string, unknown>
        gravadas += Number(ultimo.gravadas ?? 0)
        erros += Number(ultimo.erros ?? 0)
      }
      setOk(`Conjunto "${conjunto.trim()}": ${gravadas} sub-falhas gravadas` +
            (erros ? `, ${erros} recusadas pelo banco` : '') +
            `. Total no conjunto: ${ultimo.total_no_conjunto ?? '—'}.`)
      limpar()
      await recarregar()
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Falha ao importar.')
    } finally {
      setOcupado(false); setProgresso('')
    }
  }

  async function definirVigente(c: string | null) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_conjunto_sub_falha', { p_conjunto: c })
    if (error) setErro(error.message)
    else {
      setOk(c ? `Conjunto vigente agora é "${c}".` : 'Nenhum conjunto vigente.')
      await recarregar()
    }
    setOcupado(false)
  }

  function limpar() {
    setArquivo(null); setLeitura(null); setAba(''); setMapa(VAZIO); setSubs([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'
  const total = resumo.reduce((s, r) => s + Number(r.sub_falhas), 0)

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Sub-falhas</h1>
          <p className="mt-1 max-w-2xl text-sm text-graf-400">
            O código de baixa diz <em>o quê</em>; a sub-falha diz <em>por quê</em>.
            O arquivo da CLARO traz dois conjuntos — importe os dois e escolha
            qual vale para a operação. A escolha pode ser trocada depois.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        {/* ====== o que já está no banco ====== */}
        <section className="card-controle p-4">
          <h2 className="mb-3 text-sm font-semibold">Conjuntos importados</h2>

          {carregando ? (
            <p className="text-sm text-graf-400">Carregando…</p>
          ) : resumo.length === 0 ? (
            <Vazio
              titulo="Nenhuma sub-falha importada"
              descricao="Suba o CONSOLIDADO_SUBFALHAS_CLARO_2026.xlsx abaixo. Cada aba do arquivo é um conjunto."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 text-left text-xs text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Conjunto</th>
                    <th className="px-3 py-2 text-right font-medium">Pares</th>
                    <th className="px-3 py-2 text-right font-medium">Códigos</th>
                    <th className="px-3 py-2 text-right font-medium">Categorias</th>
                    <th className="px-3 py-2 text-right font-medium">Sem código de baixa</th>
                    <th className="px-3 py-2 font-medium">Vigente</th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.map(r => (
                    <tr key={r.conjunto} className="border-b border-graf-800/60">
                      <td className="px-3 py-2 font-medium">{r.conjunto}</td>
                      <td className="tabular px-3 py-2 text-right">{r.sub_falhas}</td>
                      <td className="tabular px-3 py-2 text-right">{r.codigos_de_baixa}</td>
                      <td className="tabular px-3 py-2 text-right">{r.categorias}</td>
                      <td className="tabular px-3 py-2 text-right"
                          style={r.sem_codigo_de_baixa
                            ? { color: 'var(--st-reagendamento)' } : undefined}>
                        {r.sem_codigo_de_baixa}
                      </td>
                      <td className="px-3 py-2">
                        {vigente === r.conjunto ? (
                          <span className="rounded bg-af-600/20 px-2 py-0.5 text-xs
                                           font-medium text-af-300 ring-1 ring-af-600/30">
                            em uso
                          </span>
                        ) : (
                          <button onClick={() => definirVigente(r.conjunto)} disabled={ocupado}
                            className="rounded-md border border-graf-700 px-2.5 py-1 text-xs
                                       text-graf-300 hover:border-af-600 hover:text-af-400
                                       disabled:opacity-50">
                            Usar este
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {total > 0 && !vigente && (
                <div className="mt-3">
                  <Alerta tipo="aviso">
                    Nenhum conjunto está marcado como vigente. Enquanto isso, a tela de
                    execução não tem lista de sub-falha para oferecer ao campo.
                  </Alerta>
                </div>
              )}
              {resumo.some(r => r.sem_codigo_de_baixa > 0) && (
                <p className="mt-2 text-xs text-graf-500">
                  "Sem código de baixa" são sub-falhas cujo código não existe na nossa
                  tabela de códigos. Elas ficam gravadas e passam a valer assim que o
                  código aparecer — nada se perde.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ====== importar ====== */}
        <section className="card-controle p-4">
          <h2 className="mb-3 text-sm font-semibold">Importar conjunto</h2>

          {!leitura ? (
            <div
              onDragOver={e => { e.preventDefault(); setArrastando(true) }}
              onDragLeave={() => setArrastando(false)}
              onDrop={e => {
                e.preventDefault(); setArrastando(false)
                const f = e.dataTransfer.files[0]; if (f) receber(f)
              }}
              className={`rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                arrastando ? 'border-af-500 bg-af-900/15' : 'border-graf-700 bg-graf-900'}`}
            >
              <p className="font-medium">Arraste o arquivo de sub-falhas aqui</p>
              <p className="mt-1 text-sm text-graf-400">ou</p>
              <button onClick={() => inputRef.current?.click()}
                className="mt-3 rounded-lg bg-af-600 px-5 py-2.5 text-sm font-medium
                           text-white hover:bg-af-500">
                Escolher arquivo
              </button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) receber(f) }} />
              <p className="mt-4 text-xs text-graf-500">
                Lido no seu navegador. Nada sai daqui antes de você confirmar.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{arquivo?.name}</p>
                  <p className="text-xs text-graf-400">
                    {leitura.linhas.length} linhas · {leitura.cabecalhos.length} colunas
                    {leitura.duplicados.length > 0 &&
                      ` · repetidas tratadas por posição: ${leitura.duplicados.join(', ')}`}
                  </p>
                </div>
                <button onClick={limpar} className="shrink-0 text-sm text-graf-400 hover:text-af-400">
                  Trocar
                </button>
              </div>

              {/* aba + nome do conjunto */}
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Aba da planilha</span>
                  <select value={aba} className={sel}
                    onChange={e => arquivo && receber(arquivo, e.target.value)}>
                    {leitura.abas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>

                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Nome do conjunto (é o rótulo que fica gravado)</span>
                  <input value={conjunto} onChange={e => setConjunto(e.target.value)}
                    className={`${sel} w-56`} placeholder="CASO 1" />
                </label>

                <div className="flex gap-1.5 pb-0.5">
                  {['CASO 1', 'NÍVEL HARD'].map(c => (
                    <button key={c} onClick={() => setConjunto(c)}
                      className="rounded-md border border-graf-700 px-2.5 py-1.5 text-xs
                                 text-graf-300 hover:border-af-600 hover:text-af-400">
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* formato do arquivo */}
              <div className="rounded-lg border border-graf-800 bg-graf-900/60 p-3">
                <p className="mb-2 text-xs font-medium text-graf-300">Como o arquivo está montado</p>
                <div className="flex flex-wrap gap-5 text-xs">
                  {([
                    ['largo', 'Uma linha por código, sub-falhas em colunas',
                     'Subfalha 1, Subfalha 2, … — é o formato da CLARO'],
                    ['longo', 'Uma linha por sub-falha',
                     'uma coluna só com o texto da sub-falha'],
                  ] as [Formato, string, string][]).map(([f, rot, dica]) => (
                    <label key={f} className="flex cursor-pointer items-start gap-2">
                      <input type="radio" name="formato" checked={formato === f}
                        onChange={() => setFormato(f)} className="mt-0.5 accent-af-600" />
                      <span>
                        <span className={formato === f ? 'font-medium text-graf-200' : 'text-graf-300'}>
                          {rot}
                        </span>
                        <span className="block text-graf-500">{dica}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {formato === 'largo' && subs.length > 0 && (
                  <p className="mt-2 text-[11px] text-graf-500">
                    Reconhecidas {subs.length} colunas de sub-falha: {subs.join(' · ')}
                  </p>
                )}
              </div>

              {/* mapeamento de colunas */}
              <div>
                <p className="mb-2 text-xs text-graf-400">
                  De qual coluna vem cada campo? O palpite abaixo veio do cabeçalho —
                  confira antes de importar.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ['codigo', 'Código de baixa', true, '— não usar —'],
                    ['categoria', 'Categoria', false, '— não usar —'],
                    ['descricao', 'Descrição do código (não importada)', false, '— não usar —'],
                    ...(formato === 'longo'
                      ? ([['nome', 'Sub-falha', true, '— não usar —'],
                          ['ordem', 'Ordem', false, '— pela ordem do arquivo —']] as
                         [keyof Mapa, string, boolean, string][])
                      : []),
                  ] as [keyof Mapa, string, boolean, string][]).map(([campo, rotulo, obrig, nulo]) => (
                    <label key={campo} className="text-xs text-graf-400">
                      <span className="mb-1 block">
                        {rotulo}{obrig && <span className="text-af-400"> *</span>}
                      </span>
                      <select value={mapa[campo]} className={`${sel} w-full`}
                        onChange={e => setMapa({ ...mapa, [campo]: e.target.value })}>
                        <option value="">{nulo}</option>
                        {leitura.cabecalhos.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </label>
                  ))}
                </div>

                {formato === 'largo' && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-xs text-graf-400">
                      Colunas que viram sub-falha — a posição vira a ordem.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {leitura.cabecalhos
                        .filter(h => h !== mapa.codigo && h !== mapa.categoria && h !== mapa.descricao)
                        .map(h => {
                          const dentro = subs.includes(h)
                          return (
                            <button key={h}
                              onClick={() => setSubs(dentro
                                ? subs.filter(x => x !== h)
                                : leitura.cabecalhos.filter(c => c === h || subs.includes(c)))}
                              className={`rounded-md px-2.5 py-1 text-xs ring-1 transition ${
                                dentro
                                  ? 'bg-af-600/20 text-af-300 ring-af-600/40'
                                  : 'bg-graf-900 text-graf-400 ring-graf-700 hover:text-graf-200'}`}>
                              {dentro && (
                                <span className="tabular mr-1 text-af-400">
                                  {subs.indexOf(h) + 1}
                                </span>
                              )}
                              {h}
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )}
              </div>

              {!pronto ? (
                <Alerta tipo="aviso">
                  {formato === 'largo'
                    ? <>Aponte a coluna do <strong>código de baixa</strong> e marque pelo menos
                        uma coluna de sub-falha.</>
                    : <>Aponte a coluna do <strong>código de baixa</strong> e a da{' '}
                        <strong>sub-falha</strong>. Sem as duas não existe par para gravar.</>}
                </Alerta>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {([
                      ['Pares válidos', validos.length, undefined],
                      ['Códigos', analise.codigos, undefined],
                      ['Categorias', analise.categorias, undefined],
                      ['Repetidas no arquivo', analise.repetidas,
                        analise.repetidas ? 'var(--st-reagendamento)' : undefined],
                    ] as [string, number, string | undefined][]).map(([r, v, c]) => (
                      <div key={r} className="rounded-lg bg-graf-900 px-3 py-2.5">
                        <div className="tabular text-xl font-semibold leading-none"
                             style={c ? { color: c } : undefined}>{v}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">
                          {r}
                        </div>
                      </div>
                    ))}
                  </div>

                  {analise.repetidas > 0 && (
                    <p className="text-xs text-graf-500">
                      Repetidas são o mesmo par código + sub-falha aparecendo duas vezes no
                      arquivo. Entram uma vez só — a chave no banco impede a duplicata.
                    </p>
                  )}
                  {analise.desconhecidos.length > 0 && (
                    <Alerta tipo="aviso">
                      <p className="font-medium">
                        {analise.desconhecidos.length} código(s) do arquivo não existem na nossa
                        tabela de códigos de baixa:
                      </p>
                      <p className="tabular mt-1">
                        {analise.desconhecidos.slice(0, 40).join(' · ')}
                        {analise.desconhecidos.length > 40 && ' …'}
                      </p>
                      <p className="mt-1">
                        Entram assim mesmo, sem vínculo. Não é erro — é a CLARO tendo código
                        que ainda não apareceu na nossa operação.
                      </p>
                    </Alerta>
                  )}

                  {/* prévia */}
                  <div className="overflow-x-auto rounded-lg border border-graf-800">
                    <table className="w-full text-xs">
                      <thead className="bg-graf-900 text-left text-graf-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Código</th>
                          {mapa.descricao && (
                            <th className="px-3 py-2 font-medium">Descrição do código</th>
                          )}
                          <th className="px-3 py-2 font-medium">Sub-falha</th>
                          <th className="px-3 py-2 font-medium">Categoria</th>
                          <th className="px-3 py-2 text-right font-medium">Ordem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validos.slice(0, 12).map((p, i) => (
                          <tr key={i} className="border-t border-graf-800/60">
                            <td className="tabular px-3 py-1.5">
                              {p.codigo}
                              {!codigosBaixa.has(p.codigo as number) && (
                                <span className="ml-1.5 text-[10px] text-amber-400">novo</span>
                              )}
                            </td>
                            {mapa.descricao && (
                              <td className="px-3 py-1.5 text-graf-500">{p.descricao || '—'}</td>
                            )}
                            <td className="px-3 py-1.5">{p.nome}</td>
                            <td className="px-3 py-1.5 text-graf-400">{p.categoria ?? '—'}</td>
                            <td className="tabular px-3 py-1.5 text-right text-graf-400">
                              {p.ordem}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {validos.length > 12 && (
                      <p className="border-t border-graf-800 px-3 py-1.5 text-[11px] text-graf-500">
                        … e mais {validos.length - 12} linhas.
                      </p>
                    )}
                  </div>
                  {mapa.descricao && (
                    <p className="text-xs text-graf-500">
                      A coluna de descrição é do <strong>código</strong>, não da sub-falha.
                      Aparece aqui só para conferência — já vive em codigo_baixa e não é
                      importada.
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    <button onClick={importar}
                      disabled={ocupado || !validos.length || !conjunto.trim()}
                      className="toque rounded-lg bg-af-600 px-6 font-semibold text-white
                                 hover:bg-af-500 disabled:opacity-50">
                      {ocupado ? 'Importando…'
                               : `Importar ${validos.length} em "${conjunto.trim() || '—'}"`}
                    </button>
                    {progresso && <span className="text-sm text-graf-400">{progresso}</span>}
                  </div>
                  <p className="text-xs text-graf-500">
                    Importar de novo o mesmo conjunto atualiza o que já existe — a chave é
                    conjunto + código + sub-falha. Não duplica.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </Shell>
  )
}
