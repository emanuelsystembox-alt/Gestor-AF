import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alerta } from './ui'

/**
 * Cadastro manual de contrato — a "Nova Ordem de Serviço" do sistema atual.
 *
 * ┌─ POR QUE ISTO EXISTE ────────────────────────────────────────────┐
 * │ Nem todo serviço nasce no TOA da CLARO. Quando não nasce, ele    │
 * │ precisa entrar aqui mesmo assim: senão não é despachado, não é   │
 * │ medido e não é cobrado.                                          │
 * │                                                                  │
 * │ O número da O.S. é gerado pelo sistema (AF-00000001) quando o    │
 * │ usuário não informa um. O prefixo não é enfeite: os números da   │
 * │ CLARO têm 10 dígitos, e um número nosso no mesmo formato         │
 * │ colidiria no dia em que o contrato entrasse no TOA.              │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Não existe tabela `cliente`: o dado cadastral mora na visita, como
 * vem do TOA. Por isso a busca de cliente procura no histórico de
 * visitas e copia — é o mesmo efeito prático do "Pesquisar Cliente"
 * dele, sem inventar entidade que a operação não tem.
 */

interface TipoOS { id: string; codigo: number; descricao: string }
interface TipoServico { id: string; nome: string }
interface Equipe { id: string; codigo: string; nome: string }
interface Area { id: string; codigo: string; apelido: string | null }

interface Achado {
  contrato: string | null; cliente_nome: string | null
  tipo_pessoa: string | null; tipo_residencia: string | null
  telefones: string[] | null
  logradouro: string | null; complemento: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null; node: string | null
  lat: number | null; lng: number | null; area_id: string | null
}

interface OSNova {
  chave: number
  tipo_os_id: string
  numero_os: string
  descricao: string
}

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'
const hoje = () => new Date().toISOString().slice(0, 10)

/** As janelas que o TOA usa. Fora delas, o usuário digita à mão. */
const PERIODOS = ['08:00-11:00', '08:00-12:00', '11:00-14:00', '12:00-15:00', '15:00-18:00']

