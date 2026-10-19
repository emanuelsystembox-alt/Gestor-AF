import { supabase } from './supabase'

/**
 * A foto de perfil (103, D-180).
 *
 * ┌─ o bucket é PRIVADO, como o da evidência ────────────────────────┐
 * │ Foto de rosto é dado pessoal do empregado. `<img src>` direto no │
 * │ arquivo não abre: a tela pede uma URL ASSINADA, de uma hora, e a │
 * │ policy do Storage (`pode_ver_foto`) decide se a pessoa pode ver. │
 * │ Quem envia é só o ADMIN; a barreira é a policy de INSERT, não o  │
 * │ botão escondido.                                                 │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * A imagem é REDUZIDA no navegador antes de subir (lado maior 512 px,
 * JPEG): foto de celular tem 4 MB e vira miniatura de 34 px na lista. O
 * Storage do plano Free é pouco, e baixar 4 MB por técnico no ranking do
 * app, no 4G, seria pior ainda.
 */
const BUCKET = 'foto_perfil'
const LADO = 512

async function reduzir(arquivo: File): Promise<Blob> {
  const img = await createImageBitmap(arquivo)
  const escala = Math.min(1, LADO / Math.max(img.width, img.height))
  const w = Math.round(img.width * escala), h = Math.round(img.height * escala)
  const tela = document.createElement('canvas')
  tela.width = w; tela.height = h
  tela.getContext('2d')!.drawImage(img, 0, 0, w, h)
  img.close()
  return new Promise((ok, falha) =>
    tela.toBlob(b => (b ? ok(b) : falha(new Error('Não consegui preparar a imagem.'))), 'image/jpeg', 0.85))
}

/** Confere ANTES de subir — o recado sai na tela, não um 400 do Storage. */
export function conferirFoto(arquivo: File): string | null {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) return 'Use uma foto JPG, PNG ou WEBP.'
  if (arquivo.size > 15 * 1024 * 1024) return 'Foto grande demais (mais de 15 MB).'
  return null
}

/**
 * Sobe a foto e grava no perfil. O nome do arquivo muda a cada troca —
 * com o mesmo nome, a URL assinada antiga continuaria mostrando a foto
 * velha do cache. A anterior é removida depois (sem ela, sem problema).
 */
export async function enviarFoto(
  usuarioId: string, arquivo: File, anterior: string | null,
): Promise<{ path: string } | { erro: string }> {
  const motivo = conferirFoto(arquivo)
  if (motivo) return { erro: motivo }
  let blob: Blob
  try { blob = await reduzir(arquivo) } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Não consegui ler a imagem.' }
  }
  const path = `${usuarioId}/${Date.now()}.jpg`
  const { error: eu } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (eu) return { erro: /row-level|policy|403/i.test(eu.message)
    ? 'O banco recusou: só o ADMIN envia foto de perfil.' : eu.message }
  const { error: ep } = await supabase.from('perfil').update({ foto_path: path }).eq('id', usuarioId)
  if (ep) {
    await supabase.storage.from(BUCKET).remove([path])
    return { erro: ep.message }
  }
  if (anterior && anterior !== path) await supabase.storage.from(BUCKET).remove([anterior])
  return { path }
}

export async function removerFoto(usuarioId: string, atual: string | null): Promise<string | null> {
  const { error } = await supabase.from('perfil').update({ foto_path: null }).eq('id', usuarioId)
  if (error) return error.message
  if (atual) await supabase.storage.from(BUCKET).remove([atual])
  return null
}

/**
 * tecnico_id → URL da foto, para as telas que conhecem o TÉCNICO e não o
 * perfil (Equipes, Monitoramento). O caminho vem de `fotos_dos_tecnicos`,
 * que só devolve técnico da cidade ativa. Substitui `tecnico.foto_url`
 * (034), que nunca foi preenchida e era lida como URL pública.
 */
export async function fotosDosTecnicos(ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (!ids.length) return m
  const { data } = await supabase.rpc('fotos_dos_tecnicos', { p_tecnicos: ids })
  const linhas = (data ?? []) as { tecnico_id: string; foto_path: string }[]
  const urls = await urlsDasFotos(linhas.map(l => l.foto_path))
  for (const l of linhas) { const u = urls.get(l.foto_path); if (u) m.set(l.tecnico_id, u) }
  return m
}

/** URLs assinadas EM LOTE — uma viagem para a lista inteira (D-116). */
export async function urlsDasFotos(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(paths.filter((p): p is string => !!p))]
  const m = new Map<string, string>()
  if (!unicos.length) return m
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(unicos, 3600)
  for (const d of data ?? []) if (d.signedUrl && d.path) m.set(d.path, d.signedUrl)
  return m
}
