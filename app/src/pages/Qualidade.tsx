import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { isoLocal, equipeRotulo } from '../lib/formato'
import { useAuth } from '../lib/auth'

/**
 * A célula de QUALIDADE (147) — falar com o assinante depois do atendimento.
 *
 * > "essa célula visa falar com os clientes atendidos e depois perguntar
 * >  se foi normalizado, se o técnico tratou bem o assinante, se o cliente
 * >  está com algum problema (...) conforme ele vai fechando o dia ali,
 * >  falando com todos os assinantes, o ideal é sair um gráfico de
 * >  problemas normalizado, não normalizado (...) precisa ser um sistema
 * >  bem fácil de falar com esses clientes do dia" — Emanuel, 26/10
 *
 * ┌─ a tela é uma FILA, não um relatório ─────────────────────────────┐
 * │ O pedido é operacional: alguém senta e liga para 281 pessoas até  │
 * │ fechar o dia. Então o desenho é o de uma fila de trabalho —       │
 * │ pendentes primeiro, um contrato aberto por vez, o telefone e o    │
 * │ WhatsApp a um clique, e as quatro perguntas numa tela só, sem     │
 * │ rolagem. Cada contrato fechado sai da aba "Pendentes" na hora.    │
 * │                                                                     │
 * │ O painel fica EM CIMA e muda a cada resposta: é o "gráfico de      │
 * │ normalizado / não normalizado" que ele pediu, e serve de placar    │
 * │ para quem está trabalhando a fila.                                 │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ não falado NÃO é não normalizado (regra 6) ──────────────────────┐
 * │ O percentual de normalização tem como denominador os FALADOS.     │
 * │ Contar os 281 pendentes como problema diria que o dia inteiro deu │
 * │ errado porque ninguém ligou ainda — mentira com cara de número.   │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ LGPD: `telefone` é dado pessoal de assinante. Ele é digitado aqui,
 * fica no banco e nunca sai em planilha nem em print.
 */

interface Linha {
  visita_id: string
  contrato: string | null
  cliente_nome: string | null
  endereco: string | null
  bairro: string | null
  grupo: string | null
  situacao_contrato: string
  data_agendada: string
  equipe: string | null
  tecnico: string | null
  tecnico_id: string | null
  encerrou: string | null
  tem_improdutiva: boolean
  pq_id: string | null
  situacao: string
  canal: string | null
  telefone: string | null
  funcionou: string | null
  nota_tecnico: number | null
  tratou_bem: boolean | null
  pendencia: string | null
  tentativas: number
  falado_em: string | null
  quem: string | null
}

interface Resumo {
  na_fila: number; falados: number; pendentes: number; sem_sucesso: number
  normalizado: number; parcial: number; nao_normalizado: number
  pct_normalizado: number | null; nota_media: number | null; com_nota: number
  tratou_bem: number; tratou_mal: number; com_pendencia: number
}

/** O que aconteceu na tentativa de falar. PENDENTE é o estado inicial. */
const SITUACOES: { v: string; r: string; cor: string }[] = [
  { v: 'FALADO',        r: 'Falei com o assinante', cor: 'var(--st-concluida)' },
  { v: 'NAO_ATENDE',    r: 'Não atendeu',           cor: 'var(--st-reagendamento)' },
  { v: 'NUMERO_ERRADO', r: 'Número errado',         cor: 'var(--st-cancelada)' },
  { v: 'RECUSOU',       r: 'Recusou responder',     cor: 'var(--st-cancelada)' },
  { v: 'SEM_CONTATO',   r: 'Sem telefone',          cor: 'var(--color-graf-500)' },
]
const ROTULO_SIT: Record<string, string> = {
  PENDENTE: 'Pendente',
  ...Object.fromEntries(SITUACOES.map(s => [s.v, s.r])),
}

