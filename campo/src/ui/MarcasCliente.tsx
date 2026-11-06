import { StyleSheet, Text, View } from 'react-native'
import { cor } from './tema'
import { LOG_GRAVE, lerLog } from '../lib/log'

/**
 * Os sinais do contrato que o controlador já vê na central (123, 124):
 * ouvidoria, segmento do cliente e TEC1. Cópia DECLARADA de
 * `app/src/components/MarcasCliente.tsx` e das etiquetas de TEC1 da
 * `TabelaContratos` — mudou lá, mude aqui (D-112).
 *
 * > "a sinalização de ouvidoria técnico tem que visualizar também, e na
 * >  tela principal de cada contrato podemos colocar se perdeu tec1 ou
 * >  não" — Emanuel, 21/10
 *
 * ┌─ por que assim ───────────────────────────────────────────────────┐
 * │ Ouvidoria é EXCEÇÃO (1 em 468 em 21/10): etiqueta preta sólida, a │
 * │ coisa mais escura do cartão, e só quando é. "Não" e "não sei"     │
 * │ (nulo) não desenham nada.                                         │
 * │                                                                   │
 * │ Segmento é contexto: etiqueta clara com bolinha, o nome como o    │
 * │ TOA mandou (PME, PURPLE PME PF…). BLACK é bolinha preta num       │
 * │ contorno, para não se confundir com a ouvidoria.                  │
 * │                                                                   │
 * │ TEC1 nulo = o TOA ainda não encerrou; a regra não se aplica e não │
 * │ se desenha nada — não é "no padrão" (regra 6).                    │
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

export function SeloOuvidoria({ ouvidoria }: { ouvidoria?: boolean | null }) {
  if (!ouvidoria) return null
  return (
    <View style={[e.selo, e.ouvidoria]} accessibilityLabel="Caso crítico de ouvidoria">
      <Text style={e.ouvidoriaTexto}>● OUVIDORIA</Text>
    </View>
  )
}

export function SeloSegmento({ segmento }: { segmento?: string | null }) {
  if (!segmento) return null
  const sem = segmento === 'SEM SEGMENTO'
  const bolinha = COR_SEGMENTO[segmento] ?? (segmento.includes('PURPLE') ? '#7c3aed' : null)
  return (
    <View style={[e.selo, e.segmento]} accessibilityLabel={`Segmento do cliente: ${segmento}`}>
      {!!bolinha && <View style={[e.bolinha, { backgroundColor: bolinha }]} />}
      <Text style={[e.segmentoTexto, sem && { color: cor.graf500 }]}>
        {sem ? 'sem segmento' : segmento}
      </Text>
    </View>
  )
}

const TEC1: Record<string, { texto: string; fundo: string; tinta: string }> = {
  PADRAO: { texto: 'TEC1 no padrão', fundo: cor.verde50, tinta: cor.verde900 },
  SEM_PADRAO: { texto: 'Perdeu TEC1', fundo: cor.af100, tinta: cor.af700 },
  EXPURGADA: { texto: 'TEC1 fora do cálculo', fundo: cor.graf50, tinta: cor.graf500 },
}

export function SeloTec1({ tec1 }: { tec1?: string | null }) {
  const t = tec1 ? TEC1[tec1] : undefined
  if (!t) return null
  return (
    <View style={[e.selo, { backgroundColor: t.fundo }]}>
      <Text style={[e.seloTexto, { color: t.tinta }]}>{t.texto}</Text>
    </View>
  )
}

/**
 * Prédio ou casa, e o vai-e-volta da revisita — como o TOA mostra (174,
 * D-261). Quem decide é o banco (`sinais_das_visitas`); aqui só desenha.
 * No app vai com a PALAVRA ao lado do desenho: no sol, um ícone sozinho
 * pequeno não se lê.
 */
