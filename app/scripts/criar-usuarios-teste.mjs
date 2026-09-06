/**
 * Cria logins de teste para ver o sistema pelos olhos de cada papel.
 *
 * ┌─ POR QUE UM SCRIPT E NÃO UMA TELA ───────────────────────────────┐
 * │ Criar usuário no Supabase exige a SERVICE ROLE KEY. Essa chave    │
 * │ ignora o RLS inteiro — ela não pode existir no navegador, nem no  │
 * │ .env do Vite (que vai para o bundle), nem no Git.                 │
 * │                                                                   │
 * │ Então ela fica onde deve ficar: na sua máquina, na variável de    │
 * │ ambiente, no momento em que você roda o comando.                  │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * COMO RODAR (PowerShell, dentro de app/):
 *
 *   $env:SUPABASE_URL = "https://SEU-PROJETO.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "cole-aqui"
 *   node scripts/criar-usuarios-teste.mjs
 *
 * A chave está em Supabase → Project Settings → API → service_role.
 * Ela NÃO é a mesma do app (`VITE_SUPABASE_ANON_KEY`).
 *
 * O script é idempotente: rodar de novo não duplica nada. Se o usuário
 * já existe, ele só reaplica perfil, papel e vínculo com o técnico.
 *
 * As senhas são sorteadas aqui e impressas UMA vez. Não ficam gravadas
 * em lugar nenhum — se perder, rode com --resetar-senha.
 *
 * Para apagar tudo depois:  node scripts/criar-usuarios-teste.mjs --remover
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error(
    'Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.\n' +
    'Veja o cabeçalho deste arquivo — tem o passo a passo.')
  process.exit(1)
}

const remover = process.argv.includes('--remover')
const resetarSenha = process.argv.includes('--resetar-senha')

const sb = createClient(url, key, { auth: { persistSession: false } })

/**
 * O domínio `.teste.local` não existe e nunca vai receber e-mail. É de
 * propósito: login de teste que parece login de verdade acaba virando
 * login de verdade, e ninguém lembra de tirar.
 */
const USUARIOS = [
  {
    email: 'controlador@teste.local',
    nome: 'Controlador de Teste',
    papeis: ['CONTROLADOR'],
    perfilAcesso: 'Controlador',
    cargo: 'CONTROLADOR (COP)',
  },
  {
    email: 'supervisor@teste.local',
    nome: 'Supervisor de Teste',
    papeis: ['SUPERVISOR'],
    perfilAcesso: 'Supervisor',
    cargo: 'SUPERVISOR',
    // Sem isto o supervisor entra e vê tela vazia: quem decide o que
    // ele enxerga é `equipe.supervisor_id` (migration 031), e essa
    // coluna estava em 0 de 89 equipes. Aqui ligamos o usuário de
    // teste às equipes de UM supervisor real, pelo nome que veio do
    // TOA — e `--remover` desfaz.
    supervisorDe: process.env.SUPERVISOR_NOME ?? 'SUPERVISOR - LUIZ HENRIQUE',
  },
  {
    // Vinculado a um técnico REAL, com visitas reais: é a única forma
    // de ver a agenda do campo com conteúdo. O RLS faz o resto — ele
    // enxerga as visitas dele e mais nenhuma.
    email: 'tecnico@teste.local',
    nome: 'Técnico de Teste',
    papeis: ['TECNICO'],
    perfilAcesso: 'Tecnico de Campo',
    cargo: 'INSTALADOR I',
    matriculaTecnico: process.env.MATRICULA_TECNICO ?? 'Z674378',
  },
]

const senhaSorteada = () => randomBytes(9).toString('base64url')

async function um(tabela, filtro) {
  const { data, error } = await sb.from(tabela).select('id').match(filtro).maybeSingle()
  if (error) throw new Error(`${tabela}: ${error.message}`)
  return data?.id ?? null
}

async function acharUsuario(email) {
  // A API de admin não busca por e-mail direto; a lista é pequena aqui.
  let pagina = 1
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page: pagina, perPage: 200 })
    if (error) throw new Error(error.message)
    const achado = data.users.find(u => u.email?.toLowerCase() === email)
    if (achado) return achado
    if (data.users.length < 200) return null
    pagina += 1
  }
}

