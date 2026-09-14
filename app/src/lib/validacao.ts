/**
 * Validação de cadastro de pessoa.
 *
 * ┌─ o que isto conserta ────────────────────────────────────────────┐
 * │ > "campos de cadastro estão deixando eu colocar qualquer coisa,   │
 * │ >  inclusive número de telefone fora do padrão, cpf e etc"        │
 * │ >  — Emanuel                                                      │
 * │                                                                   │
 * │ Estava tudo em `<input type="text">` sem uma linha de conferência.│
 * │ Os três cadastros de teste ficaram assim no banco:                │
 * │     cpf "123123123213" (12 dígitos)  whatsapp "213123213213"      │
 * │     data_nascimento 22222-02-22  ← ano vinte e dois mil           │
 * │ O Postgres aceitou o ano 22222 porque `date` vai até 5874897 AD.  │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * **Guardar é sempre SÓ DÍGITOS** para CPF e telefone; a máscara é da
 * tela. Guardar "123.456.789-09" e "12345678909" na mesma coluna faz
 * duas linhas do mesmo CPF nunca se encontrarem.
 *
 * A dureza de cada regra é escolhida, não é distração:
 *
 * - CPF, telefone e data têm regra objetiva → **barram**.
 * - RG **não tem padrão nacional** (cada estado emite o seu, com letra,
 *   tamanho e dígito diferentes). Conferir tamanho e caracteres é o
 *   máximo honesto; inventar "dígito verificador de RG" reprovaria
 *   documento de gente de verdade.
 * - Login do TOA **avisa, não barra**: o padrão saiu do dado real (106
 *   de 106 técnicos são letra + 6 ou 7 dígitos, T ou Z), mas quem emite
 *   é a operadora. Barrar um padrão novo pararia o cadastro por causa
 *   de uma regra nossa. Ver `agent_docs/business-rules.md`.
 */

/** Tira tudo que não é dígito. É assim que CPF e telefone são guardados. */
export const soDigitos = (v: string | null | undefined) =>
  (v ?? '').replace(/\D+/g, '')

// ---------------------------------------------------------------- //
// CPF

/**
 * CPF com dígito verificador conferido.
 *
 * Só contar 11 dígitos deixa passar "111.111.111-11" e qualquer número
 * digitado ao acaso — e CPF errado no cadastro é o tipo de coisa que só
 * aparece meses depois, no RH.
 */
export function cpfValido(v: string | null | undefined): boolean {
  const d = soDigitos(v)
  if (d.length !== 11) return false
  // Todos iguais passam na conta dos dígitos, e nenhum deles existe.
  if (/^(\d)\1{10}$/.test(d)) return false
  for (const [ate, pos] of [[9, 10], [10, 11]] as const) {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (pos - i)
    const resto = (soma * 10) % 11 % 10
    if (resto !== Number(d[ate])) return false
  }
  return true
}

/** `123.456.789-09` — máscara de tela, nunca o que vai para o banco. */
export function formataCPF(v: string | null | undefined): string {
  const d = soDigitos(v).slice(0, 11)
  if (!d) return ''
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
}

// ---------------------------------------------------------------- //
// Telefone

/**
 * Celular ou fixo brasileiro: DDD válido + 8 ou 9 dígitos.
 *
 * DDD começa em 11 e não existe terminado em 0 nem DDD 20, 23, 25… mas
 * a lista completa muda quando a Anatel abre região nova. Conferimos o
 * que não muda: 2 dígitos, primeiro entre 1 e 9, segundo entre 1 e 9
 * (não há DDD x0), e celular de 9 dígitos começando em 9.
 */
export function telefoneValido(v: string | null | undefined): boolean {
  const d = soDigitos(v)
  if (d.length !== 10 && d.length !== 11) return false
  const ddd = d.slice(0, 2)
  if (ddd[0] === '0' || ddd[1] === '0') return false
  if (d.length === 11 && d[2] !== '9') return false
  return true
}

