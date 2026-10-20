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

/* ─────────────── a varredura pelas telas do TOA (117, D-192) ─────────────── */

/** Um contrato a varrer: o aid do TOA e se precisa ler o equipamento. */
export interface ItemVarredura { aid: string; precisa_equipamento: boolean }

/** O que a aba do TOA leu de um contrato. */
export interface LidoNoToa {
  ok: boolean
  /** FORA_DO_CONSOLE: o bloco não está no Console aberto (outro bucket/dia). */
  motivo?: 'FORA_DO_CONSOLE' | 'ERRO'
  mensagem?: string
  nome?: string | null
  leuEquipamento?: boolean
  itens?: Record<string, string>[]
}

export interface EventoVarredura {
  evento: 'item' | 'fim'
  aid?: string
  feitos: number
  total: number
  cancelado?: boolean
  resultado?: LidoNoToa
}

/** A varredura exige a extensão 0.2.0 ou mais nova (a que tem o `toa.js`). */
export function extensaoVarre(v: InfoExtensao | null | undefined): boolean {
  if (!v) return false
  const [a, b] = v.versao.split('.').map(Number)
  return a > 0 || b >= 2
}

/**
 * Manda a lista à extensão e devolve os eventos, um a um, até o fim.
 * `aoEvento` é chamado em ordem e AGUARDADO — quem grava no banco grava
 * antes do próximo. Se a aba do TOA ficar 2 min calada, desiste.
 */
export function varrerNoToa(itens: ItemVarredura[], aoEvento: (e: EventoVarredura) => Promise<void>):
  Promise<{ aceito: boolean; mensagem?: string; bucket?: string | null; cancelado?: boolean }> {
  return new Promise(resolve => {
    const id = crypto.randomUUID()
    let fila = Promise.resolve()
    let vigia: ReturnType<typeof setTimeout> | null = null
    let bucket: string | null = null
    const encerrar = (r: { aceito: boolean; mensagem?: string; cancelado?: boolean }) => {
      window.removeEventListener('message', ouvir)
      if (vigia) clearTimeout(vigia)
      fila.then(() => resolve({ ...r, bucket }))
    }
    const rearmar = () => {
      if (vigia) clearTimeout(vigia)
      vigia = setTimeout(() => encerrar({ aceito: true, mensagem: 'A aba do TOA parou de responder por 2 minutos.' }), 120_000)
    }
    const ouvir = (ev: MessageEvent) => {
      const d = ev.data as ({ origem?: string; id?: string; canal?: string; idPedido?: string } & Record<string, unknown>) | null
      if (ev.source !== window || d?.origem !== DA_EXTENSAO) return
      // a resposta ao pedido (aceito ou não)
      if (d.id === id && d.canal !== 'varredura') {
        if (!d.aceito) { encerrar({ aceito: false, mensagem: String(d.mensagem ?? 'A extensão recusou a varredura.') }); return }
        bucket = (d.bucket as string | null) ?? null
        rearmar()
        return
      }
      // o andamento
      if (d.canal === 'varredura' && d.idPedido === id) {
        rearmar()
        const e = d as unknown as EventoVarredura
        fila = fila.then(() => aoEvento(e)).catch(() => {})
        if (e.evento === 'fim') encerrar({ aceito: true, cancelado: !!e.cancelado })
      }
    }
    window.addEventListener('message', ouvir)
    window.postMessage({ origem: DA_PAGINA, id, tipo: 'varrer', itens }, window.location.origin)
    // sem resposta nenhuma em 10 s: a extensão não está aqui
    vigia = setTimeout(() => encerrar({ aceito: false, mensagem: 'A extensão não respondeu.' }), 10_000)
  })
}

export function cancelarVarredura() {
  window.postMessage({ origem: DA_PAGINA, id: crypto.randomUUID(), tipo: 'cancelar-varredura' }, window.location.origin)
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
