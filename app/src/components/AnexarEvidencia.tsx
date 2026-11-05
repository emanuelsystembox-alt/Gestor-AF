import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Anexar foto ou vídeo pelo site — o COP e quem usa o site mandam evidência
 * para o contrato como o técnico manda pelo app.
 *
 * > "vamos dar acesso ao COP para enviar evidências também para o contrato,
 * >  anexar foto igual ao técnico anexa (...) em cima da caixa de resposta
 * >  ao técnico" — Emanuel, 03/11
 *
 * O mesmo caminho do aplicativo (`campo/src/lib/midia.ts`): o arquivo sobe
 * para o bucket `evidencia` em `<visita>/<nome>`, e `registrar_evidencia`
 * grava a linha. Quem pode é decidido no BANCO (`pode_anexar_na_visita`, a
 * policy `evidencia_arquivo_enviar` chama a mesma): gestão com a permissão
 * "Anexar". Arquivo do computador não tem hora nem GPS confiáveis — sobe
 * marcado como da galeria (D-213), sem posição.
 */

// Os tipos do aplicativo (campo/src/lib/dominio.ts) — duplicados de
// propósito (D-112): mudou lá, muda aqui.
const TIPOS = [
  { chave: 'GEOLOCALIZACAO', rotulo: 'Chegada / fachada' },
  { chave: 'MEDICAO_SINAL', rotulo: 'Medição de sinal' },
  { chave: 'TUBULACAO', rotulo: 'Tubulação / rede' },
  { chave: 'NR35', rotulo: 'NR-35 (altura)' },
  { chave: 'CLIENTE_AUSENTE', rotulo: 'Cliente ausente' },
  { chave: 'URA', rotulo: 'URA / protocolo' },
  { chave: 'MINI_ISOLADOR', rotulo: 'Mini isolador' },
  { chave: 'TESTE_VELOCIDADE', rotulo: 'Teste de velocidade' },
  { chave: 'CONSULTIVO', rotulo: 'Consultivo' },
  // D-309 (Emanuel, 04/11)
  { chave: 'EVIDENCIAS_REFAZER', rotulo: 'Evidências refazer' },
  { chave: 'NIVEIS_SINAIS', rotulo: 'Níveis de sinais' },
  { chave: 'LIVRE', rotulo: 'Outra' },
]

// O que o bucket aceita (storage.buckets.allowed_mime_types) e o teto dele.
const ACEITOS = 'image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime'
const LIMITE = 50 * 1024 * 1024

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
}

/** Igual ao `nomeUnico` do app: AAAAMMDDhhmmss + sufixo aleatório. */
function nomeUnico(ext: string) {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const carimbo = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${carimbo}.-${Math.random().toString(36).slice(2, 8)}.${ext}`
}

export function AnexarEvidencia({ visitaId, aoEnviar }: { visitaId: string; aoEnviar: () => void }) {
  const [tipo, setTipo] = useState('LIVRE')
  const [obs, setObs] = useState('')
  const [arquivos, setArquivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [recado, setRecado] = useState<{ ok: boolean; texto: string } | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  async function enviar() {
    if (!arquivos.length) return
    setEnviando(true); setRecado(null)
    let enviados = 0
    try {
      for (const f of arquivos) {
        if (!EXT[f.type]) throw new Error(`${f.name}: formato não aceito (use foto JPG/PNG/WEBP/HEIC ou vídeo MP4/MOV).`)
        if (f.size > LIMITE) throw new Error(`${f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB — o limite é 50 MB.`)
        const caminho = `${visitaId}/${nomeUnico(EXT[f.type])}`
        const { error: eUp } = await supabase.storage.from('evidencia')
          .upload(caminho, f, { contentType: f.type, upsert: false })
        if (eUp) throw new Error(`${f.name}: não consegui enviar o arquivo — ${eUp.message}`)
        const { error } = await supabase.rpc('registrar_evidencia', {
          p_visita: visitaId, p_arquivo_path: caminho, p_tipo: tipo,
          p_midia: f.type.startsWith('video/') ? 'VIDEO' : 'FOTO',
          p_os: null, p_mime: f.type, p_bytes: f.size,
          p_lat: null, p_lng: null, p_precisao_m: null,
          // Arquivo do computador: a data do arquivo não é a hora da foto.
          p_capturada_em: null, p_duracao_seg: null,
          p_observacao: obs.trim() || null, p_galeria: true,
          p_envio_lat: null, p_envio_lng: null, p_envio_precisao_m: null,
        })
        if (error) {
          // a linha não entrou: o arquivo não pode ficar órfão no bucket
          await supabase.storage.from('evidencia').remove([caminho])
          throw new Error(error.message)
        }
        enviados++
      }
      setRecado({ ok: true, texto: `${enviados} arquivo(s) anexado(s) ao contrato.` })
      setArquivos([]); setObs('')
      if (entrada.current) entrada.current.value = ''
      aoEnviar()
    } catch (e) {
      setRecado({ ok: false, texto: (enviados ? `${enviados} enviado(s); ` : '') + (e instanceof Error ? e.message : String(e)) })
      if (enviados) aoEnviar()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="card-controle p-4">
      <h2 className="mb-2 text-sm font-semibold">Anexar foto ou vídeo</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-graf-400">
          Tipo
          <select value={tipo} onChange={e => setTipo(e.target.value)}
            className="mt-1 block rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-sm text-graf-100">
            {TIPOS.map(t => <option key={t.chave} value={t.chave}>{t.rotulo}</option>)}
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-xs text-graf-400">
          Observação
          <input value={obs} onChange={e => setObs(e.target.value)} maxLength={300}
            placeholder="opcional"
            className="mt-1 block w-full rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-sm text-graf-100" />
        </label>
        <input ref={entrada} type="file" accept={ACEITOS} multiple
          onChange={e => setArquivos([...(e.target.files ?? [])])}
          className="text-xs text-graf-300 file:mr-2 file:rounded-md file:border file:border-graf-700
                     file:bg-graf-900 file:px-2 file:py-1.5 file:text-xs file:text-graf-200" />
        <button onClick={enviar} disabled={!arquivos.length || enviando}
          className="rounded-md bg-af-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-af-500
                     disabled:opacity-50">
          {enviando ? 'Enviando…' : `Anexar${arquivos.length > 1 ? ` ${arquivos.length}` : ''}`}
        </button>
      </div>
      {recado && (
        <p className={`mt-2 text-xs ${recado.ok ? 'text-emerald-400' : 'text-af-400'}`}>{recado.texto}</p>
      )}
    </section>
  )
}
