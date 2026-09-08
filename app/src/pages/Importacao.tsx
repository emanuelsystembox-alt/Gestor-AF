import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { lerPlanilhaTOA, validarPlanilha, contarOS, type ResultadoLeitura } from '../lib/toa'
import { Alerta, Marca } from '../components/ui'

type Fase = 'ocioso' | 'lendo' | 'lida' | 'enviando' | 'pronto'

interface Resumo {
  criadas: number; atualizadas: number; ignoradas: number
  erros: number; conflitos: number; ordens_servico: number
}

/** Uma linha do histórico — o "log" que o sistema atual mostra. */
interface Historico {
  id: string
  arquivo_nome: string | null
  status: string | null
  total_linhas: number | null
  qtd_criadas: number | null
  qtd_atualizadas: number | null
  qtd_erro: number | null
  qtd_conflito: number | null
  criado_em: string
  aplicado_em: string | null
  usuario: { nome: string | null; email: string | null } | null
}

const quando = (ts: string | null) =>
  ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—'

export default function Importacao() {
  const { perfil } = useAuth()
  const navegar = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const [fase, setFase] = useState<Fase>('ocioso')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null)
  const [problemas, setProblemas] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [progresso, setProgresso] = useState('')
  const [arrastando, setArrastando] = useState(false)
  const [historico, setHistorico] = useState<Historico[]>([])

  /** O log de importações: o que subiu, quem subiu, quando e no que deu. */
  async function carregarHistorico() {
    const { data } = await supabase.from('importacao')
      .select(`id, arquivo_nome, status, total_linhas, qtd_criadas, qtd_atualizadas,
               qtd_erro, qtd_conflito, criado_em, aplicado_em,
               usuario:usuario_id ( nome, email )`)
      .order('criado_em', { ascending: false }).limit(30)
    setHistorico((data ?? []) as unknown as Historico[])
  }
  useEffect(() => { carregarHistorico() }, [])

  async function receber(f: File) {
    setErro(null); setResumo(null); setProblemas([])
    setArquivo(f); setFase('lendo')
    try {
      const r = await lerPlanilhaTOA(f)
      setLeitura(r)
      setProblemas(validarPlanilha(r))
      setFase('lida')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler a planilha.')
      setFase('ocioso')
    }
  }

  async function enviar() {
    if (!leitura || !arquivo) return
    setFase('enviando'); setErro(null)
    try {
      const { data: base, error: eb } = await supabase
        .from('base').select('id').eq('codigo', 'MAN').single()
      if (eb || !base) throw new Error('Base MAN não encontrada.')

      setProgresso('Registrando a importação…')
      const { data: imp, error: ei } = await supabase
        .from('importacao')
        .insert({
          base_id: base.id,
          usuario_id: perfil?.id ?? null,
          arquivo_nome: arquivo.name,
          arquivo_path: `manual/${arquivo.name}`,
          fonte: 'TOA',
        })
        .select('id').single()
      if (ei || !imp) throw new Error(ei?.message ?? 'Falha ao registrar a importação.')

      // Em lotes: 349 linhas num único insert estoura o limite da requisição.
      const LOTE = 100
      const linhas = leitura.linhas
      for (let i = 0; i < linhas.length; i += LOTE) {
        const fatia = linhas.slice(i, i + LOTE).map((d, k) => ({
          importacao_id: imp.id,
          numero_linha: i + k + 1,
          dados: d,
        }))
        setProgresso(`Enviando linhas ${i + 1}–${Math.min(i + LOTE, linhas.length)} de ${linhas.length}…`)
        const { error } = await supabase.from('importacao_linha').insert(fatia)
        if (error) throw new Error(`Linha ${i + 1}: ${error.message}`)
      }

      setProgresso('Processando no banco…')
      const { data: res, error: er } = await supabase.rpc('importar_toa', {
        p_importacao_id: imp.id,
      })
      if (er) throw new Error(er.message)

      await supabase.from('importacao')
        .update({ total_linhas: linhas.length }).eq('id', imp.id)

      setResumo(res as Resumo)
      setFase('pronto')
      await carregarHistorico()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha na importação.')
      setFase('lida')
    } finally {
      setProgresso('')
    }
  }

  function limpar() {
    setFase('ocioso'); setArquivo(null); setLeitura(null)
    setResumo(null); setErro(null); setProblemas([])
    if (inputRef.current) inputRef.current.value = ''
  }

  const dist = leitura
    ? leitura.linhas.reduce<Record<number, number>>((a, l) => {
        const n = contarOS(l); a[n] = (a[n] ?? 0) + 1; return a
      }, {})
    : {}
  const totalOS = leitura ? leitura.linhas.reduce((s, l) => s + contarOS(l), 0) : 0

  return (
    <div className="sup-controle min-h-screen">
      <header className="border-b border-graf-800">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-2.5">
          <Marca compacto />
          <nav className="flex items-center gap-1 text-sm">
            <Link to="/controle" className="rounded-md px-2.5 py-1 text-graf-300 hover:bg-graf-800">
              Controle
            </Link>
            <span className="rounded-md bg-graf-800 px-2.5 py-1 font-medium">Importar planilha</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold">Importar planilha do TOA</h1>
          <p className="mt-1 text-sm text-graf-400">
            O arquivo <code className="text-graf-300">Atividades-MAN-AFLINE_*.xlsx</code> exportado
            do sistema da CLARO. Pode subir a mesma planilha várias vezes ao dia:
            a importação atualiza sem duplicar.
          </p>
        </div>

        {/* ---------- área de arquivo ---------- */}
        {fase === 'ocioso' && (
          <div
            onDragOver={e => { e.preventDefault(); setArrastando(true) }}
            onDragLeave={() => setArrastando(false)}
            onDrop={e => {
              e.preventDefault(); setArrastando(false)
              const f = e.dataTransfer.files[0]; if (f) receber(f)
            }}
            className={`rounded-xl border-2 border-dashed px-6 py-14 text-center transition ${
              arrastando ? 'border-af-500 bg-af-900/15' : 'border-graf-700 bg-graf-900'}`}
          >
            <p className="font-medium">Arraste a planilha aqui</p>
            <p className="mt-1 text-sm text-graf-400">ou</p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-3 rounded-lg bg-af-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-af-500"
            >
              Escolher arquivo
            </button>
            <input
              ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) receber(f) }}
            />
            <p className="mt-4 text-xs text-graf-500">
              A planilha é lida no seu navegador. Nada sai daqui antes de você confirmar.
            </p>
          </div>
        )}

        {fase === 'lendo' && <Alerta tipo="info">Lendo a planilha…</Alerta>}

        {/* ---------- prévia ---------- */}
        {leitura && (fase === 'lida' || fase === 'enviando') && (
          <div className="space-y-4">
            <div className="card-controle p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{arquivo?.name}</p>
                  <p className="text-xs text-graf-400">
                    {(arquivo!.size / 1024).toFixed(0)} KB · {leitura.cabecalhos.length} colunas
                  </p>
                </div>
                <button onClick={limpar}
                        className="shrink-0 text-sm text-graf-400 hover:text-af-400">
                  Trocar
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Visitas', leitura.linhas.length],
                  ['O.S. no total', totalOS],
                  ['Descartadas', leitura.descartadas],
                  ['Colunas repetidas', leitura.duplicados.length],
                ].map(([r, v]) => (
                  <div key={r as string} className="rounded-lg bg-graf-900 px-3 py-2.5">
                    <div className="tabular text-xl font-semibold leading-none">{v}</div>
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-graf-400">{r}</div>
                  </div>
                ))}
              </div>

              {/* O TOA exporta com e sem a coluna "Recurso". As duas
                  entram — mas só uma diz o NOME de quem estava logado,
                  e é esse nome que resolve o cadastro do login (D-091). */}
              {(() => {
                const temLogin   = leitura.cabecalhos.includes('Login do Técnico')
                const temRecurso = leitura.cabecalhos.includes('Recurso')
                if (temLogin && temRecurso) return (
                  <p className="mt-3 text-xs text-emerald-400">
                    Traz <strong>Login do Técnico</strong> e <strong>Recurso</strong> —
                    login e nome de quem executou. É o export completo.
                  </p>
                )
                return (
                  <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900
                                  px-3 py-2.5 text-xs">
                    <p className="text-graf-300">
                      {temLogin
                        ? <>Traz o <strong>Login do Técnico</strong>, mas não a coluna{' '}
                            <strong>Recurso</strong> (o nome de quem estava logado).</>
                        : <>Não traz o <strong>Login do Técnico</strong>.</>}
                    </p>
                    <p className="mt-1 text-graf-500">
                      A importação funciona assim mesmo. O que muda é o cadastro:{' '}
                      {temLogin
                        ? 'na tela de Equipes o login aparece sem nome, e alguém tem de saber de cor de quem ele é.'
                        : 'sem login não há como rotear o contrato para equipe nenhuma.'}
                      {' '}No TOA, marque as duas colunas na exportação.
                    </p>
                  </div>
                )
              })()}

              {/* D-013 visível para quem opera */}
              {leitura.duplicados.length > 0 && (
                <div className="mt-3 rounded-lg border border-graf-700 bg-graf-900 px-3 py-2.5 text-xs">
                  <p className="mb-1 font-medium text-graf-200">
                    Colunas de nome repetido tratadas por posição:
                  </p>
                  <p className="text-graf-400">
                    {leitura.duplicados.join(' · ')}
                  </p>
                  <p className="mt-1.5 text-graf-500">
                    O TOA repete "Tipo de Atividade" (categoria e tipo real). Leitor comum
                    perderia a primeira sem avisar — aqui as duas são preservadas.
                  </p>
                </div>
              )}

              <div className="mt-3 text-xs text-graf-400">
                <span className="font-medium text-graf-300">O.S. por visita:</span>{' '}
                {Object.entries(dist).sort((a, b) => +a[0] - +b[0])
                  .map(([n, q]) => `${q}× com ${n}`).join(' · ')}
              </div>
            </div>

            {problemas.length > 0 && (
              <Alerta tipo="aviso">
                <p className="mb-1 font-medium">Confira antes de continuar:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {problemas.map(p => <li key={p}>{p}</li>)}
                </ul>
              </Alerta>
            )}

            {erro && <Alerta tipo="erro">{erro}</Alerta>}

            <div className="flex items-center gap-3">
              <button
                onClick={enviar}
                disabled={fase === 'enviando' || leitura.linhas.length === 0}
                className="toque rounded-lg bg-af-600 px-6 font-semibold text-white
                           hover:bg-af-500 disabled:opacity-50"
              >
                {fase === 'enviando' ? 'Importando…' : `Importar ${leitura.linhas.length} visitas`}
              </button>
              {progresso && <span className="text-sm text-graf-400">{progresso}</span>}
            </div>
          </div>
        )}

        {/* ---------- resultado ---------- */}
        {fase === 'pronto' && resumo && (
          <div className="space-y-4">
            <Alerta tipo="ok">Importação concluída.</Alerta>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ['Criadas', resumo.criadas, 'var(--st-concluida)'],
                ['Atualizadas', resumo.atualizadas, 'var(--st-execucao)'],
                ['O.S. processadas', resumo.ordens_servico, undefined],
                ['Ignoradas', resumo.ignoradas, undefined],
                ['Erros', resumo.erros, resumo.erros ? 'var(--st-conflito)' : undefined],
                ['Conflitos com o TOA', resumo.conflitos,
                  resumo.conflitos ? 'var(--st-reagendamento)' : undefined],
              ].map(([r, v, c]) => (
                <div key={r as string} className="card-controle px-3.5 py-3">
                  <div className="tabular text-2xl font-semibold leading-none"
                       style={c ? { color: c as string } : undefined}>{v as number}</div>
                  <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
                    {r as string}
                  </div>
                </div>
              ))}
            </div>

            {resumo.conflitos > 0 && (
              <Alerta tipo="aviso">
                <p className="font-medium">
                  {resumo.conflitos} visita(s) em que o TOA discorda do que o campo registrou.
                </p>
                <p className="mt-1">
                  O que o técnico registrou foi preservado — o TOA não sobrescreveu.
                  Cada divergência ficou gravada no histórico da visita.
                </p>
              </Alerta>
            )}

            <div className="flex gap-3">
              <button onClick={() => navegar('/controle')}
                      className="toque rounded-lg bg-af-600 px-6 font-semibold text-white hover:bg-af-500">
                Ver as visitas
              </button>
              <button onClick={limpar}
                      className="toque rounded-lg border border-graf-700 px-6 font-medium text-graf-300 hover:bg-graf-800">
                Importar outra
              </button>
            </div>
          </div>
        )}

        {/* ---------- histórico / log ---------- */}
        <section className="card-controle overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-graf-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Histórico de importações</h2>
              <p className="mt-0.5 text-xs text-graf-400">
                O que subiu, quem subiu, quando e no que deu.
              </p>
            </div>
            <button onClick={carregarHistorico}
              className="rounded border border-graf-700 px-2.5 py-1 text-[11px] text-graf-400
                         hover:border-af-600 hover:text-af-400">
              atualizar
            </button>
          </div>

          {historico.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-graf-500">
              Nenhuma importação registrada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Arquivo</th>
                    <th className="px-3 py-2 font-medium">Resultado</th>
                    <th className="px-3 py-2 font-medium">Criação</th>
                    <th className="px-3 py-2 font-medium">Conclusão</th>
                    <th className="px-3 py-2 font-medium">Quem</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map(h => {
                    const concluida = !!h.aplicado_em
                    const comErro = (h.qtd_erro ?? 0) > 0
                    return (
                      <tr key={h.id} className="border-b border-graf-800">
                        <td className="max-w-72 truncate px-3 py-2" title={h.arquivo_nome ?? ''}>
                          {h.arquivo_nome ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-300">
                          {h.total_linhas
                            ? <>
                                <span className="tabular">{h.total_linhas}</span> linhas ·{' '}
                                <span className="tabular text-emerald-400">{h.qtd_criadas ?? 0}</span> novas ·{' '}
                                <span className="tabular text-sky-400">{h.qtd_atualizadas ?? 0}</span> atualizadas
                                {(h.qtd_conflito ?? 0) > 0 && (
                                  <> · <span className="tabular text-amber-400">
                                    {h.qtd_conflito}</span> conflitos</>
                                )}
                                {comErro && (
                                  <> · <span className="tabular text-af-400">{h.qtd_erro}</span> erros</>
                                )}
                              </>
                            : <span className="text-graf-600">sem contagem gravada</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-xs text-graf-400">{quando(h.criado_em)}</td>
                        <td className="tabular px-3 py-2 text-xs text-graf-400">{quando(h.aplicado_em)}</td>
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {h.usuario?.nome ?? h.usuario?.email ?? '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                            comErro ? 'bg-af-900/40 text-af-300'
                            : concluida ? 'bg-emerald-900/40 text-emerald-300'
                            : 'bg-amber-900/40 text-amber-300'}`}>
                            {comErro ? 'Com erro' : concluida ? 'Sucesso' : 'Processando'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
