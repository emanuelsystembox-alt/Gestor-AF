import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCentral, type Sinal } from '../lib/central'

/**
 * O painel que o sino abre (091, refeito na 095).
 *
 * > "as notificações precisam ser dinâmicas, o usuário pode limpar, e caso
 * >  aconteça de novo a situação, ele retorna […] não pode é ficar subindo a
 * >  mesma sempre, ele também pode ir para o histórico de notificações pra
 * >  ele ver o que o sistema sinalizou durante o dia" — Emanuel, 27/09
 *
 * Duas abas:
 *   · AGORA — o que continua acontecendo e ESTE usuário não limpou. Limpar
 *     é por pessoa: o outro controlador continua vendo. Se a situação
 *     acontece de novo (outro TEC1, outro pedido de suporte, mais um
 *     contrato quebrado), a chave é outra e o sinal volta; o mesmo, não.
 *   · HISTÓRICO DO DIA — tudo o que foi sinalizado hoje, com a hora,
 *     inclusive o que foi limpo ou já se resolveu.
 *
 * As definições de cada sinal são do Emanuel (D-167): suporte técnico =
 * Impedimento pelo campo; quebrado = baixa improdutiva; ritmo = abaixo da
 * meta do dia × fração da jornada.
 */

const ORDEM: Sinal['tipo'][] = ['AJUDA', 'TEC1', 'RITMO', 'QUEBROU', 'MATERIAL', 'ABASTECIMENTO']
const ROTULO: Record<Sinal['tipo'], string> = {
  AJUDA: 'Suporte técnico', TEC1: 'TEC1 perdido', RITMO: 'Abaixo do ritmo',
  QUEBROU: 'Contratos quebrados', MATERIAL: 'Material sinalizado pelo campo',
  ABASTECIMENTO: 'Abastecimento aguardando aprovação',
}
const COR: Record<Sinal['tipo'], string> = {
  AJUDA: 'bg-orange-500', TEC1: 'bg-amber-500', RITMO: 'bg-sky-500',
  QUEBROU: 'bg-rose-500', MATERIAL: 'bg-violet-500', ABASTECIMENTO: 'bg-emerald-500',
}
const hora = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Para onde o sinal leva, quando leva a algum lugar. */
function destino(s: Sinal): string | null {
  if (s.visita_id) return `/controle/visita/${s.visita_id}`
  if (s.tipo === 'MATERIAL') return '/almoxarifado?aba=sinalizacoes'
  if (s.tipo === 'ABASTECIMENTO') return '/frota'
  return null
}

