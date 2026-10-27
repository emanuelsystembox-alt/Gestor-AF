import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { isoLocal, equipeRotulo } from '../lib/formato'
import { useAuth } from '../lib/auth'
import {
  DESFECHOS, DESFECHO_POR_CHAVE, TRIAGEM, naTriagem, ehProblema,
  SITUACAO_CONTRATO, linkWhatsApp, formataTel, pct, num1, num2,
  type Triagem,
} from '../lib/qualidade'

/**
 * A central de QUALIDADE (147, reescrita na 148/149).
 *
 * > "precisa melhorar nessa central de qualidade (...) a nossa não tem
 * >  filtro, tá bem simples. E as palavras parece meio amadoras (...)
 * >  precisa usar palavras mais técnicas e mais bonitas para o sistema
 * >  (...) depois mostrar um gráfico do mês, qual é o login que está
 * >  ativando" — Emanuel, 26/10, com a central dele aberta na tela
 *
 * ┌─ duas abas, dois públicos ────────────────────────────────────────┐
 * │ LIGAÇÕES DO DIA é do analista: a fila, os cinco filtros e o       │
 * │ registro. Ele passa o dia inteiro aqui, então o filtro roda no    │
 * │ cliente — são ~300 linhas, e ida ao servidor a cada clique        │
 * │ custaria mais do que a consulta inteira.                          │
 * │                                                                     │
 * │ PAINEL é da coordenação: produção por analista, meta dia a dia e  │
 * │ os indicadores do período. É o "gráfico do mês" pedido.           │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ por que não existe card de NPS ──────────────────────────────────┐
 * │ A central dele mostra "NPS interno 84" — e lá a nota é de 0 a 10. │
 * │ Aqui o Emanuel preferiu manter 1 a 5. NPS é DEFINIDO em 0-10      │
 * │ (promotores 9-10 menos detratores 0-6); fazer a mesma conta em    │
 * │ 1-5 e chamar de NPS seria dar nome errado a um número. No lugar   │
 * │ vai SATISFAÇÃO — o percentual de notas 4 e 5, que é honesto nesta │
 * │ escala e mede a mesma coisa.                                      │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ LGPD: `telefone` é dado pessoal de assinante. Digitado aqui, fica no
 * banco e nunca sai em planilha nem em print.
 */

interface Linha {
  visita_id: string; contrato: string | null; cliente_nome: string | null
  endereco: string | null; bairro: string | null; grupo: string | null
  situacao_contrato: string; status_toa: string | null; data_agendada: string
  operacao: string | null; equipe: string | null; area: string | null
  tecnico: string | null; tecnico_id: string | null; encerrou: string | null
  janela: string | null; baixa_codigo: number | null; baixa_descricao: string | null
  baixa_natureza: string | null; contador_log: number | null; tem_improdutiva: boolean
  desfecho: string | null; canal: string | null; telefone: string | null
  nota_tecnico: number | null; tratou_bem: boolean | null; observacao: string | null
  tentativas: number; registrado_em: string | null; analista: string | null
}

interface Indicadores {
  na_fila: number; avaliados: number; pendentes: number; contatados: number
  conclusivos: number; normalizado: number; problemas: number; rede_externa: number
  pct_cobertura: number | null; pct_contato: number | null; pct_conformidade: number | null
  nota_media: number | null; com_nota: number; pct_satisfacao: number | null
  reclamacao_conduta: number; com_observacao: number
}

interface Analista {
  usuario_id: string; analista: string; hoje: number; meta_diaria: number
  avaliados: number; dias: number; media_dia: number | null; dias_na_meta: number
  contatados: number; problemas: number; pct_conformidade: number | null
  nota_media: number | null; ultima: string | null
}

interface MetaDia {
  usuario_id: string; analista: string; dia: string
  quantos: number; meta_diaria: number; na_meta: boolean
}

interface PorGrupo {
  operacao: string | null; chave: string; avaliados: number; problemas: number
  pct_conformidade: number | null; nota_media: number | null
}

const hhmm = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
const diaBr = (d: string) =>
  new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

const sel = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs text-graf-200 '
          + 'focus:border-af-600 focus:outline-none'

// ================================================================== //

