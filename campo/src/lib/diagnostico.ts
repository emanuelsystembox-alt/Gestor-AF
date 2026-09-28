import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import * as Device from 'expo-device'
import appJson from '../../app.json'
import { supabase } from './supabase'

/**
 * O diagnóstico do aplicativo — para saber ONDE ele fecha (098, D-172).
 *
 * ┌─ POR QUE EXISTE ─────────────────────────────────────────────────┐
 * │ O APK fechou com "Gestor AF Campo fechou porque este app tem um  │
 * │ bug", e não havia como saber onde. No APK não existe tela        │
 * │ vermelha: um erro de JavaScript não tratado derruba o app        │
 * │ inteiro, e um erro NATIVO (serviço de localização, câmera) nem   │
 * │ chega ao JavaScript.                                             │
 * │                                                                   │
 * │ Duas redes, uma para cada tipo:                                   │
 * │  · ERRO DE JS (tela ou fora dela) — é pego, mostrado ao técnico   │
 * │    com a mensagem real (dá para tirar print) e enviado ao banco   │
 * │    (`erro_app`), em vez de fechar o app.                          │
 * │  · FECHAMENTO NATIVO — antes de cada passo arriscado o app anota  │
 * │    o passo no aparelho; se ele fechar no meio, a anotação fica.   │
 * │    No próximo início ela sobe como FECHOU, com o nome do passo.   │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Só a gestão lê `erro_app` (RLS). Nada de dado do assinante vai aqui:
 * mensagem de erro, pilha, tela e o modelo do aparelho.
 */

export const VERSAO_APP: string = appJson.expo.version

const PASSO = 'diag:passo'

const aparelho = () =>
  `${Platform.OS} ${Platform.Version} · ${Device.manufacturer ?? ''} ${Device.modelName ?? ''}`.trim()

/** Manda ao banco. Nunca lança: diagnóstico que derruba o app é piada. */
export async function registrarErro(
  tipo: 'TELA' | 'JS' | 'FECHOU', erro: unknown, contexto?: Record<string, unknown>,
) {
  try {
    const e = erro instanceof Error ? erro : new Error(String(erro))
    await supabase.rpc('registrar_erro_app', {
      p_tipo: tipo,
      p_mensagem: e.message,
      p_pilha: e.stack ?? null,
      p_contexto: contexto ?? null,
      p_versao: VERSAO_APP,
      p_aparelho: aparelho(),
    })
  } catch { /* sem sinal ou sem login: paciência */ }
}

/** Anota o passo arriscado que vai começar. */
export async function iniciarPasso(nome: string) {
  try {
    await AsyncStorage.setItem(PASSO, JSON.stringify({ nome, em: new Date().toISOString(), versao: VERSAO_APP }))
  } catch { /* tanto faz */ }
}

/** O passo que ficou anotado (o app fechou nele e ainda não subiu). */
export async function passoPendente(): Promise<string | null> {
  try {
    const t = await AsyncStorage.getItem(PASSO)
    return t ? (JSON.parse(t) as { nome: string }).nome : null
  } catch { return null }
}

/** O passo terminou sem o app fechar. */
export async function concluirPasso() {
  try { await AsyncStorage.removeItem(PASSO) } catch { /* tanto faz */ }
}

/**
 * No início (já com login): o app fechou no meio de um passo da última
 * vez? Sobe ao banco e devolve o nome do passo — quem chama decide se
 * evita repetir o passo que derrubou o app.
 */
export async function conferirFechamentoAnterior(): Promise<string | null> {
  try {
    const t = await AsyncStorage.getItem(PASSO)
    if (!t) return null
    await AsyncStorage.removeItem(PASSO)
    const p = JSON.parse(t) as { nome: string; em: string; versao: string }
    await registrarErro('FECHOU', new Error(`O app fechou durante: ${p.nome}`),
      { passo: p.nome, em: p.em, versao_do_passo: p.versao })
    return p.nome
  } catch { return null }
}

// ---------------------------------------------------------------------------
// o erro de JavaScript fora da tela
// ---------------------------------------------------------------------------
type Ouvinte = (e: Error) => void
let ouvinte: Ouvinte | null = null

/** A tela de tropeço se inscreve aqui para aparecer no lugar do fechamento. */
export function aoErroFatal(f: Ouvinte | null) { ouvinte = f }

interface ErrorUtilsRN {
  getGlobalHandler: () => (e: unknown, fatal?: boolean) => void
  setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void
}

let instalado = false
/**
 * Troca o "fecha o app" do erro fatal por "mostra o erro e manda ao
 * banco". Sem a tela inscrita (antes de montar), segue o padrão do RN.
 */
export function instalarRedeDeErros() {
  if (instalado) return
  const EU = (globalThis as { ErrorUtils?: ErrorUtilsRN }).ErrorUtils
  if (!EU) return
  instalado = true
  const padrao = EU.getGlobalHandler()
  EU.setGlobalHandler((erro, fatal) => {
    const e = erro instanceof Error ? erro : new Error(String(erro))
    registrarErro('JS', e, { fatal: !!fatal })
    // No Expo Go (__DEV__) fica a tela vermelha do RN: ela traz a pilha.
    if (fatal && ouvinte && !__DEV__) { ouvinte(e); return }
    padrao(erro, fatal)
  })
}
