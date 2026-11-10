import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { COR_AGUARDANDO, DESFECHO_POR_CHAVE } from '../lib/qualidade'

/**
 * ┌─ O marcador do pós-ativo (D-367) ─────────────────────────────────────┐
 * │ "preciso saber nessa tabela de serviços se o setor de pós ativo       │
 * │  passou no contrato ou não (...) tem que ser uma sinalização suave,   │
 * │  é bom mostrar só quando o pós atendimento colocar algum status (...) │
 * │  se ele não fez nada deixa vazio mesmo (...) e clicar em cima, jogar  │
 * │  para o pós ativo" — Emanuel, 10/11.                                  │
 * │                                                                       │
 * │ Aparece só com o desfecho registrado (`pesquisa_qualidade`) ou o      │
 * │ "aguardando cliente" aberto (`qualidade_aguardando`) — o aguardando,  │
 * │ quando existe, É o estágio (lib/qualidade, `estagioDe`). Sem nada:    │
 * │ não desenha. Rótulo e cor são os da Qualidade (`DESFECHOS`), não uma  │
 * │ cópia. O clique abre a fila da Qualidade naquele contrato.            │
 * │ As duas tabelas têm RLS por `qualidade.ver`: sem a permissão, o dado  │
 * │ não vem e o selo não aparece.                                         │
 * └───────────────────────────────────────────────────────────────────────┘
 */
export interface PosAtivo {
  desfecho: string | null
  observacao?: string | null
  registrado_em?: string | null
  tentativas?: number | null
  /** o "aguardando cliente" ABERTO; nulo quando não há */
  aguardando_em?: string | null
}

/** O link para a fila da Qualidade, aberta no contrato. */
export const linkPosAtivo = (visitaId: string, dia: string, contrato: string | null) =>
  `/controle/qualidade?dia=${dia}&visita=${visitaId}${contrato ? `&contrato=${encodeURIComponent(contrato)}` : ''}`

const horaDia = (iso: string) => new Date(iso).toLocaleString('pt-BR',
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function temPosAtivo(p: PosAtivo | null | undefined): p is PosAtivo {
  return !!p && (!!p.desfecho || !!p.aguardando_em)
}

export function SeloPosAtivo({ pos, para, comObservacao = false }: {
  pos: PosAtivo | null | undefined
  /** para onde o clique leva (`linkPosAtivo`) */
  para: string
  /** escreve a observação embaixo do selo (a lista da revisita) */
  comObservacao?: boolean
}) {
  if (!temPosAtivo(pos)) return null
  const aguardando = !!pos.aguardando_em
  const d = pos.desfecho ? DESFECHO_POR_CHAVE[pos.desfecho] : null
  const rotulo = aguardando ? 'aguardando cliente' : d?.r ?? pos.desfecho ?? ''
  const cor = aguardando ? COR_AGUARDANDO : d?.cor ?? 'var(--color-graf-400)'
  const falou = aguardando ? null : d?.contatado ?? null
  const dica = [
    `Pós-ativo: ${rotulo}`,
    falou == null ? null : falou ? 'falou com o assinante' : 'não falou com o assinante',
    pos.registrado_em ? `registrado ${horaDia(pos.registrado_em)}` : null,
    aguardando && pos.aguardando_em ? `aguardando desde ${horaDia(pos.aguardando_em)}` : null,
    pos.tentativas ? `${pos.tentativas} tentativa(s)` : null,
    pos.observacao ? `“${pos.observacao}”` : null,
    'Clique para abrir na Qualidade',
  ].filter(Boolean).join(' · ')
  const parar = (e: MouseEvent) => e.stopPropagation()
  return (
    <span className="block">
      <Link to={para} onClick={parar} title={dica} aria-label={dica}
        className="mt-1 inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-graf-700
                   bg-graf-850 px-1.5 py-px text-[10px] leading-4 text-graf-300 hover:border-af-600
                   hover:text-graf-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-af-500">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cor }} />
        <span className="font-semibold">Pós</span>
        <span className="truncate">{rotulo}</span>
        {pos.observacao && <span aria-hidden className="shrink-0 text-graf-400">✎</span>}
      </Link>
      {comObservacao && pos.observacao && (
        <span className="mt-0.5 block max-w-[16rem] whitespace-normal text-[10px] italic text-graf-300">
          “{pos.observacao}”
        </span>
      )}
    </span>
  )
}
