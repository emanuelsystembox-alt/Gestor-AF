import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { isoLocal } from '../lib/formato'
import { Painel, BarrasHorizontais, TabelaSimples } from './graficos'
import { Alerta, CarregandoBloco } from './ui'
import { BotaoAtualizar } from './BotaoAtualizar'
import { LinkContrato } from './LinkContrato'
import { SelecaoMultipla, type OpcaoMultipla } from './SelecaoMultipla'
import {
  CausaRevisita30, passaFiltroRev, corSinal, situacaoRotulo, COR,
  type ItemRev30, type FiltroRev,
} from './DashboardVT'

/**
 * Indicador REVISITA TÉCNICA (256, D-371) — a quarta aba de Indicadores.
 *
 * > "o painel vai abrir com os cards mostrando a nota (...) Revisita
 * >  dividido pelo total que caiu na agenda tirando cancelado central (...)
 * >  o volume executado pelo técnico no mês, e as revisitas que voltarem em
 * >  30 dias são as que vão impactar a equipe" — Emanuel, 11/11
 *
 * ┌─ duas réguas, cada uma com a sua data (o porquê na migration 256) ─┐
 * │ CIDADE  pela data da REVISITA: os cards, as causas, a idade, o dia.│
 * │ TÉCNICO pela data do SERVIÇO dele: executados no período e quantos │
 * │         voltaram em até 30 dias, contando até hoje. O supervisor   │
 * │         é a soma dos técnicos dele.                                │
 * │ A regra do par é a do banco: VT ← VT (qualquer situação, menos     │
 * │ Auditar e central); Retorno ← instalação ou Retorno CONCLUÍDO.     │
 * │ A tela não reconta revisita: só soma e agrupa o que o banco deu.   │
 * └────────────────────────────────────────────────────────────────────┘
 * Sem meta combinada: nenhum número ganha cor de "bateu/não bateu".
 */

type Familia = 'TODAS' | 'VT' | 'INST'
interface ItemRev extends ItemRev30 {
  familia: 'VT' | 'INST'; grupo: string | null; anterior_grupo: string | null
  anterior_tecnico_id: string | null; anterior_tecnico_do_cadastro: boolean; anterior_supervisor: string
}
interface Tecnico {
  tecnico_id: string; tecnico: string | null; equipe: string | null; supervisor: string
  exec_vt: number; exec_inst: number; rev_vt: number; rev_inst: number
  janela_aberta: number; nome_do_cadastro: boolean; cert_fin: number; cert_validado: number
}
interface RevTec {
  tecnico_id: string; familia: 'VT' | 'INST'; servico_id: string; servico_dia: string
  contrato: string | null; visita_id: string; rev_dia: string; dias: number; baixa: string | null
}
interface Dados {
  de: string; ate: string; revisita_ate: string; hoje: string
  areas_opcoes: { area_id: string; rotulo: string }[]
  buckets_opcoes: { bucket: string; n: number }[]
  supervisores_opcoes: { supervisor: string; n: number }[]
  cidade: { conta: number; revisitas: number; vt_conta: number; vt_rev: number
            inst_conta: number; inst_rev: number; fora: { auditar: number; central: number } }
  lista: ItemRev[]; tecnicos: Tecnico[]; rev_tecnico: RevTec[]
}

const n0 = (x: number) => x.toLocaleString('pt-BR')
const pct = (num: number, den: number) => den ? ((num * 100) / den).toFixed(1).replace('.', ',') : null
const curta = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const SEM_SUP = 'SEM_SUPERVISOR'
const rotSup = (s: string) => s === SEM_SUP ? 'Sem supervisor' : s
const FAMILIA_ROT: Record<Familia, string> = { TODAS: 'Tudo', VT: 'VT', INST: 'Instalação' }
const somaFam = (f: Familia, vt: number, inst: number) => f === 'VT' ? vt : f === 'INST' ? inst : vt + inst

function mesAnterior(hoje: string): [string, string] {
  const [a, m] = hoje.split('-').map(Number)
  const ini = new Date(a, m - 2, 1), fim = new Date(a, m - 1, 0)
  return [isoLocal(ini), isoLocal(fim)]
}

