/**
 * A conversa com a extensão "AFLINE — ponte com o TOA" (`extensao-toa/`,
 * 111, D-189).
 *
 * ┌─ por que uma extensão, e não um fetch daqui ─────────────────────┐
 * │ O navegador proíbe um site de usar o login de outro: um fetch    │
 * │ desta página para o TOA sai sem o cookie da sessão (e o CORS     │
 * │ nem deixa ler a resposta). A extensão tem permissão para o       │
 * │ endereço do TOA e faz a MESMA chamada do botão Exportar, com a   │
 * │ sessão de quem logou no TOA neste Chrome.                        │
 * │                                                                  │
 * │ A extensão só sabe EXPORTAR: monta ela mesma a URL a partir do   │
 * │ número do bucket e do dia, confere os dois, e devolve a          │
 * │ planilha. Esta página não consegue pedir outra coisa ao TOA.     │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * O canal é `window.postMessage` com o script de conteúdo da extensão,
 * filtrado por origem e por um id por pedido.
 */

const DA_PAGINA = 'afline-gestor'
const DA_EXTENSAO = 'afline-ponte-toa'

export interface InfoExtensao { versao: string }

export type ResultadoExportacao =
  | { ok: true; nome: string | null; bytes: ArrayBuffer }
  | { ok: false; motivo: 'SEM_SESSAO' | 'ERRO' | 'SEM_EXTENSAO'; mensagem: string }

interface Resposta {
  ok?: boolean; versao?: string; nome?: string | null; base64?: string
  motivo?: string; mensagem?: string
}

function pedir(tipo: string, dados: Record<string, unknown>, limiteMs: number): Promise<Resposta | null> {
  return new Promise(resolve => {
    const id = crypto.randomUUID()
    const ouvir = (ev: MessageEvent) => {
      const d = ev.data as ({ origem?: string; id?: string } & Resposta) | null
      if (ev.source !== window || d?.origem !== DA_EXTENSAO || d.id !== id) return
      clearTimeout(t)
      window.removeEventListener('message', ouvir)
      resolve(d)
    }
    const t = setTimeout(() => { window.removeEventListener('message', ouvir); resolve(null) }, limiteMs)
    window.addEventListener('message', ouvir)
    window.postMessage({ origem: DA_PAGINA, id, tipo, ...dados }, window.location.origin)
  })
}

/** A extensão está instalada e respondendo nesta aba? Nulo = não. */
export async function extensaoPresente(): Promise<InfoExtensao | null> {
  const r = await pedir('ping', {}, 1500)
  return r?.versao ? { versao: r.versao } : null
}

/** Exporta a planilha de Atividades de um bucket num dia — o botão Exportar do TOA. */
export async function exportarDoToa(numeroToa: number, dia: string): Promise<ResultadoExportacao> {
  // O TOA levou 2,2 s para 206 KB (MAN-AFLINE, 19/10). Dois minutos é folga
  // para o bucket cheio num dia de rede ruim, e não deixa o robô parado.
  const r = await pedir('exportar', { numero: numeroToa, dia }, 120_000)
  if (!r) return {
    ok: false, motivo: 'SEM_EXTENSAO',
    mensagem: 'A extensão "AFLINE — ponte com o TOA" não respondeu. Confira se ela está instalada e ligada neste Chrome.',
  }
  if (!r.ok || !r.base64) return {
    ok: false, motivo: r.motivo === 'SEM_SESSAO' ? 'SEM_SESSAO' : 'ERRO',
    mensagem: r.mensagem ?? 'O TOA não devolveu a planilha.',
  }
  const bin = atob(r.base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { ok: true, nome: r.nome ?? null, bytes: bytes.buffer }
}

/**
 * O bucket que o NOME do arquivo diz — a mesma leitura de
 * `bucket_do_arquivo()` no banco (103, D-180).
 */
export function bucketDoNome(nome: string): string | null {
  const m = /^Atividades-(.+?)_\d{2}_\d{2}_\d{2}(?:\s*\(\d+\))?\.(?:xlsx|xls|csv)$/i.exec(nome.trim())
  return m ? m[1].toUpperCase() : null
}

/** `Atividades-MAN-AFLINE_19_10_26.xlsx` — o nome que o TOA dá, para quando ele não disser. */
export function nomePadrao(bucket: string, diaIso: string): string {
  const [a, m, d] = diaIso.split('-')
  return `Atividades-${bucket}_${d}_${m}_${a.slice(2)}.xlsx`
}