export function NovoContratoModal({
  onFechar, onCriado,
}: {
  onFechar: () => void
  onCriado: (visitaId: string) => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // catálogos
  const [tiposOS, setTiposOS] = useState<TipoOS[]>([])
  const [servicos, setServicos] = useState<TipoServico[]>([])
  const [equipes, setEquipes] = useState<Equipe[]>([])
  const [areas, setAreas] = useState<Area[]>([])

  // cliente
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<Achado[]>([])
  const [buscando, setBuscando] = useState(false)

  const [f, setF] = useState<Record<string, string>>({
    contrato: '', cliente_nome: '', tipo_pessoa: '', tipo_residencia: '',
    telefones: '', logradouro: '', complemento: '', bairro: '',
    cidade: 'MANAUS', uf: 'AM', cep: '', node: '', area_id: '',
    tipo_servico_id: '', equipe_id: '', wo_numero: '', observacao: '',
    data_agendada: hoje(), janela_inicio: '', janela_fim: '',
  })
  const set = (k: string, v: string) => setF(a => ({ ...a, [k]: v }))

  // O.S. da visita
  const [ordens, setOrdens] = useState<OSNova[]>([])
  const [novaTipo, setNovaTipo] = useState('')
  const [novaDescricao, setNovaDescricao] = useState('')
  const [novaNumero, setNovaNumero] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('tipo_os').select('id, codigo, descricao').order('codigo'),
      supabase.from('tipo_servico').select('id, nome').order('nome'),
      supabase.from('equipe').select('id, codigo, nome').eq('ativo', true).order('codigo'),
      supabase.from('area_trabalho').select('id, codigo, apelido').order('codigo'),
    ]).then(([a, b, c, d]) => {
      setTiposOS((a.data ?? []) as TipoOS[])
      setServicos((b.data ?? []) as TipoServico[])
      setEquipes((c.data ?? []) as Equipe[])
      setAreas((d.data ?? []) as Area[])
    })
  }, [])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  async function procurar() {
    const t = busca.trim()
    if (t.length < 3) { setAchados([]); return }
    setBuscando(true)
    const { data } = await supabase.from('visita')
      .select(`contrato, cliente_nome, tipo_pessoa, tipo_residencia, telefones,
               logradouro, complemento, bairro, cidade, uf, cep, node, lat, lng, area_id`)
      .or(`contrato.ilike.%${t}%,cliente_nome.ilike.%${t}%`)
      .is('excluido_em', null)
      .order('data_agendada', { ascending: false })
      .limit(20)
    // O mesmo contrato aparece em toda visita que já teve; só a última
    // interessa para copiar o cadastro.
    const vistos = new Set<string>()
    const unicos: Achado[] = []
    for (const a of (data ?? []) as Achado[]) {
      const k = `${a.contrato}|${a.cliente_nome}`
      if (vistos.has(k)) continue
      vistos.add(k); unicos.push(a)
    }
    setAchados(unicos.slice(0, 8))
    setBuscando(false)
  }

  function usar(a: Achado) {
    setF(x => ({
      ...x,
      contrato: a.contrato ?? '', cliente_nome: a.cliente_nome ?? '',
      tipo_pessoa: a.tipo_pessoa ?? '', tipo_residencia: a.tipo_residencia ?? '',
      telefones: (a.telefones ?? []).join(', '),
      logradouro: a.logradouro ?? '', complemento: a.complemento ?? '',
      bairro: a.bairro ?? '', cidade: a.cidade ?? '', uf: a.uf ?? '',
      cep: a.cep ?? '', node: a.node ?? '', area_id: a.area_id ?? '',
    }))
    setAchados([])
    setBusca('')
  }

  function inserirOS() {
    if (!novaTipo && !novaDescricao.trim()) return
    if (ordens.length >= 10) {
      setErro('Uma visita comporta no máximo 10 O.S. (D-001).')
      return
    }
    const t = tiposOS.find(x => x.id === novaTipo)
    setOrdens(o => [...o, {
      chave: Date.now(),
      tipo_os_id: novaTipo,
      numero_os: novaNumero.trim(),
      descricao: novaDescricao.trim() || t?.descricao || '',
    }])
    setNovaTipo(''); setNovaDescricao(''); setNovaNumero('')
    setErro(null)
  }

  const podeSalvar = useMemo(
    () => Boolean(f.contrato.trim()) && ordens.length > 0 && !ocupado,
    [f.contrato, ordens.length, ocupado])

  async function salvar() {
    setOcupado(true); setErro(null); setOk(null)
    const { data, error } = await supabase.rpc('criar_visita_manual', {
      p_dados: {
        ...f,
        telefones: f.telefones
          ? f.telefones.split(',').map(t => t.trim()).filter(Boolean)
          : undefined,
        ordens: ordens.map(o => ({
          tipo_os_id: o.tipo_os_id || null,
          numero_os: o.numero_os || null,
          descricao: o.descricao || null,
        })),
      },
    })
    if (error) { setErro(error.message); setOcupado(false); return }
    const r = data as { visita_id: string; ordens: string[] }
    setOk(`Contrato criado com ${r.ordens.length} O.S.: ${r.ordens.join(', ')}`)
    setOcupado(false)
    onCriado(r.visita_id)
  }

  return (
    <div onClick={onFechar}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto
                 bg-black/70 p-4 backdrop-blur-sm">
      <div onClick={e => e.stopPropagation()}
        className="sup-controle mt-6 w-full max-w-4xl rounded-xl border border-graf-700
                   border-t-4 border-t-af-600 bg-graf-950 shadow-2xl">

        <div className="flex items-center gap-3 border-b border-graf-800 px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold">Nova ordem de serviço</h2>
            <p className="mt-0.5 text-xs text-graf-400">
              Para o serviço que não veio do TOA. Ele entra como
              <strong className="text-graf-300"> origem MANUAL</strong> e a importação
              não o sobrescreve.
            </p>
          </div>
          <button onClick={onFechar} title="Fechar (Esc)"
            className="ml-auto rounded-md px-2 py-1 text-lg leading-none text-graf-500
                       hover:text-graf-200">×</button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {ok && <Alerta tipo="ok">{ok}</Alerta>}

          {/* ---------- cliente ---------- */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-500">
              Cliente
            </h3>
            <div className="flex gap-2">
              <input value={busca} onChange={e => setBusca(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); procurar() } }}
                placeholder="Pesquisar por contrato ou nome — copia o cadastro de um atendimento anterior"
                className={`${campo} flex-1`} />
              <button onClick={procurar} disabled={busca.trim().length < 3}
                className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                           hover:border-af-600 hover:text-af-400 disabled:opacity-40">
                {buscando ? 'Buscando…' : 'Buscar'}
              </button>
            </div>

            {achados.length > 0 && (
              <div className="mt-2 space-y-1 rounded-lg border border-graf-700 bg-graf-900 p-1.5">
                {achados.map((a, i) => (
                  <button key={i} onClick={() => usar(a)}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs
                               hover:bg-graf-800">
                    <span className="tabular font-medium">{a.contrato ?? '—'}</span>
                    <span className="ml-2 text-graf-300">{a.cliente_nome ?? 'sem nome'}</span>
                    <span className="ml-2 text-graf-500">
                      {[a.logradouro, a.bairro].filter(Boolean).join(', ')}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <label className="text-[11px] text-graf-400 sm:col-span-1">
                <span className="mb-1 block">Contrato *</span>
                <input value={f.contrato} onChange={e => set('contrato', e.target.value)}
                  className={`${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-400 sm:col-span-2">
                <span className="mb-1 block">Nome do cliente</span>
                <input value={f.cliente_nome} onChange={e => set('cliente_nome', e.target.value)}
                  className={`${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Tipo de pessoa</span>
                <select value={f.tipo_pessoa} onChange={e => set('tipo_pessoa', e.target.value)}
                  className={`${campo} w-full`}>
                  <option value="">—</option>
                  <option value="FISICA">Física</option>
                  <option value="JURIDICA">Jurídica</option>
                </select>
              </label>
              <label className="text-[11px] text-graf-400 sm:col-span-2">
                <span className="mb-1 block">Endereço</span>
                <input value={f.logradouro} onChange={e => set('logradouro', e.target.value)}
                  className={`${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Complemento</span>
                <input value={f.complemento} onChange={e => set('complemento', e.target.value)}
                  className={`${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-400">
                {/* Edificação decide a pontuação (D-045). Vale pedir aqui. */}
                <span className="mb-1 block">Edificação</span>
                <select value={f.tipo_residencia}
                  onChange={e => set('tipo_residencia', e.target.value)}
                  className={`${campo} w-full`}>
                  <option value="">—</option>
                  <option value="CASA">Casa</option>
                  <option value="APTO">Apartamento</option>
                  <option value="COMERCIAL">Comercial</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </label>
              {([['bairro', 'Bairro'], ['cep', 'CEP'], ['cidade', 'Cidade'],
                 ['uf', 'UF'], ['node', 'Node'],
                 ['telefones', 'Telefones (separe por vírgula)']] as const).map(([k, rot]) => (
                <label key={k} className={`text-[11px] text-graf-400 ${
                  k === 'telefones' ? 'sm:col-span-2' : ''}`}>
                  <span className="mb-1 block">{rot}</span>
                  <input value={f[k]} onChange={e => set(k, e.target.value)}
                    className={`${campo} w-full`} />
                </label>
              ))}
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Área</span>
                <select value={f.area_id} onChange={e => set('area_id', e.target.value)}
                  className={`${campo} w-full`}>
                  <option value="">—</option>
                  {areas.map(a => (
                    <option key={a.id} value={a.id}>{a.apelido ?? a.codigo}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* ---------- ordens de serviço ---------- */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-500">
              Ordens de serviço
              <span className="ml-2 font-normal normal-case tracking-normal text-graf-600">
                uma visita tem de 1 a 10 (D-001) — o caso comum é 2
              </span>
            </h3>

            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Tipo de O.S.</span>
                <select value={novaTipo} className={`${campo} w-72`}
                  onChange={e => {
                    setNovaTipo(e.target.value)
                    const t = tiposOS.find(x => x.id === e.target.value)
                    if (t) setNovaDescricao(t.descricao)
                  }}>
                  <option value="">— escolha —</option>
                  {tiposOS.map(t => (
                    <option key={t.id} value={t.id}>{t.codigo} · {t.descricao}</option>
                  ))}
                </select>
              </label>
              <label className="min-w-52 flex-1 text-[11px] text-graf-400">
                <span className="mb-1 block">Descrição</span>
                <input value={novaDescricao} onChange={e => setNovaDescricao(e.target.value)}
                  placeholder="ADESAO - INSTALACAO DE ASSINATURA"
                  className={`${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Número (opcional)</span>
                <input value={novaNumero} onChange={e => setNovaNumero(e.target.value)}
                  placeholder="gerado" className={`${campo} w-32`} />
              </label>
              <button onClick={inserirOS} disabled={!novaTipo && !novaDescricao.trim()}
                className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                           hover:border-af-600 hover:text-af-400 disabled:opacity-40">
                + Inserir
              </button>
            </div>

            {/* A regra de pontuação é a COMBINAÇÃO de tipos de O.S. × edificação
                (D-045), e `assinatura_da_visita` monta essa combinação pelo
                tipo_os. O.S. só com descrição livre não casa com regra
                nenhuma — o contrato entra valendo zero e ninguém percebe. */}
            {ordens.some(o => !o.tipo_os_id) && (
              <p className="mt-2 rounded-md border border-amber-700/60 bg-amber-900/20
                            px-3 py-2 text-[11px] text-amber-200">
                Há O.S. sem <strong>Tipo de O.S.</strong> A pontuação é calculada pela
                combinação dos tipos com a edificação; sem o tipo, este contrato sai
                sem pontos no relatório. A descrição sozinha não pontua.
              </p>
            )}

            <div className="mt-2 overflow-hidden rounded-lg border border-graf-700">
              <table className="w-full text-xs">
                <thead className="bg-graf-900 text-left uppercase tracking-wide text-graf-500">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">#</th>
                    <th className="px-2.5 py-1.5 font-medium">Número</th>
                    <th className="px-2.5 py-1.5 font-medium">Ordem de serviço</th>
                    <th className="px-2.5 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {ordens.length === 0 && (
                    <tr><td colSpan={4} className="px-2.5 py-4 text-center text-graf-600">
                      Nenhuma O.S. ainda — acrescente pelo menos uma.
                    </td></tr>
                  )}
                  {ordens.map((o, i) => (
                    <tr key={o.chave} className="border-t border-graf-800">
                      <td className="tabular px-2.5 py-1.5 text-graf-500">{i + 1}</td>
                      <td className="tabular px-2.5 py-1.5">
                        {o.numero_os || <span className="text-graf-600">gerado ao salvar</span>}
                      </td>
                      <td className="px-2.5 py-1.5 text-graf-300">{o.descricao || '—'}</td>
                      <td className="px-2.5 py-1.5 text-right">
                        <button onClick={() => setOrdens(l => l.filter(x => x.chave !== o.chave))}
                          className="text-graf-500 hover:text-af-400">remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------- agendamento ---------- */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-graf-500">
              Agendamento
            </h3>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Grupo de serviço</span>
                <select value={f.tipo_servico_id}
                  onChange={e => set('tipo_servico_id', e.target.value)}
                  className={`${campo} w-full`}>
                  <option value="">—</option>
                  {servicos.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Data de agendamento</span>
                <input type="date" value={f.data_agendada}
                  onChange={e => set('data_agendada', e.target.value)}
                  className={`tabular ${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Período</span>
                <select className={`${campo} w-full`}
                  value={f.janela_inicio && f.janela_fim
                    ? `${f.janela_inicio}-${f.janela_fim}` : ''}
                  onChange={e => {
                    const [a, b] = e.target.value.split('-')
                    set('janela_inicio', a ?? ''); set('janela_fim', b ?? '')
                  }}>
                  <option value="">—</option>
                  {PERIODOS.map(p => <option key={p} value={p}>{p.replace('-', ' – ')}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">Equipe</span>
                <select value={f.equipe_id} onChange={e => set('equipe_id', e.target.value)}
                  className={`${campo} w-full`}>
                  <option value="">— entra na fila sem equipe —</option>
                  {equipes.map(e2 => (
                    <option key={e2.id} value={e2.id}>{e2.codigo} · {e2.nome}</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-graf-400">
                <span className="mb-1 block">WO — TOA (se houver)</span>
                <input value={f.wo_numero} onChange={e => set('wo_numero', e.target.value)}
                  className={`${campo} w-full`} />
              </label>
              <label className="text-[11px] text-graf-500">
                <span className="mb-1 block">Data de abertura</span>
                <input value={new Date().toLocaleDateString('pt-BR')} disabled
                  className={`${campo} w-full opacity-60`} />
              </label>
              <label className="text-[11px] text-graf-400 sm:col-span-2">
                <span className="mb-1 block">Observação</span>
                <input value={f.observacao} onChange={e => set('observacao', e.target.value)}
                  className={`${campo} w-full`} />
              </label>
            </div>
            <p className="mt-1.5 text-[11px] text-graf-600">
              A data de abertura é a de hoje e não se edita: a planilha do TOA não traz
              esse campo, então guardá-lo separado daria uma coluna vazia em 100% do
              que é importado. Ela é o <code>criado_em</code> do contrato.
            </p>
          </section>
        </div>

        <div className="flex items-center gap-3 border-t border-graf-800 px-5 py-3">
          <p className="text-[11px] text-graf-500">
            {ordens.length === 0
              ? 'Acrescente ao menos uma O.S.'
              : !f.contrato.trim()
                ? 'Informe o número do contrato.'
                : `${ordens.length} O.S. neste contrato.`}
          </p>
          <button onClick={onFechar}
            className="ml-auto rounded-md border border-graf-700 px-4 py-1.5 text-xs
                       text-graf-300 hover:border-graf-600">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!podeSalvar}
            className="rounded-lg bg-af-600 px-5 py-1.5 text-xs font-semibold text-white
                       hover:bg-af-500 disabled:opacity-50">
            {ocupado ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
