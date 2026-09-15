/**
 * Telemetria — as peças que mostram PROPORÇÃO e TEMPO.
 *
 * ┌─ por que existe ────────────────────────────────────────────────┐
 * │ O painel do concorrente conta em texto: "08:00 - 11:00 (20)",   │
 * │ dez vezes, empilhado; e "CONCLUÍDA (163) · CANCELADA (17)" numa │
 * │ fila de etiquetas do mesmo tamanho. Os dois escondem a mesma     │
 * │ coisa: a PROPORÇÃO. 163 e 17 lidos em etiquetas iguais parecem   │
 * │ vizinhos, e a manhã lotada com a tarde vazia parecem uma lista.  │
 * │                                                                  │
 * │ Aqui o número continua escrito — ninguém deve MEDIR num desenho  │
 * │ de 8 pixels. O desenho responde à pergunta anterior: onde olhar. │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Regra que vale para as três peças: **zero e desconhecido não são a
 * mesma coisa**. Sem janela não é janela de largura zero — é ausência,
 * e sai escrito.
 */

/** O eixo do dia. Fora daqui a operação não anda, e esticar até 00:00
 *  espremeria as 16 horas que importam em metade da régua. */
const DIA_DE = 6 * 60
const DIA_ATE = 22 * 60
const DIA = DIA_ATE - DIA_DE

