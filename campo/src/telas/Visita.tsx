import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Image, Linking, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  ehTerminal, rotuloEvento, rotuloEvidencia, rotuloSituacao, TIPOS_EVIDENCIA,
} from '../lib/dominio'
import { carimbo, duracao, hhmm, isoLocal, tamanho } from '../lib/formato'
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
}

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
  equipamento_movimento ( id, operacao, serial, tipo, modelo, criado_em, login )
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

  async function coordenada(): Promise<{ lat: number; lng: number } | null> {
    const g = gps?.ok ? gps : await ondeEstou()
    setGps(g)
    if (!g.ok) {
      setErro(`Sem localização — não dá para baixar. ${g.recado}`)
      return null
    }
    return { lat: g.posicao.lat, lng: g.posicao.lng }
  }

  async function etapa(nova: string, observacao?: string) {
    if (!v) return
    setSalvando(true); setErro(null)
    // Encerrar é a mesma afirmação da baixa, pela outra porta: exige GPS.
    const precisaGps = ehCampo && ehTerminal(nova)
    const c = precisaGps ? await coordenada() : (gps?.ok
      ? { lat: gps.posicao.lat, lng: gps.posicao.lng } : null)
    if (precisaGps && !c) { setSalvando(false); return }

    const { error } = await supabase.rpc('registrar_etapa', {
      p_visita: v.id,
      p_situacao: nova,
      p_observacao: observacao?.trim() || null,
      p_lat: c?.lat ?? null,
      p_lng: c?.lng ?? null,
    })
    if (error) setErro(error.message)
    else { setPedindoObs(false); setObsEtapa(''); await recarregar() }
    setSalvando(false)
  }

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
      </View>

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
        </Cartao>

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
          <Botao
            titulo="Lançar equipamento" tom="discreto"
            aoTocar={() => { setEquipAberto(true); setErro(null) }}
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
        </View>
      )}

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
  equipMiudo: { fontSize: 12, color: cor.graf400 },

  evento: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
  eventoHora: { width: 82, fontSize: 11, color: cor.graf400, paddingTop: 2 },
  eventoTexto: { fontSize: 14, fontWeight: '600', color: cor.tinta },
  eventoLogin: { fontWeight: '400', color: cor.graf400 },
  eventoObs: { fontSize: 12, color: cor.graf500, marginTop: 2 },

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
