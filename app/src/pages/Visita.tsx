import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, type Situacao } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alerta, Pill } from '../components/ui'

interface CodigoBaixa {
  id: string; codigo: number; descricao: string
  natureza: string; responsabilidade: string | null
}
interface OS {
  id: string; sequencia: number; numero_os: string
  status_operadora: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: CodigoBaixa | null
}
interface Detalhe {
  id: string
  cliente_nome: string | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cep: string | null; lat: number | null; lng: number | null
  janela_inicio: string | null; janela_fim: string | null
  situacao: Situacao
  observacao: string | null
  tipo_atividade: { nome: string } | null
  ordem_servico: OS[]
}

const SELECT = `
  id, cliente_nome, logradouro, complemento, bairro, cep, lat, lng,
  janela_inicio, janela_fim, situacao, observacao,
  tipo_atividade:tipo_atividade_id ( nome ),
  ordem_servico (
    id, sequencia, numero_os, status_operadora,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( id, codigo, descricao, natureza, responsabilidade )
  )
`

export default function Visita() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const { perfil } = useAuth()

  const [v, setV] = useState<Detalhe | null>(null)
  const [codigos, setCodigos] = useState<CodigoBaixa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [osAberta, setOsAberta] = useState<string | null>(null)
  const [buscaCod, setBuscaCod] = useState('')

  async function recarregar() {
    const { data, error } = await supabase
      .from('visita').select(SELECT).eq('id', id!).single()
    if (error) setErro(error.message)
    else setV(data as unknown as Detalhe)
  }

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCarregando(true)
      const [dv, dc] = await Promise.all([
        supabase.from('visita').select(SELECT).eq('id', id!).single(),
        supabase.from('codigo_baixa')
          .select('id, codigo, descricao, natureza, responsabilidade')
          .eq('ativo', true).order('codigo'),
      ])
      if (!vivo) return
      if (dv.error) setErro(dv.error.message)
      else setV(dv.data as unknown as Detalhe)
      setCodigos((dc.data ?? []) as CodigoBaixa[])
      setCarregando(false)
    })()
    return () => { vivo = false }
  }, [id])

  /** Toda mudança de situação grava evento com GPS — é o que permite
   *  reconstruir a história da visita depois. */
  async function mudarSituacao(nova: Situacao, rotulo: string) {
    if (!v) return
    setSalvando(true); setErro(null)

    let lat: number | null = null, lng: number | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((ok, falha) =>
        navigator.geolocation.getCurrentPosition(ok, falha, {
          enableHighAccuracy: true, timeout: 8000,
        }))
      lat = pos.coords.latitude; lng = pos.coords.longitude
    } catch {
      // Sem GPS a ação continua. Travar o técnico por causa de sinal
      // de satélite seria pior que registrar sem coordenada.
    }

    const agora = new Date().toISOString()
    const patch: Record<string, unknown> = { situacao: nova, situacao_em: agora }
    if (nova === 'EM_EXECUCAO' && !v.observacao) patch.inicio = agora
    if (nova === 'CONCLUIDA') patch.fim = agora

    const { error } = await supabase.from('visita').update(patch).eq('id', v.id)
    if (error) { setErro(error.message); setSalvando(false); return }

    await supabase.from('visita_evento').insert({
      visita_id: v.id,
      usuario_id: perfil?.id ?? null,
      tipo: rotulo,
      de: { situacao: v.situacao },
      para: { situacao: nova },
      lat, lng,
      origem: 'MOBILE',
    })

    await recarregar()
    setSalvando(false)
  }

  async function darBaixa(os: OS, cod: CodigoBaixa) {
    setSalvando(true); setErro(null)
    const { error } = await supabase
      .from('ordem_servico')
      .update({
        codigo_baixa_id: cod.id,
        status_operadora: cod.natureza === 'SUCESSO' ? 'EXECUTADA' : 'NAO_EXECUTADA',
      })
      .eq('id', os.id)
    if (error) setErro(error.message)
    else {
      await supabase.from('visita_evento').insert({
        visita_id: v!.id, usuario_id: perfil?.id ?? null, tipo: 'BAIXA',
        para: { os: os.numero_os, codigo: cod.codigo, descricao: cod.descricao },
        origem: 'MOBILE',
      })
      await recarregar()
    }
    setOsAberta(null); setBuscaCod(''); setSalvando(false)
  }

  if (carregando) return <p className="sup-campo p-8 text-center text-graf-500">Carregando…</p>
  if (!v) return (
    <div className="sup-campo min-h-screen p-4">
      <Alerta tipo="erro">{erro ?? 'Visita não encontrada.'}</Alerta>
      <Link to="/campo" className="mt-4 inline-block text-af-600 underline">Voltar</Link>
    </div>
  )

  const todasBaixadas = v.ordem_servico.length > 0
    && v.ordem_servico.every(o => o.codigo_baixa)
  const filtrados = codigos.filter(c => {
    const t = buscaCod.trim().toLowerCase()
    if (!t) return true
    return String(c.codigo).includes(t) || c.descricao.toLowerCase().includes(t)
  })

  return (
    <div className="sup-campo min-h-screen pb-40">
      <header className="sticky top-0 z-20 border-b border-graf-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <button onClick={() => navegar('/campo')}
                  className="-ml-2 rounded-lg px-2 py-1 text-2xl leading-none text-graf-500"
                  aria-label="Voltar">‹</button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{v.tipo_atividade?.nome ?? 'Visita'}</p>
            <p className="tabular text-[11px] text-graf-500">
              {v.janela_inicio?.slice(0, 5)}{v.janela_fim && `–${v.janela_fim.slice(0, 5)}`}
            </p>
          </div>
          <Pill situacao={v.situacao} />
        </div>
      </header>

      <main className="space-y-3 px-4 py-4">
        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {/* endereço em destaque — é o que o técnico mais olha */}
        <section className="card-campo p-4">
          <p className="text-lg font-semibold leading-snug">{v.logradouro ?? 'Sem endereço'}</p>
          {v.complemento && <p className="text-graf-600">{v.complemento}</p>}
          <p className="mt-0.5 text-graf-600">
            {v.bairro}{v.cep && ` · ${v.cep}`}
          </p>
          {v.lat && v.lng && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`}
              target="_blank" rel="noopener noreferrer"
              className="toque mt-3 flex items-center justify-center rounded-xl bg-graf-950
                         font-semibold text-white active:scale-[0.99]"
            >
              Abrir rota no mapa
            </a>
          )}
        </section>

        {/* ordens de serviço — D-001 na prática */}
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-graf-600">
            {v.ordem_servico.length} ordem(ns) de serviço
          </h2>

          {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(os => (
            <div key={os.id} className="card-campo overflow-hidden">
              <div className="p-4">
                <div className="flex items-baseline gap-2">
                  <span className="tabular text-xs text-graf-400">#{os.sequencia}</span>
                  <span className="tabular font-semibold">{os.numero_os}</span>
                </div>
                <p className="mt-1 text-sm text-graf-600">
                  {os.tipo_os ? `${os.tipo_os.codigo} · ${os.tipo_os.descricao}` : 'Tipo não informado'}
                </p>

                {os.codigo_baixa ? (
                  <div className={`mt-3 rounded-xl px-3 py-2.5 ${
                    os.codigo_baixa.natureza === 'SUCESSO'
                      ? 'bg-emerald-50 text-emerald-900' : 'bg-af-50 text-af-900'}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                      {os.codigo_baixa.natureza === 'SUCESSO' ? 'Executada' : 'Não executada'}
                    </p>
                    <p className="mt-0.5 text-sm font-medium">
                      {os.codigo_baixa.codigo} · {os.codigo_baixa.descricao}
                    </p>
                    <button
                      onClick={() => setOsAberta(osAberta === os.id ? null : os.id)}
                      className="mt-1.5 text-xs font-medium underline opacity-70">
                      Trocar código
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setOsAberta(osAberta === os.id ? null : os.id)}
                    className="toque mt-3 w-full rounded-xl border-2 border-af-600 font-semibold
                               text-af-700 active:scale-[0.99]">
                    Dar baixa
                  </button>
                )}
              </div>

              {/* seletor de código */}
              {osAberta === os.id && (
                <div className="border-t border-graf-200 bg-graf-50 p-3">
                  <input
                    autoFocus value={buscaCod} onChange={e => setBuscaCod(e.target.value)}
                    placeholder="Buscar por número ou descrição…"
                    className="toque w-full rounded-xl border border-graf-200 bg-white px-3
                               outline-none focus:border-af-500"
                  />
                  <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                    {filtrados.slice(0, 60).map(c => (
                      <button
                        key={c.id} disabled={salvando}
                        onClick={() => darBaixa(os, c)}
                        className="flex w-full items-center gap-2 rounded-lg bg-white px-3 py-2.5
                                   text-left text-sm active:bg-graf-100 disabled:opacity-50">
                        <span className="tabular w-10 shrink-0 font-semibold text-graf-500">
                          {c.codigo}
                        </span>
                        <span className="min-w-0 flex-1">{c.descricao}</span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          c.natureza === 'SUCESSO'
                            ? 'bg-emerald-100 text-emerald-700' : 'bg-af-100 text-af-700'}`}>
                          {c.natureza === 'SUCESSO' ? 'OK' : 'IMPROD'}
                        </span>
                      </button>
                    ))}
                    {filtrados.length === 0 && (
                      <p className="py-6 text-center text-sm text-graf-500">
                        Nenhum código encontrado.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      </main>

      {/* ---------- ações fixas no rodapé: polegar alcança ---------- */}
      <div className="fixed inset-x-0 bottom-0 border-t border-graf-200 bg-white/95 p-3 backdrop-blur">
        <div className="flex gap-2">
          {v.situacao === 'ENTRADA' || v.situacao === 'ATRIBUIDA' ? (
            <button
              disabled={salvando}
              onClick={() => mudarSituacao('EM_DESLOCAMENTO', 'DESLOCAMENTO')}
              className="toque-grande flex-1 rounded-xl bg-graf-950 font-semibold text-white
                         active:scale-[0.99] disabled:opacity-50">
              Estou a caminho
            </button>
          ) : v.situacao === 'EM_DESLOCAMENTO' ? (
            <button
              disabled={salvando}
              onClick={() => mudarSituacao('EM_EXECUCAO', 'CHECKIN')}
              className="toque-grande flex-1 rounded-xl bg-af-600 font-semibold text-white
                         active:scale-[0.99] disabled:opacity-50">
              Cheguei — iniciar
            </button>
          ) : v.situacao === 'EM_EXECUCAO' ? (
            <>
              <button
                disabled={salvando}
                onClick={() => mudarSituacao('COM_IMPEDIMENTO', 'IMPEDIMENTO')}
                className="toque-grande rounded-xl border-2 border-graf-300 px-5 font-semibold
                           text-graf-700 active:scale-[0.99] disabled:opacity-50">
                Impedimento
              </button>
              <button
                disabled={salvando || !todasBaixadas}
                onClick={() => mudarSituacao('CONCLUIDA', 'CONCLUSAO')}
                className="toque-grande flex-1 rounded-xl bg-emerald-600 font-semibold text-white
                           active:scale-[0.99] disabled:opacity-40">
                {todasBaixadas ? 'Finalizar visita' : 'Dê baixa em todas as O.S.'}
              </button>
            </>
          ) : (
            <div className="toque-grande flex flex-1 items-center justify-center rounded-xl
                            bg-graf-50 font-medium text-graf-500">
              Visita encerrada
            </div>
          )}
        </div>
        {salvando && <p className="mt-1.5 text-center text-xs text-graf-500">Salvando…</p>}
      </div>
    </div>
  )
}
