import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dataBR, diaMes, isoLocal } from '../lib/formato'
import { LinkContrato } from './LinkContrato'
import { Alerta, Vazio, CarregandoBloco } from './ui'

/**
 * Conferência TOA — o estoque conferido pelo que o TOA diz (182, D-262).
 *
 * ┌─ SÓ ACUSA ─────────────────────────────────────────────────────────┐
 * │ Decisão do Emanuel (02/11): a divergência vira FILA, e nada aqui     │
 * │ move posse nem saldo. A correção continua sendo o romaneio ou o      │
 * │ campo (D-154, D-157). "Tratar" é dizer "o almoxarifado viu, e foi    │
 * │ isto" — com motivo, que o banco exige.                               │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Zero e "não conferido" (regra 6): contrato encerrado que a varredura
 * não leu NÃO entra na fila e é contado à parte, no cartão "não lidos".
 * Uma fila vazia com 2.541 contratos não lidos não quer dizer "estoque
 * certo" — e o cartão fica à vista para isso não se perder.
 *
 * A conta toda é do servidor (`conferencia_estoque_toa`); a tela só
 * filtra o que já veio.
 */

type Tipo = 'CARGA_DE_OUTRO' | 'FORA_DA_CARGA' | 'POSSE_NAO_BAIXADA' | 'SEM_CADASTRO'
          | 'RETIRADO_SEM_DEVOLUTIVA' | 'LANCADO_SEM_TOA'

// Ordem = gravidade para o almoxarifado: peça de outro técnico primeiro.
const TIPOS: Tipo[] = ['CARGA_DE_OUTRO', 'FORA_DA_CARGA', 'POSSE_NAO_BAIXADA',
                       'RETIRADO_SEM_DEVOLUTIVA', 'LANCADO_SEM_TOA', 'SEM_CADASTRO']

const TIPO: Record<Tipo, { rotulo: string; dica: string; classe: string }> = {
  CARGA_DE_OUTRO: {
    rotulo: 'Carga de outro técnico',
    dica: 'O TOA mostra instalado, e a peça estava na carga de outro técnico',
    classe: 'bg-af-900/40 text-af-300' },
  FORA_DA_CARGA: {
    rotulo: 'Instalado sem estar na carga',
    dica: 'O TOA mostra instalado, e a peça não estava na carga de ninguém',
    classe: 'bg-af-900/40 text-af-300' },
  POSSE_NAO_BAIXADA: {
    rotulo: 'Ainda na carga',
    dica: 'O TOA mostra instalado, e a peça continua na carga do técnico (o campo não lançou)',
    classe: 'bg-amber-900/40 text-amber-300' },
  RETIRADO_SEM_DEVOLUTIVA: {
    rotulo: 'Retirado sem devolutiva',
    dica: 'Retirado do cliente no TOA e sem devolutiva confirmada depois do prazo',
    classe: 'bg-amber-900/40 text-amber-300' },
  LANCADO_SEM_TOA: {
    rotulo: 'Lançado, TOA não mostra',
    dica: 'O técnico lançou no campo e a leitura do TOA deste contrato não tem o serial',
    classe: 'bg-sky-900/40 text-sky-300' },
  SEM_CADASTRO: {
    rotulo: 'Fora do cadastro',
    dica: 'O TOA mostra instalado, e o serial não existe no cadastro do almoxarifado',
    classe: 'bg-graf-800 text-graf-300' },
}

interface Item {
  tipo: Tipo; visita_id: string; contrato: string | null; dia: string
  secao: 'INSTALADO' | 'DESINSTALADO'; serial: string
  equipamento: string | null; modelo: string | null
  tecnico: string | null; equipe: string | null
  posse: string | null; posse_tecnico: string | null; posse_em: string | null
  outro_tecnico: string | null; dias: number
  lido_em: string | null; lancado_em: string | null
  tratada: { motivo: string; em: string; por: string | null } | null
}
interface Conferencia {
  de: string; ate: string; prazo_retirado_dias: number; cadastro_pecas: number
  contratos: { encerrados: number; conferidos: number; nao_conferidos: number }
  seriais_lidos: { instalados: number; retirados: number }
  retirados_no_prazo: number
  por_tipo: Partial<Record<Tipo, { abertas: number; tratadas: number }>>
  itens: Item[]
}

