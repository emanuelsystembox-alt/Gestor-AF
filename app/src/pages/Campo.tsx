import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, EM_ABERTO, type Situacao } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alerta, Logo, Pill, Vazio } from '../components/ui'
import { num2, pts, reais } from '../lib/formato'

interface VisitaCard {
  id: string
  contrato: string | null
  cliente_nome: string | null
  logradouro: string | null
  bairro: string | null
  janela_inicio: string | null
  janela_fim: string | null
  situacao: Situacao
  lat: number | null
  lng: number | null
  tipo_atividade: { nome: string; natureza: string } | null
  tipo_servico: { nome: string } | null
  ordem_servico: { id: string; numero_os: string
                   codigo_baixa_afline_id: string | null }[]
}

const hojeISO = () => new Date().toISOString().slice(0, 10)

/** Produção do técnico no mês corrente — a linha dele em
 *  `produtividade_periodo`, que é DEFINER e já filtra pelo escopo. */
interface Producao {
  tecnico_id: string | null
  pontos: number
  concluidas: number
  dias: number
  meta: number | null
  fator: number | null
  valor: number | null
}

function mesCorrente() {
  const h = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return {
    de: iso(new Date(h.getFullYear(), h.getMonth(), 1)),
    ate: iso(new Date(h.getFullYear(), h.getMonth() + 1, 0)),
  }
}

