import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

/**
 * Criacao e troca de senha de usuario.
 *
 * Existe porque criar conta em `auth.users` exige a service_role, que
 * NUNCA pode ir para o navegador. Aqui ela fica no servidor e a funcao
 * so age depois de conferir, com o JWT de quem chamou, que a pessoa pode.
 * A tela nao e a barreira: esta checagem e.
 *
 * 159 (31/10): ate aqui so o ADMIN passava. Agora passa tambem quem tem a
 * permissao "Gerenciar usuarios" -- e QUEM decide e o banco, perguntado
 * COMO QUEM CHAMOU (cliente com o JWT dele, nao com a service_role):
 *   - senha: `pode_gerir_usuario(alvo)` -- nunca ADMIN, nunca o proprio,
 *     so das cidades que ele acessa. Trocar a senha do ADMIN seria virar
 *     ADMIN.
 *   - criar: `pode_criar_usuario(base, perfil, papel)` -- sem papel ADMIN,
 *     sem perfil que de poder de Administracao, so nas cidades dele.
 * A regra mora num lugar so (o banco); esta funcao so obedece.
 *
 * Acoes: `criar` e `senha`.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  })
}

/** Senha temporaria legivel, para o admin repassar e a pessoa trocar. */
function senhaTemporaria(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("")
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405)

  const url = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!
  const autorizacao = req.headers.get("Authorization") ?? ""

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  // O MESMO banco, mas como quem chamou: o RLS e as funcoes de escopo
  // respondem por ele, nao pela service_role.
  const comoChamador = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: autorizacao } },
  })

  const { data: quem, error: erroToken } = await admin.auth.getUser(
    autorizacao.replace("Bearer ", ""),
  )
  if (erroToken || !quem?.user) return json({ erro: "Sessao invalida." }, 401)
  const chamador = quem.user.id

  // ADMIN responde sim em `tem_permissao` (tem todas).
  const { data: pode } = await comoChamador.rpc("tem_permissao", { p_chave: "admin.usuarios" })
  if (pode !== true) {
    return json({ erro: "Seu perfil nao inclui \"Gerenciar usuarios\"." }, 403)
  }

  const { data: perfilAdmin } = await admin
    .from("perfil").select("empresa_id, base_id").eq("id", chamador).single()

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return json({ erro: "JSON invalido." }, 400) }
  const acao = String(corpo.acao ?? "")

  // ---------------- criar ----------------
  if (acao === "criar") {
    const email = String(corpo.email ?? "").trim().toLowerCase()
    const nome = String(corpo.nome ?? "").trim()
    if (!email || !nome) return json({ erro: "Informe nome e e-mail." }, 400)

    const base = (corpo.base_id as string | undefined) ?? perfilAdmin?.base_id ?? null

    // 159: o banco diz se ESTE chamador pode criar ESTE login.
    const { data: motivo, error: erroRegra } = await comoChamador.rpc("pode_criar_usuario", {
      p_base: base,
      p_perfil: (corpo.perfil_acesso_id as string | undefined) ?? null,
      p_papel: (corpo.papel as string | undefined) ?? null,
    })
    if (erroRegra) return json({ erro: erroRegra.message }, 403)
    if (motivo) return json({ erro: String(motivo) }, 403)

    const senha = String(corpo.senha ?? "") || senhaTemporaria()
    const gerada = !corpo.senha

    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
    })
    if (erroCriar || !criado?.user) {
      return json({ erro: erroCriar?.message ?? "Nao consegui criar o acesso." }, 400)
    }

    const novo = criado.user.id

    const { error: erroPerfil } = await admin.from("perfil").insert({
      id: novo,
      nome,
      email,
      apelido: corpo.apelido ?? nome,
      empresa_id: perfilAdmin?.empresa_id ?? null,
      base_id: base,
      cargo_id: corpo.cargo_id ?? null,
      perfil_acesso_id: corpo.perfil_acesso_id ?? null,
      tecnico_id: corpo.tecnico_id ?? null,
      whatsapp: corpo.whatsapp ?? null,
      cpf: corpo.cpf ?? null,
      rg: corpo.rg ?? null,
      data_nascimento: corpo.data_nascimento ?? null,
      matricula_ponto: corpo.matricula_ponto ?? null,
      login_field: corpo.login_field ?? null,
      ativo: true,
    })
    if (erroPerfil) {
      // Sem perfil o acesso fica orfao: desfaz o usuario recem-criado.
      await admin.auth.admin.deleteUser(novo)
      return json({ erro: "Acesso criado e desfeito: " + erroPerfil.message }, 400)
    }

    // Papel: o do perfil de acesso escolhido, ou o que veio explicito.
    let papel = corpo.papel as string | undefined
    if (!papel && corpo.perfil_acesso_id) {
      const { data: pa } = await admin
        .from("perfil_acesso").select("papel").eq("id", corpo.perfil_acesso_id).single()
      papel = pa?.papel ?? undefined
    }

    // `usuario_papel.escopo` e NOT NULL sem default. Sem ele o insert
    // morre e o usuario nasce SEM PAPEL -- um login que nao ve nada.
    let avisoPapel: string | null = null
    if (papel) {
      const escopo = papel === "ADMIN" || papel === "COP"
        ? "GLOBAL"
        : papel === "TECNICO"
        ? "PROPRIO"
        : "BASE"
      const { error: erroPapel } = await admin.from("usuario_papel").insert({
        usuario_id: novo,
        papel,
        escopo,
        base_id: escopo === "BASE" ? base : null,
      })
      if (erroPapel) {
        avisoPapel = "Acesso criado, mas o papel nao foi atribuido: " +
          erroPapel.message + " -- defina o papel na tela antes de liberar o login."
      }
    } else {
      avisoPapel = "Sem perfil de acesso: o usuario nasceu sem papel e nao enxerga nada."
    }

    return json({
      ok: true,
      usuario_id: novo,
      email,
      papel: papel ?? null,
      senha_gerada: gerada ? senha : null,
      aviso: avisoPapel ?? (gerada
        ? "Senha temporaria. Repasse e peca para a pessoa trocar no primeiro acesso."
        : null),
    })
  }

  // ---------------- trocar senha ----------------
  if (acao === "senha") {
    const usuario = String(corpo.usuario_id ?? "")
    if (!usuario) return json({ erro: "Informe o usuario." }, 400)

    // 159: o banco diz se este chamador gerencia este login (empresa,
    // cidade, nao-ADMIN, nao o proprio). Para o ADMIN: mesma empresa.
    const { data: gere, error: erroRegra } = await comoChamador.rpc("pode_gerir_usuario", {
      p_alvo: usuario,
    })
    if (erroRegra) return json({ erro: erroRegra.message }, 403)
    if (gere !== true) {
      return json({ erro: "Este login esta fora do que voce gerencia (ADMIN, outra cidade ou outra empresa)." }, 403)
    }

    const senha = String(corpo.senha ?? "") || senhaTemporaria()
    const gerada = !corpo.senha
    const { error } = await admin.auth.admin.updateUserById(usuario, { password: senha })
    if (error) return json({ erro: error.message }, 400)

    return json({ ok: true, senha_gerada: gerada ? senha : null })
  }

  return json({ erro: "Acao desconhecida. Use 'criar' ou 'senha'." }, 400)
})
