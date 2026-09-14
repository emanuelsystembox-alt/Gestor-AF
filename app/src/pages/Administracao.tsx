import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { equipeRotulo } from '../lib/formato'
import { EditarUsuarioModal } from '../components/EditarUsuarioModal'
import { TabelaTecnicos, type TecnicoLinha } from '../components/TabelaTecnicos'
import {
  conferirCadastro, formataCPF, formataTelefone, loginToaNoPadrao, soDigitos,
  type ErrosCadastro,
} from '../lib/validacao'
import { useAuth } from '../lib/auth'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

/**
 * Administração: usuários, cargos e perfis de acesso.
 *
 * ┌─ D-049 ─────────────────────────────────────────────────────────┐
 * │ PAPEL é a barreira; PERMISSÃO é a granularidade.                │
 * │                                                                  │
 * │ As 66 policies do banco decidem por papel (`tem_papel`). O que   │
 * │ se marca aqui nas caixinhas é camada ADICIONAL: restringe a      │
 * │ tela e as RPCs, nunca amplia o que o RLS já barrou.              │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Criar login exige a `service_role`, que não pode ir para o navegador.
 * Por isso passa pela Edge Function `admin-usuarios`, que confere no
 * banco — não no que o cliente mandou — se quem chamou é ADMIN.
 */

const PAPEIS = ['ADMIN', 'COP', 'CONTROLADOR', 'SUPERVISOR',
                'TECNICO', 'ALMOXARIFE', 'FROTA'] as const

interface Cargo { id: string; nome: string; descricao: string | null; ordem: number; ativo: boolean }
interface PerfilAcesso {
  id: string; nome: string; descricao: string | null
  papel: string | null; ordem: number; ativo: boolean
}
interface Permissao {
  chave: string; modulo: string; rotulo: string
  descricao: string | null; ordem: number; disponivel: boolean
}
/** Quem apagou o contrato, quando e por quê. Existe porque exclusão
 *  definitiva não se desfaz: no dia de uma investigação, esta é a única
 *  coisa que sobra do contrato (D-101). */
interface Exclusao {
  id: number
  contrato: string | null
  wo_numero: string | null
  toa_atividade_id: string | null
  data_agendada: string | null
  situacao: string | null
  equipe_codigo: string | null
  ordens: number | null
  motivo: string
  excluido_em: string
  perfil: { nome: string; email: string } | null
}

/** Skill do técnico — ADESÃO, MANUTENÇÃO, DESCONEXÃO. Não é rótulo: é a
 *  chave que liga o técnico à meta e à faixa de comissão (D-094). */
interface Skill { id: string; nome: string; ativo: boolean; ordem: number }
/** Uma equipe para escolher no cadastro. O NÚMERO não identifica pessoa
 *  nenhuma — várias podem estar na mesma equipe (ver o bloco do login
 *  do TOA, mais abaixo). */
interface EquipeOpcao { id: string; codigo: string; nome: string; base_id: string }
/**
 * Um supervisor COMO A PLANILHA O CHAMA, e o usuário que responde por
 * ele — se alguém já disse quem é.
 *
 * ┌─ por que os dois nomes ──────────────────────────────────────────┐
 * │ > "como eu sei que um supervisor é pai de um nome de técnico?"    │
 * │ >  — Emanuel                                                      │
 * │                                                                   │
 * │ A planilha de equipes traz `SUPERVISOR - RAPHAEL FELIPE` como     │
 * │ TEXTO em cada equipe. O acesso "Supervisor X" é outra coisa: uma  │
 * │ linha em `perfil`. Nada ligava os dois — `equipe.supervisor_id`   │
 * │ estava em 0 de 107 —, então o sistema não tinha como saber que    │
 * │ aquele login é o dono daqueles 29 técnicos.                       │
 * │                                                                   │
 * │ As funções para casar os dois JÁ EXISTIAM no banco desde a 040 e  │
 * │ nunca chegaram a uma tela. Isto aqui é a tela.                    │
 * └───────────────────────────────────────────────────────────────────┘
 */
interface SupervisorPlanilha {
  supervisor_nome: string
  equipes: number
  vinculadas: number
  usuario_id: string | null
  usuario_nome: string | null
  /** Quantos técnicos ficam abaixo dele — a pergunta do Emanuel. */
  tecnicos: number
}
/** Um vínculo login → equipe que vale hoje (`equipe_login_toa`). */
interface RotaLogin { equipe_id: string; codigo: string; nome: string }
/** A OPERAÇÃO — a cidade onde a pessoa atua. No banco é a `base`
 *  (praça); "operação" é como a AFLINE e o relatório da CLARO chamam.
 *  `regiao` é o agrupamento comercial, e é NULA nas praças que o
 *  relatório não cobria (RO, PI) — ver migration 063. */
interface Operacao {
  id: string; codigo: string; nome: string; uf: string; regiao: string | null
}
/** O que já existe com aquele login do TOA. */
interface QuemEhLogin {
  existe: boolean
  id?: string; nome?: string; equipe_id?: string | null
  base_id?: string | null; base_nome?: string | null
  equipe_codigo?: string | null; equipe_nome?: string | null
  ja_tem_acesso?: boolean
}
interface Usuario {
  id: string; nome: string; email: string; apelido: string | null
  ativo: boolean; atualizado_em: string | null; whatsapp: string | null
  /** O cadastro inteiro — a janela de edição (D-128) precisa dele, e
   *  buscar de novo ao abrir faria a janela piscar vazia. */
  cpf: string | null; rg: string | null
  data_nascimento: string | null; matricula_ponto: string | null
  cargo_id: string | null; perfil_acesso_id: string | null; base_id: string | null
  cargo: { nome: string } | null
  perfil_acesso: { nome: string; papel: string | null } | null
  /** Preenchido quando o acesso responde por um técnico — é o que liga
   *  a pessoa à agenda dela (`tecnico.usuario_id`, que o RLS lê). */
  tecnico: {
    matricula: string; nome: string
    equipe_id: string | null
    equipe: { codigo: string; nome: string; supervisor_nome: string | null } | null
    /** O supervisor DECLARADO deste técnico (068). Vale mais que o nome
     *  que vem da planilha na equipe dele. */
    supervisor: { nome: string } | null
  } | null
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

export default function Administracao() {
  const { perfil, temPapel, pode } = useAuth()
  const souAdmin = temPapel('ADMIN')

  const [aba, setAba] = useState<'usuarios' | 'tecnicos' | 'perfis' | 'cargos' | 'exclusoes'>('usuarios')
  const [exclusoes, setExclusoes] = useState<Exclusao[]>([])
  const [buscaExc, setBuscaExc] = useState('')
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [papeisPorUsuario, setPapeisPorUsuario] = useState<Map<string, string[]>>(new Map())
  const [cargos, setCargos] = useState<Cargo[]>([])
  const [perfis, setPerfis] = useState<PerfilAcesso[]>([])
  const [permissoes, setPermissoes] = useState<Permissao[]>([])
  const [doPerfil, setDoPerfil] = useState<Map<string, Set<string>>>(new Map())

  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [busca, setBusca] = useState('')

  // criação
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState({
    nome: '', email: '', apelido: '', whatsapp: '',
    cargo_id: '', perfil_acesso_id: '', cpf: '', rg: '', data_nascimento: '',
    matricula_ponto: '', login_toa: '', skill: '', equipe_id: '', base_id: '',
    supervisor_nome: '',
  })
  const [skills, setSkills] = useState<Skill[]>([])
  /** Equipes para escolher o NÚMERO. A abrigo (SEM-LOGIN) fica de fora:
   *  ela é onde o contrato espera alguém dizer de quem é, não um lugar
   *  para onde se manda técnico. */
  const [equipes, setEquipes] = useState<EquipeOpcao[]>([])
  const [operacoes, setOperacoes] = useState<Operacao[]>([])
  /**
   * Para qual equipe cada login do TOA está roteando HOJE — a chave da
   * lista precisa disto para saber se está ligada.
   *
   * Chave: o login em maiúsculas. Valor: `{ equipe_id, codigo, nome }`.
   * Ausente = não roteia, e o contrato daquele login cai no abrigo.
   */
  const [roteamento, setRoteamento] = useState<Map<string, RotaLogin>>(new Map())
  const [chaveOcupada, setChaveOcupada] = useState<string | null>(null)
  const [supervisores, setSupervisores] = useState<SupervisorPlanilha[]>([])
  /** Os técnicos, que saíram da tela de Equipes e vieram para cá
   *  (D-137): desligar é cadastro, não despacho. */
  const [tecnicos, setTecnicos] = useState<TecnicoLinha[]>([])
  /** O supervisor também vai a campo. A equipe própria dele — com o
   *  NOME dele, não um número — é o que torna possível passar rota. */
  const [equipeDoSupervisor, setEquipeDoSupervisor] = useState(true)
  /** Quem já é esse login, se é alguém. Nulo = ainda não perguntamos;
   *  `{ existe: false }` = perguntamos e não é ninguém. */
  const [quemEhLogin, setQuemEhLogin] = useState<QuemEhLogin | null>(null)
  /** A equipe na tela foi preenchida pela consulta do login (e pode ser
   *  trocada por outra consulta) ou escolhida à mão (e aí é intocável)? */
  const equipeVeioDaConsulta = useRef(true)
  /** Quais skills já têm faixa de comissão. Escolher uma que não tem
   *  deixa o técnico fora da tabela — e isso tem de aparecer na hora,
   *  não no fim do mês. */
  const [skillComFaixa, setSkillComFaixa] = useState<Set<string>>(new Set())
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null)
  /** Um recado por campo errado do formulário de criação (064). */
  const [errosNovo, setErrosNovo] = useState<ErrosCadastro>({})
  /**
   * Amarrar o login do TOA à equipe escolhida — o que faz o contrato
   * IMPORTADO cair nela.
   *
   * ┌─ o defeito que isto conserta ─────────────────────────────────┐
   * │ Em 10/09 o Emanuel cadastrou três técnicos com equipe e        │
   * │ importou a rota. O contrato foi para o TÉCNICO certo (13 para  │
   * │ o Z384041, 11 para o Z515564) — e a EQUIPE de todos ficou em   │
   * │ "Sem login definido".                                          │
   * │                                                                │
   * │ Não é defeito da importação: `equipe_do_contrato` roteia por   │
   * │ `equipe_login_toa`, e essa tabela estava VAZIA para os três.   │
   * │ Cadastrar o técnico numa equipe nunca criou esse vínculo.      │
   * │                                                                │
   * │ A caixa existe em vez de a tela fazer sozinha porque a ação é  │
   * │ pesada e retroativa: `cadastrar_login_da_equipe` move TODOS os │
   * │ contratos daquele login, desde a primeira visita dele, e       │
   * │ registra um evento em cada um. Quem declara é quem clica —     │
   * │ D-079: cadastro sem autor não é cadastro.                      │
   * └────────────────────────────────────────────────────────────────┘
   */
  const [rotearLogin, setRotearLogin] = useState(true)
  const [copiou, setCopiou] = useState(false)

