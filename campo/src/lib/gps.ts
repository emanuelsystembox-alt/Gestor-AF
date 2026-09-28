import * as Location from 'expo-location'

/**
 * ┌─ A REGRA QUE ESTE ARQUIVO EXISTE PARA SUSTENTAR ─────────────────┐
 * │ "O técnico só pode baixar se estiver ligado" — Emanuel, 08/09.   │
 * │ Ligado é o GPS. A baixa é o momento em que a AFLINE afirma o que │
 * │ aconteceu no endereço do assinante; afirmar isso sem dizer de    │
 * │ onde é exatamente o que o sistema atual permite.                  │
 * │                                                                   │
 * │ A trava REAL está no banco: `baixar_os` recusa a chamada do campo │
 * │ sem lat/lng (migration 055-G). Isto aqui é a cara dela — dizer ao │
 * │ técnico o que fazer em vez de deixar o botão falhar.              │
 * │                                                                   │
 * │ Andar pela tela (a caminho, cheguei, foto) NÃO exige coordenada:  │
 * │ travar o passo a passo por causa de satélite é pior que registrar │
 * │ sem ele. A exigência é da baixa e do encerramento.                │
 * └───────────────────────────────────────────────────────────────────┘
 */

export interface Posicao {
  lat: number
  lng: number
  precisao: number | null
  em: Date
}

export type EstadoGps =
  | { ok: true; posicao: Posicao }
  | { ok: false; motivo: 'PERMISSAO' | 'DESLIGADO' | 'SEM_SINAL' | 'SIMULADO'; recado: string }

const RECADO: Record<'PERMISSAO' | 'DESLIGADO' | 'SEM_SINAL' | 'SIMULADO', string> = {
  PERMISSAO: 'Autorize a localização para este aplicativo nos ajustes do celular.',
  DESLIGADO: 'A localização do celular está desligada. Ligue para dar baixa.',
  SEM_SINAL: 'Sem sinal de GPS ainda. Vá para um lugar aberto e tente de novo.',
  // 097: o Android marca a leitura que vem de app de localização falsa.
  SIMULADO: 'O celular está usando uma localização simulada. Desative o app de localização simulada para continuar.',
}

/**
 * A leitura veio de um provedor SIMULADO (app de GPS falso, "local
 * fictício" das opções do desenvolvedor)? O Android marca cada leitura;
 * no iPhone o campo não existe e vale falso (097, D-171).
 */
export const ehSimulada = (l: Location.LocationObject | null | undefined) => l?.mocked === true

/** Pede a permissão uma vez. Devolve se ficou concedida. */
export async function pedirPermissao(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync()
  return status === 'granted'
}

/**
 * ┌─ UMA LEITURA DE GPS POR VEZ, PARA O APP INTEIRO (098, D-172) ─────┐
 * │ > "eu to vendo que ele ta so procurando o gps direto" — Emanuel.   │
 * │ Era verdade: a guarda do GPS lia a cada 20 s, o rastro a cada      │
 * │ minuto, e a Agenda e o contrato liam de novo ao abrir — cada um    │
 * │ pedindo uma leitura NOVA ao Android, às vezes duas ao mesmo tempo, │
 * │ e a leitura sem prazo podia ficar pendurada para sempre.           │
 * │ Agora todos passam por aqui:                                        │
 * │  · leitura recente (dentro de `maxIdadeMs`) é reaproveitada;       │
 * │  · duas pedidas ao mesmo tempo viram UMA (a segunda espera a       │
 * │    primeira);                                                        │
 * │  · toda leitura tem prazo; sem satélite no prazo, vale a última    │
 * │    conhecida.                                                        │
 * │ A baixa continua exigindo leitura de no máximo 2 min (Visita).     │
 * └─────────────────────────────────────────────────────────────────────┘
 */
let ultima: Location.LocationObject | null = null
let emVoo: Promise<Location.LocationObject | null> | null = null

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))])
}

export async function lerPosicao(
  { maxIdadeMs = 60 * 1000, prazoMs = 12 * 1000 }: { maxIdadeMs?: number; prazoMs?: number } = {},
): Promise<Location.LocationObject | null> {
  if (ultima && Date.now() - ultima.timestamp <= maxIdadeMs) return ultima
  if (emVoo) return emVoo
  emVoo = (async () => {
    try {
      const p = await comPrazo(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), prazoMs)
      if (p) { ultima = p; return p }
    } catch { /* sem satélite ainda: cai na última conhecida */ }
    const u = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null)
    if (u) ultima = u
    return u
  })()
  try { return await emVoo } finally { emVoo = null }
}

/** Esquece a leitura guardada (troca de login). */
export function esquecerPosicao() { ultima = null }

/**
 * Lê a posição agora. `Balanced` e não `Highest` de propósito: em rua
 * de Manaus, com prédio dos dois lados, a precisão máxima demora 20 s e
 * chega ao mesmo lugar. Vinte segundos com o técnico parado esperando o
 * botão liberar é o que faz um aplicativo ser desligado.
 *
 * `maxIdadeMs` é quanto uma leitura guardada ainda vale para quem chama.
 */
export async function ondeEstou(maxIdadeMs = 60 * 1000): Promise<EstadoGps> {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (perm.status !== 'granted') {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return { ok: false, motivo: 'PERMISSAO', recado: RECADO.PERMISSAO }
    }

    if (!(await Location.hasServicesEnabledAsync())) {
      return { ok: false, motivo: 'DESLIGADO', recado: RECADO.DESLIGADO }
    }
  } catch {
    return { ok: false, motivo: 'SEM_SINAL', recado: RECADO.SEM_SINAL }
  }

  const p = await lerPosicao({ maxIdadeMs })
  if (!p) return { ok: false, motivo: 'SEM_SINAL', recado: RECADO.SEM_SINAL }
  if (ehSimulada(p)) return { ok: false, motivo: 'SIMULADO', recado: RECADO.SIMULADO }
  return {
    ok: true,
    posicao: {
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      precisao: p.coords.accuracy ?? null,
      em: new Date(p.timestamp),
    },
  }
}

/** Distância em metros entre dois pontos (Haversine). */
export function distanciaM(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const R = 6371000
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}
