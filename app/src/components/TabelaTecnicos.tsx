import { equipeRotulo } from '../lib/formato'

/**
 * A lista de técnicos — e o botão de DESLIGAR.
 *
 * ┌─ por que ela saiu da tela de Equipes ────────────────────────────┐
 * │ > "esse botão técnicos deve sair, ninguém pode ver essa opção de  │
 * │ >  desligamento fácil, isso tem que ser na tela do administrador" │
 * │ >  — Emanuel                                                      │
 * │                                                                   │
 * │ Equipes é a tela do DIA: quem está rodando, com que janela, em    │
 * │ que situação. Quem abre ali está despachando, e "Desligar" é a    │
 * │ um clique de distância, ao lado de dados que se olham o tempo     │
 * │ todo. Desligar técnico não é ato de despacho — é cadastro, e      │
 * │ cadastro mora em Administração.                                   │
 * │                                                                   │
 * │ Isto não é a barreira: `mudar_situacao_tecnico` confere permissão │
 * │ no banco, e o botão já vinha atrás de `equipes.editar`. É colocar │
 * │ o comando onde ele pertence, para não ser clicado sem querer.     │
 * └───────────────────────────────────────────────────────────────────┘
 */

export interface TecnicoLinha {
  id: string; matricula: string; nome: string; situacao: string
  equipe_id: string | null
  foto_url: string | null
  base: { nome: string; regiao: string | null } | null
  /** O supervisor DECLARADO (068) — vale mais que o da planilha. */
  supervisor: { nome: string } | null
  equipe: {
    codigo: string; nome: string; supervisor_nome: string | null
    area: { apelido: string | null } | null
  } | null
}

export function TabelaTecnicos({ tecnicos, podeEditar, ocupado, aoMudarSituacao }: {
  tecnicos: TecnicoLinha[]
  podeEditar: boolean
  ocupado?: boolean
  aoMudarSituacao: (t: TecnicoLinha, para: 'ATIVO' | 'DESLIGADO') => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-graf-700 bg-graf-900 text-left
                          text-[11px] uppercase tracking-wide text-graf-400">
          <tr>
            <th className="px-3 py-2 font-medium">Matrícula</th>
            <th className="px-3 py-2 font-medium">Nome</th>
            <th className="px-3 py-2 font-medium">Operação</th>
            <th className="px-3 py-2 font-medium">Equipe</th>
            <th className="px-3 py-2 font-medium">Área</th>
            <th className="px-3 py-2 font-medium">Supervisor</th>
            <th className="px-3 py-2 font-medium">Situação</th>
            {podeEditar && <th className="px-3 py-2 text-right font-medium">Ação</th>}
          </tr>
        </thead>
        <tbody>
          {tecnicos.length === 0 && (
            <tr><td colSpan={podeEditar ? 8 : 7}
                    className="px-3 py-10 text-center text-sm text-graf-500">
              Nenhum técnico cadastrado.
            </td></tr>
          )}
          {tecnicos.map(t => (
            <tr key={t.id} className="border-b border-graf-800 hover:bg-graf-850">
              <td className="tabular px-3 py-2 font-medium">{t.matricula}</td>
              <td className="px-3 py-2 text-graf-300">{t.nome}</td>
              <td className="px-3 py-2 text-xs">
                {t.base ? (
                  <>
                    <span className="text-graf-300">{t.base.nome}</span>
                    {/* Região nula não é "sem região": é região que ninguém
                        definiu ainda (063). */}
                    <div className="text-[10px] text-graf-500">
                      {t.base.regiao ?? 'região a definir'}
                    </div>
                  </>
                ) : <span className="text-graf-600">—</span>}
              </td>
              <td className="px-3 py-2 text-xs text-graf-400">
                {t.equipe
                  ? equipeRotulo(t.equipe.codigo, t.equipe.nome)
                  : <span className="text-af-400">sem equipe</span>}
              </td>
              <td className="px-3 py-2 text-xs text-graf-400">
                {t.equipe?.area?.apelido ?? '—'}
              </td>
              <td className="px-3 py-2 text-xs">
                {t.supervisor ? (
                  <>
                    <span className="text-graf-300">{t.supervisor.nome}</span>
                    <span title="Alguém declarou este supervisor na tela — vale mais que o da planilha"
                      className="ml-1.5 rounded bg-emerald-900/40 px-1 text-[9px]
                                 font-semibold uppercase text-emerald-300">
                      declarado
                    </span>
                    {t.equipe?.supervisor_nome
                      && t.equipe.supervisor_nome !== t.supervisor.nome && (
                      <div className="text-[10px] text-graf-600"
                        title="É o que a planilha de equipes diz, e foi substituído">
                        planilha: {t.equipe.supervisor_nome}
                      </div>
                    )}
                  </>
                ) : t.equipe?.supervisor_nome ? (
                  <span
                    title="Nome vindo da planilha de equipes — ninguém desta casa foi declarado supervisor dele"
                    className="text-graf-500">
                    {t.equipe.supervisor_nome}
                    <span className="ml-1 text-[9px] uppercase tracking-wide text-graf-600">
                      da planilha
                    </span>
                  </span>
                ) : <span className="text-graf-600">sem supervisor</span>}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className={t.situacao === 'ATIVO' ? 'text-emerald-400' : 'text-graf-500'}>
                  {t.situacao.toLowerCase()}
                </span>
              </td>
              {podeEditar && (
                <td className="px-3 py-2 text-right">
                  {t.situacao === 'ATIVO' ? (
                    <button disabled={ocupado} onClick={() => aoMudarSituacao(t, 'DESLIGADO')}
                      title="Sai da operação; o histórico dele fica"
                      className="rounded-md border border-graf-700 px-2.5 py-1 text-xs
                                 text-graf-300 hover:border-af-600 hover:text-af-300
                                 disabled:opacity-40">
                      Desligar
                    </button>
                  ) : (
                    <button disabled={ocupado} onClick={() => aoMudarSituacao(t, 'ATIVO')}
                      className="rounded-md border border-graf-700 px-2.5 py-1 text-xs
                                 text-graf-300 hover:border-emerald-600
                                 hover:text-emerald-300 disabled:opacity-40">
                      Reativar
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-graf-800 px-3 py-2.5 text-xs text-graf-500">
        Técnico não se apaga, se <strong className="text-graf-300">desliga</strong>:
        apagar levaria junto o histórico de contratos que ele executou. O banco
        recusa a exclusão de quem tem histórico — inclusive para o ADMIN.
      </p>
    </div>
  )
}
