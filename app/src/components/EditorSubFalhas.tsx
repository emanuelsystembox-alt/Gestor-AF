import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alerta, Vazio } from './ui'

/**
 * Sub-falhas, por código de baixa — dentro de Configurações.
 *
 * ┌─ D-161 ─────────────────────────────────────────────────────────┐
 * │ > "vamos levar essa opção lá para as configurações, vamos usar   │
 * │ >  somente o hard, e vamos deixá-lo aberto […] se eu quiser ir   │
 * │ >  no cód 500 e cadastrar, excluir ou adicionar outra subfalha   │
 * │ >  eu posso, e se eu quiser adicionar essa subfalha em mais de   │
 * │ >  um cód, também posso" — Emanuel, 23/09                        │
 * │                                                                  │
 * │ Não há tabela de ligação: cada par (código, sub-falha) é UMA     │
 * │ linha de `sub_falha`, e "a mesma sub-falha em vários códigos" é  │
 * │ linhas irmãs com o mesmo nome. É o modelo que o arquivo da CLARO │
 * │ já usa — 17 nomes do NÍVEL HARD aparecem em mais de um código —  │
 * │ e é o que a baixa, na web e no aplicativo, já lê por código.     │
 * │ Uma tabela nova obrigaria a reescrever as três telas de baixa    │
 * │ para chegar ao mesmo lugar.                                      │
 * │                                                                  │
 * │ EXCLUIR é `ativo = false`, nunca DELETE: `ordem_servico` e       │
 * │ `visita_evento` apontam para a linha, e baixa antiga que perde o │
 * │ nome da sub-falha é histórico apagado. Excluída some da escolha  │
 * │ e pode ser reativada.                                            │
 * │                                                                  │
 * │ Quem grava é o banco que decide: a policy `sf_escrita` só deixa  │
 * │ ADMIN. A tela esconde os botões para os outros — não é a trava.  │
 * └──────────────────────────────────────────────────────────────────┘
 */

interface Codigo { id: string; codigo: number; descricao: string; natureza: string | null }
interface SubFalha {
  id: string; codigo: number; nome: string
  categoria: string | null; ordem: number | null; ativo: boolean
}

/** Maiúsculo, espaços colapsados: o NÍVEL HARD inteiro está assim, e a
 *  chave única é (conjunto, código, nome) com caixa. "Atraso" e
 *  "ATRASO" virariam duas sub-falhas. */
const normNome = (t: string) => t.replace(/\s+/g, ' ').trim().toUpperCase()

/** "107, 500 501" → [107, 500, 501] */
const lerCodigos = (t: string) =>
  [...new Set((t.match(/\d+/g) ?? []).map(Number))]

