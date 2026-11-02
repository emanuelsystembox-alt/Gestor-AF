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
        // Não ligou (app fora da frente, por exemplo): esquece a resposta
        // para o próximo passo do relógio tentar de novo (098).
        if (!(await iniciarSegundoPlano(false))) rotaAnterior = null
        return
      }
      // Primeira vez neste aparelho: avisa ANTES de o Android mandar para
      // os ajustes. Negar continua possível — aí grava com o app aberto.
      // D-249: fica só a instrução. "retire a mensagem de a cada 2 minutos
      // o GPS vai colher sua localização" (Emanuel, 31/10) — o texto que
      // explicava o registro de 2 a 5 min saiu; o comportamento é o mesmo.
      Alert.alert(
        'Localização',
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

/** O estado do rastro para mostrar na tela. A Agenda deixou de mostrar a
 *  linha "Rota do dia sendo registrada" (D-249); fica para diagnóstico. */
export function useEstadoRastro(): EstadoRastro {
  const [e, setE] = useState(estadoRastro())
  useEffect(() => ouvirRastro(setE), [])
  return e
}
