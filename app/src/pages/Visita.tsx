import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, SITUACAO_INFO, type Situacao } from '../lib/supabase'
import { rotuloEvento } from '../lib/eventos'
import { Alerta, Pill } from '../components/ui'

/**
 * A visita na mão do técnico.
 *
 * ┌─ O QUE MUDOU E POR QUÊ ──────────────────────────────────────────┐
 * │ Antes esta tela dava UPDATE na visita e INSERT no evento por      │
 * │ conta própria, mandando o `usuario_id` junto. Autor que vem do    │
 * │ cliente não é prova de nada — e o histórico existe para ser       │
 * │ prova. Agora quem carimba quem fez, com qual login e de onde é o  │
 * │ banco: `registrar_etapa` e `baixar_os` (migration 032).           │
 * │                                                                   │
 * │ A baixa que o técnico dá é a da AFLINE, não a da operadora. A da  │
 * │ operadora vem do TOA e não se edita (D-042) — a tela mostra as    │
 * │ duas lado a lado justamente para a diferença ficar visível.       │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Superfície CAMPO (D-011): clara, alvo de toque grande, uma coluna.
 * É usada no sol, com uma mão, às vezes de luva.
 */

interface CodigoBaixa {
  id: string; codigo: number; descricao: string
  natureza: string; responsabilidade: string | null
}
interface SubFalha { id: string; nome: string }
interface OS {
  id: string; sequencia: number; numero_os: string
  descricao: string | null
  status_operadora: string | null
  baixa_observacao: string | null
  tipo_os: { codigo: number; descricao: string } | null
  codigo_baixa: CodigoBaixa | null
  baixa_afline: CodigoBaixa | null
  sub_falha: { nome: string } | null
}
interface Evento {
  id: number; tipo: string; criado_em: string
  login: string | null; observacao: string | null
  para: Record<string, unknown> | null
}
interface Detalhe {
  id: string
  contrato: string | null
  cliente_nome: string | null
  telefones: string[] | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cep: string | null; lat: number | null; lng: number | null
  janela_inicio: string | null; janela_fim: string | null
  situacao: Situacao
  observacao: string | null
  tipo_atividade: { nome: string } | null
  tipo_servico: { nome: string } | null
  ordem_servico: OS[]
}

const SELECT = `
  id, contrato, cliente_nome, telefones,
  logradouro, complemento, bairro, cep, lat, lng,
  janela_inicio, janela_fim, situacao, observacao,
  tipo_atividade:tipo_atividade_id ( nome ),
  tipo_servico:tipo_servico_id ( nome ),
  ordem_servico (
    id, sequencia, numero_os, descricao, status_operadora, baixa_observacao,
    tipo_os:tipo_os_id ( codigo, descricao ),
    codigo_baixa:codigo_baixa_id ( id, codigo, descricao, natureza, responsabilidade ),
    baixa_afline:codigo_baixa_afline_id ( id, codigo, descricao, natureza, responsabilidade ),
    sub_falha:sub_falha_id ( nome )
  )
`

const hora = (ts: string) =>
  new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** GPS é bom ter, não é condição. Travar o técnico por causa de sinal
 *  de satélite seria pior que registrar sem coordenada. */
async function posicao(): Promise<{ lat: number | null; lng: number | null }> {
  try {
    const p = await new Promise<GeolocationPosition>((ok, falha) =>
      navigator.geolocation.getCurrentPosition(ok, falha, {
        enableHighAccuracy: true, timeout: 8000,
      }))
    return { lat: p.coords.latitude, lng: p.coords.longitude }
  } catch {
    return { lat: null, lng: null }
  }
}

