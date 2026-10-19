import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dataBR } from '../lib/formato'
import { Alerta } from './ui'

/**
 * O que cada código de baixa significa — e agora também o cadastro deles
 * (108, D-185).
 *
 * ┌─ por que a tela cadastra código ─────────────────────────────────┐
 * │ > "preciso que me deixe editar ou adicionar algum codigo no menu  │
 * │ >  dos codigos ok?" — Emanuel, 19/10                              │
 * │                                                                  │
 * │ O TOA mandou o 425 (TROCA DE TECNOLOGIA), que não estava no      │
 * │ cadastro: a importação gravou a O.S. sem código, a baixa         │
 * │ automática não tinha o que aplicar e o contrato ficou em         │
 * │ execução — calado (D-184). Corrigir dependia de migration.       │
 * │                                                                  │
 * │ Agora: "Códigos do TOA sem cadastro" mostra o que chegou e não   │
 * │ se conhece, com quantos contratos estão presos, e o botão já vem │
 * │ com o número e o texto do TOA. Quem barra é o banco              │
 * │ (`salvar_codigo_baixa`: gestão + "Editar" em configurações).     │
 * └──────────────────────────────────────────────────────────────────┘
 */
export interface CodigoBaixa {
  id: string
  codigo: number
  descricao: string
  familia: string | null
  natureza: string | null
  revisar: boolean | null
  situacao_destino: string | null
  situacao_origem: 'ANALISE' | 'CADASTRO' | null
}

interface SemCadastro {
  codigo: number; texto: string; contratos: number; presos: number; ultimo_dia: string
}

interface Rascunho {
  novo: boolean
  codigo: string; descricao: string; familia: string; natureza: string; situacao: string
}

const NATUREZAS = [
  ['SUCESSO', 'Sucesso'],
  ['IMPRODUTIVA', 'Improdutiva (conta como quebrado)'],
  ['CANCELAMENTO', 'Cancelamento'],
  ['REAGENDAMENTO', 'Reagendamento'],
  ['INDEFINIDA', 'Indefinida'],
] as const

const DESTINOS = [
  ['', '— sem destino —'],
  ['CONCLUIDA', 'Concluída'],
  ['REAGENDAMENTO', 'Reagendamento'],
  ['CANCELADA', 'Cancelada'],
] as const

const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2.5 py-1.5 text-sm outline-none focus:border-af-500'

/** "425 - TROCA DE TECNOLOGIA" → "TROCA DE TECNOLOGIA". */
const descricaoDoTexto = (t: string) => t.replace(/^\s*\d+\s*-?\s*/, '').trim()

