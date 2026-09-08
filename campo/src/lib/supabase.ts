import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Faltam EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Copie campo/.env.example para campo/.env.',
  )
}

/**
 * Cliente único do aplicativo.
 *
 * Três diferenças em relação ao cliente da web (`app/src/lib/supabase.ts`):
 *
 *  · `storage: AsyncStorage` — no navegador a sessão mora no
 *    localStorage, que aqui não existe. Sem isto o técnico faz login a
 *    cada vez que o Android mata o processo, que é o dia inteiro.
 *  · `detectSessionInUrl: false` — não há URL de retorno de OAuth num
 *    aplicativo; deixar ligado faz o cliente procurar `window.location`
 *    e quebrar.
 *  · `react-native-url-polyfill` — o `supabase-js` monta as chamadas com
 *    `URL`/`URLSearchParams`, que o Hermes não traz completos.
 */
export const supabase = createClient(url, key, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