  // edição de usuário
  const [editando, setEditando] = useState<string | null>(null)
  /** Quem está aberto na janela de edição completa (D-128). */
  const [editandoJanela, setEditandoJanela] = useState<Usuario | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, unknown>>({})
  const [papeisEdit, setPapeisEdit] = useState<string[]>([])

  // perfil de acesso aberto na matriz
  const [perfilAberto, setPerfilAberto] = useState<string | null>(null)

  async function recarregar() {
    setCarregando(true); setErro(null)
    const [u, up, c, pa, pm, pap, sk, fx, eq, op, rt, sup, eqs, tec, tl] = await Promise.all([
      supabase.from('perfil')
        .select(`id, nome, email, apelido, ativo, atualizado_em, whatsapp,
                 cpf, rg, data_nascimento, matricula_ponto,
                 cargo_id, perfil_acesso_id, base_id,
                 cargo:cargo_id ( nome ),
                 perfil_acesso:perfil_acesso_id ( nome, papel ),
                 tecnico:tecnico_id ( matricula, nome, equipe_id,
                                      equipe:equipe_id ( codigo, nome, supervisor_nome ),
                                      supervisor:supervisor_id ( nome ) )`)
        .order('nome'),
      supabase.from('usuario_papel').select('usuario_id, papel'),
      supabase.from('cargo').select('*').order('ordem'),
      supabase.from('perfil_acesso').select('*').order('ordem'),
      supabase.from('permissao').select('*').order('modulo').order('ordem'),
      supabase.from('perfil_acesso_permissao').select('perfil_acesso_id, permissao_chave'),
      supabase.from('skill').select('id, nome, ativo, ordem').order('ordem'),
      supabase.from('faixa_comissao').select('skill').eq('ativo', true),
      supabase.from('equipe').select('id, codigo, nome, base_id')
        .eq('ativo', true).neq('codigo', 'SEM-LOGIN').order('codigo'),
      supabase.from('base').select('id, codigo, nome, uf, regiao')
        .eq('ativo', true).order('nome'),
      // O vínculo ABERTO de cada login. `fim is null` é o que vale de
      // hoje em diante; período já encerrado é história, não estado.
      supabase.from('equipe_login_toa')
        .select('login_toa, equipe:equipe_id ( id, codigo, nome )')
        .is('fim', null),
      // Os supervisores como a planilha os escreve, e a quem já estão
      // ligados. A função existe desde a 040 e nunca teve tela.
      supabase.rpc('supervisores_das_equipes'),
      // Para contar os técnicos abaixo de cada um: técnico → equipe →
      // supervisor_nome. É a corrente que já existe hoje.
      supabase.from('equipe').select('id, supervisor_nome'),
      supabase.from('tecnico').select('equipe_id').eq('situacao', 'ATIVO'),
      supabase.from('tecnico')
        .select(`id, matricula, nome, situacao, equipe_id, foto_url,
                 base:base_id ( nome, regiao ),
                 supervisor:supervisor_id ( nome ),
                 equipe:equipe_id ( codigo, nome, supervisor_nome,
                                    area:area_id ( apelido ) )`)
        .order('matricula'),
    ])
    if (u.error) setErro(u.error.message)
    else setUsuarios((u.data ?? []) as unknown as Usuario[])

    const mp = new Map<string, string[]>()
    for (const r of (up.data ?? []) as { usuario_id: string; papel: string }[]) {
      mp.set(r.usuario_id, [...(mp.get(r.usuario_id) ?? []), r.papel])
    }
    setPapeisPorUsuario(mp)

    setCargos((c.data ?? []) as Cargo[])
    setPerfis((pa.data ?? []) as PerfilAcesso[])
    setPermissoes((pm.data ?? []) as Permissao[])

    const dp = new Map<string, Set<string>>()
    for (const r of (pap.data ?? []) as { perfil_acesso_id: string; permissao_chave: string }[]) {
      if (!dp.has(r.perfil_acesso_id)) dp.set(r.perfil_acesso_id, new Set())
      dp.get(r.perfil_acesso_id)!.add(r.permissao_chave)
    }
    setDoPerfil(dp)
    setSkills((sk.data ?? []) as Skill[])
    setSkillComFaixa(new Set(
      ((fx.data ?? []) as { skill: string }[]).map(x => x.skill)))
    setEquipes((eq.data ?? []) as EquipeOpcao[])
    setOperacoes((op.data ?? []) as Operacao[])

    const mr = new Map<string, RotaLogin>()
    for (const r of (rt.data ?? []) as unknown as {
      login_toa: string; equipe: { id: string; codigo: string; nome: string } | null
    }[]) {
      if (r.equipe) {
        mr.set(r.login_toa.trim().toUpperCase(),
               { equipe_id: r.equipe.id, codigo: r.equipe.codigo, nome: r.equipe.nome })
      }
    }
    setRoteamento(mr)

    // técnicos por supervisor, pela corrente técnico → equipe → nome
    const supDaEquipe = new Map<string, string>()
    for (const e of (eqs.data ?? []) as { id: string; supervisor_nome: string | null }[]) {
      if (e.supervisor_nome) supDaEquipe.set(e.id, e.supervisor_nome)
    }
    const nTec = new Map<string, number>()
    for (const t of (tec.data ?? []) as { equipe_id: string | null }[]) {
      const nome = t.equipe_id ? supDaEquipe.get(t.equipe_id) : undefined
      if (nome) nTec.set(nome, (nTec.get(nome) ?? 0) + 1)
    }
    setTecnicos((tl.data ?? []) as unknown as TecnicoLinha[])
    setSupervisores(((sup.data ?? []) as Omit<SupervisorPlanilha, 'tecnicos'>[])
      .map(x => ({ ...x, tecnicos: nTec.get(x.supervisor_nome) ?? 0 })))
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [])

  /**
   * Quem já é este login do TOA?
   *
   * ┌─ por que perguntar antes de gravar ──────────────────────────────┐
   * │ > "o número da equipe pode se repetir para mais de um técnico,    │
   * │ >  porém o que vai diferenciar mesmo é o nome dele e o cpf e rg"  │
   * │ >  — Emanuel                                                      │
   * │                                                                   │
   * │ O login do TOA é a chave do ROTEAMENTO — é por ele que a rota     │
   * │ importada cai no técnico certo (`importar_toa` casa               │
   * │ `tecnico.matricula` com a coluna "Login do Técnico"). Como ele é  │
   * │ chave, digitar um login que já é de outra pessoa não é um erro    │
   * │ de digitação qualquer: é passar a rota de alguém para outro       │
   * │ alguém. Então a tela diz de quem é ANTES de gravar, com nome e    │
   * │ equipe, em vez de deixar a descoberta para o erro do servidor.    │
   * └───────────────────────────────────────────────────────────────────┘
   */
  useEffect(() => {
    const login = novo.login_toa.trim()
    if (!criando || !login) { setQuemEhLogin(null); return }
    let vivo = true
    // Espera parar de digitar: "Z674378" são sete consultas sem isto.
    const t = setTimeout(async () => {
      const { data } = await supabase.from('tecnico')
        .select(`id, nome, usuario_id, equipe_id, base_id,
                 equipe:equipe_id ( codigo, nome ), base:base_id ( nome )`)
        .ilike('matricula', login).limit(1)
      if (!vivo) return
      const t0 = (data ?? [])[0] as unknown as {
        id: string; nome: string; usuario_id: string | null; equipe_id: string | null
        base_id: string | null
        equipe: { codigo: string; nome: string } | null
        base: { nome: string } | null
      } | undefined
      if (!t0) {
        setQuemEhLogin({ existe: false })
        if (equipeVeioDaConsulta.current) {
          setNovo(n => ({ ...n, equipe_id: '', base_id: '' }))
        }
        return
      }
      setQuemEhLogin({
        existe: true, id: t0.id, nome: t0.nome, equipe_id: t0.equipe_id,
        base_id: t0.base_id, base_nome: t0.base?.nome ?? null,
        equipe_codigo: t0.equipe?.codigo ?? null,
        equipe_nome: t0.equipe?.nome ?? null,
        ja_tem_acesso: !!t0.usuario_id,
      })
      // A equipe que ele já tem entra escolhida — mudar é um clique, e
      // assim o cadastro não zera o que já estava certo.
      //
      // Só que a sugestão TEM DE SAIR quando o login muda: trocar
      // Z674378 por outro login deixava "033 - EQUIPE" selecionada, e
      // gravar dali moveria o técnico novo para a equipe de um técnico
      // que nada tem a ver — em silêncio. Por isso a marca de "isto foi
      // a tela que preencheu": o que a pessoa escolheu à mão fica; o
      // que veio da consulta anterior é substituído.
      if (equipeVeioDaConsulta.current) {
        setNovo(n => ({ ...n, equipe_id: t0.equipe_id ?? '', base_id: t0.base_id ?? '' }))
      }
    }, 350)
    return () => { vivo = false; clearTimeout(t) }
  }, [novo.login_toa, criando])

