import { useCallback, useEffect, useState } from 'react'
import {
  KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { diaCurto, num2, reais } from '../lib/formato'
import { Aviso, Botao, Carregando, Cartao, TituloSecao } from '../ui/componentes'
import { CabecalhoAba } from '../ui/CabecalhoAba'
import { BarraInferior } from '../ui/BarraInferior'
import { cor, raio, TOQUE } from '../ui/tema'

/**
 * Abastecer (091) — o técnico pede, a frota aprova.
 *
 * O carro é o que está no NOME dele (condutor atual, D-164). O aplicativo
 * não oferece escolher veículo: quem decide quem dirige o quê é a frota.
 *
 * O ODÔMETRO é o dado que mais importa aqui, e a tela diz por quê: sem
 * ele o km/l daquele trecho não se mede. Mas não bloqueia — exceção de
 * odômetro é para conferir, nunca para travar lançamento (D-164). Leitura
 * menor que a última conhecida ganha aviso, e vai assim mesmo.
 */

interface Veiculo {
  veiculo_id: string; placa: string; apelido: string | null; modelo: string | null
  hodometro_atual: number | null; ultimo_abastecimento: string | null
}
interface Abastecimento {
  id: string; data: string; placa: string; combustivel: string; valor: number
  valor_litro: number; litros: number; hodometro: number | null; posto: string | null
  situacao: 'EM_ABERTO' | 'APROVADO' | 'ABASTECIDO' | 'CANCELADO'; cancelado_motivo: string | null
}

const COMBUSTIVEIS = [
  { chave: 'GASOLINA_COMUM', rotulo: 'Gasolina' },
  { chave: 'GASOLINA_ADITIVADA', rotulo: 'Aditivada' },
  { chave: 'ETANOL', rotulo: 'Etanol' },
  { chave: 'DIESEL', rotulo: 'Diesel' },
  { chave: 'GNV', rotulo: 'GNV' },
] as const

const SITUACAO = {
  EM_ABERTO:  { rotulo: 'Aguardando a frota', fundo: cor.ambar50, texto: '#92400e' },
  APROVADO:   { rotulo: 'Aprovado',           fundo: '#eff6ff',   texto: '#1e40af' },
  ABASTECIDO: { rotulo: 'Abastecido',         fundo: cor.verde50, texto: cor.verde900 },
  CANCELADO:  { rotulo: 'Cancelado',          fundo: cor.af50,    texto: cor.af700 },
} as const

/**
 * "150,50" → 150.5 · "6.49" → 6.49 · "1.234,50" → 1234.5. O teclado
 * decimal do Android mostra vírgula ou ponto conforme o aparelho: com
 * vírgula, o ponto é milhar; sem vírgula, o ponto é a casa decimal.
 * Vazio ou lixo → null (nunca 0: zero é afirmação).
 */
function numero(t: string): number | null {
  const s = t.trim()
  const limpo = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  if (!limpo) return null
  const v = Number(limpo)
  return Number.isFinite(v) ? v : null
}

export default function Abastecer() {
  const [veiculo, setVeiculo] = useState<Veiculo | null | undefined>(undefined)
  const [historico, setHistorico] = useState<Abastecimento[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  const [combustivel, setCombustivel] = useState<string>('GASOLINA_COMUM')
  const [valor, setValor] = useState('')
  const [preco, setPreco] = useState('')
  const [km, setKm] = useState('')
  const [posto, setPosto] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.rpc('meu_veiculo'),
      supabase.rpc('meus_abastecimentos'),
    ])
    if (a.error) setErro(a.error.message)
    setVeiculo(((a.data ?? []) as Veiculo[])[0] ?? null)
    setHistorico((b.data ?? []) as Abastecimento[])
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const v = numero(valor), p = numero(preco), k = numero(km)
  const litros = v && p && p > 0 ? v / p : null
  const ultimoKm = veiculo?.hodometro_atual ?? null
  const kmVoltou = k != null && ultimoKm != null && k < ultimoKm

  async function enviar() {
    setErro(null); setOk(null)
    if (!v || v <= 0) { setErro('Informe o valor do abastecimento.'); return }
    if (!p || p <= 0) { setErro('Informe o preço do litro — ele está na bomba e no cupom.'); return }
    setEnviando(true)
    const { error } = await supabase.rpc('pedir_abastecimento', {
      p_dados: {
        combustivel, valor: v, valor_litro: p,
        hodometro: k != null ? Math.round(k) : null,
        posto: posto.trim() || null, observacao: obs.trim() || null,
      },
    })
    setEnviando(false)
    if (error) { setErro(error.message); return }
    setValor(''); setPreco(''); setKm(''); setPosto(''); setObs('')
    setOk('Pedido enviado. A frota aprova e você acompanha aqui embaixo.')
    await carregar()
  }

  async function puxar() { setAtualizando(true); await carregar(); setAtualizando(false) }

  return (
    <SafeAreaView style={e.tela} edges={['top']}>
      <CabecalhoAba titulo="Abastecer" subtitulo="Você pede, a frota aprova" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={e.conteudo} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={atualizando} onRefresh={puxar} tintColor={cor.af600} />}>
          {veiculo === undefined && <Carregando />}

          {veiculo === null && (
            <Aviso tipo="atencao">
              Nenhum carro está no seu nome. Quem define o condutor de cada carro é
              a frota — fale com ela para liberar o abastecimento.
            </Aviso>
          )}

          {veiculo && (<>
            {/* A placa desenhada como placa: é o que o técnico confere com
                o carro na frente dele, na bomba. */}
            <View style={e.carro}>
              <View style={e.placa} accessibilityLabel={`Placa ${veiculo.placa}`}>
                <View style={e.placaFaixa}><Text style={e.placaFaixaTexto}>BRASIL</Text></View>
                <Text style={e.placaTexto}>{veiculo.placa}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={e.carroNome}>{veiculo.apelido ?? veiculo.modelo ?? 'Carro'}</Text>
                <Text style={e.miudo}>
                  {ultimoKm != null ? `último odômetro ${ultimoKm.toLocaleString('pt-BR')} km` : 'sem odômetro registrado'}
                </Text>
                {veiculo.ultimo_abastecimento && (
                  <Text style={e.miudo}>último abastecimento {diaCurto(veiculo.ultimo_abastecimento)}</Text>
                )}
              </View>
            </View>

            <Cartao style={{ padding: 14, gap: 12 }}>
              <View>
                <Text style={e.rotulo}>Combustível</Text>
                <View style={e.chips}>
                  {COMBUSTIVEIS.map(c => (
                    <Pressable key={c.chave} onPress={() => setCombustivel(c.chave)}
                      accessibilityRole="radio" accessibilityState={{ checked: combustivel === c.chave }}
                      style={[e.chipOpcao, combustivel === c.chave && e.chipOpcaoAtiva]}>
                      <Text style={[e.chipOpcaoTexto, combustivel === c.chave && { color: cor.branco }]}>
                        {c.rotulo}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={e.dupla}>
                <Campo rotulo="Valor (R$)" valor={valor} mudar={setValor} teclado="decimal-pad" dica="150,00" />
                <Campo rotulo="Preço do litro" valor={preco} mudar={setPreco} teclado="decimal-pad" dica="6,49" />
              </View>
              <Text style={e.conta}>
                {litros != null ? `≈ ${num2(litros)} litros` : 'Os litros saem do valor ÷ preço.'}
              </Text>

              <Campo rotulo="Odômetro (km)" valor={km} mudar={setKm} teclado="number-pad"
                dica={ultimoKm != null ? `mais de ${ultimoKm.toLocaleString('pt-BR')}` : 'o número do painel'} />
              <Text style={e.miudo}>
                Sem o odômetro não dá para medir quantos km o carro faz por litro.
              </Text>
              {kmVoltou && (
                <Aviso tipo="atencao">
                  Este número é menor que o último registrado ({ultimoKm!.toLocaleString('pt-BR')} km).
                  Confira o painel — se estiver certo, pode mandar assim.
                </Aviso>
              )}

              <Campo rotulo="Posto (opcional)" valor={posto} mudar={setPosto} dica="nome do posto" />
              <Campo rotulo="Observação (opcional)" valor={obs} mudar={setObs} dica="algo que a frota precise saber" />

              {erro && <Aviso tipo="erro">{erro}</Aviso>}
              {ok && <Aviso tipo="ok">{ok}</Aviso>}
              <Botao titulo="Pedir abastecimento" grande carregando={enviando} aoTocar={enviar} />
            </Cartao>
          </>)}

          <TituloSecao titulo="Meus pedidos" />
          {historico.length === 0 && veiculo !== undefined && (
            <Text style={[e.miudo, { paddingHorizontal: 2 }]}>Nenhum abastecimento no seu nome ainda.</Text>
          )}
          {historico.map(a => {
            const st = SITUACAO[a.situacao]
            return (
              <Cartao key={a.id} style={{ padding: 12, gap: 3 }}>
                <View style={e.linhaTopo}>
                  <Text style={e.histValor}>{reais(Number(a.valor))}</Text>
                  <View style={[e.chip, { backgroundColor: st.fundo }]}>
                    <Text style={[e.chipTexto, { color: st.texto }]}>{st.rotulo}</Text>
                  </View>
                </View>
                <Text style={e.miudo}>
                  {[diaCurto(a.data), a.placa, `${num2(Number(a.litros))} L`,
                    a.hodometro != null ? `${Number(a.hodometro).toLocaleString('pt-BR')} km` : 'sem odômetro',
                    a.posto].filter(Boolean).join(' · ')}
                </Text>
                {a.cancelado_motivo ? <Text style={e.motivo}>Motivo: {a.cancelado_motivo}</Text> : null}
              </Cartao>
            )
          })}
        </ScrollView>
      </KeyboardAvoidingView>
      <BarraInferior ativa="Abastecer" />
    </SafeAreaView>
  )
}

function Campo({ rotulo, valor, mudar, teclado, dica }: {
  rotulo: string; valor: string; mudar: (t: string) => void
  teclado?: 'decimal-pad' | 'number-pad'; dica?: string
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={e.rotulo}>{rotulo}</Text>
      <TextInput value={valor} onChangeText={mudar} keyboardType={teclado}
        placeholder={dica} placeholderTextColor={cor.graf400}
        style={e.campo} accessibilityLabel={rotulo} />
    </View>
  )
}

const e = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.graf50 },
  conteudo: { padding: 12, gap: 10, paddingBottom: 32 },
  carro: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14,
    backgroundColor: cor.branco, borderRadius: raio.g, borderWidth: 1, borderColor: cor.graf200,
  },
  placa: {
    width: 132, borderWidth: 2, borderColor: cor.tinta, borderRadius: 6,
    backgroundColor: cor.branco, overflow: 'hidden', alignItems: 'center',
  },
  placaFaixa: { alignSelf: 'stretch', backgroundColor: '#1e3a8a', paddingVertical: 1 },
  placaFaixaTexto: { color: cor.branco, fontSize: 8, fontWeight: '800', textAlign: 'center', letterSpacing: 2 },
  placaTexto: { fontSize: 24, fontWeight: '900', color: cor.tinta, letterSpacing: 2, paddingVertical: 3 },
  carroNome: { fontSize: 16, fontWeight: '800', color: cor.tinta },
  miudo: { fontSize: 12, color: cor.graf500, lineHeight: 17 },
  rotulo: { fontSize: 13, fontWeight: '700', color: cor.graf600, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipOpcao: {
    minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 2,
    borderColor: cor.graf200, justifyContent: 'center',
  },
  chipOpcaoAtiva: { backgroundColor: cor.tinta, borderColor: cor.tinta },
  chipOpcaoTexto: { fontSize: 14, fontWeight: '700', color: cor.tinta },
  dupla: { flexDirection: 'row', gap: 10 },
  campo: {
    minHeight: TOQUE, borderWidth: 1, borderColor: cor.graf200, borderRadius: raio.m,
    paddingHorizontal: 12, fontSize: 17, fontWeight: '700', color: cor.tinta, backgroundColor: cor.graf50,
  },
  conta: { fontSize: 14, fontWeight: '700', color: cor.graf600, marginTop: -4 },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  histValor: { fontSize: 17, fontWeight: '900', color: cor.tinta },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipTexto: { fontSize: 12, fontWeight: '800' },
  motivo: { fontSize: 13, color: cor.af700, marginTop: 2 },
})
