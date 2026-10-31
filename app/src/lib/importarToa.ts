import { supabase } from './supabase'
import {
  importarLinhasToa as importarComCliente,
  reconciliarImportacao as reconciliarComCliente,
  type PedidoImportacao, type ResultadoImportacao,
} from './importarToaNucleo'

/**
 * A importação do TOA na WEB — o núcleo (`importarToaNucleo.ts`) com o
 * cliente do site. A extensão usa o mesmo núcleo com o cliente dela
 * (D-193): uma regra só, dois lugares que a chamam.
 */
export {
  ETAPAS, ErroImportacao, impressaoDasLinhas,
  type Resumo, type Desatribuicao, type PedidoImportacao, type ResultadoImportacao,
  type FilaImportacao,
} from './importarToaNucleo'

export function importarLinhasToa(p: PedidoImportacao): Promise<ResultadoImportacao> {
  return importarComCliente(supabase, p)
}

export function reconciliarImportacao(id: string): Promise<boolean> {
  return reconciliarComCliente(supabase, id)
}