export default function Campo() {
  const { perfil, sair } = useAuth()
  const [data, setData] = useState(hojeISO())
  const [visitas, setVisitas] = useState<VisitaCard[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [mostrarFeitas, setMostrarFeitas] = useState(false)
  const [producao, setProducao] = useState<Producao | null>(null)

  // O técnico vê o mês dele: quanto fez, quanto falta para a meta e
  // quanto isso vale. É a pergunta que ele faz todo dia, e que hoje só
  // era respondida no fim do mês, por outra pessoa.
  useEffect(() => {
    if (!perfil?.tecnico_id) return
    const m = mesCorrente()
    supabase.rpc('produtividade_periodo', { p_de: m.de, p_ate: m.ate })
      .then(({ data }) => {
        const minha = ((data ?? []) as Producao[])
          .find(x => x.tecnico_id === perfil.tecnico_id)
        setProducao(minha ?? null)
      })
  }, [perfil?.tecnico_id])

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase
      .from('visita')
      .select(`
        id, contrato, cliente_nome, logradouro, bairro, janela_inicio, janela_fim,
        situacao, lat, lng,
        tipo_atividade:tipo_atividade_id ( nome, natureza ),
        tipo_servico:tipo_servico_id ( nome ),
        ordem_servico ( id, numero_os, codigo_baixa_afline_id )
      `)
      .is('excluido_em', null)
      .eq('data_agendada', data)
      .order('janela_inicio', { ascending: true, nullsFirst: false })
      .then(({ data: d, error }) => {
        if (!vivo) return
        if (error) setErro(error.message)
        else setVisitas((d ?? []) as unknown as VisitaCard[])
        setCarregando(false)
      })
    return () => { vivo = false }
  }, [data])

  const { abertas, feitas } = useMemo(() => ({
    abertas: visitas.filter(v => EM_ABERTO.includes(v.situacao)),
    feitas: visitas.filter(v => !EM_ABERTO.includes(v.situacao)),
  }), [visitas])

  const lista = mostrarFeitas ? feitas : abertas

  return (
    <div className="sup-campo min-h-screen pb-24">
      {/* barra fina — no celular cada pixel de altura conta */}
      <header className="sticky top-0 z-20 border-b border-graf-200 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Logo tamanho={30} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold">{perfil?.nome ?? 'Técnico'}</div>
            {/* O login aparece aqui porque é ele que vai no histórico de
                cada etapa que o técnico registrar. */}
            <div className="truncate text-[11px] text-graf-500">
              {perfil?.email ?? 'Minha agenda'}
            </div>
          </div>
          <button onClick={sair}
                  className="ml-auto rounded-lg px-3 py-1.5 text-sm text-graf-500 hover:bg-graf-50">
            Sair
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 pb-2.5">
          <input
            type="date" value={data} onChange={e => setData(e.target.value)}
            className="tabular rounded-lg border border-graf-200 px-2.5 py-1.5 text-sm
                       outline-none focus:border-af-500"
          />
          <div className="ml-auto flex rounded-lg bg-graf-50 p-0.5">
            <button
              onClick={() => setMostrarFeitas(false)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                !mostrarFeitas ? 'bg-white shadow-sm' : 'text-graf-500'}`}>
              A fazer <span className="tabular ml-1 opacity-60">{abertas.length}</span>
            </button>
            <button
              onClick={() => setMostrarFeitas(true)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mostrarFeitas ? 'bg-white shadow-sm' : 'text-graf-500'}`}>
              Feitas <span className="tabular ml-1 opacity-60">{feitas.length}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-3 px-4 py-4">
        {erro && <Alerta tipo="erro">Não consegui carregar: {erro}</Alerta>}

        {producao && (() => {
          const p = Number(producao.pontos)
          const alvo = Number(producao.meta ?? 0)
          const pct = alvo > 0 ? Math.min(100, (p / alvo) * 100) : 0
          const falta = Math.max(0, alvo - p)
          return (
            <section className="card-campo p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-graf-600">Minha produção no mês</h2>
                <span className="tabular text-xs text-graf-500">
                  {producao.concluidas} concluída(s) · {producao.dias} dia(s)
                </span>
              </div>

              <div className="mt-2 flex items-end gap-2">
                <span className="tabular text-3xl font-semibold leading-none">
                  {num2(p)}
                </span>
                <span className="pb-0.5 text-sm text-graf-500">
                  de {num2(alvo)} pts
                </span>
              </div>

              <div className="mt-2 h-2 overflow-hidden rounded-full bg-graf-100">
                <div className="h-full rounded-full bg-af-600 transition-all"
                     style={{ width: `${pct}%` }} />
              </div>

              <p className="mt-1.5 text-xs text-graf-600">
                {producao.fator == null
                  ? <>Faltam <strong className="tabular">{pts(falta)}</strong> para
                      entrar na primeira faixa.</>
                  : <>Fator <strong className="tabular">{num2(producao.fator)}</strong> ·
                      a receber{' '}
                      <strong className="tabular text-emerald-700">
                        {reais(producao.valor)}
                      </strong></>}
              </p>
              <p className="mt-1 text-[11px] text-graf-500">
                Só entra contrato concluído. O valor é uma prévia do mês em
                andamento — fecha no fim do período.
              </p>
            </section>
          )
        })()}
        {carregando && <p className="py-10 text-center text-graf-500">Carregando…</p>}

        {!carregando && lista.length === 0 && (
          <Vazio
            titulo={mostrarFeitas ? 'Nada concluído ainda' : 'Nenhuma visita pendente'}
            descricao={mostrarFeitas
              ? 'As visitas que você fechar aparecem aqui.'
              : 'Sua agenda deste dia está limpa.'}
          />
        )}

        {lista.map(v => (
          <Link
            key={v.id} to={`/campo/visita/${v.id}`}
            className="card-campo block px-4 py-3.5 transition active:scale-[0.99]"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  {v.janela_inicio && (
                    <span className="tabular rounded-md bg-graf-50 px-2 py-0.5 text-sm font-semibold">
                      {v.janela_inicio.slice(0, 5)}
                      {v.janela_fim && `–${v.janela_fim.slice(0, 5)}`}
                    </span>
                  )}
                  <Pill situacao={v.situacao} />
                </div>

                <p className="text-base font-semibold leading-snug">
                  {v.tipo_servico?.nome ?? v.tipo_atividade?.nome ?? 'Visita'}
                </p>
                {v.cliente_nome && (
                  <p className="text-sm leading-snug text-graf-600">{v.cliente_nome}</p>
                )}

                {v.logradouro && (
                  <p className="mt-1 text-sm leading-snug text-graf-600">
                    {v.logradouro}
                    {v.bairro && <span className="text-graf-500"> · {v.bairro}</span>}
                  </p>
                )}

                {v.ordem_servico.length > 0 && (() => {
                  // "3 O.S." não diz o que falta fazer. "1 de 3 baixadas" diz.
                  const feitas = v.ordem_servico
                    .filter(o => o.codigo_baixa_afline_id).length
                  const tudo = feitas === v.ordem_servico.length
                  return (
                    <p className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-xs
                                   font-semibold ${tudo
                                     ? 'bg-emerald-50 text-emerald-700'
                                     : 'bg-af-50 text-af-700'}`}>
                      {feitas} de {v.ordem_servico.length} O.S. baixadas
                    </p>
                  )
                })()}
              </div>

              <span aria-hidden className="mt-1 text-2xl leading-none text-graf-300">›</span>
            </div>
          </Link>
        ))}
      </main>
    </div>
  )
}