export function SeloEdificacao({ edificacao }: { edificacao?: 'PREDIO' | 'CASA' | null }) {
  if (!edificacao) return null
  return (
    <View style={[e.selo, e.segmento]} accessibilityLabel={edificacao === 'PREDIO' ? 'Prédio' : 'Casa'}>
      <Text style={[e.seloTexto, { color: cor.graf600 }]}>{edificacao === 'PREDIO' ? '🏢 Prédio' : '🏠 Casa'}</Text>
    </View>
  )
}
export function SeloRevisita({ revisita, motivo }: { revisita?: boolean; motivo?: string | null }) {
  if (!revisita) return null
  const texto = motivo === 'VT_DA_VT' ? 'VT da VT'
    : motivo === 'RETORNO_DO_RETORNO' ? 'Retorno do retorno' : 'Revisita'
  return (
    <View style={[e.selo, { backgroundColor: '#f97316' }]} accessibilityLabel={`Revisita: ${texto}`}>
      <Text style={[e.seloTexto, { color: cor.branco }]}>🔁 {texto}</Text>
    </View>
  )
}

/** O que `sinais_das_visitas` devolve (174, D-261) — o mesmo tipo da web
 *  (`SinalContrato` em app/src/components/SinaisContrato.tsx). */
export interface SinalContrato {
  visita_id: string
  edificacao: 'PREDIO' | 'CASA' | null
  revisita: boolean
  revisita_motivo: string | null
  anterior_data?: string | null
  anterior_situacao?: string | null
  anterior_grupo?: string | null
}

const MOTIVO_REVISITA: Record<string, string> = {
  VT_DA_VT: 'VT da VT',
  RETORNO_DO_RETORNO: 'retorno do retorno',
}
const SITUACAO_ANTERIOR: Record<string, string> = {
  ENTRADA: 'na entrada', ATRIBUIDA: 'atribuída', EM_DESLOCAMENTO: 'em deslocamento',
  EM_EXECUCAO: 'em execução', CONCLUIDA: 'concluída', CANCELADA: 'cancelada',
  REAGENDAMENTO: 'reagendada', COM_IMPEDIMENTO: 'com ticket',
}

/** O texto que a web põe na dica do vai-e-volta (`textoRevisita`). No
 *  celular não há "passar o mouse": no contrato ele vai escrito. */
export function textoRevisita(s: SinalContrato): string {
  const quando = s.anterior_data ? s.anterior_data.split('-').reverse().join('/') : '?'
  // 211: DE_OUTRO_GRUPO (Adesão → VT…) — o grupo anterior É o motivo, então
  // vai no lugar dele, e não se repete depois da data.
  const outro = s.revisita_motivo === 'DE_OUTRO_GRUPO'
  const motivo = outro
    ? `voltou depois de ${s.anterior_grupo ?? 'outro serviço'}`
    : MOTIVO_REVISITA[s.revisita_motivo ?? ''] ?? 'voltou'
  return `Revisita: ${motivo} — anterior em ${quando}`
    + (s.anterior_grupo && !outro ? `, ${s.anterior_grupo}` : '')
    + (s.anterior_situacao
      ? ` (${SITUACAO_ANTERIOR[s.anterior_situacao] ?? s.anterior_situacao.toLowerCase()})` : '')
}

/**
 * O LOG do contrato (144): quantas vezes voltou para a agenda, pela conta
 * do TOA. Cópia DECLARADA de `app/src/components/SeloLog.tsx`.
 *
 * ┌─ três desenhos, como na web ──────────────────────────────────────┐
 * │ nulo     → "log ?": a linha do TOA não trouxe a coluna. Não é 0.  │
 * │ 0 a 2    → cinza, contexto.                                       │
 * │ 3 ou +   → PRETO ("de 3 pra cima já precisa ficar preto",         │
 * │            Emanuel, 26/10), com borda âmbar — a mesma da web, e   │
 * │            é o que separa do selo preto da OUVIDORIA.             │
 * └───────────────────────────────────────────────────────────────────┘
 */
