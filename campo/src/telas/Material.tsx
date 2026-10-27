import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { carimbo, num2 } from '../lib/formato'
import { Aviso, Botao, Carregando, Cartao, TituloSecao } from '../ui/componentes'
import { CabecalhoAba } from '../ui/CabecalhoAba'
import { BarraInferior } from '../ui/BarraInferior'
import { cor, raio, TOQUE } from '../ui/tema'
import type { Pilha } from '../navegacao'

/**
 * Meu material (091) — o que está na mão do técnico, e o canal para dizer
 * "falta" ou "quebrou".
 *
 * ┌─ três gavetas, porque são três coisas diferentes ─────────────────┐
 * │ Ferramental (ferramenta + EPI): o que ele USA e devolve.          │
 * │ Miscelânea (material + acessório): o que ele GASTA no contrato —  │
 * │ sai do saldo dele na baixa (`baixar_miscelanea`).                 │
 * │ Equipamentos: os seriais da CLARO na posse dele (`minha_carga`).  │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Sinalizar NÃO mexe em saldo nem em posse: é um pedido. Posse só se move
 * por documento ou pelo campo na baixa (D-154). O almoxarifado responde,
 * e a resposta volta como aviso na agenda.
 */

type Props = NativeStackScreenProps<Pilha, 'Material'>

interface ItemSaldo { item_id: string; codigo: string | null; nome: string; unidade: string | null; tipo: string | null; saldo: number }
interface Serial { serial: string; tipo: string | null; modelo: string | null; condicao: string | null; dias: number | null }
type TipoFerramental = 'FALTANDO' | 'PERDIDO' | 'DEFEITO' | 'DESGASTADO'
interface Sinalizacao {
  id: string; assunto: 'FERRAMENTAL' | 'VEICULO'; tipo: TipoFerramental | 'VEICULO'
  item: string | null; serial: string | null; problema: string | null; placa: string | null
  descricao: string | null; situacao: 'ABERTA' | 'ATENDIDA' | 'RECUSADA'
  criado_em: string; resolvido_em: string | null; resposta: string | null
}
interface ItemCatalogo { item_id: string; codigo: string | null; nome: string; tipo: string | null }
interface Problema { id: string; rotulo: string; exige_descricao: boolean }

/** 146: os motivos do ferramental — "perdi" e "velho" entraram (D-226). */
const MOTIVO: Record<TipoFerramental | 'VEICULO', string> = {
  FALTANDO: 'Faltando', PERDIDO: 'Perdido', DEFEITO: 'Com defeito',
  DESGASTADO: 'Velho / desgastado', VEICULO: 'Carro',
}
const MOTIVOS_FORM: { tipo: TipoFerramental; rotulo: string }[] = [
  { tipo: 'PERDIDO', rotulo: 'Perdi' },
  { tipo: 'DEFEITO', rotulo: 'Com defeito' },
  { tipo: 'DESGASTADO', rotulo: 'Velho / gasto' },
  { tipo: 'FALTANDO', rotulo: 'Está faltando' },
]

type Gaveta = 'ferramental' | 'miscelanea' | 'equipamentos'
const EH_FERRAMENTAL = (t: string | null) => t === 'FERRAMENTA' || t === 'EPI'

/** O que está sendo sinalizado quando o formulário abre. */
interface Alvo { itemId: string | null; serial: string | null; nome: string | null }

const SITUACAO_SINAL = {
  ABERTA:   { rotulo: 'Aguardando', fundo: cor.ambar50, texto: '#92400e' },
  ATENDIDA: { rotulo: 'Atendida',   fundo: cor.verde50, texto: cor.verde900 },
  RECUSADA: { rotulo: 'Recusada',   fundo: cor.af50,    texto: cor.af700 },
} as const

