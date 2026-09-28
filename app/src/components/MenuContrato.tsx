import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { ContratoLinha } from './TabelaContratos'

/** O que o menu pede ao modal do contrato — ele abre já na ação. */
export type AcaoContrato = 'status' | 'marcadores' | 'baixar' | 'transferir' | 'excluir'

/**
 * As ações do contrato no botão direito (e no "⋯") — um menu só, para
 * Serviços e Equipes.
 *
 * ┌─ POR QUE UM COMPONENTE, E POR QUE PORTAL ────────────────────────┐
 * │ Eram duas cópias. A de Serviços ia para a raiz da tela por portal │
 * │ (D-169); a de Equipes não — e ela mora dentro da gaveta da       │
 * │ equipe, que tem animação (`transform`) e rola por dentro          │
 * │ (`overflow`). Um ancestral com transform vira o referencial do    │
 * │ `fixed`, e o overflow corta o que passa da borda: o menu abria    │
 * │ fora do lugar e sumia recortado. "Botão direito não está          │
 * │ funcionando […] as 3 bolinhas também não" (Emanuel, 27/09). A     │
 * │ cópia que faltava consertar era a prova de que não podia ter duas.│
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Fecha com clique fora, Esc e rolagem — menu aberto que fica parado
 * enquanto a lista rola embaixo dele aponta para o contrato errado.
 */
export function MenuContrato({ v, xy, aoEscolher, aoFechar }: {
  v: ContratoLinha
  xy: { x: number; y: number }
  aoEscolher: (acao: AcaoContrato) => void
  aoFechar: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) aoFechar()
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    // No próximo quadro: o mesmo clique que abriu não pode fechar.
    const t = requestAnimationFrame(() => {
      document.addEventListener('mousedown', fora)
      document.addEventListener('scroll', aoFechar, true)
    })
    document.addEventListener('keydown', tecla)
    return () => {
      cancelAnimationFrame(t)
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('scroll', aoFechar, true)
      document.removeEventListener('keydown', tecla)
    }
  }, [aoFechar])

  const item = 'block w-full px-3 py-2 text-left text-xs text-graf-200 hover:bg-graf-800 ' +
               'disabled:opacity-40 disabled:hover:bg-transparent'
  const escolher = (a: AcaoContrato) => { aoEscolher(a); aoFechar() }

  return createPortal(
    <div ref={caixa} role="menu" onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
      // A ponta do menu fica NO clique: sem espaço à direita, abre para a
      // esquerda; sem espaço embaixo, para cima. O translate usa o tamanho
      // REAL do menu — nada de estimar altura (D-169).
      style={{
        left: xy.x, top: xy.y,
        transform: `translate(${xy.x + 216 > window.innerWidth ? '-100%' : '0'}, `
          + `${xy.y + 300 > window.innerHeight ? '-100%' : '0'})`,
      }}
      className="fixed z-50 w-52 overflow-hidden rounded-lg border border-graf-700
                 bg-graf-900 text-left shadow-xl">
      <Link to={`/controle/visita/${v.id}`} role="menuitem"
        className="block px-3 py-2 text-xs text-graf-200 hover:bg-graf-800">
        Abrir contrato
      </Link>
      <button role="menuitem" onClick={() => escolher('status')} className={item}>
        Mudar status…
      </button>
      <button role="menuitem" onClick={() => escolher('marcadores')} className={item}>
        Marcadores…
      </button>
      <button role="menuitem" onClick={() => escolher('baixar')}
        disabled={v.ordem_servico.length === 0} className={item}>
        Baixar serviço…
      </button>
      <button role="menuitem" onClick={() => escolher('transferir')} className={item}>
        Transferir equipe…
      </button>
      <button role="menuitem" onClick={() => escolher('excluir')}
        className="block w-full border-t border-graf-800 px-3 py-2 text-left text-xs
                   text-af-300 hover:bg-af-900/20">
        Apagar do banco…
      </button>
    </div>,
    document.querySelector('.sup-controle') ?? document.body,
  )
}
