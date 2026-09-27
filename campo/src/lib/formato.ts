/**
 * Formatação. O mesmo cuidado de `app/src/lib/formato.ts`, pelo mesmo
 * motivo: `toISOString()` devolve a data em UTC, e em Manaus (UTC−4) o
 * dia vira às 20h. A agenda abriria no dia seguinte, vazia — D-084.
 */

const dois = (n: number) => String(n).padStart(2, '0')

/** AAAA-MM-DD do dia LOCAL. Nunca use toISOString() para isto. */
export function isoLocal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`
}

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const x = new Date(a, m - 1, d + dias)
  return isoLocal(x)
}

/** "08/09" — cabeçalho da agenda. */
export function diaCurto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

export function diaDaSemana(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  return DIAS[new Date(a, m - 1, d).getDay()]
}

/** "hoje", "ontem" ou "quarta, 10/09" — o técnico pensa assim. */
export function rotuloDoDia(iso: string): string {
  const hoje = isoLocal()
  if (iso === hoje) return 'Hoje'
  if (iso === somarDias(hoje, -1)) return 'Ontem'
  if (iso === somarDias(hoje, 1)) return 'Amanhã'
  return `${diaDaSemana(iso)}, ${diaCurto(iso)}`
}

/** "14:00" a partir de "14:00:00". */
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

/** "08/09 14:32" para o histórico. */
export function carimbo(ts: string): string {
  const d = new Date(ts)
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`
}

export const num2 = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const reais = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const pts = (n: number) => `${num2(n)} pts`

/** "1,2 MB" — o técnico precisa ver o que está subindo no 4G dele. */
export function tamanho(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function duracao(seg: number | null | undefined): string {
  if (!seg) return ''
  return `${Math.floor(seg / 60)}:${dois(Math.round(seg % 60))}`
}

/**
 * Telefone brasileiro em máscara: (92) 99999-9999 ou (92) 3333-4444.
 * Aceita o que vier (só dígitos, com máscara, pela metade) e devolve a
 * máscara do que já foi digitado — serve para o campo enquanto a pessoa
 * digita e para exibir o que o banco guardou (só dígitos, 096).
 * Duplicado de propósito entre a web e o aplicativo (D-112).
 */
export function mascaraTelefone(entrada: string | null | undefined): string {
  const d = (entrada ?? '').replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  // 9 dígitos depois do DDD = celular (5+4); 8 = fixo (4+4).
  const corte = resto.length > 8 ? 5 : 4
  return resto.length <= corte
    ? `(${ddd}) ${resto}`
    : `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** Metros para leitura: "35 m", "1,2 km". Nulo continua nulo. */
export function metros(m: number | null | undefined): string | null {
  if (m == null) return null
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
}
