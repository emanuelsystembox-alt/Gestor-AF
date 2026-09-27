import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  ehTerminal, rotuloEvento, rotuloEvidencia, rotuloSituacao, TIPOS_EVIDENCIA,
} from '../lib/dominio'
import { carimbo, duracao, hhmm, isoLocal, mascaraTelefone, tamanho } from '../lib/formato'
import { distanciaM, ondeEstou, type EstadoGps } from '../lib/gps'
import { pendentesDaVisita, urlAssinada } from '../lib/midia'
import { Aviso, Botao, Carregando, Cartao, Etiqueta } from '../ui/componentes'
import { cor, raio, sombraCard, TOQUE } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * A visita na mão do técnico — a tela que o aplicativo existe para ter.
 *
 * ┌─ AS QUATRO REGRAS QUE ESTA TELA OBEDECE ─────────────────────────┐
 * │ 1. Sem GPS não há baixa. A trava está em `baixar_os` (055-G);    │
 * │    aqui ela vira um aviso que explica, em vez de um botão que    │
 * │    falha.                                                         │
 * │ 2. Baixa dada não se desfaz pelo campo. Quem baixou não troca o  │
 * │    código, e contrato encerrado (concluído, cancelado,           │
 * │    reagendado — inclusive pela baixa automática do TOA, D-097)   │
 * │    não volta. Para isso existe o controlador.                     │
 * │ 3. Depois de baixado ele AINDA anexa foto, vídeo e equipamento — │
 * │    o que faltou lançar —, mas só enquanto o contrato for do dia. │
 * │ 4. Quem carimba o autor é o servidor. Esta tela nunca manda      │
 * │    `usuario_id` (D-061).                                          │
 * └───────────────────────────────────────────────────────────────────┘
 */

/** O que já saiu do saldo do técnico neste contrato (094). */
interface MiscLancada { item: string; unidade: string | null; quantidade: number; criado_em: string }
interface SaldoItem { item_id: string; codigo: string | null; nome: string; unidade: string | null; tipo: string | null; saldo: number }

/**
 * Os status que o técnico escolhe (Emanuel, 27/09): os que já existem,
 * sem inventar "não concluído" — o não concluído É cancelado ou
 * reagendado. As travas continuam no banco (055): encerrar exige GPS e
 * todas as O.S. baixadas, e contrato encerrado não volta pelo campo.
 */
const STATUS_DO_CAMPO = [
  'ENTRADA', 'EM_DESLOCAMENTO', 'EM_EXECUCAO', 'COM_IMPEDIMENTO',
  'CONCLUIDA', 'CANCELADA', 'REAGENDAMENTO',
] as const

interface CodigoBaixa {
  id: string; codigo: number; descricao: string
  natureza: string; responsabilidade: string | null
}
interface SubFalha { id: string; nome: string }
interface OS {
  id: string; sequencia: number; numero_os: string
  descricao: string | null
  status_operadora: string | null
  baixa_observacao: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: CodigoBaixa | null
  baixa_afline: CodigoBaixa | null
  sub_falha: { nome: string } | null
}
interface Evid {
  id: string; tipo: string; midia: string; arquivo_path: string
  mime: string | null; tamanho_bytes: number | null; duracao_seg: number | null
  lat: number | null; lng: number | null; precisao_m: number | null
  capturada_em: string | null; login: string | null; os_id: string | null
}
interface Equip {
  id: string; operacao: string; serial: string
  tipo: string | null; modelo: string | null
  criado_em: string; login: string | null
}
interface Evento {
  id: number; tipo: string; criado_em: string
  login: string | null; observacao: string | null
  para: Record<string, unknown> | null
}
interface Detalhe {
  id: string
  contrato: string | null
  cliente_nome: string | null
  telefones: string[] | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cep: string | null; lat: number | null; lng: number | null
  janela_inicio: string | null; janela_fim: string | null
  situacao: string
  data_agendada: string
  observacao: string | null
  tipo_atividade: { nome: string } | null
  tipo_servico: { nome: string } | null
  ordem_servico: OS[]
  evidencia: Evid[]
  equipamento_movimento: Equip[]
  /** "Status da Atividade" e "Motivo de Fechamento Externo" do TOA, como
   *  vieram (D-158). Nulos em contrato que não veio do TOA. */
  status_toa: string | null
  motivo_fechamento_toa: string | null
}
/** Uma peça que está na mão do técnico (`minha_carga`, 086-B). */
interface PecaNaMao { serial: string; tipo: string | null; modelo: string | null }

const SELECT = `
  id, contrato, cliente_nome, telefones,
  logradouro, complemento, bairro, cep, lat, lng,
  janela_inicio, janela_fim, situacao, data_agendada, observacao,
  tipo_atividade:tipo_atividade_id ( nome ),
  tipo_servico:tipo_servico_id ( nome ),
  ordem_servico (
    id, sequencia, numero_os, descricao, status_operadora, baixa_observacao,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( id, codigo, descricao, natureza, responsabilidade ),
    baixa_afline:codigo_baixa_afline_id ( id, codigo, descricao, natureza, responsabilidade ),
    sub_falha:sub_falha_id ( nome )
  ),
  evidencia (
    id, tipo, midia, arquivo_path, mime, tamanho_bytes, duracao_seg,
    lat, lng, precisao_m, capturada_em, login, os_id
  ),
  equipamento_movimento ( id, operacao, serial, tipo, modelo, criado_em, login ),
  status_toa:dados_origem->>"Status da Atividade",
  motivo_fechamento_toa:dados_origem->>"Motivo de Fechamento Externo"
`

type Props = NativeStackScreenProps<Pilha, 'Visita'>

