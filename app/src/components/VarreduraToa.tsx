import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta } from './ui'
import {
  varrerNoToa, cancelarVarredura, extensaoVarre,
  type InfoExtensao, type EventoVarredura,
} from '../lib/ponteToa'

/**
 * A varredura do TOA neste computador (117, D-192): nome do cliente,
 * equipamento instalado/retirado e miscelânea, lidos PELAS TELAS do TOA.
 *
 * ┌─ por que as telas, e não um atalho ──────────────────────────────┐
 * │ > "não quero burla o sistema, so quero trazer os dados que a     │
 * │ >  minha senha ja acessa" — Emanuel, 19/10                       │
 * │ A extensão faz, numa aba do TOA no Console de Alocação, o que a  │
 * │ pessoa faria com o mouse: bloco → Detalhes → Equipamento, e lê o │
 * │ texto. Uns 10 s por contrato. Pedir direto ao servidor exigiria  │
 * │ copiar a ficha de segurança do TOA — não se faz (docs/11).       │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Quem decide o que falta e quando está vencida é o banco
 * (`varredura_pendentes`, `varredura_estado`). Cada contrato lido é gravado
 * NA HORA (`registrar_varredura`): parar no meio não perde o que já veio.
 * Só registra no contrato — não mexe em saldo nem posse.
 */

interface Estado { intervalo_min: number | null; ultima: string | null; info: string | null; vencida: boolean }
interface Andamento { feitos: number; total: number }
interface Pendente { aid: string; contrato: string | null; precisa_nome: boolean; precisa_equipamento: boolean }

const hora = (ts: string | null) =>
  ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

