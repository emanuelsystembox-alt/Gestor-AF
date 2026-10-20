/** Carimbada no build por vite.config.ts — a versão que está no ar. */
declare const __VERSAO__: {
  numero: string
  commit: string | null
  /** O build saiu com mudança não commitada. */
  sujo: boolean
  /** ISO, hora do build. */
  em: string
}
