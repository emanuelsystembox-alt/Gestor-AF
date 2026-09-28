import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Pressable, Alert, RefreshControl, Modal, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { aparelhoProtegido, autenticarNoAparelho, conferirSenha, type Metodo } from '../lib/aceite'
import { Botao, Cartao, Aviso, Vazio, Carregando } from '../ui/componentes'
import { cor, raio, TOQUE } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * Meus romaneios — o recibo do que o técnico recebeu e devolveu.
 *
 * ┌─ POR QUE ESTA TELA EXISTE ───────────────────────────────────────┐
 * │ > "o almoxarife monta a carga […] e o TÉCNICO CONFIRMA"          │
 * │ >  — Emanuel                                                      │
 * │                                                                   │
 * │ Na fase 2 quem confirmava era o almoxarife, no balcão, porque o   │
 * │ aplicativo não tinha onde. Confirmar no lugar de alguém é assinar │
 * │ por ele — funciona enquanto os dois estão frente a frente e       │
 * │ deixa de funcionar no dia da divergência, que é justamente o dia  │
 * │ em que o documento importa.                                       │
 * │                                                                   │
 * │ Aqui o técnico lê o que está saindo na mão dele e confirma com o  │
 * │ próprio dedo. `confirmado_por` passa a ser ele (079).             │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * A tela é de LEITURA e um botão. O técnico não monta carga, não tira
 * item, não corrige quantidade — se algo está errado, ele fala com o
 * almoxarife, que é quem tem o documento aberto do outro lado. Dar
 * edição aqui seria transformar o recibo em negociação.
 */

type Props = NativeStackScreenProps<Pilha, 'Romaneios'>

interface Peca { serial: string; tipo: string | null; modelo: string | null }
interface ItemMisc { nome: string; codigo: string; unidade: string; qtd: number }
/** O que está na mão dele AGORA — `minha_carga()` (086-B). */
interface NaMao {
  serial: string; tipo: string | null; modelo: string | null
  estado: string | null; posse_motivo: string | null; dias: number | null
  /** inicializado · retirado · com defeito (087-B). */
  condicao: string | null
}

interface Romaneio {
  id: string
  numero: number
  tipo: 'ENTREGA' | 'DEVOLUCAO' | 'TRANSFERENCIA'
  situacao: 'ABERTO' | 'CONFIRMADO' | 'CANCELADO'
  observacao: string | null
  criado_em: string
  confirmado_em: string | null
  /** APARELHO · SENHA · BALCAO (087-D). */
  confirmado_metodo: string | null
  /** Ele é quem confirma? Na transferência que SAI dele, não é (087-C). */
  eu_recebo: boolean
  /** Na transferência: o nome do outro técnico. */
  outro_tecnico: string | null
  condicao_destino: string | null
  /** Pedida pelo técnico (089-C): destino aceita, almoxarifado aprova. */
  solicitado_por_tecnico: boolean
  aceito_em: string | null
  cancelado_motivo: string | null
  pecas: Peca[]
  itens: ItemMisc[]
}

const CONDICAO: Record<string, string> = {
  INICIALIZADO: 'inicializado', RETIRADO: 'retirado do cliente', COM_DEFEITO: 'com defeito',
}

function descreverTipo(r: Romaneio): string {
  if (r.tipo === 'ENTREGA') return 'Entrega do almoxarifado para você'
  if (r.tipo === 'DEVOLUCAO') {
    return 'Devolução ao almoxarifado'
      + (r.condicao_destino ? ` · volta como ${CONDICAO[r.condicao_destino] ?? r.condicao_destino}` : '')
  }
  return r.eu_recebo
    ? `Transferência de ${r.outro_tecnico ?? 'outro técnico'} para você`
    : `Transferência sua para ${r.outro_tecnico ?? 'outro técnico'}`
}

function descreverAceite(metodo: string | null): string {
  if (metodo === 'APARELHO') return 'por você, com a biometria ou o bloqueio do celular'
  if (metodo === 'SENHA') return 'por você, com a senha do sistema'
  if (metodo === 'BALCAO') return 'no balcão do almoxarifado'
  return ''
}