export default function Visita() {
  const { id } = useParams<{ id: string }>()
  const navegar = useNavigate()

  const [v, setV] = useState<Detalhe | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [codigos, setCodigos] = useState<CodigoBaixa[]>([])
  const [conjunto, setConjunto] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // baixa
  const [osAberta, setOsAberta] = useState<string | null>(null)
  const [buscaCod, setBuscaCod] = useState('')
  const [codEscolhido, setCodEscolhido] = useState<CodigoBaixa | null>(null)
  const [subFalhas, setSubFalhas] = useState<SubFalha[]>([])
  const [subSel, setSubSel] = useState('')
  const [obsBaixa, setObsBaixa] = useState('')

  // impedimento
  const [pedindoObs, setPedindoObs] = useState(false)
  const [obsEtapa, setObsEtapa] = useState('')

  async function recarregar() {
    const [dv, de] = await Promise.all([
      supabase.from('visita').select(SELECT).eq('id', id!).single(),
      supabase.from('visita_evento')
        .select('id, tipo, criado_em, login, observacao, para')
        .eq('visita_id', id!).order('criado_em', { ascending: false }),
    ])
    if (dv.error) setErro(dv.error.message)
    else setV(dv.data as unknown as Detalhe)
    setEventos((de.data ?? []) as unknown as Evento[])
  }

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCarregando(true)
      const [dc, dm] = await Promise.all([
        supabase.from('codigo_baixa')
          .select('id, codigo, descricao, natureza, responsabilidade')
          .eq('ativo', true).order('codigo'),
        supabase.from('empresa').select('conjunto_sub_falha').limit(1).maybeSingle(),
      ])
      if (!vivo) return
      setCodigos((dc.data ?? []) as CodigoBaixa[])
      setConjunto((dm.data as { conjunto_sub_falha: string | null } | null)
        ?.conjunto_sub_falha ?? null)
      await recarregar()
      if (vivo) setCarregando(false)
    })()
    return () => { vivo = false }
  }, [id])

  // Os dois conjuntos de sub-falha convivem no banco; só um vale. Sem
  // filtrar pelo vigente, a lista vem em dobro.
  useEffect(() => {
    setSubSel('')
    if (!codEscolhido) { setSubFalhas([]); return }
    let q = supabase.from('sub_falha').select('id, nome').eq('codigo', codEscolhido.codigo)
    if (conjunto) q = q.eq('conjunto', conjunto)
    q.order('ordem').then(({ data }) => setSubFalhas((data ?? []) as SubFalha[]))
  }, [codEscolhido, conjunto])

  async function etapa(nova: Situacao, observacao?: string) {
    if (!v) return
    setSalvando(true); setErro(null)
    const { lat, lng } = await posicao()
    const { error } = await supabase.rpc('registrar_etapa', {
      p_visita: v.id, p_situacao: nova,
      p_observacao: observacao?.trim() || null, p_lat: lat, p_lng: lng,
    })
    if (error) setErro(error.message)
    else { setPedindoObs(false); setObsEtapa(''); await recarregar() }
    setSalvando(false)
  }

  async function confirmarBaixa(osId: string) {
    if (!codEscolhido) return
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('baixar_os', {
      p_os: osId, p_codigo: codEscolhido.codigo,
      p_sub_falha: subSel || null,
      p_observacao: obsBaixa.trim() || null, p_situacao: null,
    })
    if (error) setErro(error.message)
    else {
      setOsAberta(null); setBuscaCod(''); setCodEscolhido(null)
      setSubSel(''); setObsBaixa('')
      await recarregar()
    }
    setSalvando(false)
  }

  function abrir(osId: string) {
    setOsAberta(osAberta === osId ? null : osId)
    setBuscaCod(''); setCodEscolhido(null); setSubSel(''); setObsBaixa('')
  }

  if (carregando) return <p className="sup-campo p-8 text-center text-graf-500">Carregando…</p>
  if (!v) return (
    <div className="sup-campo min-h-screen p-4">
      <Alerta tipo="erro">{erro ?? 'Visita não encontrada.'}</Alerta>
      <Link to="/campo" className="mt-4 inline-block text-af-600 underline">Voltar</Link>
    </div>
  )

  // A visita só fecha quando toda O.S. tem a baixa da AFLINE. Sem isso
  // o serviço fica "concluído" sem ninguém saber o que foi feito.
  const todasBaixadas = v.ordem_servico.length > 0
    && v.ordem_servico.every(o => o.baixa_afline)
  const faltam = v.ordem_servico.filter(o => !o.baixa_afline).length

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
            <p className="truncate text-sm font-semibold">
              {v.tipo_servico?.nome ?? v.tipo_atividade?.nome ?? 'Visita'}
            </p>
            <p className="tabular text-[11px] text-graf-500">
              {v.contrato && `contrato ${v.contrato} · `}
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
          {v.cliente_nome && (
            <p className="mb-1 text-sm font-medium text-graf-600">{v.cliente_nome}</p>
          )}
          <p className="text-lg font-semibold leading-snug">{v.logradouro ?? 'Sem endereço'}</p>
          {v.complemento && <p className="text-graf-600">{v.complemento}</p>}
          <p className="mt-0.5 text-graf-600">
            {v.bairro}{v.cep && ` · ${v.cep}`}
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {v.lat && v.lng && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`}
                target="_blank" rel="noopener noreferrer"
                className="toque flex items-center justify-center rounded-xl bg-graf-950
                           font-semibold text-white active:scale-[0.99]"
              >
                Abrir rota no mapa
              </a>
            )}
            {/* Ligar antes de sair evita a visita improdutiva mais comum:
                cliente ausente. O número já está aqui — usar. */}
            {(v.telefones ?? []).slice(0, 2).map(t => (
              <a key={t} href={`tel:${t.replace(/\D/g, '')}`}
                className="toque flex items-center justify-center rounded-xl border-2
                           border-graf-300 font-semibold active:scale-[0.99]">
                Ligar para {t}
              </a>
            ))}
          </div>
        </section>

        {/* ordens de serviço — D-001 na prática */}
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-graf-600">
            {v.ordem_servico.length} ordem(ns) de serviço
            {faltam > 0 && <span className="ml-1 font-normal text-af-700">
              · {faltam} sem baixa</span>}
          </h2>

          {[...v.ordem_servico].sort((a, b) => a.sequencia - b.sequencia).map(os => (
            <div key={os.id} className="card-campo overflow-hidden">
              <div className="p-4">
                <div className="flex items-baseline gap-2">
                  <span className="tabular text-xs text-graf-400">#{os.sequencia}</span>
                  <span className="tabular font-semibold">{os.numero_os}</span>
                </div>
                <p className="mt-1 text-sm font-medium leading-snug">
                  {os.descricao ?? os.tipo_os?.descricao ?? 'Serviço não descrito'}
                </p>

                {/* A baixa da operadora é leitura: veio do TOA (D-042). */}
                {os.codigo_baixa && (
                  <p className="mt-2 text-xs text-graf-500">
                    Operadora (TOA): {os.codigo_baixa.codigo} · {os.codigo_baixa.descricao}
                  </p>
                )}

                {os.baixa_afline ? (
                  <div className={`mt-3 rounded-xl px-3 py-2.5 ${
                    os.baixa_afline.natureza === 'SUCESSO'
                      ? 'bg-emerald-50 text-emerald-900' : 'bg-af-50 text-af-900'}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
                      {os.baixa_afline.natureza === 'SUCESSO' ? 'Executada' : 'Não executada'}
                    </p>
                    <p className="mt-0.5 text-sm font-medium">
                      {os.baixa_afline.codigo} · {os.baixa_afline.descricao}
                    </p>
                    {os.sub_falha && (
                      <p className="mt-0.5 text-xs opacity-80">{os.sub_falha.nome}</p>
                    )}
                    {os.baixa_observacao && (
                      <p className="mt-0.5 text-xs opacity-70">{os.baixa_observacao}</p>
                    )}
                    <button onClick={() => abrir(os.id)}
                      className="mt-1.5 text-xs font-medium underline opacity-70">
                      Trocar código
                    </button>
                  </div>
                ) : (
                  <button onClick={() => abrir(os.id)}
                    className="toque mt-3 w-full rounded-xl border-2 border-af-600 font-semibold
                               text-af-700 active:scale-[0.99]">
                    Dar baixa
                  </button>
                )}
              </div>

              {/* seletor de código → sub-falha → observação */}
              {osAberta === os.id && (
                <div className="border-t border-graf-200 bg-graf-50 p-3">
                  {!codEscolhido ? (
                    <>
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
                            onClick={() => setCodEscolhido(c)}
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
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5">
                        <span className="tabular font-semibold text-graf-500">
                          {codEscolhido.codigo}
                        </span>
                        <span className="min-w-0 flex-1 text-sm">{codEscolhido.descricao}</span>
                        <button onClick={() => setCodEscolhido(null)}
                          className="text-xs font-medium text-af-700 underline">trocar</button>
                      </div>

                      {subFalhas.length > 0 && (
                        <div className="mt-2">
                          <p className="mb-1 text-xs font-medium text-graf-600">
                            Qual foi o motivo?
                          </p>
                          <div className="max-h-56 space-y-1 overflow-y-auto">
                            {subFalhas.map(s => (
                              <button key={s.id} onClick={() => setSubSel(s.id)}
                                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${
                                  subSel === s.id
                                    ? 'bg-af-600 font-medium text-white'
                                    : 'bg-white active:bg-graf-100'}`}>
                                {s.nome}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <input
                        value={obsBaixa} onChange={e => setObsBaixa(e.target.value)}
                        placeholder="Observação (opcional)"
                        className="toque mt-2 w-full rounded-xl border border-graf-200 bg-white px-3
                                   outline-none focus:border-af-500"
                      />

                      <button disabled={salvando}
                        onClick={() => confirmarBaixa(os.id)}
                        className="toque mt-2 w-full rounded-xl bg-af-600 font-semibold text-white
                                   active:scale-[0.99] disabled:opacity-50">
                        {salvando ? 'Salvando…' : 'Confirmar baixa'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>

        {/* passo a passo — o técnico vê a própria trilha, com o login */}
        {eventos.length > 0 && (
          <section className="card-campo p-4">
            <h2 className="mb-2 text-sm font-semibold text-graf-600">O que já aconteceu</h2>
            <ol className="space-y-2.5">
              {eventos.map(e => {
                const sit = typeof e.para?.situacao === 'string'
                  ? SITUACAO_INFO[e.para.situacao as Situacao]?.label ?? e.para.situacao
                  : null
                return (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="tabular w-24 shrink-0 text-xs text-graf-500">
                      {hora(e.criado_em)}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{sit ?? rotuloEvento(e.tipo)}</span>
                      {e.login && <span className="text-graf-500"> · {e.login}</span>}
                      {e.observacao && (
                        <span className="block text-xs text-graf-500">{e.observacao}</span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}
      </main>

      {/* ---------- ações fixas no rodapé: polegar alcança ---------- */}
      <div className="fixed inset-x-0 bottom-0 border-t border-graf-200 bg-white/95 p-3 backdrop-blur">
        {pedindoObs ? (
          <div className="space-y-2">
            <input
              autoFocus value={obsEtapa} onChange={e => setObsEtapa(e.target.value)}
              placeholder="O que impediu? Ex.: no local sem contato com o cliente"
              className="toque w-full rounded-xl border border-graf-300 px-3
                         outline-none focus:border-af-500"
            />
            <div className="flex gap-2">
              <button onClick={() => { setPedindoObs(false); setObsEtapa('') }}
                className="toque rounded-xl border-2 border-graf-300 px-5 font-semibold
                           text-graf-700">
                Cancelar
              </button>
              <button disabled={salvando || !obsEtapa.trim()}
                onClick={() => etapa('COM_IMPEDIMENTO', obsEtapa)}
                className="toque flex-1 rounded-xl bg-amber-600 font-semibold text-white
                           active:scale-[0.99] disabled:opacity-50">
                Registrar impedimento
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {v.situacao === 'ENTRADA' || v.situacao === 'ATRIBUIDA' ? (
              <button
                disabled={salvando}
                onClick={() => etapa('EM_DESLOCAMENTO')}
                className="toque-grande flex-1 rounded-xl bg-graf-950 font-semibold text-white
                           active:scale-[0.99] disabled:opacity-50">
                Estou a caminho
              </button>
            ) : v.situacao === 'EM_DESLOCAMENTO' ? (
              <button
                disabled={salvando}
                onClick={() => etapa('EM_EXECUCAO')}
                className="toque-grande flex-1 rounded-xl bg-af-600 font-semibold text-white
                           active:scale-[0.99] disabled:opacity-50">
                Cheguei — iniciar
              </button>
            ) : v.situacao === 'EM_EXECUCAO' || v.situacao === 'COM_IMPEDIMENTO' ? (
              <>
                <button
                  disabled={salvando}
                  onClick={() => setPedindoObs(true)}
                  className="toque-grande rounded-xl border-2 border-graf-300 px-5 font-semibold
                             text-graf-700 active:scale-[0.99] disabled:opacity-50">
                  Impedimento
                </button>
                <button
                  disabled={salvando || !todasBaixadas}
                  onClick={() => etapa('CONCLUIDA')}
                  className="toque-grande flex-1 rounded-xl bg-emerald-600 font-semibold text-white
                             active:scale-[0.99] disabled:opacity-40">
                  {todasBaixadas ? 'Finalizar visita' : `Falta baixar ${faltam} O.S.`}
                </button>
              </>
            ) : (
              <div className="toque-grande flex flex-1 items-center justify-center rounded-xl
                              bg-graf-50 font-medium text-graf-500">
                Visita encerrada — fale com o controlador para reabrir
              </div>
            )}
          </div>
        )}
        {salvando && <p className="mt-1.5 text-center text-xs text-graf-500">Salvando…</p>}
      </div>
    </div>
  )
}
