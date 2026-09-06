import { useEffect, useState } from 'react'
import { supabase, SITUACOES } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'

/**
 * Configurações da operação.
 *
 * Duas coisas que no sistema atual são cadastro e aqui viviam no código:
 *
 * - **Status** (`situacao_visita`): rótulo, cor, fundo, ordem e o tempo
 *   de alerta. É a lista que o técnico vê ao baixar o contrato.
 * - **Indicadores de qualidade** (`indicador_qualidade`): O.S DIGITAL,
 *   GEOLOCALIZAÇÃO, CERTIDÃO… com meta e peso. São eles que viram os
 *   **marcadores** que o analista aponta no contrato do técnico.
 *
 * A permissão real é do banco: as duas tabelas só aceitam escrita de
 * quem tem papel ADMIN (migration 025). A tela não é a barreira.
 */

interface Situacao {
  codigo: string; label: string; cor: string; cor_fundo: string | null
  icone: string | null; ordem: number
  em_aberto: boolean; terminal: boolean
  minutos_alerta: number | null; ativo: boolean
}

interface Indicador {
  id: string; nome: string; meta: number; peso: number
  descricao: string | null; ordem: number; ativo: boolean
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs ' +
              'outline-none focus:border-af-500'

export default function Configuracoes() {
  const [aba, setAba] = useState<'status' | 'indicadores'>('status')
  const [situacoes, setSituacoes] = useState<Situacao[]>([])
  const [indicadores, setIndicadores] = useState<Indicador[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // edição
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, unknown>>({})

  // novo indicador
  const [novoNome, setNovoNome] = useState('')
  const [novaMeta, setNovaMeta] = useState('100')
  const [novoPeso, setNovoPeso] = useState('1')

  async function recarregar() {
    setCarregando(true); setErro(null)
    const [s, i] = await Promise.all([
      supabase.from('situacao_visita').select('*').order('ordem'),
      supabase.from('indicador_qualidade').select('*').order('ordem'),
    ])
    if (s.error) setErro(s.error.message)
    else setSituacoes((s.data ?? []) as Situacao[])
    if (i.data) setIndicadores(i.data as Indicador[])
    setCarregando(false)
  }
  useEffect(() => { recarregar() }, [])

  async function salvarSituacao(codigo: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.from('situacao_visita')
      .update(rascunho).eq('codigo', codigo)
    if (error) setErro(traduzir(error.message))
    else { setOk(`Status "${codigo}" atualizado. Recarregue para ver a cor nova nas listas.`)
           setEditando(null); setRascunho({}); await recarregar() }
    setOcupado(false)
  }

  async function salvarIndicador(id: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.from('indicador_qualidade')
      .update(rascunho).eq('id', id)
    if (error) setErro(traduzir(error.message))
    else { setOk('Indicador atualizado.'); setEditando(null); setRascunho({}); await recarregar() }
    setOcupado(false)
  }

  async function criarIndicador() {
    if (!novoNome.trim()) return
    setOcupado(true); setErro(null); setOk(null)
    const { data: emp } = await supabase.from('empresa').select('id').maybeSingle()
    const { error } = await supabase.from('indicador_qualidade').insert({
      empresa_id: (emp as { id: string } | null)?.id ?? null,
      nome: novoNome.trim().toUpperCase(),
      meta: Number(novaMeta) || 100,
      peso: Number(novoPeso) || 1,
      ordem: (indicadores.at(-1)?.ordem ?? 0) + 1,
    })
    if (error) setErro(traduzir(error.message))
    else {
      setOk(`Indicador "${novoNome.trim().toUpperCase()}" criado.`)
      setNovoNome(''); setNovaMeta('100'); setNovoPeso('1')
      await recarregar()
    }
    setOcupado(false)
  }

  async function alternarAtivo(i: Indicador) {
    setOcupado(true); setErro(null)
    const { error } = await supabase.from('indicador_qualidade')
      .update({ ativo: !i.ativo }).eq('id', i.id)
    if (error) setErro(traduzir(error.message))
    else await recarregar()
    setOcupado(false)
  }

  /** Erro de RLS chega como texto do Postgres; vira frase de gente. */
  function traduzir(msg: string): string {
    if (/row-level security|violates|permission denied/i.test(msg))
      return 'Seu usuário não tem papel ADMIN — só ele pode alterar cadastro. ' +
             '(a barreira é do banco, não da tela)'
    return msg
  }

  const semCadastro = SITUACOES.filter(s => !situacoes.some(x => x.codigo === s))

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Configurações</h1>
          <p className="mt-1 max-w-2xl text-sm text-graf-400">
            O que a operação ajusta sem recompilar nada. A permissão de
            escrita é do banco: só papel <strong>ADMIN</strong> grava aqui.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        <div className="flex rounded-lg bg-graf-900 p-0.5">
          {([['status', 'Status', situacoes.length],
             ['indicadores', 'Indicadores de qualidade', indicadores.length]] as const).map(
            ([a, rot, n]) => (
              <button key={a} onClick={() => { setAba(a); setEditando(null) }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
                {rot}<span className="tabular ml-1.5 opacity-60">{n}</span>
              </button>
            ))}
        </div>

        {carregando ? (
          <p className="py-12 text-center text-graf-400">Carregando…</p>
        ) : aba === 'status' ? (
          <section className="card-controle overflow-hidden">
            <div className="border-b border-graf-800 px-4 py-3">
              <h2 className="text-sm font-semibold">Status do atendimento</h2>
              <p className="mt-1 text-xs text-graf-400">
                É a lista que o técnico vê ao baixar o contrato, e a cor que a
                operação inteira usa. <strong>O código não se edita</strong> —
                ele vem do TOA e mudar quebraria a importação.
              </p>
            </div>

            {semCadastro.length > 0 && (
              <div className="px-4 py-3">
                <Alerta tipo="aviso">
                  Situações que o sistema usa e não estão no cadastro:{' '}
                  <strong>{semCadastro.join(', ')}</strong>. Elas aparecem com a cor
                  padrão até serem cadastradas.
                </Alerta>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-800 bg-graf-900 text-left
                                  text-[11px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Código</th>
                    <th className="px-3 py-2 font-medium">Rótulo</th>
                    <th className="px-3 py-2 font-medium">Cor</th>
                    <th className="px-3 py-2 font-medium">Fundo</th>
                    <th className="px-3 py-2 text-right font-medium">Ordem</th>
                    <th className="px-3 py-2 text-right font-medium">Alerta (min)</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {situacoes.map(s => {
                    const ed = editando === s.codigo
                    return (
                      <tr key={s.codigo} className="border-b border-graf-800">
                        <td className="px-3 py-2">
                          <span className="pill text-[10px]"
                                style={{ ['--pill-cor' as string]: s.cor }}>
                            {s.codigo}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {ed ? (
                            <input defaultValue={s.label} className={`${campo} w-40`}
                              onChange={e => setRascunho(r => ({ ...r, label: e.target.value }))} />
                          ) : s.label}
                        </td>
                        <td className="px-3 py-2">
                          {ed ? (
                            <input defaultValue={s.cor} className={`${campo} w-24`}
                              onChange={e => setRascunho(r => ({ ...r, cor: e.target.value }))} />
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block h-3 w-3 rounded"
                                    style={{ background: s.cor }} />
                              <code className="text-xs text-graf-400">{s.cor}</code>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {ed ? (
                            <input defaultValue={s.cor_fundo ?? ''} className={`${campo} w-24`}
                              onChange={e => setRascunho(r => ({ ...r, cor_fundo: e.target.value }))} />
                          ) : s.cor_fundo ? (
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block h-3 w-3 rounded"
                                    style={{ background: s.cor_fundo }} />
                              <code className="text-xs text-graf-400">{s.cor_fundo}</code>
                            </span>
                          ) : <span className="text-graf-600">—</span>}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {ed ? (
                            <input type="number" defaultValue={s.ordem} className={`${campo} w-16 text-right`}
                              onChange={e => setRascunho(r => ({ ...r, ordem: Number(e.target.value) }))} />
                          ) : s.ordem}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {ed ? (
                            <input type="number" defaultValue={s.minutos_alerta ?? ''}
                              className={`${campo} w-16 text-right`}
                              onChange={e => setRascunho(r => ({
                                ...r, minutos_alerta: e.target.value === '' ? null : Number(e.target.value),
                              }))} />
                          ) : s.minutos_alerta ?? <span className="text-graf-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-graf-400">
                          {s.terminal ? 'encerra' : s.em_aberto ? 'em aberto' : 'intermediário'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {ed ? (
                            <span className="flex justify-end gap-1.5">
                              <button disabled={ocupado} onClick={() => salvarSituacao(s.codigo)}
                                className="rounded bg-af-600 px-2.5 py-1 text-[11px] font-medium
                                           text-white hover:bg-af-500 disabled:opacity-50">
                                Salvar
                              </button>
                              <button onClick={() => { setEditando(null); setRascunho({}) }}
                                className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                           text-graf-400">
                                Cancelar
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => { setEditando(s.codigo); setRascunho({}) }}
                              className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                         text-graf-400 hover:border-af-600 hover:text-af-400">
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="space-y-4">
            <div className="card-controle p-4">
              <h2 className="text-sm font-semibold">Novo indicador</h2>
              <p className="mt-1 text-xs text-graf-400">
                O indicador vira um <strong>marcador</strong> disponível para o
                analista apontar no contrato, na tela de Serviços.
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Nome</span>
                  <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                    placeholder="TESTE DE VELOCIDADE" className={`${campo} w-56`} />
                </label>
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Meta</span>
                  <input value={novaMeta} onChange={e => setNovaMeta(e.target.value)}
                    className={`${campo} w-20 text-right`} />
                </label>
                <label className="text-xs text-graf-400">
                  <span className="mb-1 block">Peso</span>
                  <input value={novoPeso} onChange={e => setNovoPeso(e.target.value)}
                    className={`${campo} w-20 text-right`} />
                </label>
                <button onClick={criarIndicador} disabled={ocupado || !novoNome.trim()}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-50">
                  Adicionar
                </button>
              </div>
            </div>

            <div className="card-controle overflow-hidden">
              {indicadores.length === 0 ? (
                <Vazio titulo="Nenhum indicador cadastrado"
                  descricao="Sem indicador não há marcador para o analista apontar." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-graf-800 bg-graf-900 text-left
                                      text-[11px] uppercase tracking-wide text-graf-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Indicador</th>
                        <th className="px-3 py-2 text-right font-medium">Meta</th>
                        <th className="px-3 py-2 text-right font-medium">Peso</th>
                        <th className="px-3 py-2 text-right font-medium">Ordem</th>
                        <th className="px-3 py-2 font-medium">Ativo</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {indicadores.map(i => {
                        const ed = editando === i.id
                        return (
                          <tr key={i.id} className="border-b border-graf-800">
                            <td className="px-3 py-2 font-medium">
                              {ed ? (
                                <input defaultValue={i.nome} className={`${campo} w-56`}
                                  onChange={e => setRascunho(r => ({ ...r, nome: e.target.value }))} />
                              ) : i.nome}
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input defaultValue={i.meta} className={`${campo} w-20 text-right`}
                                  onChange={e => setRascunho(r => ({ ...r, meta: Number(e.target.value) }))} />
                              ) : i.meta}
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input defaultValue={i.peso} className={`${campo} w-20 text-right`}
                                  onChange={e => setRascunho(r => ({ ...r, peso: Number(e.target.value) }))} />
                              ) : i.peso}
                            </td>
                            <td className="tabular px-3 py-2 text-right">
                              {ed ? (
                                <input type="number" defaultValue={i.ordem}
                                  className={`${campo} w-16 text-right`}
                                  onChange={e => setRascunho(r => ({ ...r, ordem: Number(e.target.value) }))} />
                              ) : i.ordem}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => alternarAtivo(i)} disabled={ocupado}
                                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                  i.ativo ? 'bg-emerald-900/40 text-emerald-300'
                                          : 'bg-graf-800 text-graf-500'}`}>
                                {i.ativo ? 'ativo' : 'inativo'}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {ed ? (
                                <span className="flex justify-end gap-1.5">
                                  <button disabled={ocupado} onClick={() => salvarIndicador(i.id)}
                                    className="rounded bg-af-600 px-2.5 py-1 text-[11px] font-medium
                                               text-white hover:bg-af-500 disabled:opacity-50">
                                    Salvar
                                  </button>
                                  <button onClick={() => { setEditando(null); setRascunho({}) }}
                                    className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                               text-graf-400">
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <button onClick={() => { setEditando(i.id); setRascunho({}) }}
                                  className="rounded border border-graf-700 px-2.5 py-1 text-[11px]
                                             text-graf-400 hover:border-af-600 hover:text-af-400">
                                  Editar
                                </button>
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
              Falta combinar: quais indicadores são <strong>exigidos</strong> por tipo de
              serviço, e se o marcador deve ser cumprido/não cumprido em vez de só
              apontado. Nenhuma das duas foi inventada aqui.
            </p>
          </section>
        )}
      </div>
    </Shell>
  )
}
