import { useEffect, useState } from 'react'
import { Alert, AppState } from 'react-native'
import { pedirPermissao } from './gps'
import {
  estadoRastro, iniciarSegundoPlano, jaPerguntouSegundoPlano, marcarPerguntouSegundoPlano,
  ouvirRastro, pararSegundoPlano, passoComAppAberto, segundoPlanoLigado,
  type EstadoRastro,
} from './rastro'

/** De quanto em quanto a tela olha o GPS. A regra dos 2 a 5 min está em
 *  `anotar` — o relógio só precisa ser mais fino que ela. */
const RELOGIO_MS = 60 * 1000

/**
 * Liga o rastro enquanto houver um TÉCNICO logado (ver `lib/rastro.ts`).
 *
 * Login que não é de técnico (controlador abrindo o app para conferir)
 * não rastreia: o servidor recusaria, e ninguém pediu para rastrear
 * controlador.
 */
export function useRastro(ligado: boolean) {
  useEffect(() => {
    if (!ligado) return
    let vivo = true
    let rotaAnterior: boolean | null = null

    /** O servidor disse se a rota do dia está aberta: liga ou desliga o
     *  segundo plano de acordo. Com o app aberto o relógio continua. */
    async function seguirARota(aberta: boolean | null) {
      if (!vivo || aberta === null || aberta === rotaAnterior) return
      rotaAnterior = aberta
      if (!aberta) {
        if (await segundoPlanoLigado()) await pararSegundoPlano('ENCERROU')
        return
      }
      if (await jaPerguntouSegundoPlano()) {
        await iniciarSegundoPlano(false)
        return
      }
      // Primeira vez neste aparelho: explica ANTES de o Android mandar
      // para os ajustes. Negar continua possível — aí grava com o app aberto.
      Alert.alert(
        'Registro da rota do dia',
        'Enquanto você tiver contrato aberto hoje, o aplicativo registra a sua ' +
        'localização a cada 2 a 5 minutos, inclusive com ele fechado. Quando o ' +
        'último contrato do dia fecha, o registro para sozinho.\n\n' +
        'Na próxima tela, escolha "Permitir o tempo todo".',
        [{
          text: 'Continuar',
          onPress: async () => {
            await marcarPerguntouSegundoPlano()
            await iniciarSegundoPlano(true)
          },
        }],
        { cancelable: false },
      )
    }

    ;(async () => {
      await pedirPermissao()
      // O marco de abertura: a trilha do dia começa aqui.
      await seguirARota(await passoComAppAberto('ABRIU', true))
    })()

    const relogio = setInterval(async () => {
      if (AppState.currentState !== 'active') return
      await seguirARota(await passoComAppAberto())
    }, RELOGIO_MS)

    const sub = AppState.addEventListener('change', async s => {
      const bg = await segundoPlanoLigado()
      // Com o segundo plano ligado, ir para trás não é buraco na trilha.
      if (bg) return
      if (s === 'background') await passoComAppAberto('SAIU', true)
      if (s === 'active') await seguirARota(await passoComAppAberto('ABRIU', true))
    })

    return () => {
      vivo = false
      clearInterval(relogio)
      sub.remove()
    }
  }, [ligado])
}

/** O estado do rastro para mostrar na tela (Agenda). */
export function useEstadoRastro(): EstadoRastro {
  const [e, setE] = useState(estadoRastro())
  useEffect(() => ouvirRastro(setE), [])
  return e
}
