import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useCidades } from '../lib/cidade'
import { Alerta } from './ui'

/**
 * Os buckets do TOA da cidade ativa (103, D-180).
 *
 * ┌─ por que cadastro, e não regra de prefixo ───────────────────────┐
 * │ > "é bom ter um filtro de bucket da cidade ok quando importar"   │
 * │ >  — Emanuel, 17/10                                              │
 * │                                                                  │
 * │ O bucket só vem no NOME do arquivo (Atividades-MAN-AFLINE_…), e  │
 * │ os códigos do TOA não são os nossos: BLM é Belém (BEL), GUR é    │
 * │ Gurupi (GRP), ITZ é Imperatriz (IMP). Deduzir pelo prefixo seria │
 * │ o sistema decidindo no lugar de quem opera (D-088).              │
 * │                                                                  │
 * │ Um bucket é de UMA cidade (unique no banco): é isto que impede a │
 * │ mistura. Não se apaga — desliga; a importação antiga aponta o    │
 * │ nome dele.                                                       │
 * └──────────────────────────────────────────────────────────────────┘
 */
interface Bucket {
  id: string; nome: string; ativo: boolean; origem: string; criado_em: string
  autor: { nome: string | null } | null
}

export function BucketsToa() {
  const { temPapel } = useAuth()
  const souAdmin = temPapel('ADMIN')
  const { ativa } = useCidades()
  const [lista, setLista] = useState<Bucket[] | null>(null)
  const [novo, setNovo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function carregar() {
    // O RLS já devolve só os da cidade ativa — sem filtro de tela.
    const { data, error } = await supabase.from('toa_bucket')
      .select('id, nome, ativo, origem, criado_em, autor:criado_por ( nome )')
      .order('nome')
    if (error) { setErro(error.message); setLista([]); return }
    setLista((data ?? []) as unknown as Bucket[])
  }
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!ativa || !novo.trim()) return
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('salvar_bucket', { p_base: ativa.id, p_nome: novo })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    setOk(`${novo.trim().toUpperCase()} agora é de ${ativa.nome}.`)
    setNovo('')
    carregar()
  }

  async function ativar(b: Bucket, ativo: boolean) {
    setErro(null); setOk(null)
    const { error } = await supabase.rpc('ativar_bucket', { p_id: b.id, p_ativo: ativo })
    if (error) { setErro(error.message); return }
    carregar()
  }

  return (
    <section className="card-controle overflow-hidden">
      <div className="border-b border-graf-800 px-4 py-3">
        <h2 className="text-sm font-semibold">
          Buckets do TOA — {ativa?.nome ?? 'escolha a cidade no topo'}
        </h2>
        <p className="mt-1 text-xs text-graf-400">
          O TOA diz o bucket no nome do arquivo (<code>Atividades-MAN-AFLINE_17_10_26.xlsx</code>).
          A importação <strong>só aceita</strong> arquivo de bucket desta cidade — o de outra
          cidade é recusado, com o recado de qual é. Para ver os de outra cidade, troque a
          cidade no topo.
        </p>
      </div>

      <div className="space-y-3 px-4 py-3">
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {ok && <Alerta tipo="ok">{ok}</Alerta>}

        {souAdmin && ativa && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-graf-400">
              <span className="mb-1 block">Novo bucket, como aparece no TOA</span>
              <input value={novo} onChange={e => setNovo(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') salvar() }}
                placeholder="MAN-AFLINE_ADM"
                className="w-64 rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm
                           outline-none focus:border-af-500" />
            </label>
            <button onClick={salvar} disabled={ocupado || !novo.trim()}
              className="rounded-md bg-af-600 px-4 py-1.5 text-sm font-medium text-white
                         hover:bg-af-500 disabled:opacity-50">
              {ocupado ? 'Salvando…' : `Cadastrar em ${ativa.nome}`}
            </button>
          </div>
        )}
      </div>

      {lista === null ? (
        <p className="px-4 py-8 text-center text-sm text-graf-400">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-graf-400">
          Nenhum bucket cadastrado nesta cidade — nenhum arquivo do TOA entra aqui até
          alguém cadastrar.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-y border-graf-800 bg-graf-900 text-left text-[11px]
                            uppercase tracking-wide text-graf-400">
            <tr>
              <th className="px-4 py-2 font-medium">Bucket</th>
              <th className="px-4 py-2 font-medium">De onde veio</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map(b => (
              <tr key={b.id} className="border-b border-graf-800">
                <td className="px-4 py-2 font-mono text-xs">{b.nome}</td>
                <td className="px-4 py-2 text-xs text-graf-400">
                  {b.origem === 'ARQUIVOS_DO_TOA'
                    ? 'dos arquivos do TOA (bucket do nome × coluna Cidade)'
                    : `cadastrado por ${b.autor?.nome ?? 'alguém'} em ${new Date(b.criado_em).toLocaleDateString('pt-BR')}`}
                </td>
                <td className="px-4 py-2 text-xs">
                  {b.ativo
                    ? <span className="text-emerald-400">aceita importação</span>
                    : <span className="text-graf-400">desligado</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  {souAdmin && (
                    <button onClick={() => ativar(b, !b.ativo)}
                      className="rounded border border-graf-700 px-2.5 py-1 text-[11px] text-graf-300
                                 hover:border-af-600 hover:text-af-400">
                      {b.ativo ? 'Desligar' : 'Religar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