export function VarreduraToa({ baseId, ext, aoTerminar }: {
  baseId: string; ext: InfoExtensao | null | undefined; aoTerminar: () => void
}) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [andamento, setAndamento] = useState<Andamento | null>(null)
  const [resultado, setResultado] = useState<{ tom: 'ok' | 'aviso' | 'erro'; texto: string } | null>(null)
  const [falhas, setFalhas] = useState<string[]>([])
  const rodando = useRef(false)
  const podeVarrer = extensaoVarre(ext)

  const lerEstado = useCallback(async (terminou?: string) => {
    const { data } = await supabase.rpc('varredura_estado', { p_base: baseId, p_terminou: terminou ?? null })
    if (data) setEstado(data as Estado)
    return data as Estado | null
  }, [baseId])

  const varrer = useCallback(async () => {
    if (rodando.current) return
    rodando.current = true
    setResultado(null); setFalhas([])
    try {
      const { data, error } = await supabase.rpc('varredura_pendentes', { p_base: baseId })
      if (error) { setResultado({ tom: 'erro', texto: error.message }); return }
      const pend = (data ?? []) as Pendente[]
      if (pend.length === 0) {
        setResultado({ tom: 'ok', texto: 'Nada a varrer: todos os contratos de hoje já têm nome, e os encerrados já têm o equipamento lido.' })
        await lerEstado('nada pendente')
        return
      }
      const porAid = new Map(pend.map(p => [p.aid, p]))
      let comNome = 0, comEquip = 0, fora = 0, erros = 0
      setAndamento({ feitos: 0, total: pend.length })

      const r = await varrerNoToa(
        pend.map(p => ({ aid: p.aid, precisa_equipamento: p.precisa_equipamento })),
        async (e: EventoVarredura) => {
          setAndamento({ feitos: e.feitos, total: e.total })
          if (e.evento !== 'item' || !e.aid || !e.resultado) return
          const lido = e.resultado
          const contrato = porAid.get(e.aid)?.contrato ?? e.aid
          if (!lido.ok) {
            if (lido.motivo === 'FORA_DO_CONSOLE') fora++
            else { erros++; setFalhas(f => [`${contrato}: ${lido.mensagem ?? 'erro'}`, ...f].slice(0, 30)) }
            return
          }
          const { error: eg } = await supabase.rpc('registrar_varredura', {
            p_base: baseId, p_aid: e.aid, p_nome: lido.nome ?? null,
            p_leu_equipamento: !!lido.leuEquipamento, p_itens: lido.itens ?? [],
          })
          if (eg) { erros++; setFalhas(f => [`${contrato}: não gravou — ${eg.message}`, ...f].slice(0, 30)); return }
          if (lido.nome) comNome++
          if (lido.leuEquipamento) comEquip++
        })

      if (!r.aceito) { setResultado({ tom: 'erro', texto: r.mensagem ?? 'A varredura não começou.' }); return }
      const resumo = `${comNome} nome(s), ${comEquip} lista(s) de equipamento`
        + (fora ? `; ${fora} fora do Console aberto${r.bucket ? ` (${r.bucket})` : ''}` : '')
        + (erros ? `; ${erros} com erro` : '')
        + (r.cancelado ? '; parada no meio' : '')
        + (r.mensagem ? `; ${r.mensagem}` : '')
      setResultado({ tom: erros || r.mensagem ? 'aviso' : 'ok', texto: `Varredura terminou: ${resumo}.` })
      await lerEstado(resumo)
      aoTerminar()
    } finally {
      rodando.current = false
      setAndamento(null)
    }
  }, [baseId, lerEstado, aoTerminar])

  // A varredura sozinha: de minuto em minuto pergunta ao banco se venceu.
  useEffect(() => {
    lerEstado()
    if (!podeVarrer) return
    const t = setInterval(async () => {
      if (rodando.current) return
      const e = await lerEstado()
      if (e?.vencida) varrer()
    }, 60_000)
    return () => clearInterval(t)
  }, [lerEstado, varrer, podeVarrer])

  const pct = andamento && andamento.total ? Math.floor((andamento.feitos / andamento.total) * 100) : 0

  return (
    <div className="mt-4 border-t border-graf-800 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Varredura do TOA — nome, equipamento e miscelânea</h3>
          <p className="mt-0.5 text-xs text-graf-400">
            Deixe uma aba do TOA no <strong>Console de Alocação</strong>, no bucket e no dia de hoje, e
            não mexa nela durante a varredura: a extensão abre cada contrato por ela (uns 10 s cada).
            {' '}{estado?.intervalo_min ? `Roda sozinha a cada ${estado.intervalo_min === 60 ? '1 hora' : `${estado.intervalo_min} min`}.` : 'Roda só no botão.'}
            {estado?.ultima && <> Última às {hora(estado.ultima)}{estado.info ? `: ${estado.info}` : ''}.</>}
          </p>
        </div>
        {andamento ? (
          <button onClick={cancelarVarredura}
            className="rounded-lg border border-graf-700 px-3 py-1.5 text-xs text-graf-300 hover:border-af-600 hover:text-af-400">
            Parar a varredura
          </button>
        ) : (
          <button onClick={varrer} disabled={!podeVarrer}
            title={podeVarrer ? 'Lê no TOA o que falta dos contratos de hoje' : 'Precisa da extensão 0.2.0'}
            className="rounded-lg border border-af-600 px-3 py-1.5 text-xs font-medium text-af-200
                       hover:bg-af-600/15 disabled:opacity-50">
            Varrer o TOA agora
          </button>
        )}
      </div>

      {!podeVarrer && ext && (
        <div className="mt-2">
          <Alerta tipo="aviso">
            A extensão deste Chrome é a {ext.versao}; a varredura precisa da 0.2.0. Em chrome://extensions,
            clique em recarregar na extensão, recarregue a aba do TOA (F5) e esta página.
          </Alerta>
        </div>
      )}

      {andamento && (
        <div role="status" aria-live="polite" className="mt-3">
          <div className="flex justify-between text-xs text-graf-300">
            <span>Varrendo o TOA… {andamento.feitos} de {andamento.total}</span>
            <span className="tabular font-medium">{pct}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-graf-800">
            <div className="h-full rounded-full bg-af-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {resultado && !andamento && (
        <div className="mt-3"><Alerta tipo={resultado.tom}>{resultado.texto}</Alerta></div>
      )}

      {falhas.length > 0 && (
        <ol className="mt-2 max-h-32 space-y-0.5 overflow-y-auto rounded-lg bg-graf-950/50 p-2 text-xs text-af-300">
          {falhas.map((f, k) => <li key={k}>{f}</li>)}
        </ol>
      )}
    </div>
  )
}