async function main() {
  const empresaId = await um('empresa', { nome: 'AFLINE' })
  const baseId = await um('base', { codigo: 'MAN' })
  if (!empresaId || !baseId) throw new Error('Empresa AFLINE ou base MAN não encontradas.')

  const criadas = []

  for (const u of USUARIOS) {
    const existente = await acharUsuario(u.email)

    if (remover) {
      if (!existente) { console.log(`· ${u.email} — não existia`); continue }
      // perfil e usuario_papel caem por FK/cascade quando o auth.user sai;
      // o vínculo com o técnico é nosso e precisa ser desfeito à mão.
      await sb.from('tecnico').update({ usuario_id: null }).eq('usuario_id', existente.id)
      await sb.from('equipe').update({ supervisor_id: null }).eq('supervisor_id', existente.id)
      await sb.from('usuario_papel').delete().eq('usuario_id', existente.id)
      await sb.from('perfil').delete().eq('id', existente.id)
      const { error } = await sb.auth.admin.deleteUser(existente.id)
      if (error) throw new Error(`${u.email}: ${error.message}`)
      console.log(`× ${u.email} — removido`)
      continue
    }

    let id = existente?.id
    let senha = null

    if (!existente) {
      senha = senhaSorteada()
      const { data, error } = await sb.auth.admin.createUser({
        email: u.email, password: senha, email_confirm: true,
      })
      if (error) throw new Error(`${u.email}: ${error.message}`)
      id = data.user.id
    } else if (resetarSenha) {
      senha = senhaSorteada()
      const { error } = await sb.auth.admin.updateUserById(id, { password: senha })
      if (error) throw new Error(`${u.email}: ${error.message}`)
    }

    const perfilAcessoId = await um('perfil_acesso', { nome: u.perfilAcesso })
    const cargoId = u.cargo ? await um('cargo', { nome: u.cargo }) : null

    const { error: ep } = await sb.from('perfil').upsert({
      id, nome: u.nome, email: u.email,
      base_id: baseId, empresa_id: empresaId,
      perfil_acesso_id: perfilAcessoId, cargo_id: cargoId, ativo: true,
    })
    if (ep) throw new Error(`perfil ${u.email}: ${ep.message}`)

    await sb.from('usuario_papel').delete().eq('usuario_id', id)
    const { error: er } = await sb.from('usuario_papel')
      .insert(u.papeis.map(papel => ({ usuario_id: id, papel })))
    if (er) throw new Error(`papel ${u.email}: ${er.message}`)

    let vinculo = ''
    if (u.matriculaTecnico) {
      const { data: tec, error: et } = await sb.from('tecnico')
        .update({ usuario_id: id })
        .eq('matricula', u.matriculaTecnico)
        .select('id, nome, matricula, equipe_id')
        .maybeSingle()
      if (et) throw new Error(`tecnico ${u.matriculaTecnico}: ${et.message}`)
      if (!tec) {
        vinculo = `  ⚠ matrícula ${u.matriculaTecnico} não encontrada — sem agenda`
      } else {
        // `perfil.tecnico_id` é conveniência de tela. Quem manda no RLS
        // é `tecnico.usuario_id`, que já foi gravado acima.
        await sb.from('perfil').update({ tecnico_id: tec.id }).eq('id', id)
        vinculo = `  → técnico ${tec.matricula} · ${tec.nome}`
      }
    }

    if (u.supervisorDe) {
      const { data: eqs, error: ee } = await sb.from('equipe')
        .update({ supervisor_id: id })
        .eq('supervisor_nome', u.supervisorDe)
        .select('codigo')
      if (ee) throw new Error(`equipe ${u.supervisorDe}: ${ee.message}`)
      vinculo = eqs?.length
        ? `  → supervisor de ${eqs.length} equipe(s): ${eqs.map(e => e.codigo).join(', ')}`
        : `  ⚠ nenhuma equipe com supervisor_nome = "${u.supervisorDe}" — sem visão`
    }

    criadas.push({ email: u.email, papeis: u.papeis.join(', '), senha, vinculo })
    console.log(`${existente ? '=' : '+'} ${u.email} — ${u.papeis.join(', ')}${vinculo ? '\n' + vinculo : ''}`)
  }

  if (remover) return

  const comSenha = criadas.filter(c => c.senha)
  if (comSenha.length) {
    console.log('\n--- ANOTE AGORA: estas senhas não são mostradas de novo ---')
    for (const c of comSenha) console.log(`${c.email}\t${c.senha}`)
    console.log('-----------------------------------------------------------')
    console.log('Perdeu? rode com --resetar-senha.')
  } else {
    console.log('\nNenhuma senha nova. Para trocar todas: --resetar-senha')
  }

  console.log(
    '\nEntre em http://localhost:5173 com cada um.\n' +
    'O TECNICO cai em /campo; CONTROLADOR e SUPERVISOR caem em /controle.\n' +
    'Quem manda no que cada um enxerga é o RLS, não a tela: confira com\n' +
    '  select * from testar_policies();')
}

main().catch(e => { console.error('\nFalhou:', e.message); process.exit(1) })
