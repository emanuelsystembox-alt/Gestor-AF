/**
 * Ícones do menu — SVG escrito à mão, sem biblioteca.
 *
 * Mesma decisão dos gráficos (D-010): controle de tema, bundle pequeno,
 * nada para manter. São 11 ícones; uma dependência de ícones traria
 * milhares e o peso de todos eles.
 *
 * Todos desenhados na mesma grade de 24, com traço de 1.6 e
 * `currentColor` — assim herdam a cor do item (ativo, hover, apagado)
 * sem uma linha de CSS extra, e funcionam nos dois temas.
 */

const P = {
  // Dashboard: os quadrantes do painel
  dashboard: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
               <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
               <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
               <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  // Serviços: a prancheta da ordem de serviço
  servicos: <><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
              <path d="M8 6H6.5A1.5 1.5 0 0 0 5 7.5v12A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 6H16" />
              <path d="M9 11h6M9 15h4" /></>,
  // Equipes: duas pessoas — a AFLINE trabalha em dupla
  equipes: <><circle cx="9" cy="8" r="3" />
             <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
             <path d="M16 5.5a3 3 0 0 1 0 5.8" />
             <path d="M17 14.2a5.5 5.5 0 0 1 3.5 5.1" /></>,
  // Produtividade: barras subindo
  produtividade: <><path d="M4 20h16" />
                   <rect x="5.5" y="12" width="3.5" height="6" rx="1" />
                   <rect x="10.5" y="8" width="3.5" height="10" rx="1" />
                   <rect x="15.5" y="4" width="3.5" height="14" rx="1" /></>,
  // Relatórios: folha com a dobra
  relatorios: <><path d="M13 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.5Z" />
                <path d="M13 3v5.5h5.5" />
                <path d="M9 13h6M9 16.5h4" /></>,
  // Importar: a planilha entrando
  importar: <><path d="M12 3v10" /><path d="m8.5 9.5 3.5 3.5 3.5-3.5" />
              <path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" /></>,
  // Sub-falhas: a árvore de causas
  subfalhas: <><circle cx="6" cy="6" r="2.2" />
               <path d="M6 8.2V16a2 2 0 0 0 2 2h2.5" />
               <path d="M6 11.5h4a2 2 0 0 1 2 2v.5" />
               <circle cx="14" cy="18" r="2.2" /><circle cx="14" cy="14" r="2.2" /></>,
  // Configurações: a engrenagem
  configuracoes: <><circle cx="12" cy="12" r="3" />
                   <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18" /></>,
  // Administração: o escudo de quem entra
  administracao: <><path d="M12 3.2 5 6v6c0 4.2 2.9 7.6 7 8.8 4.1-1.2 7-4.6 7-8.8V6Z" />
                    <path d="m9.2 12 2 2 3.6-3.8" /></>,
  // Estoque: a caixa
  estoque: <><path d="M3.8 7.6 12 4l8.2 3.6v8.8L12 20l-8.2-3.6Z" />
             <path d="M3.8 7.6 12 11.2l8.2-3.6M12 11.2V20" /></>,
  // Frota: o caminhão
  frota: <><path d="M3 7.5h10v8H3z" /><path d="M13 10.5h4l3 3v2h-7z" />
           <circle cx="7" cy="17.5" r="1.8" /><circle cx="16.5" cy="17.5" r="1.8" /></>,
  // Rota: os pontos ligados do dia
  rota: <><circle cx="6" cy="6.5" r="2.2" /><circle cx="18" cy="17.5" r="2.2" />
          <path d="M8.2 6.5h4.3a3.3 3.3 0 0 1 0 6.5h-1a3.3 3.3 0 0 0 0 4.5h4.3" /></>,
} as const

export type NomeIcone = keyof typeof P

export function Icone({ nome, tamanho = 17 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {P[nome]}
    </svg>
  )
}
