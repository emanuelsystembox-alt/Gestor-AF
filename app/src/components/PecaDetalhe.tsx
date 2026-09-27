import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * A gaveta de UMA peça, aberta na lista do estoque.
 *
 * ┌─ o caminho da peça achada (D-160) ──────────────────────────────┐
 * │ > "o perda eu achei, como mudar o status para inicializado e     │
 * │ >  transferir para o técnico? para ele inserir no contrato       │
 * │ >  quando ele for usar" — Emanuel, 23/09                         │
 * │                                                                  │
 * │ 1. DECLARAR o estado AFLINE (ao lado do Atlas, com motivo).      │
 * │ 2. ENTREGAR ao técnico: cai no romaneio de entrega ABERTO dele,  │
 * │    ou abre um. Nada se move ainda (D-154).                       │
 * │ 3. O técnico CONFIRMA no aplicativo — a posse vira dele (D-157). │
 * │ 4. Ele lança o serial na baixa — a posse vira do assinante.      │
 * │                                                                  │
 * │ Os passos 1 e 2 moram aqui para o almoxarife não ter de decorar  │
 * │ o serial, trocar de aba e bipar de novo o que já está na tela.   │
 * └──────────────────────────────────────────────────────────────────┘
 */

export interface PecaDaLista {
  id: string; serial: string
  estado_atlas: string | null; posse: string | null
  estado_afline?: string | null
  estado_afline_em?: string | null
  estado_afline_motivo?: string | null
}

interface Evento {
  id: string; criado_em: string
  de: string | null; para: string | null
  estado_atlas: string | null; motivo: string
}

interface Tec { id: string; nome: string; matricula: string }

