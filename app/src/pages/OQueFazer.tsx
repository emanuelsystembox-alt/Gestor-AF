import { Shell } from '../components/Shell'
import { Alerta, Metrica, Vazio, CarregandoBloco } from '../components/ui'
import { ListaFila } from '../components/FilaAgora'
import { BoletimDia } from '../components/BoletimDia'
import { GRUPO_FILA, useFilaAgora, type GrupoFila } from '../lib/filaAgora'
import { dataBR } from '../lib/formato'

/**
 * O que fazer agora (263, D-378) — fase 3 do pacote preditivo.
 *
 * > "o gestor não procura o problema, o problema chega na ordem certa" (proposta de 12/11).
 *
 * Uma fila só, na ordem do Emanuel (13/11): pessoa esperando → TEC1 que dá para salvar →
 * equipe de VT atrasada → rede da CLARO → risco alto de revisita → jornada e sincronismo.
 * O item some sozinho quando a situação resolve, e cada um pode dispensar o seu.
 * É sugestão para a gestão, no site (D-262): nada muda sozinho.
 */
export default function OQueFazer() {
  const { itens, banco, erro, carregando, carregar, dispensar } = useFilaAgora()
  const conta = (g: GrupoFila) => itens.filter(i => i.grupo === g).length
  const t = banco?.tec1

  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">O que fazer agora</h1>
            {banco && (
              <p className="mt-0.5 text-sm text-graf-400">
                {banco.cidade ?? '—'} · hoje, {dataBR(banco.dia)} · {itens.length} item(ns)
              </p>
            )}
          </div>
          <button onClick={carregar} disabled={carregando}
            className="rounded-md border border-graf-700 px-3 py-1.5 text-sm text-graf-200 hover:bg-graf-800 disabled:opacity-60">
            {carregando ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {!banco && !erro && <CarregandoBloco className="py-10" />}

        {/* 265 (D-380): o boletim do dia, em cima da fila */}
        <BoletimDia />

        {banco && (<>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {([1, 2, 3, 4, 5, 6] as GrupoFila[]).map(g => (
              <Metrica key={g} valor={conta(g)} rotulo={GRUPO_FILA[g].rotulo}
                cor={conta(g) > 0 ? GRUPO_FILA[g].cor : undefined} />
            ))}
            <Metrica valor={t?.previsto_pct == null ? '—' : `${t.previsto_pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
              rotulo={`TEC1 previsto · meta ${banco.meta}%`}
              cor={t?.previsto_pct == null ? undefined
                : t.previsto_pct >= banco.meta ? 'var(--st-concluida)' : 'var(--st-conflito)'} />
          </div>

          {itens.length === 0
            ? <div className="card-controle"><Vazio titulo="Nada pedindo ação agora" /></div>
            : <ListaFila itens={itens} dispensar={dispensar} limitePorGrupo={8} />}
        </>)}
      </div>
    </Shell>
  )
}
