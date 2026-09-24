import { StatusBar } from 'expo-status-bar'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { AuthProvider, useAuth } from './src/lib/auth'
import Entrar from './src/telas/Entrar'
import Agenda from './src/telas/Agenda'
import Visita from './src/telas/Visita'
import Captura from './src/telas/Captura'
import Romaneios from './src/telas/Romaneios'
import { Carregando } from './src/ui/componentes'
import { cor } from './src/ui/tema'
import type { Pilha } from './src/navegacao'

const Stack = createNativeStackNavigator<Pilha>()

function Aplicacao() {
  const { session, carregando } = useAuth()

  if (carregando && !session) {
    return (
      <View style={{ flex: 1, backgroundColor: cor.branco, justifyContent: 'center' }}>
        <Carregando texto="Abrindo…" />
      </View>
    )
  }

  if (!session) return <Entrar />

  return (
    <NavigationContainer>
      {/* `headerShown: false` porque cada tela desenha o próprio
          cabeçalho: no campo o topo carrega situação, janela e contrato
          — informação, não só um título. */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Agenda" component={Agenda} />
        <Stack.Screen name="Visita" component={Visita} />
        <Stack.Screen name="Romaneios" component={Romaneios} />
        <Stack.Screen
          name="Captura" component={Captura}
          options={{ animation: 'fade', presentation: 'fullScreenModal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
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