export function PecaDetalhe({ peca, estados, podeMexer, corEstado, rotuloPosse, aoMudar }: {
  peca: PecaDaLista
  /** O vocabulário do Atlas — só o que a carga já trouxe (085). */
  estados: string[]
  podeMexer: boolean
  corEstado: (e: string) => string
  rotuloPosse: (c: string | null) => string
  aoMudar: () => void
}) {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [tecnicos, setTecnicos] = useState<Tec[]>([])
  const [novoEstado, setNovoEstado] = useState('INICIALIZADO')
  const [motivo, setMotivo] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('equipamento_estado_evento')
      .select('id, criado_em, de, para, estado_atlas, motivo')
      .eq('equipamento_id', peca.id).order('criado_em', { ascending: false })
      .then(({ data }) => setEventos((data ?? []) as Evento[]))
  }, [peca.id, peca.estado_afline])

  useEffect(() => {
    if (!podeMexer) return
    supabase.from('tecnico').select('id, nome, matricula')
      .eq('situacao', 'ATIVO').order('nome')
      .then(({ data }) => setTecnicos((data ?? []) as Tec[]))
  }, [podeMexer])

  async function declarar(estado: string | null) {
    if (!motivo.trim()) { setErro('Diga o motivo — é ele que explica a diferença para o Atlas.'); return }
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('declarar_estado_equipamento', {
      p_equipamento: peca.id, p_estado: estado, p_motivo: motivo.trim(),
    })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    setOk(estado
      ? `Declarada ${estado} pela AFLINE. O Atlas continua dizendo ${peca.estado_atlas ?? '—'} até a CLARO corrigir.`
      : 'Declaração desfeita: volta a valer o estado do Atlas.')
    setMotivo('')
    aoMudar()
  }

  async function entregar() {
    if (!tecnico) return
    setOcupado(true); setErro(null); setOk(null)
    try {
      const t = tecnicos.find(x => x.id === tecnico)
      // O romaneio de entrega que JÁ está aberto para ele recebe a peça:
      // dez peças achadas na mesma manhã são um documento, não dez.
      const { data: aberto, error: e1 } = await supabase.from('romaneio')
        .select('id, numero').eq('situacao', 'ABERTO').eq('tipo', 'ENTREGA')
        .eq('tecnico_id', tecnico).order('numero', { ascending: false }).limit(1)
        .maybeSingle()
      if (e1) throw e1
      let id = (aberto as { id: string; numero: number } | null)?.id ?? null
      let numero = (aberto as { id: string; numero: number } | null)?.numero ?? null
      if (!id) {
        const { data, error } = await supabase.rpc('abrir_romaneio', {
          p_tipo: 'ENTREGA', p_tecnico: tecnico,
          p_observacao: 'Aberto pela lista peça a peça do estoque',
        })
        if (error) throw error
        id = data as string
        const { data: r } = await supabase.from('romaneio').select('numero').eq('id', id).maybeSingle()
        numero = (r as { numero: number } | null)?.numero ?? null
      }
      const { data: res, error: e2 } = await supabase.rpc('romaneio_por_serial', {
        p_romaneio: id, p_serial: peca.serial,
      })
      if (e2) throw e2
      const alerta = (res as { alerta: string | null } | null)?.alerta
      setOk(`${peca.serial} está no romaneio nº ${numero ?? '?'} de ${t?.nome ?? 'técnico'}.`
        + ' Nada muda até ele confirmar no aplicativo (ou você confirmar na aba Romaneios).'
        + (alerta ? ` Atenção: o estado que vale para ela é ${alerta}.` : ''))
      aoMudar()
    } catch (e) {
      setErro((e as { message?: string }).message ?? String(e))
    }
    setOcupado(false)
  }

  const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs outline-none focus:border-af-500'
  const dataHora = (s: string) => new Date(s).toLocaleString('pt-BR',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const podeEntregar = !peca.posse || peca.posse === 'NO_ALMOXARIFADO'

  return (
    <div className="grid gap-4 p-4 text-xs lg:grid-cols-3">
      {/* ---- estado ---- */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-graf-400">Estado</h3>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
          <dt className="text-graf-400">CLARO (Atlas)</dt>
          <dd>{peca.estado_atlas
            ? <span className="pill text-[10px]"
                style={{ ['--pill-cor' as string]: corEstado(peca.estado_atlas) }}>
                {peca.estado_atlas}</span>
            : '—'}</dd>
          <dt className="text-graf-400">AFLINE</dt>
          <dd>
            {peca.estado_afline ? (
              <>
                <EstadoAfline estado={peca.estado_afline} cor={corEstado(peca.estado_afline)} />
                <p className="mt-1 text-graf-400">
                  “{peca.estado_afline_motivo}”
                  {peca.estado_afline_em && <> · {dataHora(peca.estado_afline_em)}</>}
                </p>
              </>
            ) : <span className="text-graf-400">não declarado — vale o Atlas</span>}
          </dd>
        </dl>

        {podeMexer && (
          <div className="space-y-1.5 rounded-md border border-graf-800 p-2.5">
            <div className="flex flex-wrap gap-1.5">
              <select value={novoEstado} onChange={e => setNovoEstado(e.target.value)}
                aria-label="Estado a declarar" className={campo}>
                {estados.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={motivo} onChange={e => setMotivo(e.target.value)}
                aria-label="Motivo da declaração"
                placeholder="Motivo (ex.: achada na prateleira B)"
                className={`${campo} min-w-40 flex-1`} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button disabled={ocupado || !motivo.trim()} onClick={() => declarar(novoEstado)}
                className="rounded-md bg-af-600 px-3 py-1.5 font-medium text-white
                           hover:bg-af-500 disabled:opacity-40">
                declarar {novoEstado}
              </button>
              {peca.estado_afline && (
                <button disabled={ocupado || !motivo.trim()} onClick={() => declarar(null)}
                  className="rounded-md border border-graf-700 px-3 py-1.5 text-graf-300
                             hover:border-af-600 hover:text-af-400 disabled:opacity-40">
                  desfazer — voltar ao Atlas
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---- entregar ---- */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-graf-400">
          Onde está · entregar
        </h3>
        <p className="text-graf-300">
          Posse: <strong className="text-graf-200">{rotuloPosse(peca.posse)}</strong>
        </p>
        {podeMexer && (podeEntregar ? (
          <div className="space-y-1.5 rounded-md border border-graf-800 p-2.5">
            <div className="flex flex-wrap gap-1.5">
              <select value={tecnico} onChange={e => setTecnico(e.target.value)}
                aria-label="Técnico que recebe a peça" className={`${campo} min-w-40 flex-1`}>
                <option value="">Escolha o técnico…</option>
                {tecnicos.map(t => (
                  <option key={t.id} value={t.id}>{t.nome} · {t.matricula}</option>))}
              </select>
              <button disabled={ocupado || !tecnico} onClick={entregar}
                className="rounded-md bg-af-600 px-3 py-1.5 font-medium text-white
                           hover:bg-af-500 disabled:opacity-40">
                entregar
              </button>
            </div>
            <p className="text-[11px] text-graf-400">
              Entra no romaneio de entrega aberto dele (ou abre um). A peça só passa a ser dele
              quando ele confirmar no aplicativo; depois, ao lançar o serial na baixa, ela vai
              para o assinante sozinha.
            </p>
          </div>
        ) : (
          <p className="text-graf-400">
            Só se entrega o que está no almoxarifado ou sem posse declarada. Esta está
            “{rotuloPosse(peca.posse)}” — se voltou, faça a devolutiva na aba Romaneios.
          </p>
        ))}
      </div>

      {/* ---- histórico ---- */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-graf-400">
          Declarações de estado
        </h3>
        {eventos.length === 0 ? (
          <p className="text-graf-400">Ninguém daqui declarou estado para esta peça.</p>
        ) : (
          <ol className="space-y-1.5">
            {eventos.map(ev => (
              <li key={ev.id} className="text-graf-300">
                <span className="tabular text-graf-400">{dataHora(ev.criado_em)}</span>{' '}
                {ev.de ?? 'Atlas'} → <strong>{ev.para ?? 'volta ao Atlas'}</strong>
                <span className="text-graf-400"> (Atlas: {ev.estado_atlas ?? '—'})</span>
                <p className="text-graf-400">“{ev.motivo}”</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {(erro || ok) && (
        <p role="status" className={`lg:col-span-3 ${erro ? 'text-af-400' : 'text-emerald-400'}`}>
          {erro ?? ok}
        </p>
      )}
    </div>
  )
}

/** A etiqueta do estado AFLINE é VAZADA, a do Atlas é cheia — a mesma
 *  gramática das duas baixas (D-109): cor não distingue o que é igual
 *  em cor; a forma distingue. */
export function EstadoAfline({ estado, cor }: { estado: string; cor: string }) {
  return (
    <span title="Estado declarado pela AFLINE — o Atlas pode dizer outra coisa"
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]
                 font-semibold ring-1"
      style={{ color: cor, ['--tw-ring-color' as string]: cor }}>
      <span className="text-[8px] font-bold tracking-wider opacity-80">AFLINE</span>
      {estado}
    </span>
  )
}
