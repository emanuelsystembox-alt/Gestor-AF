import { useAuth } from '../lib/auth'
import { Shell } from '../components/Shell'
import { Vazio } from '../components/ui'
import { Sinalizacoes } from '../components/Sinalizacoes'

/**
 * Ocorrências do campo (146, D-226) — o que o técnico diz que está errado:
 * ferramental perdido, velho ou com defeito, e problema no carro.
 *
 * > "o que está faltando para o técnico, coordenadores e supervisores.
 * > COPs e cargos mais abaixo não precisa visualizar" — Emanuel, 26/10
 *
 * É o canal da 091 ampliado, não um segundo: o almoxarifado continua
 * respondendo o ferramental na tela dele. Quem tem `campo.ocorrencias`
 * vê e responde tudo das cidades que enxerga — o banco decide.
 */
export default function Ocorrencias() {
  const pode = useAuth().pode('campo.ocorrencias')
  return (
    <Shell>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">Ocorrências do campo</h1>
          <p className="mt-0.5 text-sm text-graf-400">
            Ferramental e carro, avisados pelo técnico na tela “Meu material” do aplicativo.
          </p>
        </div>
        {pode
          ? <Sinalizacoes podeMexer assunto="TODOS" />
          : <Vazio titulo="Sem acesso"
              descricao='O seu perfil de acesso não inclui "Ver e responder ocorrências do campo".' />}
      </div>
    </Shell>
  )
}
