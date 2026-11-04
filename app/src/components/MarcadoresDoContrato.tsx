import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * Os marcadores de qualidade do contrato (URA, GEO, processos…).
 *
 * > "A opção marcadores deve ficar ao lado do botão mais OS. Quando clicar
 * >  em cima, abre um select para o controlador selecionar os marcadores
 * >  que aquele contrato tem. Não precisa deixar eles expostos"
 * >  — Emanuel, 31/10
 *
 * Histórico: 155 numa aba (ninguém achou), 156 num cartão sempre aberto ao
 * lado das O.S. (ocupava espaço com doze botões). Agora é um botão na barra
 * de ações, que diz quantos estão marcados e abre a lista para marcar.
 * Quem grava é o RLS de `visita_marcador` (permissão `servicos.marcadores`);
 * a tela só não oferece o clique a quem não tem.
 */
export function MarcadoresDoContrato({ visitaId, abrirJa = false }: {
  visitaId: string
  /** Veio do "Marcadores…" do botão direito: a lista já nasce aberta. */
  abrirJa?: boolean
}) {
  const { pode } = useAuth()
  const podeMarcar = pode('servicos.marcadores')
  const [indicadores, setIndicadores] = useState<{ id: string; nome: string }[]>([])
  const [marcados, setMarcados] = useState<{ id: string; indicador_id: string }[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Aberto = a posição do botão na tela; nulo = fechado.
  const [pos, setPos] = useState<DOMRect | null>(null)
  const aberto = pos != null
  const botao = useRef<HTMLButtonElement>(null)
  const lista = useRef<HTMLDivElement>(null)

  // ┌─ POR QUE PORTAL ────────────────────────────────────────────────────┐
  // │ A lista morava dentro do cartão do contrato, que tem               │
  // │ `overflow-hidden` (é o que arredonda a borda): ela abria cortada,  │
  // │ com 3 dos 7 marcadores à vista e o resto sumido sem barra de       │
  // │ rolagem (Emanuel, 03/11). Vai para o `.sup-controle` mais perto —  │
  // │ a caixa da janela, que dá o tema e não tem transform depois da     │
  // │ entrada (162) — em `fixed`, presa ao botão. O mesmo da D-169.      │
  // └─────────────────────────────────────────────────────────────────────┘
  const abrir = useCallback(() => {
    const r = botao.current?.getBoundingClientRect()
    if (r) setPos(r)
  }, [])

  // Espera a entrada da janela (200 ms): durante a animação a caixa TEM
  // transform, e o `fixed` mediria dela — a lista abriria fora do lugar.
  useEffect(() => {
    if (!abrirJa) return
    const t = setTimeout(abrir, 260)
    return () => clearTimeout(t)
  }, [abrirJa, abrir])

  const carregar = useCallback(async () => {
    const [i, m] = await Promise.all([
      supabase.from('indicador_qualidade').select('id, nome').eq('ativo', true).order('ordem'),
      supabase.from('visita_marcador').select('id, indicador_id').eq('visita_id', visitaId),
    ])
    setIndicadores((i.data ?? []) as { id: string; nome: string }[])
    setMarcados((m.data ?? []) as { id: string; indicador_id: string }[])
  }, [visitaId])

  useEffect(() => { carregar() }, [carregar])

  // Fecha no clique fora, no Esc e quando a tela rola (lista fixa sobre uma
  // tela que andou aponta para o lugar errado). O Esc é pego na CAPTURA e
  // não segue: senão o mesmo Esc fecharia também a janela do contrato.
  useEffect(() => {
    if (!aberto) return
    const dentro = (n: EventTarget | null) =>
      !!n && (lista.current?.contains(n as Node) || botao.current?.contains(n as Node))
    const fora = (e: MouseEvent) => { if (!dentro(e.target)) setPos(null) }
    const rolou = (e: Event) => { if (!dentro(e.target)) setPos(null) }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setPos(null)
    }
    const fechar = () => setPos(null)
    document.addEventListener('mousedown', fora)
    document.addEventListener('scroll', rolou, true)
    window.addEventListener('resize', fechar)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('scroll', rolou, true)
      window.removeEventListener('resize', fechar)
      window.removeEventListener('keydown', esc, true)
    }
  }, [aberto])

  async function alternar(indicadorId: string) {
    setOcupado(true); setErro(null)
    const atual = marcados.find(m => m.indicador_id === indicadorId)
    const { error } = atual
      ? await supabase.from('visita_marcador').delete().eq('id', atual.id)
      : await supabase.from('visita_marcador').insert({ visita_id: visitaId, indicador_id: indicadorId })
    if (error) setErro(error.message)
    await carregar()
    setOcupado(false)
  }

  // Sem espaço embaixo, abre para cima; sem espaço à direita, alinha pela
  // borda direita do botão. O translate usa o tamanho REAL da lista.
  const paraCima = pos != null && pos.bottom + 340 > window.innerHeight && pos.top > 340
  const paraEsquerda = pos != null && pos.left + 256 > window.innerWidth

  return (
    <>
      <button ref={botao} onClick={() => (aberto ? setPos(null) : abrir())}
        aria-expanded={aberto} aria-haspopup="true"
        className={`rounded-md border px-2.5 py-1 text-xs hover:border-af-600 hover:text-af-400 ${
          marcados.length ? 'border-sky-700/60 text-sky-300' : 'border-graf-700 text-graf-300'}`}>
        Marcadores{marcados.length > 0 && <span className="tabular"> ({marcados.length})</span>} ▾
      </button>
      {pos && createPortal(
        <div ref={lista} role="dialog" aria-label="Marcadores do contrato"
          style={{
            left: paraEsquerda ? pos.right : pos.left,
            top: paraCima ? pos.top - 4 : pos.bottom + 4,
            transform: `translate(${paraEsquerda ? '-100%' : '0'}, ${paraCima ? '-100%' : '0'})`,
          }}
          className="fixed z-50 w-64 rounded-lg border border-graf-700 bg-graf-900 p-2
                     text-left shadow-2xl">
          <p className="mb-1.5 px-1 text-[11px] text-graf-400">
            {podeMarcar ? 'Marque o que este contrato tem.' : 'Só quem tem a permissão de marcadores altera.'}
          </p>
          {indicadores.length === 0 ? (
            <p className="px-1 py-2 text-xs text-graf-400">Nenhum marcador cadastrado. Cadastre em Configurações.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {indicadores.map(i => {
                const on = marcados.some(m => m.indicador_id === i.id)
                return (
                  <li key={i.id}>
                    <label className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${
                      podeMarcar ? 'cursor-pointer hover:bg-graf-800' : 'text-graf-400'}`}>
                      <input type="checkbox" checked={on} disabled={ocupado || !podeMarcar}
                        onChange={() => alternar(i.id)} className="accent-af-600" />
                      <span className={on ? 'text-sky-300' : 'text-graf-200'}>{i.nome}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {erro && <p className="mt-1.5 px-1 text-xs text-af-400">{erro}</p>}
        </div>,
        botao.current?.closest('.sup-controle') ?? document.body,
      )}
    </>
  )
}
