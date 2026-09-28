import { StatusBar } from 'expo-status-bar'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useEffect } from 'react'
import { View } from 'react-native'
import { AuthProvider, useAuth } from './src/lib/auth'
import { useRastro } from './src/lib/useRastro'
import { GuardaGps } from './src/ui/GuardaGps'
import { Tropeco } from './src/ui/Tropeco'
import { conferirFechamentoAnterior, instalarRedeDeErros } from './src/lib/diagnostico'
import { anotarQueDerrubou } from './src/lib/rastro'
import { AvisoRastro, useCienciaRastro } from './src/ui/AvisoRastro'
import Entrar from './src/telas/Entrar'
import Agenda from './src/telas/Agenda'
import Visita from './src/telas/Visita'
import Captura from './src/telas/Captura'
import Romaneios from './src/telas/Romaneios'
import Transferir from './src/telas/Transferir'
import Painel from './src/telas/Painel'
import Conversa from './src/telas/Conversa'
import Material from './src/telas/Material'
import Abastecer from './src/telas/Abastecer'
import { Carregando } from './src/ui/componentes'
import { cor } from './src/ui/tema'
import type { Pilha } from './src/navegacao'

const Stack = createNativeStackNavigator<Pilha>()

// 098: erro fatal de JavaScript vira tela com a mensagem, não app fechado.
instalarRedeDeErros()

function Aplicacao() {
  const { session, carregando, tecnicoId, ehCampo } = useAuth()
  const ehTecnico = !!session && !!tecnicoId
  // 097: o técnico dá ciência do registro ANTES de o rastro começar.
  const { ciente, darCiencia } = useCienciaRastro(session?.user.id ?? null, ehTecnico)
  // O rastro do dia (096): só para login de técnico, e depois da ciência.
  useRastro(ehTecnico && ciente === true)

  // 098: o app fechou no meio de um passo da última vez? Sobe ao banco
  // (precisa do login) — e, se foi ao ligar a rota em segundo plano, não
  // tenta de novo neste celular. Ver lib/diagnostico.ts.
  const usuario = session?.user.id ?? null
  useEffect(() => {
    if (!usuario) return
    conferirFechamentoAnterior().then(anotarQueDerrubou).catch(() => {})
  }, [usuario])

  if (carregando && !session) {
    return (
      <View style={{ flex: 1, backgroundColor: cor.branco, justifyContent: 'center' }}>
        <Carregando texto="Abrindo…" />
      </View>
    )
  }

  if (!session) return <Entrar />

  return (
    // 097: GPS desligado, negado ou simulado pausa o app de quem é do campo.
    <GuardaGps ativo={ehTecnico && ehCampo}>
    <Tropeco>
    <NavigationContainer>
      {/* `headerShown: false` porque cada tela desenha o próprio
          cabeçalho: no campo o topo carrega situação, janela e contrato
          — informação, não só um título. */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {/* As abas da barra de baixo trocam sem animação: é aba, não página nova (091). */}
        <Stack.Screen name="Agenda" component={Agenda} options={{ animation: 'none' }} />
        <Stack.Screen name="Painel" component={Painel} options={{ animation: 'none' }} />
        <Stack.Screen name="Conversa" component={Conversa} options={{ animation: 'none' }} />
        <Stack.Screen name="Material" component={Material} options={{ animation: 'none' }} />
        <Stack.Screen name="Abastecer" component={Abastecer} options={{ animation: 'none' }} />
        <Stack.Screen name="Visita" component={Visita} />
        <Stack.Screen name="Romaneios" component={Romaneios} />
        <Stack.Screen name="Transferir" component={Transferir} />
        <Stack.Screen
          name="Captura" component={Captura}
          options={{ animation: 'fade', presentation: 'fullScreenModal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
    </Tropeco>
    <AvisoRastro visivel={ehTecnico && ciente === false} aoCiente={darCiencia} />
    </GuardaGps>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      {/* A superfície CAMPO é clara por condição de trabalho, não por
          gosto (D-011): tela escura no sol de Manaus vira espelho. */}
      <StatusBar style="dark" />
      <AuthProvider>
        <Aplicacao />
      </AuthProvider>
    </SafeAreaProvider>
  )
}
