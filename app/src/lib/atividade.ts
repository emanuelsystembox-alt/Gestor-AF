/**
 * Quantos pedidos ao banco estão em andamento AGORA (D-347).
 *
 * > "adicionar transições e efeitos de carregamento mais suaves e visuais
 * >  para o usuário sentir leveza em cada transição de página e carregamento
 * >  de dados, padronize tudo" — Emanuel, 09/11
 *
 * O fio no topo (`BarraAtividade`, no Shell) acende sempre que o sistema
 * busca dado — em QUALQUER tela, sem cada uma ter de lembrar de pedir.
 * A conta sai do próprio cliente do Supabase (`global.fetch`), que é por
 * onde passa todo pedido de tabela e de RPC. O token de login renovado em
 * segundo plano (`/auth/v1/`) não conta: não é a pessoa esperando nada.
 */

let emAndamento = 0
const ouvintes = new Set<(n: number) => void>()

function avisar() {
  for (const o of ouvintes) o(emAndamento)
}

export function ouvirAtividade(fn: (n: number) => void): () => void {
  ouvintes.add(fn)
  fn(emAndamento)
  return () => { ouvintes.delete(fn) }
}

export const fetchComAtividade: typeof fetch = async (entrada, init) => {
  const url = typeof entrada === 'string' ? entrada
    : entrada instanceof URL ? entrada.href : entrada.url
  if (url.includes('/auth/v1/')) return fetch(entrada, init)
  emAndamento++
  avisar()
  try {
    return await fetch(entrada, init)
  } finally {
    emAndamento--
    avisar()
  }
}
