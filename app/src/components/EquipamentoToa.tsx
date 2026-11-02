import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * O equipamento e a miscelânea que o TOA mostra para o contrato, lidos pela
 * varredura (117, D-192). É o que o TOA AFIRMA — retrato da última leitura,
 * não estoque: não mexe em saldo nem posse.
 *
 * Nada lido ainda não é "sem equipamento" (regra 6): a tela diz "ainda não
 * lido do TOA", e só mostra listas vazias quando a varredura leu e não havia.
 *
 * ┌─ duas abas, cada uma com o seu contador (D-252) ───────────────────┐
 * │ > "separe equipamento e miscelânea ao lado, não coloque tudo junto,│
 * │ > e coloque na aba a quantidade de equipamento e a quantidade de   │
 * │ > miscelânea lançada" — Emanuel, 02/11                             │
 * │                                                                    │
 * │ Miscelânea = item SEM serial (a coluna gerada `miscelanea`, 117).  │
 * │ O contador conta as linhas da lista inteira (cabo × 10 é uma).     │
 * │ Sem leitura do TOA, a aba não mostra número nenhum (não é zero).   │
 * └────────────────────────────────────────────────────────────────────┘
 */

export interface ItemToa {
  id: string; secao: 'CLIENTE' | 'INSTALADO' | 'DESINSTALADO'
  tipo: string | null; modelo: string | null; serial: string | null
  acao: string | null; serial_substituido: string | null; quantidade: number | null
  miscelanea: boolean; lido_em: string
}

export type TipoToa = 'EQUIPAMENTO' | 'MISCELANEA'

const TITULO: Record<ItemToa['secao'], string> = {
  INSTALADO: 'Instalado',
  DESINSTALADO: 'Retirado (desinstalado)',
  CLIENTE: 'Já estava no cliente',
}
const ORDEM: ItemToa['secao'][] = ['INSTALADO', 'DESINSTALADO', 'CLIENTE']

const doTipo = (i: ItemToa, tipo: TipoToa) => i.miscelanea === (tipo === 'MISCELANEA')

/** Os itens do TOA do contrato, lidos uma vez para as duas abas. Nulo enquanto carrega. */
export function useEquipamentoToa(visitaId: string | undefined, varridoEm: string | null | undefined) {
  const [itens, setItens] = useState<ItemToa[] | null>(null)
  useEffect(() => {
    if (!visitaId) return
    let vivo = true
    supabase.from('visita_equipamento_toa')
      .select('id, secao, tipo, modelo, serial, acao, serial_substituido, quantidade, miscelanea, lido_em')
      .eq('visita_id', visitaId).order('secao')
      .then(({ data }) => { if (vivo) setItens((data ?? []) as ItemToa[]) })
    return () => { vivo = false }
  }, [visitaId, varridoEm])
  return itens
}

/** O contador da aba: TODOS os itens da lista — Instalado, Retirado e "já estava no
 *  cliente" ("tem equipamento que consta na tabela, porém não tá contando" — Emanuel,
 *  02/11: a 1ª versão contava só o lançado e mostrava 0 com 6 na lista).
 *  Indefinido = sem leitura do TOA. */
export function contagemToa(itens: ItemToa[] | null, varridoEm: string | null | undefined, tipo: TipoToa): number | undefined {
  if (!varridoEm || !itens) return undefined
  return itens.filter(i => doTipo(i, tipo)).length
}

export function EquipamentoToa({ itens, varridoEm, tipo }: {
  itens: ItemToa[] | null; varridoEm: string | null; tipo: TipoToa
}) {
  const misc = tipo === 'MISCELANEA'
  return (
    <section className="card-controle p-4">
      <h2 className="text-sm font-semibold">{misc ? 'Miscelânea no TOA' : 'Equipamento no TOA'}</h2>
      {/* Sem leitura do TOA: a frase de "ainda não lido" saiu a pedido do Emanuel
          (02/11). O sinal de "não sei" ficou na aba, que fica SEM número (não "0"). */}
      {!varridoEm ? null : itens === null ? (
        <p className="mt-1 text-sm text-graf-400">Carregando…</p>
      ) : (
        <>
          {/* A linha "Lido do TOA em … não mexe no estoque" saiu a pedido do Emanuel (02/11). */}
          {ORDEM.map(s => {
            const da = itens.filter(i => i.secao === s && doTipo(i, tipo))
            // "Já estava no cliente" só aparece quando tem; miscelânea retirada, idem
            if ((s === 'CLIENTE' || (misc && s === 'DESINSTALADO')) && da.length === 0) return null
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
                        </span>
                        {i.serial && <span className="font-mono text-xs text-graf-300">{i.serial}</span>}
                        {i.serial_substituido && (
                          <span className="text-xs text-amber-400" title="Numa troca: o aparelho que saiu">
                            no lugar de <span className="font-mono">{i.serial_substituido}</span>
                          </span>
                        )}
                        {i.quantidade != null && (misc || i.quantidade !== 1) && (
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
