import { useEffect, useState } from 'react'

/**
 * Tema da superfície de CONTROLE — escuro ou claro.
 *
 * ┌─ POR QUE SÓ O CONTROLE TEM TEMA ─────────────────────────────────┐
 * │ D-011 diz que campo é claro por necessidade física: o técnico usa │
 * │ o celular sob sol direto, e tela clara é muito mais legível ali.  │
 * │ Isso não é preferência, é condição de trabalho — então o CAMPO    │
 * │ NÃO tem chave. Ele é claro e pronto.                              │
 * │                                                                   │
 * │ O controle é o oposto: quem fica oito horas na tela tem           │
 * │ preferência legítima, e sala clara com tela escura cansa tanto    │
 * │ quanto o contrário. Aí a chave faz sentido.                       │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * A troca não reescreve componente nenhum: `data-tema="claro"` no
 * <html> redefine as VARIÁVEIS de cor dentro de `.sup-controle`
 * (ver styles.css). `bg-graf-900` continua sendo `bg-graf-900`; o que
 * muda é quanto vale graf-900. Por isso o campo, que está fora desse
 * seletor, não é afetado.
 */

export type Tema = 'escuro' | 'claro'

const CHAVE = 'afline:tema'

export function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE)
    if (t === 'claro' || t === 'escuro') return t
  } catch {
    // Navegador com armazenamento bloqueado. O padrão resolve.
  }
  return 'escuro'
}

export function aplicarTema(t: Tema) {
  document.documentElement.dataset.tema = t
  try { localStorage.setItem(CHAVE, t) } catch { /* idem */ }
}

/** Aplica antes do primeiro render, para não piscar escuro e virar claro. */
export function iniciarTema() {
  document.documentElement.dataset.tema = lerTema()
}

export function useTema(): [Tema, (t: Tema) => void] {
  const [tema, setTemaLocal] = useState<Tema>(lerTema)
  useEffect(() => { aplicarTema(tema) }, [tema])
  return [tema, setTemaLocal]
}
