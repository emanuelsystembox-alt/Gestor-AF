import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * As permissões DE UM LOGIN, no editar cadastro (157a).
 *
 * > "preciso de uma tela dessa de permissões do que podem fazer, olhar,
 * >  controlar (...) quando for editar algum login tem que ter essas
 * >  opções ou até mais se você pensar melhor" — Emanuel, 30/10
 *
 * ┌─ o que cada caixa quer dizer ─────────────────────────────────────┐
 * │ O PERFIL dá o padrão; cada login pode ter EXCEÇÕES. A caixa       │
 * │ marcada é o que a pessoa PODE de fato (perfil + exceção). Quando   │
 * │ a caixa difere do perfil, a linha ganha a etiqueta "a mais" ou    │
 * │ "tirada" — é isso que fica gravado. Marcar de volta o que o perfil │
 * │ dá não grava exceção: apaga a que havia.                           │
 * │                                                                     │
 * │ O "a mais" do que ele pediu (e da tela de referência):             │
 * │  · etiqueta de origem em cada linha (perfil × exceção), com quem   │
 * │    mudou e quando no passar do mouse;                              │
 * │  · resumo no topo (quantas do perfil, a mais, tiradas);           │
 * │  · "Voltar ao padrão do perfil";                                   │
 * │  · trocar o PERFIL na tela já mostra o padrão do novo perfil,     │
 * │    antes de salvar.                                                │
 * │  · "sem efeito ainda" nas chaves que NADA confere (157c): 12 das   │
 * │    33 em 30/10. Caixa que não muda nada é tela mentindo.           │
 * │ Quem barra é o banco: ninguém mexe nas próprias, só quem tem       │
 * │ `admin.usuarios` mexe nas dos outros, e Administração só o ADMIN.  │
 * └─────────────────────────────────────────────────────────────────────┘
 */

interface Linha {
  chave: string; modulo: string; rotulo: string; descricao: string | null; disponivel: boolean
  do_perfil: boolean; excecao: boolean | null; efetiva: boolean
  definido_por: string | null; definido_em: string | null; alvo_admin: boolean
  /** 157c: alguma função ou policy do banco confere esta chave? */
  em_uso: boolean
}

/** Valor por chave: true dá, false tira, null volta ao perfil. */
export type AlteracoesPermissao = Record<string, boolean | null>

const MODULO: Record<string, string> = {
  SERVICOS: 'Serviços', EQUIPES: 'Equipes', IMPORTACAO: 'Importação', RELATORIOS: 'Relatórios',
  QUALIDADE: 'Qualidade', CAMPO: 'Campo (humor e ocorrências)', CHAT: 'Chat',
  ALMOXARIFADO: 'Almoxarifado', FROTA: 'Frota', CONFIGURACOES: 'Configurações',
  FINANCEIRO: 'Financeiro', ADMINISTRACAO: 'Administração',
}
const ORDEM = Object.keys(MODULO)

