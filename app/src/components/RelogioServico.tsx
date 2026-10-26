import { useEffect, useState } from 'react'

/**
 * O relógio do contrato (138).
 *
 * > "a gente pode colocar um relógio de tempo, onde começa a marcar o
 * >  tempo de deslocamento do técnico, a partir do horário que ele
 * >  iniciou, o tempo de em execução, quando ele começa a iniciar um
 * >  trabalho o relógio deve aparecer" — Emanuel, 25/10
 *
 * ┌─ dois relógios, uma meta só ───────────────────────────────────────┐
 * │ A meta por tipo de serviço (ADESÃO 90 min, VISITA TÉCNICA 50…) é   │
 * │ da EXECUÇÃO — escolha do Emanuel entre as três opções oferecidas.  │
 * │ O deslocamento também tem relógio, mas sem meta: distância na      │
 * │ cidade varia demais para um número só, e ninguém definiu um.       │
 * │                                                                     │
 * │ EM ANDAMENTO o relógio conta sozinho, desde a hora em que a        │
 * │ situação mudou. ENCERRADO ele congela no tempo medido pelo TOA     │
 * │ (`fim − início`), que é o mesmo número que o painel de Equipes     │
 * │ mostra — duas telas com o mesmo nome têm de dar o mesmo número.    │
 * │                                                                     │
 * │ SEM META o relógio continua aparecendo, em cinza, só com os        │
 * │ minutos: "sem meta" é diferente de "dentro da meta" (regra 6).     │
 * └─────────────────────────────────────────────────────────────────────┘
 */

export interface DadosRelogio {
  situacao: string
  /** Quando a situação ATUAL começou — é daqui que o relógio conta. */
  situacao_em?: string | null
  /** Início e fim da atividade no TOA: o tempo de execução medido. */
  inicio?: string | null
  fim?: string | null
  finalizado_toa?: boolean
  /** Minutos aceitáveis de execução para o grupo de serviço. */
  meta?: number | null
}

const TERMINAIS = ['CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO']

/** 1h07 em vez de 67 min: acima de uma hora, minuto corrido não se lê. */
export function textoMinutos(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h}h${String(min % 60).padStart(2, '0')}`
}

interface Leitura {
  minutos: number
  /** Conta agora, na tela. */
  correndo: boolean
  fase: 'DESLOCAMENTO' | 'EXECUCAO'
}

function ler(v: DadosRelogio, agora: number): Leitura | null {
  const desde = (iso?: string | null) =>
    iso ? Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000)) : null

  if (v.situacao === 'EM_DESLOCAMENTO') {
    const m = desde(v.situacao_em)
    return m == null ? null : { minutos: m, correndo: true, fase: 'DESLOCAMENTO' }
  }
  if (v.situacao === 'EM_EXECUCAO') {
    // O início do TOA é mais fiel que a hora em que a situação mudou aqui
    // (a importação pode ter trazido a mudança depois). Sem ele, vale a
    // nossa — e nunca "agora", que marcaria zero para um serviço antigo.
    const m = desde(v.inicio) ?? desde(v.situacao_em)
    return m == null ? null : { minutos: m, correndo: true, fase: 'EXECUCAO' }
  }
  if (TERMINAIS.includes(v.situacao) && v.inicio && v.fim) {
    const m = Math.max(0, Math.round(
      (new Date(v.fim).getTime() - new Date(v.inicio).getTime()) / 60000))
    return { minutos: m, correndo: false, fase: 'EXECUCAO' }
  }
  return null
}

/** Verde até 80% da meta, âmbar até estourar, vermelho depois. */
function cores(pct: number | null) {
  if (pct == null) return { anel: 'var(--color-graf-500)', texto: 'text-graf-300' }
  if (pct <= 0.8) return { anel: '#10b981', texto: 'text-emerald-300' }
  if (pct <= 1) return { anel: '#d97706', texto: 'text-amber-300' }
  return { anel: '#dc2626', texto: 'text-af-300' }
}

export function RelogioServico({ v, tamanho = 38 }: { v: DadosRelogio; tamanho?: number }) {
  // Enquanto corre, a tela se atualiza sozinha a cada 30 s. Parado, o
  // intervalo nem é criado: relógio congelado não precisa de timer.
  const [tique, setTique] = useState(() => Date.now())
  const correndo = v.situacao === 'EM_DESLOCAMENTO' || v.situacao === 'EM_EXECUCAO'
  useEffect(() => {
    if (!correndo) return
    const t = setInterval(() => setTique(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [correndo])

  const l = ler(v, tique)
  if (!l) return null

  const temMeta = l.fase === 'EXECUCAO' && v.meta != null && v.meta > 0
  const pct = temMeta ? l.minutos / v.meta! : null
  const c = cores(pct)
  // O anel enche até a meta e para de encher: passou, a cor é que fala.
  const fracao = pct == null ? (l.fase === 'DESLOCAMENTO' ? 0.25 : 0.5) : Math.min(pct, 1)

  const r = (tamanho - 6) / 2
  const perimetro = 2 * Math.PI * r
  const titulo = l.fase === 'DESLOCAMENTO'
    ? `Em deslocamento há ${textoMinutos(l.minutos)}. O deslocamento não tem meta — a distância na cidade varia demais.`
    : temMeta
      ? `${l.correndo ? 'Em execução há' : 'Execução levou'} ${textoMinutos(l.minutos)} de ${textoMinutos(v.meta!)} de meta`
        + ` (${Math.round(pct! * 100)}%).${l.correndo ? '' : ' Medido pelo TOA: fim menos início.'}`
      : `${l.correndo ? 'Em execução há' : 'Execução levou'} ${textoMinutos(l.minutos)}.`
        + ' Este grupo de serviço ainda não tem meta — cadastre em Configurações › Tipo de serviço.'

  return (
    <span title={titulo} aria-label={titulo}
      className="inline-flex shrink-0 items-center gap-1.5">
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`}
        className={l.correndo ? 'relogio-corre' : undefined} aria-hidden>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none"
          stroke="var(--color-graf-800)" strokeWidth="3" />
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none"
          stroke={c.anel} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${perimetro * fracao} ${perimetro}`}
          transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}
          // Sem meta o anel é um traço curto só para o círculo não ficar
          // vazio — e fica cinza, que é como a tela diz "não sei".
          opacity={pct == null ? 0.5 : 1} />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          className={`tabular fill-current text-[9px] font-bold ${c.texto}`}>
          {l.minutos >= 100 ? `${Math.floor(l.minutos / 60)}h` : l.minutos}
        </text>
      </svg>
      <span className="text-[10px] leading-tight text-graf-400">
        <span className="block uppercase tracking-wide">
          {l.fase === 'DESLOCAMENTO' ? 'deslocando' : l.correndo ? 'executando' : 'execução'}
        </span>
        <span className={`tabular font-semibold ${c.texto}`}>
          {textoMinutos(l.minutos)}
          {temMeta && <span className="font-normal text-graf-500">/{textoMinutos(v.meta!)}</span>}
        </span>
      </span>
    </span>
  )
}
