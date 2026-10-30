import { SeloLocal } from './TabelaContratos'
import type { LocalBaixa } from '../lib/localBaixa'
import type { Prova } from '../lib/prova'

/**
 * Prova e lugar: o que o contrato tem para provar que foi feito, e onde
 * o técnico estava quando a baixa aconteceu (135 e 136).
 *
 * ┌─ por que os três ficam no mesmo cartão ───────────────────────────┐
 * │ > "preciso saber se o técnico estava próximo da casa do cliente   │
 * │ >  no momento da baixa (...) todo contrato concluído pelo técnico │
 * │ >  deve ter evidências de que ele fez" — Emanuel, 25/10           │
 * │                                                                    │
 * │ São três leituras da mesma pergunta — "isto aqui foi feito, e foi │
 * │ feito lá?" — e cada uma sozinha engana: foto sem lugar prova      │
 * │ pouco, lugar sem foto também.                                      │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Nada aqui bloqueia nada: acusa. Quem decide é quem opera (D-170).
 */

const km = (m: number) => m >= 1000
  ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`

export function ProvaDoContrato({ prova, local, geoToa, raio = 200, compacto }: {
  prova: Prova | null
  local: LocalBaixa | null
  /** A justificativa de geolocalização que veio do TOA (135). */
  geoToa?: { lat: number; lng: number; obs: string | null; distancia_m: number | null } | null
  raio?: number
  compacto?: boolean
}) {
  return (
    <section className={compacto ? '' : 'card-controle p-4'}>
      <h2 className="mb-2 text-sm font-semibold">Prova e lugar</h2>

      {/* ---------- as evidências ---------- */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[10px] uppercase tracking-wide text-graf-500">Evidências</span>
        {!prova ? (
          <span className="text-sm text-graf-400">carregando…</span>
        ) : prova.minimo === 0 ? (
          <span className="text-sm text-graf-300">
            {prova.evidencias} anexada(s) · contrato em aberto não cobra prova ainda
          </span>
        ) : (
          <>
            <span className={`tabular text-sm font-semibold ${
              prova.evidencias >= prova.minimo ? 'text-emerald-300' : 'text-amber-300'}`}>
              {prova.evidencias} de {prova.minimo}
            </span>
            {prova.cobra_prova && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ${
                prova.no_prazo
                  ? 'bg-amber-900/40 text-amber-200 ring-amber-700/50'
                  : 'bg-af-900/40 text-af-200 ring-af-700/50'}`}>
                {prova.no_prazo
                  ? `faltam ${prova.falta} · até ${new Date(prova.prazo_ate + 'T12:00').toLocaleDateString('pt-BR')}`
                  : 'prazo encerrado'}
              </span>
            )}
          </>
        )}
      </div>

      {prova && (
        <p className="mt-1 text-xs text-graf-400">
          {prova.expurgo ? (
            <span className="text-af-300">
              Pontuação expurgada pelo ADMIN ({prova.expurgo === 'TODOS'
                ? 'de todos: sai também da conta da empresa'
                : 'só da conta do técnico'})
              {prova.expurgo_motivo && <> — “{prova.expurgo_motivo}”</>}
            </span>
          ) : prova.pontua_tecnico ? (
            <span className="text-emerald-300">Pontua para o técnico.</span>
          ) : prova.minimo === 0 ? null : (
            <>Não pontua para o técnico enquanto não tiver {prova.minimo} evidências.{' '}
              A conta da empresa não muda: o serviço foi feito.</>
          )}
        </p>
      )}

      {/* ---------- onde a baixa foi dada ---------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-graf-500">Onde baixou</span>
        {local ? <SeloLocal local={local} /> : (
          <span className="text-xs text-graf-400">
            sem leitura — nenhum registro do campo e nenhum ponto do rastro durante a execução
          </span>
        )}
        {local?.fonte === 'RASTRO' && (
          <span className="text-[11px] text-graf-400">
            ponto do rastro mais perto do cliente durante a execução
            {local.registros > 0 && <> · de {local.registros} ponto(s)</>}
            {local.minutos_do_ponto != null && <> · {local.minutos_do_ponto} min da hora do TOA</>}
          </span>
        )}
      </div>

      {/* ---------- o que o TOA capturou ---------- */}
      {geoToa && (
        <div className="mt-3">
          <span className="text-[10px] uppercase tracking-wide text-graf-500">
            Justificativa de geolocalização (TOA)
          </span>
          <p className="mt-0.5 text-xs text-graf-300">
            {geoToa.obs ? <>“{geoToa.obs}” · </> : null}
            <a href={`https://www.google.com/maps?q=${geoToa.lat},${geoToa.lng}`}
               target="_blank" rel="noopener noreferrer"
               className="tabular text-af-400 underline underline-offset-2">
              {geoToa.lat.toFixed(5)}, {geoToa.lng.toFixed(5)}
            </a>
            {geoToa.distancia_m != null && (
              <span className={geoToa.distancia_m > raio ? ' text-amber-300' : ' text-emerald-300'}>
                {' '}· {km(geoToa.distancia_m)} do cliente
              </span>
            )}
          </p>
          {/* Medido em 615 visitas: é do DESLOCAMENTO, não da baixa.
              Dizer isso evita que a distância vire acusação errada. */}
          <p className="mt-0.5 text-[11px] text-graf-400">
            É a posição que o TOA capturou quando pediu a justificativa — normalmente durante o
            deslocamento, não na baixa.
          </p>
        </div>
      )}
    </section>
  )
}