/** "08:00", "08:00:00" → minutos desde a meia-noite. */
function emMinutos(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Onde o instante cai na régua, em %. Fora do eixo, encosta na borda —
 *  e quem chama decide se ainda faz sentido desenhar. */
function pct(min: number): number {
  return Math.min(100, Math.max(0, ((min - DIA_DE) / DIA) * 100))
}

// ---------------------------------------------------------------- //

/**
 * A janela do contrato, e onde o encerramento caiu dentro dela.
 *
 * Só o texto "08:00–12:00 / encerrou 09:48" obriga a fazer a conta de
 * cabeça, contrato por contrato, para saber se sobrou folga ou se
 * estourou. O risco vertical responde antes da conta.
 *
 * A COR do risco não é opinião nossa: é o TEC1 que o servidor calculou
 * (D-099). Sem TEC1, risco cinza — não sabemos, e dizemos.
 */
export function FaixaJanela({ inicio, fim, encerrou, tec1 }: {
  inicio: string | null
  fim: string | null
  /** Hora do encerramento (HH:MM). Só passe quando `finalizado_toa`
   *  for verdadeiro: `visita.fim` vem preenchido mesmo em atividade só
   *  iniciada, e o risco diria que fechou quem não fechou (D-103). */
  encerrou?: string | null
  tec1?: 'PADRAO' | 'SEM_PADRAO' | 'EXPURGADA' | null
}) {
  const a = emMinutos(inicio)
  const b = emMinutos(fim)
  // Sem janela não há régua. A ausência já está escrita em cima.
  if (a === null) return null

  const esq = pct(a)
  const dir = b !== null && b > a ? pct(b) : esq + 2
  const e = emMinutos(encerrou)

  const corRisco = tec1 === 'PADRAO' ? 'var(--st-concluida)'
    : tec1 === 'SEM_PADRAO' ? 'var(--st-conflito)'
    : 'var(--color-graf-400)'

  const titulo = [
    `Janela ${(inicio ?? '').slice(0, 5)}${fim ? `–${fim.slice(0, 5)}` : ''}`,
    encerrou ? `encerrou ${encerrou}` : null,
    tec1 === 'PADRAO' ? 'dentro do padrão TEC1'
      : tec1 === 'SEM_PADRAO' ? 'fora do padrão TEC1'
      : tec1 === 'EXPURGADA' ? 'expurgada do TEC1' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="faixa-dia mt-1 w-24" title={titulo} aria-hidden>
      <div className="bloco"
        style={{ left: `${esq}%`, width: `${Math.max(2, dir - esq)}%`,
                 ['--bloco-cor' as string]: 'color-mix(in srgb, var(--color-graf-400) 55%, transparent)' }} />
      {e !== null && (
        <div className="risco"
          style={{ left: `calc(${pct(e)}% - 1px)`, ['--risco-cor' as string]: corRisco }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- //

/**
 * A capacidade de um turno, em contratos.
 *
 * ┌─ de onde saiu ───────────────────────────────────────────────────┐
 * │ > "é a capacidade da janela: o técnico consegue fazer 3 execuções │
 * │ >  de 08 às 12, 1 de 12 às 15 e 2 de 15 às 18. Se tiver           │
 * │ >  manutenção, que fica no horário 08 às 11, 11 às 14 e 14 às 17, │
 * │ >  tem que considerar como se fosse um contrato da instalação     │
 * │ >  normal" — Emanuel, 14/09                                       │
 * │                                                                   │
 * │ São **dois** calendários de janela — instalação e manutenção —    │
 * │ e a última frase é a que resolve: eles não são dois orçamentos,   │
 * │ são o MESMO turno chamado de dois jeitos. Então a faixa não é     │
 * │ pelo par início–fim (seriam seis regras que divergem), é pelo     │
 * │ **início** da janela:                                             │
 * │                                                                   │
 * │      começa antes das 11h  →  turno da manhã   →  3               │
 * │      começa 11h–14h        →  turno do meio    →  1               │
 * │      começa 14h em diante  →  turno da tarde   →  2               │
 * │                                                                   │
 * │ 08–12 e 08–11 caem no primeiro; 12–15 e 11–14 no segundo;         │
 * │ 15–18 e 14–17 no terceiro. Um só corte serve aos dois.            │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Isto é **média padrão**, não regra da CLARO: serve para a régua
 * apontar onde olhar, não para cobrar ninguém. Se a média mudar por
 * praça, este é o único lugar a mexer — e aí vira cadastro, não
 * constante.
 */
const TURNOS = [
  { ate: 11 * 60, rotulo: 'manhã',  capacidade: 3 },
  { ate: 14 * 60, rotulo: 'meio',   capacidade: 1 },
  { ate: 24 * 60, rotulo: 'tarde',  capacidade: 2 },
] as const

/** O turno em que a janela começa. Nunca devolve nulo: toda janela com
 *  hora cai em algum turno — o que não tem hora nem chega aqui. */
function turnoDe(inicio: number) {
  return TURNOS.find(t => inicio < t.ate) ?? TURNOS[TURNOS.length - 1]
}

/** Onde ficam os cortes dos turnos na régua, para desenhar a moldura. */
const CORTES = [11 * 60, 14 * 60]

/**
 * A cor de um bloco de janela, pela ocupação do turno.
 *
 * Até a capacidade a cor é o AZUL da execução, e o que varia é a
 * intensidade — cheio é sólido, quase vazio é fantasma. Passou da
 * capacidade, a cor sai do azul: âmbar logo acima, vermelho do conflito
 * ao dobro. Não é enfeite — é a mesma rampa que a tela inteira usa para
 * dizer "atenção" e "isto está errado".
 */
function corDoBloco(qtd: number, capacidade: number): { cor: string; estouro: boolean } {
  const razao = qtd / capacidade
  if (razao <= 1) {
    return {
      cor: `color-mix(in srgb, var(--st-execucao) ${
        Math.round(38 + 52 * razao)}%, transparent)`,
      estouro: false,
    }
  }
  // 1 → âmbar; 2 ou mais → vermelho. Entre os dois, o caminho.
  const excesso = Math.min(1, razao - 1)
  return {
    cor: `color-mix(in srgb, var(--st-conflito) ${
      Math.round(100 * excesso)}%, var(--st-reagendamento))`,
    estouro: true,
  }
}

/**
 * Os períodos da equipe no dia, numa régua só.
 *
 * A cor do bloco responde **"cabe?"**, não "é muito?": ela compara a
 * quantidade daquela janela com a capacidade do TURNO em que a janela
 * começa (ver `TURNOS`). Antes a intensidade era relativa à maior
 * janela da própria equipe — uma equipe com 1, 1 e 2 contratos pintava
 * o 2 de azul sólido como se fosse muito, e uma com 9 pintava o 3 de
 * fantasma. Comparação sem referência não responde nada.
 *
 * O número exato continua escrito embaixo: ninguém deve MEDIR num
 * desenho de 8 pixels.
 */
export function FaixaPeriodos({ periodos }: {
  periodos: { janela: string; qtd: number }[] | null
}) {
  if (!periodos?.length) return null

  const comHora = periodos.flatMap(p => {
    const a = emMinutos(p.janela.split(/[-–]/)[0])
    if (a === null) return []
    const t = turnoDe(a)
    return [{
      janela: p.janela, qtd: p.qtd, a,
      b: emMinutos(p.janela.split(/[-–]/)[1]),
      turno: t, ...corDoBloco(p.qtd, t.capacidade),
    }]
  })

  // "SEM JANELA" não é 00:00 às 00:00: é atividade que chegou sem hora
  // marcada. Vira etiqueta, não bloco (D-117, a regra do desconhecido).
  // E sem hora não há turno — logo não há capacidade para comparar, e a
  // etiqueta NÃO ganha cor de carga. Não saber não é estar folgado.
  const semJanela = periodos.find(p => emMinutos(p.janela.split(/[-–]/)[0]) === null)

  const estourando = comHora.filter(p => p.estouro)

  return (
    <div className="min-w-36">
      {comHora.length > 0 && (
        <>
          <div className="faixa-dia"
            title={[
              ...comHora.map(p => `${p.janela} (${p.qtd}) · turno da ${
                p.turno.rotulo}, cabem ${p.turno.capacidade}${
                p.estouro ? ` — ${p.qtd - p.turno.capacidade} acima` : ''}`),
              '',
              'capacidade: 3 no turno da manhã, 1 no do meio, 2 no da tarde',
            ].join('\n')}
            aria-hidden>
            {/* a moldura dos turnos vem primeiro: fica ATRÁS dos blocos */}
            {CORTES.map((c, i) => {
              const esq = pct(c)
              const dir = pct(CORTES[i + 1] ?? DIA_ATE)
              return <div key={c} className="turno"
                style={{ left: `${esq}%`, width: `${Math.max(0, dir - esq)}%` }} />
            })}
            {comHora.map(p => {
              const esq = pct(p.a)
              const dir = p.b !== null && p.b > p.a ? pct(p.b) : esq + 3
              return (
                <div key={p.janela} className="bloco"
                  data-estouro={p.estouro ? '1' : '0'}
                  style={{
                    left: `${esq}%`, width: `${Math.max(2, dir - esq)}%`,
                    ['--bloco-cor' as string]: p.cor,
                  }} />
              )
            })}
          </div>
          {/* A régua é um relance; a leitura exata continua escrita. */}
          <div className="tabular mt-1 flex justify-between text-[9px] text-graf-600">
            <span>06h</span><span>14h</span><span>22h</span>
          </div>
        </>
      )}

      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-graf-400">
        {comHora.slice(0, 4).map(p => (
          <span key={p.janela} className="tabular whitespace-nowrap"
            title={`turno da ${p.turno.rotulo}: cabem ${p.turno.capacidade}`}>
            {p.janela.replace(/\s*[-–]\s*/, '–').replace(/:00/g, 'h')}
            <span className={`ml-0.5 font-semibold ${
              p.estouro ? 'text-af-400' : 'text-graf-600'}`}>{p.qtd}</span>
          </span>
        ))}
        {comHora.length > 4 && (
          <span className="text-graf-600"
            title={comHora.slice(4).map(p => `${p.janela} (${p.qtd})`).join('\n')}>
            +{comHora.length - 4} janelas
          </span>
        )}
        {semJanela && (
          <span className="text-amber-400" title="Chegaram do TOA sem hora marcada">
            sem janela {semJanela.qtd}
          </span>
        )}
      </div>

      {/* O que a cor está dizendo, escrito. A barra sozinha obrigaria a
          decorar a tabela de capacidade. */}
      {estourando.length > 0 && (
        <p className="mt-0.5 text-[10px] text-af-400"
          title={estourando.map(p => `${p.janela}: ${p.qtd} para ${
            p.turno.capacidade} de capacidade`).join('\n')}>
          {estourando.length === 1
            ? `${estourando[0].janela.replace(/\s*[-–]\s*/, '–').replace(/:00/g, 'h')
               } acima da capacidade (${estourando[0].qtd} para ${
               estourando[0].turno.capacidade})`
            : `${estourando.length} janelas acima da capacidade`}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- //

export interface Fatia { chave: string; rotulo: string; cor: string; qtd: number }

/**
 * A composição de um conjunto de contratos, em uma barra.
 *
 * Decorativa DE PROPÓSITO (`aria-hidden`): quem filtra são os botões
 * ao lado, que têm nome e contagem em texto. Uma barra que também
 * filtrasse seria o mesmo comando duas vezes na mesma tela — e a fatia
 * de 5% é alvo de clique ruim para qualquer um, com ou sem mouse.
 */
export function BarraComposicao({ fatias, ativa }: {
  fatias: Fatia[]
  /** Situação filtrada agora: as outras fatias apagam. */
  ativa?: string | null
}) {
  const total = fatias.reduce((s, f) => s + f.qtd, 0)
  if (total === 0) return null
  return (
    <div className="mistura" aria-hidden
      title={fatias.filter(f => f.qtd > 0)
        .map(f => `${f.rotulo}: ${f.qtd} (${Math.round(100 * f.qtd / total)}%)`)
        .join('\n')}>
      {fatias.filter(f => f.qtd > 0).map(f => (
        <span key={f.chave}
          data-apagada={ativa && ativa !== f.chave ? '1' : '0'}
          style={{ flex: `${f.qtd} 0 0`, ['--fatia-cor' as string]: f.cor }} />
      ))}
    </div>
  )
}