export function EditorSubFalhas() {
  const { temPapel } = useAuth()
  const ehAdmin = temPapel('ADMIN')

  const [conjunto, setConjunto] = useState<string | null | undefined>(undefined)
  const [codigos, setCodigos] = useState<Codigo[]>([])
  const [subs, setSubs] = useState<SubFalha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const [busca, setBusca] = useState('')
  const [soComSub, setSoComSub] = useState(false)
  const [escolhido, setEscolhido] = useState<number | null>(null)
  const [verExcluidas, setVerExcluidas] = useState(false)

  const [novoNome, setNovoNome] = useState('')
  const [novoOutros, setNovoOutros] = useState('')
  /** Sub-falha cujo "ligar a outros códigos" está aberto. */
  const [ligando, setLigando] = useState<string | null>(null)
  const [ligarCodigos, setLigarCodigos] = useState('')

  async function carregar() {
    setCarregando(true); setErro(null)
    const [emp, cod] = await Promise.all([
      supabase.from('empresa').select('conjunto_sub_falha').maybeSingle(),
      supabase.from('codigo_baixa').select('id, codigo, descricao, natureza')
        .eq('ativo', true).order('codigo'),
    ])
    const c = (emp.data as { conjunto_sub_falha: string | null } | null)
      ?.conjunto_sub_falha ?? null
    setConjunto(c)
    setCodigos((cod.data ?? []) as Codigo[])
    if (cod.error) setErro(cod.error.message)

    if (c) {
      // Em páginas: o PostgREST corta em 1.000 linhas por pedido, e o
      // HARD tem 938 hoje. Cadastro que cresce passaria do teto e as
      // últimas sumiriam da tela sem erro nenhum.
      const todas: SubFalha[] = []
      for (let de = 0; ; de += 1000) {
        const { data, error } = await supabase.from('sub_falha')
          .select('id, codigo, nome, categoria, ordem, ativo')
          .eq('conjunto', c).order('codigo').order('ordem').order('nome')
          .range(de, de + 999)
        if (error) { setErro(error.message); break }
        todas.push(...((data ?? []) as SubFalha[]))
        if (!data || data.length < 1000) break
      }
      setSubs(todas)
    }
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  const porCodigo = useMemo(() => {
    const m = new Map<number, SubFalha[]>()
    for (const s of subs) m.set(s.codigo, [...(m.get(s.codigo) ?? []), s])
    return m
  }, [subs])

  /** Em que códigos cada NOME está ativo — o "também em" da linha. */
  const codigosDoNome = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const s of subs) if (s.ativo) m.set(s.nome, [...(m.get(s.nome) ?? []), s.codigo])
    return m
  }, [subs])

  const codigoPorNumero = useMemo(
    () => new Map(codigos.map(c => [c.codigo, c])), [codigos])

  const listaCodigos = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return codigos.filter(c => {
      const n = (porCodigo.get(c.codigo) ?? []).filter(s => s.ativo).length
      if (soComSub && n === 0) return false
      if (!t) return true
      return String(c.codigo).startsWith(t) || c.descricao.toLowerCase().includes(t)
        || (porCodigo.get(c.codigo) ?? []).some(s => s.nome.toLowerCase().includes(t))
    })
  }, [codigos, porCodigo, busca, soComSub])

  const atual = escolhido != null ? codigoPorNumero.get(escolhido) ?? null : null
  const doAtual = escolhido != null ? porCodigo.get(escolhido) ?? [] : []
  const ativasAtual = doAtual.filter(s => s.ativo)
  const excluidasAtual = doAtual.filter(s => !s.ativo)

  /**
   * Põe o NOME em cada código da lista. Já ativa → nada; excluída →
   * reativa; não existe → cria no fim da ordem daquele código, com a
   * categoria que o código já usa (a categoria é do código na planilha
   * da CLARO, não da sub-falha).
   */
  async function colocarEm(nome: string, lista: number[]) {
    if (!conjunto) return { novas: 0, reativadas: 0, invalidos: [] as number[] }
    const invalidos = lista.filter(c => !codigoPorNumero.has(c))
    let novas = 0, reativadas = 0
    for (const c of lista.filter(x => codigoPorNumero.has(x))) {
      const irmas = porCodigo.get(c) ?? []
      const existente = irmas.find(s => s.nome === nome)
      if (existente?.ativo) continue
      if (existente) {
        const { error } = await supabase.from('sub_falha')
          .update({ ativo: true }).eq('id', existente.id)
        if (error) throw error
        reativadas++; continue
      }
      const cats = new Map<string, number>()
      for (const s of irmas) if (s.categoria) cats.set(s.categoria, (cats.get(s.categoria) ?? 0) + 1)
      const categoria = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const ordem = Math.max(0, ...irmas.map(s => s.ordem ?? 0)) + 1
      const { error } = await supabase.from('sub_falha').insert({
        conjunto, codigo: c, nome, categoria, ordem, ativo: true,
        codigo_baixa_id: codigoPorNumero.get(c)!.id,
      })
      if (error) throw error
      novas++
    }
    return { novas, reativadas, invalidos }
  }

  function resumo(r: { novas: number; reativadas: number; invalidos: number[] }, nome: string) {
    const partes = [
      r.novas && `${r.novas} código(s) novo(s)`,
      r.reativadas && `${r.reativadas} reativada(s)`,
    ].filter(Boolean)
    return `"${nome}": ${partes.length ? partes.join(', ') : 'já estava em todos'}`
      + (r.invalidos.length ? ` · código(s) que não existem: ${r.invalidos.join(', ')}` : '')
  }

  async function adicionar() {
    if (escolhido == null) return
    const nome = normNome(novoNome)
    if (!nome) return
    setOcupado(true); setErro(null); setOk(null)
    try {
      const r = await colocarEm(nome, [escolhido, ...lerCodigos(novoOutros)])
      setOk(resumo(r, nome))
      setNovoNome(''); setNovoOutros('')
      await carregar()
    } catch (e) { setErro((e as Error).message) }
    setOcupado(false)
  }

  async function ligar(s: SubFalha) {
    const lista = lerCodigos(ligarCodigos)
    if (!lista.length) return
    setOcupado(true); setErro(null); setOk(null)
    try {
      const r = await colocarEm(s.nome, lista)
      setOk(resumo(r, s.nome))
      setLigando(null); setLigarCodigos('')
      await carregar()
    } catch (e) { setErro((e as Error).message) }
    setOcupado(false)
  }

  async function mudarAtivo(s: SubFalha, ativo: boolean) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.from('sub_falha').update({ ativo }).eq('id', s.id)
    if (error) setErro(error.message)
    else setOk(ativo
      ? `"${s.nome}" voltou para o código ${s.codigo}.`
      : `"${s.nome}" saiu do código ${s.codigo}. Quem já baixou com ela continua com ela no histórico.`)
    await carregar()
    setOcupado(false)
  }

  const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs outline-none focus:border-af-500'
  const previaOutros = lerCodigos(novoOutros)

  if (carregando && conjunto === undefined) {
    return <p className="py-12 text-center text-graf-400">Carregando…</p>
  }

  if (!conjunto) {
    return (
      <section className="card-controle">
        <Vazio titulo="Nenhum conjunto de sub-falha vigente"
          descricao="Sem conjunto vigente a baixa mostra as sub-falhas de todos os conjuntos, em dobro."
          acao={<Link to="/controle/sub-falhas"
            className="rounded-lg border border-graf-700 px-4 py-2 text-sm text-graf-300
                       hover:border-af-600 hover:text-af-400">
            importar ou escolher o conjunto</Link>} />
      </section>
    )
  }

  return (
    <div className="space-y-3">
      <section className="card-controle flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Sub-falhas por código de baixa</h2>
          <p className="mt-0.5 text-xs text-graf-400">
            Conjunto em uso: <strong className="text-graf-200">{conjunto}</strong> ·{' '}
            {subs.filter(s => s.ativo).length} sub-falhas ativas em{' '}
            {[...porCodigo.values()].filter(l => l.some(s => s.ativo)).length} códigos.
            É esta lista que o técnico vê ao baixar, na web e no aplicativo.
          </p>
        </div>
        <Link to="/controle/sub-falhas"
          className="ml-auto text-xs text-graf-400 underline underline-offset-2 hover:text-af-400">
          importar planilha da CLARO / trocar conjunto
        </Link>
      </section>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}
      {!ehAdmin && (
        <Alerta tipo="info">
          Só o papel <strong>ADMIN</strong> cadastra, exclui e liga sub-falhas. Você está vendo
          a lista como ela está.
        </Alerta>
      )}

      <div className="grid gap-3 lg:grid-cols-[22rem_1fr]">
        {/* ---- os códigos ---- */}
        <section className="card-controle overflow-hidden">
          <div className="space-y-2 border-b border-graf-800 p-3">
            <input value={busca} onChange={e => setBusca(e.target.value)}
              aria-label="Buscar código, descrição ou sub-falha"
              placeholder="Código, descrição ou sub-falha…"
              className={`${campo} w-full text-sm`} />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={soComSub}
                onChange={e => setSoComSub(e.target.checked)} className="accent-af-600" />
              Só códigos que têm sub-falha
            </label>
          </div>
          <ul className="max-h-[32rem] overflow-y-auto">
            {listaCodigos.map(c => {
              const n = (porCodigo.get(c.codigo) ?? []).filter(s => s.ativo).length
              const sel = escolhido === c.codigo
              return (
                <li key={c.id}>
                  <button onClick={() => { setEscolhido(c.codigo); setLigando(null); setOk(null) }}
                    aria-pressed={sel}
                    className={`flex w-full items-baseline gap-2 border-b border-graf-800/60
                                px-3 py-2 text-left text-xs transition ${
                      sel ? 'bg-af-900/30' : 'hover:bg-graf-800/60'}`}>
                    <span className="tabular w-9 shrink-0 font-semibold text-graf-200">{c.codigo}</span>
                    <span className="min-w-0 flex-1 truncate text-graf-300" title={c.descricao}>
                      {c.descricao}
                    </span>
                    <span className={`tabular shrink-0 ${n ? 'text-graf-300' : 'text-graf-400'}`}>
                      {n || '—'}
                    </span>
                  </button>
                </li>
              )
            })}
            {listaCodigos.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-graf-400">Nenhum código.</li>
            )}
          </ul>
        </section>

        {/* ---- o código escolhido ---- */}
        <section className="card-controle">
          {!atual ? (
            <Vazio titulo="Escolha um código à esquerda"
              descricao="Para ver, cadastrar, excluir ou ligar a outros códigos as sub-falhas dele." />
          ) : (
            <div className="space-y-4 p-4">
              <div>
                <h3 className="text-base font-semibold">
                  <span className="tabular">{atual.codigo}</span> · {atual.descricao}
                </h3>
                <p className="mt-0.5 text-xs text-graf-400">
                  {ativasAtual.length} sub-falha(s)
                  {ativasAtual[0]?.categoria && <> · categoria {ativasAtual[0].categoria}</>}
                </p>
              </div>

              {ativasAtual.length === 0 ? (
                <p className="text-sm text-graf-400">
                  Este código não tem sub-falha: na baixa ele não pede a segunda escolha.
                </p>
              ) : (
                <ol className="divide-y divide-graf-800 rounded-md border border-graf-800">
                  {ativasAtual.map(s => {
                    const outros = (codigosDoNome.get(s.nome) ?? []).filter(c => c !== s.codigo)
                    return (
                      <li key={s.id} className="px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 font-medium text-graf-200">{s.nome}</span>
                          {ehAdmin && (<>
                            <button disabled={ocupado}
                              onClick={() => { setLigando(ligando === s.id ? null : s.id); setLigarCodigos('') }}
                              className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                         text-graf-300 hover:border-af-600 hover:text-af-400">
                              ligar a outros códigos
                            </button>
                            <button disabled={ocupado} onClick={() => mudarAtivo(s, false)}
                              className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                         text-graf-300 hover:border-af-600 hover:text-af-400">
                              excluir deste código
                            </button>
                          </>)}
                        </div>
                        {outros.length > 0 && (
                          <p className="mt-0.5 text-[11px] text-graf-400">
                            também em:{' '}
                            {outros.map(c => (
                              <button key={c} onClick={() => setEscolhido(c)}
                                title={codigoPorNumero.get(c)?.descricao}
                                className="tabular mr-1.5 underline underline-offset-2 hover:text-af-400">
                                {c}
                              </button>
                            ))}
                          </p>
                        )}
                        {ligando === s.id && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input value={ligarCodigos} autoFocus
                              onChange={e => setLigarCodigos(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') ligar(s) }}
                              aria-label="Códigos para ligar esta sub-falha"
                              placeholder="Códigos: 107, 500, 501"
                              className={`${campo} w-56`} />
                            <button disabled={ocupado || !lerCodigos(ligarCodigos).length}
                              onClick={() => ligar(s)}
                              className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium
                                         text-white hover:bg-af-500 disabled:opacity-40">
                              ligar
                            </button>
                            <PreviaCodigos lista={lerCodigos(ligarCodigos)} mapa={codigoPorNumero} />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}

              {ehAdmin && (
                <div className="space-y-2 rounded-md border border-graf-800 p-3">
                  <p className="text-xs font-medium text-graf-300">Nova sub-falha neste código</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') adicionar() }}
                      aria-label="Nome da nova sub-falha"
                      placeholder="Ex.: CLIENTE AUSENTE NO HORÁRIO"
                      className={`${campo} min-w-64 flex-1`} />
                    <input value={novoOutros} onChange={e => setNovoOutros(e.target.value)}
                      aria-label="Também nos códigos"
                      placeholder="Também nos códigos (opcional)"
                      className={`${campo} w-56`} />
                    <button disabled={ocupado || !normNome(novoNome)} onClick={adicionar}
                      className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium text-white
                                 hover:bg-af-500 disabled:opacity-40">
                      adicionar
                    </button>
                  </div>
                  {normNome(novoNome) && (
                    <p className="text-[11px] text-graf-400">
                      Grava como <strong className="text-graf-200">{normNome(novoNome)}</strong>
                      {' '}em {atual.codigo}
                      {previaOutros.length > 0 && <> e em </>}
                      <PreviaCodigos lista={previaOutros} mapa={codigoPorNumero} />
                    </p>
                  )}
                </div>
              )}

              {excluidasAtual.length > 0 && (
                <div>
                  <button onClick={() => setVerExcluidas(v => !v)}
                    className="text-xs text-graf-400 underline underline-offset-2">
                    {verExcluidas ? 'esconder' : 'ver'} {excluidasAtual.length} excluída(s) deste código
                  </button>
                  {verExcluidas && (
                    <ul className="mt-2 space-y-1">
                      {excluidasAtual.map(s => (
                        <li key={s.id} className="flex items-center gap-2 text-xs text-graf-400">
                          <span className="line-through">{s.nome}</span>
                          {ehAdmin && (
                            <button disabled={ocupado} onClick={() => mudarAtivo(s, true)}
                              className="text-af-400 underline underline-offset-2">reativar</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** "500 Readequação… · 501 …" — e acusa em vermelho o código que não existe,
 *  antes de gravar, em vez de descobrir no resumo. */
function PreviaCodigos({ lista, mapa }: { lista: number[]; mapa: Map<number, Codigo> }) {
  if (!lista.length) return null
  return (
    <span className="text-[11px]">
      {lista.map((c, i) => (
        <span key={c} className={mapa.has(c) ? 'text-graf-300' : 'text-af-400'}
          title={mapa.get(c)?.descricao ?? 'Este código não existe'}>
          {i > 0 && ', '}{c}{!mapa.has(c) && ' (não existe)'}
        </span>
      ))}
    </span>
  )
}
