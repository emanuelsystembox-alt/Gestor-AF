import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Shell } from '../components/Shell'
import { Alerta, Vazio } from '../components/ui'
import { Abastecimentos } from '../components/frota/Abastecimentos'
import { Consumo } from '../components/frota/Consumo'
import { Manutencoes } from '../components/frota/Manutencoes'
import {
  CAMPO, PERNOITE, PROPRIEDADE, SITUACAO_VEICULO, TIPO_VEICULO, km, nomeVeiculo, placaLegivel,
  traduzirErroFrota, type SituacaoVeiculo, type TecnicoOpcao, type VeiculoPainel,
} from '../lib/frota'

/**
 * Frota (088, D-164).
 *
 * ┌─ O QUE O CONCORRENTE ENSINOU, MEDINDO O DADO DA AFLINE LÁ ───────┐
 * │ 154 veículos; 195 abastecimentos numa semana; 11 manutenções num │
 * │ ano; portaria abandonada desde out/2023. O módulo que se usa de   │
 * │ verdade é ABASTECIMENTO — e o "Uso e Consumo" deles mede o km    │
 * │ pela portaria, então mostra consumo "—" ao lado de R$ 108 mil no │
 * │ mês. Aqui o consumo sai do odômetro que a AFLINE já digita em    │
 * │ cada abastecimento.                                               │
 * │                                                                   │
 * │ > "vamos usar o nome do técnico como condutor […] nada de equipe  │
 * │ >  pra não ter duplicada" — Emanuel. O concorrente grava o login  │
 * │   da equipe ("109 - EQUIPE"): a dupla vira um nome só.            │
 * └───────────────────────────────────────────────────────────────────┘
 */

type Aba = 'veiculos' | 'abastecimentos' | 'consumo' | 'manutencoes'

interface Evento {
  id: number; tipo: string; de: unknown; para: unknown; motivo: string | null
  criado_em: string
}
interface PeriodoCondutor {
  id: string; desde: string; ate: string | null
  tecnico: { nome: string } | null
}

const VAZIO_FORM = {
  placa: '', apelido: '', modelo: '', tipo: '', ano: '', chassi: '', renavam: '',
  propriedade: '', pernoite: '', rastreador: '', situacao: 'NA_GARAGEM', hodometro_cadastro: '',
  observacao: '',
}

