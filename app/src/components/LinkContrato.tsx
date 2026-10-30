import { useCallback } from 'react'
import { Link, useLocation, useNavigate, type LinkProps, type Location } from 'react-router-dom'

/**
 * Abrir um contrato POR CIMA da tela atual (156).
 *
 * O contrato abre em janela, com a tela de onde veio desenhada atrás
 * (`App.tsx`, "rota com fundo"). Para isso o link leva no estado da
 * navegação a localização de FUNDO. Se a pessoa já está numa janela de
 * contrato e abre outro (o "Serviços anteriores"), o fundo continua o
 * mesmo — senão o X levaria para o contrato anterior, e não para a lista.
 */
function fundoDe(local: Location): Location {
  return (local.state as { fundo?: Location } | null)?.fundo ?? local
}

export function LinkContrato({ to, state, ...resto }: LinkProps) {
  const local = useLocation()
  const extra = (state ?? {}) as Record<string, unknown>
  return <Link to={to} state={{ ...extra, fundo: fundoDe(local) }} {...resto} />
}

/** O mesmo, para quem abre por código (menu do botão direito, cartão da Rota). */
export function useAbrirContrato() {
  const navegar = useNavigate()
  const local = useLocation()
  return useCallback((visitaId: string, acao?: string | null) => {
    navegar(`/controle/visita/${visitaId}`,
      { state: { fundo: fundoDe(local), ...(acao ? { acao } : {}) } })
  }, [navegar, local])
}
