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
  { ate: 11 * 60, rotulo: 'manhã',  capacidade: 3, vt: 3 },
  { ate: 14 * 60, rotulo: 'meio',   capacidade: 1, vt: 2 },
  { ate: 24 * 60, rotulo: 'tarde',  capacidade: 2, vt: 3 },
] as const

/**
 * A janela que NAO ocupa capacidade.
 *
 * ┌─ por que existe ────────────────────────────────────────────────┐
 * │ > "janela de 08 as 22 horas nao devem entrar nessa caixinha azul │
 * │ >  e um servico que nao e tao importante" -- Emanuel, 15/09      │
 * │                                                                  │
 * │ As janelas de verdade tem 3h (08-11, 11-14, 14-17) ou 4h         │
 * │ (08-12, 12-15, 15-18). A `08h-22h` tem QUATORZE, e nao e uma     │
 * │ janela: e a ausencia de uma -- o TOA marca assim o servico que    │
 * │ pode ser feito a qualquer hora. Desenha-la ocupa a regua inteira  │
 * │ e faz todo turno parecer cheio.                                   │
 * │                                                                   │
 * │ O corte e a maior janela real. No dia 15/09 isso tira duas:       │
 * │ `08h-22h` (14h) e `12h-18h` (6h). A contagem continua ESCRITA     │
 * │ embaixo, com a etiqueta "livre" -- some do desenho, nao do dado.  │
 * └───────────────────────────────────────────────────────────────────┘
 */
const JANELA_LARGA_MIN = 4 * 60

/**
 * A capacidade do turno depende do TIPO de servico.
 *
 * > "se for uma rota inteira de Visita tecnica a capacidade e:
 * >  08 as 11 - 3, 11 as 14 - 2, 14 as 17 - 3" -- Emanuel, 15/09
 *
 * VT e mais rapida que instalacao, entao cabe mais no turno do meio e
 * no da tarde. Aplicado POR JANELA: quando TODA a janela e visita
 * tecnica, vale a tabela da VT; misturou, vale a de instalacao -- que e
 * a mais restritiva, e errar para o lado do alarme e melhor que errar
 * para o lado do silencio.
 *
 * ⚠ O Emanuel falou em "rota inteira". Fazer por janela e uma leitura
 *   minha, mais fina: a capacidade e do TURNO, e o turno pode ser todo
 *   de VT num dia misto. Se ele quiser pelo DIA inteiro, e trocar o
 *   argumento aqui.
 */
