import AsyncStorage from '@react-native-async-storage/async-storage'
import { File } from 'expo-file-system'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { decode } from 'base64-arraybuffer'
import { supabase } from './supabase'
import { apagarDoCache } from './cache'
import { ondeEstou } from './gps'

/**
 * Evidência: do celular para o bucket, e do bucket para a tabela.
 *
 * ┌─ POR QUE SÃO DOIS PASSOS ────────────────────────────────────────┐
 * │ 1. o arquivo vai para o Storage, no caminho `<visita_id>/<nome>`; │
 * │ 2. `registrar_evidencia` grava a LINHA que aponta para ele.       │
 * │                                                                   │
 * │ O prefixo do caminho não é organização: é a chave que a policy do │
 * │ Storage usa para descobrir de qual contrato o arquivo é           │
 * │ (`visita_do_path`, migration 055-C). Caminho fora do padrão sobe  │
 * │ o arquivo e depois a RPC recusa — de propósito, para não existir  │
 * │ arquivo órfão que ninguém consegue abrir.                         │
 * │                                                                   │
 * │ Quem tirou a foto quem diz é o servidor, não este arquivo. Mesma  │
 * │ razão de D-061.                                                   │
 * └───────────────────────────────────────────────────────────────────┘
 */

export const BUCKET = 'evidencia'

/** 50 MB é o teto do bucket (055-C). O vídeo é limitado antes disso, na
 *  gravação, para o técnico não descobrir o limite depois de gravar. */
export const LIMITE_BYTES = 50 * 1024 * 1024

export interface Captura {
  uri: string
  midia: 'FOTO' | 'VIDEO'
  duracaoSeg?: number
}

export interface DadosEvidencia {
  visitaId: string
  osId?: string | null
  tipo: string
  observacao?: string | null
  lat?: number | null
  lng?: number | null
  precisao?: number | null
  /** Nula = a hora não é conhecida (da galeria, sem EXIF). */
  capturadaEm?: string | null
  /** Veio da galeria do celular, não da câmera do app (132). */
  galeria?: boolean
}

interface Pendente extends DadosEvidencia {
  id: string
  uri: string
  midia: 'FOTO' | 'VIDEO'
  duracaoSeg?: number
  tentativas: number
  criadaEm: string
}

const FILA = 'evidencias_pendentes_v1'

/**
 * Reduz a foto antes de subir. A câmera de um celular atual entrega 4 a
 * 8 MB por foto; num 4G de rua isso é meio minuto por evidência e o
 * técnico desiste. 1600 px de largura com qualidade 0,7 dá ~250 KB e
 * ainda se lê o número de série na imagem.
 */
async function prepararFoto(uri: string): Promise<{ uri: string; mime: string }> {
  const r = await manipulateAsync(uri, [{ resize: { width: 1600 } }], {
    compress: 0.7,
    format: SaveFormat.JPEG,
  })
  return { uri: r.uri, mime: 'image/jpeg' }
}

function extensaoDe(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'video/quicktime') return 'mov'
  return 'mp4'
}

function nomeUnico(ext: string): string {
  const agora = new Date()
  const carimbo = agora.toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const sal = Math.random().toString(36).slice(2, 8)
  return `${carimbo}-${sal}.${ext}`
}

/**
 * Sobe um arquivo e registra a linha. Devolve o id da evidência.
 *
 * `decode(base64)` em vez de `fetch(uri).blob()`: o Blob do React
 * Native não carrega os bytes, ele carrega uma referência que o
 * `supabase-js` sobe vazia. Base64 → ArrayBuffer é o caminho que
 * realmente entrega o arquivo.
 */
