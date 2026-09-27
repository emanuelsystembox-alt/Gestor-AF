import * as LocalAuthentication from 'expo-local-authentication'
import { supabase } from './supabase'

/**
 * O aceite do técnico: provar que é ELE quem está confirmando o material.
 *
 * ┌─ DE ONDE VEIO ───────────────────────────────────────────────────┐
 * │ No concorrente o termo assinado diz "Aceite confirmado em … por   │
 * │ biometria do aparelho / credencial do aparelho / senha do         │
 * │ usuário". O Emanuel mandou seguir a regra deles (D-163).          │
 * │                                                                   │
 * │ Celular esquecido destravado na van é o caso que isto fecha: sem  │
 * │ o dedo (ou o PIN do aparelho, ou a senha do sistema), o romaneio  │
 * │ não se confirma em nome dele.                                     │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Dois métodos, e o banco grava qual foi (087-D):
 *   APARELHO — biometria ou o bloqueio do próprio celular (PIN, padrão).
 *              O sistema do aparelho decide qual oferecer e NÃO conta
 *              qual foi usado, então não afirmamos "biometria".
 *   SENHA    — a senha do Gestor AF, para celular sem bloqueio nenhum.
 *
 * ⚠ Quem garante a biometria é o aparelho, não o banco — lá também é
 *   assim. O banco garante que o método foi gravado, e que o balcão não
 *   se passa por aceite do técnico.
 */

export type Metodo = 'APARELHO' | 'SENHA'

/** O aparelho tem biometria ou bloqueio de tela cadastrado? */
export async function aparelhoProtegido(): Promise<boolean> {
  try {
    const nivel = await LocalAuthentication.getEnrolledLevelAsync()
    return nivel !== LocalAuthentication.SecurityLevel.NONE
  } catch {
    return false
  }
}

/** Pede o dedo, o rosto ou o PIN do aparelho. `true` só se passou. */
export async function autenticarNoAparelho(mensagem: string): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: mensagem,
    cancelLabel: 'Cancelar',
    // Deixa o PIN/padrão do aparelho como alternativa ao dedo: luva,
    // dedo molhado e leitor sujo são o normal na rua.
    disableDeviceFallback: false,
  })
  return r.success
}

/**
 * Confere a senha do Gestor AF entrando de novo com ela. Não troca de
 * usuário: é o mesmo e-mail da sessão aberta.
 */
export async function conferirSenha(email: string, senha: string): Promise<boolean> {
  if (!email || !senha) return false
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(), password: senha,
  })
  return !error
}
