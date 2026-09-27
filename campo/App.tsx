import { StatusBar } from 'expo-status-bar'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { AuthProvider, useAuth } from './src/lib/auth'
import { useRastro } from './src/lib/useRastro'
import { GuardaGps } from './src/ui/GuardaGps'
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

function Aplicacao() {
  const { session, carregando, tecnicoId, ehCampo } = useAuth()
  const ehTecnico = !!session && !!tecnicoId
  // 097: o técnico dá ciência do registro ANTES de o rastro começar.
  const { ciente, darCiencia } = useCienciaRastro(session?.user.id ?? null, ehTecnico)
  // O rastro do dia (096): só para login de técnico, e depois da ciência.
  useRastro(ehTecnico && ciente === true)

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