const POSSE: Record<string, string> = {
  NO_ALMOXARIFADO: 'no almoxarifado', COM_TECNICO: 'com o técnico',
  COM_ASSINANTE: 'com o assinante', EM_TRANSITO: 'em trânsito',
  DEVOLVIDO_CLARO: 'devolvido à CLARO',
}
const n = (v: number) => v.toLocaleString('pt-BR')
const campo = 'rounded-md border border-graf-700 bg-graf-900 px-2 py-1.5 text-xs ' +
              'outline-none focus:border-af-500'

function menosDias(iso: string, d: number) {
  const x = new Date(iso + 'T12:00'); x.setDate(x.getDate() - d); return isoLocal(x)
}

/** CSV com ponto e vírgula: é o que o Excel em português abre sem assistente. */
function baixarCsv(nome: string, linhas: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const blob = new Blob(['﻿' + linhas.map(l => l.map(esc).join(';')).join('\r\n')],
                        { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = nome; a.click()
  URL.revokeObjectURL(a.href)
}

/** O que a coluna "Onde estava" diz, por tipo. Sem dado, diz que não sabe. */
function ondeEstava(i: Item): string {
  switch (i.tipo) {
    case 'CARGA_DE_OUTRO': return `carga de ${i.outro_tecnico ?? 'técnico não identificado'}`
    case 'LANCADO_SEM_TOA': return `lançado por ${i.outro_tecnico ?? 'técnico não identificado'}`
    case 'SEM_CADASTRO': return 'serial não cadastrado'
    default:
      if (!i.posse) return 'sem posse declarada'
      return (POSSE[i.posse] ?? i.posse) + (i.posse_tecnico ? ` · ${i.posse_tecnico}` : '')
  }
}

export function ConferenciaToa({ podeTratar }: { podeTratar: boolean }) {
  const hoje = isoLocal()
  const [de, setDe] = useState(() => menosDias(hoje, 30))
  const [ate, setAte] = useState(hoje)
  const [dados, setDados] = useState<Conferencia | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [fTipo, setFTipo] = useState<Tipo | 'TODOS'>('TODOS')
  const [fSituacao, setFSituacao] = useState<'ABERTAS' | 'TRATADAS'>('ABERTAS')
  const [busca, setBusca] = useState('')
  const [tratando, setTratando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('conferencia_estoque_toa', { p_de: de, p_ate: ate })
    if (error) { setErro(error.message); setDados(null) }
    else setDados(data as Conferencia)
    setCarregando(false)
  }, [de, ate])
  useEffect(() => { carregar() }, [carregar])

  const chave = (i: Item) => `${i.visita_id}|${i.tipo}|${i.serial}`

  const lista = useMemo(() => {
    const q = busca.trim().toUpperCase()
    return (dados?.itens ?? []).filter(i =>
      (fTipo === 'TODOS' || i.tipo === fTipo)
      && (fSituacao === 'ABERTAS' ? !i.tratada : !!i.tratada)
      && (!q || i.serial.includes(q) || (i.contrato ?? '').includes(q)
          || (i.tecnico ?? '').toUpperCase().includes(q)
          || (i.outro_tecnico ?? '').toUpperCase().includes(q)))
  }, [dados, fTipo, fSituacao, busca])

  const abertas = TIPOS.reduce((s, t) => s + (dados?.por_tipo[t]?.abertas ?? 0), 0)

  async function tratar(i: Item) {
    setOcupado(true); setErro(null); setOk(null)
    const { error } = await supabase.rpc('tratar_divergencia_toa', {
      p_visita: i.visita_id, p_tipo: i.tipo, p_serial: i.serial, p_motivo: motivo.trim(),
    })
    setOcupado(false)
    if (error) { setErro(error.message); return }
    setOk(`${i.serial} tratado.`)
    setTratando(null); setMotivo('')
    await carregar()
  }

  function exportar() {
    baixarCsv(`conferencia-toa-${de}-a-${ate}.csv`, [
      ['Divergência', 'Contrato', 'Dia', 'Serial', 'Equipamento', 'Modelo', 'Técnico do contrato',
       'Equipe', 'Onde estava', 'Dias', 'Tratada', 'Motivo', 'Tratada por'],
      ...lista.map(i => [TIPO[i.tipo].rotulo, i.contrato, dataBR(i.dia), i.serial, i.equipamento,
        i.modelo, i.tecnico, i.equipe, ondeEstava(i), i.dias,
        i.tratada ? new Date(i.tratada.em).toLocaleString('pt-BR') : null,
        i.tratada?.motivo ?? null, i.tratada?.por ?? null]),
    ])
  }

  const c = dados?.contratos
  return (
    <div className="space-y-3">
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {ok && <Alerta tipo="ok">{ok}</Alerta>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-graf-400">
          De
          <input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)}
            className={`${campo} mt-0.5 block`} />
        </label>
        <label className="text-[11px] text-graf-400">
          Até
          <input type="date" value={ate} min={de} max={hoje} onChange={e => setAte(e.target.value)}
            className={`${campo} mt-0.5 block`} />
        </label>
        <div className="flex rounded-md bg-graf-900 p-0.5 text-xs" role="group" aria-label="Situação">
          {(['ABERTAS', 'TRATADAS'] as const).map(s => (
            <button key={s} onClick={() => setFSituacao(s)} aria-pressed={fSituacao === s}
              className={`rounded px-2.5 py-1 ${fSituacao === s ? 'bg-af-600 text-white' : 'text-graf-300'}`}>
              {s === 'ABERTAS' ? 'Abertas' : 'Tratadas'}
            </button>
          ))}
        </div>
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="serial, contrato ou técnico…" aria-label="Buscar"
          className={`${campo} w-64`} />
        <button onClick={exportar} disabled={lista.length === 0}
          className="ml-auto rounded-md border border-graf-700 px-3 py-1.5 text-xs text-graf-300
                     hover:border-af-600 disabled:opacity-40">
          exportar planilha
        </button>
      </div>

      {dados && c && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="card-controle px-3.5 py-3">
            <div className="tabular text-2xl font-semibold leading-none">{n(abertas)}</div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">divergências abertas</div>
          </div>
          <div className="card-controle px-3.5 py-3"
            title={`${n(c.conferidos)} de ${n(c.encerrados)} contratos encerrados no TOA`}>
            <div className="tabular text-2xl font-semibold leading-none">
              {n(c.conferidos)}<span className="text-sm font-normal text-graf-400"> / {n(c.encerrados)}</span>
            </div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">contratos conferidos</div>
          </div>
          <div className={`card-controle px-3.5 py-3 ${c.nao_conferidos ? 'ring-1 ring-amber-600/50' : ''}`}
            title="Encerrados no TOA e ainda não lidos pela varredura: sem conferência">
            <div className="tabular text-2xl font-semibold leading-none text-amber-300">{n(c.nao_conferidos)}</div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">não lidos do TOA</div>
          </div>
          <div className="card-controle px-3.5 py-3"
            title={`Retirados há até ${dados.prazo_retirado_dias} dias: ainda no prazo da devolutiva`}>
            <div className="tabular text-2xl font-semibold leading-none">{n(dados.retirados_no_prazo)}</div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
              retirados no prazo ({dados.prazo_retirado_dias} d)
            </div>
          </div>
          <div className="card-controle px-3.5 py-3" title="Seriais no cadastro do almoxarifado">
            <div className="tabular text-2xl font-semibold leading-none">{n(dados.cadastro_pecas)}</div>
            <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">peças no cadastro</div>
          </div>
        </div>
      )}

      {dados && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Divergência">
          <button onClick={() => setFTipo('TODOS')} aria-pressed={fTipo === 'TODOS'}
            className={`rounded-md border px-2.5 py-1 text-xs ${fTipo === 'TODOS'
              ? 'border-af-600 bg-af-600/20 text-graf-100' : 'border-graf-700 text-graf-300 hover:border-graf-500'}`}>
            Todas
          </button>
          {TIPOS.map(t => {
            const q = dados.por_tipo[t]
            const v = fSituacao === 'ABERTAS' ? q?.abertas ?? 0 : q?.tratadas ?? 0
            return (
              <button key={t} onClick={() => setFTipo(t)} aria-pressed={fTipo === t} title={TIPO[t].dica}
                className={`rounded-md border px-2.5 py-1 text-xs ${fTipo === t
                  ? 'border-af-600 bg-af-600/20 text-graf-100' : 'border-graf-700 text-graf-300 hover:border-graf-500'}`}>
                {TIPO[t].rotulo}
                <span className="tabular ml-1.5 text-graf-400">{n(v)}</span>
              </button>
            )
          })}
        </div>
      )}

      {carregando ? (
        <CarregandoBloco className="py-12" />
      ) : !dados ? null : lista.length === 0 ? (
        <Vazio titulo={fSituacao === 'ABERTAS' ? 'Nenhuma divergência aberta' : 'Nenhuma divergência tratada'}
          descricao={fSituacao === 'ABERTAS' && dados.contratos.nao_conferidos
            ? `${n(dados.contratos.nao_conferidos)} contratos encerrados ainda não lidos do TOA.`
            : undefined} />
      ) : (
        <section className="card-controle overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-graf-700 bg-graf-900 text-left text-[10px]
                              uppercase tracking-wide text-graf-400">
              <tr>
                <th className="w-48 px-3 py-2 font-medium">Divergência</th>
                <th className="px-3 py-2 font-medium">Contrato</th>
                <th className="px-3 py-2 font-medium">Serial</th>
                <th className="px-3 py-2 font-medium">Técnico do contrato</th>
                <th className="px-3 py-2 font-medium">Onde estava</th>
                <th className="px-3 py-2 text-right font-medium">Dias</th>
                <th className="px-3 py-2 font-medium"><span className="sr-only">Ação</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map(i => (
                <tr key={chave(i)} className="border-b border-graf-800 align-top hover:bg-graf-900/60">
                  <td className="px-3 py-1.5">
                    <span title={TIPO[i.tipo].dica}
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${TIPO[i.tipo].classe}`}>
                      {TIPO[i.tipo].rotulo}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                    <LinkContrato to={`/controle/visita/${i.visita_id}`}
                      className="tabular text-af-400 underline-offset-2 hover:underline">
                      {i.contrato ?? 'sem número'}
                    </LinkContrato>
                    <span className="ml-1.5 text-graf-400">{diaMes(i.dia)}</span>
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    <span className="tabular font-mono text-graf-100">{i.serial}</span>
                    <span className="block text-[11px] text-graf-400">
                      {[i.secao === 'INSTALADO' ? 'instalado' : 'retirado', i.equipamento, i.modelo]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">
                    {i.tecnico ?? <span className="text-graf-400">sem técnico</span>}
                    {i.equipe && <span className="ml-1 text-graf-400">· {i.equipe}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-graf-300">{ondeEstava(i)}</td>
                  <td className="tabular px-3 py-1.5 text-right text-xs text-graf-300">
                    {i.dias === 0 ? 'hoje' : `${i.dias} d`}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {i.tratada ? (
                      <span className="text-graf-400"
                        title={`${i.tratada.por ?? '—'} · ${new Date(i.tratada.em).toLocaleString('pt-BR')}`}>
                        {i.tratada.motivo}
                      </span>
                    ) : podeTratar && (
                      tratando === chave(i) ? (
                        <div className="flex min-w-72 items-center gap-1.5">
                          <input value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus
                            maxLength={300} aria-label="Motivo" placeholder="Motivo (obrigatório)"
                            onKeyDown={e => {
                              if (e.key === 'Enter' && motivo.trim().length >= 3 && !ocupado) tratar(i)
                              if (e.key === 'Escape') { setTratando(null); setMotivo('') }
                            }}
                            className={`${campo} flex-1`} />
                          <button onClick={() => tratar(i)} disabled={ocupado || motivo.trim().length < 3}
                            className="rounded-md bg-af-600 px-2.5 py-1.5 text-xs font-semibold text-white
                                       hover:bg-af-500 disabled:opacity-50">
                            {ocupado ? '…' : 'Salvar'}
                          </button>
                          <button onClick={() => { setTratando(null); setMotivo('') }}
                            className="rounded-md border border-graf-700 px-2 py-1.5 text-xs text-graf-300">
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setTratando(chave(i)); setMotivo('') }}
                          className="rounded-md border border-graf-700 px-2.5 py-1 text-xs text-graf-300
                                     hover:border-af-600 hover:text-af-300">
                          Tratar
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