export function RevisitaTecnica() {
  const hoje = isoLocal(new Date())
  const inicioMes = hoje.slice(0, 8) + '01'
  const [de, setDe] = useState(inicioMes)
  const [ate, setAte] = useState(hoje)
  const [areas, setAreas] = useState<string[]>([])
  const [buckets, setBuckets] = useState<string[]>([])
  const [sups, setSups] = useState<string[]>([])
  const [familia, setFamilia] = useState<Familia>('TODAS')
  const [d, setD] = useState<Dados | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [atualizado, setAtualizado] = useState<Date | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    setCarregando(true); setErro(null)
    supabase.rpc('indicador_revisita_tecnica', {
      p_de: de, p_ate: ate < de ? de : ate,
      ...(areas.length ? { p_areas: areas } : {}),
      ...(buckets.length ? { p_buckets: buckets } : {}),
      ...(sups.length ? { p_supervisores: sups } : {}),
    }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else { setD(data as Dados); setAtualizado(new Date()) }
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [de, ate, areas, buckets, sups, versao])

  const opArea: OpcaoMultipla[] = (d?.areas_opcoes ?? []).map(a => ({ valor: a.area_id, rotulo: a.rotulo }))
  const opBucket: OpcaoMultipla[] = (d?.buckets_opcoes ?? []).map(b => ({
    valor: b.bucket, rotulo: b.bucket === 'SEM_BUCKET' ? 'Sem bucket' : b.bucket, qtd: b.n }))
  const opSup: OpcaoMultipla[] = (d?.supervisores_opcoes ?? []).map(s => ({
    valor: s.supervisor, rotulo: rotSup(s.supervisor), qtd: s.n }))
  const [mAntDe, mAntAte] = mesAnterior(hoje)
  const filtro = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1 text-xs outline-none focus:border-af-500'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Período">
          <input type="date" value={de} max={hoje} aria-label="Início do período"
            onChange={e => { const v = e.target.value; if (!v) return; setDe(v); if (v > ate) setAte(v) }}
            className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1" />
          <span className="text-graf-400">a</span>
          <input type="date" value={ate} min={de} max={hoje} aria-label="Fim do período"
            onChange={e => e.target.value && setAte(e.target.value)}
            className="tabular rounded-md border border-graf-700 bg-graf-900 px-2 py-1" />
          {([['Mês até hoje', inicioMes, hoje], ['Mês anterior', mAntDe, mAntAte]] as const).map(([r, a, b]) => {
            const on = de === a && ate === b
            return (
              <button key={r} type="button" aria-pressed={on} onClick={() => { setDe(a); setAte(b) }}
                className={`rounded-md px-2 py-1 ${on ? 'bg-af-600 font-semibold text-white'
                  : 'border border-graf-700 text-graf-300 hover:border-af-600'}`}>{r}</button>
            )
          })}
        </div>
        <SelecaoMultipla rotulo="Supervisor" todos="Todo supervisor" plural="supervisores"
          opcoes={opSup} valor={sups} onChange={setSups} className={filtro} />
        <SelecaoMultipla rotulo="Bucket" todos="Todo bucket" plural="buckets"
          opcoes={opBucket} valor={buckets} onChange={setBuckets} className={filtro} />
        <SelecaoMultipla rotulo="Área" todos="Toda área" plural="áreas"
          opcoes={opArea} valor={areas} onChange={setAreas} className={filtro} />
        <div className="flex gap-1 text-xs" role="group" aria-label="Família de serviço">
          {(['TODAS', 'VT', 'INST'] as const).map(f => (
            <button key={f} type="button" aria-pressed={familia === f} onClick={() => setFamilia(f)}
              className={`rounded-md px-2 py-1 ${familia === f ? 'bg-graf-700 font-semibold text-graf-100'
                : 'border border-graf-700 text-graf-300 hover:border-graf-500'}`}>{FAMILIA_ROT[f]}</button>
          ))}
        </div>
        <div className="ml-auto">
          <BotaoAtualizar aoAtualizar={() => setVersao(v => v + 1)} carregando={carregando} atualizadoEm={atualizado} />
        </div>
      </div>

      {erro && <Alerta tipo="erro">Não consegui carregar a Revisita Técnica: {erro}</Alerta>}
      {carregando && !d && <CarregandoBloco className="py-12" />}
      {d && <Conteudo d={d} familia={familia} />}
    </div>
  )
}