export function PermissoesDoLogin({ usuarioId, perfilId, bloqueado, euSouAdmin, aoMudar }: {
  usuarioId: string
  /** O perfil escolhido na tela — pode ainda não estar salvo. */
  perfilId: string | null
  /** Motivo de não poder mexer (ex.: é o próprio login). Nulo = pode. */
  bloqueado: string | null
  /** Só o ADMIN mexe no módulo Administração (o banco recusa os outros). */
  euSouAdmin: boolean
  aoMudar: (a: AlteracoesPermissao) => void
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [quero, setQuero] = useState<Record<string, boolean>>({})
  const [aberto, setAberto] = useState<string | null>('SERVICOS')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('permissoes_do_usuario', { p_usuario: usuarioId, p_perfil: perfilId })
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) { setErro(error.message); setCarregando(false); return }
        const l = (data ?? []) as Linha[]
        setLinhas(l)
        setQuero(Object.fromEntries(l.map(x => [x.chave, x.efetiva])))
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [usuarioId, perfilId])

  const alvoAdmin = linhas[0]?.alvo_admin ?? false

  // O que mudou em relação ao que está gravado, no formato da RPC.
  const alteracoes = useMemo(() => {
    const a: AlteracoesPermissao = {}
    for (const l of linhas) {
      const q = quero[l.chave]
      if (q === undefined) continue
      // O que a caixa diz vira exceção só se difere do perfil.
      const desejada: boolean | null = q === l.do_perfil ? null : q
      if (desejada !== l.excecao) a[l.chave] = desejada
    }
    return a
  }, [linhas, quero])

  useEffect(() => { aoMudar(alteracoes) }, [alteracoes, aoMudar])

  const porModulo = useMemo(() => {
    const m = new Map<string, Linha[]>()
    for (const l of linhas) m.set(l.modulo, [...(m.get(l.modulo) ?? []), l])
    return [...m.entries()].sort((a, b) =>
      (ORDEM.indexOf(a[0]) + 100) % 100 - (ORDEM.indexOf(b[0]) + 100) % 100)
  }, [linhas])

  const resumo = useMemo(() => {
    let perfil = 0, mais = 0, tiradas = 0
    for (const l of linhas) {
      const q = quero[l.chave] ?? l.efetiva
      if (q && l.do_perfil) perfil++
      if (q && !l.do_perfil) mais++
      if (!q && l.do_perfil) tiradas++
    }
    return { perfil, mais, tiradas }
  }, [linhas, quero])

  const travada = !!bloqueado || alvoAdmin
  const podeMexer = (l: Linha) => !travada && l.disponivel
    && (l.modulo !== 'ADMINISTRACAO' || euSouAdmin)

  function alternarModulo(lista: Linha[], valor: boolean) {
    setQuero(q => {
      const n = { ...q }
      for (const l of lista) if (podeMexer(l)) n[l.chave] = valor
      return n
    })
  }

  return (
    <section className="rounded-lg border border-graf-800 bg-graf-900/40">
      <div className="border-b border-graf-800 px-3 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-graf-400">
          Permissões de acesso
        </h3>
        {!carregando && !erro && (
          alvoAdmin ? (
            <p className="mt-1 text-[11px] text-emerald-300">
              Este login é ADMIN: pode tudo. Exceções não se aplicam a ele.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-graf-400">
              <span className="tabular text-graf-200">{resumo.perfil}</span> do perfil
              {resumo.mais > 0 && <> · <span className="tabular text-emerald-300">{resumo.mais}</span> a mais</>}
              {resumo.tiradas > 0 && <> · <span className="tabular text-af-300">{resumo.tiradas}</span> tirada(s)</>}
              {Object.keys(alteracoes).length > 0 && (
                <span className="ml-1 font-semibold text-amber-300">
                  · {Object.keys(alteracoes).length} mudança(s) a salvar
                </span>
              )}
            </p>
          )
        )}
        {!carregando && !erro && linhas.some(l => l.disponivel && !l.em_uso) && (
          <p className="mt-1 text-[11px] leading-snug text-graf-400">
            <span className="text-amber-300">sem efeito ainda</span> = nenhuma tela nem função
            do banco confere essa chave hoje ({linhas.filter(l => l.disponivel && !l.em_uso).length} de{' '}
            {linhas.filter(l => l.disponivel).length}). A escolha fica gravada para quando ela passar a valer.
          </p>
        )}
        {bloqueado && <p className="mt-1 text-[11px] text-amber-300">{bloqueado}</p>}
        {!travada && (resumo.mais > 0 || resumo.tiradas > 0) && (
          <button onClick={() => setQuero(Object.fromEntries(linhas.map(l => [l.chave, l.do_perfil])))}
            className="mt-1.5 text-[11px] text-af-400 underline underline-offset-2">
            Voltar ao padrão do perfil
          </button>
        )}
      </div>

      {carregando ? (
        <p className="px-3 py-6 text-center text-xs text-graf-400">Carregando permissões…</p>
      ) : erro ? (
        <p className="px-3 py-4 text-xs text-af-400">{erro}</p>
      ) : (
        <div className="divide-y divide-graf-800">
          {porModulo.map(([modulo, lista]) => {
            const marcadas = lista.filter(l => quero[l.chave]).length
            const abertoAqui = aberto === modulo
            const todas = lista.filter(podeMexer)
            const tudoMarcado = todas.length > 0 && todas.every(l => quero[l.chave])
            return (
              <div key={modulo}>
                <button onClick={() => setAberto(abertoAqui ? null : modulo)} aria-expanded={abertoAqui}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                    abertoAqui ? 'bg-af-900/30 text-graf-100' : 'text-graf-300 hover:bg-graf-900'}`}>
                  <span className="flex-1 font-medium">{MODULO[modulo] ?? modulo}</span>
                  <span className="tabular text-[11px] text-graf-400">{marcadas}/{lista.length}</span>
                  <span className="text-graf-500">{abertoAqui ? '▾' : '▸'}</span>
                </button>
                {abertoAqui && (
                  <div className="space-y-1 px-3 pb-3 pt-1">
                    {todas.length > 1 && (
                      <label className="flex cursor-pointer items-center gap-2 py-0.5 text-xs font-semibold text-graf-200">
                        <input type="checkbox" checked={tudoMarcado} className="accent-af-600"
                          onChange={e => alternarModulo(lista, e.target.checked)} />
                        Todos
                      </label>
                    )}
                    {lista.map(l => {
                      const q = !!quero[l.chave]
                      const origem = q === l.do_perfil ? null : q ? 'a mais' : 'tirada'
                      const mexe = podeMexer(l)
                      return (
                        <label key={l.chave}
                          title={[
                            l.descricao,
                            !l.disponivel ? 'Ainda não existe no sistema.' : null,
                            l.disponivel && !l.em_uso
                              ? 'Ainda não controla nada: nenhuma tela nem função do banco confere esta permissão. Marcar ou desmarcar fica gravado, mas hoje não muda o que a pessoa pode.'
                              : null,
                            l.modulo === 'ADMINISTRACAO' && !euSouAdmin ? 'Só o ADMIN concede ou tira.' : null,
                            l.excecao != null && l.definido_por
                              ? `Exceção gravada por ${l.definido_por}${l.definido_em ? ' em ' + new Date(l.definido_em).toLocaleDateString('pt-BR') : ''}.`
                              : null,
                          ].filter(Boolean).join(' ')}
                          className={`flex items-center gap-2 py-0.5 text-xs ${mexe ? 'cursor-pointer text-graf-200' : 'text-graf-500'}`}>
                          <input type="checkbox" checked={q || alvoAdmin} disabled={!mexe}
                            className="accent-af-600"
                            onChange={e => setQuero(x => ({ ...x, [l.chave]: e.target.checked }))} />
                          <span className="min-w-0 flex-1">{l.rotulo}</span>
                          {!l.disponivel && <span className="text-[10px] text-graf-500">em breve</span>}
                          {l.disponivel && !l.em_uso && (
                            <span className="rounded px-1 text-[10px] text-amber-300 ring-1 ring-amber-700/50">
                              sem efeito ainda
                            </span>
                          )}
                          {origem && (
                            <span className={`rounded px-1 text-[10px] font-semibold ${
                              origem === 'a mais' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-af-900/40 text-af-300'}`}>
                              {origem}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
