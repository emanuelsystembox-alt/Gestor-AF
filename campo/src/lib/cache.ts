import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'

/**
 * O cache do aparelho, com teto (Emanuel, 25/10: "otimize o cache para não
 * ficar muito pesado o celular do técnico, limite o cache").
 *
 * ┌─ o que ocupa espaço, e o que NÃO pode sair ───────────────────────┐
 * │ A câmera e a galeria gravam cada foto/vídeo no cache do app, e a   │
 * │ foto ainda ganha uma cópia reduzida antes de subir. Nada disso era │
 * │ apagado: um dia de vídeo de evidência são centenas de MB.          │
 * │                                                                   │
 * │ Sai: o que já SUBIU (apagado logo depois do envio, em midia.ts) e, │
 * │ na faxina da abertura, o que passou de 3 dias ou o que estoura o   │
 * │ teto de 250 MB (os mais velhos primeiro).                         │
 * │ NÃO sai: o arquivo de quem está na FILA sem sinal — é a evidência  │
 * │ que ainda não chegou ao servidor. Apagá-lo seria perder a prova.   │
 * └───────────────────────────────────────────────────────────────────┘
 */

const FILA = 'evidencias_pendentes_v1'
const MAX_IDADE_MS = 3 * 24 * 60 * 60 * 1000
const TETO_BYTES = 250 * 1024 * 1024
const ALVO_BYTES = 150 * 1024 * 1024

/** Apaga um arquivo do cache do app — e só do cache: a galeria do
 *  técnico nunca é tocada. Nunca lança. */
export function apagarDoCache(uri: string | null | undefined) {
  try {
    if (!uri || !uri.startsWith(Paths.cache.uri)) return
    const f = new File(uri)
    if (f.exists) f.delete()
  } catch { /* faxina não derruba nada */ }
}

async function urisNaFila(): Promise<Set<string>> {
  try {
    const bruto = await AsyncStorage.getItem(FILA)
    const fila = bruto ? (JSON.parse(bruto) as { uri: string }[]) : []
    return new Set(fila.map(p => p.uri))
  } catch {
    // Sem saber o que está na fila, não se apaga nada de mídia.
    return new Set(['*'])
  }
}

function listar(dir: Directory, saida: File[]) {
  for (const item of dir.list()) {
    if (item instanceof Directory) listar(item, saida)
    else saida.push(item)
  }
}

/** A faxina da abertura do app. Devolve quantos MB liberou. Nunca lança. */
export async function faxinarCache(): Promise<number> {
  try {
    const protegidos = await urisNaFila()
    if (protegidos.has('*')) return 0
    const arquivos: File[] = []
    listar(Paths.cache, arquivos)
    const agora = Date.now()
    const vivos = arquivos
      .map(f => {
        const i = f.info()
        return { f, bytes: i.size ?? 0, quando: i.modificationTime ?? agora }
      })
      .filter(x => !protegidos.has(x.f.uri))
    let liberado = 0
    let total = vivos.reduce((s, x) => s + x.bytes, 0)
    // 1. velho demais
    for (const x of vivos) {
      if (agora - x.quando > MAX_IDADE_MS) {
        try { x.f.delete(); liberado += x.bytes; total -= x.bytes; x.bytes = -1 } catch { /* segue */ }
      }
    }
    // 2. acima do teto: os mais velhos primeiro, até o alvo
    if (total > TETO_BYTES) {
      for (const x of vivos.filter(v => v.bytes >= 0).sort((a, b) => a.quando - b.quando)) {
        if (total <= ALVO_BYTES) break
        try { x.f.delete(); liberado += x.bytes; total -= x.bytes } catch { /* segue */ }
      }
    }
    return Math.round(liberado / 1024 / 1024)
  } catch {
    return 0
  }
}
