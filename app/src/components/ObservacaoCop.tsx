import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * A observação do COP para o técnico (156e).
 *
 * > "um campo de observação COP. Esse campo serve para o COP ou
 * >  controlador adicionar informações importantes para o técnico
 * >  visualizar no app dele. Por exemplo, o cliente estará somente às
 * >  14 horas" — Emanuel, 30/10
 *
 * Não é a `observacao` do contrato: aquela é escrita por funções que a
 * importação também chama, e a nota do COP apagada às 14h pela planilha
 * das 14h mandaria o técnico na hora errada. Esta tem coluna própria e
 * uma porta só (`definir_observacao_cop`), que avisa o técnico pelo
 * mesmo funil de todo aviso (visita_evento → aviso).
 *
 * Quem não pode escrever (supervisor sem a permissão) vê o texto e não
 * vê o botão — o banco recusaria de qualquer jeito.
 */
export function ObservacaoCop({ visitaId, texto, em, por, aoMudar }: {
  visitaId: string
  texto: string | null
  em: string | null
  /** Nome de quem escreveu, se a tela tiver. */
  por: string | null
  aoMudar: () => void
}) {
  const { temPapel, pode } = useAuth()
  const podeEscrever = temPapel('ADMIN', 'COP', 'CONTROLADOR') || pode('servicos.editar')
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState(texto ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => { if (!editando) setRascunho(texto ?? '') }, [texto, editando])

  async function salvar() {
    setSalvando(true); setErro(null)
    const { error } = await supabase.rpc('definir_observacao_cop',
      { p_visita: visitaId, p_texto: rascunho })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    setEditando(false)
    aoMudar()
  }

  const quando = em
    ? new Date(em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <section className={`card-controle p-4 ${texto ? 'ring-1 ring-sky-600/40' : ''}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">💬 Observação do COP para o técnico</h2>
        {texto && quando && (
          <span className="text-[11px] text-graf-400">
            {por ? `${por} · ` : ''}{quando} · vai para o aplicativo do técnico
          </span>
        )}
        {podeEscrever && !editando && (
          <button onClick={() => setEditando(true)}
            className="ml-auto rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                       hover:border-af-600 hover:text-af-400">
            {texto ? 'Editar' : 'Escrever observação'}
          </button>
        )}
      </div>

      {editando ? (
        <div className="space-y-2">
          <textarea value={rascunho} onChange={e => setRascunho(e.target.value)} maxLength={500}
            rows={3} autoFocus
            placeholder="Ex.: Cliente só estará em casa a partir das 14h. Ligar antes de ir."
            className="w-full rounded-md border border-graf-700 bg-graf-900 px-2.5 py-2 text-sm
                       outline-none focus:border-af-500" />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={salvar} disabled={salvando}
              className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                         hover:bg-af-500 disabled:opacity-50">
              {salvando ? 'Salvando…' : rascunho.trim() ? 'Salvar e avisar o técnico' : 'Apagar observação'}
            </button>
            <button onClick={() => { setEditando(false); setErro(null) }}
              className="rounded-md px-3 py-1.5 text-xs text-graf-400 hover:text-graf-200">
              Cancelar
            </button>
            <span className="tabular ml-auto text-[11px] text-graf-500">{rascunho.length}/500</span>
          </div>
          {erro && <p className="text-xs text-af-400">{erro}</p>}
          <p className="text-[11px] text-graf-400">
            Ao salvar, o técnico recebe um aviso no aplicativo com o texto. Apagar não avisa.
          </p>
        </div>
      ) : texto ? (
        <p className="whitespace-pre-wrap text-sm text-graf-100">{texto}</p>
      ) : (
        <p className="text-xs text-graf-400">
          Nenhuma observação. Use para o que o técnico precisa saber antes de ir —
          horário do cliente, portaria, ponto de referência.
        </p>
      )}
    </section>
  )
}
