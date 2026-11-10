import { useEffect, useState } from 'react'

/**
 * O aviso de que saiu versão nova do site (D-352).
 *
 * > "toda vez que tiver um update o sistema deve mostrar uma mensagem
 * >  flutuante no canto superior direito informando que é para o usuário
 * >  apertar CONTROL + SHIFT + R para receber a atualização mais recente do
 * >  sistema. ou ele pode clicar em ignorar." — Emanuel, 09/11
 *
 * O build publica `versao.json` com o carimbo de hora da versão (vite.config);
 * a página carregada tem o carimbo dela em `__VERSAO__`. Diferentes = há
 * versão nova no ar. Confere a cada 3 min e quando a aba volta ao foco.
 * "Ignorar" vale só para AQUELA versão: a próxima publicação avisa de novo.
 * No servidor local (dev) não há `versao.json` e o aviso não existe.
 */
const CHAVE = 'pulsoline.versao_ignorada'

function lerIgnorada(): string | null {
  try { return localStorage.getItem(CHAVE) } catch { return null }
}

export function AvisoAtualizacao() {
  const [nova, setNova] = useState<string | null>(null)

  useEffect(() => {
    if (import.meta.env.DEV) return
    let vivo = true
    const conferir = async () => {
      try {
        const r = await fetch(`/versao.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const v = await r.json() as { em?: string }
        if (vivo && v.em && v.em !== __VERSAO__.em && v.em !== lerIgnorada()) setNova(v.em)
      } catch { /* sem rede: confere na próxima */ }
    }
    conferir()
    const t = setInterval(conferir, 3 * 60 * 1000)
    const foco = () => { if (document.visibilityState === 'visible') conferir() }
    document.addEventListener('visibilitychange', foco)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', foco) }
  }, [])

  if (!nova) return null

  const ignorar = () => {
    try { localStorage.setItem(CHAVE, nova) } catch { /* só esconde nesta aba */ }
    setNova(null)
  }
  const tecla = 'rounded border border-graf-600 bg-graf-800 px-1.5 py-0.5 font-mono text-[11px] text-graf-100'

  return (
    <div role="status" aria-live="polite"
      className="aparece fixed right-4 top-14 z-[80] w-80 rounded-xl border border-graf-700 border-l-4
                 bg-graf-900 p-3.5 shadow-2xl"
      style={{ borderLeftColor: '#d11a24' }}>
      <p className="flex items-center gap-2 text-sm font-semibold text-graf-100">
        <span className="ponto-novo h-2 w-2 rounded-full" style={{ background: '#d11a24' }} />
        Atualização disponível
      </p>
      <p className="mt-1.5 text-xs text-graf-300">
        Aperte <kbd className={tecla}>Ctrl</kbd> + <kbd className={tecla}>Shift</kbd> + <kbd className={tecla}>R</kbd>
        {' '}para receber a versão mais recente do sistema.
      </p>
      <div className="mt-3 flex justify-end">
        <button onClick={ignorar}
          className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-300 hover:border-af-600 hover:text-af-400">
          Ignorar
        </button>
      </div>
    </div>
  )
}
