import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { equipeRotulo } from '../lib/formato'

/**
 * Cercas e garagens (097, D-171).
 *
 * > "podemos configurar isso no mapa, tipo cerca, area 1 - desenhar ela no
 * >  mapa, se ele sair daquilo, deve chegar notificação para o cop e
 * >  gestores que estão conectados ao nosso sistema, então garagem, cerca
 * >  no mapa deve ter de fato" — Emanuel, 27/09
 *
 * Quem desenha decide três coisas, e o sistema não decide nenhuma:
 *   · o polígono (clicando no mapa);
 *   · para quais equipes a cerca vale (todas, ou as escolhidas);
 *   · se avisa ao SAIR e/ou ao ENTRAR. Área nasce avisando ao sair;
 *     garagem nasce sem aviso — só registra a hora em que ele saiu e
 *     voltou (o concorrente trata garagem assim).
 * O "dentro/fora" é conferido no BANCO a cada ponto que chega do celular
 * (`registrar_rastro`), com 2 pontos seguidos para valer a troca.
 */

export interface Cerca {
  id: string
  nome: string
  tipo: 'AREA' | 'GARAGEM'
  poligono: [number, number][]
  cor: string
  alerta_sair: boolean
  alerta_entrar: boolean
  todas_equipes: boolean
  cerca_equipe: { equipe_id: string }[]
}

export interface EdicaoCerca {
  id: string | null
  nome: string
  tipo: 'AREA' | 'GARAGEM'
  cor: string
  alerta_sair: boolean
  alerta_entrar: boolean
  todas: boolean
  equipes: string[]
  pontos: [number, number][]
  /** Muda para o mapa recriar o desenho (desfazer, limpar, começar). */
  chave: number
}

export const CORES_CERCA = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7']

export const SELECT_CERCA =
  'id, nome, tipo, poligono, cor, alerta_sair, alerta_entrar, todas_equipes, cerca_equipe ( equipe_id )'

export function novaEdicao(tipo: 'AREA' | 'GARAGEM'): EdicaoCerca {
  return {
    id: null, nome: '', tipo, cor: tipo === 'AREA' ? CORES_CERCA[0] : CORES_CERCA[2],
    alerta_sair: tipo === 'AREA', alerta_entrar: false,
    todas: true, equipes: [], pontos: [], chave: Date.now(),
  }
}

export function edicaoDe(c: Cerca): EdicaoCerca {
  return {
    id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor,
    alerta_sair: c.alerta_sair, alerta_entrar: c.alerta_entrar,
    todas: c.todas_equipes, equipes: c.cerca_equipe.map(x => x.equipe_id),
    pontos: c.poligono, chave: Date.now(),
  }
}

