import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Uma opção da lista: o valor que o filtro guarda, o texto e a contagem. */
export interface OpcaoMultipla {
  valor: string
  rotulo: string
  /** Quantos contratos (ou equipes) têm esta opção. Ausente = não mostra. */
  qtd?: number
}

/**
 * O filtro de lista com MAIS DE UMA opção marcada — o mesmo desenho do
 * seletor de buckets (119), para qualquer filtro.
 *
 * > "ambos o filtro tem que dar liberdade de selecionar mais de uma opção
 * >  do filtro (...) A ideia é que todos os filtros que temos dessem
 * >  liberdade de selecionar mais de um" — Emanuel, 05/11
 *
 * ┌─ as escolhas que vêm do SeletorBuckets ──────────────────────────┐
 * │ · nada marcado = todos: o "Toda equipe" de sempre, sem um estado  │
 * │   a mais para guardar;                                            │
 * │ · um botão que abre caixinhas, e não `<select multiple>` — o      │
 * │   Ctrl+clique dele ninguém descobre sozinho;                      │
 * │ · a lista abre por PORTAL na `.sup-controle`, com `fixed`: o      │
 * │   cartão dos filtros tem `transform`, que prende o `absolute` e   │
 * │   deixava a lista "engolida" pelo cartão de baixo (D-169, D-173). │
 * │                                                                   │
 * │ E uma a mais: o valor marcado que SUMIU das opções (trocou o dia, │
 * │ a opção era do dia anterior) continua na lista, com 0. Sem isso o │
 * │ filtro esvaziava a tela e não havia caixinha para desmarcar.      │
 * └───────────────────────────────────────────────────────────────────┘
 */
export function SelecaoMultipla({
  opcoes, valor, onChange, className, todos, plural, rotulo,
}: {
  opcoes: OpcaoMultipla[]
  valor: string[]
  onChange: (v: string[]) => void
  className: string
  /** O texto com nada marcado: "Toda equipe". */
  todos: string
  /** O texto com várias marcadas: "equipes" → "3 equipes". */
  plural: string
  /** Nome do filtro para leitor de tela: "Equipe". */
  rotulo: string
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const caixa = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; dir: number; y: number } | null>(null)

  function abrirOuFechar() {
    if (aberto) { setAberto(false); return }
    const r = caixa.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, dir: r.right, y: r.bottom + 4 })
    setBusca('')
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

  // O último rótulo visto de cada valor: o marcado que sumiu das opções é
  // um id (marcador, equipe) — escrever o uuid não diria nada a ninguém.
  const vistos = useRef(new Map<string, string>())
  for (const o of opcoes) vistos.current.set(o.valor, o.rotulo)
  const conhecidas = new Set(opcoes.map(o => o.valor))
  const todas: OpcaoMultipla[] = [
    ...opcoes,
    ...valor.filter(v => !conhecidas.has(v)).map(v => ({
      valor: v, rotulo: vistos.current.get(v) ?? v,
      qtd: opcoes.some(o => o.qtd != null) ? 0 : undefined,
    })),
  ]
  const nomeDe = (v: string) => todas.find(o => o.valor === v)?.rotulo ?? v
  const alterna = (v: string) =>
    onChange(valor.includes(v) ? valor.filter(x => x !== v) : [...valor, v])

  // Busca só quando a lista é comprida (equipes, supervisores): com 5
  // opções a caixa de texto é ruído.
  const comBusca = todas.length > 12
  const t = busca.trim().toLowerCase()
  const vistas = t ? todas.filter(o => o.rotulo.toLowerCase().includes(t)) : todas

  const texto = valor.length === 0 ? todos
    : valor.length === 1 ? nomeDe(valor[0])
    : `${valor.length} ${plural}`

  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={abrirOuFechar}
        aria-haspopup="true" aria-expanded={aberto} aria-label={rotulo}
        title={valor.length > 1 ? valor.map(nomeDe).join('\n') : undefined}
        className={`${className} inline-flex max-w-56 items-center gap-1.5 ${
          valor.length ? 'border-af-500 text-graf-100' : ''}`}>
        <span className="truncate">{texto}</span>
        <span aria-hidden className="text-[9px] opacity-60">▼</span>
      </button>
      {aberto && pos && createPortal(
        <div ref={lista} role="group" aria-label={rotulo}
          // sem espaço à direita, alinha pela borda direita do botão — o
          // translate usa o tamanho real da lista, não um estimado (traps.md)
          style={pos.x + 260 > window.innerWidth
            ? { position: 'fixed', left: pos.dir, top: pos.y, transform: 'translateX(-100%)' }
            : { position: 'fixed', left: pos.x, top: pos.y }}
          className="z-50 max-h-80 min-w-60 max-w-96 overflow-y-auto rounded-md border
                     border-graf-700 bg-graf-900 p-1.5 shadow-lg">
          {comBusca && (
            <input value={busca} onChange={e => setBusca(e.target.value)} autoFocus
              aria-label={`Procurar em ${rotulo}`} placeholder="Procurar…"
              className="mb-1 w-full rounded border border-graf-700 bg-graf-950 px-2 py-1 text-xs
                         outline-none placeholder-graf-500 focus:border-af-500" />
          )}
          {todas.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-graf-400">Nada no período.</p>
          ) : vistas.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-graf-400">Nada com “{busca.trim()}”.</p>
          ) : vistas.map(o => (
            <label key={o.valor}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs
                         hover:bg-graf-800">
              <input type="checkbox" checked={valor.includes(o.valor)}
                onChange={() => alterna(o.valor)} className="accent-af-600" />
              <span className="flex-1">{o.rotulo}</span>
              {o.qtd != null && <span className="tabular text-graf-400">{o.qtd}</span>}
            </label>
          ))}
          {valor.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              className="mt-1 w-full border-t border-graf-800 px-2 pt-1.5 text-left text-xs
                         text-af-400 hover:underline">
              {todos}
            </button>
          )}
        </div>,
        document.querySelector('.sup-controle') ?? document.body,
      )}
    </div>
  )
}

/** Conta quantos itens caem em cada chave e devolve as opções em ordem
 *  alfabética (pt-BR). A chave nula não vira opção: quem quer "sem X"
 *  acrescenta a opção própria, com o rótulo que diz o que falta. */
export function opcoesContadas<T>(
  itens: T[], chave: (x: T) => string | null | undefined,
  rotulo: (k: string) => string = k => k,
): OpcaoMultipla[] {
  const m = new Map<string, number>()
  for (const x of itens) {
    const k = chave(x)
    if (k == null || k.trim() === '') continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()]
    .map(([valor, qtd]) => ({ valor, rotulo: rotulo(valor), qtd }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}