export function CodigosDeBaixa({ codigos, onMudou }: {
  codigos: CodigoBaixa[]
  onMudou: () => void
}) {
  const [busca, setBusca] = useState('')
  const [soSemDestino, setSoSemDestino] = useState(false)
  const [soRevisar, setSoRevisar] = useState(false)
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [semCadastro, setSemCadastro] = useState<SemCadastro[] | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function carregarSemCadastro() {
    const { data, error } = await supabase.rpc('codigos_sem_cadastro', { p_dias: 30 })
    setSemCadastro(error ? [] : (data ?? []) as SemCadastro[])
  }
  useEffect(() => { carregarSemCadastro() }, [codigos])

  const familias = useMemo(() =>
    [...new Set(codigos.map(c => c.familia).filter((f): f is string => !!f))].sort(), [codigos])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return codigos.filter(c => {
      if (soSemDestino && c.situacao_destino) return false
      if (soRevisar && !c.revisar) return false
      if (!t) return true
      return String(c.codigo).includes(t) || c.descricao.toLowerCase().includes(t)
        || (c.familia ?? '').toLowerCase().includes(t)
    })
  }, [codigos, busca, soSemDestino, soRevisar])

  function traduzir(msg: string) {
    if (/permission|Sem permissao|42501/i.test(msg))
      return 'Seu usuário não pode alterar códigos — precisa de gestão e de "Editar" em Configurações. A barreira é do banco.'
    return msg
  }

  async function salvar() {
    if (!rascunho) return
    const n = Number(rascunho.codigo)
    if (!Number.isInteger(n) || n <= 0) { setErro('O código é o número que o TOA mostra (ex.: 425).'); return }
    if (!rascunho.descricao.trim()) { setErro('Escreva a descrição.'); return }
    if (!rascunho.familia.trim()) { setErro('Escolha a família.'); return }
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('salvar_codigo_baixa', {
      p_codigo: n, p_descricao: rascunho.descricao, p_familia: rascunho.familia,
      p_natureza: rascunho.natureza, p_situacao: rascunho.situacao || null, p_novo: rascunho.novo,
    })
    setOcupado(false)
    if (error) { setErro(traduzir(error.message)); return }
    const eraNovo = rascunho.novo
    const preso = semCadastro?.find(s => s.codigo === n)
    setOk(`${n} · ${rascunho.descricao.trim()} ${eraNovo ? 'cadastrado' : 'atualizado'}.`
      + (preso && preso.presos > 0
        ? ` Os ${preso.presos} contrato(s) já importados com ele fecham quando a planilha do dia for importada de novo.`
        : ''))
    setRascunho(null)
    onMudou()
  }

  /** O destino continua a um clique, sem abrir edição (como antes). */
  async function definirDestino(c: CodigoBaixa, situacao: string) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('definir_situacao_do_codigo', {
      p_codigo: c.codigo, p_situacao: situacao || null,
    })
    setOcupado(false)
    if (error) { setErro(traduzir(error.message)); return }
    setOk(`${c.codigo} · ${c.descricao} → ${situacao || 'sem destino'}.`)
    onMudou()
  }

  // Chamado como função, não como <Componente/>: um componente declarado
  // dentro do render remonta a cada tecla e o campo perde o foco.
  const formulario = () => rascunho && (
    <div className="space-y-3 border-b border-graf-800 bg-graf-900/60 px-4 py-3">
      <p className="text-sm font-medium text-graf-100">
        {rascunho.novo ? 'Novo código' : `Editar o código ${rascunho.codigo}`}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-graf-400">
          <span className="mb-1 block">Código *</span>
          <input value={rascunho.codigo} inputMode="numeric" disabled={!rascunho.novo}
            onChange={e => setRascunho(r => r && ({ ...r, codigo: e.target.value.replace(/\D/g, '') }))}
            className={`${campo} w-full`} placeholder="425" />
        </label>
        <label className="text-xs text-graf-400 lg:col-span-2">
          <span className="mb-1 block">Descrição * <span className="text-graf-500">— como o TOA mostra</span></span>
          <input value={rascunho.descricao}
            onChange={e => setRascunho(r => r && ({ ...r, descricao: e.target.value }))}
            className={`${campo} w-full`} placeholder="TROCA DE TECNOLOGIA" />
        </label>
        <label className="text-xs text-graf-400">
          <span className="mb-1 block">Família *</span>
          <input value={rascunho.familia} list="familias-de-codigo"
            onChange={e => setRascunho(r => r && ({ ...r, familia: e.target.value.toUpperCase() }))}
            className={`${campo} w-full`} placeholder="escolha ou escreva" />
          <datalist id="familias-de-codigo">
            {familias.map(f => <option key={f} value={f} />)}
          </datalist>
        </label>
        <label className="text-xs text-graf-400">
          <span className="mb-1 block">Natureza *</span>
          <select value={rascunho.natureza}
            onChange={e => setRascunho(r => r && ({ ...r, natureza: e.target.value }))}
            className={`${campo} w-full`}>
            {NATUREZAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label className="text-xs text-graf-400">
          <span className="mb-1 block">Leva a</span>
          <select value={rascunho.situacao}
            onChange={e => setRascunho(r => r && ({ ...r, situacao: e.target.value }))}
            className={`${campo} w-full`}>
            {DESTINOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-graf-400">
        Sem destino, a baixa automática não fecha o contrato que tiver este código — ele fica
        esperando alguém. Vale daqui para frente: contrato já importado muda quando a planilha
        do dia dele for importada de novo.
      </p>
      <div className="flex gap-2">
        <button onClick={salvar} disabled={ocupado}
          className="rounded-md bg-af-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-af-500 disabled:opacity-50">
          {ocupado ? 'Salvando…' : 'Salvar código'}
        </button>
        <button onClick={() => { setRascunho(null); setErro(null) }} disabled={ocupado}
          className="rounded-md border border-graf-700 px-4 py-1.5 text-sm text-graf-300 hover:border-af-600">
          Cancelar
        </button>
      </div>
    </div>
  )

  return (
    <section className="card-controle overflow-hidden">
      <div className="border-b border-graf-800 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">O que cada código significa</h2>
            <p className="mt-1 max-w-3xl text-sm text-graf-400">
              Derivado de <strong>67.485 linhas</strong> do analítico do sistema atual (meses 06
              e 07/2026): 203 dos 206 códigos caem <strong>sempre</strong> na mesma situação. O
              que está marcado como
              <span className="mx-1 rounded bg-graf-800 px-1 text-[10px] font-semibold uppercase text-graf-400">análise</span>
              veio daí; o que você mudar aqui vira
              <span className="mx-0.5 rounded bg-emerald-900/40 px-1 text-[10px] font-semibold uppercase text-emerald-300">cadastro</span>
              e não é mais tocado.
            </p>
          </div>
          <button disabled={ocupado}
            onClick={() => { setErro(null); setOk(null); setRascunho({ novo: true, codigo: '', descricao: '', familia: '', natureza: 'SUCESSO', situacao: '' }) }}
            className="shrink-0 rounded-md bg-af-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-af-500 disabled:opacity-50">
            Novo código
          </button>
        </div>

        {erro && <div className="mt-3"><Alerta tipo="erro">{erro}</Alerta></div>}
        {ok && <div className="mt-3"><Alerta tipo="ok">{ok}</Alerta></div>}

        {/* ┌─ o aviso que faltava (D-184/185) ─────────────────────────┐
            │ Código desconhecido não trava a importação — ela grava   │
            │ a O.S. sem código e segue. O contrato só fica parado. A  │
            │ lista mostra isso aqui, onde se corrige.                 │
            └──────────────────────────────────────────────────────────┘ */}
        {semCadastro && semCadastro.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2.5">
            <p className="text-sm font-medium text-amber-300">
              Códigos do TOA sem cadastro (últimos 30 dias)
            </p>
            <p className="mt-0.5 text-xs text-graf-300">
              A importação gravou a O.S. sem código e a baixa automática não fechou o contrato.
              Cadastre e importe de novo a planilha do dia.
            </p>
            <ul className="mt-2 space-y-1.5">
              {semCadastro.map(s => (
                <li key={s.codigo} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="tabular font-semibold text-graf-100">{s.texto}</span>
                  <span className="text-xs text-graf-400">
                    {s.contratos} contrato(s){s.presos > 0 && <> · <strong className="text-amber-300">{s.presos} preso(s)</strong></>}
                    {' '}· último em {dataBR(s.ultimo_dia)}
                  </span>
                  <button disabled={ocupado}
                    onClick={() => { setErro(null); setOk(null); setRascunho({ novo: true, codigo: String(s.codigo), descricao: descricaoDoTexto(s.texto), familia: '', natureza: 'SUCESSO', situacao: '' }) }}
                    className="rounded border border-amber-500/60 px-2 py-0.5 text-xs font-medium text-amber-200 hover:bg-amber-500/15">
                    Cadastrar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar código, descrição ou família…"
            className={`${campo} min-w-64 flex-1`} />
          <label className="flex items-center gap-1.5 text-xs text-graf-300">
            <input type="checkbox" checked={soSemDestino} onChange={e => setSoSemDestino(e.target.checked)}
              className="accent-af-600" />
            Só os sem destino
          </label>
          <label className="flex items-center gap-1.5 text-xs text-graf-300">
            <input type="checkbox" checked={soRevisar} onChange={e => setSoRevisar(e.target.checked)}
              className="accent-af-600" />
            Só os a revisar
          </label>
        </div>
      </div>

      {rascunho?.novo && formulario()}

      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-graf-700 bg-graf-900 text-left text-[11px] uppercase tracking-wide text-graf-400">
            <tr className="[&>th]:border-r [&>th]:border-graf-500/20 [&>th:last-child]:border-r-0">
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Descrição</th>
              <th className="px-3 py-2 font-medium">Família</th>
              <th className="px-3 py-2 font-medium">Natureza</th>
              <th className="px-3 py-2 font-medium">Leva a</th>
              <th className="px-3 py-2 font-medium">Origem</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtrados.map(c => (
              rascunho && !rascunho.novo && Number(rascunho.codigo) === c.codigo ? (
                <tr key={c.id}><td colSpan={7} className="p-0">{formulario()}</td></tr>
              ) : (
                <tr key={c.id} className="border-b border-graf-500/25 [&>td]:border-r [&>td]:border-graf-500/15 [&>td:last-child]:border-r-0">
                  <td className="tabular px-3 py-1.5 font-medium">{c.codigo}</td>
                  <td className="px-3 py-1.5 text-graf-300">
                    {c.descricao}
                    {c.revisar && (
                      <span title="Cadastro provisório: confira família e natureza"
                        className="ml-2 rounded bg-amber-900/40 px-1.5 text-[10px] font-semibold uppercase text-amber-300">
                        a revisar
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-400">{c.familia ?? '—'}</td>
                  <td className="px-3 py-1.5 text-xs text-graf-400">{c.natureza ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <select value={c.situacao_destino ?? ''} disabled={ocupado}
                      onChange={e => definirDestino(c, e.target.value)}
                      className={`${campo} w-40`}>
                      {DESTINOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    {c.situacao_origem === 'CADASTRO' ? (
                      <span title="Alguém desta operação declarou"
                        className="rounded bg-emerald-900/40 px-1.5 text-[10px] font-semibold uppercase text-emerald-300">cadastro</span>
                    ) : c.situacao_origem === 'ANALISE' ? (
                      <span title="Derivado do analítico do sistema atual"
                        className="rounded bg-graf-800 px-1.5 text-[10px] font-semibold uppercase text-graf-400">análise</span>
                    ) : <span className="text-xs text-graf-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button disabled={ocupado}
                      onClick={() => { setErro(null); setOk(null); setRascunho({ novo: false, codigo: String(c.codigo), descricao: c.descricao, familia: c.familia ?? '', natureza: c.natureza ?? 'INDEFINIDA', situacao: c.situacao_destino ?? '' }) }}
                      className="rounded border border-graf-700 px-2.5 py-1 text-[11px] text-graf-300 hover:border-af-600 hover:text-af-400">
                      Editar
                    </button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-graf-800 px-4 py-2.5 text-xs text-graf-400">
        {filtrados.length} de {codigos.length} códigos · o status da operadora <strong>não</strong>{' '}
        decide a situação: no analítico, EXECUTADA virou Reagendamento 1.075 vezes e Cancelado 657.
        Quem decide é o código.
      </p>
    </section>
  )
}
