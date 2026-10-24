import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { carimbo } from '../lib/formato'
import { cor, raio } from './tema'

/**
 * O equipamento e a miscelânea que o TOA mostra para o contrato, lidos pela
 * varredura (117, D-192), ao lado do que o técnico lançou (125).
 *
 * > "queria que mostrasse esses lançamentos para o técnico também (...) como
 * >  algumas coisas ele puxou do TOA, já tem essa informação no site, então
 * >  não seria obrigatório o técnico lançar" — Emanuel, 24/10
 *
 * ┌─ o que esta caixa é, e o que ela NÃO é ───────────────────────────┐
 * │ É LEITURA: o retrato da última varredura. Não mexe em saldo, posse│
 * │ nem no lançamento do técnico (D-192). A comparação vem pronta do  │
 * │ banco (`material_do_toa`): serial para equipamento, código SAP    │
 * │ para miscelânea.                                                  │
 * │                                                                   │
 * │ Nada lido ainda não é "sem material" (regra 6): a caixa diz que o │
 * │ TOA ainda não foi lido. Item que o banco não sabe comparar (sem   │
 * │ serial, código fora do catálogo) não ganha selo nenhum.           │
 * └───────────────────────────────────────────────────────────────────┘
 */

interface ItemToa {
  secao: 'INSTALADO' | 'DESINSTALADO' | 'CLIENTE'
  tipo: string | null; modelo: string | null; serial: string | null
  serial_substituido: string | null; quantidade: number | null
  miscelanea: boolean; item: string | null
  /** equipamento: 1 = lançado, 0 = não; miscelânea: a quantidade lançada.
   *  Nulo = não dá para comparar. */
  lancado: number | null
}

const TITULO: Record<ItemToa['secao'], string> = {
  INSTALADO: 'Instalado',
  DESINSTALADO: 'Retirado',
  CLIENTE: 'Já estava no cliente',
}

const qtd = (x: number | null) => String(Number(x ?? 0)).replace('.', ',')

export function MaterialToa({ visitaId, varridoEm, recarga }: {
  visitaId: string; varridoEm: string | null; recarga?: unknown
}) {
  const [itens, setItens] = useState<ItemToa[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [verCliente, setVerCliente] = useState(false)

  useEffect(() => {
    if (!varridoEm) return
    let vivo = true
    supabase.rpc('material_do_toa', { p_visita: visitaId }).then(({ data, error }) => {
      if (!vivo) return
      if (error) setErro(error.message)
      else setItens((data ?? []) as ItemToa[])
    })
    return () => { vivo = false }
  }, [visitaId, varridoEm, recarga])

  return (
    <View style={e.caixa}>
      <View style={e.topo}>
        <Text style={e.titulo}>No TOA</Text>
        {!!varridoEm && <Text style={e.lido}>lido {carimbo(varridoEm)}</Text>}
      </View>

      {!varridoEm ? (
        <Text style={e.miudo}>
          Ainda não lido do TOA. Aparece aqui depois que o TOA encerra o contrato
          e o sistema faz a leitura.
        </Text>
      ) : erro ? (
        <Text style={e.miudo}>Não consegui ler: {erro}</Text>
      ) : itens === null ? (
        <Text style={e.miudo}>Carregando…</Text>
      ) : (<>
        <Text style={e.miudo}>
          O que aparece aqui já está registrado no TOA — não precisa lançar de novo.
        </Text>
        {(['INSTALADO', 'DESINSTALADO', 'CLIENTE'] as const).map(s => {
          const da = itens.filter(i => i.secao === s)
          if (s === 'CLIENTE') {
            if (da.length === 0) return null
            return (
              <View key={s}>
                <Pressable onPress={() => setVerCliente(x => !x)} hitSlop={8}
                  accessibilityRole="button" style={e.secaoLinha}>
                  <Text style={e.secao}>{TITULO[s]} · {da.length}</Text>
                  <Text style={e.abrir}>{verCliente ? 'esconder' : 'ver'}</Text>
                </Pressable>
                {verCliente && da.map((i, k) => <Linha key={k} i={i} semSelo />)}
              </View>
            )
          }
          return (
            <View key={s}>
              <Text style={e.secao}>{TITULO[s]} · {da.length}</Text>
              {da.length === 0
                ? <Text style={e.miudo}>Nada nesta lista no TOA.</Text>
                : da.map((i, k) => <Linha key={k} i={i} />)}
            </View>
          )
        })}
      </>)}
    </View>
  )
}

function Linha({ i, semSelo }: { i: ItemToa; semSelo?: boolean }) {
  const nome = i.miscelanea
    ? (i.item ?? i.modelo ?? i.tipo ?? '—')
    : (i.modelo ?? i.tipo ?? '—')
  return (
    <View style={e.linha}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={e.nome} numberOfLines={2}>{nome}</Text>
        <Text style={e.detalhe} numberOfLines={2}>
          {[
            i.miscelanea ? 'miscelânea' : (i.modelo && i.tipo ? i.tipo : null),
            i.serial,
            i.serial_substituido ? `no lugar de ${i.serial_substituido}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={e.direita}>
        {i.miscelanea && <Text style={e.qtd}>{qtd(i.quantidade)}</Text>}
        {!semSelo && <Selo i={i} />}
      </View>
    </View>
  )
}

/** Você lançou / do TOA / diferente — só quando o banco sabe comparar. */
function Selo({ i }: { i: ItemToa }) {
  if (i.lancado == null) return null
  const lancado = Number(i.lancado)
  let texto: string, fundo: string, tinta: string
  if (lancado === 0) {
    texto = 'do TOA'; fundo = cor.graf50; tinta = cor.graf600
  } else if (!i.miscelanea || lancado === Number(i.quantidade)) {
    texto = 'você lançou'; fundo = cor.verde50; tinta = cor.verde900
  } else {
    texto = `você lançou ${qtd(lancado)}`; fundo = cor.ambar50; tinta = cor.ambar900
  }
  return (
    <View style={[e.selo, { backgroundColor: fundo }]}>
      <Text style={[e.seloTexto, { color: tinta }]}>{texto}</Text>
    </View>
  )
}

const e = StyleSheet.create({
  caixa: {
    backgroundColor: cor.branco, borderWidth: 1, borderColor: cor.graf200,
    borderRadius: raio.g, padding: 14, gap: 8,
  },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  titulo: { fontSize: 15, fontWeight: '800', color: cor.tinta },
  lido: { fontSize: 12, color: cor.graf500 },
  miudo: { fontSize: 13, color: cor.graf500, lineHeight: 18 },
  secaoLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secao: {
    fontSize: 12, fontWeight: '800', color: cor.graf600, marginTop: 4,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  abrir: { fontSize: 13, fontWeight: '700', color: cor.af700 },
  linha: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: cor.graf100,
  },
  nome: { fontSize: 14, fontWeight: '700', color: cor.tinta },
  detalhe: { fontSize: 12, color: cor.graf500, marginTop: 1 },
  direita: { alignItems: 'flex-end', gap: 4 },
  qtd: { fontSize: 15, fontWeight: '800', color: cor.tinta, fontVariant: ['tabular-nums'] },
  selo: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  seloTexto: { fontSize: 11, fontWeight: '800' },
})
