import { supabase } from './supabase'

/**
 * As fotos de perfil no aplicativo (103, D-180) — o ranking e o painel.
 *
 * O técnico só lê o PRÓPRIO perfil, então não acharia a foto dos colegas
 * sozinho: `fotos_dos_tecnicos` devolve o caminho de quem é da cidade dele,
 * e a policy do Storage (`pode_ver_foto`) assina a URL. Quem envia foto é
 * só o ADMIN, pela web — o app só mostra. Duplica a ideia de
 * `app/src/lib/foto.ts` de propósito (D-112).
 */
export async function fotosDosTecnicos(ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (!ids.length) return m
  const { data } = await supabase.rpc('fotos_dos_tecnicos', { p_tecnicos: ids })
  const linhas = (data ?? []) as { tecnico_id: string; foto_path: string }[]
  if (!linhas.length) return m
  const { data: urls } = await supabase.storage.from('foto_perfil')
    .createSignedUrls(linhas.map(l => l.foto_path), 3600)
  const porPath = new Map<string, string>()
  for (const u of urls ?? []) if (u.signedUrl && u.path) porPath.set(u.path, u.signedUrl)
  for (const l of linhas) { const u = porPath.get(l.foto_path); if (u) m.set(l.tecnico_id, u) }
  return m
}
