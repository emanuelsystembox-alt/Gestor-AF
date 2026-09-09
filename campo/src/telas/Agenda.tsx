import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { EM_ABERTO } from '../lib/dominio'
import {
  hhmm, isoLocal, num2, pts, reais, rotuloDoDia, somarDias,
} from '../lib/formato'
import { ondeEstou, type EstadoGps } from '../lib/gps'
import { quantosPendentes, sincronizar } from '../lib/midia'
import { Aviso, Botao, Carregando, Cartao, Etiqueta, Vazio } from '../ui/componentes'
import { cor, raio, sombraCard } from '../ui/tema'
import type { Pilha } from '../navegacao'

export interface LinhaAgenda {
  visita_id: string
  contrato: string | null
  wo_numero: string | null
  cliente_nome: string | null
  logradouro: string | null
  complemento: string | null
  bairro: string | null
  cep: string | null
  /** Nó da rede da CLARO. O técnico usa para saber em que pedaço da
   *  planta está e para abrir chamado com a operadora. */
  node: string | null
  telefones: string[] | null
  lat: number | null
  lng: number | null
  janela_inicio: string | null
  janela_fim: string | null
  situacao: string
  data_agendada: string
  servico: string
  os_total: number
  os_baixadas: number
  evidencias: number
  equipamentos: number
  /** `pontos_claro` — o MESMO número que a produção do mês soma. NULO
   *  quando não há regra para a combinação: 125 das 364 visitas de
   *  09/09 caem nisso, e mostrar 0,00 nelas seria afirmar que o serviço
   *  não vale nada. Ver D-117. */
  pontos: number | null
  pontos_achou: boolean
}

interface Producao {
  tecnico_id: string | null
  pontos: number
  concluidas: number
  dias: number
  meta: number | null
  fator: number | null
  valor: number | null
}

function mesCorrente() {
  const h = new Date()
  return {
    de: isoLocal(new Date(h.getFullYear(), h.getMonth(), 1)),
    ate: isoLocal(new Date(h.getFullYear(), h.getMonth() + 1, 0)),
  }
}

type Props = NativeStackScreenProps<Pilha, 'Agenda'>

