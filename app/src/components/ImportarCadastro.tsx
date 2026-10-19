import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useCidades } from '../lib/cidade'
import { Alerta } from './ui'
import { equipeRotulo } from '../lib/formato'
import {
  ABAS, baixarModelo, baixarResultado, lerPreenchida, paraOBanco,
  type Catalogos, type PlanilhaLida, type ResultadoPessoa,
} from '../lib/cadastroCidade'

/**
 * Importar o cadastro de uma cidade de uma vez (100, D-176).
 *
 * Os passos, na ordem em que um depende do outro:
 *   1. a cidade (Operação) — ela já existe (Emanuel, 14/10);
 *   2. baixar a planilha padrão, com as listas do cadastro DE HOJE;
 *   3. enviar a preenchida → PRÉVIA: `importar_cadastro_cidade` roda tudo
 *      de verdade e desfaz; a tela mostra linha a linha o que vai acontecer;
 *   4. importar → a mesma função, valendo; depois os ACESSOS, pessoa a
 *      pessoa, pela mesma função do servidor da tela de hoje
 *      (`admin-usuarios`), e o vínculo com técnico e supervisor;
 *   5. a planilha de resultado com as senhas — uma vez só.
 *
 * Linha com problema de formato (CPF, e-mail, data…) fica de fora antes de
 * ir ao banco, e aparece como erro: a importação segue com o resto. A
 * importação de equipes antiga (tela Equipes) grava sempre em Manaus
 * (D-141); esta grava na cidade escolhida.
 */

interface LinhaRel {
  aba: string; linha: number; chave: string | null
  acao: 'NOVO' | 'ATUALIZA' | 'ERRO' | 'SEM_TECNICO'
  acesso?: 'CRIAR' | 'JA_EXISTE' | 'SEM_EMAIL' | 'NAO' | null
  usuario_id?: string | null
  msg?: string | null; aviso?: string | null
}
interface Relatorio { simulado: boolean; cidade: string; linhas: LinhaRel[]; erros: number }