export default function Visita({ route, navigation }: Props) {
  const { id } = route.params
  const { ehCampo, pode } = useAuth()

  const [v, setV] = useState<Detalhe | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [codigos, setCodigos] = useState<CodigoBaixa[]>([])
  const [conjunto, setConjunto] = useState<string | null>(null)
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [gps, setGps] = useState<EstadoGps | null>(null)
  const [pendentes, setPendentes] = useState(0)

  // baixa
  const [osBaixando, setOsBaixando] = useState<OS | null>(null)
  const [buscaCod, setBuscaCod] = useState('')
  const [codEscolhido, setCodEscolhido] = useState<CodigoBaixa | null>(null)
  const [subFalhas, setSubFalhas] = useState<SubFalha[]>([])
  const [subSel, setSubSel] = useState('')
  const [obsBaixa, setObsBaixa] = useState('')

  // impedimento
  const [pedindoObs, setPedindoObs] = useState(false)
  const [obsEtapa, setObsEtapa] = useState('')

  // evidência e equipamento
  const [escolhendoTipo, setEscolhendoTipo] = useState<'FOTO' | 'VIDEO' | null>(null)
  const [equipAberto, setEquipAberto] = useState(false)
  const [equipOper, setEquipOper] = useState<'INSTALADO' | 'RETIRADO'>('INSTALADO')
  const [equipSerial, setEquipSerial] = useState('')
  const [equipTipo, setEquipTipo] = useState('')
  const [equipModelo, setEquipModelo] = useState('')
  const [carga, setCarga] = useState<PecaNaMao[]>([])

  // 094: a miscelânea do contrato, lançada pelo próprio técnico.
  const [miscLancada, setMiscLancada] = useState<MiscLancada[]>([])
  const [miscAberto, setMiscAberto] = useState(false)
  const [meuSaldo, setMeuSaldo] = useState<SaldoItem[]>([])
  const [miscQtd, setMiscQtd] = useState<Record<string, string>>({})
  const [miscBusca, setMiscBusca] = useState('')
  // A escolha livre de status (Emanuel, 27/09).
  const [escolhendoStatus, setEscolhendoStatus] = useState(false)
  // 096: o melhor contato do cliente, perguntado ao CONCLUIR.
  // null = ninguém perguntou ainda; { telefone: null } = ele disse NÃO.
  const [contato, setContato] = useState<{ telefone: string | null } | null>(null)
  const [perguntaContato, setPerguntaContato] = useState<'PERGUNTA' | 'DIGITA' | null>(null)
  const [telefoneNovo, setTelefoneNovo] = useState('')

  const recarregar = useCallback(async () => {
    const [dv, de] = await Promise.all([
      supabase.from('visita').select(SELECT).eq('id', id).single(),
      supabase.from('visita_evento')
        .select('id, tipo, criado_em, login, observacao, para')
        .eq('visita_id', id).order('criado_em', { ascending: false }).limit(40),
    ])
    if (dv.error) setErro(dv.error.message)
    else setV(dv.data as unknown as Detalhe)
    setEventos((de.data ?? []) as unknown as Evento[])
    setPendentes(await pendentesDaVisita(id))
    const { data: dm } = await supabase.rpc('miscelanea_do_contrato', { p_visita: id })
    setMiscLancada((dm ?? []) as MiscLancada[])
    const { data: dc } = await supabase.from('contato_cliente')
      .select('telefone').eq('visita_id', id).maybeSingle()
    setContato((dc as { telefone: string | null } | null) ?? null)
  }, [id])

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCarregando(true)
      const [dc, dm] = await Promise.all([
        supabase.from('codigo_baixa')
          .select('id, codigo, descricao, natureza, responsabilidade')
          .eq('ativo', true).order('codigo'),
        supabase.from('empresa').select('conjunto_sub_falha').limit(1).maybeSingle(),
      ])
      if (!vivo) return
      setCodigos((dc.data ?? []) as CodigoBaixa[])
      setConjunto((dm.data as { conjunto_sub_falha: string | null } | null)
        ?.conjunto_sub_falha ?? null)
      await recarregar()
      if (vivo) setCarregando(false)
    })()
    return () => { vivo = false }
  }, [id, recarregar])

  // Voltar da câmera tem de mostrar a foto que acabou de subir.
  useEffect(
    () => navigation.addListener('focus', () => { recarregar() }),
    [navigation, recarregar],
  )

  useEffect(() => { ondeEstou().then(setGps) }, [])

  // O bucket é privado: sem assinatura a miniatura volta 400 e a tela
  // mostra um quadrado cinza sem explicação.
  useEffect(() => {
    const fotos = (v?.evidencia ?? []).filter(x => x.midia === 'FOTO')
    fotos.forEach(async f => {
      if (miniaturas[f.id]) return
      const u = await urlAssinada(f.arquivo_path)
      if (u) setMiniaturas(m => ({ ...m, [f.id]: u }))
    })
  }, [v?.evidencia])

  // Os dois conjuntos de sub-falha convivem no banco; só um vale. Sem
  // filtrar pelo vigente, a lista vem em dobro.
  useEffect(() => {
    setSubSel('')
    if (!codEscolhido) { setSubFalhas([]); return }
    let q = supabase.from('sub_falha').select('id, nome').eq('codigo', codEscolhido.codigo)
      // Excluída em Configurações = `ativo` falso: some da escolha, mas
      // continua no histórico de quem já usou (D-161).
      .eq('ativo', true)
    if (conjunto) q = q.eq('conjunto', conjunto)
    q.order('ordem').then(({ data }) => setSubFalhas((data ?? []) as SubFalha[]))
  }, [codEscolhido, conjunto])

  const ehHoje = v?.data_agendada === isoLocal()
  const encerrada = v ? ehTerminal(v.situacao) : false
  /** O campo mexe no que é de hoje e ainda não fechou. */
  const podeExecutar = !!v && !encerrada && (!ehCampo || ehHoje)
  /** Anexar sobrevive à baixa — mas não ao dia (055-D). */
  const podeAnexar = !!v && (!ehCampo || ehHoje) && pode('servicos.anexar')

  const todasBaixadas = !!v && v.ordem_servico.length > 0
    && v.ordem_servico.every(o => o.baixa_afline)
  const faltam = v ? v.ordem_servico.filter(o => !o.baixa_afline).length : 0

  const distancia = useMemo(() => {
    if (!v?.lat || !v?.lng || !gps?.ok) return null
    return distanciaM(gps.posicao.lat, gps.posicao.lng, Number(v.lat), Number(v.lng))
  }, [v?.lat, v?.lng, gps])

  const filtrados = useMemo(() => {
    const t = buscaCod.trim().toLowerCase()
    if (!t) return codigos
    return codigos.filter(c =>
      String(c.codigo).includes(t) || c.descricao.toLowerCase().includes(t))
  }, [codigos, buscaCod])

  /** A coordenada vai com a PRECISÃO (096): 35 m do cliente com ±8 m e
   *  com ±2.000 m contam histórias diferentes na central. */
  async function coordenada(): Promise<{ lat: number; lng: number; precisao: number | null } | null> {
    // Lê de novo se a leitura guardada tem mais de 2 min: a baixa afirma
    // onde ele está AGORA, não onde estava quando abriu a tela.
    const recente = gps?.ok && Date.now() - gps.posicao.em.getTime() < 2 * 60 * 1000
    const g = recente && gps?.ok ? gps : await ondeEstou()
    setGps(g)
    if (!g.ok) {
      // 097: simulada não é "sem localização" — é outra coisa, com outro remédio.
      setErro(g.motivo === 'SIMULADO' ? g.recado : `Sem localização — não dá para baixar. ${g.recado}`)
      return null
    }
    return { lat: g.posicao.lat, lng: g.posicao.lng, precisao: g.posicao.precisao }
  }

  async function etapa(nova: string, observacao?: string) {
    if (!v) return
    setSalvando(true); setErro(null)
    // Encerrar é a mesma afirmação da baixa, pela outra porta: exige GPS.
    const precisaGps = ehCampo && ehTerminal(nova)
    const c = precisaGps ? await coordenada() : (gps?.ok
      ? { lat: gps.posicao.lat, lng: gps.posicao.lng, precisao: gps.posicao.precisao } : null)
    if (precisaGps && !c) { setSalvando(false); return }

    const { error } = await supabase.rpc('registrar_etapa', {
      p_visita: v.id,
      p_situacao: nova,
      p_observacao: observacao?.trim() || null,
      p_lat: c?.lat ?? null,
      p_lng: c?.lng ?? null,
      p_precisao: c?.precisao ?? null,
    })
    if (error) setErro(error.message)
    else {
      setPedindoObs(false); setObsEtapa(''); await recarregar()
      // "Só é pra aparecer nesse status" — Emanuel, 27/09.
      if (nova === 'CONCLUIDA') { setTelefoneNovo(''); setPerguntaContato('PERGUNTA') }
    }
    setSalvando(false)
  }

  /** Grava a resposta. `null` = ele respondeu NÃO — e isso também fica
   *  gravado: é o que mostra quem não está colocando o número. */
  async function responderContato(telefone: string | null) {
    if (!v) return
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('informar_contato_cliente', {
      p_visita: v.id, p_telefone: telefone,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setPerguntaContato(null); setTelefoneNovo('')
    await recarregar()
  }
  const digitosTelefone = telefoneNovo.replace(/\D/g, '')
  const telefoneValido = /^[1-9][1-9]\d{8,9}$/.test(digitosTelefone)

  async function confirmarBaixa() {
    if (!osBaixando || !codEscolhido) return
    setSalvando(true); setErro(null)
    const c = await coordenada()
    if (!c) { setSalvando(false); return }

    const { error } = await supabase.rpc('baixar_os', {
      p_os: osBaixando.id,
      p_codigo: codEscolhido.codigo,
      p_sub_falha: subSel || null,
      p_observacao: obsBaixa.trim() || null,
      p_situacao: null,
      p_lat: c.lat,
      p_lng: c.lng,
      p_precisao: c.precisao,
    })
    if (error) setErro(error.message)
    else { fecharBaixa(); await recarregar() }
    setSalvando(false)
  }

  function abrirBaixa(os: OS) {
    setOsBaixando(os)
    setBuscaCod(''); setCodEscolhido(null); setSubSel(''); setObsBaixa('')
    setErro(null)
  }
  function fecharBaixa() {
    setOsBaixando(null); setBuscaCod(''); setCodEscolhido(null)
    setSubSel(''); setObsBaixa('')
  }

  /**
   * Abre o lançamento de equipamento e traz a carga do técnico.
   *
   * ┌─ por que tocar em vez de digitar ────────────────────────────────┐
   * │ Digitado na calçada, um serial de 15 caracteres erra um dígito — │
   * │ e aí a peça não sai da posse dele para a casa do cliente (079):  │
   * │ o estoque continua dizendo que ela está na van. Se a peça veio   │
   * │ por romaneio, ela já está na lista: é um toque, e o serial chega │
   * │ certo. Digitar continua valendo — peça de fora da carga existe.  │
   * └──────────────────────────────────────────────────────────────────┘
   */
  async function abrirEquipamento() {
    setEquipAberto(true); setErro(null)
    const { data } = await supabase.rpc('minha_carga')
    setCarga((data ?? []) as PecaNaMao[])
  }

  /** Abre a miscelânea: o saldo DELE, porque é dele que o material sai. */
  async function abrirMiscelanea() {
    setMiscAberto(true); setErro(null); setMiscQtd({}); setMiscBusca('')
    const { data } = await supabase.rpc('minha_miscelanea')
    // Ferramenta e EPI não se gastam no contrato: voltam para o
    // almoxarifado. Só material e acessório entram aqui.
    setMeuSaldo(((data ?? []) as SaldoItem[])
      .filter(i => i.tipo !== 'FERRAMENTA' && i.tipo !== 'EPI'))
  }

  async function salvarMiscelanea() {
    if (!v) return
    const itens = Object.entries(miscQtd)
      .map(([item_id, q]) => ({ item_id, quantidade: Number(q.replace(',', '.')) }))
      .filter(x => Number.isFinite(x.quantidade) && x.quantidade > 0)
    if (itens.length === 0) { setErro('Informe a quantidade de pelo menos um item.'); return }
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('baixar_miscelanea_do_campo', {
      p_visita: v.id, p_itens: itens, p_observacao: null,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setMiscAberto(false); setMiscQtd({})
    await recarregar()
  }

  /** O técnico escolhe o status. A tela só antecipa o recado das travas;
   *  quem recusa de verdade é o banco (registrar_etapa, 055). */
  function escolherStatus(s: string) {
    setEscolhendoStatus(false)
    if (!v || s === v.situacao) return
    if (s === 'COM_IMPEDIMENTO') { setPedindoObs(true); return }
    if (ehTerminal(s)) {
      if (!todasBaixadas) {
        setErro(`Para ${rotuloSituacao(s).toLowerCase()}, todas as O.S. precisam de baixa — falta ${faltam}.`)
        return
      }
      Alert.alert(
        rotuloSituacao(s),
        'Depois disso o contrato fica encerrado e você não consegue reabrir — só o controlador.',
        [{ text: 'Voltar', style: 'cancel' }, { text: 'Confirmar', onPress: () => etapa(s) }],
      )
      return
    }
    etapa(s)
  }

  async function salvarEquipamento() {
    if (!v || equipSerial.trim().length < 4) return
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('registrar_equipamento', {
      p_visita: v.id,
      p_operacao: equipOper,
      p_serial: equipSerial,
      p_os: v.ordem_servico.length === 1 ? v.ordem_servico[0].id : null,
      p_tipo: equipTipo.trim() || null,
      p_modelo: equipModelo.trim() || null,
    })
    if (error) setErro(error.message)
    else {
      setEquipAberto(false); setEquipSerial(''); setEquipTipo(''); setEquipModelo('')
      await recarregar()
    }
    setSalvando(false)
  }

  if (carregando) return <SafeAreaView style={e.tela}><Carregando /></SafeAreaView>
  if (!v) {
    return (
      <SafeAreaView style={e.tela}>
        <View style={{ padding: 16, gap: 12 }}>
          <Aviso tipo="erro">{erro ?? 'Contrato não encontrado.'}</Aviso>
          <Botao titulo="Voltar" tom="contorno" aoTocar={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      {/* ---------- cabeçalho ---------- */}
      <View style={e.cabecalho}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={e.voltar}>
          <Text style={e.voltarTexto}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={e.tituloTopo} numberOfLines={1}>
            {v.tipo_servico?.nome ?? v.tipo_atividade?.nome ?? 'Visita'}
          </Text>
          <Text style={e.subTopo} numberOfLines={1}>
            {v.contrato ? `contrato ${v.contrato} · ` : ''}
            {hhmm(v.janela_inicio)}{v.janela_fim ? `–${hhmm(v.janela_fim)}` : ''}
          </Text>
        </View>
        <Etiqueta situacao={v.situacao} />
        {/* Suporte técnico = o Impedimento (Emanuel, 27/09): cai direto na
            central do controlador. Aqui abre o mesmo campo do rodapé. */}
        {podeExecutar && !pedindoObs && (
          <Pressable onPress={() => setPedindoObs(true)} style={e.suporte} hitSlop={6}
            accessibilityRole="button" accessibilityLabel="Solicitar suporte técnico">
            <Text style={e.suporteTexto}>Suporte</Text>
          </Pressable>
        )}
      </View>

      {/* O teclado do Android (edge-to-edge) não encolhe a janela: sem isto
          ele cobria o campo do impedimento no rodapé (Emanuel, 27/09).
          "height" encolhe a área, e o rodapé fixo sobe junto. */}
      <KeyboardAvoidingView style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={e.conteudo}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={async () => {
              setAtualizando(true)
              await recarregar()
              setGps(await ondeEstou())
              setAtualizando(false)
            }}
            tintColor={cor.af600}
          />
        }
      >
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {encerrada && (
          <Aviso tipo="ok">
            Contrato {rotuloSituacao(v.situacao).toLowerCase()}. Você ainda
            pode anexar foto, vídeo e equipamento{ehHoje ? ' hoje' : ''} —
            mas a situação e o código de baixa só o controlador muda.
          </Aviso>
        )}

        {ehCampo && !ehHoje && (
          <Aviso tipo="atencao">
            Este contrato é de outro dia. Para o campo ele é só leitura.
          </Aviso>
        )}

        {/* ---------- onde estou / onde é ---------- */}
        <View style={e.chipGps}>
          <View style={[e.pontinho, { backgroundColor: gps?.ok ? cor.verde : cor.ambar }]} />
          <Text style={e.chipGpsTexto}>
            {gps?.ok
              ? `Localização ligada${gps.posicao.precisao ? ` · ±${Math.round(gps.posicao.precisao)} m` : ''}`
              : (gps?.recado ?? 'Procurando sinal de GPS…')}
            {distancia != null && ` · ${distancia < 1000
              ? `${distancia} m do endereço`
              : `${(distancia / 1000).toFixed(1)} km do endereço`}`}
          </Text>
          {!gps?.ok && (
            <Pressable onPress={async () => setGps(await ondeEstou())} hitSlop={8}>
              <Text style={e.chipAcao}>tentar</Text>
            </Pressable>
          )}
        </View>

        {/* ---------- endereço ---------- */}
        <Cartao style={{ padding: 16 }}>
          {v.cliente_nome && <Text style={e.clienteNome}>{v.cliente_nome}</Text>}
          <Text style={e.endereco}>{v.logradouro ?? 'Sem endereço'}</Text>
          {v.complemento && <Text style={e.enderecoMiudo}>{v.complemento}</Text>}
          <Text style={e.enderecoMiudo}>
            {v.bairro}{v.cep ? ` · ${v.cep}` : ''}
          </Text>

          <View style={{ gap: 8, marginTop: 14 }}>
            {v.lat && v.lng && (
              <Botao
                titulo="Abrir rota no mapa"
                tom="contorno"
                aoTocar={() => Linking.openURL(
                  `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`,
                )}
              />
            )}
            {/* Ligar antes de sair evita a improdutiva mais comum:
                cliente ausente. O número já está aqui — usar. */}
            {(v.telefones ?? []).slice(0, 2).map(t => (
              <Botao
                key={t}
                titulo={`Ligar para ${t}`}
                tom="discreto"
                aoTocar={() => Linking.openURL(`tel:${t.replace(/\D/g, '')}`)}
              />
            ))}
          </View>

          {/* 096: o melhor contato, quando concluído. Sem resposta ainda
              (o app fechou no meio, por exemplo), dá para responder aqui. */}
          {v.situacao === 'CONCLUIDA' && (
            contato ? (
              <Text style={e.contatoLinha}>
                Melhor contato: {contato.telefone
                  ? mascaraTelefone(contato.telefone) : 'não informado'}
              </Text>
            ) : podeAnexar ? (
              <Pressable onPress={() => { setTelefoneNovo(''); setPerguntaContato('PERGUNTA') }}
                hitSlop={8} accessibilityRole="button">
                <Text style={e.contatoAcao}>Informar o melhor contato do cliente ›</Text>
              </Pressable>
            ) : null
          )}
        </Cartao>

        {/* A palavra do TOA, como veio, ao lado da nossa etiqueta — as
            duas podem divergir, e a diferença tem de aparecer (D-158). */}
        {(v.status_toa || v.motivo_fechamento_toa) && (
          <Text style={e.operadora}>
            No TOA: {[v.status_toa, v.motivo_fechamento_toa].filter(Boolean).join(' · ')}
          </Text>
        )}

        {/* ---------- ordens de serviço ---------- */}
        <Text style={e.tituloSecao}>
          {v.ordem_servico.length} ordem(ns) de serviço
          {faltam > 0 ? ` · ${faltam} sem baixa` : ''}
        </Text>

        {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(os => (
          <Cartao key={os.id} style={{ padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={e.seq}>#{os.sequencia}</Text>
              <Text style={e.numeroOs}>{os.numero_os}</Text>
            </View>
            <Text style={e.descricaoOs}>
              {os.descricao ?? os.tipo_os?.descricao ?? 'Serviço não descrito'}
            </Text>

            {/* A baixa da operadora é leitura: veio do TOA (D-042). */}
            {os.codigo_baixa && (
              <Text style={e.operadora}>
                Operadora (TOA): {os.codigo_baixa.codigo} · {os.codigo_baixa.descricao}
              </Text>
            )}

            {os.baixa_afline ? (
              <View style={[
                e.baixaCaixa,
                { backgroundColor: os.baixa_afline.natureza === 'SUCESSO' ? cor.verde50 : cor.af50 },
              ]}>
                <Text style={[
                  e.baixaTitulo,
                  { color: os.baixa_afline.natureza === 'SUCESSO' ? cor.verde900 : cor.af700 },
                ]}>
                  {os.baixa_afline.natureza === 'SUCESSO' ? 'EXECUTADA' : 'NÃO EXECUTADA'}
                </Text>
                <Text style={e.baixaCodigo}>
                  {os.baixa_afline.codigo} · {os.baixa_afline.descricao}
                </Text>
                {os.sub_falha && <Text style={e.baixaMiudo}>{os.sub_falha.nome}</Text>}
                {os.baixa_observacao && (
                  <Text style={e.baixaMiudo}>{os.baixa_observacao}</Text>
                )}
                {/* Sem "trocar código" para o campo. A baixa é o que a
                    AFLINE afirmou; desfazer é do controlador. */}
                {!ehCampo && !encerrada && (
                  <Pressable onPress={() => abrirBaixa(os)} hitSlop={8}>
                    <Text style={e.trocar}>Trocar código</Text>
                  </Pressable>
                )}
              </View>
            ) : podeExecutar ? (
              <Botao
                titulo="Dar baixa"
                tom="contorno"
                style={{ marginTop: 12, borderColor: cor.af600 }}
                aoTocar={() => abrirBaixa(os)}
              />
            ) : (
              <Text style={e.semAcao}>Sem baixa.</Text>
            )}
          </Cartao>
        ))}

        {/* ---------- evidência ---------- */}
        <View style={e.linhaEntre}>
          <Text style={e.tituloSecao}>
            Evidência{v.evidencia.length > 0 ? ` · ${v.evidencia.length}` : ''}
          </Text>
          {pendentes > 0 && (
            <Text style={e.pendenteTexto}>{pendentes} esperando sinal</Text>
          )}
        </View>

        {v.evidencia.length === 0 && (
          <Text style={e.vazioLinha}>
            Nenhuma foto ainda. A evidência é o que responde depois, na
            auditoria, o que foi feito no endereço.
          </Text>
        )}

        {v.evidencia.length > 0 && (
          <View style={e.galeria}>
            {v.evidencia.map(f => (
              <View key={f.id} style={e.miniatura}>
                {f.midia === 'FOTO' && miniaturas[f.id] ? (
                  <Image source={{ uri: miniaturas[f.id] }} style={e.miniaturaImg} />
                ) : (
                  <View style={[e.miniaturaImg, e.miniaturaVideo]}>
                    <Text style={e.miniaturaVideoTexto}>
                      {f.midia === 'VIDEO' ? `▶ ${duracao(f.duracao_seg)}` : '…'}
                    </Text>
                  </View>
                )}
                <Text style={e.miniaturaRotulo} numberOfLines={1}>
                  {rotuloEvidencia(f.tipo)}
                </Text>
                <Text style={e.miniaturaMiudo} numberOfLines={1}>
                  {f.capturada_em ? carimbo(f.capturada_em) : ''}
                  {f.tamanho_bytes ? ` · ${tamanho(f.tamanho_bytes)}` : ''}
                </Text>
                {f.lat == null && (
                  <Text style={e.semGpsMini}>sem GPS</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {podeAnexar && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Botao
              titulo="Tirar foto" style={{ flex: 1 }}
              aoTocar={() => setEscolhendoTipo('FOTO')}
            />
            <Botao
              titulo="Gravar vídeo" tom="contorno" style={{ flex: 1 }}
              aoTocar={() => setEscolhendoTipo('VIDEO')}
            />
          </View>
        )}

        {/* ---------- equipamento ---------- */}
        <Text style={e.tituloSecao}>
          Equipamento{v.equipamento_movimento.length > 0
            ? ` · ${v.equipamento_movimento.length}` : ''}
        </Text>

        {v.equipamento_movimento.map(m => (
          <Cartao key={m.id} style={e.equipLinha}>
            <View style={[
              e.equipSelo,
              { backgroundColor: m.operacao === 'INSTALADO' ? cor.verde50 : cor.graf50 },
            ]}>
              <Text style={[
                e.equipSeloTexto,
                { color: m.operacao === 'INSTALADO' ? cor.verde900 : cor.graf500 },
              ]}>
                {m.operacao === 'INSTALADO' ? 'INSTALOU' : 'RETIROU'}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={e.equipSerial}>{m.serial}</Text>
              <Text style={e.equipMiudo} numberOfLines={1}>
                {[m.tipo, m.modelo].filter(Boolean).join(' · ') || 'sem tipo informado'}
                {m.login ? ` · ${m.login}` : ''}
              </Text>
            </View>
          </Cartao>
        ))}

        {podeAnexar && !equipAberto && (
          // "discreto" era cinza sobre o fundo cinza da tela: parecia texto,
          // não botão (Emanuel, 27/09).
          <Botao
            titulo="Lançar equipamento" tom="contorno"
            aoTocar={abrirEquipamento}
          />
        )}

        {podeAnexar && equipAberto && (
          <Cartao style={{ padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['INSTALADO', 'RETIRADO'] as const).map(o => (
                <Pressable
                  key={o}
                  onPress={() => setEquipOper(o)}
                  style={[e.opcao, equipOper === o && e.opcaoAtiva, { flex: 1 }]}
                >
                  <Text style={[e.opcaoTexto, equipOper === o && e.opcaoTextoAtivo]}>
                    {o === 'INSTALADO' ? 'Instalou' : 'Retirou'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={equipSerial}
              onChangeText={t => setEquipSerial(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Serial do equipamento"
              placeholderTextColor={cor.graf300}
              style={e.campo}
            />
            {/* Só para "Instalou": o que ele RETIRA vem da casa do
                cliente, não da carga dele. */}
            {equipOper === 'INSTALADO' && (() => {
              const lancados = new Set(v.equipamento_movimento.map(m => m.serial))
              const livres = carga.filter(p => !lancados.has(p.serial))
              if (livres.length === 0) return null
              return (
                <View style={{ gap: 6 }}>
                  <Text style={e.cargaTitulo}>Da sua carga · toque para usar</Text>
                  <View style={e.cargaLista}>
                    {livres.map(p => (
                      <Pressable
                        key={p.serial}
                        onPress={() => {
                          setEquipSerial(p.serial)
                          setEquipTipo(p.tipo ?? '')
                          setEquipModelo(p.modelo ?? '')
                        }}
                        style={[e.cargaChip, equipSerial === p.serial && e.opcaoAtiva]}
                        accessibilityRole="button"
                        accessibilityLabel={`Usar o serial ${p.serial}`}
                      >
                        <Text style={e.cargaSerial}>{p.serial}</Text>
                        <Text style={e.cargaMiudo} numberOfLines={1}>
                          {p.tipo ?? 'sem tipo'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )
            })()}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={equipTipo} onChangeText={setEquipTipo}
                placeholder="Tipo (EMTA, ONT…)"
                placeholderTextColor={cor.graf300}
                style={[e.campo, { flex: 1 }]}
              />
              <TextInput
                value={equipModelo} onChangeText={setEquipModelo}
                placeholder="Modelo"
                placeholderTextColor={cor.graf300}
                style={[e.campo, { flex: 1 }]}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Botao
                titulo="Cancelar" tom="contorno" style={{ flex: 1 }}
                aoTocar={() => setEquipAberto(false)}
              />
              <Botao
                titulo="Lançar" style={{ flex: 1.4 }}
                desativado={equipSerial.trim().length < 4}
                carregando={salvando}
                aoTocar={salvarEquipamento}
              />
            </View>
          </Cartao>
        )}

        {/* ---------- miscelânea (094) — logo abaixo do equipamento: estava
            depois do histórico e sumia no fim da tela (Emanuel, 27/09) ---------- */}
        <Text style={e.tituloSecao}>
          Miscelânea{miscLancada.length > 0 ? ` · ${miscLancada.length}` : ''}
        </Text>
        {miscLancada.map((m, i) => (
          <Cartao key={i} style={e.equipLinha}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={e.equipSerial} numberOfLines={2}>{m.item}</Text>
              <Text style={e.equipMiudo}>{carimbo(m.criado_em)}</Text>
            </View>
            <Text style={e.miscQtd}>
              {Number(m.quantidade)} <Text style={e.equipMiudo}>{m.unidade ?? 'un'}</Text>
            </Text>
          </Cartao>
        ))}
        {podeAnexar && (
          <Botao titulo="Lançar miscelânea" tom="contorno" aoTocar={abrirMiscelanea} />
        )}
        {/* ---------- histórico ---------- */}
        {eventos.length > 0 && (
          <Cartao style={{ padding: 14 }}>
            <Text style={[e.tituloSecao, { marginBottom: 8 }]}>O que já aconteceu</Text>
            {eventos.map(ev => {
              const sit = typeof ev.para?.situacao === 'string'
                ? rotuloSituacao(ev.para.situacao as string) : null
              return (
                <View key={ev.id} style={e.evento}>
                  <Text style={e.eventoHora}>{carimbo(ev.criado_em)}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={e.eventoTexto}>
                      {sit ?? rotuloEvento(ev.tipo)}
                      {ev.login ? <Text style={e.eventoLogin}> · {ev.login}</Text> : null}
                    </Text>
                    {ev.observacao && (
                      <Text style={e.eventoObs}>{ev.observacao}</Text>
                    )}
                  </View>
                </View>
              )
            })}
          </Cartao>
        )}
      </ScrollView>

      {/* ---------- ações fixas: o polegar alcança ---------- */}
      {podeExecutar && (
        <View style={e.rodape}>
          {pedindoObs ? (
            <View style={{ gap: 8 }}>
              <TextInput
                autoFocus value={obsEtapa} onChangeText={setObsEtapa}
                placeholder="O que impediu? Ex.: no local, sem contato com o cliente"
                placeholderTextColor={cor.graf300}
                style={e.campo}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Botao
                  titulo="Cancelar" tom="contorno" style={{ flex: 1 }}
                  aoTocar={() => { setPedindoObs(false); setObsEtapa('') }}
                />
                <Botao
                  titulo="Registrar impedimento" tom="perigo" style={{ flex: 1.6 }}
                  desativado={!obsEtapa.trim()} carregando={salvando}
                  aoTocar={() => etapa('COM_IMPEDIMENTO', obsEtapa)}
                />
              </View>
            </View>
          ) : v.situacao === 'ENTRADA' || v.situacao === 'ATRIBUIDA' ? (
            <Botao
              titulo="Estou a caminho" grande carregando={salvando}
              aoTocar={() => etapa('EM_DESLOCAMENTO')}
            />
          ) : v.situacao === 'EM_DESLOCAMENTO' ? (
            <Botao
              titulo="Cheguei — iniciar" grande carregando={salvando}
              aoTocar={() => etapa('EM_EXECUCAO')}
            />
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Botao
                titulo="Impedimento" tom="contorno" grande style={{ flex: 1 }}
                aoTocar={() => setPedindoObs(true)} desativado={salvando}
              />
              <Botao
                titulo={todasBaixadas ? 'Finalizar visita' : `Falta baixar ${faltam} O.S.`}
                tom="sucesso" grande style={{ flex: 1.5 }}
                desativado={!todasBaixadas} carregando={salvando}
                aoTocar={() => Alert.alert(
                  'Finalizar visita',
                  'Depois disso o contrato fica encerrado e você não consegue reabrir — só o controlador.',
                  [
                    { text: 'Voltar', style: 'cancel' },
                    { text: 'Finalizar', onPress: () => etapa('CONCLUIDA') },
                  ],
                )}
              />
            </View>
          )}
          {!pedindoObs && (
            <Pressable onPress={() => setEscolhendoStatus(true)} style={e.mudarStatus}
              accessibilityRole="button" accessibilityLabel="Escolher outro status">
              <Text style={e.mudarStatusTexto}>Mudar status ›</Text>
            </Pressable>
          )}
        </View>
      )}
      </KeyboardAvoidingView>

      {/* ---------- o melhor contato do cliente (096) ----------
          Não fecha tocando fora nem no "voltar": a pergunta pede um SIM
          ou um NÃO — "o ideal é que todos apertem sim" (Emanuel, 27/09),
          e o NÃO também é resposta, gravada. */}
      <Modal visible={perguntaContato !== null} animationType="fade" transparent
        onRequestClose={() => {}}>
        <KeyboardAvoidingView style={e.centroModal}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={e.caixaContato}>
            <Text style={e.folhaTitulo}>Contrato concluído</Text>
            {perguntaContato === 'PERGUNTA' ? (
              <>
                <Text style={e.perguntaContato}>
                  Você deseja subir o melhor contato do cliente?
                </Text>
                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <Botao titulo="NÃO" tom="contorno" grande style={{ flex: 1 }}
                    carregando={salvando} aoTocar={() => responderContato(null)} />
                  <Botao titulo="SIM" tom="sucesso" grande style={{ flex: 1.4 }}
                    desativado={salvando}
                    aoTocar={() => { setErro(null); setPerguntaContato('DIGITA') }} />
                </View>
              </>
            ) : (
              <>
                <Text style={e.folhaMiudo}>Telefone com DDD</Text>
                <TextInput
                  autoFocus value={telefoneNovo}
                  onChangeText={t => setTelefoneNovo(mascaraTelefone(t))}
                  placeholder="(92) 99999-9999"
                  placeholderTextColor={cor.graf300}
                  keyboardType="phone-pad" maxLength={15}
                  style={[e.campo, e.campoTelefone]}
                />
                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <Botao titulo="Voltar" tom="contorno" style={{ flex: 1 }}
                    desativado={salvando} aoTocar={() => setPerguntaContato('PERGUNTA')} />
                  <Botao titulo="Salvar contato" tom="sucesso" style={{ flex: 1.6 }}
                    desativado={!telefoneValido} carregando={salvando}
                    aoTocar={() => responderContato(digitosTelefone)} />
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------- escolher o status (Emanuel, 27/09) ---------- */}
      <Modal visible={escolhendoStatus} animationType="slide" transparent
        onRequestClose={() => setEscolhendoStatus(false)}>
        <Pressable style={e.fundoModal} onPress={() => setEscolhendoStatus(false)} />
        <View style={e.folha}>
          <Text style={e.folhaTitulo}>Mudar status</Text>
          <Text style={e.folhaMiudo}>
            Encerrar (concluída, cancelada, reagendamento) pede todas as O.S.
            baixadas e o GPS ligado — e depois só o controlador reabre.
          </Text>
          {STATUS_DO_CAMPO.map(s => {
            const atual = v.situacao === s
            const bloqueado = ehTerminal(s) && !todasBaixadas
            return (
              <Pressable key={s} disabled={atual}
                onPress={() => escolherStatus(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: atual, disabled: atual }}
                style={({ pressed }) => [e.statusLinha, atual && e.statusAtual,
                  pressed && { opacity: 0.8 }]}>
                <Etiqueta situacao={s} />
                <Text style={e.statusNota}>
                  {atual ? 'status atual'
                    : bloqueado ? `falta baixar ${faltam} O.S.`
                    : s === 'COM_IMPEDIMENTO' ? 'avisa o controlador' : ''}
                </Text>
              </Pressable>
            )
          })}
          <Botao titulo="Fechar" tom="contorno" aoTocar={() => setEscolhendoStatus(false)} />
        </View>
      </Modal>

      {/* ---------- lançar miscelânea (094) ---------- */}
      <Modal visible={miscAberto} animationType="slide" transparent
        onRequestClose={() => setMiscAberto(false)}>
        <Pressable style={e.fundoModal} onPress={() => setMiscAberto(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={e.folha}>
            <Text style={e.folhaTitulo}>Lançar miscelânea</Text>
            <Text style={e.folhaMiudo}>
              O material sai do SEU saldo e fica amarrado a este contrato.
            </Text>
            <TextInput value={miscBusca} onChangeText={setMiscBusca}
              placeholder="Buscar material…" placeholderTextColor={cor.graf400}
              style={e.campo} accessibilityLabel="Buscar material" />
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {meuSaldo.length === 0 && (
                <Text style={e.folhaMiudo}>Você não tem material no saldo. Fale com o almoxarifado.</Text>
              )}
              {meuSaldo
                .filter(i => !miscBusca.trim() || i.nome.toLowerCase().includes(miscBusca.trim().toLowerCase()))
                .map(i => (
                  <View key={i.item_id} style={e.miscLinha}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={e.equipSerial} numberOfLines={2}>{i.nome}</Text>
                      <Text style={e.equipMiudo}>tem {Number(i.saldo)} {i.unidade ?? 'un'}</Text>
                    </View>
                    <TextInput value={miscQtd[i.item_id] ?? ''} keyboardType="decimal-pad"
                      onChangeText={t => setMiscQtd(q => ({ ...q, [i.item_id]: t }))}
                      placeholder="0" placeholderTextColor={cor.graf300}
                      style={e.miscCampo} accessibilityLabel={`Quantidade de ${i.nome}`} />
                  </View>
                ))}
            </ScrollView>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Botao titulo="Cancelar" tom="contorno" style={{ flex: 1 }}
                aoTocar={() => setMiscAberto(false)} />
              <Botao titulo="Lançar" style={{ flex: 1 }} carregando={salvando}
                aoTocar={salvarMiscelanea} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------- escolher o tipo da evidência ---------- */}
      <Modal
        visible={escolhendoTipo !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEscolhendoTipo(null)}
      >
        <Pressable style={e.fundoModal} onPress={() => setEscolhendoTipo(null)} />
        <View style={e.folha}>
          <Text style={e.folhaTitulo}>
            {escolhendoTipo === 'VIDEO' ? 'Gravar vídeo de quê?' : 'Foto de quê?'}
          </Text>
          <Text style={e.folhaMiudo}>
            O tipo é o que faz a evidência ser encontrada depois. Nenhum
            deles é obrigatório para baixar.
          </Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {TIPOS_EVIDENCIA.map(t => (
              <Pressable
                key={t.chave}
                onPress={() => {
                  const modo = escolhendoTipo!
                  setEscolhendoTipo(null)
                  navigation.navigate('Captura', {
                    visitaId: v.id,
                    osId: v.ordem_servico.length === 1 ? v.ordem_servico[0].id : null,
                    tipo: t.chave,
                    modo,
                  })
                }}
                style={({ pressed }) => [e.itemFolha, pressed && { backgroundColor: cor.graf50 }]}
              >
                <Text style={e.itemFolhaTexto}>{t.rotulo}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Botao titulo="Cancelar" tom="contorno" aoTocar={() => setEscolhendoTipo(null)} />
        </View>
      </Modal>

      {/* ---------- baixa: código → sub-falha → observação ---------- */}
      <Modal
        visible={osBaixando !== null}
        animationType="slide"
        onRequestClose={fecharBaixa}
      >
        <SafeAreaView style={e.tela} edges={['top', 'bottom']}>
          <View style={e.cabecalho}>
            <Pressable onPress={fecharBaixa} hitSlop={12} style={e.voltar}>
              <Text style={e.voltarTexto}>✕</Text>
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={e.tituloTopo}>Dar baixa</Text>
              <Text style={e.subTopo} numberOfLines={1}>
                O.S. {osBaixando?.numero_os}
              </Text>
            </View>
          </View>

          <View style={{ flex: 1, padding: 12, gap: 10 }}>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            {gps && !gps.ok && (
              <Aviso tipo="atencao">
                Sem localização a baixa não vai passar. {gps.recado}
              </Aviso>
            )}

            {!codEscolhido ? (
              <>
                <TextInput
                  autoFocus value={buscaCod} onChangeText={setBuscaCod}
                  placeholder="Buscar por número ou descrição…"
                  placeholderTextColor={cor.graf300}
                  style={e.campo}
                />
                <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
                  {filtrados.slice(0, 80).map(c => (
                    <Pressable
                      key={c.id}
                      onPress={() => setCodEscolhido(c)}
                      style={({ pressed }) => [e.itemCodigo, pressed && { backgroundColor: cor.graf50 }]}
                    >
                      <Text style={e.itemCodigoNum}>{c.codigo}</Text>
                      <Text style={e.itemCodigoDesc}>{c.descricao}</Text>
                      <View style={[
                        e.naturezaSelo,
                        { backgroundColor: c.natureza === 'SUCESSO' ? cor.verde50 : cor.af50 },
                      ]}>
                        <Text style={[
                          e.naturezaTexto,
                          { color: c.natureza === 'SUCESSO' ? cor.verde900 : cor.af700 },
                        ]}>
                          {c.natureza === 'SUCESSO' ? 'OK' : 'IMPROD'}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                  {filtrados.length === 0 && (
                    <Text style={e.vazioLinha}>Nenhum código encontrado.</Text>
                  )}
                </ScrollView>
              </>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
                <Cartao style={e.escolhido}>
                  <Text style={e.itemCodigoNum}>{codEscolhido.codigo}</Text>
                  <Text style={[e.itemCodigoDesc, { flex: 1 }]}>{codEscolhido.descricao}</Text>
                  <Pressable onPress={() => setCodEscolhido(null)} hitSlop={8}>
                    <Text style={e.trocar}>trocar</Text>
                  </Pressable>
                </Cartao>

                {subFalhas.length > 0 && (
                  <>
                    <Text style={e.tituloSecao}>Qual foi o motivo?</Text>
                    {subFalhas.map(s => (
                      <Pressable
                        key={s.id}
                        onPress={() => setSubSel(s.id)}
                        style={[e.opcao, subSel === s.id && e.opcaoAtiva]}
                      >
                        <Text style={[e.opcaoTexto, subSel === s.id && e.opcaoTextoAtivo]}>
                          {s.nome}
                        </Text>
                      </Pressable>
                    ))}
                  </>
                )}

                <TextInput
                  value={obsBaixa} onChangeText={setObsBaixa}
                  placeholder="Observação (opcional)"
                  placeholderTextColor={cor.graf300}
                  style={e.campo}
                />

                <Text style={e.notinha}>
                  A baixa registra a sua coordenada. Depois de confirmada
                  você não consegue trocar o código — só o controlador.
                </Text>

                <Botao
                  titulo="Confirmar baixa" grande
                  carregando={salvando}
                  desativado={subFalhas.length > 0 && !subSel}
                  aoTocar={confirmarBaixa}
                />
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  cabecalho: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  voltar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  voltarTexto: { fontSize: 26, color: cor.graf500, lineHeight: 28 },
  tituloTopo: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  subTopo: { fontSize: 11, color: cor.graf400 },

  conteudo: { padding: 12, gap: 10, paddingBottom: 130 },

  chipGps: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: cor.branco, borderWidth: 1, borderColor: cor.graf200,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
  },
  pontinho: { width: 8, height: 8, borderRadius: 999 },
  chipGpsTexto: { flex: 1, fontSize: 12, color: cor.graf500, fontWeight: '600' },
  chipAcao: { fontSize: 12, color: cor.af600, fontWeight: '700' },

  clienteNome: { fontSize: 14, fontWeight: '600', color: cor.graf500, marginBottom: 4 },
  endereco: { fontSize: 18, fontWeight: '700', color: cor.tinta, lineHeight: 24 },
  enderecoMiudo: { fontSize: 14, color: cor.graf500, marginTop: 2 },

  tituloSecao: { fontSize: 14, fontWeight: '700', color: cor.graf600, marginTop: 6 },
  linhaEntre: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  pendenteTexto: { fontSize: 12, color: cor.ambar, fontWeight: '700', marginTop: 6 },
  vazioLinha: { fontSize: 13, color: cor.graf400, lineHeight: 19 },
  notinha: { fontSize: 12, color: cor.graf400, lineHeight: 17 },

  seq: { fontSize: 11, color: cor.graf300, fontWeight: '700' },
  numeroOs: { fontSize: 15, fontWeight: '800', color: cor.tinta },
  descricaoOs: { fontSize: 14, color: cor.graf600, marginTop: 4, lineHeight: 19 },
  operadora: { fontSize: 12, color: cor.graf400, marginTop: 8 },
  semAcao: { fontSize: 13, color: cor.graf400, marginTop: 10 },

  baixaCaixa: { borderRadius: raio.m, padding: 12, marginTop: 12, gap: 2 },
  baixaTitulo: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  baixaCodigo: { fontSize: 14, fontWeight: '600', color: cor.tinta },
  baixaMiudo: { fontSize: 12, color: cor.graf500 },
  trocar: { fontSize: 13, color: cor.af600, fontWeight: '700', marginTop: 6 },

  galeria: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  miniatura: { width: 104 },
  miniaturaImg: {
    width: 104, height: 104, borderRadius: raio.m,
    backgroundColor: cor.graf100, ...sombraCard,
  },
  miniaturaVideo: { alignItems: 'center', justifyContent: 'center' },
  miniaturaVideoTexto: { color: cor.graf500, fontWeight: '700', fontSize: 13 },
  miniaturaRotulo: { fontSize: 11, fontWeight: '700', color: cor.graf600, marginTop: 4 },
  miniaturaMiudo: { fontSize: 10, color: cor.graf400 },
  semGpsMini: { fontSize: 10, color: cor.ambar, fontWeight: '700' },

  equipLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  equipSelo: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  equipSeloTexto: { fontSize: 11, fontWeight: '800' },
  equipSerial: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  cargaTitulo: { fontSize: 12, fontWeight: '600', color: cor.graf500 },
  cargaLista: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cargaChip: {
    minHeight: TOQUE, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: raio.m, borderWidth: 1, borderColor: cor.graf200,
    backgroundColor: cor.branco, justifyContent: 'center',
  },
  cargaSerial: { fontSize: 13, fontWeight: '700', color: cor.tinta },
  cargaMiudo: { fontSize: 11, color: cor.graf500, maxWidth: 160 },
  equipMiudo: { fontSize: 12, color: cor.graf400 },

  evento: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
  eventoHora: { width: 82, fontSize: 11, color: cor.graf400, paddingTop: 2 },
  eventoTexto: { fontSize: 14, fontWeight: '600', color: cor.tinta },
  eventoLogin: { fontWeight: '400', color: cor.graf400 },
  eventoObs: { fontSize: 12, color: cor.graf500, marginTop: 2 },

  suporte: {
    minHeight: 36, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center',
    borderWidth: 2, borderColor: cor.af600, marginLeft: 6,
  },
  suporteTexto: { fontSize: 13, fontWeight: '800', color: cor.af700 },
  mudarStatus: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  mudarStatusTexto: { fontSize: 15, fontWeight: '700', color: cor.graf600 },
  statusLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52,
    paddingHorizontal: 10, borderRadius: raio.m, borderWidth: 1, borderColor: cor.graf100,
  },
  statusAtual: { backgroundColor: cor.graf50, borderColor: cor.graf300 },
  statusNota: { flex: 1, textAlign: 'right', fontSize: 13, color: cor.graf500 },
  miscQtd: { fontSize: 18, fontWeight: '900', color: cor.tinta },
  miscLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  miscCampo: {
    width: 72, minHeight: 48, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    textAlign: 'center', fontSize: 17, fontWeight: '700', color: cor.tinta, backgroundColor: cor.graf50,
  },

  rodape: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 12, paddingBottom: 26,
    backgroundColor: cor.branco, borderTopWidth: 1, borderTopColor: cor.graf100,
  },

  campo: {
    minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200,
    borderRadius: raio.m, paddingHorizontal: 14, fontSize: 16,
    color: cor.tinta, backgroundColor: cor.branco,
  },

  opcao: {
    minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: 14,
    borderRadius: raio.m, backgroundColor: cor.branco,
    borderWidth: 1, borderColor: cor.graf200,
  },
  opcaoAtiva: { backgroundColor: cor.af600, borderColor: cor.af600 },
  opcaoTexto: { fontSize: 15, fontWeight: '600', color: cor.tinta },
  opcaoTextoAtivo: { color: cor.branco },

  itemCodigo: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: TOQUE, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: cor.branco, borderRadius: raio.m, marginBottom: 6,
    borderWidth: 1, borderColor: cor.graf100,
  },
  itemCodigoNum: { width: 44, fontSize: 15, fontWeight: '800', color: cor.graf500 },
  itemCodigoDesc: { flex: 1, fontSize: 14, color: cor.tinta },
  naturezaSelo: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  naturezaTexto: { fontSize: 10, fontWeight: '800' },
  escolhido: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },

  fundoModal: { flex: 1, backgroundColor: 'rgba(15,17,21,0.4)' },
  centroModal: {
    flex: 1, justifyContent: 'center', padding: 20,
    backgroundColor: 'rgba(15,17,21,0.5)',
  },
  caixaContato: { backgroundColor: cor.branco, borderRadius: 20, padding: 18, gap: 8 },
  perguntaContato: { fontSize: 17, fontWeight: '700', color: cor.tinta, lineHeight: 23 },
  campoTelefone: { fontSize: 22, fontWeight: '700', letterSpacing: 0.5, minHeight: 56 },
  contatoLinha: { fontSize: 14, fontWeight: '600', color: cor.graf600, marginTop: 12 },
  contatoAcao: { fontSize: 14, fontWeight: '700', color: cor.af600, marginTop: 12 },
  folha: {
    backgroundColor: cor.branco, padding: 16, gap: 8,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 28,
  },
  folhaTitulo: { fontSize: 18, fontWeight: '800', color: cor.tinta },
  folhaMiudo: { fontSize: 12, color: cor.graf400, lineHeight: 17, marginBottom: 4 },
  itemFolha: {
    minHeight: TOQUE, justifyContent: 'center', paddingHorizontal: 12,
    borderRadius: raio.m,
  },
  itemFolhaTexto: { fontSize: 16, color: cor.tinta, fontWeight: '600' },
})
