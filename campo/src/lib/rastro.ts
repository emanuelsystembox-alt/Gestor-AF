import { AppState, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import * as Battery from 'expo-battery'
import { supabase } from './supabase'

/**
 * O rastro do técnico — a trilha que a central de monitoramento desenha.
 *
 * ┌─ O PEDIDO ────────────────────────────────────────────────────────┐
 * │ > "deve mostrar a trilha do técnico desde o momento que o técnico │
 * │ >  loga até o final, o final da rota, ou enquanto ele estiver     │
 * │ >  usando o app, o sistema deve captar a cada 2 a 5 minutos o     │
 * │ >  sinal do gps do técnico" — Emanuel, 27/09                       │
 * │ E também com o app em segundo plano (escolha dele, no mesmo dia). │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ "2 A 5 MINUTOS" ─────────────────────────────────────────────────┐
 * │ Um ponto a cada 2 min SE ele andou 30 m ou mais; parado, um ponto │
 * │ a cada 5 min mesmo assim. Andando, a trilha tem resolução de rua; │
 * │ parado, não enche o banco (plano Free) de pontos iguais — e o     │
 * │ ponto de 5 em 5 min continua provando que o aparelho está vivo.   │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ OS DOIS MODOS ───────────────────────────────────────────────────┐
 * │ SEGUNDO PLANO — o sistema operacional entrega a posição mesmo com │
 * │   o app fechado (no Android, com a notificação fixa que a lei do  │
 * │   Android exige). Precisa do APK/EAS Build e da permissão         │
 * │   "Permitir o tempo todo". NÃO funciona no Expo Go.               │
 * │ APP ABERTO — um relógio lê o GPS enquanto a tela está na frente.  │
 * │   É o que sobra quando o segundo plano não está disponível ou não │
 * │   foi autorizado. Ao ir para trás, grava um ponto SAIU: a trilha  │
 * │   mostra o buraco como "app fechado", e não como "parado".        │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ ATÉ O FINAL DA ROTA ─────────────────────────────────────────────┐
 * │ `registrar_rastro` devolve `rota_aberta`: se ainda há contrato    │
 * │ produtivo de hoje em aberto para ele. Sem nenhum, o SEGUNDO PLANO │
 * │ desliga sozinho. Com o app aberto continua gravando ("ou enquanto │
 * │ ele estiver usando o app"). Rastrear o técnico em casa depois do  │
 * │ último contrato não foi pedido — e localização de empregado é     │
 * │ dado pessoal (LGPD).                                               │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * A fila mora no aparelho (AsyncStorage): sem sinal, o ponto espera e
 * sobe depois. O servidor recusa ponto repetido (técnico + instante),
 * então reenviar é seguro. Quem é o técnico o SERVIDOR decide pelo
 * login (D-061) — por isso a fila é apagada ao sair: o ponto de um
 * login não pode subir na sessão de outro.
 */

export const TAREFA_RASTRO = 'afline-rastro'

const FILA = 'rastro:fila'
const ULTIMO = 'rastro:ultimo'
const PERGUNTOU_SEGUNDO_PLANO = 'rastro:perguntou-segundo-plano'

const MIN_MS = 2 * 60 * 1000
const MAX_MS = 5 * 60 * 1000
const MIN_M = 30
/** Quantos pontos sobem por chamada. A função aceita até 500. */
const LOTE = 200
/** Teto da fila no aparelho: ~2 dias de pontos a cada 2 min. */
const TETO_FILA = 1500

export type Motivo = 'ABRIU' | 'PERIODICO' | 'SEGUNDO_PLANO' | 'SAIU' | 'ENCERROU'

interface Ponto {
  em: string
  lat: number
  lng: number
  precisao: number | null
  velocidade: number | null
  bateria: number | null
  motivo: Motivo
  /** 097: o Android marcou a leitura como simulada (app de GPS falso). */
  simulado: boolean
}

export type ModoRastro = 'SEGUNDO_PLANO' | 'APP_ABERTO' | 'DESLIGADO'

export interface EstadoRastro {
  modo: ModoRastro
  /** Pontos no aparelho esperando sinal. */
  naFila: number
  /** Última vez que o servidor confirmou. */
  enviadoEm: Date | null
  /** Por que o segundo plano não está ligado, em palavras do técnico. */
  recado: string | null
}

// ---------------------------------------------------------------------------
// estado para a tela (um aviso discreto na Agenda: o técnico SABE que a rota
// está sendo registrada — transparência com o empregado, não vigilância oculta)
// ---------------------------------------------------------------------------
let estado: EstadoRastro = { modo: 'DESLIGADO', naFila: 0, enviadoEm: null, recado: null }
const ouvintes = new Set<(e: EstadoRastro) => void>()

function mudar(p: Partial<EstadoRastro>) {
  estado = { ...estado, ...p }
  for (const f of ouvintes) f(estado)
}
export const estadoRastro = () => estado
export function ouvirRastro(f: (e: EstadoRastro) => void): () => void {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}

// ---------------------------------------------------------------------------
// a fila
// ---------------------------------------------------------------------------
async function lerFila(): Promise<Ponto[]> {
  try {
    const t = await AsyncStorage.getItem(FILA)
    return t ? (JSON.parse(t) as Ponto[]) : []
  } catch { return [] }
}
async function gravarFila(f: Ponto[]) {
  // Estourou o teto (dias sem sinal): fica o mais recente. Ponto velho
  // perdido é buraco na trilha; fila que cresce sem fim é app travado.
  const corte = f.length > TETO_FILA ? f.slice(f.length - TETO_FILA) : f
  await AsyncStorage.setItem(FILA, JSON.stringify(corte))
  mudar({ naFila: corte.length })
}

async function nivelBateria(): Promise<number | null> {
  try {
    const b = await Battery.getBatteryLevelAsync()
    return b >= 0 ? Math.round(b * 100) : null
  } catch { return null }
}

function metrosEntre(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const s = Math.sin(rad(bLat - aLat) / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Decide se o ponto entra e, se entrar, põe na fila. `forcar` é para os
 * marcos (abriu, saiu, encerrou): eles contam a história da trilha
 * mesmo que o técnico não tenha andado.
 */
export async function anotar(loc: Location.LocationObject, motivo: Motivo, forcar = false) {
  // Leitura simulada passa na frente do filtro: o servidor trava a baixa
  // com ela, e precisa saber AGORA, não daqui a 5 minutos (097).
  if (loc.mocked === true) forcar = true
  const em = loc.timestamp
  const { latitude: lat, longitude: lng } = loc.coords
  if (!forcar) {
    try {
      const t = await AsyncStorage.getItem(ULTIMO)
      if (t) {
        const u = JSON.parse(t) as { em: number; lat: number; lng: number }
        const dt = em - u.em
        if (dt < MIN_MS) return false
        if (dt < MAX_MS && metrosEntre(u.lat, u.lng, lat, lng) < MIN_M) return false
      }
    } catch { /* sem último: grava */ }
  }
  await AsyncStorage.setItem(ULTIMO, JSON.stringify({ em, lat, lng }))
  const fila = await lerFila()
  fila.push({
    em: new Date(em).toISOString(),
    lat, lng,
    precisao: loc.coords.accuracy ?? null,
    velocidade: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null,
    bateria: await nivelBateria(),
    motivo,
    simulado: loc.mocked === true,
  })
  await gravarFila(fila)
  return true
}

let enviando = false

/** Sobe a fila. Devolve `rota_aberta` do servidor, ou nulo se não subiu. */
export async function enviar(): Promise<boolean | null> {
  if (enviando) return null
  enviando = true
  let rotaAberta: boolean | null = null
  try {
    for (let voltas = 0; voltas < 10; voltas++) {
      const fila = await lerFila()
      if (fila.length === 0 && voltas > 0) break
      const lote = fila.slice(0, LOTE)
      const { data, error } = await supabase.rpc('registrar_rastro', { p_pontos: lote })
      if (error) break
      rotaAberta = !!(data as { rota_aberta?: boolean } | null)?.rota_aberta
      mudar({ enviadoEm: new Date() })
      // Relê: o segundo plano pode ter posto ponto novo enquanto subia.
      const enviados = new Set(lote.map(p => p.em))
      await gravarFila((await lerFila()).filter(p => !enviados.has(p.em)))
      if (fila.length <= LOTE) break
    }
  } finally {
    enviando = false
  }
  return rotaAberta
}

// ---------------------------------------------------------------------------
// o segundo plano
// ---------------------------------------------------------------------------
/**
 * A tarefa tem de ser definida no carregamento do módulo — no Android o
 * sistema pode acordar o JS SEM tela nenhuma só para entregar posição,
 * e aí só existe o que `index.ts` importou. Por isso `index.ts` importa
 * este arquivo antes de registrar o App.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TAREFA_RASTRO, async ({ data, error }) => {
  if (error || !data?.locations?.length) return
  for (const l of data.locations) await anotar(l, 'SEGUNDO_PLANO')
  const aberta = await enviar()
  // Fim da rota com o app fechado: desliga. Aberto, quem decide é a tela.
  if (aberta === false && AppState.currentState !== 'active') {
    await pararSegundoPlano('ENCERROU')
  }
})

export async function segundoPlanoLigado(): Promise<boolean> {
  try { return await Location.hasStartedLocationUpdatesAsync(TAREFA_RASTRO) } catch { return false }
}

/**
 * Liga o segundo plano, se der. Devolve se ficou ligado. Nunca lança:
 * sem segundo plano o rastro continua com o app aberto.
 *
 * `perguntar` = pode pedir a permissão "o tempo todo" agora. Quem chama
 * explica antes, na tela (o Android 11+ manda para os ajustes, e cair
 * nos ajustes sem saber por quê é o que faz o técnico negar).
 */
export async function iniciarSegundoPlano(perguntar: boolean): Promise<boolean> {
  try {
    if (!(await TaskManager.isAvailableAsync())) {
      mudar({ recado: 'Rota registrada só com o app aberto nesta versão do aplicativo.' })
      return false
    }
    const fg = await Location.getForegroundPermissionsAsync()
    if (fg.status !== 'granted') return false
    let bg = await Location.getBackgroundPermissionsAsync()
    if (bg.status !== 'granted' && perguntar && bg.canAskAgain) {
      bg = await Location.requestBackgroundPermissionsAsync()
    }
    if (bg.status !== 'granted') {
      mudar({ recado: 'Rota registrada só com o app aberto. Para registrar com ele fechado, permita a localização "o tempo todo" nos ajustes.' })
      return false
    }
    if (!(await segundoPlanoLigado())) {
      await Location.startLocationUpdatesAsync(TAREFA_RASTRO, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: MIN_MS,
        // Android respeita o tempo; o iPhone só acorda por distância —
        // lá, parado, não chega ponto (o "de 5 em 5 min" é do Android).
        distanceInterval: Platform.OS === 'ios' ? MIN_M : 0,
        deferredUpdatesInterval: MIN_MS,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.AutomotiveNavigation,
        foregroundService: {
          notificationTitle: 'Gestor AF · rota do dia',
          notificationBody: 'Registrando sua rota enquanto houver contrato aberto hoje.',
          notificationColor: '#d11a24',
          killServiceOnDestroy: false,
        },
      })
    }
    mudar({ modo: 'SEGUNDO_PLANO', recado: null })
    return true
  } catch {
    // Expo Go cai aqui: ele não tem o serviço de localização em segundo plano.
    mudar({ recado: 'Rota registrada só com o app aberto (Expo Go não grava em segundo plano).' })
    return false
  }
}

export async function pararSegundoPlano(marco?: Motivo) {
  if (marco) {
    const ultima = await Location.getLastKnownPositionAsync().catch(() => null)
    if (ultima) await anotar({ ...ultima, timestamp: Date.now() }, marco, true)
    await enviar()
  }
  if (await segundoPlanoLigado()) {
    try { await Location.stopLocationUpdatesAsync(TAREFA_RASTRO) } catch { /* já parou */ }
  }
  if (estado.modo === 'SEGUNDO_PLANO') mudar({ modo: 'DESLIGADO' })
}

/** Primeira vez neste aparelho? A tela explica antes de pedir. */
export async function jaPerguntouSegundoPlano(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PERGUNTOU_SEGUNDO_PLANO)) === '1' } catch { return true }
}
export async function marcarPerguntouSegundoPlano() {
  try { await AsyncStorage.setItem(PERGUNTOU_SEGUNDO_PLANO, '1') } catch { /* tanto faz */ }
}

