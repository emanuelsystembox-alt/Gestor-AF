/**
 * A linguagem visual do CAMPO — D-011.
 *
 * Clara, espaçada, alvo de toque de 48 px. Não é gosto: o técnico usa
 * isto no sol de Manaus, com uma mão, às vezes de luva. Tela escura sob
 * luz direta vira espelho.
 *
 * A rampa é a mesma da web (`app/src/styles.css`) para os dois lados do
 * sistema parecerem o mesmo produto.
 */

export const cor = {
  /** vermelho AFLINE */
  af50: '#fef2f3',
  af100: '#fde3e5',
  af500: '#e4262f',
  af600: '#d11a24',
  af700: '#b01e25',

  tinta: '#0f1115',
  graf600: '#3a4150',
  graf500: '#566072',
  graf400: '#7c869a',
  graf300: '#9aa3af',
  graf200: '#c8cdd6',
  graf100: '#e4e7ec',
  graf50: '#f4f6f8',
  branco: '#ffffff',

  verde: '#16a34a',
  verde50: '#f0fdf4',
  verde900: '#14532d',
  ambar: '#d97706',
  ambar50: '#fffbeb',
  azul: '#2563eb',
} as const

/** Altura mínima de qualquer coisa que se toca. */
export const TOQUE = 52
/** O botão principal do rodapé — o polegar acha sem olhar. */
export const TOQUE_GRANDE = 60

export const raio = { s: 8, m: 12, g: 14 } as const

export const sombraCard = {
  shadowColor: '#0f1115',
  shadowOpacity: 0.05,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const