function capacidadeDe(turno: typeof TURNOS[number], soVT: boolean) {
  return soVT ? turno.vt : turno.capacidade
}

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
export function FaixaPeriodos({ periodos, jornada }: {
  /** `vt` = quantas daquela janela sao VISITA TECNICA (083). Decide qual
   *  tabela de capacidade vale para a janela. */
  periodos: { janela: string; qtd: number; vt?: number }[] | null
  /** A jornada do dia. Só a REFEIÇÃO é desenhada, como lavagem de fundo
   *  atrás dos blocos — ver `.faixa-dia > .refeicao` em styles.css. */
  jornada?: { tipo: string | null; inicio: string | null; fim: string | null }[] | null
}) {
  if (!periodos?.length) return null

  /** O instante no eixo do dia, em minutos desde a meia-noite. Local,
   *  como o resto da tela: em Manaus o dia vira às 20h em UTC (D-084). */
  const minutoLocal = (ts: string | null): number | null => {
    if (!ts) return null
    const d = new Date(ts)
    return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes()
  }

  const refeicoes = (jornada ?? [])
    .filter(ehRefeicao)
    .flatMap(r => {
      const a = minutoLocal(r.inicio)
      if (a === null) return []
      const b = minutoLocal(r.fim)
      // Sem hora de fim não invento largura: marco só o começo, fino.
      return [{ a, b, aberta: b === null || b <= a }]
    })

  const comHora = periodos.flatMap(p => {
    const a = emMinutos(p.janela.split(/[-–]/)[0])
    if (a === null) return []
    const b = emMinutos(p.janela.split(/[-–]/)[1])
    const t = turnoDe(a)
    // Toda a janela e visita tecnica? Entao vale a capacidade da VT.
    const soVT = (p.vt ?? 0) > 0 && p.vt === p.qtd
    const cap = capacidadeDe(t, soVT)
    // Janela larga nao e janela: e "a qualquer hora". Nao ocupa turno.
    const larga = b !== null && b - a > JANELA_LARGA_MIN
    return [{
      janela: p.janela, qtd: p.qtd, a, b, turno: t, soVT, cap, larga,
      ...(larga
        ? { cor: 'transparent', estouro: false }
        : corDoBloco(p.qtd, cap)),
    }]
  })

  // So as que DISPUTAM turno entram no desenho e no alarme.
  const ocupam = comHora.filter(p => !p.larga)

  // "SEM JANELA" não é 00:00 às 00:00: é atividade que chegou sem hora
  // marcada. Vira etiqueta, não bloco (D-117, a regra do desconhecido).
  // E sem hora não há turno — logo não há capacidade para comparar, e a
  // etiqueta NÃO ganha cor de carga. Não saber não é estar folgado.
  const semJanela = periodos.find(p => emMinutos(p.janela.split(/[-–]/)[0]) === null)

  const estourando = ocupam.filter(p => p.estouro)

  return (
    <div className="min-w-36">
      {comHora.length > 0 && (
        <>
          <div className="faixa-dia"
            title={[
              ...comHora.map(p => p.larga
                ? `${p.janela} (${p.qtd}) · janela livre, não disputa turno`
                : `${p.janela} (${p.qtd}) · turno da ${p.turno.rotulo}, cabem ${
                    p.cap}${p.soVT ? ' (rota de visita técnica)' : ''}${
                    p.estouro ? ` — ${p.qtd - p.cap} acima` : ''}`),
              '',
              'capacidade: 3 na manhã, 1 no meio, 2 na tarde',
              'em rota só de visita técnica: 3, 2, 3',
              'janela maior que 4h é "a qualquer hora" e não ocupa turno',
              // A lavagem amarela não tem rótulo na régua; sem esta linha
              // ela seria uma cor sem nome — e cor sem nome não informa.
              ...(refeicoes.length
                ? ['', 'a faixa amarela é a refeição — fora de contrato']
                : []),
            ].join('\n')}
            aria-hidden>
            {/* a moldura dos turnos vem primeiro: fica ATRÁS dos blocos */}
            {CORTES.map((c, i) => {
              const esq = pct(c)
              const dir = pct(CORTES[i + 1] ?? DIA_ATE)
              return <div key={c} className="turno"
                style={{ left: `${esq}%`, width: `${Math.max(0, dir - esq)}%` }} />
            })}
            {ocupam.map(p => {
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
            {/* ┌─ a refeição é um BLOCO, não um risco por cima ────────┐
                │ > "a linha laranja precisa entrar toda na caixa de     │
                │ >  separação como se fosse uma atividade, não          │
                │ >  sobrepondo a caixa azul" -- Emanuel, 15/09          │
                │                                                        │
                │ Quarta e última posição. Antes era uma barra fina      │
                │ desenhada SOBRE o bloco azul, e lida como enfeite do   │
                │ bloco. Agora tem a mesma altura e a mesma forma dos    │
                │ outros -- é uma atividade na régua, do mesmo tamanho   │
                │ que as outras, ocupando o seu pedaço do dia.           │
                │                                                        │
                │ Vem por último no DOM porque o almoço ACONTECEU: ele   │
                │ não divide a hora com a instalação, ele a tomou.       │
                └────────────────────────────────────────────────────────┘ */}
            {refeicoes.map((r, n) => {
              const esq = pct(r.a)
              const dir = r.aberta ? esq + 1.2 : pct(r.b as number)
              return (
                <div key={n} className="bloco refeicao"
                  style={{ left: `${esq}%`, width: `${Math.max(1.2, dir - esq)}%` }} />
              )
            })}
          </div>
          {/* A régua é um relance; a leitura exata continua escrita.
              Cinco marcas, de 4 em 4 horas, caem exatamente em 0/25/50/
              75/100% — então cada rótulo fica em cima da linha forte que
              ele nomeia, em vez de flutuar entre duas. Com três (06/14/
              22) a metade da manhã não tinha referência nenhuma. */}
          <div className="tabular mt-1 flex justify-between text-[9px] text-graf-500">
            <span>06h</span><span>10h</span><span>14h</span><span>18h</span><span>22h</span>
          </div>
        </>
      )}

      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-graf-400">
        {comHora.slice(0, 4).map(p => (
          <span key={p.janela} className="tabular whitespace-nowrap"
            title={p.larga
              ? `${p.janela}: janela livre — pode ser feito a qualquer hora, então não ocupa turno nem entra no desenho`
              : `turno da ${p.turno.rotulo}: cabem ${p.cap}${
                  p.soVT ? ' (rota de visita técnica)' : ''}`}>
            {p.janela.replace(/\s*[-–]\s*/, '–').replace(/:00/g, 'h')}
            <span className={`ml-0.5 font-semibold ${
              p.estouro ? 'text-af-400' : 'text-graf-600'}`}>{p.qtd}</span>
            {/* A janela larga some do DESENHO, nunca do dado: sem esta
                marca o numero embaixo nao teria bloco em cima e pareceria
                defeito. */}
            {p.larga && <span className="ml-0.5 text-graf-500">livre</span>}
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

// ---------------------------------------------------------------- //

/** Uma situação da equipe no dia: quantos contratos, e quanto isso vale.
 *  Espelha o que a `painel_equipes` devolve em `situacoes` (077). */
export interface SitPontos {
  situacao: string
  qtd: number
  produtivas?: number
  /** NULO = nenhum contrato desta situação achou regra de pontuação.
   *  Não é zero: zero afirmaria que o serviço não vale nada (D-117). */
  pontos?: number | string | null
  sem_regra?: number
}

/** `20,33` — duas casas, vírgula decimal. Duplicado de `lib/formato`
 *  de propósito: este arquivo não importa nada, e é o que o deixa
 *  montável fora da aplicação. */
const n2 = (n: number | string) => Number(n).toFixed(2).replace('.', ',')

/**
 * A composição do dia da equipe — em CONTRATOS e em PONTOS.
 *
 * ┌─ por que o ponto entra ao lado da contagem (077) ────────────────┐
 * │ > "quantos pontos tem cada segmento de status seria muito bom"    │
 * │ >                                              — Emanuel, 15/09   │
 * │                                                                   │
 * │ Seis contratos na entrada podem ser 5,51 pontos ou 0,90: mesma    │
 * │ barra, mesmo "6", faturamento seis vezes diferente. A barra       │
 * │ continua dizendo onde estão os CONTRATOS; o total em cima e a     │
 * │ coluna da direita dizem onde está o DINHEIRO.                     │
 * │                                                                   │
 * │ Virou LISTA, não fila de etiquetas. Com dois números por situação │
 * │ a fila quebrava no meio do par, e o "4" de uma linha encostava    │
 * │ no "3,16" da outra — dois números colados que não se somam.       │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * **Zero e desconhecido não são a mesma coisa** (D-117). Situação em que
 * nenhum contrato achou regra escreve "sem regra", não `0,00`; e quando
 * só PARTE achou, o asterisco diz que a soma não cobre tudo. Somar o que
 * não se sabe como zero é afirmar que o serviço não vale nada — e em
 * 09/09 isso seriam 125 das 364 visitas do dia.
 */
export function SituacaoComPontos({ sits, info }: {
  sits: SitPontos[] | null | undefined
  /** Rótulo e cor por situação — vêm do cadastro (`SITUACAO_INFO`), que
   *  este arquivo não importa para continuar sem dependências. */
  info: Record<string, { label: string; cor: string } | undefined>
}) {
  if (!sits?.length) return <span className="text-graf-600">—</span>

  const lista = [...sits].sort((a, b) => b.qtd - a.qtd)
  const comPonto = lista.filter(s => s.pontos != null)
  const total = comPonto.length
    ? comPonto.reduce((t, s) => t + Number(s.pontos), 0) : null
  const semRegra = lista.reduce((t, s) => t + (s.sem_regra ?? 0), 0)

  return (
    <div className="min-w-52 max-w-72 space-y-1.5">
      {/* o total, em cima da barra */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wide text-graf-500">no dia</span>
        <span className="text-[10px]">
          {total != null ? (
            <>
              <span className="tabular text-xs font-semibold text-graf-100">{n2(total)}</span>
              <span className="text-graf-500"> pts</span>
            </>
          ) : (
            <span className="text-graf-500">sem regra de pontuação</span>
          )}
          {semRegra > 0 && (
            <span className="ml-1 text-amber-400"
              title={semRegra + ' contrato(s) produtivo(s) sem regra de pontuação. Ficam FORA da soma — não valem zero, não sabemos quanto valem (D-117).'}>
              +{semRegra} s/ regra
            </span>
          )}
        </span>
      </div>

      <BarraComposicao fatias={lista.map(s => ({
        chave: s.situacao,
        rotulo: info[s.situacao]?.label ?? s.situacao,
        cor: info[s.situacao]?.cor ?? '#64748b',
        qtd: s.qtd,
      }))} />

      <div className="space-y-px">
        {lista.map(s => (
          <div key={s.situacao} className="flex items-center gap-1.5 text-[10px]">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: info[s.situacao]?.cor ?? '#64748b' }} />
            <span className="truncate text-graf-400">
              {(info[s.situacao]?.label ?? s.situacao).toLowerCase()}
            </span>
            <span className="tabular ml-auto w-6 shrink-0 text-right font-semibold text-graf-200">
              {s.qtd}
            </span>
            <span className="tabular w-16 shrink-0 text-right">
              {s.pontos != null ? (
                <span className="text-emerald-400"
                  title={s.sem_regra
                    ? n2(s.pontos) + ' pts · ' + s.sem_regra
                      + ' contrato(s) desta situação sem regra, fora da conta'
                    : n2(s.pontos) + ' pts'}>
                  {n2(s.pontos)}
                  {!!s.sem_regra && <span className="text-amber-400">*</span>}
                </span>
              ) : (
                /* graf-600 dava 2,04:1 no tema claro -- medido com o
                   proprio motor do navegador, nao com regex (traps.md).
                   "sem regra" NAO e enfeite: e a afirmacao de que nao
                   sabemos, e informacao ilegivel e informacao escondida. */
                <span className="text-graf-400"
                  title="Nenhum contrato desta situação achou regra de pontuação. Não é zero — é desconhecido (D-117).">
                  sem regra
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- //

export interface ItemJornada {
  tipo: string | null
  situacao: string
  inicio: string | null
  fim: string | null
  /** Nulo quando falta uma das pontas. Duração desconhecida não é zero. */
  minutos: number | null
}

/** `132` → `2h12`. Minuto cru acima de uma hora não se lê. */
function duracao(min: number | null): string {
  if (min == null) return '?'
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

const horaDe = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '?'

/**
 * A refeição, entre as atividades de jornada.
 *
 * ┌─ por que só ela aparece ─────────────────────────────────────────┐
 * │ > "o na base e fora de contrato vamos tirar esses nomes, vamos    │
 * │ >  deixar o refeição" — Emanuel, 15/09                            │
 * │                                                                   │
 * │ `Na Base` dura 1, 7 e 11 minutos nos três técnicos do dia — é     │
 * │ registro, não é o que explica um buraco na agenda. A refeição de  │
 * │ duas horas é. As duas continuam no BANCO (a 078 as trouxe de      │
 * │ propósito); só a que informa ocupa a tela.                        │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * O nome vem do TOA e é o do catálogo (`Refeicao`, sem acento). Comparo
 * sem acento e sem caixa porque o TOA já mostrou variar nos dois — os
 * códigos de baixa chegam como `409 - Servico Concluido` e `409 -
 * SERVICO CONCLUIDO` (traps.md).
 */
function ehRefeicao(i: { tipo: string | null }): boolean {
  return (i.tipo ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase() === 'REFEICAO'
}

/**
 * O que o técnico fez FORA de contrato.
 *
 * ┌─ por que isto aparece, e por que aparece SEPARADO ───────────────┐
 * │ > "é bom entrar no banco, pra gente saber de fato por que o       │
 * │ >  técnico está parado [...] porém não pode contar como um        │
 * │ >  contrato que soma na produtividade" — Emanuel, 15/09           │
 * │                                                                   │
 * │ A Refeição das 12:26 às 14:26 é o que explica o buraco de duas    │
 * │ horas entre um contrato e o seguinte. Sem ela na tela, o          │
 * │ controlador vê a equipe sumir e não sabe se foi almoço ou         │
 * │ problema.                                                         │
 * │                                                                   │
 * │ Mas ela fica ABAIXO da régua de períodos, não dentro: a régua     │
 * │ mede capacidade de turno, e uma Refeição ocupando vaga de         │
 * │ instalação diria que o turno está cheio quando não está. Ver      │
 * │ D-149.                                                            │
 * └───────────────────────────────────────────────────────────────────┘
 */
export function FaixaJornada({ itens }: { itens: ItemJornada[] | null | undefined }) {
  const refeicoes = (itens ?? []).filter(ehRefeicao)
  if (!refeicoes.length) return null

  const total = refeicoes.reduce((s, i) => s + (i.minutos ?? 0), 0)
  const semMedida = refeicoes.some(i => i.minutos == null)

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
      {refeicoes.map((i, n) => (
        <span key={n} className="inline-flex items-center gap-1 rounded bg-graf-800 px-1.5 py-px"
          title={`Refeição · ${horaDe(i.inicio)}–${horaDe(i.fim)} · fora de contrato, não conta em produtividade`}>
          <span className="text-graf-300">Refeição</span>
          {/* graf-400 sobre graf-800 dava 4,35:1 no escuro -- 0,15 abaixo
              da AA para texto de 10px. O horario e a informacao, nao a
              moldura. */}
          <span className="tabular text-graf-300">
            {horaDe(i.inicio)}–{horaDe(i.fim)}
          </span>
          <span className="tabular font-semibold text-graf-300">{duracao(i.minutos)}</span>
        </span>
      ))}
      {/* O total só aparece quando há MAIS DE UMA: com uma só ele repete
          a duração que está dois centímetros à esquerda. */}
      {refeicoes.length > 1 && (
        <span className="tabular text-graf-400"
          title={semMedida
            ? 'Soma do que tem as duas pontas medidas — há refeição sem hora completa'
            : 'Tempo total de refeição no dia'}>
          {duracao(total)} no total{semMedida && ' (+ sem medida)'}
        </span>
      )}
    </div>
  )
}