// ============================================================ conteúdo --
function Conteudo({ d, familia }: { d: Dados; familia: Familia }) {
  const [filtroRev, setFiltroRev] = useState<FiltroRev | null>(null)
  const [tecSel, setTecSel] = useState<string | null>(null)
  const [supSel, setSupSel] = useState<string | null>(null)
  const c = d.cidade

  const lista = useMemo(() => familia === 'TODAS' ? d.lista : d.lista.filter(i => i.familia === familia), [d, familia])
  const revTec = useMemo(() => familia === 'TODAS' ? d.rev_tecnico : d.rev_tecnico.filter(i => i.familia === familia), [d, familia])
  // cada técnico na família escolhida; quem não executou nada nela sai
  const tecnicos = useMemo(() => d.tecnicos
    .map(t => ({ ...t, exec: somaFam(familia, t.exec_vt, t.exec_inst), rev: somaFam(familia, t.rev_vt, t.rev_inst) }))
    .filter(t => t.exec > 0), [d, familia])
  // o supervisor: a soma dos técnicos dele
  const supervisores = useMemo(() => {
    const m = new Map<string, { exec: number; rev: number; tecs: number }>()
    for (const t of tecnicos) {
      const x = m.get(t.supervisor) ?? { exec: 0, rev: 0, tecs: 0 }
      m.set(t.supervisor, { exec: x.exec + t.exec, rev: x.rev + t.rev, tecs: x.tecs + 1 })
    }
    return [...m.entries()].map(([s, x]) => ({ s, ...x }))
      .sort((a, b) => b.rev - a.rev || a.s.localeCompare(b.s))
  }, [tecnicos])

  // os cards: a régua da cidade
  const conta = somaFam(familia, c.vt_conta, c.inst_conta)
  const revs = somaFam(familia, c.vt_rev, c.inst_rev)
  const codigos = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of lista) if (i.anterior_baixa) m.set(i.anterior_baixa, (m.get(i.anterior_baixa) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [lista])
  const supTopo = supervisores.find(s => s.s !== SEM_SUP && s.rev > 0)
  const semSup = supervisores.find(s => s.s === SEM_SUP)
  const tecTopo = [...tecnicos].sort((a, b) => b.rev - a.rev || b.exec - a.exec)[0]

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-label="A revisita da cidade">
        <Card rotulo={familia === 'TODAS' ? 'Revisita da cidade' : `Revisita · ${FAMILIA_ROT[familia]}`}
          valor={pct(revs, conta)} sufixo="%" forte
          dica="Revisitas do período ÷ contratos de VT, Retorno e instalação do período, sem Auditar e sem cancelado pela central"
          apoio={<><b className="tabular">{n0(revs)}</b> de <b className="tabular">{n0(conta)}</b> na agenda
            {/* o "fora" é do período inteiro, não de uma família: só sem o filtro */}
            {familia === 'TODAS' && (c.fora.central + c.fora.auditar) > 0 && (
              <span className="block text-graf-400">fora: {n0(c.fora.central)} cancelado pela central · {n0(c.fora.auditar)} Auditar</span>
            )}</>} />
        <Card rotulo="Revisita VT" valor={pct(c.vt_rev, c.vt_conta)} sufixo="%" apagado={familia === 'INST'}
          dica="VT que voltou de outra VT em até 30 dias ÷ VT na agenda"
          apoio={<><b className="tabular">{n0(c.vt_rev)}</b> de <b className="tabular">{n0(c.vt_conta)}</b> VT</>} />
        <Card rotulo="Revisita instalação" valor={pct(c.inst_rev, c.inst_conta)} sufixo="%" apagado={familia === 'VT'}
          dica="Retorno de credenciada depois de instalação ou Retorno concluído, em até 30 dias ÷ instalação + Retorno na agenda"
          apoio={<><b className="tabular">{n0(c.inst_rev)}</b> de <b className="tabular">{n0(c.inst_conta)}</b> instalação/Retorno</>} />
        <Card rotulo="Código ofensor" valor={codigos[0] ? codigos[0][0].split(' - ')[0] : '—'}
          dica="O código de baixa da visita ANTERIOR que mais gerou revisita"
          apoio={codigos[0] ? <>
            <span className="block truncate" title={codigos[0][0]}>{codigos[0][0].split(' - ').slice(1).join(' - ')}</span>
            <b className="tabular">{n0(codigos[0][1])}</b> revisita(s) · {pct(codigos[0][1], lista.length)}%
          </> : <>nenhuma revisita com código</>} />
        <Card rotulo="Supervisor ofensor" valor={supTopo ? <span className="text-base">{supTopo.s}</span> : '—'}
          dica="O supervisor (do técnico que executou) com mais serviços que voltaram"
          apoio={<>
            {supTopo && <><b className="tabular">{n0(supTopo.rev)}</b> de <b className="tabular">{n0(supTopo.exec)}</b> executados · {pct(supTopo.rev, supTopo.exec)}%</>}
            {semSup && semSup.rev > 0 && (
              <span className="block text-amber-300" title="Técnico sem supervisor declarado no cadastro (D-134)">
                {n0(semSup.rev)} de técnico sem supervisor</span>
            )}
          </>} />
        <Card rotulo="Técnico ofensor" valor={tecTopo && tecTopo.rev > 0 ? <span className="text-base">{tecTopo.tecnico ?? 'Sem nome'}</span> : '—'}
          dica="O técnico com mais serviços executados que voltaram em até 30 dias"
          apoio={tecTopo && tecTopo.rev > 0 ? <>
            <b className="tabular">{n0(tecTopo.rev)}</b> de <b className="tabular">{n0(tecTopo.exec)}</b> executados · {pct(tecTopo.rev, tecTopo.exec)}%
            {tecTopo.equipe && <span className="block text-graf-400">equipe {tecTopo.equipe}</span>}
          </> : <>nenhum serviço voltou</>} />
      </section>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
        <CausaRevisita30 r={{ n: lista.length, lista }} filtro={filtroRev} aoFiltrar={setFiltroRev}
          titulo="Causas da revisita" className="lg:col-span-2 xl:col-span-5"
          dica="Como fechou a visita ANTERIOR — a que gerou a revisita — e em quantos dias voltou." />
        <RevisitaPorDia d={d} lista={lista} revTec={revTec} tecSel={tecnicos.find(t => t.tecnico_id === tecSel) ?? null}
          aoLimpar={() => setTecSel(null)} className="xl:col-span-4" />
        <Painel dicaLinhas={2} className="xl:col-span-3" titulo="Supervisor ofensor"
          dica="Serviços dos técnicos dele que voltaram em até 30 dias."
          tabela={<TabelaSimples colunas={['Supervisor', 'Técnicos', 'Executados', 'Revisitas', '% revisita']}
            linhas={supervisores.map(s => [rotSup(s.s), s.tecs, s.exec, s.rev, `${pct(s.rev, s.exec) ?? '—'}%`])} />}>
          <BarrasHorizontais cor={COR.atencao}
            dados={supervisores.filter(s => s.rev > 0).map(s => ({
              rotulo: rotSup(s.s), valor: s.rev, sub: `${s.tecs} técnico(s) · ${n0(s.exec)} executados`,
              texto: `${s.rev} · ${pct(s.rev, s.exec)}%`,
              cor: s.s === SEM_SUP ? 'var(--color-graf-600)' : undefined }))}
            aoClicar={r => { const s = supervisores.find(x => rotSup(x.s) === r); setSupSel(v => s && v !== s.s ? s.s : null) }}
            selecionado={supSel ? rotSup(supSel) : null} />
        </Painel>
      </div>

      {filtroRev && (
        <ListaCidade itens={lista.filter(i => passaFiltroRev(filtroRev, i))} titulo={filtroRev.titulo}
          aoFechar={() => setFiltroRev(null)} />
      )}

      <TabelaTecnicos tecnicos={supSel ? tecnicos.filter(t => t.supervisor === supSel) : tecnicos}
        revTec={revTec} supSel={supSel} aoLimparSup={() => setSupSel(null)}
        sel={tecSel} aoSelecionar={setTecSel} hoje={d.hoje} />
    </>
  )
}