export function PainelCentral({ fechar }: { fechar: () => void }) {
  const { dados, sinais, dispensar, abrirChat } = useCentral()
  const [aba, setAba] = useState<'agora' | 'historico'>('agora')
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar() }
    setTimeout(() => document.addEventListener('mousedown', fora), 0)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); window.removeEventListener('keydown', esc) }
  }, [fechar])

  const ativos = sinais.filter(s => s.vigente && !s.dispensado)
  const mensagens = dados?.mensagens ?? []

  return (
    <div ref={caixa} role="dialog" aria-label="Central do controle"
      className="absolute right-0 top-full z-50 mt-2 flex max-h-[75vh] w-[24rem] max-w-[calc(100vw-1rem)]
                 flex-col overflow-hidden rounded-lg border border-graf-700 bg-graf-900 shadow-2xl">
      <div className="flex items-center gap-1 border-b border-graf-800 px-2 py-2">
        {(['agora', 'historico'] as const).map(a => (
          <button key={a} onClick={() => setAba(a)} aria-pressed={aba === a}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
            {a === 'agora' ? `Agora · ${ativos.length}` : `Histórico do dia · ${sinais.length}`}
          </button>
        ))}
        {aba === 'agora' && ativos.length > 0 && (
          <button onClick={() => dispensar(ativos.map(s => s.id))}
            className="ml-auto rounded px-2 py-1 text-[11px] text-graf-400 hover:text-graf-100">
            Limpar tudo
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!dados && <p className="px-3 py-8 text-center text-sm text-graf-400">Carregando a central…</p>}

        {/* Mensagens não são sinal: somem quando lidas, no chat. */}
        {aba === 'agora' && mensagens.length > 0 && (
          <section className="border-b border-graf-800 px-3 py-2.5">
            <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-graf-300">
              <span aria-hidden className="h-2 w-2 rounded-full bg-af-500" />
              Mensagens não lidas
            </h3>
            <ul className="space-y-1">
              {mensagens.map(m => (
                <li key={m.tecnico_id}>
                  <button onClick={() => { fechar(); abrirChat(m.tecnico_id) }}
                    className="block w-full rounded px-1.5 py-1 text-left hover:bg-graf-800">
                    <span className="text-sm">{m.nome}</span>
                    <span className="text-xs text-graf-400"> · {m.nao_lidas} nova(s)</span>
                    <span className="block truncate text-xs text-graf-300">{m.ultima_texto}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {aba === 'agora' && dados && ativos.length === 0 && mensagens.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-graf-400">
            Nada pedindo atenção agora.
            {sinais.length > 0 && <> O que já apareceu hoje está no Histórico.</>}
          </p>
        )}

        {aba === 'agora' && ORDEM.map(tipo => {
          const doTipo = ativos.filter(s => s.tipo === tipo)
          if (doTipo.length === 0) return null
          return (
            <section key={tipo} className="border-b border-graf-800 px-3 py-2.5">
              <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-graf-300">
                <span aria-hidden className={`h-2 w-2 rounded-full ${COR[tipo]}`} />
                {ROTULO[tipo]}
                <span className="tabular ml-auto rounded bg-graf-800 px-1.5 text-graf-200">{doTipo.length}</span>
              </h3>
              <ul className="space-y-1">
                {doTipo.map(s => {
                  const para = destino(s)
                  const corpo = (<>
                    <span className="block text-sm">{s.titulo}</span>
                    {s.detalhe && <span className="block truncate text-xs text-graf-400">{s.detalhe}</span>}
                  </>)
                  return (
                    <li key={s.id} className="group flex items-start gap-1">
                      {para
                        ? <Link to={para} onClick={fechar} className="min-w-0 flex-1 rounded px-1.5 py-1 hover:bg-graf-800">{corpo}</Link>
                        : <div className="min-w-0 flex-1 px-1.5 py-1">{corpo}</div>}
                      <span className="shrink-0 pt-1.5 text-[10px] text-graf-400">{hora(s.criado_em)}</span>
                      <button onClick={() => dispensar([s.id])} aria-label={`Limpar: ${s.titulo}`}
                        title="Limpar — se acontecer de novo, volta"
                        className="shrink-0 rounded px-1.5 py-1 text-xs text-graf-400 hover:bg-graf-800 hover:text-graf-100">
                        ✕
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

        {aba === 'historico' && (
          sinais.length === 0
            ? <p className="px-3 py-8 text-center text-sm text-graf-400">Nada foi sinalizado hoje.</p>
            : (
              <ul className="divide-y divide-graf-800">
                {sinais.map(s => {
                  const para = destino(s)
                  return (
                    <li key={s.id} className="flex items-start gap-2 px-3 py-2">
                      <span className="tabular w-10 shrink-0 pt-0.5 text-[11px] text-graf-400">{hora(s.criado_em)}</span>
                      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${COR[s.tipo]}`} />
                      <div className="min-w-0 flex-1">
                        {para
                          ? <Link to={para} onClick={fechar} className="text-sm hover:underline">{s.titulo}</Link>
                          : <span className="text-sm">{s.titulo}</span>}
                        {s.detalhe && <span className="block truncate text-xs text-graf-400">{s.detalhe}</span>}
                      </div>
                      <span className={`shrink-0 pt-0.5 text-[10px] ${
                        !s.vigente ? 'text-emerald-400' : s.dispensado ? 'text-graf-400' : 'text-amber-300'}`}>
                        {!s.vigente ? 'resolvido' : s.dispensado ? 'limpo' : 'ativo'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )
        )}
      </div>
      {dados && (
        <p className="border-t border-graf-800 px-3 py-1.5 text-[10px] text-graf-400">
          atualizado {hora(dados.gerado_em)} · relê a cada minuto
        </p>
      )}
    </div>
  )
}
