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
  /** Quando a situação ATUAL começou. Só vale como relógio quando foi
   *  GENTE que mudou a situação — ver `bloqueado_em` abaixo. */
  situacao_em?: string | null
  /** Carimbado em toda mudança de situação FORA da importação (D-006).
   *  Nulo = quem pôs o contrato nesta situação foi a importação, e
   *  então `situacao_em` é o `now()` dela, não a hora do técnico. */
  bloqueado_em?: string | null
  /** "Tempo de Deslocamento" medido pelo TOA, como intervalo do
   *  Postgres ("00:16:00"). É o mesmo número do painel de Equipes. */
  tempo_deslocamento?: string | null
  /** Início e fim da atividade no TOA: o tempo de execução medido. */
  inicio?: string | null
  fim?: string | null
  finalizado_toa?: boolean
  /** Minutos aceitáveis de execução para o grupo de serviço. */
  meta?: number | null
  /** Cancelado pela central ou Desatribuído: o TOA encerrou antes de o
   *  técnico sair, então `fim − início` não é tempo de execução — é a
   *  janela que o TOA tinha reservado (145). */
  semIda?: boolean
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
  /** O número é o medido pelo TOA, não um cronômetro nosso. */
  doToa?: boolean
}

/** "00:16:00" → 16. O PostgREST devolve `interval` como texto. */
export function minutosDeIntervalo(iv?: string | null): number | null {
  if (!iv) return null
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(iv.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function ler(v: DadosRelogio, agora: number): Leitura | null {
  const desde = (iso?: string | null) =>
    iso ? Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60000)) : null

  /*
   * ┌─ 144 · por que `situacao_em` não serve sozinho ─────────────────┐
   * │ A importação faz `update visita set situacao_em = now()`. Todos │
   * │ os contratos do mesmo arquivo ficam com o MESMO instante, e o   │
   * │ relógio passava a contar "minutos desde a importação" em vez de │
   * │ "minutos desde que o técnico saiu". Medido em 26/10: 11         │
   * │ contratos EM DESLOCAMENTO, nenhum tocado pelo campo, DOIS       │
   * │ instantes distintos — a tela mostrava "15 min" nos onze, com o  │
   * │ TOA dizendo 00:06, 00:09, 00:13, 00:29…                         │
   * │                                                                  │
   * │ É a mesma armadilha que a 024 já conhecia: `situacao_em` só é a │
   * │ hora do evento quando `bloqueado_em` existe, isto é, quando foi │
   * │ gente que mudou a situação e não a importação.                  │
   * │                                                                  │
   * │ Então: campo tocou → cronômetro nosso, correndo. Veio da        │
   * │ importação → o tempo que o TOA MEDIU, parado. E, sem nenhum     │
   * │ dos dois, relógio nenhum: "não sei" não se escreve como número. │
   * └──────────────────────────────────────────────────────────────────┘
   */
  if (v.situacao === 'EM_DESLOCAMENTO') {
    if (v.bloqueado_em) {
      const m = desde(v.situacao_em)
      if (m != null) return { minutos: m, correndo: true, fase: 'DESLOCAMENTO' }
    }
    const m = minutosDeIntervalo(v.tempo_deslocamento)
    return m == null ? null
      : { minutos: m, correndo: false, fase: 'DESLOCAMENTO', doToa: true }
  }
  if (v.situacao === 'EM_EXECUCAO') {
    // O início do TOA é a hora real do começo da execução. A `situacao_em`
    // só entra quando foi gente que mudou aqui — senão seria o relógio da
    // importação de novo.
    const m = desde(v.inicio) ?? (v.bloqueado_em ? desde(v.situacao_em) : null)
    return m == null ? null : { minutos: m, correndo: true, fase: 'EXECUCAO' }
  }
  /*
   * 145: "não sei por qual motivo os contratos recebem um relógio em
   * execução para contratos cancelados, sendo que ninguém foi lá"
   * (Emanuel, 26/10). Tem razão: em cancelado pela central e em
   * desatribuído, `inicio` e `fim` são o horário PLANEJADO que o TOA
   * reservou — contar isso como execução afirma um trabalho que não
   * houve. Sem relógio, que é como a tela diz "não houve".
   */
  if (v.semIda) return null
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
    ? l.doToa
      ? `Deslocamento de ${textoMinutos(l.minutos)}, medido pelo TOA — o mesmo número do painel de Equipes.`
        + ' Não é cronômetro: o contrato entrou em deslocamento pela importação, e a hora dela não é a hora em que o técnico saiu.'
      : `Em deslocamento há ${textoMinutos(l.minutos)}, desde que o campo marcou a saída.`
        + ' O deslocamento não tem meta — a distância na cidade varia demais.'
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
          {l.fase === 'DESLOCAMENTO'
            ? (l.doToa ? 'deslocou' : 'deslocando')
            : l.correndo ? 'executando' : 'execução'}
        </span>
        <span className={`tabular font-semibold ${c.texto}`}>
          {textoMinutos(l.minutos)}
          {temMeta && <span className="font-normal text-graf-500">/{textoMinutos(v.meta!)}</span>}
        </span>
      </span>
    </span>
  )
}