const qtd = (n: number) =>
  Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export default function Romaneios({ navigation }: Props) {
  const [lista, setLista] = useState<Romaneio[]>([])
  const [carga, setCarga] = useState<NaMao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  /** Prazo da carga (087-A). 0 = desligado, como a AFLINE usa hoje. */
  const [limite, setLimite] = useState(0)
  // Aceite por senha: só para celular sem biometria nem bloqueio de tela.
  const [pedindoSenha, setPedindoSenha] = useState<Romaneio | null>(null)
  const [senha, setSenha] = useState('')
  const { perfil } = useAuth()

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true)
    setErro(null)
    // Recibo e saldo são perguntas diferentes: os romaneios dizem o que
    // entrou e saiu nos últimos dias; a carga diz o que está com ele HOJE,
    // inclusive a peça que ele retirou de um cliente (079).
    const [r, c, l] = await Promise.all([
      supabase.rpc('meus_romaneios'),
      supabase.rpc('minha_carga'),
      supabase.rpc('ler_parametro', { p_chave: 'carga_dias_limite' }),
    ])
    setLimite(Number(l.data ?? 0) || 0)
    if (r.error) setErro(r.error.message)
    else setLista((r.data ?? []) as Romaneio[])
    if (c.error) setErro(c.error.message)
    else setCarga((c.data ?? []) as NaMao[])
    setCarregando(false)
    setAtualizando(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])
  // Voltando da tela de transferir, o pedido novo já tem de aparecer.
  useEffect(() => navigation.addListener('focus', () => { carregar(true) }), [navigation, carregar])

  function perguntar(r: Romaneio) {
    const total = r.pecas.length + r.itens.length
    const devolucao = r.tipo === 'DEVOLUCAO'
    Alert.alert(
      devolucao ? 'Confirmar a devolução?' : 'Confirmar o recebimento?',
      devolucao
        ? `Você está declarando que DEVOLVEU ${total} lançamento(s) ao almoxarifado `
          + `no romaneio ${r.numero}.`
        : `Você está declarando que RECEBEU ${total} lançamento(s) do romaneio `
          + `${r.numero}. A partir daqui as peças ficam na sua responsabilidade.`,
      [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Confirmar', style: 'default', onPress: () => { aceitar(r) } },
      ],
    )
  }

  /** Prova que é ele: o aparelho primeiro; sem bloqueio no celular, a senha. */
  async function aceitar(r: Romaneio) {
    setErro(null); setOk(null)
    if (await aparelhoProtegido()) {
      const passou = await autenticarNoAparelho(`Confirmar o romaneio ${r.numero}`)
      if (passou) await confirmar(r, 'APARELHO')
      else setErro('Confirmação cancelada. O romaneio continua aberto.')
      return
    }
    setSenha(''); setPedindoSenha(r)
  }

  async function aceitarComSenha() {
    const r = pedindoSenha
    if (!r) return
    setConfirmando(r.id)
    const certa = await conferirSenha(perfil?.email ?? '', senha)
    setSenha('')
    if (!certa) {
      setConfirmando(null)
      setErro('Senha não confere. O romaneio continua aberto.')
      setPedindoSenha(null)
      return
    }
    setPedindoSenha(null)
    await confirmar(r, 'SENHA')
  }

  async function confirmar(r: Romaneio, metodo: Metodo) {
    setConfirmando(r.id); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('confirmar_romaneio', {
      p_romaneio: r.id, p_metodo: metodo,
    })
    if (error) {
      setErro(/permiss/i.test(error.message)
        ? 'Este romaneio não é seu.'
        : error.message)
    } else {
      // Na transferência pedida por um colega, aceitar não move nada: falta
      // o almoxarifado aprovar (089-C). A frase diz isso, para ninguém
      // achar que já está com a peça.
      setOk((data as { aguardando_aprovacao?: boolean } | null)?.aguardando_aprovacao
        ? `Você aceitou o romaneio ${r.numero}. Agora o almoxarifado aprova — até lá, não está na sua carga.`
        : `Romaneio ${r.numero} confirmado. Ele fica no seu histórico.`)
      await carregar(true)
    }
    setConfirmando(null)
  }

  /** Quem pediu desiste; quem ia receber recusa. Só na transferência
   *  pedida pelo técnico, e só enquanto não foi aprovada (089-C). */
  function cancelarPedido(r: Romaneio) {
    const recusa = r.eu_recebo
    Alert.alert(
      recusa ? 'Recusar a transferência?' : 'Desistir do pedido?',
      recusa
        ? `O romaneio ${r.numero} de ${r.outro_tecnico ?? 'seu colega'} será cancelado. Nada muda de carga.`
        : `O romaneio ${r.numero} para ${r.outro_tecnico ?? 'seu colega'} será cancelado. Tudo continua com você.`,
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: recusa ? 'Recusar' : 'Desistir', style: 'destructive',
          onPress: async () => {
            setConfirmando(r.id); setErro(null); setOk(null)
            const { error } = await supabase.rpc('cancelar_romaneio', {
              p_romaneio: r.id,
              p_motivo: recusa ? 'Recusado por quem ia receber, pelo aplicativo'
                               : 'Desistencia de quem pediu, pelo aplicativo',
            })
            if (error) setErro(error.message)
            else { setOk(`Romaneio ${r.numero} cancelado.`); await carregar(true) }
            setConfirmando(null)
          },
        },
      ],
    )
  }

  return (
    <SafeAreaView style={e.tela} edges={['top', 'bottom']}>
      <View style={e.topo}>
        <Pressable onPress={() => navigation.goBack()} style={e.voltar}
          accessibilityRole="button" accessibilityLabel="Voltar para a agenda">
          <Text style={e.voltarTexto}>‹ Agenda</Text>
        </Pressable>
        <Text style={e.titulo}>Meu material</Text>
        <Text style={e.sub}>O que está com você, e o que o almoxarifado entregou</Text>
      </View>

      {carregando ? (
        <Carregando texto="Buscando…" />
      ) : (
        <ScrollView contentContainerStyle={e.corpo}
          refreshControl={
            <RefreshControl refreshing={atualizando} tintColor={cor.graf400}
              onRefresh={() => { setAtualizando(true); carregar(true) }} />
          }>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {ok && <Aviso tipo="ok">{ok}</Aviso>}

          {/* ┌─ a carga, antes dos recibos ──────────────────────────┐
              │ É a pergunta que ele faz na van: "o que eu tenho aqui?". │
              │ Com o prazo ligado (087-A), a peça parada além dele      │
              │ fica marcada — e o recado diz por que a próxima entrega  │
              │ vai ser recusada. Com o prazo em 0, nada se marca.       │
              └──────────────────────────────────────────────────────────┘ */}
          {limite > 0 && carga.some(p => (p.dias ?? 0) > limite) && (
            <Aviso tipo="atencao">
              Você tem {carga.filter(p => (p.dias ?? 0) > limite).length} peça(s) há mais
              de {limite} dias sem instalar nem devolver. Enquanto isso, o almoxarifado
              não consegue te entregar peça nova. Devolva ou instale.
            </Aviso>
          )}
          <Cartao style={{ marginBottom: 16 }}>
            <Text style={e.numero}>Com você agora · {carga.length}</Text>
            {carga.length === 0 ? (
              <Text style={e.tipo}>
                Nenhum equipamento na sua conta. O que o almoxarifado entregar
                aparece aqui depois que você confirmar o romaneio.
              </Text>
            ) : carga.map(p => (
              <View key={p.serial} style={e.linha}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={e.serial}>{p.serial}</Text>
                  <Text style={e.descricaoEmColuna} numberOfLines={1}>
                    {[p.tipo, p.modelo].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  {!!p.condicao && (
                    <Text style={e.descricaoEmColuna} numberOfLines={1}>
                      {CONDICAO[p.condicao] ?? p.condicao}
                    </Text>
                  )}
                  {!!p.posse_motivo && (
                    <Text style={e.descricaoEmColuna} numberOfLines={1}>{p.posse_motivo}</Text>
                  )}
                </View>
                <Text style={[e.dias, limite > 0 && (p.dias ?? 0) > limite && e.diasVencido]}>
                  {p.dias == null ? '—' : p.dias === 0 ? 'hoje' : `${p.dias} d`}
                </Text>
              </View>
            ))}
          </Cartao>

          {/* O técnico pede; o colega aceita; o almoxarifado aprova (089-C). */}
          <Botao titulo="Transferir para um colega" tom="contorno"
            aoTocar={() => navigation.navigate('Transferir')}
            style={{ marginBottom: 16 }} />

          <Text style={e.secao}>Romaneios</Text>
          {lista.length === 0 ? (
            <Vazio titulo="Nenhum romaneio"
              descricao="Quando o almoxarifado montar uma carga no seu nome, ela aparece aqui para você conferir e confirmar." />
          ) : lista.map(r => {
            const aberto = r.situacao === 'ABERTO'
            const cancelado = r.situacao === 'CANCELADO'
            const pedido = r.solicitado_por_tecnico
            const seloTexto = cancelado ? 'cancelado'
              : !aberto ? 'confirmado'
              : pedido && r.aceito_em ? 'aguardando almox.'
              : pedido && !r.eu_recebo ? 'aguardando aceite'
              : 'a confirmar'
            return (
              <Cartao key={r.id} style={{ marginBottom: 12 }}>
                <View style={e.cabecalho}>
                  <Text style={e.numero}>Romaneio {r.numero}</Text>
                  <View style={[e.selo, {
                    backgroundColor: cancelado ? cor.graf50 : aberto ? cor.ambar50 : cor.verde50,
                    borderColor: cancelado ? cor.graf300 : aberto ? cor.ambar : cor.verde,
                  }]}>
                    <Text style={[e.seloTexto, {
                      color: cancelado ? cor.graf500 : aberto ? '#92400e' : cor.verde900 }]}>
                      {seloTexto}
                    </Text>
                  </View>
                </View>
                <Text style={e.tipo}>
                  {descreverTipo(r)}
                  {r.observacao ? ` · ${r.observacao}` : ''}
                </Text>

                {r.pecas.length > 0 && (
                  <View style={e.bloco}>
                    <Text style={e.blocoTitulo}>
                      Equipamentos · {r.pecas.length}
                    </Text>
                    {r.pecas.map(p => (
                      <View key={p.serial} style={e.linha}>
                        <Text style={e.serial}>{p.serial}</Text>
                        <Text style={e.descricao} numberOfLines={1}>
                          {[p.tipo, p.modelo].filter(Boolean).join(' · ') || '—'}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {r.itens.length > 0 && (
                  <View style={e.bloco}>
                    <Text style={e.blocoTitulo}>Materiais · {r.itens.length}</Text>
                    {r.itens.map(i => (
                      <View key={i.codigo} style={e.linha}>
                        <Text style={e.qtdTexto}>{qtd(i.qtd)} {i.unidade}</Text>
                        <Text style={e.descricao} numberOfLines={1}>{i.nome}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {cancelado ? (
                  <Text style={e.recado}>Cancelado{r.cancelado_motivo ? `: ${r.cancelado_motivo}` : '.'}</Text>
                ) : aberto && pedido && r.aceito_em ? (
                  // Aceito: agora é com o almoxarifado. Ninguém mexe.
                  <>
                    <Text style={e.recado}>
                      {r.eu_recebo
                        ? 'Você aceitou. Falta o almoxarifado aprovar — só então as peças entram na sua carga.'
                        : `${r.outro_tecnico ?? 'Seu colega'} aceitou. Falta o almoxarifado aprovar — até lá continua com você.`}
                    </Text>
                    {!r.eu_recebo && (
                      <Botao titulo="Desistir do pedido" tom="contorno" style={{ marginTop: 10 }}
                        desativado={confirmando !== null} aoTocar={() => cancelarPedido(r)} />
                    )}
                  </>
                ) : aberto && !r.eu_recebo ? (
                  // Transferência que SAI dele: quem assina é quem recebe.
                  <>
                    <Text style={e.recado}>
                      Aguardando {r.outro_tecnico ?? 'o outro técnico'} aceitar no celular dele.
                      {pedido ? ' Depois o almoxarifado aprova.' : ''} As peças saem da sua carga
                      só no fim.
                    </Text>
                    {pedido && (
                      <Botao titulo="Desistir do pedido" tom="contorno" style={{ marginTop: 10 }}
                        desativado={confirmando !== null} aoTocar={() => cancelarPedido(r)} />
                    )}
                  </>
                ) : aberto ? (
                  <>
                    {/* O que ele está assinando, escrito antes do botão —
                        não depois, num aviso que some. */}
                    <Text style={e.recado}>
                      {r.tipo === 'DEVOLUCAO'
                        ? 'Confirmando, estes itens saem da sua responsabilidade.'
                        : 'Confira item por item antes de confirmar. Depois de confirmado, isto é o que consta como recebido por você.'}
                      {' '}O celular vai pedir sua digital, rosto ou o bloqueio de tela.
                    </Text>
                    <Botao grande
                      titulo={r.tipo === 'DEVOLUCAO' ? 'Confirmo a devolução' : pedido ? 'Aceitar a transferência' : 'Confirmo que recebi'}
                      tom="sucesso"
                      carregando={confirmando === r.id}
                      desativado={confirmando !== null}
                      aoTocar={() => perguntar(r)}
                      style={{ marginTop: 10 }} />
                    {pedido && (
                      <Botao titulo="Recusar" tom="contorno" style={{ marginTop: 8 }}
                        desativado={confirmando !== null} aoTocar={() => cancelarPedido(r)} />
                    )}
                  </>
                ) : (
                  <Text style={e.confirmado}>
                    Confirmado em{' '}
                    {r.confirmado_em
                      ? new Date(r.confirmado_em).toLocaleString('pt-BR')
                      : '—'}
                    {r.confirmado_metodo ? ` ${descreverAceite(r.confirmado_metodo)}` : ''}
                  </Text>
                )}
              </Cartao>
            )
          })}
        </ScrollView>
      )}

      {/* Só aparece em celular SEM biometria nem bloqueio de tela: aí a
          prova de que é ele é a senha do sistema (087-D). */}
      <Modal visible={pedindoSenha !== null} transparent animationType="fade"
        onRequestClose={() => setPedindoSenha(null)}>
        <View style={e.fundoModal}>
          <Cartao>
            <Text style={e.numero}>Confirme com a sua senha</Text>
            <Text style={e.recado}>
              Este celular não tem digital nem bloqueio de tela. Para confirmar o
              romaneio {pedindoSenha?.numero}, digite a senha do Gestor AF.
            </Text>
            <TextInput value={senha} onChangeText={setSenha} secureTextEntry
              autoCapitalize="none" autoCorrect={false} autoFocus
              placeholder="Sua senha" placeholderTextColor={cor.graf300}
              onSubmitEditing={aceitarComSenha}
              accessibilityLabel="Senha do Gestor AF"
              style={e.campoSenha} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Botao titulo="Cancelar" tom="contorno" style={{ flex: 1 }}
                aoTocar={() => { setPedindoSenha(null); setSenha('') }} />
              <Botao titulo="Confirmar" tom="sucesso" style={{ flex: 1.4 }}
                desativado={senha.length === 0}
                carregando={confirmando !== null}
                aoTocar={aceitarComSenha} />
            </View>
          </Cartao>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  topo: {
    backgroundColor: cor.branco, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  voltar: { minHeight: TOQUE, justifyContent: 'center' },
  voltarTexto: { fontSize: 16, color: cor.af600, fontWeight: '600' },
  titulo: { fontSize: 22, fontWeight: '700', color: cor.tinta },
  sub: { fontSize: 13, color: cor.graf400, marginTop: 2 },
  corpo: { padding: 16 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  numero: { fontSize: 17, fontWeight: '700', color: cor.tinta },
  selo: { borderWidth: 1, borderRadius: raio.s, paddingHorizontal: 8, paddingVertical: 2 },
  seloTexto: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tipo: { fontSize: 13, color: cor.graf400, marginTop: 2 },
  bloco: { marginTop: 12 },
  blocoTitulo: {
    fontSize: 11, fontWeight: '700', color: cor.graf400,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
  },
  linha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: cor.graf100,
  },
  serial: { fontSize: 15, fontWeight: '600', color: cor.tinta, fontVariant: ['tabular-nums'] },
  qtdTexto: {
    fontSize: 15, fontWeight: '700', color: cor.tinta, minWidth: 74,
    fontVariant: ['tabular-nums'],
  },
  descricao: { flex: 1, fontSize: 13, color: cor.graf400 },
  // Sem `flex: 1`: dentro de uma coluna de altura livre ele achataria a
  // linha a zero.
  descricaoEmColuna: { fontSize: 13, color: cor.graf400 },
  recado: { fontSize: 13, color: cor.graf500, marginTop: 12, lineHeight: 19 },
  confirmado: { fontSize: 13, color: cor.verde900, marginTop: 12, fontWeight: '600' },
  dias: { fontSize: 13, fontWeight: '600', color: cor.graf500, fontVariant: ['tabular-nums'] },
  diasVencido: { color: cor.af700 },
  fundoModal: {
    flex: 1, backgroundColor: 'rgba(15,17,21,0.5)', justifyContent: 'center', padding: 20,
  },
  campoSenha: {
    minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 12, fontSize: 16, color: cor.tinta, backgroundColor: cor.branco,
    marginTop: 12,
  },
  secao: {
    fontSize: 12, fontWeight: '700', color: cor.graf500,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8,
  },
})