  // Só quando a aba abre: é histórico, não faz parte da tela inicial.
  useEffect(() => {
    if (aba !== 'exclusoes') return
    supabase.from('exclusao_definitiva')
      .select(`id, contrato, wo_numero, toa_atividade_id, data_agendada, situacao,
               equipe_codigo, ordens, motivo, excluido_em,
               perfil:excluido_por ( nome, email )`)
      .order('excluido_em', { ascending: false }).limit(500)
      .then(({ data, error }) => {
        if (error) setErro(error.message)
        else setExclusoes((data ?? []) as unknown as Exclusao[])
      })
  }, [aba])

  const porModulo = useMemo(() => {
    const m = new Map<string, Permissao[]>()
    for (const p of permissoes) m.set(p.modulo, [...(m.get(p.modulo) ?? []), p])
    return [...m.entries()]
  }, [permissoes])

  function traduzir(msg: string): string {
    if (/row-level security|violates row|permission denied/i.test(msg))
      return 'O banco recusou: seu usuário não tem papel ADMIN. A barreira é do RLS, não da tela.'
    if (/duplicate key/i.test(msg)) return 'Já existe um registro com esse nome.'
    return msg
  }

  /** "045 - EQUIPE" a partir do id — para o recado dizer o mesmo nome
   *  que está escrito no seletor. */
  function rotuloEquipe(id: string): string {
    const e = equipes.find(x => x.id === id)
    return e ? equipeRotulo(e.codigo, e.nome) : 'escolhida'
  }
  function rotuloOperacao(id: string): string {
    return operacoes.find(x => x.id === id)?.nome ?? 'escolhida'
  }