/** `(92) 99123-4567` */
export function formataTelefone(v: string | null | undefined): string {
  const d = soDigitos(v).slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

// ---------------------------------------------------------------- //
// Resto

export function emailValido(v: string | null | undefined): boolean {
  const t = (v ?? '').trim()
  // Proposital: nem tenta ser a RFC. Pega o que erra de verdade —
  // espaço, arroba faltando, domínio sem ponto.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)
}

/** Idade plausível para quem trabalha: 16 a 90 anos. */
export function nascimentoValido(iso: string | null | undefined): boolean {
  const t = (iso ?? '').trim()
  if (!t) return true                       // vazio é opcional, não inválido
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false
  const d = new Date(t + 'T12:00')
  if (Number.isNaN(d.getTime())) return false
  const hoje = new Date()
  let anos = hoje.getFullYear() - d.getFullYear()
  const m = hoje.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) anos--
  return anos >= 16 && anos <= 90
}

/** RG: sem padrão nacional. Confere tamanho e caracteres, e só. */
export function rgValido(v: string | null | undefined): boolean {
  const t = (v ?? '').trim()
  if (!t) return true
  return /^[0-9A-Za-z.\-/ ]{5,20}$/.test(t)
}

/** Matrícula do ponto: dígitos, até 20. */
export function matriculaPontoValida(v: string | null | undefined): boolean {
  const t = (v ?? '').trim()
  if (!t) return true
  return /^\d{1,20}$/.test(t)
}

/**
 * O padrão de login do TOA, derivado dos 106 técnicos importados:
 * uma letra (T ou Z) e 6 ou 7 dígitos. **Aviso, não barreira.**
 */
export function loginToaNoPadrao(v: string | null | undefined): boolean {
  const t = (v ?? '').trim()
  if (!t) return true
  return /^[A-Za-z]\d{6,7}$/.test(t)
}

export function nomeValido(v: string | null | undefined): boolean {
  const t = (v ?? '').trim()
  // Duas palavras: nome sem sobrenome não identifica ninguém numa lista
  // de 106 técnicos, que é para o que este cadastro serve.
  return t.length >= 5 && /\s/.test(t) && !/^\d+$/.test(t)
}

// ---------------------------------------------------------------- //

export interface ErrosCadastro { [campo: string]: string }

/**
 * Confere o cadastro inteiro e devolve UM recado por campo errado.
 *
 * Devolve mapa vazio quando está tudo certo — quem chama testa
 * `Object.keys(erros).length`.
 */
export function conferirCadastro(c: {
  nome?: string; email?: string; cpf?: string; rg?: string
  whatsapp?: string; data_nascimento?: string; matricula_ponto?: string
  apelido?: string
}, opcoes: { exigeEmail?: boolean } = {}): ErrosCadastro {
  const e: ErrosCadastro = {}

  if (!nomeValido(c.nome)) {
    e.nome = 'Escreva o nome completo — nome e sobrenome.'
  }
  if (opcoes.exigeEmail !== false && !emailValido(c.email)) {
    e.email = 'E-mail inválido. É por ele que a pessoa entra no sistema.'
  }
  if ((c.cpf ?? '').trim() && !cpfValido(c.cpf)) {
    e.cpf = soDigitos(c.cpf).length === 11
      ? 'CPF com 11 dígitos, mas o dígito verificador não fecha. Confira.'
      : `CPF tem 11 dígitos — este tem ${soDigitos(c.cpf).length}.`
  }
  if (!rgValido(c.rg)) {
    e.rg = 'RG entre 5 e 20 caracteres (números, letras, ponto, hífen ou barra).'
  }
  if ((c.whatsapp ?? '').trim() && !telefoneValido(c.whatsapp)) {
    e.whatsapp = 'Telefone com DDD: (92) 99123-4567 ou (92) 3123-4567.'
  }
  if (!nascimentoValido(c.data_nascimento)) {
    e.data_nascimento = 'Data de nascimento improvável — a pessoa teria menos de 16 ou mais de 90 anos.'
  }
  if (!matriculaPontoValida(c.matricula_ponto)) {
    e.matricula_ponto = 'A matrícula do ponto é só números.'
  }
  if ((c.apelido ?? '').trim() && /^\d+$/.test((c.apelido ?? '').trim())) {
    e.apelido = 'O apelido é como a pessoa é chamada, não um número.'
  }
  return e
}
