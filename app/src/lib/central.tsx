import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

/**
 * A central do controle (091) — o selo do canto superior direito.
 *
 * ┌─ um provedor, não um efeito no Shell ─────────────────────────────┐
 * │ Cada página monta o próprio <Shell>. Se o canal do Realtime       │
 * │ morasse nele, trocar de tela fecharia e reabriria a assinatura —  │
 * │ e o aviso que chegasse no meio da troca se perderia. O provedor   │
 * │ fica acima das rotas: um canal só, a sessão inteira, removido no  │
 * │ logout (canal pendurado é conexão do teto do plano Free).         │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * A linha é a verdade, o Realtime é o carregador (D-119): a central é
 * relida a cada minuto de qualquer jeito, e o evento só antecipa.
 * O Realtime traz DOIS gatilhos que merecem aviso na hora:
 *   · Impedimento vindo do CAMPO = pedido de ajuda (Emanuel, 27/09);
 *   · mensagem nova do técnico.
 */

export interface ItemAjuda {
  visita_id: string; contrato: string | null; servico: string; tecnico: string | null
  equipe: string | null; desde: string; observacao: string | null
}
export interface ItemTec1 { tecnico_id: string; nome: string; equipe: string | null; qtd: number }
export interface CorteRitmo {
  corte: number; fracao: number; sem_meta: number
  abaixo: { tecnico_id: string; nome: string; equipe: string | null; pontos: number; esperado: number }[]
}
export interface ItemQuebrou {
  tecnico_id: string; nome: string; equipe: string | null; quebradas: number; pontos_perdidos: number
}
export interface ItemMsg { tecnico_id: string; nome: string; nao_lidas: number; ultima_texto: string; ultima_em: string }
export interface ItemMaterial { id: string; tipo: 'FALTANDO' | 'DEFEITO'; tecnico: string; item: string | null; criado_em: string }
export interface ItemAbast { id: string; placa: string; tecnico: string | null; valor: number; criado_em: string }

export interface Central {
  ajuda?: ItemAjuda[]; tec1?: ItemTec1[]; ritmo?: CorteRitmo[]; quebrou?: ItemQuebrou[]
  mensagens?: ItemMsg[]; material?: ItemMaterial[]; abastecimento?: ItemAbast[]
  gerado_em: string
}

export interface Toast { id: number; titulo: string; texto: string; tom: 'ajuda' | 'mensagem' }

/** Uma mensagem que acabou de chegar pelo Realtime — o chat aberto usa. */
export interface MensagemAoVivo {
  id: number; tecnico_id: string; do_campo: boolean; autor_nome: string | null
  texto: string; criado_em: string; lida_em: string | null
}

interface Ctx {
  dados: Central | null
  recarregar: () => void
  toasts: Toast[]
  fecharToast: (id: number) => void
  ultimaMensagem: MensagemAoVivo | null
  /** Quantas coisas pedem atenção agora — o número do sino. */
  total: number
  chatAberto: boolean
  abrirChat: (tecnicoId?: string | null) => void
  fecharChat: () => void
  chatTecnico: string | null
}

const CentralCtx = createContext<Ctx | null>(null)

/** O que o sino conta: o que pede AÇÃO. Mensagem não entra — ela tem o
 *  próprio selo, no balão. O ritmo conta o último corte passado. */
export function contarAtencao(d: Central | null): number {
  if (!d) return 0
  const ultimoCorte = d.ritmo?.length ? d.ritmo[d.ritmo.length - 1] : null
  return (d.ajuda?.length ?? 0) + (d.tec1?.length ?? 0)
    + (ultimoCorte?.abaixo.length ?? 0) + (d.quebrou?.length ?? 0)
    + (d.material?.length ?? 0) + (d.abastecimento?.length ?? 0)
}

let proximoToast = 1

