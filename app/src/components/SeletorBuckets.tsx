import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SEM_BUCKET } from '../lib/filtroContratos'

/**
 * O filtro de bucket do TOA, com MAIS DE UM marcado (119).
 *
 * > "é bom ter um filtro de bucket (...) é bom o usuario também ter
 * >  possibildiade de selecionar mais de um bucket" — Emanuel, 20/10
 *
 * Um `<select multiple>` pede Ctrl+clique, que ninguém descobre sozinho;
 * aqui é um botão que abre uma lista de caixinhas. Nada marcado = todos —
 * o mesmo "Toda janela" dos outros filtros, sem um estado a mais.
 * As opções saem do que o dia TEM, com a contagem, como o status do TOA.
 *
 * A lista abre por PORTAL na `.sup-controle`, com `position: fixed`: o
 * cartão dos filtros tem animação com `transform`, que prende o
 * `absolute` e o z-index dentro dele — o cartão de baixo cobria a lista
 * (Emanuel, 20/10: "o filtro foi engolido"). Mesma saída do MenuContrato
 * (D-169, D-173).
 */
export function SeletorBuckets({ opcoes, semBucket, valor, onChange, className }: {
  opcoes: { nome: string; qtd: number }[]
  /** Quantos contratos não têm bucket (manuais). 0 = a opção não aparece. */
  semBucket: number
  valor: string[]
  onChange: (v: string[]) => void
  className: string
}) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; dir: number; y: number } | null>(null)

  function abrirOuFechar() {
    if (aberto) { setAberto(false); return }
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, dir: r.right, y: r.bottom + 4 })
    setAberto(true)
  }

  // Fecha ao clicar fora ou no Esc — é um menu, não um formulário.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (caixa.current?.contains(alvo) || lista.current?.contains(alvo)) return
      setAberto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    // fixed não acompanha a rolagem: rolou, fecha (em vez de flutuar longe do botão)
    const rolou = (e: Event) => {
      if (lista.current?.contains(e.target as Node)) return
      setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', rolou, true)
    window.addEventListener('resize', rolou)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', rolou, true)
      window.removeEventListener('resize', rolou)
    }
  }, [aberto])

  const todas = [...opcoes, ...(semBucket > 0 ? [{ nome: SEM_BUCKET, qtd: semBucket }] : [])]
  const rotulo = (n: string) => n === SEM_BUCKET ? 'Sem bucket (manual)' : n
  const alterna = (n: string) =>
    onChange(valor.includes(n) ? valor.filter(x => x !== n) : [...valor, n])

  const texto = valor.length === 0 ? 'Todos os buckets'
    : valor.length === 1 ? rotulo(valor[0])
    : `${valor.length} buckets`

  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={abrirOuFechar}
        aria-haspopup="true" aria-expanded={aberto} aria-label="Bucket do TOA"
        className={`${className} inline-flex items-center gap-1.5 ${
          valor.length ? 'border-af-500 text-graf-100' : ''}`}>
        {texto}
        <span aria-hidden className="text-[9px] opacity-60">▼</span>
      </button>
      {aberto && pos && createPortal(
        <div ref={lista} role="group" aria-label="Buckets do TOA"
          // sem espaço à direita, alinha pela borda direita do botão — o
          // translate usa o tamanho real da lista, não um estimado (traps.md)
          style={pos.x + 260 > window.innerWidth
            ? { position: 'fixed', left: pos.dir, top: pos.y, transform: 'translateX(-100%)' }
            : { position: 'fixed', left: pos.x, top: pos.y }}
          className="z-50 max-h-80 min-w-60 overflow-y-auto rounded-md border
                     border-graf-700 bg-graf-900 p-1.5 shadow-lg">
          {todas.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-graf-400">Nenhum contrato no dia.</p>
          ) : todas.map(o => (
            <label key={o.nome}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs
                         hover:bg-graf-800">
              <input type="checkbox" checked={valor.includes(o.nome)}
                onChange={() => alterna(o.nome)} className="accent-af-600" />
              <span className="flex-1">{rotulo(o.nome)}</span>
              <span className="tabular text-graf-400">{o.qtd}</span>
            </label>
          ))}
          {valor.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="mt-1 w-full border-t border-graf-800 px-2 pt-1.5 text-left text-xs
                         text-af-400 hover:underline">
              Todos os buckets
            </button>
          )}
        </div>,
        document.querySelector('.sup-controle') ?? document.body,
      )}
    </div>
  )
}

/** As opções do seletor, contadas sobre os contratos carregados. */
export function opcoesDeBucket(cs: { toa_bucket?: string | null }[]) {
  const m = new Map<string, number>()
  let sem = 0
  for (const v of cs) {
    if (v.toa_bucket) m.set(v.toa_bucket, (m.get(v.toa_bucket) ?? 0) + 1)
    else sem++
  }
  return {
    buckets: [...m.entries()].map(([nome, qtd]) => ({ nome, qtd }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    semBucket: sem,
  }
}
