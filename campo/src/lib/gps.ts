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
  | { ok: false; motivo: 'PERMISSAO' | 'DESLIGADO' | 'SEM_SINAL'; recado: string }

const RECADO: Record<'PERMISSAO' | 'DESLIGADO' | 'SEM_SINAL', string> = {
  PERMISSAO: 'Autorize a localização para este aplicativo nos ajustes do celular.',
  DESLIGADO: 'A localização do celular está desligada. Ligue para dar baixa.',
  SEM_SINAL: 'Sem sinal de GPS ainda. Vá para um lugar aberto e tente de novo.',
}

/** Pede a permissão uma vez. Devolve se ficou concedida. */
export async function pedirPermissao(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync()
  return status === 'granted'
}

/**
 * Lê a posição agora. `Balanced` e não `Highest` de propósito: em rua
 * de Manaus, com prédio dos dois lados, a precisão máxima demora 20 s e
 * chega ao mesmo lugar. Vinte segundos com o técnico parado esperando o
 * botão liberar é o que faz um aplicativo ser desligado.
 */
export async function ondeEstou(): Promise<EstadoGps> {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (perm.status !== 'granted') {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return { ok: false, motivo: 'PERMISSAO', recado: RECADO.PERMISSAO }
    }

    if (!(await Location.hasServicesEnabledAsync())) {
      return { ok: false, motivo: 'DESLIGADO', recado: RECADO.DESLIGADO }
    }

    const p = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })
    return {
      ok: true,
      posicao: {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        precisao: p.coords.accuracy ?? null,
        em: new Date(p.timestamp),
      },
    }
  } catch {
    // Cai aqui quando o aparelho tem permissão e serviço ligados mas
    // ainda não fixou satélite — sair de dentro de um prédio resolve.
    const ultima = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 })
    if (ultima) {
      return {
        ok: true,
        posicao: {
          lat: ultima.coords.latitude,
          lng: ultima.coords.longitude,
          precisao: ultima.coords.accuracy ?? null,
          em: new Date(ultima.timestamp),
        },
      }
    }
    return { ok: false, motivo: 'SEM_SINAL', recado: RECADO.SEM_SINAL }
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
