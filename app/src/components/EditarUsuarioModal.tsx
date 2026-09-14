import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { equipeRotulo } from '../lib/formato'
import {
  conferirCadastro, formataCPF, formataTelefone, loginToaNoPadrao, soDigitos,
  type ErrosCadastro,
} from '../lib/validacao'
import { Alerta } from './ui'

/**
 * Editar o cadastro inteiro de uma pessoa — só ADMIN.
 *
 * ┌─ por que uma janela, e não a linha da tabela ────────────────────┐
 * │ > "quando for editar cadastro deve ter uma opção para editar o    │
 * │ >  que ficou errado […] no nosso quando editamos aparece poucos   │
 * │ >  dados" — Emanuel                                               │
 * │                                                                   │
 * │ A edição morava DENTRO da linha da tabela e alcançava três        │
 * │ campos: cargo, perfil de acesso e papéis. Nome, CPF, telefone,    │
 * │ nascimento, operação, equipe e login do TOA só existiam na hora   │
 * │ de criar — errou ali, errou para sempre. E foi exatamente o que   │
 * │ aconteceu: três cadastros de teste com CPF de 12 dígitos e ano de │
 * │ nascimento 22222, sem nenhuma forma de arrumar pela tela.         │
 * │                                                                   │
 * │ Célula de tabela não comporta 15 campos. Janela comporta.         │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * **A barreira é o banco, não esta janela.** `perfil` tem RLS, e o
 * `definir_papeis` confere ADMIN por dentro. Esconder o botão de quem
 * não é ADMIN serve para não oferecer ação que vai falhar — não é a
 * segurança.
 *
 * O E-MAIL é só de leitura, e isso é decisão: ele é a chave do login em
 * `auth.users`, que esta tela não alcança (só a `service_role` alcança,
 * pela função de borda). Trocar aqui mudaria o `perfil` e deixaria o
 * login antigo funcionando — dois e-mails para a mesma pessoa, e o de
 * baixo é o que vale.
 */

export interface UsuarioCompleto {
  id: string; nome: string; email: string; apelido: string | null
  ativo: boolean
  whatsapp: string | null; cpf: string | null; rg: string | null
  data_nascimento: string | null; matricula_ponto: string | null
  cargo_id: string | null; perfil_acesso_id: string | null; base_id: string | null
  tecnico: { matricula: string; nome: string } | null
}

interface Opcao { id: string; nome: string }
interface OperacaoOpcao { id: string; nome: string; regiao: string | null }
interface EquipeOpcao { id: string; codigo: string; nome: string; base_id: string }
interface TecnicoOpcao {
  id: string; matricula: string; nome: string
  supervisor_id: string | null
  equipe: { codigo: string; nome: string } | null
}
interface SupervisorOpcao {
  supervisor_nome: string; equipes: number; tecnicos: number
  usuario_id: string | null; usuario_nome: string | null
}

const campo = 'w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm ' +
              'outline-none focus:border-af-500'

/**
 * Mostra o que ESTÁ GRAVADO, mascarado só quando cabe na máscara.
 *
 * `formataCPF` corta em 11 dígitos. Aplicada num CPF de 12 — como os
 * três cadastros de teste têm — ela mostrava "123.123.123-21" e o
 * décimo segundo dígito sumia da tela. Quem abrisse para corrigir veria
 * um CPF de aparência normal e não entenderia a recusa do banco.
 *
 * Dado errado tem de aparecer errado. A máscara é para o certo.
 */
function comoEsta(
  valor: string | null, mascara: (v: string) => string, tamanhos: number[],
): string {
  const d = soDigitos(valor)
  if (!d) return ''
  return tamanhos.includes(d.length) ? mascara(d) : d
}

