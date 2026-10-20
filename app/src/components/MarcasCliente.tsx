/**
 * Os sinais do CLIENTE no contrato (123): caso crítico de ouvidoria e a
 * segmentação, os dois como o TOA mandou.
 *
 * > "se for ouvidoria, deve subir um marcador preto, se não for a vida segue
 * >  normal (...) a segmentação do cliente é importante" — Emanuel, 20/10
 *
 * ┌─ por que assim ───────────────────────────────────────────────────┐
 * │ Ouvidoria é EXCEÇÃO (2 de 1.118): etiqueta preta sólida, a coisa  │
 * │ mais escura da linha, e só quando é. "Não" e "não sei" não        │
 * │ desenham nada — a vida segue normal.                              │
 * │                                                                   │
 * │ Segmento é contexto, está em quase todo contrato: etiqueta        │
 * │ discreta com uma bolinha. A cor NÃO é o roxo das linhas, que já   │
 * │ quer dizer jornada (D-190); e o segmento BLACK é bolinha preta    │
 * │ num contorno, para não se confundir com a etiqueta da ouvidoria.  │
 * └───────────────────────────────────────────────────────────────────┘
 */

const COR_SEGMENTO: Record<string, string> = {
  PURPLE: '#7c3aed',
  'PURPLE PME PF': '#7c3aed',
  PURPLE_INTERNET: '#7c3aed',
  PME: '#0284c7',
  BLACK: '#111111',
  WHITE: '#f8fafc',
}

export function SeloOuvidoria({ ouvidoria, grande = false }: { ouvidoria?: boolean | null; grande?: boolean }) {
  if (!ouvidoria) return null
  return (
    <span title="Caso crítico (ouvidoria) — como veio do TOA"
      className={`inline-flex items-center gap-1 rounded bg-black font-bold uppercase
                  tracking-wide text-white ring-1 ring-white/30
                  ${grande ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'}`}>
      <span aria-hidden>●</span> Ouvidoria
    </span>
  )
}

export function SeloSegmento({ segmentacao, grande = false }: { segmentacao?: string | null; grande?: boolean }) {
  if (!segmentacao) return null
  const sem = segmentacao === 'SEM SEGMENTO'
  const cor = COR_SEGMENTO[segmentacao] ?? (segmentacao.includes('PURPLE') ? '#7c3aed' : null)
  return (
    <span title={`Segmentação do cliente (TOA): ${segmentacao}`}
      className={`inline-flex items-center gap-1 rounded ring-1 ring-graf-600
                  ${sem ? 'text-graf-400' : 'text-graf-200'}
                  ${grande ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'}`}>
      {cor && (
        <span aria-hidden className="inline-block h-2 w-2 rounded-full"
          style={{ background: cor, boxShadow: '0 0 0 1px rgb(124 134 154 / 0.7)' }} />
      )}
      {sem ? 'sem segmento' : segmentacao}
    </span>
  )
}