export default function Qualidade() {
  const { pode } = useAuth()
  const podeRegistrar = pode('qualidade.registrar')

  const [aba, setAba] = useState<'FILA' | 'PAINEL'>('FILA')
  const [de, setDe] = useState(isoLocal())
  const [ate, setAte] = useState(isoLocal())

  return (
    <Shell acoes={
      <span className="flex items-center gap-1 text-[11px] text-graf-400">
        <input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)}
          aria-label="Primeiro dia do período"
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        a
        <input type="date" value={ate} min={de} onChange={e => setAte(e.target.value)}
          aria-label="Último dia do período"
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
      </span>
    }>
      <div className="pagina-entra space-y-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Qualidade</h1>
            <p className="mt-0.5 text-sm text-graf-400">
              Contato pós-atendimento com o assinante.
            </p>
          </div>
          <div className="flex gap-1 rounded-lg bg-graf-850 p-0.5">
            {([['FILA', 'Ligações do dia'], ['PAINEL', 'Painel']] as const).map(([v, r]) => (
              <button key={v} onClick={() => setAba(v)} aria-pressed={aba === v}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${aba === v
                  ? 'bg-graf-900 text-graf-100 shadow-sm' : 'text-graf-400 hover:text-graf-200'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {aba === 'FILA'
          ? <AbaFila de={de} ate={ate} podeRegistrar={podeRegistrar} />
          : <AbaPainel de={de} ate={ate} />}
      </div>
    </Shell>
  )
}

// ================================================================== //
//  ABA 1 · LIGAÇÕES DO DIA
// ================================================================== //

function AbaFila({ de, ate, podeRegistrar }: {
  de: string; ate: string; podeRegistrar: boolean
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  const [triagem, setTriagem] = useState<Triagem>('PENDENTE')
  const [busca, setBusca] = useState('')
  const [fGrupo, setFGrupo] = useState('TODOS')
  const [fSituacao, setFSituacao] = useState('TODAS')
  const [fBaixa, setFBaixa] = useState('TODOS')
  const [fJanela, setFJanela] = useState('TODAS')
  const [fLog, setFLog] = useState('TODOS')

  const recarregar = useCallback(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('qualidade_fila', { p_de: de, p_ate: ate }).then(r => {
      if (!vivo) return
      if (r.error) { setErro(r.error.message); setCarregando(false); return }
      setLinhas((r.data ?? []) as Linha[])
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate])

  useEffect(() => recarregar(), [recarregar])

  /** As opções saem do PERÍODO inteiro, não do que sobrou: lista que
   *  encolhe conforme se filtra deixa a pessoa sem caminho de volta. */
  const opcoes = useMemo(() => ({
    grupos: [...new Set(linhas.map(l => l.grupo).filter(Boolean) as string[])].sort(),
    baixas: [...new Map(linhas.filter(l => l.baixa_codigo != null)
      .map(l => [l.baixa_codigo!, `${l.baixa_codigo} · ${l.baixa_descricao ?? ''}`]))]
      .sort((a, b) => a[0] - b[0]),
    janelas: [...new Set(linhas.map(l => l.janela).filter(Boolean) as string[])].sort(),
  }), [linhas])

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return linhas.filter(l => {
      if (!naTriagem(l.desfecho, triagem)) return false
      if (fGrupo !== 'TODOS' && l.grupo !== fGrupo) return false
      if (fSituacao !== 'TODAS' && l.situacao_contrato !== fSituacao) return false
      if (fBaixa !== 'TODOS' && String(l.baixa_codigo ?? '') !== fBaixa) return false
      if (fJanela !== 'TODAS' && l.janela !== fJanela) return false
      if (fLog !== 'TODOS') {
        const n = l.contador_log
        if (fLog === 'SEM' && n != null) return false
        if (fLog === '0' && n !== 0) return false
        if (fLog === '1-2' && !(n != null && n >= 1 && n <= 2)) return false
        if (fLog === '3+' && !(n != null && n >= 3)) return false
      }
      if (!q) return true
      return [l.contrato, l.cliente_nome, l.endereco, l.bairro, l.tecnico,
              l.equipe, l.telefone, l.operacao]
        .some(x => (x ?? '').toLowerCase().includes(q))
    })
  }, [linhas, triagem, busca, fGrupo, fSituacao, fBaixa, fJanela, fLog])

  const contagem = useMemo(() => Object.fromEntries(
    TRIAGEM.map(t => [t.v, linhas.filter(l => naTriagem(l.desfecho, t.v)).length]),
  ) as Record<Triagem, number>, [linhas])

  const avaliados = linhas.filter(l => l.desfecho != null).length
  const temFiltro = fGrupo !== 'TODOS' || fSituacao !== 'TODAS' || fBaixa !== 'TODOS'
    || fJanela !== 'TODAS' || fLog !== 'TODOS' || busca.trim() !== ''
  const limpar = () => {
    setFGrupo('TODOS'); setFSituacao('TODAS'); setFBaixa('TODOS')
    setFJanela('TODAS'); setFLog('TODOS'); setBusca('')
  }

  return (<>
    {erro && <Alerta tipo="erro">{erro}</Alerta>}

    {/* ---------- avanço do período ---------- */}
    <div className="card-controle p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <strong className="tabular">{avaliados}</strong> de{' '}
          <strong className="tabular">{linhas.length}</strong> contratos avaliados
          {linhas.length > 0 && (
            <span className="ml-1 text-graf-400">
              · {Math.round((avaliados / linhas.length) * 100)}%
            </span>
          )}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-graf-800">
        <div className="h-full rounded-full bg-af-500 transition-all"
          style={{ width: linhas.length ? `${(avaliados / linhas.length) * 100}%` : '0%' }} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {TRIAGEM.map(t => (
          <button key={t.v} onClick={() => setTriagem(t.v)} aria-pressed={triagem === t.v}
            style={{ ['--pill-cor' as string]: t.cor }}
            className={`pill ${triagem === t.v ? '' : 'pill-apagada'}`}>
            {t.r} <span className="tabular font-bold opacity-80">{contagem[t.v]}</span>
          </button>
        ))}
      </div>
    </div>

    {/* ---------- os cinco filtros ---------- */}
    <div className="card-controle space-y-2 p-3">
      <input value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="Contrato, cliente, endereço, equipe, técnico ou telefone"
        className="w-full rounded-md border border-graf-700 bg-graf-900 px-3 py-2 text-sm" />

      <div className="flex flex-wrap items-center gap-2">
        <select value={fGrupo} onChange={e => setFGrupo(e.target.value)}
          aria-label="Filtrar por tipo de serviço" className={sel}>
          <option value="TODOS">Tipo de serviço</option>
          {opcoes.grupos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        <select value={fSituacao} onChange={e => setFSituacao(e.target.value)}
          aria-label="Filtrar por situação do contrato" className={sel}>
          <option value="TODAS">Situação</option>
          {Object.entries(SITUACAO_CONTRATO).map(([v, r]) => (
            <option key={v} value={v}>{r}</option>))}
        </select>

        <select value={fBaixa} onChange={e => setFBaixa(e.target.value)}
          aria-label="Filtrar por código de baixa" className={`${sel} max-w-64`}>
          <option value="TODOS">Código de baixa</option>
          {opcoes.baixas.map(([c, r]) => <option key={c} value={String(c)}>{r}</option>)}
        </select>

        <select value={fJanela} onChange={e => setFJanela(e.target.value)}
          aria-label="Filtrar por janela" className={sel}>
          <option value="TODAS">Janela</option>
          {opcoes.janelas.map(j => <option key={j} value={j}>{j}</option>)}
        </select>

        {/* O LOG é o contador de retornos do TOA (D-224). */}
        <select value={fLog} onChange={e => setFLog(e.target.value)}
          aria-label="Filtrar por LOG" className={sel}>
          <option value="TODOS">LOG</option>
          <option value="0">LOG 0 — nunca voltou</option>
          <option value="1-2">LOG 1 ou 2</option>
          <option value="3+">LOG 3 ou mais — reincidente</option>
          <option value="SEM">Sem LOG na planilha</option>
        </select>

        {temFiltro && (
          <>
            <span className="tabular text-[11px] text-graf-400">
              {filtradas.length} de {linhas.length}
            </span>
            <button onClick={limpar}
              className="text-[11px] text-af-400 underline-offset-2 hover:underline">
              Limpar filtros
            </button>
          </>
        )}
      </div>
    </div>

    {/* ---------- a fila ---------- */}
    {carregando ? (
      <p className="py-16 text-center text-graf-400" role="status">Carregando a fila…</p>
    ) : filtradas.length === 0 ? (
      <Vazio titulo={triagem === 'PENDENTE' && contagem.TODOS > 0 && !temFiltro
        ? 'Período concluído' : 'Nenhum contrato nesta seleção'}
        descricao={triagem === 'PENDENTE' && contagem.TODOS > 0 && !temFiltro
          ? `Todos os ${contagem.TODOS} contratos do período já foram avaliados.`
          : 'Ajuste a triagem ou os filtros acima.'}
        acao={temFiltro ? (
          <button onClick={limpar}
            className="rounded-lg border border-graf-700 px-4 py-2 text-sm text-graf-300
                       hover:border-af-600 hover:text-af-400">Limpar filtros</button>
        ) : undefined} />
    ) : (
      <div className="card-controle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px]
                            uppercase tracking-wide text-graf-400">
            <tr>
              <th className="px-3 py-2 font-medium">Contrato</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Serviço · Equipe</th>
              <th className="px-3 py-2 font-medium">Baixa</th>
              <th className="px-3 py-2 font-medium">Desfecho</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(l => (
              <LinhaFila key={l.visita_id} l={l}
                aberto={aberto === l.visita_id}
                podeRegistrar={podeRegistrar}
                aoAbrir={() => setAberto(a => a === l.visita_id ? null : l.visita_id)}
                aoSalvar={() => { setAberto(null); recarregar() }} />
            ))}
          </tbody>
        </table>
      </div>
    )}
  </>)
}

function LinhaFila({ l, aberto, podeRegistrar, aoAbrir, aoSalvar }: {
  l: Linha; aberto: boolean; podeRegistrar: boolean
  aoAbrir: () => void; aoSalvar: () => void
}) {
  const d = l.desfecho ? DESFECHO_POR_CHAVE[l.desfecho] : null
  return (<>
    <tr onClick={aoAbrir}
      className={`cursor-pointer border-b border-graf-800/60 align-top hover:bg-graf-900/60
                  ${aberto ? 'bg-graf-900' : ''}`}>
      <td className="tabular px-3 py-2.5 font-semibold">
        {l.contrato ?? '—'}
        {l.contador_log != null && l.contador_log > 0 && (
          <span title={`LOG ${l.contador_log} — já voltou para a agenda`}
            className="tabular ml-1.5 rounded bg-graf-800 px-1 text-[10px] font-medium text-graf-300">
            LOG {l.contador_log}
          </span>
        )}
      </td>
      <td className="max-w-56 truncate px-3 py-2.5" title={l.cliente_nome ?? ''}>
        {l.cliente_nome ?? <span className="text-graf-500">sem nome na planilha</span>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium">{l.grupo ?? '—'}</span>
          <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[10px] text-graf-300">
            {SITUACAO_CONTRATO[l.situacao_contrato] ?? l.situacao_contrato}
          </span>
          {l.tem_improdutiva && (
            <span title="Teve O.S. improdutiva" className="text-[11px] text-amber-400">▲</span>
          )}
        </div>
        <div className="text-[11px] text-graf-400">
          {[l.equipe && equipeRotulo(l.equipe), l.operacao, l.area].filter(Boolean).join(' · ')}
        </div>
      </td>
      <td className="px-3 py-2.5 text-[11px]">
        <div className="text-graf-300">
          {l.encerrou ? `Baixa ${hhmm(l.encerrou)}` : 'sem encerramento'}
          {l.janela && <span className="text-graf-500"> · janela {l.janela}</span>}
        </div>
        <div className={l.baixa_natureza === 'IMPRODUTIVA' ? 'text-amber-400' : 'text-graf-500'}>
          {l.baixa_codigo != null
            ? `${l.baixa_codigo} · ${l.baixa_descricao ?? ''}`
            : 'sem código de baixa'}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: 'var(--color-graf-800)', color: d?.cor ?? 'var(--color-graf-400)' }}>
          {d?.r ?? 'Pendente'}
        </span>
        {l.nota_tecnico != null && (
          <div className="tabular text-[11px] text-amber-300">{'★'.repeat(l.nota_tecnico)}</div>
        )}
      </td>
    </tr>
    {aberto && (
      <tr><td colSpan={5} className="border-b border-graf-800 bg-graf-900/40 p-0">
        <Registro l={l} podeRegistrar={podeRegistrar} aoSalvar={aoSalvar} />
      </td></tr>
    )}
  </>)
}

// ================================================================== //
//  O REGISTRO DA LIGAÇÃO
// ================================================================== //

function Registro({ l, podeRegistrar, aoSalvar }: {
  l: Linha; podeRegistrar: boolean; aoSalvar: () => void
}) {
  const [tel, setTel] = useState(l.telefone ?? '')
  const [canal, setCanal] = useState(l.canal ?? 'LIGACAO')
  const [desfecho, setDesfecho] = useState<string | null>(l.desfecho)
  const [nota, setNota] = useState<number | null>(l.nota_tecnico)
  const [tratouBem, setTratouBem] = useState<boolean | null>(l.tratou_bem)
  const [observacao, setObservacao] = useState(l.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const wa = tel ? linkWhatsApp(tel, l.contrato) : null
  // A pesquisa só faz sentido com quem atendeu — nos outros desfechos a
  // tela nem oferece, em vez de aceitar nota de quem não falou.
  const houveConversa = !!desfecho && DESFECHO_POR_CHAVE[desfecho]?.contatado
    && desfecho !== 'NAO_QUIS_RESPONDER'

  async function gravar() {
    if (!desfecho) return
    setSalvando(true); setErro(null)
    // D-061: `usuario_id` NÃO vai daqui — quem carimba o autor é o servidor.
    const { error } = await supabase.rpc('registrar_qualidade', {
      p_visita_id: l.visita_id,
      p_desfecho: desfecho,
      p_canal: canal,
      p_telefone: tel || null,
      p_nota: houveConversa ? nota : null,
      p_tratou_bem: houveConversa ? tratouBem : null,
      p_observacao: observacao || null,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    aoSalvar()
  }

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-graf-400">
        <span>{l.endereco ?? 'sem endereço'}{l.bairro ? ` · ${l.bairro}` : ''}</span>
        {l.tecnico && <span>Técnico {l.tecnico}</span>}
        {l.tentativas > 0 && (
          <span className="text-graf-300">
            {l.tentativas} registro(s){l.analista ? ` · último por ${l.analista}` : ''}
          </span>
        )}
        <Link to={`/controle/visita/${l.visita_id}`}
          className="text-af-400 underline-offset-2 hover:underline">abrir o contrato →</Link>
      </div>

      {/* ---- contato ---- */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-graf-400">
          <span className="block">Telefone do assinante</span>
          <input value={tel} onChange={e => setTel(e.target.value)}
            onBlur={() => setTel(t => formataTel(t))}
            placeholder="(92) 99999-9999" inputMode="tel" disabled={!podeRegistrar}
            className="tabular mt-0.5 w-44 rounded-md border border-graf-700 bg-graf-900
                       px-2 py-1 text-sm" />
        </label>
        <div className="flex gap-1">
          {(['LIGACAO', 'WHATSAPP'] as const).map(c => (
            <button key={c} onClick={() => setCanal(c)} aria-pressed={canal === c}
              disabled={!podeRegistrar}
              className={`rounded-md px-2 py-1 text-xs ${canal === c
                ? 'bg-af-600 font-semibold text-white'
                : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
              {c === 'LIGACAO' ? 'Ligação' : 'WhatsApp'}
            </button>
          ))}
        </div>
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer"
            className="rounded-md border border-emerald-700/60 px-2 py-1 text-xs
                       text-emerald-300 hover:bg-emerald-900/30">Abrir no WhatsApp ↗</a>
        )}
        {!l.telefone && (
          <span className="text-[11px] text-graf-500">
            o TOA não envia telefone — busque no sistema da CLARO; o número fica guardado
          </span>
        )}
      </div>

      {/* ---- o desfecho ---- */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-graf-300">Desfecho do contato</p>
        <div className="flex flex-wrap gap-1.5">
          {DESFECHOS.map(d => (
            <button key={d.v} onClick={() => setDesfecho(d.v)} disabled={!podeRegistrar}
              aria-pressed={desfecho === d.v} title={d.quando}
              style={desfecho === d.v ? { background: d.cor, color: '#0f1115' } : undefined}
              className={`rounded-md px-2 py-1 text-xs font-medium ${desfecho === d.v
                ? '' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
              {d.r}
            </button>
          ))}
        </div>
        {desfecho && (
          <p className="mt-1.5 text-[11px] text-graf-400">{DESFECHO_POR_CHAVE[desfecho]?.quando}</p>
        )}
      </div>

      {/* ---- a pesquisa, só quando houve conversa ---- */}
      {houveConversa && (
        <div className="grid gap-3 border-t border-graf-800 pt-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-graf-300">
              Que nota o assinante dá para o técnico? <span className="text-graf-500">(1 a 5)</span>
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setNota(n)} disabled={!podeRegistrar}
                  aria-label={`${n} de 5`} aria-pressed={nota === n}
                  className={`text-xl leading-none ${nota != null && n <= nota
                    ? 'text-amber-300' : 'text-graf-600 hover:text-graf-400'}`}>★</button>
              ))}
              {nota != null && (
                <button onClick={() => setNota(null)} disabled={!podeRegistrar}
                  className="ml-1 text-[11px] text-graf-400 hover:text-af-400">limpar</button>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs text-graf-300">
              O técnico se identificou e tratou o assinante com respeito?
            </p>
            <div className="flex gap-1">
              {([[true, 'Sim'], [false, 'Não']] as const).map(([v, r]) => (
                <button key={r} onClick={() => setTratouBem(v)} disabled={!podeRegistrar}
                  aria-pressed={tratouBem === v}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${tratouBem === v
                    ? (v ? 'bg-emerald-700 text-white' : 'bg-af-600 text-white')
                    : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>{r}</button>
              ))}
              {tratouBem != null && (
                <button onClick={() => setTratouBem(null)} disabled={!podeRegistrar}
                  className="ml-1 text-[11px] text-graf-400 hover:text-af-400">limpar</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- observação ---- */}
      <div>
        <p className="mb-1 text-xs text-graf-300">
          Observação <span className="text-graf-500">— o que o assinante disse, nas palavras dele</span>
        </p>
        <input value={observacao} onChange={e => setObservacao(e.target.value)}
          disabled={!podeRegistrar}
          className="w-full rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-sm" />
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {podeRegistrar ? (
        <div className="flex items-center gap-2 border-t border-graf-800 pt-2.5">
          <button onClick={gravar} disabled={salvando || !desfecho}
            title={desfecho ? undefined : 'Escolha o desfecho do contato'}
            className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-af-500 disabled:opacity-40">
            {salvando ? 'Registrando…' : 'Registrar e seguir'}
          </button>
          {!desfecho && (
            <span className="text-[11px] text-graf-500">escolha o desfecho acima</span>
          )}
        </div>
      ) : (
        <p className="border-t border-graf-800 pt-2.5 text-[11px] text-graf-400">
          Você tem acesso de leitura. Registrar exige a permissão
          <strong className="text-graf-300"> qualidade.registrar</strong>.
        </p>
      )}
    </div>
  )
}

// ================================================================== //
//  ABA 2 · PAINEL
// ================================================================== //

function AbaPainel({ de, ate }: { de: string; ate: string }) {
  const [ind, setInd] = useState<Indicadores | null>(null)
  const [analistas, setAnalistas] = useState<Analista[]>([])
  const [grade, setGrade] = useState<MetaDia[]>([])
  const [equipes, setEquipes] = useState<PorGrupo[]>([])
  const [tipos, setTipos] = useState<PorGrupo[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [soProblemas, setSoProblemas] = useState(false)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    Promise.all([
      supabase.rpc('qualidade_indicadores', { p_de: de, p_ate: ate }),
      supabase.rpc('qualidade_por_analista', { p_de: de, p_ate: ate }),
      supabase.rpc('qualidade_meta_dia', { p_de: de, p_ate: ate }),
      supabase.rpc('qualidade_por_grupo', { p_de: de, p_ate: ate, p_eixo: 'EQUIPE' }),
      supabase.rpc('qualidade_por_grupo', { p_de: de, p_ate: ate, p_eixo: 'SERVICO' }),
      supabase.rpc('qualidade_observacoes', { p_de: de, p_ate: ate }),
    ]).then(([i, a, g, e, t, o]) => {
      if (!vivo) return
      const err = [i, a, g, e, t, o].find(x => x.error)
      if (err) { setErro(err.error!.message); setCarregando(false); return }
      setInd(((i.data ?? [])[0] ?? null) as Indicadores | null)
      setAnalistas((a.data ?? []) as Analista[])
      setGrade((g.data ?? []) as MetaDia[])
      setEquipes((e.data ?? []) as PorGrupo[])
      setTipos((t.data ?? []) as PorGrupo[])
      setLinhas((o.data ?? []) as unknown as Linha[])
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate])

  const dias = useMemo(
    () => [...new Set(grade.map(g => g.dia))].sort(), [grade])
  const porAnalistaDia = useMemo(() => {
    const m = new Map<string, MetaDia>()
    for (const g of grade) m.set(`${g.usuario_id}|${g.dia}`, g)
    return m
  }, [grade])

  const obs = useMemo(
    () => soProblemas ? linhas.filter(l => ehProblema(l.desfecho)) : linhas,
    [linhas, soProblemas])

  if (carregando) return <p className="py-16 text-center text-graf-400" role="status">Carregando o painel…</p>
  if (erro) return <Alerta tipo="erro">{erro}</Alerta>
  if (!ind || ind.na_fila === 0) {
    return <Vazio titulo="Sem contratos no período"
      descricao="Nenhum contrato avaliável nas datas escolhidas." />
  }

  const metaDiaria = analistas[0]?.meta_diaria ?? 70

  return (<>
    {/* ---------- os indicadores ---------- */}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Card titulo="Cobertura" valor={pct(ind.pct_cobertura)}
        nota={`${ind.avaliados} de ${ind.na_fila} contratos`} />
      <Card titulo="Contato" valor={pct(ind.pct_contato)}
        nota={`${ind.contatados} contatados`} />
      <Card titulo="Conformidade" valor={pct(ind.pct_conformidade)}
        cor={ind.pct_conformidade == null ? undefined
          : ind.pct_conformidade >= 90 ? 'var(--st-concluida)' : 'var(--st-reagendamento)'}
        nota={`${ind.normalizado} de ${ind.conclusivos} conclusivos`} />
      <Card titulo="Nota média" valor={num2(ind.nota_media)}
        nota={`${ind.com_nota} nota(s), de 1 a 5`} />
      {/* Não é NPS: NPS é definido em 0-10 e aqui a escala é 1-5. */}
      <Card titulo="Satisfação" valor={pct(ind.pct_satisfacao)}
        nota="notas 4 e 5 sobre o total" />
      <Card titulo="Problemas" valor={String(ind.problemas)}
        cor={ind.problemas > 0 ? 'var(--st-conflito)' : 'var(--st-concluida)'}
        nota={`${ind.rede_externa} rede externa (fora da conta) · ${ind.reclamacao_conduta} de conduta`} />
    </div>

    {/* ---------- produção por analista ---------- */}
    <section className="card-controle overflow-hidden">
      <div className="border-b border-graf-800 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Produção por analista</h2>
        <p className="mt-0.5 text-[11px] text-graf-500">
          Meta de produção: <strong className="tabular text-graf-300">{metaDiaria}</strong>{' '}
          clientes por dia, por analista. Contada pelo dia em que se ligou, não pelo dia do contrato.
        </p>
      </div>
      {analistas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-graf-400">Nenhuma ligação registrada no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Analista</th>
                <th className="px-3 py-2 text-right font-medium">Hoje</th>
                <th className="px-3 py-2 text-right font-medium">Média/dia</th>
                <th className="px-3 py-2 text-right font-medium">Dias na meta</th>
                <th className="px-3 py-2 text-right font-medium">Avaliados</th>
                <th className="px-3 py-2 text-right font-medium">Contatados</th>
                <th className="px-3 py-2 text-right font-medium">Problemas</th>
                <th className="px-3 py-2 text-right font-medium">Conformidade</th>
                <th className="px-3 py-2 text-right font-medium">Nota média</th>
                <th className="px-3 py-2 text-right font-medium">Último registro</th>
              </tr>
            </thead>
            <tbody>
              {analistas.map(a => (
                <tr key={a.usuario_id} className="border-b border-graf-800/60 hover:bg-graf-900/60">
                  <td className="px-3 py-2 font-medium">{a.analista}</td>
                  <td className="tabular px-3 py-2 text-right">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${a.hoje >= a.meta_diaria
                      ? 'bg-emerald-900/40 text-emerald-300' : 'bg-graf-800 text-graf-300'}`}>
                      {a.hoje}/{a.meta_diaria}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{num1(a.media_dia)}</td>
                  <td className="tabular px-3 py-2 text-right text-xs text-graf-400">
                    {a.dias_na_meta} de {a.dias}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{a.avaliados}</td>
                  <td className="tabular px-3 py-2 text-right">{a.contatados}</td>
                  <td className="tabular px-3 py-2 text-right">
                    <span className={a.problemas > 0 ? 'text-af-300' : 'text-graf-400'}>
                      {a.problemas}</span>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{pct(a.pct_conformidade)}</td>
                  <td className="tabular px-3 py-2 text-right">{num2(a.nota_media)}</td>
                  <td className="tabular px-3 py-2 text-right text-xs text-graf-400">
                    {a.ultima ? `${diaBr(a.ultima.slice(0, 10))} ${hhmm(a.ultima)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    {/* ---------- meta dia a dia ---------- */}
    {dias.length > 0 && (
      <section className="card-controle overflow-hidden">
        <div className="border-b border-graf-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold">Meta dia a dia</h2>
          <p className="mt-0.5 text-[11px] text-graf-500">
            Verde: bateu os {metaDiaria} do dia. Célula vazia: não houve registro — e
            isso é diferente de zero.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="px-3 py-2 font-medium">Analista</th>
                {dias.map(d => (
                  <th key={d} className="tabular px-2 py-2 text-center font-medium">{diaBr(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analistas.map(a => (
                <tr key={a.usuario_id} className="border-b border-graf-800/60">
                  <td className="px-3 py-1.5">{a.analista}</td>
                  {dias.map(d => {
                    const c = porAnalistaDia.get(`${a.usuario_id}|${d}`)
                    return (
                      <td key={d} className="px-2 py-1.5 text-center">
                        {c ? (
                          <span className={`tabular inline-block min-w-8 rounded-full px-2 py-0.5
                                            text-xs font-medium ${c.na_meta
                            ? 'bg-emerald-900/40 text-emerald-300'
                            : 'bg-af-900/30 text-af-300'}`}>{c.quantos}</span>
                        ) : <span className="text-graf-700">·</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}

    {/* ---------- rankings ---------- */}
    <div className="grid gap-3 lg:grid-cols-2">
      <Ranking titulo="Equipes com mais problemas" rotuloChave="Equipe"
        comOperacao linhas={equipes.slice(0, 12)} />
      <Ranking titulo="Por tipo de serviço" rotuloChave="Tipo"
        linhas={tipos} />
    </div>

    {/* ---------- observações ---------- */}
    <section className="card-controle overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-graf-800 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Observações registradas</h2>
        <span className="tabular text-[11px] text-graf-500">{obs.length}</span>
        <div className="ml-auto flex gap-1">
          {([[false, 'Todas'], [true, 'Só problemas']] as const).map(([v, r]) => (
            <button key={r} onClick={() => setSoProblemas(v)} aria-pressed={soProblemas === v}
              className={`rounded-md px-2 py-1 text-xs ${soProblemas === v
                ? 'bg-af-600 font-semibold text-white'
                : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>{r}</button>
          ))}
        </div>
      </div>
      {obs.length === 0 ? (
        <p className="px-4 py-6 text-sm text-graf-400">
          Nenhuma observação registrada {soProblemas ? 'em contrato com problema ' : ''}no período.
        </p>
      ) : (
        <ul className="max-h-96 divide-y divide-graf-800/60 overflow-y-auto">
          {obs.slice(0, 120).map(o => {
            const d = o.desfecho ? DESFECHO_POR_CHAVE[o.desfecho] : null
            return (
              <li key={o.visita_id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'var(--color-graf-800)', color: d?.cor ?? 'var(--color-graf-400)' }}>
                    {d?.r ?? '—'}
                  </span>
                  <Link to={`/controle/visita/${o.visita_id}`}
                    className="tabular font-medium underline-offset-2 hover:text-af-400 hover:underline">
                    {o.contrato}
                  </Link>
                  <span className="text-graf-500">
                    {[o.equipe && equipeRotulo(o.equipe), o.operacao, o.grupo, o.analista]
                      .filter(Boolean).join(' · ')}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-graf-200">{o.observacao}</p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  </>)
}

function Card({ titulo, valor, nota, cor }: {
  titulo: string; valor: string; nota: string; cor?: string
}) {
  return (
    <div className="card-controle p-3">
      <div className="text-[11px] uppercase tracking-wide text-graf-400">{titulo}</div>
      <div className="tabular mt-1 text-2xl font-bold leading-none"
        style={cor ? { color: cor } : undefined}>{valor}</div>
      <div className="mt-1 text-[10px] leading-snug text-graf-500">{nota}</div>
    </div>
  )
}

function Ranking({ titulo, rotuloChave, linhas, comOperacao }: {
  titulo: string; rotuloChave: string; linhas: PorGrupo[]; comOperacao?: boolean
}) {
  return (
    <section className="card-controle overflow-hidden">
      <h2 className="border-b border-graf-800 px-4 py-2.5 text-sm font-semibold">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-graf-400">Nada avaliado no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-800 bg-graf-900 text-left text-[11px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                {comOperacao && <th className="px-3 py-2 font-medium">Operação</th>}
                <th className="px-3 py-2 font-medium">{rotuloChave}</th>
                <th className="px-3 py-2 text-right font-medium">Avaliados</th>
                <th className="px-3 py-2 text-right font-medium">Problemas</th>
                <th className="px-3 py-2 text-right font-medium">Conformidade</th>
                <th className="px-3 py-2 text-right font-medium">Nota</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={`${l.operacao}|${l.chave}`}
                  className="border-b border-graf-800/60 hover:bg-graf-900/60">
                  {comOperacao && (
                    <td className="px-3 py-2 text-xs text-graf-400">{l.operacao ?? '—'}</td>
                  )}
                  <td className="px-3 py-2">
                    {rotuloChave === 'Equipe' ? equipeRotulo(l.chave) : l.chave}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{l.avaliados}</td>
                  <td className="tabular px-3 py-2 text-right">
                    <span className={l.problemas > 0 ? 'text-af-300' : 'text-graf-400'}>
                      {l.problemas}</span>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{pct(l.pct_conformidade)}</td>
                  <td className="tabular px-3 py-2 text-right">{num1(l.nota_media)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