export default function Material({ navigation }: Props) {
  const [gaveta, setGaveta] = useState<Gaveta>('ferramental')
  const [itens, setItens] = useState<ItemSaldo[]>([])
  const [seriais, setSeriais] = useState<Serial[]>([])
  const [sinais, setSinais] = useState<Sinalizacao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<Alvo | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [carro, setCarro] = useState(false)

  const carregar = useCallback(async () => {
    setErro(null)
    const [a, b, c] = await Promise.all([
      supabase.rpc('minha_miscelanea'),
      supabase.rpc('minha_carga'),
      supabase.rpc('minhas_sinalizacoes'),
    ])
    const falha = a.error ?? b.error ?? c.error
    if (falha) setErro(falha.message)
    setItens((a.data ?? []) as ItemSaldo[])
    setSeriais((b.data ?? []) as Serial[])
    setSinais((c.data ?? []) as Sinalizacao[])
  }, [])

  useEffect(() => { carregar().finally(() => setCarregando(false)) }, [carregar])

  async function puxar() { setAtualizando(true); await carregar(); setAtualizando(false) }

  const ferramental = useMemo(() => itens.filter(i => EH_FERRAMENTAL(i.tipo)), [itens])
  const miscelanea = useMemo(() => itens.filter(i => !EH_FERRAMENTAL(i.tipo)), [itens])
  const abertas = sinais.filter(s => s.situacao === 'ABERTA').length

  const GAVETAS: { chave: Gaveta; rotulo: string; qtd: number }[] = [
    { chave: 'ferramental', rotulo: 'Ferramental', qtd: ferramental.length },
    { chave: 'miscelanea', rotulo: 'Miscelânea', qtd: miscelanea.length },
    { chave: 'equipamentos', rotulo: 'Equipamentos', qtd: seriais.length },
  ]

  const lista = gaveta === 'ferramental' ? ferramental : gaveta === 'miscelanea' ? miscelanea : []

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <CabecalhoAba titulo="Meu material" subtitulo="O que está na sua mão hoje" />

      <View style={e.gavetas}>
        {GAVETAS.map(g => (
          <Pressable key={g.chave} onPress={() => setGaveta(g.chave)}
            accessibilityRole="button" accessibilityState={{ selected: gaveta === g.chave }}
            style={[e.gaveta, gaveta === g.chave && e.gavetaAtiva]}>
            <Text style={[e.gavetaTexto, gaveta === g.chave && e.gavetaTextoAtivo]} numberOfLines={1}>
              {g.rotulo} {carregando ? '' : g.qtd}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={e.conteudo}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={puxar} tintColor={cor.af600} />}>
        {erro && <Aviso tipo="erro">Não consegui carregar tudo: {erro}</Aviso>}
        {ok && <Aviso tipo="ok">{ok}</Aviso>}

        {/* A porta para o que NÃO está na lista: a ferramenta que falta
            não aparece no saldo justamente porque falta. */}
        <Botao titulo="Sinalizar ferramenta que falta" tom="contorno"
          aoTocar={() => { setOk(null); setAlvo({ itemId: null, serial: null, nome: null }) }} />
        {/* 146: o problema do carro mora no mesmo canal — quem responde é a
            coordenação/supervisão, não o almoxarifado (D-226). */}
        <Botao titulo="Problema no carro" tom="contorno"
          aoTocar={() => { setOk(null); setCarro(true) }} />

        {carregando && <Carregando />}

        {!carregando && gaveta !== 'equipamentos' && (
          <Cartao style={{ overflow: 'hidden' }}>
            {lista.length === 0 && (
              <Text style={e.nada}>
                {gaveta === 'ferramental'
                  ? 'Nenhuma ferramenta ou EPI no seu nome. Se você está com alguma, o almoxarifado ainda não lançou.'
                  : 'Nenhum material no seu saldo.'}
              </Text>
            )}
            {lista.map(i => (
              <View key={i.item_id} style={e.linha}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={e.nome} numberOfLines={2}>{i.nome}</Text>
                  <Text style={e.miudo}>
                    {[i.codigo && `cód. ${i.codigo}`, i.tipo?.toLowerCase()].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={e.saldo}>
                  {Number.isInteger(Number(i.saldo)) ? Number(i.saldo) : num2(Number(i.saldo))}
                  <Text style={e.unidade}> {i.unidade ?? 'un'}</Text>
                </Text>
                {gaveta === 'ferramental' && (
                  <Pressable onPress={() => { setOk(null); setAlvo({ itemId: i.item_id, serial: null, nome: i.nome }) }}
                    style={e.sinalizar} accessibilityRole="button"
                    accessibilityLabel={`Sinalizar ${i.nome}`}>
                    <Text style={e.sinalizarTexto}>Sinalizar</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </Cartao>
        )}

        {!carregando && gaveta === 'equipamentos' && (
          <Cartao style={{ overflow: 'hidden' }}>
            {seriais.length === 0 && <Text style={e.nada}>Nenhum equipamento no seu nome.</Text>}
            {seriais.map(s => (
              <View key={s.serial} style={e.linha}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={e.nome}>{s.serial}</Text>
                  <Text style={e.miudo}>
                    {[s.tipo, s.modelo, s.condicao?.toLowerCase().replace('_', ' '),
                      s.dias != null && `${s.dias} dia(s) com você`].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Pressable onPress={() => { setOk(null); setAlvo({ itemId: null, serial: s.serial, nome: s.serial }) }}
                  style={e.sinalizar} accessibilityRole="button" accessibilityLabel={`Sinalizar ${s.serial}`}>
                  <Text style={e.sinalizarTexto}>Defeito</Text>
                </Pressable>
              </View>
            ))}
          </Cartao>
        )}

        <View style={e.atalhos}>
          <Botao titulo="Entregas" tom="discreto" style={{ flex: 1 }}
            aoTocar={() => navigation.navigate('Romaneios')} />
          <Botao titulo="Transferir" tom="discreto" style={{ flex: 1 }}
            aoTocar={() => navigation.navigate('Transferir')} />
        </View>

        <TituloSecao titulo="Minhas sinalizações" extra={abertas ? `${abertas} aguardando` : undefined} />
        {sinais.length === 0 && !carregando && (
          <Text style={[e.nada, { paddingHorizontal: 2 }]}>Você ainda não sinalizou nada.</Text>
        )}
        {sinais.map(s => {
          const st = SITUACAO_SINAL[s.situacao]
          return (
            <Cartao key={s.id} style={{ padding: 12, gap: 4 }}>
              <View style={e.linhaTopo}>
                <Text style={e.sinalTipo}>{MOTIVO[s.tipo] ?? s.tipo}</Text>
                <View style={[e.chip, { backgroundColor: st.fundo }]}>
                  <Text style={[e.chipTexto, { color: st.texto }]}>{st.rotulo}</Text>
                </View>
              </View>
              <Text style={e.nome}>
                {s.assunto === 'VEICULO'
                  ? `${s.problema ?? 'Problema'} · ${s.placa ?? 'sem carro no cadastro'}`
                  : s.item ?? s.serial ?? s.descricao ?? '—'}
              </Text>
              {s.descricao && (s.item || s.serial || s.problema) ? <Text style={e.miudo}>{s.descricao}</Text> : null}
              {s.resposta ? <Text style={e.resposta}>Resposta: “{s.resposta}”</Text> : null}
              <Text style={e.miudo}>{carimbo(s.criado_em)}</Text>
            </Cartao>
          )
        })}
      </ScrollView>

      {alvo && (
        <FormSinalizar alvo={alvo} fechar={() => setAlvo(null)}
          pronto={async msg => { setAlvo(null); setOk(msg); await carregar() }} />
      )}
      {carro && (
        <FormVeiculo fechar={() => setCarro(false)}
          pronto={async msg => { setCarro(false); setOk(msg); await carregar() }} />
      )}
      <BarraInferior ativa="Material" />
    </SafeAreaView>
  )
}

/** O formulário de sinalizar, numa folha de baixo para cima. */
function FormSinalizar({ alvo, fechar, pronto }: {
  alvo: Alvo; fechar: () => void; pronto: (msg: string) => void
}) {
  // Serial só quebra; item da lista pode faltar (sumiu) ou quebrar; a
  // ferramenta "que falta" só falta.
  const [tipo, setTipo] = useState<TipoFerramental>(alvo.serial ? 'DEFEITO' : alvo.itemId ? 'DEFEITO' : 'FALTANDO')
  const [descricao, setDescricao] = useState('')
  const [busca, setBusca] = useState('')
  const [catalogo, setCatalogo] = useState<ItemCatalogo[] | null>(null)
  const [escolhido, setEscolhido] = useState<ItemCatalogo | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const livre = !alvo.itemId && !alvo.serial

  useEffect(() => {
    if (!livre) return
    supabase.rpc('catalogo_para_o_campo').then(({ data }) =>
      setCatalogo(((data ?? []) as ItemCatalogo[]).filter(i => EH_FERRAMENTAL(i.tipo))))
  }, [livre])

  const achados = useMemo(() => {
    if (!catalogo || busca.trim().length < 2) return []
    const q = busca.trim().toLowerCase()
    return catalogo.filter(i => i.nome.toLowerCase().includes(q) || (i.codigo ?? '').includes(q)).slice(0, 8)
  }, [catalogo, busca])

  async function enviar() {
    setErro(null)
    const itemId = alvo.itemId ?? escolhido?.item_id ?? null
    if (!itemId && !alvo.serial && !descricao.trim()) {
      setErro('Diga o que é: escolha a ferramenta na lista ou descreva.')
      return
    }
    setEnviando(true)
    const { error } = await supabase.rpc('sinalizar_material', {
      p_tipo: tipo, p_item_id: itemId, p_serial: alvo.serial, p_descricao: descricao.trim() || null,
    })
    setEnviando(false)
    if (error) { setErro(error.message); return }
    pronto('Sinalizado. O almoxarifado e a coordenação recebem agora, e a resposta chega na sua agenda.')
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={fechar}>
      <Pressable style={e.veu} onPress={fechar} accessibilityLabel="Fechar" />
      <View style={e.folha}>
        <Text style={e.folhaTitulo}>{alvo.nome ? `Sinalizar: ${alvo.nome}` : 'Sinalizar ferramenta que falta'}</Text>

        {!alvo.serial && (
          <View style={e.escolha}>
            {MOTIVOS_FORM.map(({ tipo: t, rotulo }) => (
              <Pressable key={t} onPress={() => setTipo(t)}
                accessibilityRole="radio" accessibilityState={{ checked: tipo === t }}
                style={[e.opcao, tipo === t && e.opcaoAtiva]}>
                <Text style={[e.opcaoTexto, tipo === t && { color: cor.branco }]}>{rotulo}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {livre && (<>
          {escolhido ? (
            <Pressable onPress={() => setEscolhido(null)} style={e.escolhido}>
              <Text style={e.nome}>{escolhido.nome}</Text>
              <Text style={e.miudo}>tocar para trocar</Text>
            </Pressable>
          ) : (<>
            <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar ferramenta pelo nome…"
              placeholderTextColor={cor.graf500} style={e.campo} accessibilityLabel="Buscar ferramenta" />
            {catalogo == null && <Text style={e.miudo}>Carregando a lista…</Text>}
            {achados.map(i => (
              <Pressable key={i.item_id} onPress={() => { setEscolhido(i); setBusca('') }} style={e.achado}>
                <Text style={e.nome} numberOfLines={1}>{i.nome}</Text>
                <Text style={e.miudo}>{i.codigo ? `cód. ${i.codigo}` : ''}</Text>
              </Pressable>
            ))}
          </>)}
        </>)}

        <TextInput value={descricao} onChangeText={setDescricao} multiline maxLength={500}
          placeholder={tipo === 'DEFEITO' ? 'O que aconteceu? (ex.: mola do alicate quebrou)'
            : tipo === 'PERDIDO' ? 'Onde ou como? (ex.: ficou no cliente)'
            : tipo === 'DESGASTADO' ? 'O que está gasto? (ex.: degrau da escada frouxo)'
            : 'Algo a mais? (ex.: preciso até amanhã)'}
          placeholderTextColor={cor.graf500} style={[e.campo, { minHeight: 80, textAlignVertical: 'top' }]}
          accessibilityLabel="Descrição" />

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Botao titulo="Cancelar" tom="contorno" style={{ flex: 1 }} aoTocar={fechar} />
          <Botao titulo="Enviar" style={{ flex: 1 }} carregando={enviando} aoTocar={enviar} />
        </View>
      </View>
    </Modal>
  )
}

/**
 * O problema do carro (146, D-226). O carro é o que está no NOME dele —
 * o banco acha (`sinalizar_veiculo`), a tela só mostra qual é. Sem carro
 * no cadastro a ocorrência entra mesmo assim: o defeito não fica sem
 * registro por falta de cadastro.
 */
function FormVeiculo({ fechar, pronto }: { fechar: () => void; pronto: (msg: string) => void }) {
  const [problemas, setProblemas] = useState<Problema[] | null>(null)
  const [placa, setPlaca] = useState<string | null | undefined>(undefined)
  const [escolhido, setEscolhido] = useState<Problema | null>(null)
  const [descricao, setDescricao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('problema_veiculo').select('id, rotulo, exige_descricao')
      .eq('ativo', true).order('ordem')
      .then(({ data, error }) => {
        if (error) setErro(error.message)
        setProblemas((data ?? []) as Problema[])
      })
    supabase.rpc('meu_veiculo').then(({ data }) => {
      const v = (data ?? [])[0] as { placa: string | null } | undefined
      setPlaca(v?.placa ?? null)
    })
  }, [])

  async function enviar() {
    setErro(null)
    if (!escolhido) { setErro('Escolha o que está acontecendo com o carro.'); return }
    if (escolhido.exige_descricao && !descricao.trim()) { setErro('Descreva o problema.'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('sinalizar_veiculo', {
      p_problema_id: escolhido.id, p_descricao: descricao.trim() || null,
    })
    setEnviando(false)
    if (error) { setErro(error.message); return }
    pronto('Enviado. A coordenação recebe agora, e a resposta chega na sua agenda.')
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={fechar}>
      <Pressable style={e.veu} onPress={fechar} accessibilityLabel="Fechar" />
      <View style={[e.folha, { maxHeight: '88%' }]}>
        <Text style={e.folhaTitulo}>Problema no carro</Text>
        <Text style={e.miudo}>
          {placa === undefined ? 'Procurando o seu carro…'
            : placa ? `Carro no seu nome: ${placa}`
            : 'Nenhum carro no seu nome no cadastro — envie assim mesmo.'}
        </Text>
        <ScrollView contentContainerStyle={e.escolha}>
          {problemas == null && <Text style={e.miudo}>Carregando a lista…</Text>}
          {problemas?.map(p => {
            const marcado = escolhido?.id === p.id
            return (
              <Pressable key={p.id} onPress={() => setEscolhido(p)}
                accessibilityRole="radio" accessibilityState={{ checked: marcado }}
                style={[e.opcao, marcado && e.opcaoAtiva]}>
                <Text style={[e.opcaoTexto, { textAlign: 'center' }, marcado && { color: cor.branco }]}>
                  {p.rotulo}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
        <TextInput value={descricao} onChangeText={setDescricao} multiline maxLength={500}
          placeholder={escolhido?.exige_descricao ? 'Descreva o problema (obrigatório)'
            : 'Algo a mais? (ex.: luz do painel acendeu ontem)'}
          placeholderTextColor={cor.graf500} style={[e.campo, { minHeight: 70, textAlignVertical: 'top' }]}
          accessibilityLabel="Descrição" />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Botao titulo="Cancelar" tom="contorno" style={{ flex: 1 }} aoTocar={fechar} />
          <Botao titulo="Enviar" style={{ flex: 1 }} carregando={enviando} aoTocar={enviar} />
        </View>
      </View>
    </Modal>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  gavetas: {
    flexDirection: 'row', gap: 6, padding: 8,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  gaveta: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: raio.s, backgroundColor: cor.graf50, paddingHorizontal: 4,
  },
  gavetaAtiva: { backgroundColor: cor.tinta },
  gavetaTexto: { fontSize: 13, fontWeight: '700', color: cor.graf500 },
  gavetaTextoAtivo: { color: cor.branco },
  conteudo: { padding: 12, gap: 10, paddingBottom: 32 },
  nada: { fontSize: 14, color: cor.graf500, padding: 14, lineHeight: 20 },
  linha: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60,
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nome: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  miudo: { fontSize: 12, color: cor.graf500, marginTop: 1 },
  saldo: { fontSize: 18, fontWeight: '900', color: cor.tinta, fontVariant: ['tabular-nums'] },
  unidade: { fontSize: 12, fontWeight: '600', color: cor.graf500 },
  sinalizar: {
    minHeight: 44, paddingHorizontal: 12, borderRadius: raio.s, justifyContent: 'center',
    borderWidth: 1, borderColor: cor.graf200,
  },
  sinalizarTexto: { fontSize: 13, fontWeight: '700', color: cor.af700 },
  atalhos: { flexDirection: 'row', gap: 8 },
  sinalTipo: { fontSize: 12, fontWeight: '800', color: cor.graf600, textTransform: 'uppercase', letterSpacing: 0.6 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipTexto: { fontSize: 12, fontWeight: '800' },
  resposta: { fontSize: 14, color: cor.tinta, fontStyle: 'italic', marginTop: 2 },

  veu: { flex: 1, backgroundColor: 'rgba(15,17,21,0.45)' },
  folha: {
    backgroundColor: cor.branco, padding: 16, gap: 10,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  folhaTitulo: { fontSize: 17, fontWeight: '800', color: cor.tinta },
  // 146: quatro motivos — duas linhas de dois, alvo de toque inteiro.
  escolha: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcao: {
    flexGrow: 1, flexBasis: '45%', minHeight: TOQUE, borderRadius: raio.m, borderWidth: 2, borderColor: cor.graf200,
    alignItems: 'center', justifyContent: 'center',
  },
  opcaoAtiva: { backgroundColor: cor.tinta, borderColor: cor.tinta },
  opcaoTexto: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  campo: {
    minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: cor.tinta, backgroundColor: cor.graf50,
  },
  achado: { paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: cor.graf100 },
  escolhido: { padding: 12, borderRadius: raio.m, backgroundColor: cor.verde50, borderWidth: 1, borderColor: cor.verde },
})