export function SeloLog({ valor }: { valor?: string | number | null }) {
  const n = lerLog(valor)
  if (n == null) {
    return (
      <View style={[e.selo, e.logNeutro]}
        accessibilityLabel="LOG desconhecido: a planilha do TOA não trouxe o contador de log">
        <Text style={[e.seloTexto, { color: cor.graf500, fontWeight: '600' }]}>log ?</Text>
      </View>
    )
  }
  const dica = n === 0
    ? 'LOG 0: primeira ida, o contrato nunca voltou para a agenda'
    : `LOG ${n}: o contrato já voltou ${n} ${n === 1 ? 'vez' : 'vezes'} para a agenda, pela contagem do TOA`
  if (n >= LOG_GRAVE) {
    return (
      <View style={[e.selo, e.logGrave]} accessibilityLabel={dica}>
        <Text style={[e.seloTexto, { color: cor.branco, fontWeight: '800' }]}>LOG {n}</Text>
      </View>
    )
  }
  return (
    <View style={[e.selo, e.logNeutro]} accessibilityLabel={dica}>
      <Text style={[e.seloTexto, { color: cor.graf600 }]}>LOG {n}</Text>
    </View>
  )
}

/**
 * Um marcador do contrato (`visita_marcador` + `indicador_qualidade`).
 * `ordem` é a do cadastro — a mesma ordem da lista do site.
 */
export interface MarcaDoContrato {
  nome: string
  observacao: string | null
  ordem: number
}

/** O `select` de `visita_marcador` que as duas telas usam — só os do
 *  cadastro ATIVO, como a web (TabelaContratos só desenha os ativos). */
export const SELECT_MARCADOR = 'visita_id, observacao, indicador_qualidade!inner(nome, ordem, ativo)'

/** Como o PostgREST devolve `visita_marcador` com o indicador embutido. */
export interface LinhaMarcador {
  visita_id: string
  observacao: string | null
  indicador_qualidade: { nome: string; ordem: number | null } | null
}

/** Por contrato, na ordem do cadastro (a mesma da lista do site). Um nome
 *  repetido no mesmo contrato sai uma vez só. */
export function agruparMarcas(linhas: LinhaMarcador[]): Map<string, MarcaDoContrato[]> {
  const m = new Map<string, MarcaDoContrato[]>()
  for (const x of linhas) {
    const nome = x.indicador_qualidade?.nome
    if (!nome) continue
    const lista = m.get(x.visita_id) ?? []
    if (!lista.some(y => y.nome === nome)) {
      lista.push({ nome, observacao: x.observacao, ordem: x.indicador_qualidade?.ordem ?? 999 })
    }
    m.set(x.visita_id, lista)
  }
  for (const lista of m.values()) lista.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
  return m
}

/**
 * ┌─ as cores dos marcadores ─────────────────────────────────────────┐
 * │ As da web (TabelaContratos), passadas para o tema claro do campo: │
 * │ REV D-10 vermelho suave ("vamos pintar esse marcador de vermelho  │
 * │ suave", 03/11); OUVIDORIA preta ("sobe na cor preta", 03/11);     │
 * │ CLIENTE ATIVADO azul claro e FP2 laranja claro (D-297, 04/11).    │
 * │ Todo marcador que o cadastro tiver e não estiver aqui sai NEUTRO  │
 * │ (cinza) — o técnico vê TODOS (Emanuel, 05/11), e marcador novo     │
 * │ cadastrado no site aparece sozinho, sem versão nova do app. A cor │
 * │ dele é decisão do Emanuel, não nossa: entra aqui E na web.        │
 * └───────────────────────────────────────────────────────────────────┘
 */
export const MARCADORES_COR: Record<string, { fundo: string; borda: string; texto: string }> = {
  'REV D-10': { fundo: cor.af100, borda: cor.af500, texto: cor.af700 },
  OUVIDORIA: { fundo: cor.tinta, borda: cor.tinta, texto: cor.branco },
  'CLIENTE ATIVADO': { fundo: '#bae6fd', borda: '#38bdf8', texto: '#075985' },
  FP2: { fundo: '#fed7aa', borda: '#fb923c', texto: '#9a3412' },
}
const COR_NEUTRA = { fundo: cor.graf100, borda: cor.graf300, texto: cor.graf600 }