export function EditarUsuarioModal({
  usuario, papeisAtuais, cargos, perfis, operacoes, equipes, skills, supervisores,
  papeisPossiveis, onFechar, onSalvo, onSenha,
}: {
  usuario: UsuarioCompleto
  papeisAtuais: string[]
  cargos: Opcao[]
  perfis: Opcao[]
  operacoes: OperacaoOpcao[]
  equipes: EquipeOpcao[]
  skills: { id: string; nome: string; ativo: boolean }[]
  supervisores: SupervisorOpcao[]
  papeisPossiveis: readonly string[]
  onFechar: () => void
  onSalvo: (recado: string) => void
  onSenha: (email: string, senha: string) => void
}) {
  const [f, setF] = useState({
    nome: usuario.nome ?? '',
    apelido: usuario.apelido ?? '',
    whatsapp: comoEsta(usuario.whatsapp, formataTelefone, [10, 11]),
    cpf: comoEsta(usuario.cpf, formataCPF, [11]),
    rg: usuario.rg ?? '',
    data_nascimento: usuario.data_nascimento ?? '',
    matricula_ponto: usuario.matricula_ponto ?? '',
    cargo_id: usuario.cargo_id ?? '',
    perfil_acesso_id: usuario.perfil_acesso_id ?? '',
    base_id: usuario.base_id ?? '',
    ativo: usuario.ativo,
    login_toa: usuario.tecnico?.matricula ?? '',
    equipe_id: '',
    skill: '',
    // De quais equipes esta pessoa é a supervisora, pelo nome que a
    // planilha usa. Vazio = não supervisiona equipe nenhuma.
    supervisor_nome: supervisores.find(x => x.usuario_id === usuario.id)?.supervisor_nome ?? '',
  })
  const [papeis, setPapeis] = useState<string[]>(papeisAtuais)
  const [erros, setErros] = useState<ErrosCadastro>({})
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Senha: só mexe quem marcar. Um campo de senha sempre aberto convida
  // a trocar a senha de alguém sem querer.
  /** Garantir a equipe própria do supervisor — idempotente: se já
   *  existe, a função devolve a mesma e não cria outra. */
  const [equipeDoSupervisor, setEquipeDoSupervisor] = useState(true)

  /**
   * Os técnicos DESTE supervisor, escolhidos um a um.
   *
   * ┌─ por que escolher técnico, e não só a equipe ────────────────────┐
   * │ > "precisa ter um botão seletor em alguma parte selecionando      │
   * │ >  supervisor X vai ser supervisor dos nomes x, y, z, e quando    │
   * │ >  quisesse trocar seria fácil" — Emanuel                         │
   * │                                                                   │
   * │ O vínculo da D-132 é por NOME DA PLANILHA e pega tudo de uma vez  │
   * │ — 21 equipes, 29 técnicos. Serve para casar o acesso com o que a  │
   * │ CLARO manda, mas não serve para dizer "estes três são dele".      │
   * │                                                                   │
   * │ `tecnico.supervisor_id` é a declaração de quem opera, e tem       │
   * │ precedência sobre o nome herdado da planilha. Quem não declarar   │
   * │ continua no padrão da equipe — nada quebra por não usar isto.     │
   * └───────────────────────────────────────────────────────────────────┘
   */
  const [tecnicos, setTecnicos] = useState<TecnicoOpcao[]>([])
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set())
  const [buscaTec, setBuscaTec] = useState('')

  useEffect(() => {
    if (!papeisAtuais.includes('SUPERVISOR')) return
    supabase.from('tecnico')
      .select('id, matricula, nome, supervisor_id, equipe:equipe_id ( codigo, nome )')
      .eq('situacao', 'ATIVO').order('nome')
      .then(({ data }) => {
        const lista = (data ?? []) as unknown as TecnicoOpcao[]
        setTecnicos(lista)
        setEscolhidos(new Set(lista.filter(t => t.supervisor_id === usuario.id).map(t => t.id)))
      })
  }, [papeisAtuais, usuario.id])

  const tecnicosFiltrados = useMemo(() => {
    const q = buscaTec.trim().toLowerCase()
    if (!q) return tecnicos
    return tecnicos.filter(t =>
      [t.matricula, t.nome, t.equipe?.codigo].some(x => x?.toLowerCase().includes(q)))
  }, [tecnicos, buscaTec])
  const [trocarSenha, setTrocarSenha] = useState(false)
  const [senhaNova, setSenhaNova] = useState('')

  /** A equipe e a skill de hoje, lidas do técnico ligado a este acesso.
   *  Não vêm no `perfil`: moram em `tecnico`. */
  useEffect(() => {
    const login = usuario.tecnico?.matricula
    if (!login) return
    supabase.from('tecnico').select('equipe_id, skill, base_id')
      .ilike('matricula', login).limit(1)
      .then(({ data }) => {
        const t = (data ?? [])[0] as
          { equipe_id: string | null; skill: string | null; base_id: string | null } | undefined
        if (!t) return
        setF(x => ({
          ...x,
          equipe_id: t.equipe_id ?? '',
          skill: t.skill ?? '',
          // A operação do TÉCNICO manda sobre a do perfil: é onde ele
          // trabalha. O `perfil.base_id` é escopo de visão (D-127).
          base_id: t.base_id ?? x.base_id,
        }))
      })
  }, [usuario.tecnico?.matricula])

  const equipesDaOperacao = useMemo(() =>
    f.base_id ? equipes.filter(e => e.base_id === f.base_id) : equipes,
    [equipes, f.base_id])

  const operacoesPorRegiao = useMemo(() => {
    const m = new Map<string, OperacaoOpcao[]>()
    for (const o of operacoes) m.set(o.regiao ?? '', [...(m.get(o.regiao ?? '') ?? []), o])
    return [...m.entries()].sort(([a], [b]) =>
      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))
  }, [operacoes])

  function mudar(k: keyof typeof f, v: string | boolean) {
    setF(x => ({ ...x, [k]: v }))
    setErros(e => { const n = { ...e }; delete n[k as string]; return n })
  }

  async function salvar() {
    // O e-mail não é editável, então não entra na conferência.
    const e = conferirCadastro(f, { exigeEmail: false })
    if (trocarSenha && senhaNova && senhaNova.length < 8) {
      e.senha = 'A senha precisa de pelo menos 8 caracteres.'
    }
    setErros(e)
    if (Object.keys(e).length) {
      setErro('Confira os campos marcados abaixo.')
      return
    }

    setOcupado(true); setErro(null)
    const recados: string[] = []

    // ---- 1. o cadastro da pessoa ----
    // CPF e telefone vão SÓ COM DÍGITOS: a máscara é da tela, e a
    // migration 064 recusa qualquer outra forma.
    const { error: ep } = await supabase.from('perfil').update({
      nome: f.nome.trim(),
      apelido: f.apelido.trim() || null,
      whatsapp: soDigitos(f.whatsapp) || null,
      cpf: soDigitos(f.cpf) || null,
      rg: f.rg.trim() || null,
      data_nascimento: f.data_nascimento || null,
      matricula_ponto: f.matricula_ponto.trim() || null,
      cargo_id: f.cargo_id || null,
      perfil_acesso_id: f.perfil_acesso_id || null,
      ativo: f.ativo,
    }).eq('id', usuario.id)
    if (ep) { setErro(traduzir(ep.message)); setOcupado(false); return }

    // ---- 2. papéis ----
    if ([...papeis].sort().join() !== [...papeisAtuais].sort().join()) {
      const { error } = await supabase.rpc('definir_papeis',
        { p_usuario: usuario.id, p_papeis: papeis })
      if (error) { setErro(traduzir(error.message)); setOcupado(false); return }
      recados.push(`papéis: ${papeis.join(', ') || 'nenhum'}`)
    }

    // ---- 2b. supervisor da planilha ----
    // Depois dos papéis, e não antes: a função recusa quem ainda não tem
    // o papel SUPERVISOR, e no mesmo salvamento o papel pode ter acabado
    // de ser dado.
    const supAntes = supervisores.find(x => x.usuario_id === usuario.id)?.supervisor_nome ?? ''
    if (f.supervisor_nome !== supAntes) {
      if (f.supervisor_nome) {
        const { data: sv, error: es } = await supabase.rpc('definir_supervisor_das_equipes',
          { p_usuario: usuario.id, p_supervisor_nome: f.supervisor_nome })
        if (es) recados.push(`supervisor não vinculado: ${traduzir(es.message)}`)
        else {
          recados.push(`supervisiona ${(sv as { equipes: number }).equipes} equipe(s)`)
          if (equipeDoSupervisor) {
            const { data: eq2, error: ee } = await supabase.rpc(
              'criar_equipe_do_supervisor', { p_usuario: usuario.id })
            if (ee) recados.push(`equipe própria não criada: ${traduzir(ee.message)}`)
            else {
              const y = eq2 as { nome: string; ja_existia: boolean }
              recados.push(y.ja_existia
                ? `equipe própria (${y.nome}) já existia`
                : `equipe própria criada: ${y.nome}`)
            }
          }
        }
      } else {
        const { error: el } = await supabase.rpc('limpar_supervisor_das_equipes',
          { p_usuario: usuario.id })
        if (el) recados.push(`vínculo de supervisor não removido: ${traduzir(el.message)}`)
        else recados.push('deixou de supervisionar equipes')
      }
    }

    // ---- 2c. os técnicos deste supervisor ----
    if (papeis.includes('SUPERVISOR')) {
      const antes = new Set(tecnicos.filter(t => t.supervisor_id === usuario.id).map(t => t.id))
      const mudou = antes.size !== escolhidos.size
        || [...escolhidos].some(id => !antes.has(id))
      if (mudou) {
        const { data: tv, error: et } = await supabase.rpc('definir_tecnicos_do_supervisor',
          { p_usuario: usuario.id, p_tecnicos: [...escolhidos] })
        if (et) recados.push(`técnicos não vinculados: ${traduzir(et.message)}`)
        else {
          const x = tv as { vinculados: number; soltos: number; total: number }
          recados.push(`${x.total} técnico(s) sob ele`
            + (x.vinculados ? ` (+${x.vinculados})` : '')
            + (x.soltos ? ` (−${x.soltos})` : ''))
        }
      }
    }

    // ---- 3. o técnico: operação, equipe, skill, login ----
    const login = f.login_toa.trim()
    if (login) {
      const { error: ec } = await supabase.rpc('cadastrar_tecnico_avulso', {
        p_matricula: login,
        p_nome: f.nome.trim(),
        p_equipe_id: f.equipe_id || null,
        p_base_id: f.base_id || null,
      })
      if (ec) {
        recados.push(`o técnico não foi atualizado: ${traduzir(ec.message)}`)
      } else {
        recados.push('técnico atualizado')
        // Vincular só quando o login MUDOU: a função recusa técnico que
        // já é de outro acesso, e repetir o vínculo existente só
        // gastaria uma viagem.
        if (login.toUpperCase() !== (usuario.tecnico?.matricula ?? '').toUpperCase()) {
          const { error: ev } = await supabase.rpc('vincular_tecnico_ao_usuario',
            { p_usuario: usuario.id, p_login_toa: login })
          if (ev) recados.push(`vínculo não feito: ${traduzir(ev.message)}`)
          else recados.push(`vinculado ao login ${login.toUpperCase()}`)
        }
        if (f.skill) {
          const { error: es } = await supabase.rpc('definir_skill_tecnico',
            { p_login_toa: login, p_skill: f.skill })
          if (es) recados.push(`skill não gravada: ${traduzir(es.message)}`)
        }
      }
    }

    // ---- 4. senha ----
    if (trocarSenha) {
      const { data, error } = await supabase.functions.invoke('admin-usuarios', {
        body: { acao: 'senha', usuario_id: usuario.id, senha: senhaNova || undefined },
      })
      const r = data as { erro?: string; senha_gerada?: string | null } | null
      if (error || r?.erro) {
        recados.push(`senha não trocada: ${traduzir(r?.erro ?? error?.message ?? '')}`)
      } else if (r?.senha_gerada) {
        onSenha(usuario.email, r.senha_gerada)
      } else {
        recados.push('senha trocada para a que você digitou')
      }
    }

    setOcupado(false)
    onSalvo(`${f.nome.trim()} atualizado${recados.length ? ' — ' + recados.join('; ') : ''}.`)
  }

  function traduzir(msg: string): string {
    if (/perfil_cpf_forma/.test(msg)) return 'O banco recusou o CPF: guarde só os 11 dígitos.'
    if (/perfil_whatsapp_forma/.test(msg)) return 'O banco recusou o telefone: DDD + 8 ou 9 dígitos.'
    if (/perfil_nascimento_plausivel/.test(msg)) return 'O banco recusou a data de nascimento.'
    if (/perfil_email_forma/.test(msg)) return 'O banco recusou o e-mail.'
    if (/row-level security|violates row|permission denied/i.test(msg))
      return 'O banco recusou: seu usuário não tem papel ADMIN. A barreira é do RLS, não da tela.'
    return msg
  }

  const Campo = ({ k, rot, tipo = 'text', dica, formata }: {
    k: keyof typeof f; rot: string; tipo?: string; dica?: string
    formata?: (v: string) => string
  }) => (
    <label className="text-xs text-graf-400">
      <span className="mb-1 block">{rot}</span>
      <input type={tipo} value={String(f[k] ?? '')}
        onChange={e => mudar(k, formata ? formata(e.target.value) : e.target.value)}
        aria-invalid={!!erros[k as string]}
        className={`${campo} ${erros[k as string] ? 'border-af-500' : ''}`} />
      {erros[k as string]
        ? <span className="mt-1 block text-[11px] text-af-300">{erros[k as string]}</span>
        : dica ? <span className="mt-1 block text-[11px] text-graf-600">{dica}</span> : null}
    </label>
  )

  return (
    <div className="janela-fundo fixed inset-0 z-50 flex items-start justify-center
                    overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
         role="dialog" aria-modal="true" aria-label={`Editar cadastro de ${usuario.nome}`}
         onClick={onFechar}>
      <div className="janela-caixa card-controle my-6 w-full max-w-4xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-graf-800 px-5 py-3">
          <div>
            <h2 className="font-semibold">Editar cadastro</h2>
            <p className="text-xs text-graf-500">
              {usuario.email} · o e-mail é o login e não se troca por aqui
            </p>
          </div>
          <button onClick={onFechar} aria-label="Fechar"
            className="rounded-md border border-graf-700 px-2 py-1 text-xs text-graf-400
                       hover:border-af-600 hover:text-af-400">✕</button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-graf-500">
              Pessoa
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo k="nome" rot="Nome completo *" />
              <Campo k="apelido" rot="Apelido" />
              <Campo k="data_nascimento" rot="Nascimento" tipo="date" />
              <Campo k="whatsapp" rot="WhatsApp" formata={formataTelefone}
                dica="(92) 99123-4567" />
              <Campo k="cpf" rot="CPF" formata={formataCPF} dica="com dígito conferido" />
              <Campo k="rg" rot="RG" dica="sem padrão nacional — só o tamanho é conferido" />
              <Campo k="matricula_ponto" rot="Matrícula do ponto" dica="só números" />
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-graf-500">
              Operação e campo
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* Operação e equipe são do TÉCNICO. Sem login do TOA não há
                  técnico em quem gravar — e o seletor ficava aberto sem
                  fazer nada ao salvar, que é pior que estar travado. */}
              <label className="text-xs text-graf-400">
                <span className="mb-1 block">
                  Operação (cidade)
                  {!f.login_toa.trim() && (
                    <span className="ml-1 text-graf-600">— precisa do login TOA</span>
                  )}
                </span>
                <select value={f.base_id} className={campo} disabled={!f.login_toa.trim()}
                  onChange={e => setF(x => ({ ...x, base_id: e.target.value, equipe_id: '' }))}>
                  <option value="">— sem operação —</option>
                  {operacoesPorRegiao.map(([regiao, lista]) => (
                    <optgroup key={regiao || 'sem'} label={regiao || 'sem região definida'}>
                      {lista.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="text-xs text-graf-400">
                <span className="mb-1 block">
                  Número da equipe
                  {!f.login_toa.trim() && (
                    <span className="ml-1 text-graf-600">— precisa do login TOA</span>
                  )}
                </span>
                <select value={f.equipe_id} className={campo} disabled={!f.login_toa.trim()}
                  onChange={e => mudar('equipe_id', e.target.value)}>
                  <option value="">— sem equipe —</option>
                  {equipesDaOperacao.map(e2 => (
                    <option key={e2.id} value={e2.id}>{equipeRotulo(e2.codigo, e2.nome)}</option>
                  ))}
                </select>
              </label>
              <Campo k="login_toa" rot="Login TOA (matrícula do técnico)"
                dica={loginToaNoPadrao(f.login_toa) ? undefined
                  : '⚠ fora do padrão da operação (letra + 6 ou 7 dígitos) — confira'} />
              <label className="text-xs text-graf-400">
                <span className="mb-1 block">Skill do técnico</span>
                <select value={f.skill} className={campo} disabled={!f.login_toa.trim()}
                  onChange={e => mudar('skill', e.target.value)}>
                  <option value="">— sem skill —</option>
                  {skills.filter(s => s.ativo || s.nome === f.skill).map(s => (
                    <option key={s.id} value={s.nome}>{s.nome}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-graf-500">
              Acesso
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-graf-400">
                <span className="mb-1 block">Cargo</span>
                <select value={f.cargo_id} className={campo}
                  onChange={e => mudar('cargo_id', e.target.value)}>
                  <option value="">— sem cargo —</option>
                  {cargos.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
              <label className="text-xs text-graf-400">
                <span className="mb-1 block">Perfil de acesso</span>
                <select value={f.perfil_acesso_id} className={campo}
                  onChange={e => mudar('perfil_acesso_id', e.target.value)}>
                  <option value="">— sem perfil —</option>
                  {perfis.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              {/* Aparece quando a pessoa É supervisora — pelo papel, que é
                  o que o banco lê, não pelo cargo escrito. */}
              {papeis.includes('SUPERVISOR') && (
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">
                    Supervisor da planilha
                    <span className="ml-1 text-graf-600">— de quais técnicos é chefe</span>
                  </span>
                  <select value={f.supervisor_nome} className={campo}
                    onChange={e => mudar('supervisor_nome', e.target.value)}>
                    <option value="">— não supervisiona equipe —</option>
                    {supervisores.map(sv => (
                      <option key={sv.supervisor_nome} value={sv.supervisor_nome}>
                        {sv.supervisor_nome} — {sv.equipes} equipe(s), {sv.tecnicos} téc.
                        {sv.usuario_nome && sv.usuario_id !== usuario.id
                          ? ` · já é de ${sv.usuario_nome}` : ''}
                      </option>
                    ))}
                  </select>
                  {f.supervisor_nome && (
                    <label className="mt-1.5 flex cursor-pointer items-start gap-1.5
                                      text-[11px] text-graf-400">
                      <input type="checkbox" checked={equipeDoSupervisor}
                        className="mt-0.5 accent-af-600"
                        onChange={e => setEquipeDoSupervisor(e.target.checked)} />
                      <span>
                        Garantir a equipe própria dele.
                        <span className="mt-0.5 block text-graf-500">A equipe própria é o que permite <strong>passar rota para ele</strong> quando
                      for a campo. Ela aparece na lista pelo nome, não por número — de
                      propósito, para se distinguir das equipes de campo.</span>
                      </span>
                    </label>
                  )}
                </label>
              )}
              <label className="text-xs text-graf-400">
                <span className="mb-1 block">Situação</span>
                <button type="button" onClick={() => mudar('ativo', !f.ativo)}
                  aria-pressed={f.ativo}
                  className={`${campo} text-left font-medium ${
                    f.ativo ? 'text-emerald-300' : 'text-graf-400'}`}>
                  {f.ativo ? 'ativo' : 'desativado'}
                </button>
                <span className="mt-1 block text-[11px] text-graf-600">
                  Desativar tira o acesso; o histórico dele fica.
                </span>
              </label>
            </div>

            <div className="mt-3">
              <span className="mb-1 block text-xs text-graf-400">
                Papéis <span className="text-graf-600">— o que o banco lê</span>
              </span>
              <div className="flex flex-wrap gap-1">
                {papeisPossiveis.map(p => {
                  const marcado = papeis.includes(p)
                  return (
                    <button key={p} type="button" aria-pressed={marcado}
                      onClick={() => setPapeis(ps =>
                        marcado ? ps.filter(x => x !== p) : [...ps, p])}
                      className={`rounded px-2 py-1 text-[11px] font-medium ring-1 ${marcado
                        ? 'bg-af-600/20 text-af-300 ring-af-600/40'
                        : 'bg-graf-900 text-graf-500 ring-graf-700'}`}>
                      {p}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* O roteamento do login NÃO mora mais aqui: virou uma chave na
              lista de usuários, ao lado do login (D-130). Comando enterrado
              dentro de um formulário de quinze campos é comando que
              ninguém acha — e não achar foi exatamente o que aconteceu. */}
          {f.login_toa.trim() && f.equipe_id && (
            <p className="rounded-md border border-graf-700 bg-graf-900 px-3 py-2 text-[11px]
                          leading-snug text-graf-400">
              Trocar a equipe aqui muda o <strong>cadastro</strong> do técnico. Para o
              contrato importado deste login passar a cair nela, use a{' '}
              <strong className="text-graf-200">chave de roteamento</strong> na lista de
              usuários, ao lado do login.
            </p>
          )}

          {/* ┌─ o seletor de técnicos ──────────────────────────────────┐
              │ Uma lista com busca e caixinha, e não um campo por técnico:│
              │ são 106, e trocar um tem de ser um clique. O contador em   │
              │ cima diz quantos estão marcados agora — sem ele, marcar    │
              │ numa lista rolante é adivinhação.                          │
              └────────────────────────────────────────────────────────────┘ */}
          {papeis.includes('SUPERVISOR') && (
            <section>
              <h3 className="mb-2 flex flex-wrap items-baseline gap-2 text-[11px]
                             font-semibold uppercase tracking-widest text-graf-500">
                Técnicos deste supervisor
                <span className="tabular font-medium normal-case tracking-normal
                                 text-graf-300">
                  {escolhidos.size} marcado(s) de {tecnicos.length}
                </span>
                {escolhidos.size > 0 && (
                  <button type="button" onClick={() => setEscolhidos(new Set())}
                    className="font-medium normal-case tracking-normal text-af-400
                               underline underline-offset-2">
                    limpar
                  </button>
                )}
              </h3>
              <input value={buscaTec} onChange={e => setBuscaTec(e.target.value)}
                placeholder="Buscar por nome, matrícula ou equipe…"
                aria-label="Buscar técnico"
                className={`${campo} mb-2`} />
              <div className="quadro max-h-56 rounded-md border border-graf-700
                              bg-graf-900 p-1"
                   style={{ ['--quadro-altura' as string]: '14rem' }}>
                {tecnicosFiltrados.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-graf-500">
                    Nenhum técnico para esta busca.
                  </p>
                ) : tecnicosFiltrados.map(t => {
                  const marcado = escolhidos.has(t.id)
                  // De outro supervisor: dá para trazer, mas a tela avisa
                  // antes, em vez de o Emanuel descobrir depois.
                  const deOutro = !!t.supervisor_id && t.supervisor_id !== usuario.id
                  return (
                    <label key={t.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1
                                 text-xs hover:bg-graf-800">
                      <input type="checkbox" checked={marcado} className="accent-af-600"
                        onChange={() => setEscolhidos(s2 => {
                          const n2 = new Set(s2)
                          if (marcado) n2.delete(t.id); else n2.add(t.id)
                          return n2
                        })} />
                      <span className="tabular text-graf-400">{t.matricula}</span>
                      <span className="min-w-0 flex-1 truncate text-graf-200">{t.nome}</span>
                      {t.equipe && (
                        <span className="shrink-0 text-[10px] text-graf-500">
                          {equipeRotulo(t.equipe.codigo, t.equipe.nome)}
                        </span>
                      )}
                      {deOutro && (
                        <span title="Hoje está com outro supervisor"
                          className="shrink-0 text-[10px] text-amber-400">de outro</span>
                      )}
                    </label>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-graf-500">
                Esta escolha <strong>vale mais</strong> que o supervisor herdado da
                planilha. Técnico que ninguém marcar continua com o supervisor da
                equipe dele — não marcar não quebra nada.
              </p>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-graf-500">
              Senha
            </h3>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-graf-300">
              <input type="checkbox" checked={trocarSenha} className="accent-af-600"
                onChange={e => { setTrocarSenha(e.target.checked); setSenhaNova('') }} />
              Trocar a senha desta pessoa
            </label>
            {trocarSenha && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">
                    Nova senha <span className="text-graf-600">— deixe vazio para o servidor gerar</span>
                  </span>
                  <input type="text" value={senhaNova} autoComplete="off"
                    onChange={e => setSenhaNova(e.target.value)}
                    className={`${campo} ${erros.senha ? 'border-af-500' : ''}`} />
                  {erros.senha && (
                    <span className="mt-1 block text-[11px] text-af-300">{erros.senha}</span>
                  )}
                </label>
                <p className="self-end text-[11px] leading-snug text-graf-500">
                  A senha gerada aparece <strong>uma vez</strong>, numa janela, depois de
                  salvar. O sistema nunca guarda senha em texto — se ela se perder, o
                  caminho é gerar outra.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-graf-800 px-5 py-3">
          <button onClick={onFechar}
            className="rounded-md border border-graf-700 px-4 py-1.5 text-sm text-graf-300
                       hover:border-af-600">
            Cancelar
          </button>
          <button onClick={salvar} disabled={ocupado}
            className="rounded-md bg-af-600 px-5 py-1.5 text-sm font-semibold text-white
                       hover:bg-af-500 disabled:opacity-50">
            {ocupado ? 'Salvando…' : 'Salvar cadastro'}
          </button>
        </div>
      </div>
    </div>
  )
}
