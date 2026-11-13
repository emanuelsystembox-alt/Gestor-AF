import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LinkContrato } from './LinkContrato'
import { GRUPO_FILA, useFilaAgora, type GrupoFila, type ItemFila } from '../lib/filaAgora'

/**
 * As linhas da fila "O que fazer agora" (263, D-378), agrupadas na ordem do Emanuel.
 * A mesma peça serve a página inteira e o cartão do Dashboard INST (`limite`).
 */
export function ListaFila({ itens, dispensar, limitePorGrupo, limite }: {
  itens: ItemFila[]
  dispensar: (i: ItemFila) => void
  /** na página: quantos por grupo antes do "ver mais" */
  limitePorGrupo?: number
  /** no cartão: quantos no total, sem cabeçalho de grupo */
  limite?: number
}) {
  const [abertos, setAbertos] = useState<Set<number>>(new Set())

  if (limite != null) {
    return (
      <ul className="divide-y divide-graf-800">
        {itens.slice(0, limite).map(i => <Linha key={i.chave} i={i} dispensar={dispensar} compacta />)}
      </ul>
    )
  }

  const grupos = ([1, 2, 3, 4, 5, 6] as GrupoFila[])
    .map(g => [g, itens.filter(i => i.grupo === g)] as const)
    .filter(([, l]) => l.length > 0)

  return (
    <div className="space-y-3">
      {grupos.map(([g, l]) => {
        const todos = abertos.has(g) || limitePorGrupo == null
        const mostra = todos ? l : l.slice(0, limitePorGrupo)
        return (
          <section key={g} className="card-controle overflow-hidden" aria-label={GRUPO_FILA[g].rotulo}>
            <h2 className="flex items-center gap-2 border-b border-graf-800 px-4 py-2 text-sm font-semibold">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: GRUPO_FILA[g].cor }} />
              {g}. {GRUPO_FILA[g].rotulo}
              <span className="tabular font-normal text-graf-400">{l.length}</span>
            </h2>
            <ul className="divide-y divide-graf-800">
              {mostra.map(i => <Linha key={i.chave} i={i} dispensar={dispensar} />)}
            </ul>
            {!todos && l.length > mostra.length && (
              <button type="button" onClick={() => setAbertos(s => new Set(s).add(g))}
                className="w-full border-t border-graf-800 px-4 py-1.5 text-left text-xs text-af-400 hover:bg-graf-900">
                ver os outros {l.length - mostra.length}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

function Linha({ i, dispensar, compacta = false }: { i: ItemFila; dispensar: (i: ItemFila) => void; compacta?: boolean }) {
  const quem = [i.equipe ? `equipe ${i.equipe}` : null, i.tecnico].filter(Boolean).join(' · ')
  const titulo = <span className="font-medium text-graf-100">{i.titulo}</span>
  return (
    <li className={`flex items-start gap-3 ${compacta ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: GRUPO_FILA[i.grupo].cor }} />
      <div className="min-w-0 flex-1 text-sm">
        {i.link
          ? (i.link.startsWith('/controle/visita/')
              ? <LinkContrato to={i.link} className="hover:underline">{titulo}</LinkContrato>
              : <Link to={i.link} className="hover:underline">{titulo}</Link>)
          : titulo}
        {(i.detalhe || quem) && (
          <div className="truncate text-xs text-graf-400" title={[i.detalhe, quem].filter(Boolean).join(' · ')}>
            {[i.detalhe, quem].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      <button type="button" onClick={() => dispensar(i)}
        title="Tirar da minha fila (volta se a situação piorar)"
        className="shrink-0 rounded border border-graf-700 px-2 py-0.5 text-[11px] text-graf-300 hover:border-af-600">
        dispensar
      </button>
    </li>
  )
}

/**
 * O cartão do Dashboard INST (escolha do Emanuel, 13/11): os 3 primeiros da fila e as
 * contagens por grupo, com o caminho para a página inteira.
 */
export function CartaoFilaAgora() {
  const { itens, dispensar, erro } = useFilaAgora()
  if (erro || itens.length === 0) return null
  const grupos = ([1, 2, 3, 4, 5, 6] as GrupoFila[])
    .map(g => [g, itens.filter(i => i.grupo === g).length] as const).filter(([, n]) => n > 0)
  return (
    <section className="card-controle overflow-hidden" aria-label="O que fazer agora">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-graf-800 px-3 py-2">
        <h2 className="text-sm font-semibold">O que fazer agora</h2>
        {grupos.map(([g, n]) => (
          <span key={g} className="inline-flex items-center gap-1 text-xs text-graf-300">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: GRUPO_FILA[g].cor }} />
            {GRUPO_FILA[g].rotulo} <strong className="tabular">{n}</strong>
          </span>
        ))}
        <Link to="/controle/agora" className="ml-auto text-xs text-af-400 hover:underline">ver todos ({itens.length}) →</Link>
      </div>
      <ListaFila itens={itens} dispensar={dispensar} limite={3} />
    </section>
  )
}