/** Os marcadores manuais "LOG 1" a "LOG 6" (211) seguem a regra do selo de
 *  LOG: de 3 para cima, preto com borda âmbar; abaixo, o neutro. */
const MARCADOR_LOG = /^LOG\s+(\d+)$/i
const COR_LOG_GRAVE = { fundo: '#000000', borda: cor.ambar, texto: cor.branco }

export function corDoMarcador(nome: string) {
  const conhecida = MARCADORES_COR[nome]
  if (conhecida) return conhecida
  const log = MARCADOR_LOG.exec(nome.trim())
  if (log && Number(log[1]) >= LOG_GRAVE) return COR_LOG_GRAVE
  return COR_NEUTRA
}

export function SeloMarcador({ nome }: { nome: string }) {
  const c = corDoMarcador(nome)
  return (
    <View style={[e.selo, { backgroundColor: c.fundo, borderWidth: 1, borderColor: c.borda }]}
      accessibilityLabel={`Marcador ${nome}`}>
      <Text style={[e.seloTexto, e.marcadorTexto, { color: c.texto }]}>{nome}</Text>
    </View>
  )
}

/** Os marcadores lado a lado (a agenda, compacto). `sem` tira os que a tela
 *  já desenha de outro jeito — a OUVIDORIA do site vira o MESMO selo preto
 *  do caso crítico do TOA (200), e não pode sair duas vezes. */
export function SelosMarcadores({ marcas, sem }: { marcas?: MarcaDoContrato[]; sem?: string[] }) {
  const lista = (marcas ?? []).filter(m => !sem?.includes(m.nome))
  if (!lista.length) return null
  return (
    <>
      {lista.map(m => <SeloMarcador key={m.nome} nome={m.nome} />)}
    </>
  )
}

/**
 * Os marcadores no contrato, completo: o selo e, embaixo, a observação de
 * quem marcou (ex.: o REV D-10 automático diz a visita anterior). Sem
 * observação, só o selo — não se escreve "sem observação" para cada um.
 * `semObs` tira a observação que a tela já mostra em outro lugar.
 */
export function ListaMarcadores({ marcas, semObs }: { marcas: MarcaDoContrato[]; semObs?: string[] }) {
  if (!marcas.length) return null
  return (
    <View style={e.lista} accessibilityLabel={`${marcas.length} marcador(es) no contrato`}>
      <Text style={e.listaTitulo}>Marcadores do contrato</Text>
      {marcas.map(m => (
        <View key={m.nome} style={e.listaLinha}>
          <View style={{ flexDirection: 'row' }}><SeloMarcador nome={m.nome} /></View>
          {!!m.observacao && !semObs?.includes(m.nome) && (
            <Text style={e.listaObs} selectable>{m.observacao}</Text>
          )}
        </View>
      ))}
    </View>
  )
}

const e = StyleSheet.create({
  selo: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  seloTexto: { fontSize: 12, fontWeight: '700' },
  ouvidoria: { backgroundColor: cor.tinta },
  ouvidoriaTexto: { fontSize: 12, fontWeight: '800', color: cor.branco, letterSpacing: 0.5 },
  segmento: { borderWidth: 1, borderColor: cor.graf200, backgroundColor: cor.branco },
  segmentoTexto: { fontSize: 12, fontWeight: '700', color: cor.graf600 },
  logNeutro: { borderWidth: 1, borderColor: cor.graf200, backgroundColor: cor.graf50 },
  logGrave: { backgroundColor: '#000000', borderWidth: 1.5, borderColor: cor.ambar },
  marcadorTexto: { textTransform: 'uppercase', letterSpacing: 0.3 },
  lista: {
    gap: 10, padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: cor.graf100, backgroundColor: cor.branco,
  },
  listaTitulo: { fontSize: 13, fontWeight: '700', color: cor.graf600 },
  listaLinha: { gap: 4 },
  listaObs: { fontSize: 14, lineHeight: 20, color: cor.graf600 },
  bolinha: {
    width: 8, height: 8, borderRadius: 4,
    borderWidth: 1, borderColor: 'rgba(124,134,154,0.7)',
  },
})
