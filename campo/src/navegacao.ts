/**
 * As telas do aplicativo e o que cada uma recebe.
 *
 * Três telas, de propósito. O concorrente abre com um menu de doze
 * ícones (O.S. Abertas, Ranking, Meta, Premiação, Portaria, Abastecer…)
 * e enterra o trabalho do dia atrás de dois toques. Aqui a agenda É a
 * tela inicial: o técnico abre o aplicativo para fazer visita.
 */
export type Pilha = {
  Agenda: undefined
  Visita: { id: string }
  /** O recibo do que o almoxarifado entregou (079). Fica fora da agenda
   *  de proposito: nao e trabalho do dia, e conferencia de material. */
  Romaneios: undefined
  /** A câmera volta para a visita pelo parâmetro de retorno, e não por
   *  estado global: assim a foto nunca "cai" na visita errada quando o
   *  Android reconstrói a pilha depois de matar o processo. */
  Captura: {
    visitaId: string
    osId?: string | null
    tipo: string
    modo: 'FOTO' | 'VIDEO'
  }
}
