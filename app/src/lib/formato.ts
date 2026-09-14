/**
 * Formatos que a tela inteira precisa falar igual.
 *
 * Pontuação com quatro casas (`1,4648`) é o que o banco guarda e o que
 * a planilha de faturamento precisa somar. Na TELA, quatro casas só
 * atrapalham: ninguém compara `20,3331` com `17,3176` de relance, e a
 * coluna fica larga à toa. Duas casas e a unidade escrita — `20,33 pts`
 * — é o que se lê.
 *
 * O EXPORT continua com quatro casas, de propósito: arredondar cada
 * linha antes de somar centenas delas move dinheiro de verdade.
 * Ver `lib/relatorio.ts`.
 */

/** `20,33` — duas casas, vírgula decimal. */
export const num2 = (n: number | string | null | undefined) =>
  n == null ? '' : Number(n).toFixed(2).replace('.', ',')

/** `20,33 pts` — como aparece em etiqueta, célula e total. */
export const pts = (n: number | string | null | undefined) =>
  n == null ? '' : `${num2(n)} pts`

/** `R$ 1.157,10` */
export const reais = (n: number | string | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('pt-BR',
    { style: 'currency', currency: 'BRL' })

/**
 * A data de HOJE como a pessoa vê no relógio dela — não em UTC.
 *
 * ┌─ O ERRO QUE ISTO CONSERTA ───────────────────────────────────────┐
 * │ `new Date().toISOString().slice(0,10)` devolve a data em **UTC**. │
 * │ Manaus é UTC−4: às 22:03 do dia 7, em UTC já é dia 8. O painel    │
 * │ abria no dia seguinte e mostrava "Nenhuma visita neste período"   │
 * │ para uma operação que ainda estava trabalhando.                   │
 * │                                                                   │
 * │ Toda tela que abre "em hoje" passava por aqui — eram nove         │
 * │ cópias da mesma linha errada.                                     │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Usa o fuso do computador de quem olha. Para as 18 praças (AM e RO
 *   em UTC−4, as demais em UTC−3) isso significa que cada um vê o
 *   próprio dia — o que é o comportamento certo enquanto a tela for de
 *   uma praça só. Se um dia o COP em Manaus precisar olhar o dia de
 *   Belém, isto vira `base.fuso` e uma conversão explícita.
 */
export function isoLocal(d: Date = new Date()): string {
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/** `07/09` — dia e mês, para coluna estreita de lista. */
export const diaMes = (iso: string) =>
  new Date(iso + 'T12:00').toLocaleDateString('pt-BR',
    { day: '2-digit', month: '2-digit' })

/** `07/09/2026` */
export const dataBR = (iso: string) =>
  new Date(iso + 'T12:00').toLocaleDateString('pt-BR')

/** `seg`, `ter`… — ajuda a ler a lista de um contrato dia a dia. */
export const diaSemana = (iso: string) =>
  new Date(iso + 'T12:00')
    .toLocaleDateString('pt-BR', { weekday: 'short' })
    .replace('.', '')

/**
 * O nome de uma equipe, sempre igual: **`001 - EQUIPE`**.
 *
 * ┌─ por que existe ─────────────────────────────────────────────────┐
 * │ A mesma equipe aparecia de três jeitos: `74` na coluna da tabela, │
 * │ `074` no painel e `074 · 074 - EQUIPE` no seletor de             │
 * │ transferência — porque uns lugares mostravam o `codigo` e outros  │
 * │ `codigo · nome`, e o `nome` no banco JÁ é "074 - EQUIPE".         │
 * │                                                                   │
 * │ Pior que feio: `importar_equipes` tira o código de                │
 * │ `split_part(nome,'-',1)`, então a planilha que escrever           │
 * │ "45 - EQUIPE" cria a equipe `45` — e `unique (base_id, codigo)`   │
 * │ deixa `45` e `045` conviverem como DUAS equipes diferentes. O     │
 * │ zero à esquerda deixa de ser enfeite e vira identidade.           │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Código numérico vira três dígitos. Código que não é número — a
 * equipe abrigo `SEM-LOGIN` — mantém o nome escrito, que se lê melhor
 * que a sigla.
 */
export function equipeRotulo(
  codigo: string | null | undefined,
  nome?: string | null,
): string {
  const c = (codigo ?? '').trim()
  const n = (nome ?? '').trim()
  if (!c) return n || '—'
  // A equipe abrigo é uma só em todo o sistema, e o nome dela explica o
  // que ela é; a sigla, não. Quem chama nem sempre tem o `nome` em mãos
  // (a lista de filtro só carrega o código), então ele mora aqui.
  if (c === 'SEM-LOGIN') return n || 'Sem login definido'
  if (!/^\d+$/.test(c)) return n || c

  // Tira um prefixo numérico que já venha no nome, para não sair
  // "045 - 45 - EQUIPE" quando a planilha trouxe o código sem o zero.
  const semPrefixo = n.replace(/^\s*\d+\s*[-–·]\s*/, '').trim()
  return `${c.padStart(3, '0')} - ${semPrefixo || 'EQUIPE'}`
}
