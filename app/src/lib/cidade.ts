import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * A cidade ativa — o "MANAUS · AM" do topo, que deixou de ser fixo (103).
 *
 * ┌─ quem separa as cidades é o BANCO, não esta tela ────────────────┐
 * │ > "o sistema precisa saber dividir os bucket de quais cidades     │
 * │ >  são para não misturar, nem todo mundo vai conseguir navegar   │
 * │ >  em outras cidades" — Emanuel, 17/10                           │
 * │                                                                  │
 * │ A escolha mora em `perfil.base_ativa`, e `bases_visiveis()` — que │
 * │ as policies e as funções já perguntam — passou a responder só a  │
 * │ cidade ativa. Nenhuma tela precisa filtrar por cidade: o RLS não │
 * │ devolve a outra. Trocar é `trocar_cidade`, que recusa cidade que │
 * │ a pessoa não pode ver; depois a página RECARREGA, para nenhuma   │
 * │ tela ficar com dado da cidade anterior na memória. Ver D-180.    │
 * └──────────────────────────────────────────────────────────────────┘
 */
export interface Cidade {
  id: string; codigo: string; nome: string; regiao: string | null; ativa: boolean
}

let cache: Promise<Cidade[]> | null = null

export function carregarCidades(): Promise<Cidade[]> {
  cache ??= Promise.resolve(supabase.rpc('minhas_cidades')).then(({ data, error }) => {
    if (error) { cache = null; return [] }
    return (data ?? []) as Cidade[]
  })
  return cache
}

/** A lista de cidades que a pessoa pode ver e qual está ativa agora. */
export function useCidades() {
  const [cidades, setCidades] = useState<Cidade[] | null>(null)
  useEffect(() => {
    let vivo = true
    carregarCidades().then(c => { if (vivo) setCidades(c) })
    return () => { vivo = false }
  }, [])
  const ativa = cidades?.find(c => c.ativa) ?? (cidades?.length === 1 ? cidades[0] : null)
  return { cidades, ativa }
}

/** Troca a cidade ativa e recarrega a página. Devolve o erro, se houver. */
export async function trocarCidade(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('trocar_cidade', { p_base: id })
  if (error) return error.message
  cache = null
  window.location.reload()
  return null
}
