import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCentral } from '../lib/central'

/**
 * O painel que o sino abre (091): o que pede atenção AGORA, em ordem de
 * urgência. Cada seção só existe se tiver item — seção vazia é ruído, e
 * o controlador aprende a não abrir.
 *
 * ┌─ as definições, e de quem são ───────────────────────────────────┐
 * │ · Pedido de ajuda = Impedimento registrado pelo CAMPO, hoje, que  │
 * │   continua em impedimento (Emanuel, 27/09).                       │
 * │ · TEC1 perdido = visita de hoje fora do padrão da janela (047).   │
 * │ · Abaixo do ritmo = pontos concluídos até o corte menores que a   │
 * │   meta do dia × fração da jornada (12h = 40%, 15h = 70%, 18h =    │
 * │   100%). Parâmetros em `parametro`, aprovados pelo Emanuel.       │
 * │ · Quebrou = visita com O.S. de baixa improdutiva.                 │
 * └───────────────────────────────────────────────────────────────────┘
 */

const num2 = (n: number) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hora = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

function Secao({ titulo, n, tom, children }: {
  titulo: string; n: number; tom: string; children: ReactNode
}) {
  return (
    <section className="border-b border-graf-800 px-3 py-2.5">
      <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-graf-300">
        <span aria-hidden className={`h-2 w-2 rounded-full ${tom}`} />
        {titulo}
        <span className="tabular ml-auto rounded bg-graf-800 px-1.5 text-graf-200">{n}</span>
      </h3>
      <ul className="space-y-1">{children}</ul>
    </section>
  )
}

