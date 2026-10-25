import * as ImagePicker from 'expo-image-picker'
import type { Captura } from './midia'

/**
 * Foto ou vídeo da GALERIA do celular (132, Emanuel 25/10).
 *
 * ┌─ contra a fraude: a galeria não é a câmera ───────────────────────┐
 * │ A câmera do app carimba hora e GPS do momento. Da galeria, a hora │
 * │ e o GPS que valem são os DO ARQUIVO (EXIF), quando ele traz — e   │
 * │ ficam NULOS quando não traz: pôr o GPS do celular agora diria que │
 * │ a foto foi tirada aqui, e isso é mentira. A evidência sobe marcada│
 * │ `da_galeria`, e quem audita vê a marca.                           │
 * └───────────────────────────────────────────────────────────────────┘
 */

export interface DaGaleria {
  captura: Captura
  /** A hora da foto/vídeo segundo o arquivo; nula = o arquivo não diz. */
  capturadaEm: string | null
  lat: number | null
  lng: number | null
}

/** "2026:10:25 14:03:22" (hora do aparelho, sem fuso) → ISO. */
function dataExif(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Coordenada do EXIF em qualquer dos formatos que os aparelhos mandam:
 *  número decimal, "graus/1,min/1,seg/100" ou [graus, min, seg]. */
function grau(v: unknown, ref: unknown): number | null {
  let n: number | null = null
  if (typeof v === 'number') n = v
  else if (Array.isArray(v) && v.length >= 3) n = +v[0] + +v[1] / 60 + +v[2] / 3600
  else if (typeof v === 'string') {
    const partes = v.split(',').map(p => {
      const [a, b] = p.trim().split('/').map(Number)
      return b ? a / b : a
    })
    if (partes.length >= 3 && partes.every(x => !isNaN(x))) n = partes[0] + partes[1] / 60 + partes[2] / 3600
    else if (!isNaN(Number(v))) n = Number(v)
  }
  if (n == null || isNaN(n)) return null
  const r = typeof ref === 'string' ? ref.toUpperCase() : ''
  return r === 'S' || r === 'W' ? -Math.abs(n) : n
}

/** Abre a galeria. Nulo = cancelou. Lança com recado quando falta permissão. */
export async function escolherDaGaleria(): Promise<DaGaleria | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) {
    throw new Error('Autorize o acesso às fotos e vídeos nos ajustes do celular para enviar da galeria.')
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    exif: true,
    quality: 1,
    allowsEditing: false,
  })
  if (r.canceled || !r.assets?.length) return null
  const a = r.assets[0]
  const video = a.type === 'video'
  const exif = (a.exif ?? {}) as Record<string, unknown>
  const lat = grau(exif.GPSLatitude, exif.GPSLatitudeRef)
  const lng = grau(exif.GPSLongitude, exif.GPSLongitudeRef)
  return {
    captura: {
      uri: a.uri,
      midia: video ? 'VIDEO' : 'FOTO',
      duracaoSeg: video && a.duration ? Math.round(a.duration / 1000) : undefined,
    },
    capturadaEm: dataExif(exif.DateTimeOriginal) ?? dataExif(exif.DateTime),
    // 0,0 é o "não sei" de alguns aparelhos, não um lugar no oceano.
    lat: lat && lng ? lat : null,
    lng: lat && lng ? lng : null,
  }
}