// ================================================================ peças --
function Card({ rotulo, valor, sufixo, apoio, dica, forte, apagado }: {
  rotulo: string; valor: ReactNode; sufixo?: string; apoio: ReactNode; dica: string
  forte?: boolean; apagado?: boolean
}) {
  return (
    <div className={`card-controle min-w-0 p-3 ${apagado ? 'opacity-50' : ''}`} title={dica}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-graf-400">{rotulo}</p>
      <p className={`tabular mt-1 truncate font-semibold leading-tight ${forte ? 'text-3xl' : 'text-2xl'}`}>
        {valor ?? '—'}{valor != null && sufixo && <span className="text-sm text-graf-400">{sufixo}</span>}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-graf-300">{apoio}</p>
    </div>
  )
}

/** As revisitas por dia: a cidade pela data da revisita; com um técnico escolhido, as dele. */
function RevisitaPorDia({ d, lista, revTec, tecSel, aoLimpar, className = '' }: {
  d: Dados; lista: ItemRev[]; revTec: RevTec[]
  tecSel: (Tecnico & { exec: number; rev: number }) | null; aoLimpar: () => void; className?: string
}) {
  const ate = tecSel ? d.revisita_ate : d.ate
  const dias = useMemo(() => {
    const out: string[] = []
    for (let x = new Date(d.de + 'T12:00'); isoLocal(x) <= ate; x.setDate(x.getDate() + 1)) out.push(isoLocal(x))
    return out
  }, [d.de, ate])
  const conta = useMemo(() => {
    const m = new Map<string, number>()
    if (tecSel) { for (const r of revTec) if (r.tecnico_id === tecSel.tecnico_id) m.set(r.rev_dia, (m.get(r.rev_dia) ?? 0) + 1) }
    else for (const i of lista) m.set(i.dia, (m.get(i.dia) ?? 0) + 1)
    return m
  }, [lista, revTec, tecSel])
  const max = Math.max(1, ...dias.map(x => conta.get(x) ?? 0))
  const total = dias.reduce((s, x) => s + (conta.get(x) ?? 0), 0)
  const passo = Math.max(1, Math.ceil(dias.length / 10))
  return (
    <Painel dicaLinhas={2} className={className} titulo={tecSel ? `Revisita por dia · ${tecSel.tecnico ?? 'técnico'}` : 'Revisita por dia'}
      dica={tecSel ? 'Os serviços dele que voltaram, no dia em que voltaram (até hoje).'
        : 'As revisitas da cidade, no dia em que caíram na agenda.'}
      extra={<span className="flex items-center gap-2 text-xs text-graf-400">
        <span className="tabular">{n0(total)}</span>
        {tecSel && <button type="button" onClick={aoLimpar} className="text-af-400 hover:underline">ver a cidade</button>}
      </span>}
      tabela={<TabelaSimples colunas={['Dia', 'Revisitas']} linhas={dias.map(x => [curta(x), conta.get(x) ?? 0])} />}>
      <div className="flex h-36 items-end gap-px" role="img"
        aria-label={`Revisitas por dia, de ${curta(d.de)} a ${curta(ate)}`}>
        {dias.map(x => {
          const n = conta.get(x) ?? 0
          return (
            <div key={x} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${curta(x)}: ${n} revisita(s)`}>
              {n > 0 && <span className="tabular block text-center text-[9px] leading-none text-graf-300">{n}</span>}
              <span className="mt-0.5 block w-full rounded-t-sm"
                style={{ height: n ? `${Math.max(4, (n / max) * 85)}%` : 2,
                         background: n ? (x > d.ate ? 'var(--color-graf-500)' : COR.atencao) : 'var(--color-graf-800)' }} />
            </div>
          )
        })}
      </div>
      <div className="tabular relative mt-1 h-3 text-[10px] text-graf-400">
        {dias.map((x, k) => k % passo === 0 && (
          <span key={x} className="absolute -translate-x-1/2" style={{ left: `${((k + 0.5) / dias.length) * 100}%` }}>
            {x.slice(8)}</span>
        ))}
      </div>
      {tecSel && ate > d.ate && (
        <p className="mt-1 text-[10px] text-graf-400">Em cinza: depois do período — o serviço é do período, a revisita veio depois.</p>
      )}
    </Painel>
  )
}

/** A lista de revisitas da cidade, aberta por uma barra das causas. */
function ListaCidade({ itens, titulo, aoFechar }: { itens: ItemRev[]; titulo: string; aoFechar: () => void }) {
  return (
    <div className="card-controle overflow-hidden">
      <p className="flex items-center gap-2 border-b border-graf-800 bg-graf-900 px-3 py-1.5 text-[11px] text-graf-300">
        <strong className="truncate">Revisitas · {titulo}</strong>
        <span className="tabular text-graf-400">{itens.length} contrato(s)</span>
        <button type="button" onClick={aoFechar} className="ml-auto text-graf-400 hover:text-graf-100">fechar ✕</button>
      </p>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-graf-900 text-left text-[10px] uppercase tracking-wide text-graf-400">
            <tr>{['Revisita', 'Grupo', 'Veio de', 'Como a anterior fechou', 'Sinal da anterior', 'Quem fez a anterior', 'Agora com']
              .map(h => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {itens.map(i => (
              <tr key={i.visita_id} className="border-t border-graf-800/60 align-top">
                <td className="whitespace-nowrap px-3 py-1.5">
                  <LinkContrato to={`/controle/visita/${i.visita_id}`} className="tabular text-af-400 underline underline-offset-2">
                    {i.contrato ?? 'sem contrato'}</LinkContrato>
                  <span className="tabular block text-[10px] text-graf-400">{curta(i.dia)}</span>
                </td>
                <td className="px-3 py-1.5 text-graf-300">{i.grupo ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <LinkContrato to={`/controle/visita/${i.anterior_id}`} className="tabular text-af-400 underline underline-offset-2">
                    {curta(i.anterior_data)}</LinkContrato>
                  <span className="block text-[10px] text-graf-400">{i.anterior_grupo ?? '—'}</span>
                  <span className="tabular block text-[10px] font-semibold" style={{ color: i.dias <= 7 ? COR.naoExecutado : COR.atencao }}>
                    {i.dias === 0 ? 'no mesmo dia' : `${i.dias} dia(s) depois`}</span>
                </td>
                <td className="px-3 py-1.5 text-graf-300">{situacaoRotulo(i.anterior_situacao)}
                  {i.anterior_baixa && <span className="block text-[10px] text-graf-400">{i.anterior_baixa}</span>}</td>
                <td className="px-3 py-1.5">
                  {i.anterior_sinal
                    ? <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: corSinal(i.anterior_sinal.cor) }}>
                        <span aria-hidden className="inline-block h-2 w-2 rounded-full"
                          style={{ background: corSinal(i.anterior_sinal.cor) ?? 'var(--color-graf-500)' }} />
                        {i.anterior_sinal.validacao ?? 'sem rótulo'}</span>
                    : <span className="text-graf-400">sem medição</span>}
                </td>
                <td className="px-3 py-1.5 text-graf-300">
                  {i.anterior_equipe ? `equipe ${i.anterior_equipe}` : <span className="text-graf-400">sem equipe</span>}
                  {i.anterior_tecnico && <span className="block text-[10px] text-graf-400">{i.anterior_tecnico}
                    {i.anterior_tecnico_do_cadastro && ' (cadastro)'}</span>}
                </td>
                <td className="px-3 py-1.5 text-graf-300">
                  {i.equipe ? `equipe ${i.equipe}` : <span className="text-amber-300">sem equipe</span>}
                  {i.tecnico && <span className="block text-[10px] text-graf-400">{i.tecnico}</span>}
                  <span className="block text-[10px] text-graf-400">{situacaoRotulo(i.situacao)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================ técnicos --
type Ordem = 'rev' | 'nota' | 'exec' | 'cert' | 'nome'

function TabelaTecnicos({ tecnicos, revTec, supSel, aoLimparSup, sel, aoSelecionar, hoje }: {
  tecnicos: (Tecnico & { exec: number; rev: number })[]; revTec: RevTec[]
  supSel: string | null; aoLimparSup: () => void
  sel: string | null; aoSelecionar: (id: string | null) => void; hoje: string
}) {
  const [ordem, setOrdem] = useState<Ordem>('rev')
  // o código ofensor de cada técnico: o código dos serviços DELE que voltaram
  const codigoDe = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const r of revTec) {
      if (!r.baixa) continue
      const x = m.get(r.tecnico_id) ?? new Map<string, number>()
      x.set(r.baixa, (x.get(r.baixa) ?? 0) + 1); m.set(r.tecnico_id, x)
    }
    const out = new Map<string, [string, number][]>()
    for (const [t, x] of m) out.set(t, [...x.entries()].sort((a, b) => b[1] - a[1]))
    return out
  }, [revTec])
  const nota = (t: { exec: number; rev: number }) => t.exec ? t.rev / t.exec : -1
  const cert = (t: Tecnico) => t.cert_fin ? t.cert_validado / t.cert_fin : -1
  const linhas = [...tecnicos].sort((a, b) =>
    ordem === 'rev' ? b.rev - a.rev || nota(b) - nota(a)
    : ordem === 'nota' ? nota(b) - nota(a) || b.rev - a.rev
    : ordem === 'exec' ? b.exec - a.exec
    : ordem === 'cert' ? cert(a) - cert(b)
    : (a.tecnico ?? '').localeCompare(b.tecnico ?? ''))
  const Th = ({ k, children, className = '' }: { k: Ordem; children: ReactNode; className?: string }) => (
    <th className={`px-3 py-1.5 font-medium ${className}`}>
      <button type="button" onClick={() => setOrdem(k)}
        className={`uppercase tracking-wide ${ordem === k ? 'text-graf-100' : 'hover:text-graf-200'}`}>
        {children}{ordem === k && ' ↓'}</button>
    </th>
  )
  return (
    <section className="card-controle overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
        <h2 className="text-sm font-semibold">Revisita por técnico</h2>
        <p className="text-[11px] text-graf-400">
          Os serviços executados no período e quantos voltaram em até 30 dias, contando até hoje
          ({curta(hoje)}). Clique no técnico para ver os contratos e o dia a dia.
        </p>
        {supSel && (
          <button type="button" onClick={aoLimparSup}
            className="ml-auto rounded bg-af-600 px-2 py-0.5 text-xs font-semibold text-white">
            {rotSup(supSel)} ✕</button>
        )}
      </div>
      <div className="mt-2 max-h-[32rem] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-graf-900 text-left text-[10px] text-graf-400">
            <tr>
              <Th k="nome">Técnico</Th>
              <Th k="exec" className="text-right">Executados</Th>
              <Th k="rev" className="text-right">Revisitas</Th>
              <Th k="nota" className="text-right">Nota revisita</Th>
              <th className="px-3 py-1.5 text-right font-medium uppercase tracking-wide"
                title="Serviços do período que ainda estão dentro dos 30 dias: ainda podem voltar">Ainda em 30 d</th>
              <th className="px-3 py-1.5 font-medium uppercase tracking-wide">Código ofensor</th>
              <Th k="cert" className="text-right">Certidão</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(t => {
              const aberto = sel === t.tecnico_id
              const cods = codigoDe.get(t.tecnico_id) ?? []
              const pc = pct(t.cert_validado, t.cert_fin)
              return (
                <Fragment key={t.tecnico_id}>
                  <tr className={`cursor-pointer border-t border-graf-800/60 hover:bg-graf-900 ${aberto ? 'bg-graf-900' : ''}`}
                    onClick={() => aoSelecionar(aberto ? null : t.tecnico_id)} aria-expanded={aberto}>
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-graf-100">{t.tecnico ?? 'Sem nome'}</span>
                      {t.nome_do_cadastro && <span className="text-[10px] text-graf-400" title="O histórico não trouxe o técnico: é o cadastrado na equipe"> (cadastro)</span>}
                      <span className="block text-[10px] text-graf-400">
                        {t.equipe ? `equipe ${t.equipe}` : 'sem equipe'} · {rotSup(t.supervisor)}</span>
                    </td>
                    <td className="tabular px-3 py-1.5 text-right">{n0(t.exec)}</td>
                    <td className="tabular px-3 py-1.5 text-right font-semibold"
                      style={t.rev ? { color: COR.atencao } : undefined}>{n0(t.rev)}</td>
                    <td className="tabular px-3 py-1.5 text-right font-semibold">{pct(t.rev, t.exec) ?? '—'}%</td>
                    <td className="tabular px-3 py-1.5 text-right text-graf-300">{n0(t.janela_aberta)}</td>
                    <td className="max-w-56 px-3 py-1.5 text-graf-300">
                      {cods[0] ? <span className="block truncate" title={cods.map(([k, n]) => `${k}: ${n}`).join('\n')}>
                        {cods[0][0]} <b className="tabular">{cods[0][1]}</b></span> : <span className="text-graf-400">—</span>}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right" title={`${t.cert_validado} de ${t.cert_fin} O.S. finalizadas no portal, validadas (com e sem falha)`}>
                      {pc ? <>{pc}%<span className="block text-[10px] text-graf-400">{t.cert_validado}/{t.cert_fin}</span></>
                        : <span className="text-graf-400">sem leitura</span>}
                    </td>
                  </tr>
                  {aberto && (
                    <tr className="bg-graf-900/60">
                      <td colSpan={7} className="px-3 pb-3">
                        <DetalheTecnico itens={revTec.filter(r => r.tecnico_id === t.tecnico_id)} codigos={cods} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {linhas.length === 0 && <p className="px-4 py-6 text-center text-sm text-graf-400">Nenhum serviço executado nos filtros.</p>}
      </div>
    </section>
  )
}

function DetalheTecnico({ itens, codigos }: { itens: RevTec[]; codigos: [string, number][] }) {
  if (!itens.length) return <p className="py-2 text-xs text-graf-400">Nenhum serviço dele voltou em 30 dias.</p>
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2 overflow-hidden rounded-lg border border-graf-800">
        <table className="w-full text-xs">
          <thead className="bg-graf-900 text-left text-[10px] uppercase tracking-wide text-graf-400">
            <tr>{['Serviço dele', 'Voltou em', 'Código do serviço dele'].map(h => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {itens.map(r => (
              <tr key={r.servico_id} className="border-t border-graf-800/60">
                <td className="whitespace-nowrap px-3 py-1.5">
                  <LinkContrato to={`/controle/visita/${r.servico_id}`} className="tabular text-af-400 underline underline-offset-2">
                    {r.contrato ?? 'sem contrato'}</LinkContrato>
                  <span className="tabular ml-1.5 text-[10px] text-graf-400">{curta(r.servico_dia)} · {r.familia === 'VT' ? 'VT' : 'instalação'}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <LinkContrato to={`/controle/visita/${r.visita_id}`} className="tabular text-af-400 underline underline-offset-2">
                    {curta(r.rev_dia)}</LinkContrato>
                  <span className="tabular ml-1.5 text-[10px] font-semibold" style={{ color: r.dias <= 7 ? COR.naoExecutado : COR.atencao }}>
                    {r.dias === 0 ? 'mesmo dia' : `${r.dias} d`}</span>
                </td>
                <td className="px-3 py-1.5 text-graf-300">{r.baixa ?? <span className="text-graf-400">sem código</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-graf-400">Código ofensor dele</p>
        <BarrasHorizontais cor={COR.atencao} dados={codigos.slice(0, 6).map(([k, n]) => ({ rotulo: k, valor: n }))} />
      </div>
    </div>
  )
}
