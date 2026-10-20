import { useEffect, useRef, useState } from 'react'
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

  // Fecha ao clicar fora ou no Esc — é um menu, não um formulário.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
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
      <button type="button" onClick={() => setAberto(a => !a)}
        aria-haspopup="true" aria-expanded={aberto} aria-label="Bucket do TOA"
        className={`${className} inline-flex items-center gap-1.5 ${
          valor.length ? 'border-af-500 text-graf-100' : ''}`}>
        {texto}
        <span aria-hidden className="text-[9px] opacity-60">▼</span>
      </button>
      {aberto && (
        <div role="group" aria-label="Buckets do TOA"
          className="absolute left-0 top-full z-30 mt-1 min-w-60 rounded-md border
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
        </div>
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