  /** As operações agrupadas por região, como no relatório: NORTE,
   *  CENTRO-OESTE e — separado, escrito — o que ainda não tem região. */
  const operacoesPorRegiao = useMemo(() => {
    const m = new Map<string, Operacao[]>()
    for (const o of operacoes) {
      const k = o.regiao ?? ''
      m.set(k, [...(m.get(k) ?? []), o])
    }
    return [...m.entries()].sort(([a], [b]) =>
      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))
  }, [operacoes])

  /** Equipe é de UMA praça. Escolhida a operação, só as equipes dela
   *  entram na lista — senão dá para cadastrar técnico de Manaus numa
   *  equipe de Belém, e o banco recusa depois, sem explicar direito. */
  const equipesDaOperacao = useMemo(() =>
    novo.base_id ? equipes.filter(e => e.base_id === novo.base_id) : equipes,
    [equipes, novo.base_id])

  /** O papel que vem do perfil de acesso escolhido — é ele que diz se
   *  esta pessoa é supervisor, e portanto se o campo faz sentido. */
  const papelDoPerfilNovo = useMemo(
    () => perfis.find(p => p.id === novo.perfil_acesso_id)?.papel ?? null,
    [perfis, novo.perfil_acesso_id])

  async function criarUsuario() {
    // A conferência vem ANTES da viagem ao servidor: erro de forma se
    // responde na hora, sem gastar uma criação de conta que vai falhar
    // pela metade (o acesso nasce e o perfil é recusado pelo CHECK).
    const e = conferirCadastro(novo)
    setErrosNovo(e)
    if (Object.keys(e).length) {
      setErro('Confira os campos marcados.')
      return
    }
    setOcupado(true); setErro(null); setOk(null); setSenhaGerada(null)
    const { data, error } = await supabase.functions.invoke('admin-usuarios', {
      body: {
        acao: 'criar',
        nome: novo.nome.trim(),
        email: novo.email.trim().toLowerCase(),
        apelido: novo.apelido.trim() || null,
        whatsapp: soDigitos(novo.whatsapp) || null,
        // Só dígitos: a máscara é da tela, e o banco recusa outra
        // forma desde a 064.
        cpf: soDigitos(novo.cpf) || null,
        rg: novo.rg.trim() || null,
        // date vazio vira '' e o Postgres recusa '' como data.
        data_nascimento: novo.data_nascimento || null,
        matricula_ponto: novo.matricula_ponto.trim() || null,
        cargo_id: novo.cargo_id || null,
        perfil_acesso_id: novo.perfil_acesso_id || null,
      },
    })
    const r = data as {
      ok?: boolean; erro?: string; senha_gerada?: string | null
      email?: string; usuario_id?: string
    } | null
    if (error || r?.erro) setErro(traduzir(r?.erro ?? error?.message ?? 'Falha ao criar.'))
    else {
      let recado = `Acesso criado para ${novo.email.trim().toLowerCase()}.`

      // O login do TOA é o que liga o acesso ao TÉCNICO — e é
      // `tecnico.usuario_id` que o RLS consulta para saber qual agenda a
      // pessoa enxerga. Sem isto o técnico entra e vê a tela vazia.
      const loginTOA = novo.login_toa.trim()
      if (loginTOA && r?.usuario_id) {
        /*
         * ┌─ o técnico existe antes do vínculo ──────────────────────────┐
         * │ `vincular_tecnico_ao_usuario` só LIGA um acesso a um técnico  │
         * │ que já existe — quem criava técnico era a planilha de         │
         * │ equipes. Então cadastrar alguém que ainda não veio na         │
         * │ planilha morria em "Nao existe tecnico com o login X".        │
         * │                                                               │
         * │ `cadastrar_tecnico_avulso` resolve os dois casos: cria quando │
         * │ não existe e, quando já existe, move de equipe (o `on         │
         * │ conflict` dela atualiza `equipe_id`) e religa os contratos    │
         * │ daquele login que estavam sem técnico.                        │
         * │                                                               │
         * │ O NOME que vai é o que já está no cadastro do técnico, não o  │
         * │ do formulário: renomear em silêncio o técnico que a planilha  │
         * │ trouxe seria mudar dado da fonte por efeito colateral de      │
         * │ criar um acesso.                                              │
         * └───────────────────────────────────────────────────────────────┘
         */
        const precisaCriar = quemEhLogin?.existe === false
        const mudaEquipe = !!novo.equipe_id
          && novo.equipe_id !== (quemEhLogin?.equipe_id ?? '')
        if (precisaCriar || mudaEquipe) {
          const { error: ec } = await supabase.rpc('cadastrar_tecnico_avulso', {
            p_matricula: loginTOA,
            p_nome: quemEhLogin?.nome ?? novo.nome.trim(),
            p_equipe_id: novo.equipe_id || null,
            // A operação é a cidade onde ele atua. Com equipe escolhida
            // ela vem da equipe (063); sem equipe, é isto que evita o
            // "primeira base visível" que ninguém pediu.
            p_base_id: novo.base_id || null,
          })
          if (ec) {
            recado += ` O técnico não pôde ser ${precisaCriar ? 'criado' : 'movido de equipe'}:`
              + ` ${traduzir(ec.message)}`
          } else if (precisaCriar) {
            recado += ` Técnico ${loginTOA} criado`
              + (novo.equipe_id ? ` na equipe ${rotuloEquipe(novo.equipe_id)}` : ' sem equipe')
              + (novo.base_id ? `, operação ${rotuloOperacao(novo.base_id)}.` : '.')
          } else {
            recado += ` Técnico movido para a equipe ${rotuloEquipe(novo.equipe_id)}.`
          }
        }

        // Amarra o login à equipe: sem isto o contrato importado cai no
        // abrigo, mesmo com o técnico cadastrado na equipe certa.
        if (rotearLogin && novo.equipe_id) {
          const { data: rl, error: el } = await supabase.rpc('cadastrar_login_da_equipe',
            { p_equipe: novo.equipe_id, p_login: loginTOA })
          if (el) {
            recado += ` O login NÃO foi amarrado à equipe: ${traduzir(el.message)}`
              + ' — os contratos dele continuam em "Sem login definido".'
          } else {
            const x = rl as { contratos_movidos: number }
            recado += ` Login ${loginTOA.toUpperCase()} roteado para a equipe`
              + ` ${rotuloEquipe(novo.equipe_id)}`
              + (x.contratos_movidos
                  ? `, e ${x.contratos_movidos} contrato(s) já importado(s) foram para lá.`
                  : '.')
          }
        }

        const { data: v, error: ev } = await supabase.rpc(
          'vincular_tecnico_ao_usuario',
          { p_usuario: r.usuario_id, p_login_toa: loginTOA })
        if (ev) {
          // O acesso foi criado; só o vínculo falhou. Dizer as duas
          // coisas evita que alguém crie o usuário de novo.
          recado += ` Mas o vínculo com o técnico falhou: ${traduzir(ev.message)}`
        } else {
          const t = v as { tecnico: string; matricula: string; equipe: string | null }
          recado += ` Vinculado ao técnico ${t.matricula} · ${t.tecnico}`
            + (t.equipe ? `, equipe ${t.equipe}.` : '.')

          // A skill decide meta e faixa de comissão. Se a escolhida
          // ainda não tem tabela, o recado diz — senão o técnico fica
          // com "a receber R$ 0" e ninguém sabe por quê (D-094).
          if (novo.skill) {
            const { data: s, error: es } = await supabase.rpc(
              'definir_skill_tecnico',
              { p_login_toa: loginTOA, p_skill: novo.skill })
            if (es) recado += ` A skill não foi gravada: ${traduzir(es.message)}`
            else {
              const r2 = s as { faixas: number; meta: number | null }
              recado += ` Skill ${novo.skill}.`
              if (!r2.faixas) {
                recado += ` ATENÇÃO: ${novo.skill} ainda não tem faixa de comissão`
                  + ' — a receber ficará R$ 0 até cadastrar a tabela em Produtividade.'
              }
            }
          }
        }
      }
      // O supervisor da planilha: liga o ACESSO ao nome que vem em cada
      // equipe. Depois do papel existir — a função exige SUPERVISOR.
      if (novo.supervisor_nome && r?.usuario_id) {
        const { data: sv, error: es } = await supabase.rpc('definir_supervisor_das_equipes',
          { p_usuario: r.usuario_id, p_supervisor_nome: novo.supervisor_nome })
        if (es) recado += ` O vínculo de supervisor falhou: ${traduzir(es.message)}`
        else {
          const x = sv as { equipes: number }
          recado += ` Supervisiona ${x.equipes} equipe(s) de ${novo.supervisor_nome}.`
          if (equipeDoSupervisor) {
            const { data: eq2, error: ee } = await supabase.rpc(
              'criar_equipe_do_supervisor', { p_usuario: r.usuario_id })
            if (ee) recado += ` A equipe própria não foi criada: ${traduzir(ee.message)}`
            else {
              const y = eq2 as { codigo: string; nome: string; ja_existia: boolean }
              recado += y.ja_existia
                ? ` A equipe própria dele (${y.nome}) já existia.`
                : ` Criada a equipe própria dele: ${y.nome}.`
            }
          }
        }
      }

      setOk(recado)
      if (r?.senha_gerada) setSenhaGerada({ email: r.email!, senha: r.senha_gerada })
      setCriando(false)
      setNovo({ nome: '', email: '', apelido: '', whatsapp: '',
                cargo_id: '', perfil_acesso_id: '', cpf: '', rg: '',
                data_nascimento: '', matricula_ponto: '', login_toa: '',
                skill: '', equipe_id: '', base_id: '', supervisor_nome: '' })
      setErrosNovo({})
      equipeVeioDaConsulta.current = true
      await recarregar()
    }
    setOcupado(false)
  }

  /**
   * A CHAVE do roteamento, na lista.
   *
   * ┌─ por que ela saiu de dentro do "Editar" ─────────────────────────┐
   * │ > "eu acho que é bom essa função ficar fora do editar […] uma     │
   * │ >  chave ao lado, melhor, por isso não achei" — Emanuel           │
   * │                                                                   │
   * │ Ela nasceu como caixa de seleção dentro da janela de edição, e o  │
   * │ Emanuel não a achou — foi preciso eu apontar onde estava. Comando │
   * │ que só existe a três cliques de distância, dentro de um           │
   * │ formulário de quinze campos, é comando que ninguém usa.           │
   * │                                                                   │
   * │ Aqui ela fica ao lado do login, mostra PARA ONDE está roteando, e │
   * │ o estado é lido do banco (`equipe_login_toa` aberto), não de um   │
   * │ palpite da tela.                                                  │
   * └───────────────────────────────────────────────────────────────────┘
   */
  async function alternarRoteamento(u: Usuario) {
    const login = u.tecnico?.matricula?.trim().toUpperCase()
    if (!login) return
    const rota = roteamento.get(login)
    setChaveOcupada(login); setErro(null); setOk(null)

    if (rota) {
      // Desligar move NADA: o contrato já roteado fica onde está.
      const ok = confirm(
        `Desligar o roteamento do login ${login}?

`
        + `A partir de hoje o contrato dele volta a cair em "Sem login definido".
`
        + `Os contratos que JÁ foram para a equipe ${equipeRotulo(rota.codigo, rota.nome)}`
        + ` continuam lá — desligar não desfaz despacho.`)
      if (!ok) { setChaveOcupada(null); return }
      const { data, error } = await supabase.rpc('desligar_login_da_equipe',
        { p_login: login })
      if (error) setErro(traduzir(error.message))
      else {
        const r = data as { acao: string; equipe: string; contratos_mantidos: number }
        setOk(`Login ${login} desligado da equipe ${r.equipe}.`
          + ` ${r.contratos_mantidos} contrato(s) continuam onde estavam.`)
      }
    } else {
      const equipe = u.tecnico?.equipe_id
      if (!equipe) { setChaveOcupada(null); return }
      const { data, error } = await supabase.rpc('cadastrar_login_da_equipe',
        { p_equipe: equipe, p_login: login })
      if (error) setErro(traduzir(error.message))
      else {
        const r = data as { equipe: string; contratos_movidos: number }
        // Zero movidos NÃO quer dizer "este login não tem contrato": quer
        // dizer que nenhum precisou mudar de lugar — ou já estavam na
        // equipe, ou ainda não foi importado nada com ele. Dizer a
        // primeira coisa seria afirmar o que não se sabe.
        setOk(`Login ${login} roteando para a equipe ${r.equipe}.`
          + (r.contratos_movidos
              ? ` ${r.contratos_movidos} contrato(s) já importado(s) foram para lá.`
              : ' Nenhum contrato precisou ser movido.'))
      }
    }
    await recarregar()
    setChaveOcupada(null)
  }

  /** Desligar/reativar técnico. A regra é do banco: DELETE é só para
   *  ADMIN e o gatilho recusa quem tem histórico — a tela só oferece
   *  Desligar/Reativar, que preserva a autoria do que ele executou
   *  (D-090). */
  async function mudarSituacaoTecnico(t: TecnicoLinha, para: 'ATIVO' | 'DESLIGADO') {
    if (para === 'DESLIGADO'
        && !confirm(`Desligar ${t.matricula} · ${t.nome}?

`
                    + 'Ele sai da operação. O histórico de contratos dele fica, '
                    + 'e dá para reativar depois.')) return
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('mudar_situacao_tecnico',
      { p_tecnico: t.id, p_situacao: para })
    if (error) setErro(traduzir(error.message))
    else setOk(`${t.nome} ${para === 'ATIVO' ? 'reativado' : 'desligado'}.`)
    await recarregar()
    setOcupado(false)
  }

  async function novaSenha(u: Usuario) {
    setOcupado(true); setErro(null); setOk(null); setSenhaGerada(null)
    const { data, error } = await supabase.functions.invoke('admin-usuarios', {
      body: { acao: 'senha', usuario_id: u.id },
    })
    const r = data as { erro?: string; senha_gerada?: string } | null
    if (error || r?.erro) setErro(traduzir(r?.erro ?? error?.message ?? 'Falha.'))
    else if (r?.senha_gerada) setSenhaGerada({ email: u.email, senha: r.senha_gerada })
    setOcupado(false)
  }

  async function salvarUsuario(u: Usuario) {
    setOcupado(true); setErro(null); setOk(null)
    if (Object.keys(rascunho).length) {
      const { error } = await supabase.from('perfil').update(rascunho).eq('id', u.id)
      if (error) { setErro(traduzir(error.message)); setOcupado(false); return }
    }
    const atuais = papeisPorUsuario.get(u.id) ?? []
    if (papeisEdit.sort().join() !== [...atuais].sort().join()) {
      const { error } = await supabase.rpc('definir_papeis',
        { p_usuario: u.id, p_papeis: papeisEdit })
      if (error) { setErro(traduzir(error.message)); setOcupado(false); return }
    }
    setOk(`${u.nome} atualizado.`)
    setEditando(null); setRascunho({}); setPapeisEdit([])
    await recarregar()
    setOcupado(false)
  }

  async function alternarSituacao(u: Usuario) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_situacao_usuario',
      { p_usuario: u.id, p_ativo: !u.ativo })
    if (error) setErro(traduzir(error.message))
    else { setOk(`${u.nome} ${u.ativo ? 'desativado' : 'reativado'}.`); await recarregar() }
    setOcupado(false)
  }

  async function alternarPermissao(pa: PerfilAcesso, chave: string) {
    const tem = doPerfil.get(pa.id)?.has(chave)
    setOcupado(true); setErro(null)
    const { error } = tem
      ? await supabase.from('perfil_acesso_permissao').delete()
          .eq('perfil_acesso_id', pa.id).eq('permissao_chave', chave)
      : await supabase.from('perfil_acesso_permissao')
          .insert({ perfil_acesso_id: pa.id, permissao_chave: chave })
    if (error) setErro(traduzir(error.message))
    else {
      setDoPerfil(m => {
        const n = new Map(m)
        const s = new Set(n.get(pa.id) ?? [])
        if (tem) s.delete(chave); else s.add(chave)
        n.set(pa.id, s)
        return n
      })
    }
    setOcupado(false)
  }

  async function criarCargo(nome: string) {
    if (!nome.trim()) return
    setOcupado(true); setErro(null)
    const { data: emp } = await supabase.from('empresa').select('id').maybeSingle()
    const { error } = await supabase.from('cargo').insert({
      empresa_id: (emp as { id: string } | null)?.id ?? null,
      nome: nome.trim().toUpperCase(),
      ordem: (cargos.at(-1)?.ordem ?? 0) + 1,
    })
    if (error) setErro(traduzir(error.message))
    else { setOk(`Cargo "${nome.trim().toUpperCase()}" criado.`); await recarregar() }
    setOcupado(false)
  }

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return usuarios
    return usuarios.filter(u => [u.nome, u.email, u.apelido, u.cargo?.nome,
      u.perfil_acesso?.nome].some(x => x?.toLowerCase().includes(t)))
  }, [usuarios, busca])

  const [nomeCargo, setNomeCargo] = useState('')

  return (
    <Shell>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Administração</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            Quem entra, com qual cargo e o que enxerga. <strong>O papel é a barreira
            do banco</strong> — as caixinhas de permissão restringem a tela e as ações,
            nunca ampliam o que o RLS já barrou.
          </p>
        </div>

        {!souAdmin && (
          <Alerta tipo="aviso">
            Você está vendo esta tela, mas <strong>não tem papel ADMIN</strong>. O banco
            vai recusar qualquer alteração — e é assim que tem que ser.
          </Alerta>
        )}
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        <div className="flex rounded-lg bg-graf-900 p-0.5">
          {([['usuarios', 'Usuários', usuarios.length],
             ['tecnicos', 'Técnicos', tecnicos.length],
             ['perfis', 'Perfis de acesso', perfis.length],
             ['cargos', 'Cargos', cargos.length],
             ['exclusoes', 'Contratos apagados', exclusoes.length]] as const).map(([a, rot, n]) => (
            <button key={a} onClick={() => { setAba(a); setEditando(null) }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
              {rot}<span className="tabular ml-1.5 opacity-60">{n}</span>
            </button>
          ))}
        </div>

        {carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : aba === 'usuarios' ? (
          <section className="space-y-4">
            <div className="card-controle p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar nome, e-mail, cargo, perfil…"
                  className={`${campo} min-w-64 flex-1`} />
                <button onClick={() => { setCriando(!criando); setSenhaGerada(null) }}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500">
                  {criando ? 'Cancelar' : 'Novo usuário'}
                </button>
              </div>

              {criando && (
                <div className="mt-3 space-y-3 border-t border-graf-800 pt-3">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {/* ┌─ o campo agora TEM FORMA ───────────────────────┐
                        │ > "campos de cadastro estão deixando eu colocar  │
                        │ >  qualquer coisa" — Emanuel                     │
                        │                                                  │
                        │ CPF e telefone ganham máscara enquanto se        │
                        │ digita, e o erro aparece NO CAMPO, não numa      │
                        │ faixa no topo que some do campo de visão. O que  │
                        │ vai para o banco é só dígito (064).              │
                        └──────────────────────────────────────────────────┘ */}
                    {([['nome', 'Nome completo *', 'text', undefined],
                       ['email', 'E-mail *', 'text', undefined],
                       ['apelido', 'Apelido', 'text', undefined],
                       ['whatsapp', 'WhatsApp', 'text', formataTelefone],
                       ['cpf', 'CPF', 'text', formataCPF],
                       ['rg', 'RG', 'text', undefined],
                       ['data_nascimento', 'Nascimento', 'date', undefined],
                       ['matricula_ponto', 'Matrícula do ponto', 'text', undefined],
                       ['login_toa', 'Login TOA (matrícula do técnico)', 'text', undefined],
                      ] as [keyof typeof novo, string, string,
                            ((v: string) => string) | undefined][]).map(([k, rot, tipo, mascara]) => (
                      <label key={k} className="text-xs text-graf-400">
                        <span className="mb-1 block">{rot}</span>
                        <input value={String(novo[k] ?? '')} type={tipo}
                          aria-invalid={!!errosNovo[k]}
                          className={`${campo} w-full ${errosNovo[k] ? 'border-af-500' : ''}`}
                          onChange={e => {
                            const v = mascara ? mascara(e.target.value) : e.target.value
                            setNovo(n => ({ ...n, [k]: v }))
                            setErrosNovo(x => { const y = { ...x }; delete y[k]; return y })
                          }} />
                        {errosNovo[k] && (
                          <span className="mt-1 block text-[11px] text-af-300">{errosNovo[k]}</span>
                        )}
                        {/* O login do TOA AVISA e não barra: quem emite o
                            padrão é a operadora, não nós. */}
                        {k === 'login_toa' && !errosNovo[k]
                          && novo.login_toa.trim() && !loginToaNoPadrao(novo.login_toa) && (
                          <span className="mt-1 block text-[11px] text-amber-400">
                            Fora do padrão da operação (letra + 6 ou 7 dígitos) — confira.
                          </span>
                        )}
                      </label>
                    ))}
                    {/* Skill é do TÉCNICO, não do acesso: sem login do
                        TOA não há em quem gravar. */}
                    <label className="text-xs text-graf-400">
                      <span className="mb-1 block">
                        Skill do técnico
                        {!novo.login_toa.trim() && (
                          <span className="ml-1 text-graf-600">— precisa do login TOA</span>
                        )}
                      </span>
                      <select value={novo.skill} disabled={!novo.login_toa.trim()}
                        className={`${campo} w-full disabled:opacity-40`}
                        onChange={e => setNovo(n => ({ ...n, skill: e.target.value }))}>
                        <option value="">— sem skill —</option>
                        {skills.filter(s => s.ativo || s.nome === novo.skill).map(s => (
                          <option key={s.id} value={s.nome}>
                            {s.nome}{skillComFaixa.has(s.nome) ? '' : ' (sem faixa ainda)'}
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* ┌─ a OPERAÇÃO ────────────────────────────────────┐
                        │ > "é importante saber de qual cidade ele atua"   │
                        │ >  — Emanuel                                     │
                        │                                                  │
                        │ No banco é a `base` (praça); "operação" é o nome │
                        │ que a operação e o relatório da CLARO usam.      │
                        │ `tecnico.base_id` sempre existiu e nunca era     │
                        │ perguntado: quem cadastrava pegava a primeira    │
                        │ praça visível, calado. Agora a tela pergunta.    │
                        └──────────────────────────────────────────────────┘ */}
                    <label className="text-xs text-graf-400">
                      <span className="mb-1 block">
                        Operação (cidade)
                        {!novo.login_toa.trim() && (
                          <span className="ml-1 text-graf-600">— precisa do login TOA</span>
                        )}
                      </span>
                      <select value={novo.base_id} disabled={!novo.login_toa.trim()}
                        className={`${campo} w-full disabled:opacity-40`}
                        onChange={e => {
                          equipeVeioDaConsulta.current = false
                          // Trocar de cidade invalida a equipe escolhida:
                          // equipe é de UMA praça.
                          setNovo(n => ({ ...n, base_id: e.target.value, equipe_id: '' }))
                        }}>
                        <option value="">— escolha a operação —</option>
                        {operacoesPorRegiao.map(([regiao, lista]) => (
                          <optgroup key={regiao || 'sem'}
                            label={regiao || 'sem região definida'}>
                            {lista.map(o => (
                              <option key={o.id} value={o.id}>{o.nome}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    {/* ┌─ o NÚMERO da equipe ────────────────────────────┐
                        │ > "na concorrência o id era o número da equipe,  │
                        │ >  eu não quero isso" — Emanuel                  │
                        │                                                  │
                        │ Aqui ele é só um AGRUPAMENTO: o mesmo número     │
                        │ serve a vários técnicos, e quem identifica a     │
                        │ pessoa é nome, CPF e RG — que estão acima, no    │
                        │ próprio cadastro. Liberado pelo login do TOA     │
                        │ porque equipe é do TÉCNICO: sem login não há em  │
                        │ quem gravar, igual à skill.                      │
                        └──────────────────────────────────────────────────┘ */}
                    <label className="text-xs text-graf-400">
                      <span className="mb-1 block">
                        Número da equipe
                        {!novo.login_toa.trim() && (
                          <span className="ml-1 text-graf-600">— precisa do login TOA</span>
                        )}
                      </span>
                      <select value={novo.equipe_id} disabled={!novo.login_toa.trim()}
                        className={`${campo} w-full disabled:opacity-40`}
                        onChange={e => {
                          equipeVeioDaConsulta.current = false
                          setNovo(n => ({ ...n, equipe_id: e.target.value }))
                        }}>
                        <option value="">— sem equipe por enquanto —</option>
                        {equipesDaOperacao.map(e => (
                          <option key={e.id} value={e.id}>{equipeRotulo(e.codigo, e.nome)}</option>
                        ))}
                      </select>
                      {/* Beco sem saída explicado: a operação existe, as
                          equipes dela ainda não foram importadas. Select
                          vazio sem explicação parece defeito da tela. */}
                      {novo.base_id && equipesDaOperacao.length === 0 && (
                        <span className="mt-1 block text-[11px] text-amber-400">
                          Nenhuma equipe cadastrada em {rotuloOperacao(novo.base_id)} ainda —
                          importe a planilha de equipes dessa operação. O técnico pode ser
                          cadastrado sem equipe.
                        </span>
                      )}
                    </label>
                    <label className="text-xs text-graf-400">
                      <span className="mb-1 block">Cargo</span>
                      <select value={novo.cargo_id} className={`${campo} w-full`}
                        onChange={e => setNovo(n => ({ ...n, cargo_id: e.target.value }))}>
                        <option value="">— sem cargo —</option>
                        {cargos.filter(c => c.ativo).map(c =>
                          <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </label>
                    {/* Só para quem vai ser SUPERVISOR: é o campo que
                        responde "de quais técnicos esta pessoa é o chefe". */}
                    {papelDoPerfilNovo === 'SUPERVISOR' && (
                      <label className="text-xs text-graf-400">
                        <span className="mb-1 block">
                          Supervisor da planilha
                          <span className="ml-1 text-graf-600">— quem ele é no TOA</span>
                        </span>
                        <select value={novo.supervisor_nome} className={`${campo} w-full`}
                          onChange={e => setNovo(n => ({ ...n, supervisor_nome: e.target.value }))}>
                          <option value="">— não é supervisor de equipe —</option>
                          {supervisores.map(sv => (
                            <option key={sv.supervisor_nome} value={sv.supervisor_nome}>
                              {sv.supervisor_nome} — {sv.equipes} equipe(s), {sv.tecnicos} téc.
                              {sv.usuario_nome ? ` · já é de ${sv.usuario_nome}` : ''}
                            </option>
                          ))}
                        </select>
                        {novo.supervisor_nome && (
                          <label className="mt-1.5 flex cursor-pointer items-start gap-1.5
                                            text-[11px] text-graf-400">
                            <input type="checkbox" checked={equipeDoSupervisor}
                              className="mt-0.5 accent-af-600"
                              onChange={e => setEquipeDoSupervisor(e.target.checked)} />
                            <span>
                              Criar a equipe própria dele.
                              <span className="mt-0.5 block text-graf-500">A equipe própria é o que permite <strong>passar rota para ele</strong> quando
                      for a campo. Ela aparece na lista pelo nome, não por número — de
                      propósito, para se distinguir das equipes de campo.</span>
                            </span>
                          </label>
                        )}
                      </label>
                    )}
                    <label className="text-xs text-graf-400">
                      <span className="mb-1 block">Perfil de acesso</span>
                      <select value={novo.perfil_acesso_id} className={`${campo} w-full`}
                        onChange={e => setNovo(n => ({ ...n, perfil_acesso_id: e.target.value }))}>
                        <option value="">— sem perfil —</option>
                        {perfis.filter(p => p.ativo).map(p =>
                          <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                    </label>
                  </div>
                  {/* De quem é o login digitado — antes de gravar, não
                      depois do erro. O login é a chave por onde a rota
                      importada encontra o técnico. */}
                  {novo.login_toa.trim() && quemEhLogin && (
                    quemEhLogin.existe ? (
                      <p className="text-xs text-graf-300">
                        O login <strong className="tabular">{novo.login_toa.trim().toUpperCase()}</strong>
                        {' '}já é do técnico <strong>{quemEhLogin.nome}</strong>
                        {quemEhLogin.equipe_codigo
                          ? <>, hoje na equipe{' '}
                              <strong>{equipeRotulo(quemEhLogin.equipe_codigo,
                                                    quemEhLogin.equipe_nome)}</strong></>
                          : <>, hoje sem equipe</>}
                        {quemEhLogin.base_nome
                          ? <>, operação <strong>{quemEhLogin.base_nome}</strong>.</>
                          : <>.</>}
                        {quemEhLogin.ja_tem_acesso && (
                          <span className="text-amber-400">
                            {' '}Ele já tem um acesso — o banco recusa dois acessos para o
                            mesmo técnico, e este cadastro vai falhar no vínculo.
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-graf-300">
                        Nenhum técnico com o login{' '}
                        <strong className="tabular">{novo.login_toa.trim().toUpperCase()}</strong>
                        {' '}ainda. Ele será <strong>criado</strong> com o nome deste cadastro
                        {novo.equipe_id ? ' e a equipe escolhida' : ' e sem equipe'} — e os
                        contratos que já chegaram com esse login e estão sem técnico passam a
                        apontar para ele.
                      </p>
                    )
                  )}
                  {/* Só faz sentido quando há login E equipe: é o par que
                      define para onde o contrato importado vai. */}
                  {novo.login_toa.trim() && novo.equipe_id && (
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border
                                      border-graf-700 bg-graf-900 px-3 py-2 text-xs text-graf-300">
                      <input type="checkbox" checked={rotearLogin} className="mt-0.5 accent-af-600"
                        onChange={e => setRotearLogin(e.target.checked)} />
                      <span>
                        Rotear os contratos do login{' '}
                        <strong className="tabular">{novo.login_toa.trim().toUpperCase()}</strong>
                        {' '}para a equipe <strong>{rotuloEquipe(novo.equipe_id)}</strong>.
                        <span className="mt-0.5 block text-[11px] text-graf-500">
                          É isto que faz a rota importada cair na equipe. Sem marcar, o
                          contrato vai para <strong>Sem login definido</strong> mesmo com o
                          técnico cadastrado. Vale para as próximas importações e{' '}
                          <strong>move os contratos já importados</strong> deste login,
                          com registro de quem fez.
                        </span>
                      </span>
                    </label>
                  )}
                  <p className="text-xs text-graf-500">
                    O papel vem do perfil de acesso escolhido. A senha é gerada pelo
                    servidor e mostrada uma vez — o sistema nunca guarda senha em texto.
                    O login do TOA <strong>não é obrigatório</strong>: sem ele o acesso é
                    criado do mesmo jeito, só não fica ligado a nenhum técnico.
                  </p>
                  {novo.skill && !skillComFaixa.has(novo.skill) && (
                    <p className="text-xs text-amber-400">
                      <strong>{novo.skill}</strong> ainda não tem meta nem faixa de
                      comissão. O técnico é cadastrado do mesmo jeito, mas o
                      "a receber" dele fica R$ 0 até a tabela existir — cadastre em
                      Produtividade.
                    </p>
                  )}
                  <button onClick={criarUsuario}
                    disabled={ocupado || !novo.nome.trim() || !novo.email.trim()}
                    className="rounded-md bg-af-600 px-5 py-2 text-xs font-medium text-white
                               hover:bg-af-500 disabled:opacity-50">
                    {ocupado ? 'Criando…' : 'Criar acesso'}
                  </button>
                </div>
              )}
            </div>

            <div className="card-controle overflow-hidden">
              {visiveis.length === 0 ? (
                <Vazio titulo="Nenhum usuário" descricao="Crie o primeiro acesso acima." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-graf-800 bg-graf-900 text-left
                                      text-[11px] uppercase tracking-wide text-graf-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Pessoa</th>
                        <th className="px-3 py-2 font-medium">Cargo</th>
                        <th className="px-3 py-2 font-medium">Supervisor</th>
                        <th className="px-3 py-2 font-medium">Perfil de acesso</th>
                        <th className="px-3 py-2 font-medium">Papéis (o que o banco lê)</th>
                        <th className="px-3 py-2 font-medium">Situação</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.map(u => {
                        const ed = editando === u.id
                        const papeis = papeisPorUsuario.get(u.id) ?? []
                        const euMesmo = u.id === perfil?.id
                        return (
                          <tr key={u.id} className="border-b border-graf-800 align-top">
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                {u.nome}
                                {euMesmo && (
                                  <span className="ml-2 rounded bg-graf-800 px-1.5 py-0.5
                                                   text-[10px] text-graf-400">você</span>
                                )}
                              </div>
                              <div className="text-xs text-graf-500">{u.email}</div>
                              {/* Um supervisor tem TÉCNICOS ABAIXO, e a lista
                                  precisava dizer quantos: era a pergunta do
                                  Emanuel — "como eu sei que um supervisor é
                                  pai de um nome de técnico?" (D-132). */}
                              {(() => {
                                const sv = supervisores.find(x => x.usuario_id === u.id)
                                if (!sv) return null
                                return (
                                  <div className="mt-1 text-[11px] text-graf-400">
                                    <span className="rounded bg-af-900/40 px-1.5 py-0.5
                                                     text-[9px] font-semibold uppercase
                                                     text-af-300">supervisor</span>{' '}
                                    <span className="text-graf-300">{sv.supervisor_nome}</span>
                                    <span className="text-graf-500">
                                      {' · '}<strong className="tabular text-graf-300">
                                        {sv.equipes}</strong> equipe(s),{' '}
                                      <strong className="tabular text-graf-300">
                                        {sv.tecnicos}</strong> técnico(s) abaixo
                                    </span>
                                  </div>
                                )
                              })()}
                              {u.tecnico && (() => {
                                const login = u.tecnico.matricula.trim().toUpperCase()
                                const rota = roteamento.get(login)
                                const semEquipe = !u.tecnico.equipe_id
                                const ocupada = chaveOcupada === login
                                return (
                                  <div className="mt-1 space-y-1">
                                    <div className="text-[11px] text-graf-400">
                                      <span className="rounded bg-sky-900/40 px-1.5 py-0.5
                                                       text-[9px] font-semibold uppercase
                                                       text-sky-300">login TOA</span>{' '}
                                      <span className="tabular">{u.tecnico.matricula}</span>
                                      {' · '}{u.tecnico.nome}
                                    </div>

                                    {/* A chave do roteamento, ao lado do técnico. O
                                        estado vem do banco: se há vínculo aberto, ela
                                        está ligada, e diz para qual equipe. */}
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        role="switch" aria-checked={!!rota}
                                        disabled={!souAdmin || ocupada || (!rota && semEquipe)}
                                        onClick={() => alternarRoteamento(u)}
                                        title={rota
                                          ? `Desligar: o contrato deste login volta a cair em "Sem login definido"`
                                          : semEquipe
                                            ? 'O técnico não tem equipe no cadastro — escolha a equipe em Editar primeiro'
                                            : `Ligar: rotear o contrato deste login para a equipe ${
                                                equipeRotulo(u.tecnico.equipe?.codigo,
                                                             u.tecnico.equipe?.nome)}`}
                                        className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full
                                                    transition disabled:opacity-40 ${
                                          rota ? 'bg-emerald-600' : 'bg-graf-700'}`}>
                                        <span className={`ml-0.5 h-4 w-4 rounded-full bg-white
                                                          transition-transform ${
                                          rota ? 'translate-x-4' : 'translate-x-0'}`} />
                                      </button>
                                      <span className="text-[11px] leading-tight">
                                        {ocupada ? (
                                          <span className="text-graf-400">aplicando…</span>
                                        ) : rota ? (
                                          <>
                                            <span className="text-emerald-400">roteando para</span>{' '}
                                            <strong className="text-graf-200">
                                              {equipeRotulo(rota.codigo, rota.nome)}
                                            </strong>
                                          </>
                                        ) : semEquipe ? (
                                          <span className="text-graf-500">
                                            sem roteamento — o técnico não tem equipe
                                          </span>
                                        ) : (
                                          <span className="text-amber-400">
                                            sem roteamento — o contrato dele cai em
                                            {' '}<strong>Sem login definido</strong>
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                )
                              })()}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {ed ? (
                                <select defaultValue={''} className={campo}
                                  onChange={e => setRascunho(r => ({
                                    ...r, cargo_id: e.target.value || null }))}>
                                  <option value="">{u.cargo?.nome ?? '— sem cargo —'}</option>
                                  {cargos.filter(c => c.ativo).map(c =>
                                    <option key={c.id} value={c.id}>{c.nome}</option>)}
                                </select>
                              ) : u.cargo?.nome ?? <span className="text-graf-600">—</span>}
                            </td>
                            {/* ┌─ quem responde por este técnico ───────────┐
                                │ > "no anexo 2 deve ter supervisor            │
                                │ >  responsável ao lado do técnico em uma    │
                                │ >  coluna" — Emanuel                        │
                                │                                             │
                                │ Mostra o DECLARADO (068). Só cai no nome da │
                                │ planilha quando ninguém declarou — e aí diz │
                                │ que é da planilha, para não passar por      │
                                │ alguém desta casa (D-135).                  │
                                └─────────────────────────────────────────────┘ */}
                            <td className="px-3 py-2 text-xs">
                              {u.tecnico ? (
                                u.tecnico.supervisor ? (
                                  <span className="text-graf-300">{u.tecnico.supervisor.nome}</span>
                                ) : u.tecnico.equipe?.supervisor_nome ? (
                                  <span
                                    title="Nome vindo da planilha de equipes — ninguém desta casa foi declarado supervisor dele"
                                    className="text-graf-500">
                                    {u.tecnico.equipe.supervisor_nome}
                                    <span className="ml-1 text-[9px] uppercase tracking-wide
                                                     text-graf-600">da planilha</span>
                                  </span>
                                ) : (
                                  <span className="text-graf-600">sem supervisor</span>
                                )
                              ) : <span className="text-graf-600">—</span>}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {ed ? (
                                <select defaultValue={''} className={campo}
                                  onChange={e => setRascunho(r => ({
                                    ...r, perfil_acesso_id: e.target.value || null }))}>
                                  <option value="">{u.perfil_acesso?.nome ?? '— sem perfil —'}</option>
                                  {perfis.filter(p => p.ativo).map(p =>
                                    <option key={p.id} value={p.id}>{p.nome}</option>)}
                                </select>
                              ) : u.perfil_acesso?.nome ?? <span className="text-graf-600">—</span>}
                            </td>
                            <td className="px-3 py-2">
                              {ed ? (
                                <div className="flex flex-wrap gap-1">
                                  {PAPEIS.map(p => {
                                    const marcado = papeisEdit.includes(p)
                                    return (
                                      <button key={p}
                                        onClick={() => setPapeisEdit(ps =>
                                          marcado ? ps.filter(x => x !== p) : [...ps, p])}
                                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium
                                                    ring-1 ${marcado
                                          ? 'bg-af-600/20 text-af-300 ring-af-600/40'
                                          : 'bg-graf-900 text-graf-500 ring-graf-700'}`}>
                                        {p}
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : papeis.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {papeis.map(p => (
                                    <span key={p} className="rounded bg-graf-800 px-1.5 py-0.5
                                                             text-[10px] text-graf-300">{p}</span>
                                  ))}
                                </div>
                              ) : <span className="text-xs text-af-400/70">sem papel</span>}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => alternarSituacao(u)}
                                disabled={ocupado || euMesmo}
                                title={euMesmo ? 'Você não pode desativar a si mesmo' : ''}
                                className={`rounded px-2 py-0.5 text-[11px] font-medium
                                            disabled:opacity-40 ${u.ativo
                                  ? 'bg-emerald-900/40 text-emerald-300'
                                  : 'bg-graf-800 text-graf-500'}`}>
                                {u.ativo ? 'ativo' : 'inativo'}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {ed ? (
                                <span className="flex justify-end gap-1.5">
                                  <button disabled={ocupado} onClick={() => salvarUsuario(u)}
                                    className="rounded bg-af-600 px-2.5 py-1 text-[11px]
                                               font-medium text-white disabled:opacity-50">
                                    Salvar
                                  </button>
                                  <button onClick={() => { setEditando(null); setRascunho({}) }}
                                    className="rounded border border-graf-700 px-2.5 py-1
                                               text-[11px] text-graf-400">
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <span className="flex justify-end gap-1.5">
                                  {/* A edição virou JANELA: a linha da
                                      tabela alcançava três campos, e o
                                      cadastro tem quinze (D-128). */}
                                  <button
                                    onClick={() => setEditandoJanela(u)}
                                    disabled={!souAdmin}
                                    title={souAdmin ? 'Editar o cadastro inteiro'
                                                    : 'Só ADMIN edita cadastro'}
                                    className="rounded border border-graf-700 px-2.5 py-1
                                               text-[11px] text-graf-400 hover:border-af-600
                                               hover:text-af-400 disabled:opacity-40">
                                    Editar
                                  </button>
                                  <button onClick={() => novaSenha(u)} disabled={ocupado}
                                    className="rounded border border-graf-700 px-2.5 py-1
                                               text-[11px] text-graf-400 hover:border-af-600
                                               hover:text-af-400 disabled:opacity-50">
                                    Nova senha
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="text-xs text-graf-500">
              Usuário não se apaga, se <strong>desativa</strong>: apagar levaria junto a
              autoria de cada baixa, marcador, transferência e exclusão que ele fez. E o
              banco não deixa tirar o último ADMIN ativo — nem você desativar a si mesmo.
            </p>
          </section>
        ) : aba === 'tecnicos' ? (
          /* ┌─ os técnicos vieram de Equipes (D-137) ──────────────────┐
             │ Desligar técnico é CADASTRO, e cadastro mora aqui. Em    │
             │ Equipes o botão ficava ao lado do painel do dia, a um    │
             │ clique de quem está despachando.                          │
             └───────────────────────────────────────────────────────────┘ */
          <section className="card-controle overflow-hidden">
            <TabelaTecnicos
              tecnicos={tecnicos.filter(t => {
                const q = busca.trim().toLowerCase()
                if (!q) return true
                return [t.matricula, t.nome, t.base?.nome, t.equipe?.codigo,
                        t.supervisor?.nome, t.equipe?.supervisor_nome]
                  .some(x => x?.toLowerCase().includes(q))
              })}
              podeEditar={souAdmin || pode('equipes.editar')}
              ocupado={ocupado}
              aoMudarSituacao={mudarSituacaoTecnico} />
          </section>
        ) : aba === 'exclusoes' ? (
          <section className="card-controle overflow-hidden">
            <div className="border-b border-graf-800 px-4 py-3">
              <h2 className="font-medium">Contratos apagados do banco</h2>
              <p className="mt-1 max-w-3xl text-sm text-graf-400">
                Exclusão definitiva não se desfaz — este registro é o que sobra do
                contrato, e existe para o dia em que alguém precisar apurar. Guarda
                quem apagou, quando e por quê. <strong>Não guarda</strong> nome,
                telefone nem endereço do assinante: dado pessoal também sai do banco.
              </p>
              <input value={buscaExc} onChange={e => setBuscaExc(e.target.value)}
                placeholder="Buscar contrato, WO, motivo, quem apagou…"
                className={`${campo} mt-3 w-full`} />
            </div>

            {exclusoes.length === 0 ? (
              <Vazio titulo="Nenhum contrato apagado"
                descricao="Quando alguém apagar um contrato do banco, ele aparece aqui." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-graf-800 bg-graf-900 text-left
                                    text-[11px] uppercase tracking-wide text-graf-400">
                    <tr className="[&>th]:border-r [&>th]:border-graf-500/20
                                   [&>th:last-child]:border-r-0">
                      <th className="px-3 py-2 font-medium">Quando</th>
                      <th className="px-3 py-2 font-medium">Quem apagou</th>
                      <th className="px-3 py-2 font-medium">Contrato</th>
                      <th className="px-3 py-2 font-medium">WO</th>
                      <th className="px-3 py-2 font-medium">Data / Equipe</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                      <th className="px-3 py-2 font-medium">O.S.</th>
                      <th className="px-3 py-2 font-medium">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exclusoes.filter(x => {
                      const t = buscaExc.trim().toLowerCase()
                      if (!t) return true
                      return [x.contrato, x.wo_numero, x.motivo, x.perfil?.nome,
                              x.perfil?.email, x.toa_atividade_id]
                        .some(c => c?.toLowerCase().includes(t))
                    }).map(x => (
                      <tr key={x.id} className="border-b border-graf-500/25
                                                [&>td]:border-r [&>td]:border-graf-500/15
                                                [&>td:last-child]:border-r-0">
                        <td className="tabular whitespace-nowrap px-3 py-2 text-xs">
                          {new Date(x.excluido_em).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {x.perfil?.nome ?? <span className="text-graf-600">—</span>}
                          {x.perfil?.email && (
                            <div className="text-[10px] text-graf-500">{x.perfil.email}</div>
                          )}
                        </td>
                        <td className="tabular px-3 py-2 font-medium">
                          {x.contrato ?? '—'}
                          {x.toa_atividade_id && (
                            <div className="text-[10px] text-graf-600">
                              TOA {x.toa_atividade_id}
                            </div>
                          )}
                        </td>
                        <td className="tabular px-3 py-2 text-xs text-graf-400">
                          {x.wo_numero ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {x.data_agendada
                            ? new Date(x.data_agendada + 'T12:00').toLocaleDateString('pt-BR')
                            : '—'}
                          <div className="text-[10px] text-graf-500">
                            {x.equipe_codigo ?? 'sem equipe'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-400">{x.situacao ?? '—'}</td>
                        <td className="tabular px-3 py-2 text-center text-xs text-graf-400">
                          {x.ordens ?? 0}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-300">{x.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="border-t border-graf-800 px-4 py-2.5 text-xs text-graf-500">
              Últimas 500 exclusões. Só gestor lê esta lista, e ninguém escreve nela pela
              tela — quem grava é a própria função de exclusão.
            </p>
          </section>

        ) : aba === 'perfis' ? (
          <section className="space-y-3">
            {perfis.map(pa => {
              const aberto = perfilAberto === pa.id
              const marcadas = doPerfil.get(pa.id)?.size ?? 0
              return (
                <div key={pa.id} className="card-controle overflow-hidden">
                  <button onClick={() => setPerfilAberto(aberto ? null : pa.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left
                               hover:bg-graf-850">
                    <span className="text-graf-500">{aberto ? '▾' : '▸'}</span>
                    <span className="font-medium">{pa.nome}</span>
                    {pa.papel && (
                      <span className="rounded bg-af-600/15 px-1.5 py-0.5 text-[10px]
                                       font-semibold text-af-300 ring-1 ring-af-600/30">
                        papel {pa.papel}
                      </span>
                    )}
                    <span className="text-xs text-graf-500">{pa.descricao}</span>
                    <span className="tabular ml-auto text-xs text-graf-400">
                      {marcadas} permissões
                    </span>
                  </button>

                  {aberto && (
                    <div className="space-y-4 border-t border-graf-800 px-4 py-3">
                      {porModulo.map(([modulo, lista]) => (
                        <div key={modulo}>
                          <p className="mb-1.5 text-[11px] font-semibold uppercase
                                        tracking-widest text-graf-500">{modulo}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {lista.map(p => {
                              const on = doPerfil.get(pa.id)?.has(p.chave) ?? false
                              return (
                                <button key={p.chave} disabled={ocupado || !p.disponivel}
                                  onClick={() => alternarPermissao(pa, p.chave)}
                                  title={p.disponivel
                                    ? (p.descricao ?? p.chave)
                                    : 'Módulo ainda não construído — a chave fica reservada'}
                                  className={`rounded-md px-2.5 py-1 text-[11px] ring-1 transition
                                              disabled:cursor-not-allowed disabled:opacity-40 ${
                                    on ? 'bg-af-600/20 text-af-300 ring-af-600/40'
                                       : 'bg-graf-900 text-graf-400 ring-graf-700 hover:text-graf-200'}`}>
                                  {on && <span className="mr-1">✓</span>}
                                  {p.rotulo}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] text-graf-600">
                        Marcar aqui não dá acesso sozinho: a policy do banco ainda exige o
                        papel <strong>{pa.papel ?? '—'}</strong>. Permissão restringe,
                        nunca amplia.
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="card-controle p-4">
              <h2 className="text-sm font-semibold">Novo cargo</h2>
              <p className="mt-1 text-xs text-graf-400">
                Cargo é função na empresa (INSTALADOR I, TÉCNICO). Não dá acesso a nada —
                quem dá é o perfil de acesso.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <input value={nomeCargo} onChange={e => setNomeCargo(e.target.value)}
                  placeholder="INSTALADOR III" className={`${campo} w-64`} />
                <button onClick={() => { criarCargo(nomeCargo); setNomeCargo('') }}
                  disabled={ocupado || !nomeCargo.trim()}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Adicionar
                </button>
              </div>
            </div>

            <div className="card-controle overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Cargo</th>
                    <th className="px-3 py-2 text-right font-medium">Pessoas</th>
                    <th className="px-3 py-2 font-medium">Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {cargos.map(c => (
                    <tr key={c.id} className="border-b border-graf-800">
                      <td className="px-3 py-2 font-medium">{c.nome}</td>
                      <td className="tabular px-3 py-2 text-right text-graf-400">
                        {usuarios.filter(u => u.cargo?.nome === c.nome).length}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                          c.ativo ? 'bg-emerald-900/40 text-emerald-300'
                                  : 'bg-graf-800 text-graf-500'}`}>
                          {c.ativo ? 'ativo' : 'inativo'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* ┌─ a senha aparece UMA VEZ, e não pode passar batido ──────────┐
          │ > "pra onde foi a senha do técnico eu nem criei uma"          │
          │ >  — Emanuel                                                  │
          │                                                               │
          │ Ela era um avisinho âmbar no meio da página, logo abaixo do   │
          │ recado verde de "acesso criado" — dois blocos parecidos, e o  │
          │ olho lê o primeiro. Agora é JANELA: interrompe, tem botão de  │
          │ copiar, e só sai com um clique consciente.                    │
          │                                                               │
          │ Não é zelo excessivo: o servidor não guarda senha em texto.   │
          │ Fechar sem anotar significa gerar outra.                      │
          └───────────────────────────────────────────────────────────────┘ */}
      {senhaGerada && (
        <div className="janela-fundo fixed inset-0 z-50 grid place-items-center
                        bg-black/70 p-4 backdrop-blur-sm"
             role="dialog" aria-modal="true" aria-label="Senha temporária">
          <div className="janela-caixa card-controle w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold">Senha de {senhaGerada.email}</h2>
            <p className="mt-1 text-sm text-graf-400">
              Ela aparece <strong className="text-graf-200">uma vez só</strong>. O sistema
              não guarda senha em texto — se esta se perder, o caminho é
              <strong className="text-graf-200"> Nova senha</strong> na lista, que gera outra.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-graf-700
                            bg-graf-900 px-4 py-3">
              <code className="tabular flex-1 select-all text-xl font-semibold text-graf-100">
                {senhaGerada.senha}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(senhaGerada.senha)
                    .then(() => setCopiou(true), () => setCopiou(false))
                }}
                className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                           hover:border-af-600 hover:text-af-400">
                {copiou ? 'copiado' : 'copiar'}
              </button>
            </div>
            <p className="mt-3 text-xs text-graf-500">
              Repasse pessoalmente e peça para trocar no primeiro acesso. Não mande por
              WhatsApp junto com o e-mail de login.
            </p>
            <button onClick={() => { setSenhaGerada(null); setCopiou(false) }}
              className="mt-4 w-full rounded-lg bg-af-600 px-4 py-2 text-sm font-semibold
                         text-white hover:bg-af-500">
              Já anotei
            </button>
          </div>
        </div>
      )}

      {editandoJanela && (
        <EditarUsuarioModal
          usuario={editandoJanela}
          papeisAtuais={papeisPorUsuario.get(editandoJanela.id) ?? []}
          cargos={cargos.filter(c => c.ativo)}
          perfis={perfis.filter(p => p.ativo)}
          operacoes={operacoes}
          equipes={equipes}
          skills={skills}
          supervisores={supervisores}
          papeisPossiveis={PAPEIS}
          onFechar={() => setEditandoJanela(null)}
          onSenha={(email, senha) => setSenhaGerada({ email, senha })}
          onSalvo={async recado => {
            setEditandoJanela(null)
            setOk(recado)
            await recarregar()
          }}
        />
      )}
    </Shell>
  )
}
