import { useEffect, useState } from 'react'

/**
 * "Atualizar" forçado (Emanuel, 27/09):
 *
 * > "é bom colocarmos um botão atualizar, para atualizar forçado os
 * >  status do contrato quando necessário. na aba serviços também ok?"
 *
 * O tempo real (`visita_evento`) já recarrega a lista sozinho — mas ele
 * cai (rede, aba dormindo) e não enxerga o que não passa por evento. O
 * botão é a saída de quem desconfia do que está vendo: busca de novo, e
 * diz HÁ QUANTO TEMPO a tela foi buscada, que é o que faz a desconfiança
 * ter onde se apoiar.
 */
export function BotaoAtualizar({ aoAtualizar, carregando, atualizadoEm }: {
  aoAtualizar: () => void
  carregando: boolean
  atualizadoEm: Date | null
}) {
  // Relógio de 30 s só para o "há 2 min" andar sozinho.
  const [, setTique] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTique(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const ha = atualizadoEm ? Math.floor((Date.now() - atualizadoEm.getTime()) / 60_000) : null
  const quando = ha == null ? '' : ha < 1 ? 'agora' : ha < 60 ? `há ${ha} min` : `há ${Math.floor(ha / 60)} h`

  return (
    <button onClick={aoAtualizar} disabled={carregando}
      title={atualizadoEm
        ? `Buscar de novo no banco. Última busca: ${atualizadoEm.toLocaleTimeString('pt-BR')}`
        : 'Buscar de novo no banco'}
      className="inline-flex items-center gap-1.5 rounded-md border border-graf-700 px-2.5 py-1
                 text-xs text-graf-300 hover:border-af-600 hover:text-af-400
                 disabled:cursor-wait disabled:opacity-60">
      <svg viewBox="0 0 16 16" aria-hidden
        className={`h-3.5 w-3.5 ${carregando ? 'animate-spin' : ''}`}>
        <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {carregando ? 'Atualizando…' : 'Atualizar'}
      {!carregando && quando && <span className="text-[10px] text-graf-400">· {quando}</span>}
    </button>
  )
}