export function CentralProvider({ children }: { children: ReactNode }) {
  const { session, ehGestor, temPapel, pode } = useAuth()
  const ligado = !!session && (ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR')
    || pode('almoxarifado.ver') || pode('frota.ver'))
  const gestao = ehGestor || temPapel('CONTROLADOR', 'SUPERVISOR')

  const [dados, setDados] = useState<Central | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [ultimaMensagem, setUltimaMensagem] = useState<MensagemAoVivo | null>(null)
  const [chatAberto, setChatAberto] = useState(false)
  const [chatTecnico, setChatTecnico] = useState<string | null>(null)
  const chatRef = useRef({ aberto: false, tecnico: null as string | null })
  chatRef.current = { aberto: chatAberto, tecnico: chatTecnico }

  const recarregar = useCallback(() => {
    if (!ligado) return
    supabase.rpc('central_do_controle').then(({ data, error }) => {
      // Erro não zera o que já se sabia: o sino continua com o último
      // número conhecido, em vez de "0" que afirmaria que está tudo bem.
      if (!error && data) setDados(data as Central)
    })
  }, [ligado])

  const avisar = useCallback((t: Omit<Toast, 'id'>) => {
    const id = proximoToast++
    setToasts(l => [...l.slice(-3), { ...t, id }])
    setTimeout(() => setToasts(l => l.filter(x => x.id !== id)), 9000)
  }, [])

  useEffect(() => {
    if (!ligado) { setDados(null); return }
    recarregar()
    const t = setInterval(recarregar, 60_000)
    return () => clearInterval(t)
  }, [ligado, recarregar])

  // Um canal só para os dois gatilhos. Só gestão assina: o almoxarife e a
  // frota não recebem pedido de ajuda nem conversa de técnico.
  useEffect(() => {
    if (!ligado || !gestao) return
    const canal = supabase
      .channel('central:ao-vivo')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visita_evento' }, c => {
        const e = c.new as { origem?: string; para?: { situacao?: string } | null; observacao?: string | null }
        if (e.origem === 'MOBILE' && e.para?.situacao === 'COM_IMPEDIMENTO') {
          avisar({ tom: 'ajuda', titulo: 'Pedido de ajuda do campo',
                   texto: e.observacao || 'Um técnico registrou impedimento num contrato.' })
          recarregar()
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagem' }, c => {
        const m = c.new as MensagemAoVivo
        setUltimaMensagem(m)
        if (m.do_campo) {
          const lendoEsta = chatRef.current.aberto && chatRef.current.tecnico === m.tecnico_id
          if (!lendoEsta) {
            avisar({ tom: 'mensagem', titulo: `Mensagem de ${m.autor_nome ?? 'técnico'}`, texto: m.texto })
          }
          recarregar()
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [ligado, gestao, avisar, recarregar])

  const valor: Ctx = {
    dados, recarregar, toasts, ultimaMensagem,
    fecharToast: id => setToasts(l => l.filter(x => x.id !== id)),
    total: contarAtencao(dados),
    chatAberto, chatTecnico,
    abrirChat: tec => { setChatTecnico(tec ?? null); setChatAberto(true) },
    fecharChat: () => { setChatAberto(false); recarregar() },
  }

  return (
    <CentralCtx.Provider value={valor}>
      {children}
      {/* Os avisos que aparecem sozinhos. `aria-live` para o leitor de
          tela anunciar sem roubar o foco de quem está digitando. */}
      <div aria-live="polite" className="pointer-events-none fixed right-4 top-16 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} role="status"
            className={`sup-controle pointer-events-auto rounded-lg border px-3.5 py-3 shadow-2xl ${
              t.tom === 'ajuda' ? 'border-orange-500/60 bg-graf-900' : 'border-af-600/50 bg-graf-900'}`}>
            <div className="flex items-start gap-2">
              <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                t.tom === 'ajuda' ? 'bg-orange-500' : 'bg-af-500'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-graf-100">{t.titulo}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-graf-300">{t.texto}</p>
              </div>
              <button onClick={() => valor.fecharToast(t.id)} aria-label="Fechar aviso"
                className="text-xs text-graf-400 hover:text-graf-100">✕</button>
            </div>
          </div>
        ))}
      </div>
    </CentralCtx.Provider>
  )
}

export function useCentral(): Ctx {
  const c = useContext(CentralCtx)
  if (!c) throw new Error('useCentral precisa estar dentro de <CentralProvider>')
  return c
}