export default function Frota() {
  const { pode } = useAuth()
  const podeMexer = pode('frota.editar')
  const [aba, setAba] = useState<Aba>('veiculos')
  const [veiculos, setVeiculos] = useState<VeiculoPainel[]>([])
  const [tecnicos, setTecnicos] = useState<TecnicoOpcao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // filtros
  const [busca, setBusca] = useState('')
  const [filtroSit, setFiltroSit] = useState<SituacaoVeiculo | ''>('')
  const [verArquivados, setVerArquivados] = useState(false)

  // cadastro
  const [editando, setEditando] = useState<string | 'novo' | null>(null)
  const [form, setForm] = useState({ ...VAZIO_FORM })

  // histórico de um veículo
  const [aberto, setAberto] = useState<string | null>(null)
  const [eventos, setEventos] = useState<Evento[]>([])
  const [condutores, setCondutores] = useState<PeriodoCondutor[]>([])

  const recarregar = useCallback(async () => {
    setCarregando(true)
    const [v, t] = await Promise.all([
      supabase.rpc('frota_painel'),
      supabase.from('tecnico').select('id, nome, matricula').eq('situacao', 'ATIVO').order('nome'),
    ])
    if (v.error) setErro(v.error.message)
    setVeiculos((v.data ?? []) as VeiculoPainel[])
    setTecnicos((t.data ?? []) as TecnicoOpcao[])
    setCarregando(false)
  }, [])
  useEffect(() => { recarregar() }, [recarregar])

  const ativos = veiculos.filter(v => !v.arquivado_em)
  /** Técnico condutor de mais de um carro ao mesmo tempo. Não é recusado
   *  — ninguém combinou que não pode —, mas a tela mostra. */
  const emDois = useMemo(() => {
    const n = new Map<string, number>()
    ativos.forEach(v => { if (v.condutor_id) n.set(v.condutor_id, (n.get(v.condutor_id) ?? 0) + 1) })
    return new Set([...n].filter(([, c]) => c > 1).map(([id]) => id))
  }, [ativos])

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '')
    return veiculos.filter(v => {
      if (!verArquivados && v.arquivado_em) return false
      if (verArquivados && !v.arquivado_em) return false
      if (filtroSit && v.situacao !== filtroSit) return false
      if (!t) return true
      return [v.placa, v.apelido, v.modelo, v.condutor_nome]
        .some(x => (x ?? '').toLowerCase().includes(t))
    })
  }, [veiculos, busca, filtroSit, verArquivados])

  const porSituacao = (s: SituacaoVeiculo) => ativos.filter(v => v.situacao === s).length

  async function chamar(fn: () => PromiseLike<{ error: { message: string } | null }>, sucesso: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await fn()
    if (error) setErro(traduzirErroFrota(error.message))
    else { setOk(sucesso); await recarregar() }
    setOcupado(false)
    return !error
  }

  function abrirCadastro(v: VeiculoPainel | null) {
    setErro(null); setOk(null)
    if (!v) { setForm({ ...VAZIO_FORM }); setEditando('novo'); return }
    // O painel não traz chassi/renavam/observação: busca a linha inteira.
    supabase.from('veiculo').select('*').eq('id', v.id).maybeSingle().then(({ data }) => {
      const d = (data ?? {}) as Record<string, unknown>
      const s = (k: string) => (d[k] == null ? '' : String(d[k]))
      setForm({
        placa: s('placa'), apelido: s('apelido'), modelo: s('modelo'), tipo: s('tipo'),
        ano: s('ano'), chassi: s('chassi'), renavam: s('renavam'),
        propriedade: s('propriedade'), pernoite: s('pernoite'), rastreador: s('rastreador'),
        situacao: s('situacao') || 'NA_GARAGEM',
        hodometro_cadastro: s('hodometro_cadastro'), observacao: s('observacao'),
      })
      setEditando(v.id)
    })
  }

  async function salvar() {
    const id = editando === 'novo' ? null : editando
    const certo = await chamar(
      () => supabase.rpc('salvar_veiculo', { p_id: id, p_dados: form }),
      id ? `Cadastro de ${form.placa.toUpperCase()} atualizado.` : `${form.placa.toUpperCase()} cadastrado.`)
    if (certo) setEditando(null)
  }

  async function mudarSituacao(v: VeiculoPainel, s: SituacaoVeiculo) {
    await chamar(() => supabase.rpc('definir_situacao_veiculo', { p_veiculo: v.id, p_situacao: s }),
      `${nomeVeiculo(v)}: ${SITUACAO_VEICULO[s].rotulo.toLowerCase()}.`)
  }

  async function mudarCondutor(v: VeiculoPainel, tecnico: string) {
    await chamar(() => supabase.rpc('definir_condutor', { p_veiculo: v.id, p_tecnico: tecnico || null }),
      tecnico
        ? `${nomeVeiculo(v)} agora com ${tecnicos.find(t => t.id === tecnico)?.nome}.`
        : `${nomeVeiculo(v)} ficou sem condutor.`)
  }

  async function arquivar(v: VeiculoPainel) {
    const arquivando = !v.arquivado_em
    const motivo = prompt(arquivando
      ? `Por que ${nomeVeiculo(v)} sai da frota? (vendido, devolvido à locadora, sinistro…)`
      : `Por que ${nomeVeiculo(v)} volta para a frota?`)
    if (!motivo) return
    await chamar(() => supabase.rpc('arquivar_veiculo',
      { p_veiculo: v.id, p_arquivar: arquivando, p_motivo: motivo }),
      arquivando ? `${nomeVeiculo(v)} arquivado. O histórico continua.` : `${nomeVeiculo(v)} reativado.`)
  }

  async function verHistorico(id: string) {
    if (aberto === id) { setAberto(null); return }
    setAberto(id); setEventos([]); setCondutores([])
    const [e, c] = await Promise.all([
      supabase.from('veiculo_evento').select('id, tipo, de, para, motivo, criado_em')
        .eq('veiculo_id', id).order('criado_em', { ascending: false }).limit(30),
      supabase.from('veiculo_condutor').select('id, desde, ate, tecnico:tecnico_id ( nome )')
        .eq('veiculo_id', id).order('desde', { ascending: false }),
    ])
    setEventos((e.data ?? []) as Evento[])
    setCondutores((c.data ?? []) as unknown as PeriodoCondutor[])
  }

  const nomeTec = (id: unknown) =>
    typeof id === 'string' ? tecnicos.find(t => t.id === id)?.nome ?? 'técnico desligado' : 'ninguém'

  function descreverEvento(ev: Evento): string {
    if (ev.tipo === 'SITUACAO') {
      const r = (x: unknown) => SITUACAO_VEICULO[x as SituacaoVeiculo]?.rotulo ?? String(x)
      return `situação: ${r(ev.de)} → ${r(ev.para)}`
    }
    if (ev.tipo === 'CONDUTOR') return `condutor: ${nomeTec(ev.de)} → ${nomeTec(ev.para)}`
    if (ev.tipo === 'ARQUIVADO') return 'saiu da frota'
    if (ev.tipo === 'REATIVADO') return 'voltou para a frota'
    return ev.de ? 'cadastro alterado' : 'cadastrado'
  }

  const campo = (k: keyof typeof VAZIO_FORM, rotulo: string, extra = '') => (
    <label className="text-[11px] text-graf-400">
      <span className="mb-1 block">{rotulo}</span>
      <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
        className={`${CAMPO} w-full ${extra}`} />
    </label>
  )

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Frota</h1>
          <p className="mt-1 max-w-3xl text-sm text-graf-400">
            Os carros, quem está com cada um, o que foi abastecido e o que isso rende em
            quilômetro. O consumo sai do <strong>odômetro de cada abastecimento</strong> —
            não de um número de fábrica.
          </p>
        </div>

        <div className="flex flex-wrap rounded-lg bg-graf-900 p-0.5">
          {([['veiculos', 'Veículos', ativos.length],
             ['abastecimentos', 'Abastecimentos', null],
             ['consumo', 'Consumo e exceções', null],
             ['manutencoes', 'Manutenções', null]] as const).map(([a, rot, n]) => (
            <button key={a} onClick={() => setAba(a)} aria-pressed={aba === a}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                aba === a ? 'bg-af-600 text-white' : 'text-graf-300 hover:bg-graf-800'}`}>
              {rot}{n != null && <span className="tabular ml-1.5 opacity-60">{n}</span>}
            </button>
          ))}
        </div>

        {aba === 'abastecimentos' && (
          <Abastecimentos veiculos={ativos} tecnicos={tecnicos} podeMexer={podeMexer} />
        )}
        {aba === 'consumo' && <Consumo veiculos={veiculos} tecnicos={tecnicos} />}
        {aba === 'manutencoes' && (
          <Manutencoes veiculos={ativos} podeMexer={podeMexer} aoMudar={recarregar} />
        )}

        {aba === 'veiculos' && (<>
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          {ok && <Alerta tipo="ok">{ok}</Alerta>}

          {/* ---- o resumo: os quatro status do concorrente, clicáveis ---- */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(SITUACAO_VEICULO) as SituacaoVeiculo[]).map(s => (
              <button key={s} onClick={() => setFiltroSit(f => f === s ? '' : s)}
                aria-pressed={filtroSit === s}
                className={`card-controle px-3.5 py-3 text-left transition ${
                  filtroSit === s ? 'ring-1 ring-af-500' : 'hover:border-graf-600'}`}>
                <div className="tabular text-2xl font-semibold leading-none">{porSituacao(s)}</div>
                <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
                  {SITUACAO_VEICULO[s].rotulo}
                </div>
              </button>
            ))}
          </div>

          {/* ┌─ as contas que o Emanuel pediu ─────────────────────────┐
              │ "quantos carros alugados temos, e carros próprios,     │
              │  quantos levam carro pra casa e quantos não" — um      │
              │  quadro de propriedade × onde dorme, da frota ativa.   │
              └────────────────────────────────────────────────────────┘ */}
          {ativos.length > 0 && (
            <section className="card-controle overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-graf-800 text-left text-[10px] uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">De quem é</th>
                    {[...Object.keys(PERNOITE), ''].map(p => (
                      <th key={p || 'sem'} className="px-3 py-1.5 text-right font-medium">
                        {p ? PERNOITE[p] : 'não informado'}
                      </th>
                    ))}
                    <th className="px-3 py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...Object.keys(PROPRIEDADE), ''].map(pr => {
                    const doTipo = ativos.filter(v => (v.propriedade ?? '') === pr)
                    if (doTipo.length === 0) return null
                    return (
                      <tr key={pr || 'sem'} className="border-b border-graf-800">
                        <td className="px-3 py-1.5 text-graf-200">{pr ? PROPRIEDADE[pr] : 'não informado'}</td>
                        {[...Object.keys(PERNOITE), ''].map(pn => (
                          <td key={pn || 'sem'} className="tabular px-3 py-1.5 text-right text-graf-300">
                            {doTipo.filter(v => (v.pernoite ?? '') === pn).length || '—'}
                          </td>
                        ))}
                        <td className="tabular px-3 py-1.5 text-right font-semibold text-graf-100">{doTipo.length}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="placa, apelido, modelo ou condutor…" aria-label="Buscar veículo"
              className={`${CAMPO} w-72`} />
            <label className="flex items-center gap-1.5 text-xs text-graf-300">
              <input type="checkbox" checked={verArquivados}
                onChange={e => setVerArquivados(e.target.checked)} className="accent-af-600" />
              ver os que saíram da frota
            </label>
            {podeMexer && (
              <button onClick={() => abrirCadastro(null)}
                className="ml-auto rounded-md bg-af-600 px-3 py-1.5 text-xs font-medium text-white
                           hover:bg-af-500">
                + Veículo
              </button>
            )}
          </div>

          {/* ---- cadastro ---- */}
          {editando && (
            <section className="card-controle p-4">
              <h2 className="text-sm font-semibold">
                {editando === 'novo' ? 'Novo veículo' : `Editar ${placaLegivel(form.placa)}`}
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {campo('placa', 'Placa *', 'font-mono uppercase')}
                {campo('apelido', 'Apelido (ZEBRA, COLISEU…)')}
                {campo('modelo', 'Modelo')}
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Tipo</span>
                  <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                    className={`${CAMPO} w-full`}>
                    <option value="">— não informado —</option>
                    {Object.entries(TIPO_VEICULO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">De quem é</span>
                  <select value={form.propriedade}
                    onChange={e => setForm(f => ({ ...f, propriedade: e.target.value }))}
                    className={`${CAMPO} w-full`}>
                    <option value="">— não informado —</option>
                    {Object.entries(PROPRIEDADE).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-graf-400">
                  <span className="mb-1 block">Onde dorme</span>
                  <select value={form.pernoite}
                    onChange={e => setForm(f => ({ ...f, pernoite: e.target.value }))}
                    className={`${CAMPO} w-full`}>
                    <option value="">— não informado —</option>
                    {Object.entries(PERNOITE).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                  </select>
                </label>
                {editando === 'novo' && (
                  <label className="text-[11px] text-graf-400">
                    <span className="mb-1 block">Situação inicial</span>
                    <select value={form.situacao}
                      onChange={e => setForm(f => ({ ...f, situacao: e.target.value }))}
                      className={`${CAMPO} w-full`}>
                      {(Object.keys(SITUACAO_VEICULO) as SituacaoVeiculo[]).map(s => (
                        <option key={s} value={s}>{SITUACAO_VEICULO[s].rotulo}</option>
                      ))}
                    </select>
                  </label>
                )}
                {campo('ano', 'Ano de fabricação')}
                {campo('hodometro_cadastro', 'Odômetro no cadastro (km)')}
                {campo('chassi', 'Chassi', 'font-mono')}
                {campo('renavam', 'Renavam', 'font-mono')}
                {campo('rastreador', 'Rastreador (ex.: SSX)')}
                {campo('observacao', 'Observação')}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={salvar} disabled={ocupado || form.placa.trim().length < 7}
                  className="rounded-md bg-af-600 px-4 py-1.5 text-xs font-medium text-white
                             hover:bg-af-500 disabled:opacity-40">
                  Salvar
                </button>
                <button onClick={() => setEditando(null)}
                  className="rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300">
                  Cancelar
                </button>
              </div>
            </section>
          )}

          {/* ---- a lista ---- */}
          {carregando ? (
            <p className="py-12 text-center text-graf-400" role="status">Carregando…</p>
          ) : lista.length === 0 ? (
            <Vazio titulo={veiculos.length === 0 ? 'Nenhum veículo cadastrado' : 'Nada com esse filtro'}
              descricao={veiculos.length === 0
                ? (podeMexer ? 'Cadastre o primeiro em "+ Veículo".' : 'Quem tem "Lançar na frota" cadastra.')
                : undefined} />
          ) : (
            <section className="card-controle overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                                  uppercase tracking-wide text-graf-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Veículo</th>
                    <th className="px-3 py-2 font-medium">De quem é</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="px-3 py-2 font-medium">Condutor</th>
                    <th className="px-3 py-2 text-right font-medium">Odômetro</th>
                    <th className="px-3 py-2 font-medium">Último abast.</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(v => (
                    <Fragment key={v.id}>
                      <tr className="border-b border-graf-800 align-top">
                        <td className="px-3 py-1.5">
                          <button onClick={() => verHistorico(v.id)}
                            className="text-left" aria-expanded={aberto === v.id}>
                            <span className="block text-xs font-semibold text-graf-100">
                              {v.apelido ?? '—'}
                            </span>
                            <span className="tabular block font-mono text-[11px] text-af-300">
                              {placaLegivel(v.placa)}
                            </span>
                            <span className="block text-[10px] text-graf-400">
                              {[v.modelo, v.ano, v.tipo && TIPO_VEICULO[v.tipo]].filter(Boolean).join(' · ') || 'sem modelo'}
                              {v.rastreador && ` · rastreador ${v.rastreador}`}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-graf-300">
                          {v.propriedade ? PROPRIEDADE[v.propriedade] : <span className="text-graf-400">não informado</span>}
                          {v.pernoite && <span className="block text-[10px] text-graf-400">{PERNOITE[v.pernoite]}</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {v.arquivado_em ? (
                            <span className="text-[11px] text-graf-400">
                              saiu: {v.arquivado_motivo}
                            </span>
                          ) : podeMexer ? (
                            <select value={v.situacao} disabled={ocupado}
                              onChange={e => mudarSituacao(v, e.target.value as SituacaoVeiculo)}
                              aria-label={`Situação de ${nomeVeiculo(v)}`}
                              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold outline-none
                                          ${SITUACAO_VEICULO[v.situacao].classe}`}>
                              {(Object.keys(SITUACAO_VEICULO) as SituacaoVeiculo[]).map(s => (
                                <option key={s} value={s}>{SITUACAO_VEICULO[s].rotulo}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold
                                              ${SITUACAO_VEICULO[v.situacao].classe}`}>
                              {SITUACAO_VEICULO[v.situacao].rotulo}
                            </span>
                          )}
                          {v.manutencao_aberta && (
                            <span className="mt-0.5 block text-[10px] text-af-300">manutenção aberta</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {podeMexer && !v.arquivado_em ? (
                            <select value={v.condutor_id ?? ''} disabled={ocupado}
                              onChange={e => mudarCondutor(v, e.target.value)}
                              aria-label={`Condutor de ${nomeVeiculo(v)}`}
                              className={`${CAMPO} max-w-52 py-0.5`}>
                              <option value="">— sem condutor —</option>
                              {tecnicos.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.nome}{t.matricula ? ` · ${t.matricula}` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-graf-300">{v.condutor_nome ?? '—'}</span>
                          )}
                          {v.condutor_id && emDois.has(v.condutor_id) && (
                            <span className="mt-0.5 block text-[10px] text-amber-300">
                              condutor de outro carro também
                            </span>
                          )}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                          {km(v.hodometro_atual)}
                        </td>
                        <td className="tabular px-3 py-1.5 text-xs text-graf-400">
                          {v.ultimo_abastecimento
                            ? new Date(v.ultimo_abastecimento + 'T12:00').toLocaleDateString('pt-BR')
                            : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {podeMexer && (<>
                            {!v.arquivado_em && (
                              <button onClick={() => abrirCadastro(v)}
                                className="mr-1 rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                           text-graf-300 hover:border-af-600 hover:text-af-400">
                                editar
                              </button>
                            )}
                            <button onClick={() => arquivar(v)}
                              className="rounded border border-graf-700 px-2 py-0.5 text-[11px]
                                         text-graf-400 hover:border-af-600 hover:text-af-400">
                              {v.arquivado_em ? 'reativar' : 'tirar da frota'}
                            </button>
                          </>)}
                        </td>
                      </tr>
                      {aberto === v.id && (
                        <tr className="border-b border-graf-800 bg-graf-900/50">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <h3 className="text-[10px] font-medium uppercase tracking-wide text-graf-400">
                                  Quem dirigiu
                                </h3>
                                {condutores.length === 0 ? (
                                  <p className="mt-1 text-xs text-graf-400">Nunca teve condutor declarado.</p>
                                ) : (
                                  <ul className="mt-1 space-y-0.5 text-xs text-graf-300">
                                    {condutores.map(c => (
                                      <li key={c.id}>
                                        <strong className="text-graf-100">{c.tecnico?.nome ?? '—'}</strong>
                                        {' · '}{new Date(c.desde).toLocaleDateString('pt-BR')}
                                        {' → '}{c.ate ? new Date(c.ate).toLocaleDateString('pt-BR') : 'hoje'}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <h3 className="text-[10px] font-medium uppercase tracking-wide text-graf-400">
                                  Histórico
                                </h3>
                                <ul className="mt-1 space-y-0.5 text-xs text-graf-300">
                                  {eventos.map(ev => (
                                    <li key={ev.id}>
                                      <span className="tabular text-graf-400">
                                        {new Date(ev.criado_em).toLocaleString('pt-BR')}
                                      </span>{' '}
                                      {descreverEvento(ev)}
                                      {ev.motivo && <span className="text-graf-400"> — {ev.motivo}</span>}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>)}
      </div>
    </Shell>
  )
}
