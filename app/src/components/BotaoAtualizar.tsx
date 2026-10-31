import { useEffect, useRef, useState } from 'react'

/**
 * "Atualizar" forçado (Emanuel, 27/09):
 *
 * > "é bom colocarmos um botão atualizar, para atualizar forçado os
 * >  status do contrato quando necessário. na aba serviços também ok?"
 *
 * ┌─ 31/10: a tela só muda quando a PESSOA quer ──────────────────────┐
 * │ > "não quero que o sistema atualize quando alguém fizer uma        │
 * │ >  importação e atualiza de todo mundo (...) a ideia é ele         │
 * │ >  atualizar manualmente quando o usuário precisar ou quando ele   │
 * │ >  quiser programar (...) de 2 em 2 minutos ou 5 em 5 minutos"     │
 * │                                                                     │
 * │ Antes, Serviços se recarregava a cada evento do banco (uma         │
 * │ importação são centenas) e o Monitoramento a cada minuto: a lista  │
 * │ andava embaixo do dedo de quem estava trabalhando nela. Agora o    │
 * │ botão é a ÚNICA fonte de recarga das telas que o têm: o clique, ou │
 * │ o relógio que a própria pessoa ligou ao lado dele.                 │
 * │                                                                     │
 * │ A escolha (desligado / 2 / 5 min) é de cada pessoa, vale para      │
 * │ todas as telas e fica no navegador — conveniência de quem olha,    │
 * │ não dado do sistema. Sem `localStorage` (aba anônima), começa      │
 * │ desligado: o padrão é a tela parada.                               │
 * └─────────────────────────────────────────────────────────────────────┘
 */

const CHAVE = 'gestor-af:auto-atualizar-min'
const OPCOES = [0, 2, 5] as const
type Minutos = (typeof OPCOES)[number]

function lerEscolha(): Minutos {
  try {
    const n = Number(localStorage.getItem(CHAVE))
    return (OPCOES as readonly number[]).includes(n) ? (n as Minutos) : 0
  } catch { return 0 }
}

/** A escolha, sincronizada entre as telas (e entre abas, pelo `storage`). */
function useAutoAtualizar(): [Minutos, (m: Minutos) => void] {
  const [min, setMin] = useState<Minutos>(lerEscolha)
  useEffect(() => {
    const ouvir = () => setMin(lerEscolha())
    window.addEventListener('storage', ouvir)
    window.addEventListener('gestor-af:auto-atualizar', ouvir)
    return () => {
      window.removeEventListener('storage', ouvir)
      window.removeEventListener('gestor-af:auto-atualizar', ouvir)
    }
  }, [])
  const mudar = (m: Minutos) => {
    try { localStorage.setItem(CHAVE, String(m)) } catch { /* sem armazenamento: vale só nesta tela */ }
    setMin(m)
    window.dispatchEvent(new Event('gestor-af:auto-atualizar'))
  }
  return [min, mudar]
}

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

  const [auto, setAuto] = useAutoAtualizar()
  // O callback muda a cada render; o relógio não pode ser recriado por isso.
  const cb = useRef(aoAtualizar)
  cb.current = aoAtualizar
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => {
      // Aba escondida não busca: ninguém está olhando, e a próxima volta
      // à aba encontra o relógio ligado de novo.
      if (document.visibilityState === 'visible') cb.current()
    }, auto * 60_000)
    return () => clearInterval(t)
  }, [auto])

  const ha = atualizadoEm ? Math.floor((Date.now() - atualizadoEm.getTime()) / 60_000) : null
  const quando = ha == null ? '' : ha < 1 ? 'agora' : ha < 60 ? `há ${ha} min` : `há ${Math.floor(ha / 60)} h`

  return (
    <span className="inline-flex items-stretch">
      <button onClick={aoAtualizar} disabled={carregando}
        title={atualizadoEm
          ? `Buscar de novo no banco. Última busca: ${atualizadoEm.toLocaleTimeString('pt-BR')}`
          : 'Buscar de novo no banco'}
        className="inline-flex items-center gap-1.5 rounded-l-md border border-graf-700 px-2.5 py-1
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
      <select value={auto} onChange={e => setAuto(Number(e.target.value) as Minutos)}
        aria-label="Atualizar sozinho"
        title="Atualizar esta tela sozinho, no tempo escolhido. Vale para todas as telas, só neste navegador."
        className={`-ml-px rounded-r-md border border-graf-700 bg-graf-900 px-1.5 py-1 text-[11px]
                    ${auto ? 'text-emerald-300' : 'text-graf-400'}`}>
        <option value={0}>manual</option>
        <option value={2}>a cada 2 min</option>
        <option value={5}>a cada 5 min</option>
      </select>
    </span>
  )
}