export function PainelCentral({ fechar }: { fechar: () => void }) {
  const { dados, abrirChat } = useCentral()
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

  const d = dados
  const cortes = d?.ritmo ?? []
  const ultimo = cortes.length ? cortes[cortes.length - 1] : null
  const nada = d && !d.ajuda?.length && !d.tec1?.length && !(ultimo?.abaixo.length)
    && !d.quebrou?.length && !d.mensagens?.length && !d.material?.length && !d.abastecimento?.length

  return (
    <div ref={caixa} role="dialog" aria-label="Central do controle"
      className="absolute right-0 top-full z-50 mt-2 max-h-[75vh] w-[23rem] max-w-[calc(100vw-1rem)]
                 overflow-y-auto rounded-lg border border-graf-700 bg-graf-900 shadow-2xl">
      <div className="flex items-baseline justify-between border-b border-graf-800 px-3 py-2.5">
        <h2 className="text-sm font-semibold">O que pede atenção</h2>
        <span className="text-[10px] text-graf-400">{d ? `atualizado ${hora(d.gerado_em)}` : 'carregando…'}</span>
      </div>

      {!d && <p className="px-3 py-8 text-center text-sm text-graf-400">Carregando a central…</p>}
      {nada && (
        <p className="px-3 py-8 text-center text-sm text-graf-400">
          Nada pedindo atenção agora.
        </p>
      )}

      {!!d?.ajuda?.length && (
        <Secao titulo="Pedidos de ajuda" n={d.ajuda.length} tom="bg-orange-500">
          {d.ajuda.map(a => (
            <li key={a.visita_id}>
              <Link to={`/controle/visita/${a.visita_id}`} onClick={fechar}
                className="block rounded px-1.5 py-1 hover:bg-graf-800">
                <span className="text-sm">{a.tecnico ?? 'Técnico'}</span>
                <span className="text-xs text-graf-400"> · {a.servico}{a.contrato ? ` · ${a.contrato}` : ''} · {hora(a.desde)}</span>
                {a.observacao && <span className="block truncate text-xs italic text-graf-300">“{a.observacao}”</span>}
              </Link>
            </li>
          ))}
        </Secao>
      )}

      {!!d?.mensagens?.length && (
        <Secao titulo="Mensagens não lidas" n={d.mensagens.reduce((s, m) => s + Number(m.nao_lidas), 0)} tom="bg-af-500">
          {d.mensagens.map(m => (
            <li key={m.tecnico_id}>
              <button onClick={() => { fechar(); abrirChat(m.tecnico_id) }}
                className="block w-full rounded px-1.5 py-1 text-left hover:bg-graf-800">
                <span className="text-sm">{m.nome}</span>
                <span className="text-xs text-graf-400"> · {m.nao_lidas} nova(s)</span>
                <span className="block truncate text-xs text-graf-300">{m.ultima_texto}</span>
              </button>
            </li>
          ))}
        </Secao>
      )}

      {!!d?.tec1?.length && (
        <Secao titulo="TEC1 perdido hoje" n={d.tec1.length} tom="bg-amber-500">
          {d.tec1.map(t => (
            <li key={t.tecnico_id} className="flex px-1.5 text-sm">
              <span className="truncate">{t.nome}</span>
              <span className="tabular ml-auto text-xs text-graf-400">{t.qtd} visita(s)</span>
            </li>
          ))}
        </Secao>
      )}

      {cortes.length > 0 && (ultimo!.abaixo.length > 0 || ultimo!.sem_meta > 0) && (
        <Secao titulo={`Abaixo do ritmo até ${ultimo!.corte}h`} n={ultimo!.abaixo.length} tom="bg-sky-500">
          {ultimo!.abaixo.map(t => (
            <li key={t.tecnico_id} className="flex gap-2 px-1.5 text-sm">
              <span className="truncate">{t.nome}</span>
              <span className="tabular ml-auto shrink-0 text-xs text-graf-400">
                {num2(t.pontos)} de {num2(t.esperado)} pts
              </span>
            </li>
          ))}
          {/* Sem meta não é "no ritmo": é não saber. A central diz. */}
          {ultimo!.sem_meta > 0 && (
            <li className="px-1.5 text-xs text-amber-300">
              {ultimo!.sem_meta} técnico(s) sem meta cadastrada para a skill — fora da conta.
            </li>
          )}
          {cortes.length > 1 && (
            <li className="px-1.5 pt-1 text-[11px] text-graf-400">
              Cortes anteriores: {cortes.slice(0, -1).map(c => `${c.corte}h — ${c.abaixo.length}`).join(' · ')}
            </li>
          )}
        </Secao>
      )}

      {!!d?.quebrou?.length && (
        <Secao titulo="Quem mais quebrou hoje" n={d.quebrou.length} tom="bg-rose-500">
          {d.quebrou.map(t => (
            <li key={t.tecnico_id} className="flex gap-2 px-1.5 text-sm">
              <span className="truncate">{t.nome}</span>
              <span className="tabular ml-auto shrink-0 text-xs text-graf-400">
                {t.quebradas} quebrado(s) · −{num2(t.pontos_perdidos)} pts
              </span>
            </li>
          ))}
        </Secao>
      )}

      {!!d?.material?.length && (
        <Secao titulo="Material sinalizado pelo campo" n={d.material.length} tom="bg-violet-500">
          {d.material.slice(0, 6).map(m => (
            <li key={m.id}>
              <Link to="/almoxarifado?aba=sinalizacoes" onClick={fechar}
                className="block rounded px-1.5 py-1 text-sm hover:bg-graf-800">
                {m.tecnico} <span className="text-xs text-graf-400">
                  · {m.tipo === 'FALTANDO' ? 'faltando' : 'com defeito'}: {m.item ?? '—'}</span>
              </Link>
            </li>
          ))}
        </Secao>
      )}

      {!!d?.abastecimento?.length && (
        <Secao titulo="Abastecimento aguardando aprovação" n={d.abastecimento.length} tom="bg-emerald-500">
          {d.abastecimento.slice(0, 6).map(a => (
            <li key={a.id}>
              <Link to="/frota" onClick={fechar} className="block rounded px-1.5 py-1 text-sm hover:bg-graf-800">
                {a.placa} <span className="text-xs text-graf-400">
                  · {a.tecnico ?? 'sem condutor'} · R$ {num2(a.valor)}</span>
              </Link>
            </li>
          ))}
        </Secao>
      )}
    </div>
  )
}