/** As três respostas do eixo "normalizou?" — a cor é a do domínio. */
const FUNCIONOU: { v: string; r: string; cor: string }[] = [
  { v: 'SIM',     r: 'Sim, funcionou',  cor: 'var(--st-concluida)' },
  { v: 'PARCIAL', r: 'Em parte',        cor: 'var(--st-reagendamento)' },
  { v: 'NAO',     r: 'Não funcionou',   cor: 'var(--st-cancelada)' },
]

const hora = (iso: string | null) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'

/** Só os dígitos, com o 55 do Brasil — é o que o wa.me aceita. */
function linkWhatsApp(tel: string, contrato: string | null): string | null {
  const d = tel.replace(/\D/g, '')
  if (d.length < 10) return null
  const num = d.startsWith('55') ? d : `55${d}`
  const texto = `Olá! Aqui é da AFLINE, prestadora da CLARO.`
    + ` Passando para saber se o atendimento${contrato ? ` do contrato ${contrato}` : ''}`
    + ` ficou tudo certo. Pode falar agora?`
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`
}

/** 11 dígitos → (92) 99999-9999. Abaixo disso, devolve como veio. */
function formataTel(t: string): string {
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

// ================================================================== //

export default function Qualidade() {
  const { pode } = useAuth()
  const podeRegistrar = pode('qualidade.registrar')

  const [de, setDe] = useState(isoLocal())
  const [ate, setAte] = useState(isoLocal())
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aba, setAba] = useState<'PENDENTE' | 'FALADO' | 'SEM_SUCESSO' | 'TODOS'>('PENDENTE')
  const [busca, setBusca] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)

  const recarregar = useCallback(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    Promise.all([
      supabase.rpc('qualidade_fila', { p_de: de, p_ate: ate }),
      supabase.rpc('qualidade_resumo', { p_de: de, p_ate: ate }),
    ]).then(([f, r]) => {
      if (!vivo) return
      if (f.error || r.error) { setErro((f.error ?? r.error)!.message); setCarregando(false); return }
      setLinhas((f.data ?? []) as Linha[])
      setResumo(((r.data ?? [])[0] ?? null) as Resumo | null)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate])

  useEffect(() => recarregar(), [recarregar])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return linhas.filter(l => {
      if (aba === 'PENDENTE' && l.situacao !== 'PENDENTE') return false
      if (aba === 'FALADO' && l.situacao !== 'FALADO') return false
      if (aba === 'SEM_SUCESSO'
          && !['NAO_ATENDE', 'NUMERO_ERRADO', 'RECUSOU', 'SEM_CONTATO'].includes(l.situacao)) return false
      if (!q) return true
      return [l.contrato, l.cliente_nome, l.endereco, l.bairro, l.tecnico, l.equipe, l.telefone]
        .some(x => (x ?? '').toLowerCase().includes(q))
    })
  }, [linhas, aba, busca])

  const abas = useMemo(() => ({
    PENDENTE: linhas.filter(l => l.situacao === 'PENDENTE').length,
    FALADO: linhas.filter(l => l.situacao === 'FALADO').length,
    SEM_SUCESSO: linhas.filter(l =>
      ['NAO_ATENDE', 'NUMERO_ERRADO', 'RECUSOU', 'SEM_CONTATO'].includes(l.situacao)).length,
    TODOS: linhas.length,
  }), [linhas])

  return (
    <Shell acoes={
      <span className="flex items-center gap-1 text-[11px] text-graf-400">
        <input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)}
          aria-label="Primeiro dia da fila"
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        a
        <input type="date" value={ate} min={de} onChange={e => setAte(e.target.value)}
          aria-label="Último dia da fila"
          className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
      </span>
    }>
      <div className="pagina-entra space-y-3 p-4">
        <div>
          <h1 className="text-lg font-semibold">Qualidade</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-graf-400">
            Falar com quem foi atendido e registrar se <strong className="text-graf-200">
            normalizou</strong>. A fila traz tudo em que o técnico esteve no cliente —
            cancelado pela central e desatribuído ficam de fora, porque ninguém foi lá.
          </p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}

        {resumo && <PainelQualidade r={resumo} />}

        {/* ---------- abas de trabalho ---------- */}
        <div className="card-controle flex flex-wrap items-center gap-2 p-3">
          {([
            ['PENDENTE', 'A falar'], ['FALADO', 'Falados'],
            ['SEM_SUCESSO', 'Não consegui'], ['TODOS', 'Todos'],
          ] as const).map(([v, r]) => (
            <button key={v} onClick={() => setAba(v)} aria-pressed={aba === v}
              className={`rounded-md px-2.5 py-1 text-xs ${aba === v
                ? 'bg-af-600 font-semibold text-white'
                : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
              {r} <span className="tabular opacity-80">{abas[v]}</span>
            </button>
          ))}
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Contrato, cliente, endereço, técnico, telefone…"
            className="min-w-56 flex-1 rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-xs" />
        </div>

        {carregando ? (
          <p className="py-16 text-center text-graf-400" role="status">Carregando a fila…</p>
        ) : lista.length === 0 ? (
          <Vazio titulo={aba === 'PENDENTE' && abas.TODOS > 0
            ? 'Fila do dia fechada'
            : 'Nada nesta aba'}
            descricao={aba === 'PENDENTE' && abas.TODOS > 0
              ? `Todos os ${abas.TODOS} contratos do período já foram trabalhados.`
              : 'Nenhum contrato com este filtro.'} />
        ) : (
          <div className="space-y-2">
            {lista.map(l => (
              <Cartao key={l.visita_id} l={l}
                aberto={aberto === l.visita_id}
                podeRegistrar={podeRegistrar}
                aoAbrir={() => setAberto(a => a === l.visita_id ? null : l.visita_id)}
                aoSalvar={() => { setAberto(null); recarregar() }} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

// ================================================================== //
//  O PAINEL — normalizado / não normalizado
// ================================================================== //

function PainelQualidade({ r }: { r: Resumo }) {
  const respondidas = r.normalizado + r.parcial + r.nao_normalizado
  const fatias = [
    { r: 'Normalizado', v: r.normalizado, cor: 'var(--st-concluida)' },
    { r: 'Em parte', v: r.parcial, cor: 'var(--st-reagendamento)' },
    { r: 'Não normalizado', v: r.nao_normalizado, cor: 'var(--st-cancelada)' },
  ].filter(f => f.v > 0)

  return (
    <section className="card-controle sobe overflow-hidden" aria-label="A qualidade do período">
      <div className="regua">
        <Celula valor={String(r.na_fila)} rotulo="Na fila"
          apoio={<><span className="tabular">{r.falados}</span> falados ·{' '}
            <span className="tabular">{r.pendentes}</span> a falar
            {r.sem_sucesso > 0 && <> · <span className="tabular">{r.sem_sucesso}</span> sem sucesso</>}
          </>} />

        {/* Zero e desconhecido não são a mesma coisa: sem ninguém falado
            o percentual é "—", nunca 0% — 0% diria que tudo deu errado. */}
        <Celula
          valor={r.pct_normalizado == null ? '—' : r.pct_normalizado.toFixed(1).replace('.', ',')}
          sufixo={r.pct_normalizado == null ? undefined : '%'}
          cor={r.pct_normalizado == null ? 'var(--color-graf-500)'
            : r.pct_normalizado >= 90 ? 'var(--st-concluida)' : 'var(--st-reagendamento)'}
          rotulo="Normalizado"
          apoio={respondidas
            ? <><span className="tabular">{r.normalizado}</span> de{' '}
                <span className="tabular">{respondidas}</span> respondidas</>
            : 'ninguém respondeu ainda — nada para medir'} />

        <Celula
          valor={r.nota_media == null ? '—' : r.nota_media.toFixed(2).replace('.', ',')}
          cor={r.nota_media == null ? 'var(--color-graf-500)'
            : r.nota_media >= 4 ? 'var(--st-concluida)' : 'var(--st-reagendamento)'}
          rotulo="Nota do técnico"
          apoio={r.com_nota
            ? <>média de <span className="tabular">{r.com_nota}</span> nota(s), de 1 a 5</>
            : 'sem nota ainda'} />

        <Celula valor={String(r.tratou_mal)} rotulo="Reclamação de conduta"
          cor={r.tratou_mal > 0 ? 'var(--st-conflito)' : 'var(--st-concluida)'}
          alerta={r.tratou_mal > 0}
          apoio={r.tratou_bem + r.tratou_mal
            ? <>de <span className="tabular">{r.tratou_bem + r.tratou_mal}</span> que responderam
                {r.com_pendencia > 0 && <> · <span className="tabular">{r.com_pendencia}</span> com pendência escrita</>}</>
            : 'ninguém respondeu sobre a conduta ainda'} />
      </div>

      {fatias.length > 0 && (
        <div className="space-y-2 border-t border-graf-800 px-4 py-3">
          <div className="mistura" aria-hidden
            title={fatias.map(f => `${f.r}: ${f.v}`).join('\n')}>
            {fatias.map(f => (
              <span key={f.r} style={{ flex: `${f.v} 0 0`, ['--fatia-cor' as string]: f.cor }} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {fatias.map(f => (
              <span key={f.r} style={{ ['--pill-cor' as string]: f.cor }}
                className="pill pill-apagada">
                {f.r} <span className="tabular font-bold opacity-80">{f.v}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function Celula({ valor, sufixo, rotulo, apoio, cor, alerta }: {
  valor: string; sufixo?: string; rotulo: string
  apoio: React.ReactNode; cor?: string; alerta?: boolean
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className="tabular text-3xl font-bold leading-none"
          style={cor ? { color: cor } : undefined}>{valor}</span>
        {sufixo && <span className="text-base font-semibold text-graf-400">{sufixo}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase
                      tracking-wide text-graf-400">
        {alerta && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-af-500" />}
        {rotulo}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-graf-500">{apoio}</div>
    </div>
  )
}

// ================================================================== //
//  O CARTÃO DE UM CONTRATO
// ================================================================== //

function Cartao({ l, aberto, podeRegistrar, aoAbrir, aoSalvar }: {
  l: Linha; aberto: boolean; podeRegistrar: boolean
  aoAbrir: () => void; aoSalvar: () => void
}) {
  const sit = SITUACOES.find(s => s.v === l.situacao)
  const fun = FUNCIONOU.find(f => f.v === l.funcionou)

  return (
    <div className={`card-controle overflow-hidden ${aberto ? 'ring-1 ring-af-600' : ''}`}>
      <button onClick={aoAbrir} aria-expanded={aberto}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left
                   hover:bg-graf-900/60">
        <span className="tabular font-semibold">{l.contrato ?? '—'}</span>

        <span className="rounded bg-graf-800 px-1.5 py-0.5 text-[10px] font-semibold
                         uppercase tracking-wide text-graf-300">
          {l.grupo ?? 'sem grupo'}
        </span>

        {/* A situação do CONTRATO, que não é a da pesquisa. */}
        <span className="text-[11px] text-graf-400">
          {l.situacao_contrato === 'CONCLUIDA' ? 'Concluída'
            : l.situacao_contrato === 'REAGENDAMENTO' ? 'Reagendado' : 'Cancelada'}
          {l.encerrou && <> · {hora(l.encerrou)}</>}
        </span>

        {l.tem_improdutiva && (
          <span title="Teve O.S. improdutiva — vale confirmar se normalizou"
            className="text-[11px] font-semibold text-amber-400">▲ improdutiva</span>
        )}

        <span className="min-w-0 flex-1 truncate text-[11px] text-graf-400">
          {l.cliente_nome && <span className="text-graf-300">{l.cliente_nome} · </span>}
          {[l.bairro, l.tecnico].filter(Boolean).join(' · ')}
        </span>

        {/* O resultado, quando já houve */}
        {fun && (
          <span style={{ color: fun.cor }} className="text-[11px] font-semibold">{fun.r}</span>
        )}
        {l.nota_tecnico != null && (
          <span className="tabular text-[11px] text-amber-300">{'★'.repeat(l.nota_tecnico)}</span>
        )}
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: 'var(--color-graf-800)', color: sit?.cor ?? 'var(--color-graf-300)' }}>
          {ROTULO_SIT[l.situacao] ?? l.situacao}
        </span>
      </button>

      {aberto && <Formulario l={l} podeRegistrar={podeRegistrar} aoSalvar={aoSalvar} />}
    </div>
  )
}

// ================================================================== //
//  AS QUATRO PERGUNTAS
// ================================================================== //

function Formulario({ l, podeRegistrar, aoSalvar }: {
  l: Linha; podeRegistrar: boolean; aoSalvar: () => void
}) {
  const [tel, setTel] = useState(l.telefone ?? '')
  const [canal, setCanal] = useState<string>(l.canal ?? 'LIGACAO')
  const [funcionou, setFuncionou] = useState<string | null>(l.funcionou)
  const [nota, setNota] = useState<number | null>(l.nota_tecnico)
  const [tratouBem, setTratouBem] = useState<boolean | null>(l.tratou_bem)
  const [pendencia, setPendencia] = useState(l.pendencia ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const wa = tel ? linkWhatsApp(tel, l.contrato) : null
  const podeFechar = funcionou != null && nota != null

  async function gravar(situacao: string) {
    setSalvando(true); setErro(null)
    // D-061: `usuario_id` NÃO vai daqui — quem carimba o autor é o servidor.
    const { error } = await supabase.rpc('registrar_qualidade', {
      p_visita_id: l.visita_id,
      p_situacao: situacao,
      p_canal: canal,
      p_telefone: tel || null,
      p_funcionou: situacao === 'FALADO' ? funcionou : null,
      p_nota: situacao === 'FALADO' ? nota : null,
      p_tratou_bem: situacao === 'FALADO' ? tratouBem : null,
      p_pendencia: situacao === 'FALADO' ? (pendencia || null) : null,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    aoSalvar()
  }

  return (
    <div className="space-y-3 border-t border-graf-800 bg-graf-900/40 px-3 py-3">
      {/* ---- endereço e contrato, para a conversa ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-graf-400">
        <span>{l.endereco ?? 'sem endereço'}{l.bairro ? ` · ${l.bairro}` : ''}</span>
        {l.equipe && <span>Equipe {equipeRotulo(l.equipe)}</span>}
        {l.tentativas > 0 && (
          <span className="text-graf-300">
            {l.tentativas} tentativa(s){l.quem ? ` · última por ${l.quem}` : ''}
          </span>
        )}
        <Link to={`/controle/visita/${l.visita_id}`}
          className="text-af-400 underline-offset-2 hover:underline">abrir o contrato →</Link>
      </div>

      {/* ---- o telefone ---- */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-graf-400">
          <span className="block">Telefone do assinante</span>
          <input value={tel} onChange={e => setTel(e.target.value)}
            onBlur={() => setTel(t => formataTel(t))}
            placeholder="(92) 99999-9999" inputMode="tel"
            disabled={!podeRegistrar}
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
                       text-emerald-300 hover:bg-emerald-900/30">
            Abrir no WhatsApp ↗
          </a>
        )}
        {tel && !wa && (
          <span className="text-[11px] text-amber-400">número curto demais para o WhatsApp</span>
        )}
        {!l.telefone && (
          <span className="text-[11px] text-graf-500">
            o TOA não manda telefone — pegue no sistema da CLARO e digite aqui; fica guardado
          </span>
        )}
      </div>

      {/* ---- as quatro perguntas ---- */}
      <div className="grid gap-3 md:grid-cols-2">
        <Pergunta n={1} texto="O serviço ficou funcionando?">
          <div className="flex flex-wrap gap-1">
            {FUNCIONOU.map(f => (
              <button key={f.v} onClick={() => setFuncionou(f.v)} disabled={!podeRegistrar}
                aria-pressed={funcionou === f.v}
                style={funcionou === f.v ? { background: f.cor, color: '#0f1115' } : undefined}
                className={`rounded-md px-2 py-1 text-xs font-medium ${funcionou === f.v
                  ? '' : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
                {f.r}
              </button>
            ))}
          </div>
        </Pergunta>

        <Pergunta n={2} texto="Que nota você dá para o técnico? (1 a 5)">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setNota(n)} disabled={!podeRegistrar}
                aria-label={`${n} de 5`} aria-pressed={nota === n}
                className={`text-xl leading-none ${nota != null && n <= nota
                  ? 'text-amber-300' : 'text-graf-600 hover:text-graf-400'}`}>
                ★
              </button>
            ))}
            {nota != null && (
              <button onClick={() => setNota(null)} disabled={!podeRegistrar}
                className="ml-1 text-[11px] text-graf-400 hover:text-af-400">limpar</button>
            )}
          </div>
        </Pergunta>

        <Pergunta n={3} texto="O técnico se identificou e tratou você com respeito?">
          <div className="flex gap-1">
            {([[true, 'Sim'], [false, 'Não']] as const).map(([v, r]) => (
              <button key={r} onClick={() => setTratouBem(v)} disabled={!podeRegistrar}
                aria-pressed={tratouBem === v}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${tratouBem === v
                  ? (v ? 'bg-emerald-700 text-white' : 'bg-af-600 text-white')
                  : 'bg-graf-800 text-graf-200 hover:bg-graf-700'}`}>
                {r}
              </button>
            ))}
            {tratouBem != null && (
              <button onClick={() => setTratouBem(null)} disabled={!podeRegistrar}
                className="ml-1 text-[11px] text-graf-400 hover:text-af-400">limpar</button>
            )}
          </div>
        </Pergunta>

        <Pergunta n={4} texto="Ficou alguma pendência ou problema?">
          <input value={pendencia} onChange={e => setPendencia(e.target.value)}
            disabled={!podeRegistrar}
            placeholder="o que o assinante falou, nas palavras dele"
            className="w-full rounded-md border border-graf-700 bg-graf-900 px-2 py-1 text-sm" />
        </Pergunta>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {/* ---- fechar ---- */}
      {podeRegistrar ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-graf-800 pt-2.5">
          <button onClick={() => gravar('FALADO')} disabled={salvando || !podeFechar}
            title={podeFechar ? undefined
              : 'Para marcar como falado, responda ao menos se funcionou e a nota do técnico'}
            className="rounded-md bg-af-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-af-500 disabled:opacity-40">
            {salvando ? 'Gravando…' : 'Falei — gravar e seguir'}
          </button>

          <span className="text-[11px] text-graf-500">ou, se não deu:</span>
          {SITUACOES.filter(s => s.v !== 'FALADO').map(s => (
            <button key={s.v} onClick={() => gravar(s.v)} disabled={salvando}
              className="rounded-md border border-graf-700 px-2 py-1 text-xs text-graf-300
                         hover:border-af-600 hover:text-af-400 disabled:opacity-40">
              {s.r}
            </button>
          ))}
        </div>
      ) : (
        <p className="border-t border-graf-800 pt-2.5 text-[11px] text-graf-400">
          Você pode ver a célula, mas não registrar pesquisa. Precisa da permissão
          <strong className="text-graf-300"> qualidade.registrar</strong>.
        </p>
      )}
    </div>
  )
}

function Pergunta({ n, texto, children }: {
  n: number; texto: string; children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-graf-300">
        <span className="tabular mr-1.5 rounded bg-graf-800 px-1.5 py-0.5 text-[10px]
                         font-bold text-graf-400">{n}</span>
        {texto}
      </p>
      {children}
    </div>
  )
}