export function ImportarCadastro() {
  const [bases, setBases] = useState<{ id: string; codigo: string; nome: string }[]>([])
  /**
   * A cidade é a ATIVA do topo (103, D-180): desde que `bases_visiveis()`
   * responde só a cidade ativa, `importar_cadastro_cidade` recusa as outras.
   * Um seletor aqui ofereceria cidade que o banco ia recusar no fim.
   */
  const { ativa } = useCidades()
  const [baseId, setBaseId] = useState('')
  useEffect(() => { if (ativa) setBaseId(ativa.id) }, [ativa])
  const [cat, setCat] = useState<Catalogos | null>(null)
  const [lida, setLida] = useState<PlanilhaLida | null>(null)
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [rel, setRel] = useState<Relatorio | null>(null)
  const [aceitaOutraCidade, setAceitaOutraCidade] = useState(false)
  /**
   * Senha inicial IGUAL para todos do lote (Emanuel, 17/10: "a senha coloque
   * um padrão só"). Vazia = o servidor gera uma por pessoa, como antes. Quem
   * digita é quem importa — a senha não fica em lugar nenhum além da conta
   * criada (nem na planilha de resultado).
   */
  const [senhaPadrao, setSenhaPadrao] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const senhaPadraoOk = senhaPadrao === '' || (senhaPadrao.length >= 8 && /\d/.test(senhaPadrao) && /[A-Za-z]/.test(senhaPadrao))
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [final, setFinal] = useState<{ rel: Relatorio; pessoas: ResultadoPessoa[] } | null>(null)
  const [baixouResultado, setBaixouResultado] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('base').select('id, codigo, nome').eq('ativo', true).order('nome')
      .then(({ data }) => setBases((data ?? []) as { id: string; codigo: string; nome: string }[]))
  }, [])

  // Os catálogos da cidade: as listas da planilha e a leitura dependem deles.
  useEffect(() => {
    setCat(null); setLida(null); setRel(null); setFinal(null); setErro(null)
    const b = bases.find(x => x.id === baseId)
    if (!b) return
    let vivo = true
    Promise.all([
      supabase.from('perfil_acesso').select('id, nome, papel').eq('ativo', true).order('ordem'),
      supabase.from('cargo').select('id, nome').eq('ativo', true).order('ordem'),
      supabase.from('skill').select('nome').eq('ativo', true).order('ordem'),
      supabase.from('area_trabalho').select('codigo').eq('base_id', baseId).eq('ativo', true).order('codigo'),
      supabase.from('equipe').select('codigo, nome').eq('base_id', baseId).eq('ativo', true).order('codigo'),
    ]).then(([p, c, s, a, e]) => {
      if (!vivo) return
      setCat({
        cidade: b,
        perfis: (p.data ?? []) as Catalogos['perfis'],
        cargos: (c.data ?? []) as Catalogos['cargos'],
        skills: ((s.data ?? []) as { nome: string }[]).map(x => x.nome),
        areasExistentes: ((a.data ?? []) as { codigo: string }[]).map(x => x.codigo),
        equipesExistentes: ((e.data ?? []) as { codigo: string; nome: string }[])
          .filter(x => x.codigo !== 'SEM-LOGIN').map(x => equipeRotulo(x.codigo, x.nome)),
      })
    })
    return () => { vivo = false }
  }, [baseId, bases])

  // Criando acessos: sair da página no meio perderia as senhas já geradas.
  useEffect(() => {
    if (ocupado !== 'acessos' && !(final && !baixouResultado)) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [ocupado, final, baixouResultado])

  /** Linhas que a tela já recusou (formato) não vão ao banco. */
  const recusadas = useMemo(() => {
    const m = new Set<string>()
    for (const p of lida?.problemas ?? []) m.add(`${p.aba}:${p.linha}`)
    return m
  }, [lida])

  function dadosParaOBanco(l: PlanilhaLida) {
    const fora = (aba: string) => (x: { linha: number }) => !recusadas.has(`${aba}:${x.linha}`)
    const d = paraOBanco(l)
    return {
      areas: d.areas.filter(fora('Áreas')), equipes: d.equipes.filter(fora('Equipes')),
      pessoas: d.pessoas.filter(fora('Pessoas')), veiculos: d.veiculos.filter(fora('Veículos')),
    }
  }

  async function aoEscolherArquivo(f: File) {
    if (!cat) return
    setErro(null); setRel(null); setFinal(null); setAceitaOutraCidade(false)
    setOcupado('lendo'); setNomeArquivo(f.name)
    try {
      const l = await lerPreenchida(f, cat)
      setLida(l)
      await previa(l)
    } catch (e) {
      setLida(null)
      setErro(e instanceof Error ? e.message : 'Não consegui ler a planilha.')
    } finally {
      setOcupado(null)
      if (arquivoRef.current) arquivoRef.current.value = ''
    }
  }

  async function previa(l: PlanilhaLida) {
    setOcupado('previa')
    const { data, error } = await supabase.rpc('importar_cadastro_cidade', {
      p_base: baseId, p_dados: dadosParaOBanco(l), p_simular: true,
    })
    setOcupado(null)
    if (error) { setErro(error.message); return }
    setRel(data as Relatorio)
  }

  async function importar() {
    if (!lida || !cat) return
    setErro(null); setOcupado('importando')
    const { data, error } = await supabase.rpc('importar_cadastro_cidade', {
      p_base: baseId, p_dados: dadosParaOBanco(lida), p_simular: false,
    })
    if (error) { setErro(error.message); setOcupado(null); return }
    const r = data as Relatorio

    // ---- os acessos, pessoa a pessoa (a service_role só existe no servidor) ----
    setOcupado('acessos')
    const resultados: ResultadoPessoa[] = []
    const relPessoas = r.linhas.filter(x => x.aba === 'Pessoas')
    let i = 0
    for (const lr of relPessoas) {
      i++
      setProgresso(`${i} de ${relPessoas.length}`)
      const p = lida.pessoas.find(x => x.linha === lr.linha)
      if (!p) continue
      const perfil = cat.perfis.find(x => x.id === p.perfil_acesso_id)?.nome ?? ''
      const base: Omit<ResultadoPessoa, 'situacao' | 'senha'> = {
        linha: p.linha, nome: String(p.nome), email: String(p.email ?? ''), perfil,
      }
      if (lr.acao === 'ERRO') {
        resultados.push({ ...base, senha: null, situacao: `Não importada: ${lr.msg ?? 'erro'}` })
        continue
      }
      let usuario = lr.usuario_id ?? null
      let senha: string | null = null
      const notas: string[] = []

      if (lr.acesso === 'CRIAR') {
        const { data: c, error: ec } = await supabase.functions.invoke('admin-usuarios', {
          body: {
            acao: 'criar', nome: String(p.nome).trim(), email: String(p.email).trim().toLowerCase(),
            apelido: p.apelido || null, whatsapp: p.whatsapp || null, cpf: p.cpf || null,
            rg: p.rg || null, data_nascimento: p.nascimento || null,
            matricula_ponto: p.matricula_ponto || null,
            cargo_id: p.cargo_id || null, perfil_acesso_id: p.perfil_acesso_id || null,
            // A cidade da planilha, e não a de quem importa.
            base_id: baseId,
            // Com senha padrão, o servidor usa ela; sem, gera uma (e devolve).
            ...(senhaPadrao ? { senha: senhaPadrao } : {}),
          },
        })
        const rc = c as { ok?: boolean; erro?: string; usuario_id?: string; senha_gerada?: string | null; aviso?: string | null } | null
        if (ec || rc?.erro || !rc?.usuario_id) {
          resultados.push({ ...base, senha: null, situacao: `Acesso NÃO criado: ${rc?.erro ?? ec?.message ?? 'erro'}` })
          continue
        }
        usuario = rc.usuario_id
        senha = rc.senha_gerada ?? (senhaPadrao ? '(a senha padrão do lote)' : null)
        notas.push('Acesso criado')
        if (rc.aviso && !rc.aviso.startsWith('Senha temporaria')) notas.push(rc.aviso)
      } else if (lr.acesso === 'JA_EXISTE') {
        notas.push('Já tinha acesso (não alterado)')
      } else if (lr.acesso === 'NAO') {
        notas.push('Sem acesso (Criar acesso = NÃO)')
      } else {
        notas.push('Sem acesso (sem e-mail)')
      }

      if (usuario && p.login_toa) {
        const { data: v, error: ev } = await supabase.rpc('vincular_tecnico_ao_usuario',
          { p_usuario: usuario, p_login_toa: String(p.login_toa) })
        if (ev) notas.push(`Vínculo com o técnico falhou: ${ev.message}`)
        else notas.push(`Ligado ao técnico ${(v as { matricula: string }).matricula}`)
      } else if (p.login_toa) {
        notas.push(`Técnico ${p.login_toa} cadastrado`)
      }
      if (usuario && p.papel === 'SUPERVISOR') {
        const { data: s, error: es } = await supabase.rpc('definir_supervisor_das_equipes',
          { p_usuario: usuario, p_supervisor_nome: String(p.nome) })
        if (es) notas.push(`Vínculo de supervisor falhou: ${es.message}`)
        else notas.push(`Supervisiona ${(s as { equipes: number }).equipes} equipe(s)`)
      }
      if (lr.aviso) notas.push(lr.aviso)
      resultados.push({ ...base, senha, situacao: notas.join(' · ') })
    }
    // Quem a tela recusou por formato também aparece no resultado — ninguém
    // some do relatório sem explicação.
    for (const p of lida.pessoas) {
      if (!recusadas.has(`Pessoas:${p.linha}`)) continue
      const msgs = lida.problemas.filter(x => x.aba === 'Pessoas' && x.linha === p.linha).map(x => x.msg)
      resultados.push({ linha: p.linha, nome: String(p.nome ?? ''), email: String(p.email ?? ''),
                        perfil: '', senha: null, situacao: `Não importada: ${msgs.join(' ')}` })
    }
    resultados.sort((a, b) => a.linha - b.linha)
    setProgresso('')
    setOcupado(null)
    setFinal({ rel: r, pessoas: resultados })
    setBaixouResultado(false)
  }

  const [progresso, setProgresso] = useState('')

  const resumo = useMemo(() => {
    if (!rel || !lida) return null
    const porAba = ABAS.map(a => {
      const ls = rel.linhas.filter(x => x.aba === a.nome)
      const locais = lida.problemas.filter(x => x.aba === a.nome && x.linha > 1)
      return {
        aba: a.nome,
        novos: ls.filter(x => x.acao === 'NOVO').length,
        atualiza: ls.filter(x => x.acao === 'ATUALIZA').length,
        erros: ls.filter(x => x.acao === 'ERRO').length + new Set(locais.map(x => x.linha)).size,
        semTecnico: ls.filter(x => x.acao === 'SEM_TECNICO').length,
      }
    })
    const pes = rel.linhas.filter(x => x.aba === 'Pessoas' && x.acao !== 'ERRO')
    return {
      porAba,
      acessos: {
        criar: pes.filter(x => x.acesso === 'CRIAR').length,
        jaExiste: pes.filter(x => x.acesso === 'JA_EXISTE').length,
        sem: pes.filter(x => x.acesso === 'SEM_EMAIL' || x.acesso === 'NAO').length,
      },
      totalErros: porAba.reduce((s, x) => s + x.erros, 0),
      totalOk: porAba.reduce((s, x) => s + x.novos + x.atualiza + x.semTecnico, 0),
    }
  }, [rel, lida])

  /** Erros e avisos para a tabela da prévia: os da tela e os do banco. */
  const ocorrencias = useMemo(() => {
    const l: { aba: string; linha: number; chave: string; tipo: 'erro' | 'aviso'; msg: string }[] = []
    for (const p of lida?.problemas ?? []) l.push({ aba: p.aba, linha: p.linha, chave: '', tipo: 'erro', msg: p.msg })
    for (const x of rel?.linhas ?? []) {
      if (x.acao === 'ERRO') l.push({ aba: x.aba, linha: x.linha, chave: x.chave ?? '', tipo: 'erro', msg: x.msg ?? '' })
      else if (x.aviso) l.push({ aba: x.aba, linha: x.linha, chave: x.chave ?? '', tipo: 'aviso', msg: x.aviso })
    }
    const ordem = ABAS.map(a => a.nome)
    return l.sort((a, b) => ordem.indexOf(a.aba) - ordem.indexOf(b.aba) || a.linha - b.linha)
  }, [lida, rel])

  const cidadeDiferente = !!(lida?.cidadeCodigo && cat && lida.cidadeCodigo !== cat.cidade.codigo)
  const podeImportar = !!rel && !!resumo && resumo.totalOk > 0 && !ocupado && !final
    && (!cidadeDiferente || aceitaOutraCidade)

  const passo = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-af-600 text-xs font-bold text-white'

  return (
    <section className="card-controle space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold text-graf-100">Importar o cadastro de uma cidade</h2>
        <p className="mt-1 text-sm text-graf-400">
          Áreas, equipes, pessoas (com acesso ao sistema) e veículos, de uma vez, por uma planilha
          padrão. A prévia mostra o que vai acontecer antes de gravar; importar de novo atualiza,
          não duplica.
        </p>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {/* 1 · a cidade */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={passo}>1</span>
        <span className="text-sm text-graf-200">Cidade (Operação):</span>
        <strong className="text-sm text-graf-100">
          {ativa ? `${ativa.nome} (${ativa.codigo})` : 'escolha a cidade no topo da tela'}
        </strong>
        <span className="text-xs text-graf-400">— para outra cidade, troque no seletor do topo.</span>
      </div>

      {/* 2 · a planilha padrão */}
      <div className={`flex flex-wrap items-start gap-3 ${cat ? '' : 'opacity-40'}`}>
        <span className={passo}>2</span>
        <div className="min-w-0 flex-1">
          <button disabled={!cat || !!ocupado}
            onClick={async () => {
              if (!cat) return
              setOcupado('modelo'); setErro(null)
              try { await baixarModelo(cat) } catch (e) { setErro(e instanceof Error ? e.message : 'Falhou ao gerar a planilha.') }
              setOcupado(null)
            }}
            className="rounded-md border border-graf-600 px-3 py-1.5 text-sm font-medium text-graf-100 hover:border-af-500 disabled:cursor-not-allowed">
            {ocupado === 'modelo' ? 'Gerando…' : '⬇ Baixar planilha padrão'}
          </button>
          <p className="mt-1.5 text-xs text-graf-400">
            Já vem com as listas do cadastro de hoje — perfis de acesso, cargos, skills, tipo de veículo —
            e com a explicação de cada coluna. Mande para a cidade preencher.
            {cat && ` Esta cidade já tem ${cat.areasExistentes.length} área(s) e ${cat.equipesExistentes.length} equipe(s).`}
          </p>
        </div>
      </div>

      {/* 3 · a preenchida */}
      <div className={`flex flex-wrap items-start gap-3 ${cat ? '' : 'opacity-40'}`}>
        <span className={passo}>3</span>
        <div className="min-w-0 flex-1">
          <input ref={arquivoRef} type="file" accept=".xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) aoEscolherArquivo(f) }} />
          <button disabled={!cat || !!ocupado} onClick={() => arquivoRef.current?.click()}
            className="rounded-md border border-graf-600 px-3 py-1.5 text-sm font-medium text-graf-100 hover:border-af-500 disabled:cursor-not-allowed">
            {ocupado === 'lendo' || ocupado === 'previa' ? 'Conferindo…' : '⬆ Enviar planilha preenchida'}
          </button>
          {nomeArquivo && <span className="ml-2 text-xs text-graf-400">{nomeArquivo}</span>}
          <p className="mt-1.5 text-xs text-graf-400">
            Nada é gravado agora: o sistema faz a importação de mentira e mostra o resultado.
          </p>
        </div>
      </div>

      {/* a prévia */}
      {rel && resumo && !final && (
        <div className="space-y-3 rounded-lg border border-graf-800 p-4">
          <h3 className="text-sm font-semibold text-graf-100">
            Prévia — {rel.cidade}
          </h3>
          {cidadeDiferente && (
            <Alerta tipo="aviso">
              Esta planilha foi gerada para <strong>{lida?.cidadeCodigo}</strong>, e você escolheu{' '}
              <strong>{cat?.cidade.codigo}</strong>.
              <label className="ml-2 inline-flex items-center gap-1.5">
                <input type="checkbox" checked={aceitaOutraCidade} className="accent-af-600"
                  onChange={e => setAceitaOutraCidade(e.target.checked)} />
                importar em {cat?.cidade.nome} mesmo assim
              </label>
            </Alerta>
          )}
          <div className="grid gap-2 sm:grid-cols-4">
            {resumo.porAba.map(a => (
              <div key={a.aba} className="rounded-md bg-graf-900/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-graf-400">{a.aba}</div>
                <div className="mt-1 text-sm text-graf-100">
                  <span className="tabular font-semibold text-emerald-400">{a.novos}</span> novo(s) ·{' '}
                  <span className="tabular font-semibold text-sky-300">{a.atualiza}</span> atualiza
                  {a.semTecnico > 0 && <> · <span className="tabular">{a.semTecnico}</span> sem técnico</>}
                </div>
                {a.erros > 0 && (
                  <div className="text-xs font-semibold text-af-400">{a.erros} com erro (ficam de fora)</div>
                )}
              </div>
            ))}
          </div>
          <p className="text-sm text-graf-300">
            Acessos: <strong className="text-graf-100">{resumo.acessos.criar}</strong> a criar ·{' '}
            {resumo.acessos.jaExiste} já existem (não são alterados) · {resumo.acessos.sem} sem acesso.
          </p>

          {ocorrencias.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-md border border-graf-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-graf-900 text-left text-graf-400">
                  <tr><th className="px-2 py-1.5">Aba</th><th className="px-2 py-1.5">Linha</th>
                      <th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">O que acontece</th></tr>
                </thead>
                <tbody>
                  {ocorrencias.map((o, i) => (
                    <tr key={i} className="border-t border-graf-800">
                      <td className="px-2 py-1 text-graf-300">{o.aba}</td>
                      <td className="tabular px-2 py-1 text-graf-300">{o.linha}</td>
                      <td className="px-2 py-1 text-graf-200">{o.chave}</td>
                      <td className={`px-2 py-1 ${o.tipo === 'erro' ? 'text-af-300' : 'text-amber-300'}`}>
                        {o.tipo === 'erro' ? 'Erro: ' : 'Aviso: '}{o.msg}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resumo.acessos.criar > 0 && (
            <div className="space-y-1 rounded-md bg-graf-900/60 p-3">
              <label className="block text-sm font-medium text-graf-100" htmlFor="senha-lote">
                Senha inicial para todos os {resumo.acessos.criar} acesso(s) — opcional
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="senha-lote" type={verSenha ? 'text' : 'password'} value={senhaPadrao}
                  autoComplete="new-password" disabled={!!ocupado}
                  onChange={e => setSenhaPadrao(e.target.value)}
                  placeholder="deixe vazio para gerar uma senha por pessoa"
                  className="w-72 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm outline-none focus:border-af-500" />
                <button type="button" onClick={() => setVerSenha(v => !v)}
                  className="text-xs text-graf-400 underline underline-offset-2">{verSenha ? 'esconder' : 'mostrar'}</button>
              </div>
              <p className={`text-xs ${senhaPadraoOk ? 'text-graf-400' : 'text-af-400'}`}>
                {senhaPadraoOk
                  ? (senhaPadrao
                      ? 'Todos entram com esta senha. Peça para cada um trocar no primeiro acesso: senha igual para todos é senha conhecida por todos.'
                      : 'Vazio: o sistema gera uma senha diferente para cada pessoa e mostra no resultado, uma vez.')
                  : 'Mínimo de 8 caracteres, com letra e número.'}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <span className={passo}>4</span>
            <button disabled={!podeImportar || !senhaPadraoOk} onClick={importar}
              className="rounded-md bg-af-600 px-4 py-2 text-sm font-semibold text-white hover:bg-af-500 disabled:opacity-40">
              {ocupado === 'importando' ? 'Importando…'
                : ocupado === 'acessos' ? `Criando acessos ${progresso}…`
                : `Importar ${resumo.totalOk} linha(s)`}
            </button>
            {resumo.totalErros > 0 && (
              <span className="text-xs text-graf-400">
                As {resumo.totalErros} linha(s) com erro ficam de fora. Corrija na planilha e importe de
                novo depois — o que já entrou é atualizado, não duplicado.
              </span>
            )}
          </div>
        </div>
      )}

      {/* o resultado */}
      {final && (
        <div className="space-y-3 rounded-lg border border-emerald-700/50 p-4">
          <h3 className="text-sm font-semibold text-emerald-300">Importado em {final.rel.cidade}</h3>
          <p className="text-sm text-graf-300">
            {final.rel.linhas.filter(x => x.acao !== 'ERRO').length} linha(s) gravadas ·{' '}
            {final.pessoas.filter(p => p.senha).length} acesso(s) criados ·{' '}
            {final.rel.erros} com erro no banco.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className={passo}>5</span>
            <button onClick={async () => { await baixarResultado(final.rel.cidade, final.pessoas); setBaixouResultado(true) }}
              className="rounded-md bg-af-600 px-4 py-2 text-sm font-semibold text-white hover:bg-af-500">
              ⬇ Baixar resultado com as senhas
            </button>
            <span className={`text-xs ${baixouResultado ? 'text-graf-400' : 'font-semibold text-amber-300'}`}>
              {baixouResultado
                ? 'Baixado. Repasse cada senha à sua pessoa e apague o arquivo.'
                : 'As senhas só existem nesta tela: ao sair, não há como vê-las de novo (só gerar outra, pela lista de usuários).'}
            </span>
          </div>
          <div className="max-h-80 overflow-auto rounded-md border border-graf-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-graf-900 text-left text-graf-400">
                <tr><th className="px-2 py-1.5">Linha</th><th className="px-2 py-1.5">Pessoa</th>
                    <th className="px-2 py-1.5">E-mail</th><th className="px-2 py-1.5">Situação</th></tr>
              </thead>
              <tbody>
                {final.pessoas.map(p => (
                  <tr key={p.linha} className="border-t border-graf-800">
                    <td className="tabular px-2 py-1 text-graf-300">{p.linha}</td>
                    <td className="px-2 py-1 text-graf-200">{p.nome}</td>
                    <td className="px-2 py-1 text-graf-300">{p.email || '—'}</td>
                    <td className={`px-2 py-1 ${/NÃO|falhou|Não importada/.test(p.situacao) ? 'text-af-300' : 'text-graf-300'}`}>
                      {p.situacao}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => { setFinal(null); setRel(null); setLida(null); setNomeArquivo('') }}
            disabled={!baixouResultado}
            title={baixouResultado ? '' : 'Baixe o resultado antes: as senhas somem'}
            className="text-xs text-graf-400 underline underline-offset-2 disabled:opacity-40">
            Importar outra planilha
          </button>
        </div>
      )}
    </section>
  )
}
