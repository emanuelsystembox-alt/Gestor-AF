import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta } from './ui'

/**
 * A régua das equipes atrasadas do Dashboard VT (257/258, D-372).
 *
 * > "la em configuração o sistema pode da opção de configurar as baixas da VT
 * >  caso eu queira mudar o horário" — Emanuel, 11/11
 *
 * Cada linha é "até HH:MM, o Nº cliente baixado"; a posição é o Nº. Quem valida
 * é o banco (`definir_marcos_vt`): de 1 a 12 horários, HH:MM, em ordem crescente.
 * Sem vigência: a régua nova julga também os dias que já passaram.
 */
const PADRAO = ['09:10', '10:10', '11:10', '12:10', '13:10', '15:20', '16:20', '17:20']

export function DashboardVTMarcos() {
  const [salvo, setSalvo] = useState<string[] | null>(null)
  const [horas, setHoras] = useState<string[]>([])
  const [atualizado, setAtualizado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    supabase.from('parametro').select('valor, atualizado_em').eq('chave', 'vt_marcos_baixa').maybeSingle()
      .then(({ data, error }) => {
        if (error) { setErro(error.message); return }
        const v = (data?.valor as string[] | undefined) ?? PADRAO
        setSalvo(v); setHoras(v)
        setAtualizado((data?.atualizado_em as string | null | undefined) ?? null)
      })
  }, [])

  const mudou = salvo != null && horas.join() !== salvo.join()

  async function salvar() {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_marcos_vt', { p_horas: horas })
    if (error) setErro(error.message)
    else {
      setSalvo(horas); setAtualizado(new Date().toISOString())
      setOk('Régua salva. O Dashboard VT já julga as equipes por ela, inclusive nos dias que passaram.')
    }
    setOcupado(false)
  }

  return (
    <section className="card-controle mb-3 p-4" aria-labelledby="vt-marcos-titulo">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="vt-marcos-titulo" className="text-sm font-semibold">Equipes atrasadas · régua da VT</h2>
        <p className="text-[11px] text-graf-400">
          Até que hora cada cliente tem de estar baixado no TOA. Vale para todos os dias consultados.
        </p>
        {atualizado && (
          <span className="ml-auto text-[11px] text-graf-400">
            alterada em {new Date(atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        )}
      </div>

      {erro && <div className="mt-3"><Alerta tipo="erro">{erro}</Alerta></div>}
      {ok && <div className="mt-3"><Alerta tipo="ok">{ok}</Alerta></div>}

      {salvo == null ? (
        <p className="mt-3 text-xs text-graf-400">Carregando…</p>
      ) : (<>
        <ol className="mt-3 flex flex-wrap gap-2">
          {horas.map((h, i) => (
            <li key={i} className="flex items-center gap-1.5 rounded-md border border-graf-700 bg-graf-900 px-2 py-1">
              <span className="tabular w-6 text-right text-[11px] font-semibold text-graf-300">{i + 1}º</span>
              <input type="time" value={h} aria-label={`Hora do ${i + 1}º cliente`}
                onChange={e => setHoras(l => l.map((x, j) => j === i ? e.target.value : x))}
                className="tabular rounded border border-graf-700 bg-graf-950 px-1.5 py-0.5 text-xs" />
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" disabled={horas.length >= 12}
            onClick={() => setHoras(l => [...l, l[l.length - 1] ?? '09:00'])}
            className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300 hover:border-af-600 disabled:opacity-40">
            + cliente
          </button>
          <button type="button" disabled={horas.length <= 1}
            onClick={() => setHoras(l => l.slice(0, -1))}
            className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300 hover:border-af-600 disabled:opacity-40">
            − último
          </button>
          <button type="button" onClick={() => setHoras(PADRAO)}
            className="rounded-md border border-graf-700 px-2.5 py-1 text-graf-300 hover:border-af-600">
            voltar ao padrão
          </button>
          <button type="button" disabled={!mudou || ocupado} onClick={salvar}
            className="ml-auto rounded-md bg-af-600 px-3 py-1 font-semibold text-white disabled:opacity-40">
            {ocupado ? 'Salvando…' : 'Salvar régua'}
          </button>
        </div>
      </>)}
    </section>
  )
}
