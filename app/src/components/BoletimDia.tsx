import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isoLocal } from '../lib/formato'
import { Alerta } from './ui'

/**
 * O boletim do dia (265): o plano das 07h e o fechamento das 18h, da cidade ativa.
 *
 * O texto é o do Gemini ou, quando a IA falha, o da regra fixa (os mesmos números) — e o
 * cartão diz qual dos dois, sem esconder. A tela mostra o texto como veio: para a IA só vão
 * números, códigos e código de equipe, montados no banco (`dados_do_boletim`).
 *
 * Só a gestão recebe: para os outros o banco devolve nulo e o componente não aparece.
 */

interface Parte {
  texto: string
  fonte: 'IA' | 'REGRA'
  modelo: string | null
  gerado_em: string
  escrito_em: string
  ia_pendente: boolean
  ia_erro: string | null
}
interface Boletim { dia: string; manha: Parte | null; noite: Parte | null }

const hora = (ts: string) =>
  new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function BoletimDia({ dia }: { dia?: string }) {
  const d = dia ?? isoLocal()
  const [b, setB] = useState<Boletim | null | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setB(undefined)
    setErro(null)
    supabase.rpc('boletim_do_dia', { p_dia: d }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro(error.message); setB(null); return }
      setB((data as Boletim | null) ?? null)
    })
    return () => { vivo = false }
  }, [d])

  if (erro) return <Alerta tipo="erro">{erro}</Alerta>
  if (!b) return null
  const hoje = d === isoLocal()

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Cartao titulo="Boletim da manhã" parte={b.manha}
        vazio={hoje ? 'Sai às 07h.' : 'Sem boletim da manhã neste dia.'} />
      <Cartao titulo="Boletim da noite" parte={b.noite}
        vazio={hoje ? 'Sai às 18h10.' : 'Sem boletim da noite neste dia.'} />
    </div>
  )
}

function Cartao({ titulo, parte, vazio }: { titulo: string; parte: Parte | null; vazio: string }) {
  const dica = !parte ? undefined
    : parte.fonte === 'IA'
      ? `${parte.modelo ?? 'IA'} · números das ${hora(parte.gerado_em)}`
      : parte.ia_pendente ? 'A IA ainda vai tentar'
        : parte.ia_erro ? `A IA não respondeu: ${parte.ia_erro}` : undefined

  return (
    <section className="card-controle p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        {parte && (
          <span className="shrink-0 text-xs text-graf-400" title={dica}>
            {parte.fonte === 'IA' ? 'escrito pela IA' : 'por regra'} · {hora(parte.escrito_em)}
          </span>
        )}
      </div>
      {parte
        ? <p className="whitespace-pre-line text-sm leading-relaxed text-graf-200">{parte.texto}</p>
        : <p className="text-sm text-graf-400">{vazio}</p>}
    </section>
  )
}