export async function enviarEvidencia(
  captura: Captura, dados: DadosEvidencia,
): Promise<string> {
  const ehVideo = captura.midia === 'VIDEO'
  const { uri, mime } = ehVideo
    ? { uri: captura.uri, mime: captura.uri.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' }
    : await prepararFoto(captura.uri)

  const arquivo = new File(uri)
  const bytes = arquivo.size ?? 0
  if (bytes > LIMITE_BYTES) {
    throw new Error(
      `O arquivo tem ${(bytes / 1024 / 1024).toFixed(1)} MB e o limite é 50 MB. ` +
      'Grave um vídeo mais curto.',
    )
  }

  const caminho = `${dados.visitaId}/${nomeUnico(extensaoDe(mime))}`

  // Lido ANTES do upload: a leitura guardada de até 2 min serve, e assim
  // o técnico não espera o GPS para a foto subir.
  const g = await ondeEstou(2 * 60 * 1000)
  const envio = g.ok ? g.posicao : null

  const { error: erroUp } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, decode(await arquivo.base64()), {
      contentType: mime,
      upsert: false,
    })
  if (erroUp) throw new Error(`Não consegui enviar o arquivo: ${erroUp.message}`)

  const { data, error } = await supabase.rpc('registrar_evidencia', {
    p_visita: dados.visitaId,
    p_arquivo_path: caminho,
    p_tipo: dados.tipo,
    p_midia: captura.midia,
    p_os: dados.osId ?? null,
    p_mime: mime,
    p_bytes: bytes,
    p_lat: dados.lat ?? null,
    p_lng: dados.lng ?? null,
    p_precisao_m: dados.precisao ?? null,
    // Da galeria, a hora nula fica nula: "agora" mentiria a hora da foto.
    p_capturada_em: dados.galeria ? (dados.capturadaEm ?? null)
      : (dados.capturadaEm ?? new Date().toISOString()),
    p_duracao_seg: captura.duracaoSeg ?? null,
    p_observacao: dados.observacao ?? null,
    p_galeria: !!dados.galeria,
    // 135: de ONDE a foto está sendo enviada. É outra pergunta que
    // `p_lat/p_lng` (onde ela foi TIRADA): da galeria, a do arquivo pode
    // ser de outro dia ou não existir, e o site precisa poder dizer se o
    // envio saiu de perto da casa do cliente. GPS negado ou sem sinal
    // manda nulo — "não sei" é resposta, zero não seria.
    p_envio_lat: envio?.lat ?? null,
    p_envio_lng: envio?.lng ?? null,
    p_envio_precisao_m: envio?.precisao ?? null,
  })
  if (error) throw new Error(error.message)
  // Subiu: o que ficou no cache do app sai agora (a cópia reduzida e o
  // original da câmera/galeria). A galeria do técnico não é tocada.
  apagarDoCache(uri)
  if (uri !== captura.uri) apagarDoCache(captura.uri)
  return data as string
}

// ============================================================
// A fila de quem ficou sem sinal
// ============================================================
// O técnico entra em prédio, em subsolo, em rua sem cobertura. A foto
// já foi tirada; perdê-la porque a rede caiu no segundo seguinte é o
// tipo de coisa que faz o campo voltar a mandar foto por WhatsApp.
// O arquivo continua no cache do aparelho e a fila tenta de novo.

async function lerFila(): Promise<Pendente[]> {
  try {
    const bruto = await AsyncStorage.getItem(FILA)
    return bruto ? (JSON.parse(bruto) as Pendente[]) : []
  } catch {
    return []
  }
}

async function gravarFila(f: Pendente[]): Promise<void> {
  await AsyncStorage.setItem(FILA, JSON.stringify(f))
}

export async function enfileirar(
  captura: Captura, dados: DadosEvidencia,
): Promise<void> {
  const fila = await lerFila()
  fila.push({
    ...dados,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uri: captura.uri,
    midia: captura.midia,
    duracaoSeg: captura.duracaoSeg,
    tentativas: 0,
    criadaEm: new Date().toISOString(),
  })
  await gravarFila(fila)
}

export async function quantosPendentes(): Promise<number> {
  return (await lerFila()).length
}

export async function pendentesDaVisita(visitaId: string): Promise<number> {
  return (await lerFila()).filter(p => p.visitaId === visitaId).length
}

/**
 * Tenta subir tudo que ficou para trás. Devolve quantas foram.
 * Item que falhou 5 vezes sai da fila: normalmente o arquivo temporário
 * já foi limpo pelo sistema e insistir só faz a tela travar toda vez.
 */
export async function sincronizar(): Promise<{ enviadas: number; restam: number }> {
  const fila = await lerFila()
  if (fila.length === 0) return { enviadas: 0, restam: 0 }

  const sobraram: Pendente[] = []
  let enviadas = 0

  for (const p of fila) {
    try {
      await enviarEvidencia(
        { uri: p.uri, midia: p.midia, duracaoSeg: p.duracaoSeg },
        p,
      )
      enviadas++
    } catch {
      if (p.tentativas + 1 < 5) sobraram.push({ ...p, tentativas: p.tentativas + 1 })
    }
  }

  await gravarFila(sobraram)
  return { enviadas, restam: sobraram.length }
}

/**
 * Apaga de verdade a foto/vídeo errado — só quem enviou, e o campo só no
 * dia (127, Emanuel 24/10: "sem guardar o arquivo").
 *
 * Dois passos, nesta ordem: o ARQUIVO sai pela API do Storage (o Supabase
 * não deixa apagar pelo SQL), e só depois a linha, por `apagar_evidencia`,
 * que recusa enquanto o arquivo existir. Se a rede cair no meio, a linha
 * continua na tela e tocar de novo termina — apagar o que já saiu não dá erro.
 * Devolve a mensagem de erro, ou null.
 */
export async function apagarEvidencia(id: string, caminho: string): Promise<string | null> {
  const { error: erroArq } = await supabase.storage.from(BUCKET).remove([caminho])
  if (erroArq) return erroArq.message
  const { error } = await supabase.rpc('apagar_evidencia', { p_evidencia: id })
  return error?.message ?? null
}

/** URL assinada para mostrar a evidência já enviada. O bucket é privado:
 *  sem assinatura a imagem volta 400 e a tela mostra um quadrado cinza. */
export async function urlAssinada(caminho: string, segundos = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, segundos)
  return data?.signedUrl ?? null
}
