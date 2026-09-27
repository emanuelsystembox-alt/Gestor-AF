/**
 * As telas do aplicativo e o que cada uma recebe.
 *
 * A agenda continua sendo a tela inicial (D-112): o técnico abre o
 * aplicativo para fazer visita. O concorrente abre com um menu de doze
 * ícones e enterra o trabalho do dia atrás de dois toques.
 *
 * As outras quatro portas do dia a dia (091) ficam numa BARRA de baixo,
 * ao alcance do polegar, e não num menu: Painel, Conversa, Material e
 * Abastecer. Trocar de aba SUBSTITUI a tela (a pilha fica rasa), então o
 * "voltar" do Android sai do aplicativo pela agenda, como antes.
 */
export type Pilha = {
  Agenda: undefined
  /** Meus pontos, a meta, o que quebrou e o ranking (091). */
  Painel: undefined
  /** A conversa com o controle (091). */
  Conversa: undefined
  /** Meu estoque: ferramental, miscelânea, seriais; e sinalizar (091). */
  Material: undefined
  /** Pedir abastecimento do carro que está no meu nome (091). */
  Abastecer: undefined
  Visita: { id: string }
  /** O recibo do que o almoxarifado entregou (079). Fica fora da agenda
   *  de proposito: nao e trabalho do dia, e conferencia de material. */
  Romaneios: undefined
  /** O técnico pede a transferência para um colega (089-C). */
  Transferir: undefined
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

/** As abas da barra de baixo, na ordem em que aparecem. */
export type Aba = 'Agenda' | 'Painel' | 'Conversa' | 'Material' | 'Abastecer'