// ---------------------------------------------------------------------------
// com o app aberto
// ---------------------------------------------------------------------------
async function lerAgora(): Promise<Location.LocationObject | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (perm.status !== 'granted') return null
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  } catch {
    return await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null)
  }
}

/**
 * Um passo do relógio da tela: com o segundo plano ligado ele já entrega
 * as posições (inclusive com o app aberto), então aqui só se sobe a fila.
 * Sem ele, lê o GPS e aplica a mesma regra dos 2 a 5 minutos.
 */
export async function passoComAppAberto(motivo: Motivo = 'PERIODICO', forcar = false) {
  const bg = await segundoPlanoLigado()
  if (!bg || forcar) {
    const l = await lerAgora()
    if (l) await anotar(l, motivo, forcar)
    if (!bg) mudar({ modo: 'APP_ABERTO' })
  }
  return enviar()
}

/**
 * Saiu do login: registra o fim, tenta subir o que falta e APAGA a fila —
 * o ponto de um login nunca pode subir na sessão de outro.
 */
export async function encerrarRastro() {
  try {
    await pararSegundoPlano('ENCERROU')
  } finally {
    await AsyncStorage.multiRemove([FILA, ULTIMO]).catch(() => {})
    mudar({ modo: 'DESLIGADO', naFila: 0, recado: null })
  }
}
