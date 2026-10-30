import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * Os marcadores de qualidade do contrato (URA, GEO, processos…), na
 * página do contrato, ao lado das O.S. (156).
 *
 * > "tinha uma opção (...) na tela menor, que era marcadores (...) agora
 * >  só ficou a tela maior. E na tela maior não tem nenhum campo onde a
 * >  gente consiga colocar os marcadores. Os marcadores podem ficar ao
 * >  lado de OS, no lado direito" — Emanuel, 30/10
 *
 * Eles existiam numa ABA da barra de ações (155) — escondidos atrás de um
 * clique que ninguém viu. Agora são um cartão sempre aberto. Quem grava é
 * o RLS de `visita_marcador` (permissão `servicos.marcadores`); a tela só
 * não oferece o clique a quem não tem.
 */
export function MarcadoresDoContrato({ visitaId }: { visitaId: string }) {
  const { pode } = useAuth()
  const podeMarcar = pode('servicos.marcadores')
  const [indicadores, setIndicadores] = useState<{ id: string; nome: string }[]>([])
  const [marcados, setMarcados] = useState<{ id: string; indicador_id: string }[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const [i, m] = await Promise.all([
      supabase.from('indicador_qualidade').select('id, nome').eq('ativo', true).order('ordem'),
      supabase.from('visita_marcador').select('id, indicador_id').eq('visita_id', visitaId),
    ])
    setIndicadores((i.data ?? []) as { id: string; nome: string }[])
    setMarcados((m.data ?? []) as { id: string; indicador_id: string }[])
  }, [visitaId])

  useEffect(() => { carregar() }, [carregar])

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
    <section className="card-controle p-4">
      <h2 className="mb-1 text-sm font-semibold">
        Marcadores <span className="tabular text-xs font-normal text-graf-400">({marcados.length})</span>
      </h2>
      <p className="mb-2.5 text-[11px] text-graf-400">
        {podeMarcar ? 'Clique para aplicar ou tirar.' : 'Só quem tem a permissão de marcadores altera.'}
      </p>
      {indicadores.length === 0 ? (
        <p className="text-xs text-graf-400">Nenhum marcador cadastrado. Cadastre em Configurações.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {indicadores.map(i => {
            const on = marcados.some(m => m.indicador_id === i.id)
            return (
              <button key={i.id} disabled={ocupado || !podeMarcar} onClick={() => alternar(i.id)}
                aria-pressed={on}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 transition
                            disabled:cursor-default ${
                  on ? 'bg-sky-900/40 text-sky-300 ring-sky-700/50'
                     : 'bg-graf-900 text-graf-400 ring-graf-700 enabled:hover:text-graf-200'}`}>
                {on && <span className="mr-1">✓</span>}{i.nome}
              </button>
            )
          })}
        </div>
      )}
      {erro && <p className="mt-2 text-xs text-af-400">{erro}</p>}
    </section>
  )
}
