import { Shell } from '../components/Shell'
import DashboardVT from '../components/DashboardVT'

/**
 * Dashboard VT em tela própria (217).
 *
 * > "A visão de dashboard da visita técnica precisa ser levada para abaixo
 * >  do Dashboard, deve ter um menu abaixo dizendo Dashboard VT ok?"
 * >  — Emanuel, 06/11
 *
 * Saiu do pé do Dashboard principal e virou item do menu, logo abaixo dele,
 * com a bolinha azul de função nova (Shell). A tela é só a moldura: o
 * seletor de dia, o Atualizar e a conta estão no componente.
 */
export default function DashboardVTPagina() {
  return (
    <Shell>
      <div className="p-4 pt-1">
        <DashboardVT />
      </div>
    </Shell>
  )
}
