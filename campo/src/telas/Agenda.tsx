import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View,
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
import {
  assinarAvisos, carregarAvisos, marcarLidos, PESO_AVISO, type Aviso as AvisoCampo,
} from '../lib/avisos'
import { Aviso, Botao, Carregando, Cartao, Etiqueta, Marca, Vazio } from '../ui/componentes'
import { PainelAvisos } from '../ui/PainelAvisos'
import { SeloOuvidoria, SeloSegmento, SeloTec1 } from '../ui/MarcasCliente'
import { useEstadoRastro } from '../lib/useRastro'
import { BarraInferior } from '../ui/BarraInferior'
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
  /** Os sinais que o controlador já vê na central (124): o segmento como
   *  o TOA mandou, a ouvidoria (nula = a linha não trouxe), o TEC1 (nulo
   *  = o TOA ainda não encerrou) e o produto pendente de cada O.S. */
  segmento: string | null
  ouvidoria: boolean | null
  tec1: string | null
  produtos: string[] | null
  /** Como o TOA chama a atividade (Instalacao, Mudanca de Pacote…) e a
   *  etiqueta GPON (D-188) — o que a coluna GRUPO da central mostra (125). */
  tipo_atividade: string | null
  tecnologia: string | null
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
  const { perfil, equipeId, equipeCodigo, matricula, sair } = useAuth()
  const rastro = useEstadoRastro()
  const [data, setData] = useState(isoLocal())
  const [linhas, setLinhas] = useState<LinhaAgenda[]>([])
  const [carregando, setCarregando] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  /**
   * Três abas (Emanuel, 27/09): o que ainda vai fazer, o que está fazendo
   * AGORA (em rota ou iniciado) e o que já baixou. O "agora" separado é o
   * que ele procura com o celular na mão, na porta do cliente.
   */
  const [aba, setAba] = useState<'abertas' | 'andamento' | 'feitas'>('abertas')
  // Solicitar suporte técnico (= Impedimento, D-168).
  const [suporteAberto, setSuporteAberto] = useState(false)
  const [suporteVisita, setSuporteVisita] = useState<string | null>(null)
  const [suporteTexto, setSuporteTexto] = useState('')
  const [suporteEnviando, setSuporteEnviando] = useState(false)
  const [suporteErro, setSuporteErro] = useState<string | null>(null)
  const [suporteOk, setSuporteOk] = useState<string | null>(null)
  const [producao, setProducao] = useState<Producao | null>(null)
  const [gps, setGps] = useState<EstadoGps | null>(null)
  const [pendentes, setPendentes] = useState(0)
  const [avisos, setAvisos] = useState<AvisoCampo[]>([])
  const [sinoAberto, setSinoAberto] = useState(false)

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

  // Os avisos vêm por dois caminhos, e os dois são necessários:
  // a leitura traz o que aconteceu enquanto o aplicativo estava
  // fechado ou sem sinal; a assinatura traz o que acontecer agora.
  const soNaoLidos = (lista: AvisoCampo[]) => lista.filter(a => !a.lido)

  useEffect(() => {
    let vivo = true
    carregarAvisos().then(l => { if (vivo) setAvisos(soNaoLidos(l)) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!equipeId) return
    // O cancelamento no cleanup não é opcional: canal aberto depois da
    // tela morrer é conexão pendurada no servidor.
    return assinarAvisos(equipeId, novo => {
      setAvisos(atual => atual.some(a => a.id === novo.id) ? atual : [novo, ...atual])
      // O aviso mudou o dia dele — a lista embaixo tem de acompanhar.
      carregar(data)
    })
  }, [equipeId, data, carregar])

  function abrirAviso(a: AvisoCampo) {
    dispensar([a.id])
    if (a.visita_id) navigation.navigate('Visita', { id: a.visita_id })
  }

  async function dispensar(ids: number[]) {
    setAvisos(atual => atual.filter(a => !ids.includes(a.id)))
    await marcarLidos(ids).catch(() => {})
  }

  useEffect(() => {
    if (!perfil?.tecnico_id) return
    const m = mesCorrente()
    supabase.rpc('produtividade_periodo', { p_de: m.de, p_ate: m.ate })
      .then(({ data: d }) => {
        const minha = ((d ?? []) as Producao[]).find(x => x.tecnico_id === perfil.tecnico_id)
        setProducao(minha ?? null)
      })
  }, [perfil?.tecnico_id])

  const ANDAMENTO = ['EM_DESLOCAMENTO', 'EM_EXECUCAO']
  const { abertas, andamento, feitas } = useMemo(() => ({
    abertas: linhas.filter(l => EM_ABERTO.includes(l.situacao) && !ANDAMENTO.includes(l.situacao)),
    andamento: linhas.filter(l => ANDAMENTO.includes(l.situacao)),
    feitas: linhas.filter(l => !EM_ABERTO.includes(l.situacao)),
  }), [linhas])

  const lista = aba === 'abertas' ? abertas : aba === 'andamento' ? andamento : feitas

  function abrirSuporte() {
    setSuporteErro(null); setSuporteTexto('')
    // O contrato em andamento é o provável; se não houver, ele escolhe.
    setSuporteVisita(andamento[0]?.visita_id ?? abertas[0]?.visita_id ?? null)
    setSuporteAberto(true)
  }

  async function enviarSuporte() {
    if (!suporteVisita || !suporteTexto.trim()) return
    setSuporteEnviando(true); setSuporteErro(null)
    const { error } = await supabase.rpc('registrar_etapa', {
      p_visita: suporteVisita, p_situacao: 'COM_IMPEDIMENTO',
      p_observacao: `Suporte técnico: ${suporteTexto.trim()}`, p_lat: null, p_lng: null,
    })
    setSuporteEnviando(false)
    if (error) { setSuporteErro(error.message); return }
    setSuporteAberto(false)
    setSuporteOk('Suporte solicitado. O controlador recebeu o aviso na central.')
    carregar(data)
  }
  const ehHoje = data === isoLocal()

  async function puxar() {
    setAtualizando(true)
    const r = await sincronizar()
    await carregar(data)
    await carregarAvisos().then(l => setAvisos(soNaoLidos(l))).catch(() => {})
    setPendentes(r.restam)
    setGps(await ondeEstou())
    setAtualizando(false)
  }

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <View style={e.cabecalho}>
        <Marca tamanho={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={e.nome} numberOfLines={1}>{perfil?.nome ?? 'Técnico'}</Text>
          {/* O número da equipe é o que o COP fala no rádio (Emanuel, 24/10);
              a matrícula é o login que vai no histórico de cada etapa. */}
          {(!!equipeCodigo || !!matricula) && (
            <Text style={e.equipe} numberOfLines={1}>
              {[equipeCodigo && `Equipe ${equipeCodigo}`, matricula].filter(Boolean).join(' · ')}
            </Text>
          )}
          {/* O login aparece porque é ele que vai no histórico de cada
              etapa que o técnico registrar. */}
          <Text style={e.email} numberOfLines={1}>{perfil?.email ?? ''}</Text>
        </View>
        {/* A porta do romaneio fica no cabecalho, nao na agenda: nao e
            trabalho do dia, e conferencia de material -- e a agenda
            continua sendo a primeira coisa que ele ve (D-112). */}
        {/* "Solicitar suporte técnico" (Emanuel, 27/09): o botão de ajuda.
            É o Impedimento — cai direto na central do controlador. O
            Material que ficava aqui foi para a barra de baixo. */}
        {/* O sino (Emanuel, 24/10): o número é o que ele ainda não leu. */}
        <Pressable onPress={() => setSinoAberto(true)} style={e.sino} hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={avisos.length ? `${avisos.length} avisos não lidos` : 'Avisos'}>
          <Text style={e.sinoIcone}>🔔</Text>
          {avisos.length > 0 && (
            <View style={e.sinoBolha}>
              <Text style={e.sinoNumero}>{avisos.length > 99 ? '99+' : avisos.length}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={abrirSuporte} style={e.suporte} hitSlop={8}
          accessibilityRole="button" accessibilityLabel="Solicitar suporte técnico">
          <Text style={e.suporteTexto}>Suporte</Text>
        </Pressable>
        <Pressable onPress={sair} style={e.sair} hitSlop={8}>
          <Text style={e.sairTexto}>Sair</Text>
        </Pressable>
      </View>

      {/* ---------- o sino ---------- */}
      <Modal visible={sinoAberto} transparent animationType="slide"
        onRequestClose={() => setSinoAberto(false)}>
        <Pressable style={e.veu} onPress={() => setSinoAberto(false)} />
        <View style={[e.folha, { maxHeight: '80%' }]}>
          <Text style={e.folhaTitulo}>Avisos</Text>
          {avisos.length === 0
            ? <Text style={e.folhaMiudo}>Nada novo. O que mudar no seu trabalho aparece aqui.</Text>
            : (
              <PainelAvisos
                avisos={avisos}
                aoAbrir={a => { setSinoAberto(false); abrirAviso(a) }}
                aoDispensar={a => dispensar([a.id])}
                aoDispensarTodos={() => dispensar(avisos.map(a => a.id))}
              />
            )}
          <Botao titulo="Fechar" tom="contorno" aoTocar={() => setSinoAberto(false)} />
        </View>
      </Modal>

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
          onPress={() => setAba('andamento')}
          style={[e.aba, aba === 'andamento' && e.abaAtiva]}
        >
          <Text style={[e.abaTexto, aba === 'andamento' && e.abaTextoAtivo]}
                numberOfLines={2}>
            Em rota / Iniciado {andamento.length}
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
        {suporteOk && <Aviso tipo="ok">{suporteOk}</Aviso>}

        {/* Os avisos moram no sino (Emanuel, 24/10). Na agenda só fica o
            que muda o que ele faz AGORA: "a operadora cancelou — não vá" e
            "você tem 2 contratos em andamento". */}
        <PainelAvisos
          avisos={avisos.filter(a => PESO_AVISO[a.tipo] === 'urgente')}
          aoAbrir={abrirAviso}
          aoDispensar={a => dispensar([a.id])}
          aoDispensarTodos={() => dispensar(
            avisos.filter(a => PESO_AVISO[a.tipo] === 'urgente').map(a => a.id))}
        />

        {/* O estado do GPS fica visível o tempo todo, e não só na hora
            da baixa. Descobrir que a localização estava desligada
            quando você já está com o cliente esperando é tarde. */}
        {gps && !gps.ok && (
          <Aviso tipo="atencao">
            Localização desligada — você não vai conseguir dar baixa. {gps.recado}
          </Aviso>
        )}

        {/* 096: o técnico SABE que a rota do dia está sendo registrada,
            e de que jeito. Transparência com quem é rastreado — e o
            recado diz o que fazer quando só grava com o app aberto. */}
        {rastro.modo !== 'DESLIGADO' && (
          <Text style={e.rastro}>
            {rastro.modo === 'SEGUNDO_PLANO'
              ? 'Rota do dia sendo registrada, inclusive com o app fechado.'
              : (rastro.recado ?? 'Rota do dia registrada enquanto o app está aberto.')}
            {rastro.naFila > 0 ? ` ${rastro.naFila} ponto(s) esperando sinal.` : ''}
          </Text>
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
                <Text style={[e.miudo, { paddingBottom: 4 }]}>
                  {producao.meta == null ? 'pts · sem meta cadastrada' : `de ${num2(alvo)} pts`}
                </Text>
              </View>
              <View style={e.trilho}>
                <View style={[e.progresso, { width: `${pct}%` }]} />
              </View>
              <Text style={e.miudoEscuro}>
                {producao.meta == null
                  ? 'A meta da sua skill ainda não foi cadastrada. Veja o Painel.'
                  : producao.fator == null
                  ? `Faltam ${pts(falta)} para a meta.`
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
            titulo={aba === 'feitas' ? 'Nada baixado neste dia'
              : aba === 'andamento' ? 'Nenhum contrato em rota ou iniciado'
              : 'Nenhuma visita pendente'}
            descricao={aba === 'feitas'
              ? 'O que você fechar aparece aqui — e você ainda pode anexar foto no mesmo dia.'
              : aba === 'andamento'
                ? 'Quando você tocar "Estou a caminho" num contrato, ele vem para cá.'
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
              {!!l.janela_inicio && (
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

            {/* O grupo (ADESAO, SERVICO, MUDANCA DE ENDERECO…) e, embaixo, o
                tipo do TOA (Instalacao, Mudanca de Pacote…) — o que a coluna
                GRUPO da central mostra (Emanuel, 24/10). O tipo só aparece
                quando acrescenta: "VISITA TECNICA / Visita Tecnica" é eco. */}
            <View style={e.linhaGrupo}>
              <Text style={e.servico}>{l.servico}</Text>
              {l.tecnologia === 'GPON' && (
                <View style={e.gpon}><Text style={e.gponTexto}>GPON</Text></View>
              )}
            </View>
            {!!l.tipo_atividade
              && l.tipo_atividade.toUpperCase() !== l.servico.toUpperCase() && (
              <Text style={e.tipoAtividade}>{l.tipo_atividade}</Text>
            )}

            {/* O que o controlador vê na linha do contrato, o técnico vê
                aqui (Emanuel, 21/10). A ouvidoria vem primeiro: é rara e
                muda como ele trata o cliente. */}
            {(!!l.ouvidoria || !!l.segmento || !!l.tec1) && (
              <View style={e.marcas}>
                <SeloOuvidoria ouvidoria={l.ouvidoria} />
                <SeloSegmento segmento={l.segmento} />
                <SeloTec1 tec1={l.tec1} />
              </View>
            )}

            {/* Uma linha por informação, rótulo à esquerda na mesma coluna:
                o olho desce pela coluna e acha o que procura sem ler tudo
                (Emanuel, 24/10: "organizar melhor... fácil de ler"). */}
            <View style={e.ficha}>
              {!!l.contrato && <LinhaFicha rotulo="Contrato" valor={l.contrato} forte />}
              {!!l.node && <LinhaFicha rotulo="Node" valor={l.node} forte />}
              {(l.produtos ?? []).some(Boolean) && (
                <LinhaFicha rotulo="Produto"
                  valor={[...new Set((l.produtos ?? []).filter(Boolean))].join('\n')} />
              )}
              {!!l.cliente_nome && <LinhaFicha rotulo="Cliente" valor={l.cliente_nome} />}
              {!!l.logradouro && (
                <LinhaFicha rotulo="Endereço"
                  valor={`${l.logradouro}${l.bairro ? `\n${l.bairro}` : ''}`} />
              )}
            </View>

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

      {/* ---------- solicitar suporte técnico ---------- */}
      <Modal visible={suporteAberto} transparent animationType="slide"
        onRequestClose={() => setSuporteAberto(false)}>
        <Pressable style={e.veu} onPress={() => setSuporteAberto(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={e.folha}>
            <Text style={e.folhaTitulo}>Solicitar suporte técnico</Text>
            <Text style={e.folhaMiudo}>
              O contrato vira "Ticket de suporte" e o controlador recebe o aviso na hora.
            </Text>
            {[...andamento, ...abertas.filter(l => l.situacao !== 'COM_IMPEDIMENTO')].length === 0 ? (
              <Aviso tipo="atencao">Nenhum contrato aberto hoje para pedir suporte. Use a Conversa.</Aviso>
            ) : (
              <ScrollView style={{ maxHeight: 220 }}>
                {[...andamento, ...abertas.filter(l => l.situacao !== 'COM_IMPEDIMENTO')].map(l => (
                  <Pressable key={l.visita_id} onPress={() => setSuporteVisita(l.visita_id)}
                    accessibilityRole="radio" accessibilityState={{ checked: suporteVisita === l.visita_id }}
                    style={[e.opcaoSuporte, suporteVisita === l.visita_id && e.opcaoSuporteAtiva]}>
                    <Text style={e.opcaoSuporteTitulo}>{l.servico}</Text>
                    <Text style={e.opcaoSuporteMiudo}>
                      {[l.contrato && `contrato ${l.contrato}`, l.logradouro].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <TextInput value={suporteTexto} onChangeText={setSuporteTexto} multiline maxLength={400}
              placeholder="O que está acontecendo?" placeholderTextColor={cor.graf500}
              style={e.caixaSuporte} accessibilityLabel="O que está acontecendo" />
            {suporteErro && <Aviso tipo="erro">{suporteErro}</Aviso>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Botao titulo="Cancelar" tom="contorno" style={{ flex: 1 }}
                aoTocar={() => setSuporteAberto(false)} />
              <Botao titulo="Pedir suporte" tom="perigo" style={{ flex: 1.3 }}
                desativado={!suporteVisita || !suporteTexto.trim()} carregando={suporteEnviando}
                aoTocar={enviarSuporte} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <BarraInferior ativa="Agenda" />
    </SafeAreaView>
  )
}

/** Uma linha "rótulo · valor" da ficha do cartão. */
function LinhaFicha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <View style={e.linhaFicha}>
      <Text style={e.rotuloFicha}>{rotulo}</Text>
      <Text style={[e.valorFicha, forte && e.valorForte]}>{valor}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  linhaGrupo: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  gpon: {
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: cor.azul,
  },
  gponTexto: { fontSize: 11, fontWeight: '800', color: cor.azul, letterSpacing: 0.5 },
  tipoAtividade: { fontSize: 13, color: cor.graf500, marginTop: 1 },
  ficha: {
    marginTop: 10, paddingTop: 10, gap: 6,
    borderTopWidth: 1, borderTopColor: cor.graf100,
  },
  linhaFicha: { flexDirection: 'row', gap: 10 },
  rotuloFicha: { width: 70, fontSize: 13, color: cor.graf400, lineHeight: 19 },
  valorFicha: { flex: 1, fontSize: 14, color: cor.graf600, lineHeight: 19 },
  valorForte: { fontWeight: '700', color: cor.tinta },
  rastro: { fontSize: 12, color: cor.graf500, lineHeight: 17 },
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
  equipe: { fontSize: 13, fontWeight: '700', color: cor.af700 },
  sair: { paddingHorizontal: 10, paddingVertical: 8 },
  sino: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sinoIcone: { fontSize: 22 },
  sinoBolha: {
    position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4, backgroundColor: cor.af600,
    alignItems: 'center', justifyContent: 'center',
  },
  sinoNumero: { fontSize: 11, fontWeight: '800', color: cor.branco },
  sairTexto: { color: cor.graf500, fontSize: 14, fontWeight: '600' },
  suporte: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    borderWidth: 2, borderColor: cor.af600,
  },
  suporteTexto: { color: cor.af700, fontSize: 14, fontWeight: '800' },
  veu: { flex: 1, backgroundColor: 'rgba(15,17,21,0.45)' },
  folha: {
    backgroundColor: cor.branco, padding: 16, gap: 10,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  folhaTitulo: { fontSize: 17, fontWeight: '800', color: cor.tinta },
  folhaMiudo: { fontSize: 13, color: cor.graf500, lineHeight: 18 },
  opcaoSuporte: {
    padding: 12, borderRadius: raio.m, borderWidth: 2, borderColor: cor.graf200, marginBottom: 6,
  },
  opcaoSuporteAtiva: { borderColor: cor.af600, backgroundColor: cor.af50 },
  opcaoSuporteTitulo: { fontSize: 15, fontWeight: '700', color: cor.tinta },
  opcaoSuporteMiudo: { fontSize: 12, color: cor.graf500 },
  caixaSuporte: {
    minHeight: 80, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    padding: 12, fontSize: 15, color: cor.tinta, backgroundColor: cor.graf50,
    textAlignVertical: 'top',
  },
  material: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: cor.graf200, borderRadius: 8,
  },
  materialTexto: { color: cor.tinta, fontSize: 14, fontWeight: '600' },

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
  abaTexto: { fontSize: 13, fontWeight: '700', color: cor.graf500, textAlign: 'center' },
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
  marcas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
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