export default function Agenda({ navigation }: Props) {
  const { perfil, sair } = useAuth()
  const [data, setData] = useState(isoLocal())
  const [linhas, setLinhas] = useState<LinhaAgenda[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<'abertas' | 'feitas'>('abertas')
  const [producao, setProducao] = useState<Producao | null>(null)
  const [gps, setGps] = useState<EstadoGps | null>(null)
  const [pendentes, setPendentes] = useState(0)

  const carregar = useCallback(async (dia: string) => {
    setErro(null)
    const { data: d, error } = await supabase.rpc('agenda_do_campo', { p_data: dia })
    if (error) setErro(error.message)
    else setLinhas((d ?? []) as LinhaAgenda[])
  }, [])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    carregar(data).finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [data, carregar])

  // A agenda muda enquanto o técnico está na rua: o controlador
  // transfere, o TOA reimporta. Voltar da tela do contrato tem de
  // trazer o dado novo, não o de dez minutos atrás.
  useEffect(
    () => navigation.addListener('focus', () => {
      carregar(data)
      quantosPendentes().then(setPendentes)
    }),
    [navigation, data, carregar],
  )

  useEffect(() => { ondeEstou().then(setGps) }, [])

  useEffect(() => {
    if (!perfil?.tecnico_id) return
    const m = mesCorrente()
    supabase.rpc('produtividade_periodo', { p_de: m.de, p_ate: m.ate })
      .then(({ data: d }) => {
        const minha = ((d ?? []) as Producao[]).find(x => x.tecnico_id === perfil.tecnico_id)
        setProducao(minha ?? null)
      })
  }, [perfil?.tecnico_id])

  const { abertas, feitas } = useMemo(() => ({
    abertas: linhas.filter(l => EM_ABERTO.includes(l.situacao)),
    feitas: linhas.filter(l => !EM_ABERTO.includes(l.situacao)),
  }), [linhas])

  const lista = aba === 'abertas' ? abertas : feitas
  const ehHoje = data === isoLocal()

  async function puxar() {
    setAtualizando(true)
    const r = await sincronizar()
    await carregar(data)
    setPendentes(r.restam)
    setGps(await ondeEstou())
    setAtualizando(false)
  }

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <View style={e.cabecalho}>
        <View style={e.logo}><Text style={e.logoTexto}>AF</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={e.nome} numberOfLines={1}>{perfil?.nome ?? 'Técnico'}</Text>
          {/* O login aparece porque é ele que vai no histórico de cada
              etapa que o técnico registrar. */}
          <Text style={e.email} numberOfLines={1}>{perfil?.email ?? ''}</Text>
        </View>
        <Pressable onPress={sair} style={e.sair} hitSlop={8}>
          <Text style={e.sairTexto}>Sair</Text>
        </Pressable>
      </View>

      <View style={e.barraDia}>
        <Pressable onPress={() => setData(somarDias(data, -1))} style={e.seta} hitSlop={10}>
          <Text style={e.setaTexto}>‹</Text>
        </Pressable>
        <Pressable onPress={() => setData(isoLocal())} style={{ flex: 1 }}>
          <Text style={e.dia}>{rotuloDoDia(data)}</Text>
        </Pressable>
        <Pressable onPress={() => setData(somarDias(data, 1))} style={e.seta} hitSlop={10}>
          <Text style={e.setaTexto}>›</Text>
        </Pressable>
      </View>

      <View style={e.abas}>
        <Pressable
          onPress={() => setAba('abertas')}
          style={[e.aba, aba === 'abertas' && e.abaAtiva]}
        >
          <Text style={[e.abaTexto, aba === 'abertas' && e.abaTextoAtivo]}>
            A fazer {abertas.length}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setAba('feitas')}
          style={[e.aba, aba === 'feitas' && e.abaAtiva]}
        >
          <Text style={[e.abaTexto, aba === 'feitas' && e.abaTextoAtivo]}>
            Baixadas {feitas.length}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={e.conteudo}
        refreshControl={
          <RefreshControl refreshing={atualizando} onRefresh={puxar} tintColor={cor.af600} />
        }
      >
        {erro && <Aviso tipo="erro">Não consegui carregar: {erro}</Aviso>}

        {/* O estado do GPS fica visível o tempo todo, e não só na hora
            da baixa. Descobrir que a localização estava desligada
            quando você já está com o cliente esperando é tarde. */}
        {gps && !gps.ok && (
          <Aviso tipo="atencao">
            Localização desligada — você não vai conseguir dar baixa. {gps.recado}
          </Aviso>
        )}

        {pendentes > 0 && (
          <Cartao style={e.pendentes}>
            <Text style={e.pendentesTexto}>
              {pendentes} evidência(s) esperando sinal para subir.
            </Text>
            <Botao titulo="Tentar agora" tom="contorno" aoTocar={puxar} />
          </Cartao>
        )}

        {producao && (() => {
          const p = Number(producao.pontos)
          const alvo = Number(producao.meta ?? 0)
          const pct = alvo > 0 ? Math.min(100, (p / alvo) * 100) : 0
          const falta = Math.max(0, alvo - p)
          return (
            <Cartao style={{ padding: 16 }}>
              <View style={e.linhaEntre}>
                <Text style={e.tituloSecao}>Minha produção no mês</Text>
                <Text style={e.miudo}>
                  {producao.concluidas} concluída(s) · {producao.dias} dia(s)
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 6 }}>
                <Text style={e.numeraoGrande}>{num2(p)}</Text>
                <Text style={[e.miudo, { paddingBottom: 4 }]}>de {num2(alvo)} pts</Text>
              </View>
              <View style={e.trilho}>
                <View style={[e.progresso, { width: `${pct}%` }]} />
              </View>
              <Text style={e.miudoEscuro}>
                {producao.fator == null
                  ? `Faltam ${pts(falta)} para entrar na primeira faixa.`
                  : `Fator ${num2(Number(producao.fator))} · a receber ${reais(producao.valor)}`}
              </Text>
              <Text style={e.notinha}>
                Só entra contrato concluído. É prévia do mês em andamento.
              </Text>
            </Cartao>
          )
        })()}

        {carregando && <Carregando />}

        {!carregando && lista.length === 0 && (
          <Vazio
            titulo={aba === 'feitas' ? 'Nada baixado neste dia' : 'Nenhuma visita pendente'}
            descricao={aba === 'feitas'
              ? 'O que você fechar aparece aqui — e você ainda pode anexar foto no mesmo dia.'
              : 'Sua agenda deste dia está limpa.'}
          />
        )}

        {lista.map(l => (
          <Pressable
            key={l.visita_id}
            onPress={() => navigation.navigate('Visita', { id: l.visita_id })}
            style={({ pressed }) => [e.card, pressed && { opacity: 0.85 }]}
          >
            <View style={e.linhaTopo}>
              {l.janela_inicio && (
                <Text style={e.janela}>
                  {hhmm(l.janela_inicio)}{l.janela_fim ? `–${hhmm(l.janela_fim)}` : ''}
                </Text>
              )}
              <Etiqueta situacao={l.situacao} />

              {/* Quanto vale, onde o olho cai primeiro. É o mesmo número
                  que a produção do mês soma — dois valores diferentes na
                  mesma tela seriam lidos como erro, e com razão. */}
              <View style={e.espaco} />
              {l.pontos_achou
                ? <Text style={e.pontos}>{num2(Number(l.pontos))} pts</Text>
                : <Text style={e.semPontos}>sem regra</Text>}
            </View>

            <Text style={e.servico}>{l.servico}</Text>

            {/* Contrato e node deixaram de ser letra miúda cinza: o
                contrato é o que o técnico fala ao telefone com o COP, e
                o node é o pedaço da planta onde ele está. */}
            <View style={e.linhaIds}>
              {l.contrato && (
                <Text style={e.identificador}>
                  <Text style={e.rotuloId}>contrato </Text>{l.contrato}
                </Text>
              )}
              {l.node && (
                <Text style={e.identificador}>
                  <Text style={e.rotuloId}>node </Text>{l.node}
                </Text>
              )}
            </View>

            {l.cliente_nome && <Text style={e.cliente}>{l.cliente_nome}</Text>}
            {l.logradouro && (
              <Text style={e.endereco}>
                {l.logradouro}{l.bairro ? ` · ${l.bairro}` : ''}
              </Text>
            )}

            <View style={e.selos}>
              {/* "3 O.S." não diz o que falta fazer. "1 de 3 baixadas" diz. */}
              <View style={[
                e.selo,
                l.os_baixadas === l.os_total && l.os_total > 0
                  ? { backgroundColor: cor.verde50 } : { backgroundColor: cor.af50 },
              ]}>
                <Text style={[
                  e.seloTexto,
                  { color: l.os_baixadas === l.os_total && l.os_total > 0 ? cor.verde900 : cor.af700 },
                ]}>
                  {l.os_baixadas} de {l.os_total} O.S. baixadas
                </Text>
              </View>
              {l.evidencias > 0 && (
                <View style={[e.selo, { backgroundColor: cor.graf50 }]}>
                  <Text style={[e.seloTexto, { color: cor.graf500 }]}>
                    {l.evidencias} evidência(s)
                  </Text>
                </View>
              )}
              {l.equipamentos > 0 && (
                <View style={[e.selo, { backgroundColor: cor.graf50 }]}>
                  <Text style={[e.seloTexto, { color: cor.graf500 }]}>
                    {l.equipamentos} equipamento(s)
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        ))}

        {!ehHoje && lista.length > 0 && aba === 'feitas' && (
          <Text style={e.notinha}>
            Contrato de outro dia é só leitura para o campo — anexo e baixa
            só valem no dia. Fale com o controlador.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  cabecalho: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  logo: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: cor.af600,
    alignItems: 'center', justifyContent: 'center',
  },
  logoTexto: { color: cor.branco, fontWeight: '800', fontSize: 14 },
  nome: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  email: { fontSize: 11, color: cor.graf400 },
  sair: { paddingHorizontal: 10, paddingVertical: 8 },
  sairTexto: { color: cor.graf500, fontSize: 14, fontWeight: '600' },

  barraDia: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: cor.branco, paddingHorizontal: 8, paddingBottom: 6,
  },
  seta: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  setaTexto: { fontSize: 28, color: cor.graf400, lineHeight: 30 },
  dia: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: cor.tinta },

  abas: {
    flexDirection: 'row', gap: 6, padding: 8,
    backgroundColor: cor.branco, borderBottomWidth: 1, borderBottomColor: cor.graf100,
  },
  aba: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: raio.s, backgroundColor: cor.graf50,
  },
  abaAtiva: { backgroundColor: cor.tinta },
  abaTexto: { fontSize: 14, fontWeight: '700', color: cor.graf500 },
  abaTextoAtivo: { color: cor.branco },

  conteudo: { padding: 12, gap: 10, paddingBottom: 40 },

  pendentes: { padding: 14, gap: 10 },
  pendentesTexto: { fontSize: 14, fontWeight: '600', color: cor.graf600 },

  card: {
    backgroundColor: cor.branco, borderWidth: 1, borderColor: cor.graf200,
    borderRadius: raio.g, padding: 14, gap: 2, ...sombraCard,
  },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  janela: {
    fontSize: 14, fontWeight: '800', color: cor.tinta,
    backgroundColor: cor.graf50, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, overflow: 'hidden',
  },
  espaco: { flex: 1 },
  pontos: { fontSize: 15, fontWeight: '800', color: cor.tinta },
  semPontos: { fontSize: 12, fontWeight: '700', color: cor.ambar },

  servico: { fontSize: 16, fontWeight: '700', color: cor.tinta },
  linhaIds: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  identificador: { fontSize: 13, fontWeight: '600', color: cor.graf600 },
  rotuloId: { fontWeight: '400', color: cor.graf400 },
  cliente: { fontSize: 14, color: cor.graf600, marginTop: 2 },
  endereco: { fontSize: 14, color: cor.graf500, marginTop: 3, lineHeight: 19 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  selo: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  seloTexto: { fontSize: 12, fontWeight: '700' },

  linhaEntre: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  tituloSecao: { fontSize: 14, fontWeight: '700', color: cor.graf600 },
  miudo: { fontSize: 12, color: cor.graf400 },
  miudoEscuro: { fontSize: 13, color: cor.graf600, marginTop: 6 },
  notinha: { fontSize: 11, color: cor.graf400, marginTop: 4, lineHeight: 16 },
  numeraoGrande: { fontSize: 32, fontWeight: '800', color: cor.tinta, lineHeight: 34 },
  trilho: {
    height: 8, borderRadius: 999, backgroundColor: cor.graf100,
    overflow: 'hidden', marginTop: 10,
  },
  progresso: { height: 8, borderRadius: 999, backgroundColor: cor.af600 },

})
