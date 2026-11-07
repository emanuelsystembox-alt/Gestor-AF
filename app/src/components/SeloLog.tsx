import { LOG_GRAVE, corDoLog, lerLog } from '../lib/log'

/**
 * O selo do LOG na linha do contrato (144).
 *
 * > "quero saber se o contrato é LOG 0, LOG 1, LOG 2, LOG 3 (...) acima
 * >  de 2 os log já precisam mudar de cor, de 3 pra cima já precisa
 * >  ficar preto" — Emanuel, 26/10
 *
 * A regra do número e o porquê dela estão em `lib/log.ts`; aqui é só
 * como ela aparece.
 */

export function SeloLog({ valor, titulo }: {
  valor?: string | number | null
  /** Texto extra na dica — a tela de serviços diz de que grupo é. */
  titulo?: string
}) {
  const n = lerLog(valor)

  // `graf-300`, não `graf-400`: medido com o motor do navegador,
  // graf-400 SOBRE O CHIP (graf-800) dá 4,35:1 — reprova no 4,5 da AA.
  // Os 5,88 do traps.md são sobre o cartão, que é mais escuro. Texto que
  // informa não anda em cor de moldura.
  if (n == null) {
    return (
      <span title={`A linha do TOA não trouxe a coluna "Contador de log" para este contrato.${titulo ? ` ${titulo}` : ''}`}
        className="inline-flex shrink-0 items-center whitespace-nowrap rounded bg-graf-800
                   px-1.5 py-0.5 text-[10px] font-medium leading-none text-graf-300">
        log ?
      </span>
    )
  }

  const dica = n === 0
    ? `LOG 0 — primeira ida: o contrato nunca voltou para a agenda.${titulo ? ` ${titulo}` : ''}`
    : `LOG ${n} — o contrato já voltou ${n} ${n === 1 ? 'vez' : 'vezes'} para a agenda, pela contagem do TOA.`
      + `${n >= LOG_GRAVE ? ' Três ou mais é reincidência para olhar.' : ''}${titulo ? ` ${titulo}` : ''}`

  // 1 amarelo claro, 2 laranja claro, 3 vermelho, 4+ preto (Emanuel, 06/11 —
  // `corDoLog`). Hex fixo: o recado é o mesmo no claro e no escuro. A borda
  // desenha o contorno, que no preto sumiria contra o grafite do cartão.
  const c = corDoLog(n)
  if (c) {
    return (
      <span title={dica}
        style={{ background: c.fundo, color: c.texto, boxShadow: `inset 0 0 0 1px ${c.borda}` }}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded
                   px-1.5 py-0.5 text-[10px] font-bold leading-none">
        LOG <span className="tabular">{n}</span>
      </span>
    )
  }

  return (
    <span title={dica}
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-graf-800
                 px-1.5 py-0.5 text-[10px] font-medium leading-none text-graf-300">
      LOG <span className="tabular">{n}</span>
    </span>
  )
}
