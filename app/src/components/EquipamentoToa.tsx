import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * O equipamento e a miscelânea que o TOA mostra para o contrato, lidos pela
 * varredura (117, D-192). É o que o TOA AFIRMA — retrato da última leitura,
 * não estoque: não mexe em saldo nem posse.
 *
 * Nada lido ainda não é "sem equipamento" (regra 6): a tela diz "ainda não
 * lido do TOA", e só mostra listas vazias quando a varredura leu e não havia.
 */

interface Item {
  id: string; secao: 'CLIENTE' | 'INSTALADO' | 'DESINSTALADO'
  tipo: string | null; modelo: string | null; serial: string | null
  acao: string | null; serial_substituido: string | null; quantidade: number | null
  miscelanea: boolean; lido_em: string
}

const TITULO: Record<Item['secao'], string> = {
  INSTALADO: 'Instalado',
  DESINSTALADO: 'Retirado (desinstalado)',
  CLIENTE: 'Já estava no cliente',
}
const ORDEM: Item['secao'][] = ['INSTALADO', 'DESINSTALADO', 'CLIENTE']

export function EquipamentoToa({ visitaId, varridoEm }: { visitaId: string; varridoEm: string | null }) {
  const [itens, setItens] = useState<Item[] | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.from('visita_equipamento_toa')
      .select('id, secao, tipo, modelo, serial, acao, serial_substituido, quantidade, miscelanea, lido_em')
      .eq('visita_id', visitaId).order('secao').order('miscelanea')
      .then(({ data }) => { if (vivo) setItens((data ?? []) as Item[]) })
    return () => { vivo = false }
  }, [visitaId, varridoEm])

  return (
    <section className="card-controle p-4">
      <h2 className="text-sm font-semibold">Equipamento e miscelânea no TOA</h2>
      {!varridoEm ? (
        <p className="mt-1 text-sm text-graf-400">
          Ainda não lido do TOA. A varredura lê quando o TOA encerra o contrato
          (Sincronismo › Varredura do TOA).
        </p>
      ) : itens === null ? (
        <p className="mt-1 text-sm text-graf-400">Carregando…</p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-graf-400">
            Lido do TOA em {new Date(varridoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.
            É o que o TOA mostra — não mexe no estoque.
          </p>
          {ORDEM.map(s => {
            const da = itens.filter(i => i.secao === s)
            if (s === 'CLIENTE' && da.length === 0) return null
            return (
              <div key={s} className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-graf-400">
                  {TITULO[s]} <span className="tabular">({da.length})</span>
                </p>
                {da.length === 0 ? (
                  <p className="mt-1 text-xs text-graf-400">Nada nesta lista no TOA.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-graf-800 rounded-lg border border-graf-800 text-sm">
                    {da.map(i => (
                      <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5">
                        <span className="min-w-0 flex-1">
                          {i.modelo || i.tipo || '—'}
                          {i.modelo && i.tipo && <span className="ml-1.5 text-xs text-graf-400">{i.tipo}</span>}
                          {i.miscelanea && (
                            <span className="ml-1.5 rounded bg-graf-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-graf-300">
                              miscelânea
                            </span>
                          )}
                        </span>
                        {i.serial && <span className="font-mono text-xs text-graf-300">{i.serial}</span>}
                        {i.serial_substituido && (
                          <span className="text-xs text-amber-400" title="Numa troca: o aparelho que saiu">
                            no lugar de <span className="font-mono">{i.serial_substituido}</span>
                          </span>
                        )}
                        {i.quantidade != null && (i.miscelanea || i.quantidade !== 1) && (
                          <span className="tabular text-xs text-graf-300">× {String(i.quantidade).replace('.', ',')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
