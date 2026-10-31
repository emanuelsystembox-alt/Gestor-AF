import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * Os marcadores de qualidade do contrato (URA, GEO, processos…).
 *
 * > "A opção marcadores deve ficar ao lado do botão mais OS. Quando clicar
 * >  em cima, abre um select para o controlador selecionar os marcadores
 * >  que aquele contrato tem. Não precisa deixar eles expostos"
 * >  — Emanuel, 31/10
 *
 * Histórico: 155 numa aba (ninguém achou), 156 num cartão sempre aberto ao
 * lado das O.S. (ocupava espaço com doze botões). Agora é um botão na barra
 * de ações, que diz quantos estão marcados e abre a lista para marcar.
 * Quem grava é o RLS de `visita_marcador` (permissão `servicos.marcadores`);
 * a tela só não oferece o clique a quem não tem.
 */
export function MarcadoresDoContrato({ visitaId }: { visitaId: string }) {
  const { pode } = useAuth()
  const podeMarcar = pode('servicos.marcadores')
  const [indicadores, setIndicadores] = useState<{ id: string; nome: string }[]>([])
  const [marcados, setMarcados] = useState<{ id: string; indicador_id: string }[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  const carregar = useCallback(async () => {
    const [i, m] = await Promise.all([
      supabase.from('indicador_qualidade').select('id, nome').eq('ativo', true).order('ordem'),
      supabase.from('visita_marcador').select('id, indicador_id').eq('visita_id', visitaId),
    ])
    setIndicadores((i.data ?? []) as { id: string; nome: string }[])
    setMarcados((m.data ?? []) as { id: string; indicador_id: string }[])
  }, [visitaId])

  useEffect(() => { carregar() }, [carregar])

  // Fecha no clique fora e no Esc. O Esc é pego na CAPTURA e não segue:
  // senão o mesmo Esc fecharia também a janela do contrato inteira.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('keydown', esc, true)
    }
  }, [aberto])

  async function alternar(indicadorId: string) {
    setOcupado(true); setErro(null)
    const atual = marcados.find(m => m.indicador_id === indicadorId)
    const { error } = atual
      ? await supabase.from('visita_marcador').delete().eq('id', atual.id)
      : await supabase.from('visita_marcador').insert({ visita_id: visitaId, indicador_id: indicadorId })
    if (error) setErro(error.message)
    await carregar()
    setOcupado(false)
  }

  return (
    <div ref={caixa} className="relative">
      <button onClick={() => setAberto(a => !a)} aria-expanded={aberto} aria-haspopup="true"
        className={`rounded-md border px-2.5 py-1 text-xs hover:border-af-600 hover:text-af-400 ${
          marcados.length ? 'border-sky-700/60 text-sky-300' : 'border-graf-700 text-graf-300'}`}>
        Marcadores{marcados.length > 0 && <span className="tabular"> ({marcados.length})</span>} ▾
      </button>
      {aberto && (
        <div role="dialog" aria-label="Marcadores do contrato"
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-graf-700
                     bg-graf-900 p-2 shadow-2xl">
          <p className="mb-1.5 px-1 text-[11px] text-graf-400">
            {podeMarcar ? 'Marque o que este contrato tem.' : 'Só quem tem a permissão de marcadores altera.'}
          </p>
          {indicadores.length === 0 ? (
            <p className="px-1 py-2 text-xs text-graf-400">Nenhum marcador cadastrado. Cadastre em Configurações.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {indicadores.map(i => {
                const on = marcados.some(m => m.indicador_id === i.id)
                return (
                  <li key={i.id}>
                    <label className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${
                      podeMarcar ? 'cursor-pointer hover:bg-graf-800' : 'text-graf-400'}`}>
                      <input type="checkbox" checked={on} disabled={ocupado || !podeMarcar}
                        onChange={() => alternar(i.id)} className="accent-af-600" />
                      <span className={on ? 'text-sky-300' : 'text-graf-200'}>{i.nome}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {erro && <p className="mt-1.5 px-1 text-xs text-af-400">{erro}</p>}
        </div>
      )}
    </div>
  )
}
