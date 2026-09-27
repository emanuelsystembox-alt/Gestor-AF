import { Linking, Platform } from 'react-native'
import * as Location from 'expo-location'
import * as Device from 'expo-device'
import { supabase } from './supabase'
import { anotar, enviar } from './rastro'
import { ehSimulada } from './gps'

/**
 * O antifraude do GPS (097, D-171).
 *
 * ┌─ O PEDIDO ────────────────────────────────────────────────────────┐
 * │ > "se ele desligar o gps e quiser usar o sistema, o sistema vai   │
 * │ >  travar as ações dele e deve subir uma mensagem informando para │
 * │ >  que ele ligue o gps novamente, se ele habilitar no celular dele│
 * │ >  o modo desenvolvedor para instalar o gps simulator, o app também│
 * │ >  deve bloquear isso […] temos que ser intuitivos sem ser        │
 * │ >  agressivo" — Emanuel, 27/09                                     │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌─ O QUE TRAVA, E ONDE ─────────────────────────────────────────────┐
 * │ DESLIGADO / SEM PERMISSÃO — a tela pausa o app até voltar. O      │
 * │   banco já recusava baixa e encerramento sem coordenada (D-113).  │
 * │ SIMULADO — o Android marca cada leitura que vem de app de GPS     │
 * │   falso (`mocked`). A tela pausa E o banco recusa baixa e status  │
 * │   (`gps_bloqueado`, 097). Só um ponto REAL destrava: o app dizer  │
 * │   "está normal" não basta.                                         │
 * │ SEM SINAL (GPS ligado, satélite ainda não fixou) — NÃO trava. É a │
 * │   razão da D-113: travar por satélite é pior que registrar sem.   │
 * │ MODO DESENVOLVEDOR sozinho — NÃO trava. Muita gente tem ligado sem│
 * │   fraudar nada; o que frauda é o app de local fictício, e esse é  │
 * │   pego pela marca da leitura. Aparelho com ROOT é avisado ao      │
 * │   controle (dá para esconder a marca com root), sem travar.       │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * No iPhone não existe a marca `mocked`: lá o antifraude é só o de
 * GPS desligado/negado. Simulação no iPhone exige computador ligado ao
 * aparelho — fora do alcance de um app.
 */

export type EstadoGuarda = 'VERIFICANDO' | 'OK' | 'DESLIGADO' | 'SEM_PERMISSAO' | 'SIMULADO'

interface Leitura { estado: EstadoGuarda; loc: Location.LocationObject | null; podePedir: boolean }

function comPrazo<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))])
}

/** Lê o estado do GPS agora. `pedir` = pode abrir o pedido de permissão. */
export async function verificarGps(pedir = false): Promise<Leitura> {
  try {
    let perm = await Location.getForegroundPermissionsAsync()
    if (perm.status !== 'granted' && pedir && perm.canAskAgain) {
      perm = await Location.requestForegroundPermissionsAsync()
    }
    if (perm.status !== 'granted') {
      return { estado: 'SEM_PERMISSAO', loc: null, podePedir: perm.canAskAgain }
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      return { estado: 'DESLIGADO', loc: null, podePedir: true }
    }
    // Leitura fresca: com app de local fictício ligado, é ela que vem marcada.
    const loc = await comPrazo(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 8000)
      ?? await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000 }).catch(() => null)
    if (ehSimulada(loc)) return { estado: 'SIMULADO', loc, podePedir: true }
    // Sem leitura ainda (sem satélite) conta como OK — D-113.
    return { estado: 'OK', loc, podePedir: true }
  } catch {
    return { estado: 'OK', loc: null, podePedir: true }
  }
}

let ultimoReportado: EstadoGuarda | null = null

/**
 * Conta ao servidor — só quando MUDA. Simulado vai como PONTO marcado (é
 * o ponto que trava no banco); a volta ao normal vai como ponto REAL.
 */
export async function reportar(l: Leitura) {
  if (l.estado === 'VERIFICANDO' || l.estado === ultimoReportado) return
  const anterior = ultimoReportado
  try {
    if (l.estado === 'SIMULADO') {
      if (l.loc) await anotar(l.loc, 'PERIODICO', true)
      await enviar()
      await supabase.rpc('registrar_estado_gps', {
        p_estado: 'SIMULADO', p_detalhe: 'O celular informou localizacao simulada',
      })
    } else if (l.estado === 'DESLIGADO' || l.estado === 'SEM_PERMISSAO') {
      await supabase.rpc('registrar_estado_gps', { p_estado: l.estado, p_detalhe: null })
    } else if (l.estado === 'OK') {
      if (l.loc && !ehSimulada(l.loc)) {
        await anotar(l.loc, anterior === null ? 'ABRIU' : 'PERIODICO', true)
        await enviar()
      }
      if (anterior !== null) await supabase.rpc('registrar_estado_gps', { p_estado: 'NORMAL', p_detalhe: null })
    }
    ultimoReportado = l.estado
  } catch {
    // Sem internet: tenta de novo na próxima verificação.
  }
}

let aparelhoVisto = false
/** Root deixa esconder a marca de simulação: o controle fica sabendo. */
export async function verificarAparelho() {
  if (aparelhoVisto) return
  aparelhoVisto = true
  try {
    if (await Device.isRootedExperimentalAsync()) {
      await supabase.rpc('registrar_estado_gps', {
        p_estado: 'APARELHO_MODIFICADO',
        p_detalhe: `${Device.manufacturer ?? ''} ${Device.modelName ?? ''}`.trim() || null,
      })
    }
  } catch { aparelhoVisto = false }
}

/** Esquece o que já foi reportado (troca de login). */
export function esquecerAntifraude() { ultimoReportado = null; aparelhoVisto = false }

// ---------------------------------------------------------------------------
// as saídas que a tela oferece
// ---------------------------------------------------------------------------
export async function ligarLocalizacao() {
  if (Platform.OS === 'android') {
    // Abre o diálogo do próprio Android ("Ativar a localização?").
    try { await Location.enableNetworkProviderAsync(); return } catch { /* segue */ }
  }
  await Linking.openSettings().catch(() => {})
}

export async function pedirPermissaoDeNovo(podePedir: boolean) {
  if (podePedir) {
    const r = await Location.requestForegroundPermissionsAsync().catch(() => null)
    if (r?.status === 'granted') return
  }
  await Linking.openSettings().catch(() => {})
}

export async function abrirOpcoesDoDesenvolvedor() {
  if (Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.APPLICATION_DEVELOPMENT_SETTINGS')
      return
    } catch { /* aparelho sem a tela: cai nos ajustes */ }
  }
  await Linking.openSettings().catch(() => {})
}