export function PainelCercas({ cercas, editando, setEditando, aoSalvar, temMapa }: {
  cercas: Cerca[]
  editando: EdicaoCerca | null
  setEditando: (e: EdicaoCerca | null | ((a: EdicaoCerca | null) => EdicaoCerca | null)) => void
  aoSalvar: () => void
  temMapa: boolean
}) {
  const [equipes, setEquipes] = useState<{ id: string; codigo: string; nome: string }[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    supabase.from('equipe').select('id, codigo, nome').eq('ativo', true).order('codigo')
      .then(({ data }) => setEquipes(((data ?? []) as { id: string; codigo: string; nome: string }[])
        .filter(e => e.codigo !== 'SEM-LOGIN')))
  }, [])

  const nomeEquipe = (id: string) => {
    const e = equipes.find(x => x.id === id)
    return e ? equipeRotulo(e.codigo, e.nome) : '—'
  }

  async function salvar() {
    if (!editando) return
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('salvar_cerca', {
      p_id: editando.id, p_nome: editando.nome, p_tipo: editando.tipo,
      p_poligono: editando.pontos, p_cor: editando.cor,
      p_alerta_sair: editando.alerta_sair, p_alerta_entrar: editando.alerta_entrar,
      p_equipes: editando.todas ? [] : editando.equipes,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setEditando(null)
    aoSalvar()
  }

  async function arquivar(c: Cerca) {
    if (!confirm(`Arquivar "${c.nome}"? Ela sai do mapa e para de avisar. Os eventos antigos continuam no histórico.`)) return
    const { error } = await supabase.rpc('arquivar_cerca', { p_id: c.id })
    if (error) setErro(error.message)
    else aoSalvar()
  }

  const mudar = <K extends keyof EdicaoCerca>(k: K, v: EdicaoCerca[K]) =>
    setEditando(e => e ? { ...e, [k]: v } : e)

  return (
    <section className="card-controle sobe p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-graf-400">
          Cercas e garagens
        </h3>
        <span className="text-[11px] text-graf-400">
          {cercas.length} ativa(s) · conferidas a cada ponto do celular
        </span>
        {!editando && (
          <span className="ml-auto flex gap-2">
            <button disabled={!temMapa} onClick={() => setEditando(novaEdicao('AREA'))}
              className="rounded-md bg-af-600 px-3 py-1 text-xs font-semibold text-white hover:bg-af-500 disabled:opacity-40">
              + Nova área
            </button>
            <button disabled={!temMapa} onClick={() => setEditando(novaEdicao('GARAGEM'))}
              className="rounded-md border border-graf-700 px-3 py-1 text-xs text-graf-200 hover:border-af-600 disabled:opacity-40">
              + Nova garagem
            </button>
          </span>
        )}
      </div>
      {!temMapa && (
        <p className="mt-2 text-xs text-amber-400">
          Desenhar cerca precisa do mapa do Google, que não carregou nesta tela.
        </p>
      )}
      {erro && <p className="mt-2 text-xs text-af-400">{erro}</p>}

      {editando ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <p className="rounded-md bg-sky-900/30 px-3 py-2 text-xs leading-relaxed text-sky-200">
              <strong>Clique no mapa</strong> para marcar os cantos ({editando.pontos.length} até agora,
              mínimo 3). Arraste um canto para ajustar; <strong>botão direito</strong> num canto apaga.
            </p>
            <label className="block text-[11px] text-graf-400">
              Nome
              <input value={editando.nome} maxLength={60} onChange={e => mudar('nome', e.target.value)}
                placeholder={editando.tipo === 'AREA' ? 'Ex.: Área 1 — Zona Norte' : 'Ex.: Garagem da base'}
                className="mt-1 w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm
                           text-graf-100 outline-none focus:border-af-500" />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-graf-400">Tipo:</span>
              {(['AREA', 'GARAGEM'] as const).map(t => (
                <label key={t} className="flex items-center gap-1.5 text-graf-200">
                  <input type="radio" checked={editando.tipo === t} className="accent-af-600"
                    onChange={() => mudar('tipo', t)} />
                  {t === 'AREA' ? 'Área de trabalho' : 'Garagem'}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-graf-400">Cor:</span>
              {CORES_CERCA.map(c => (
                <button key={c} onClick={() => mudar('cor', c)} aria-label={`cor ${c}`}
                  className={`h-5 w-5 rounded-full ${editando.cor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-graf-900' : ''}`}
                  style={{ background: c }} />
              ))}
            </div>
            <div className="space-y-1 text-xs text-graf-200">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-af-600" checked={editando.alerta_sair}
                  onChange={e => mudar('alerta_sair', e.target.checked)} />
                Avisar a central quando o técnico <strong>SAIR</strong>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-af-600" checked={editando.alerta_entrar}
                  onChange={e => mudar('alerta_entrar', e.target.checked)} />
                Avisar a central quando o técnico <strong>ENTRAR</strong>
              </label>
              <p className="text-[10px] text-graf-400">
                Sem aviso, a entrada e a saída ficam só registradas na linha do dia do técnico.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-graf-200">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-af-600" checked={editando.todas}
                  onChange={e => mudar('todas', e.target.checked)} />
                Vale para <strong>todas as equipes</strong> da base
              </label>
            </div>
            {!editando.todas && (
              <div className="max-h-44 overflow-y-auto rounded-md border border-graf-800 p-2">
                {equipes.map(eq => (
                  <label key={eq.id} className="flex items-center gap-2 py-0.5 text-xs text-graf-200">
                    <input type="checkbox" className="accent-af-600"
                      checked={editando.equipes.includes(eq.id)}
                      onChange={e => mudar('equipes', e.target.checked
                        ? [...editando.equipes, eq.id]
                        : editando.equipes.filter(x => x !== eq.id))} />
                    {equipeRotulo(eq.codigo, eq.nome)}
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={salvar}
                disabled={salvando || editando.pontos.length < 3 || !editando.nome.trim()
                          || (!editando.todas && editando.equipes.length === 0)}
                className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-af-500 disabled:opacity-40">
                {salvando ? 'Salvando…' : 'Salvar cerca'}
              </button>
              <button disabled={editando.pontos.length === 0}
                onClick={() => setEditando(e => e ? { ...e, pontos: e.pontos.slice(0, -1), chave: Date.now() } : e)}
                className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-200 disabled:opacity-40">
                Desfazer último canto
              </button>
              <button disabled={editando.pontos.length === 0}
                onClick={() => setEditando(e => e ? { ...e, pontos: [], chave: Date.now() } : e)}
                className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-200 disabled:opacity-40">
                Recomeçar desenho
              </button>
              <button onClick={() => { setEditando(null); setErro(null) }}
                className="rounded-md px-3 py-1.5 text-xs text-graf-400 hover:text-graf-100">
                Cancelar
              </button>
            </div>
            {editando.id && (
              <p className="text-[10px] text-graf-400">
                Salvar recomeça o "dentro/fora" de todos a partir do próximo ponto — sem alerta
                falso por causa do redesenho.
              </p>
            )}
          </div>
        </div>
      ) : cercas.length === 0 ? (
        <p className="mt-2 text-xs text-graf-400">
          Nenhuma cerca ainda. Desenhe a área de trabalho de uma equipe para a central ser avisada
          quando alguém sair dela, ou a garagem para registrar a saída e a volta.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {cercas.map(c => (
            <li key={c.id} className="rounded-md border border-graf-800 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.cor }} />
                <span className="truncate text-sm font-medium text-graf-100">{c.nome}</span>
                <span className="ml-auto rounded bg-graf-800 px-1.5 text-[10px] uppercase text-graf-300">
                  {c.tipo === 'AREA' ? 'área' : 'garagem'}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-graf-400">
                {c.alerta_sair || c.alerta_entrar
                  ? `avisa ao ${[c.alerta_sair && 'sair', c.alerta_entrar && 'entrar'].filter(Boolean).join(' e ')}`
                  : 'só registra, sem aviso'}
                {' · '}
                {c.todas_equipes ? 'todas as equipes'
                  : c.cerca_equipe.map(x => nomeEquipe(x.equipe_id)).join(', ')}
              </div>
              <div className="mt-1.5 flex gap-3 text-[11px]">
                <button disabled={!temMapa} onClick={() => setEditando(edicaoDe(c))}
                  className="text-af-400 underline underline-offset-2 disabled:opacity-40">editar</button>
                <button onClick={() => arquivar(c)}
                  className="text-graf-400 underline underline-offset-2 hover:text-graf-100">arquivar</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
