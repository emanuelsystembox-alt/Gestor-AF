# Projeto AFLINE — Sistema de Gestão de Field Service

> Documento vivo. Atualizado conforme o mapeamento avança.
> Última atualização: 2026-09-04

## 1. Contexto

A AFLINE é prestadora de serviços da **CLARO Brasil** (base Manaus). Hoje opera sobre
o **Alfa Gestor / ngestor** (`aflinemao.fs.ngestor.net.br`), sistema de terceiro,
white-label, com custo de licença crescente e roadmap fora do nosso controle.

**Objetivo:** construir um sistema próprio, equivalente em cobertura funcional e
superior em usabilidade, design e profundidade de dados.

## 2. Princípios do projeto

1. **Reconstruir, não copiar.** Replicamos *fluxo de trabalho e regra de negócio*
   (o que não é protegido). Não copiamos código-fonte nem identidade visual do
   fornecedor atual. O design é novo, com a marca AFLINE.
2. **Web-first, 100% responsivo.** Elimina a dependência do app Android. Técnico em
   campo usa o navegador do celular. PWA instalável, com operação offline no que for
   crítico (execução de OS em área sem sinal).
3. **Dado bruto preservado.** Toda importação de planilha guarda o arquivo original e
   a linha crua. Nada se perde na transformação.
4. **Permissão por padrão negada.** Todo acesso é explicitamente concedido.

## 3. Papéis identificados (a confirmar no mapeamento)

| Papel | Onde atua | Escopo típico |
|---|---|---|
| **Admin** | Web | Tudo, incluindo cadastros mestres e custos |
| **COP** (Centro de Operações) | Web | Visão global operacional em tempo real |
| **Controlador** | Web | Carteira de técnicos/equipes sob sua responsabilidade |
| **Supervisor / Coordenador** | Web | Regional ou conjunto de equipes |
| **Técnico** | Web mobile (hoje app Android) | Somente as próprias OS e seu estoque |
| **Almoxarife** | Web | Estoque, ferramental, equipamentos, miscelânea |
| **Gestor de Frota** | Web | Veículos, abastecimento, manutenção |

## 4. Módulos

1. **Ordens de Serviço** — importação de planilha, roteirização, despacho, execução,
   encerramento, reincidência.
2. **Técnicos e Equipes** — cadastro, vínculo, escala, produtividade.
3. **Almoxarifado** — equipamentos serializados, metragem de cabo, miscelânea.
4. **Ferramental** — patrimônio, comodato, termo de responsabilidade, devolução.
5. **Frota** — veículos, abastecimento, manutenção, checklist diário, documentação.
6. **Controle / COP** — painel tempo real, tratativas, SLA, acompanhamento.
7. **Relatórios** — rota, produtividade, consumo, custo.
8. **Administração** — usuários, papéis, permissões, auditoria.

## 5. Stack decidida

| Camada | Escolha | Por quê |
|---|---|---|
| Banco + Auth + Storage | **Supabase** (Postgres) | RLS nativo resolve o nível de permissão no banco, não só na tela |
| Front-end | **React + TypeScript + Tailwind + shadcn/ui** | Padrão do Lovable; acelera muito |
| Construção | **Lovable** (crédito ilimitado disponível) | Velocidade de UI |
| Versionamento | **GitHub** | Lovable sincroniza; garante que o código é nosso |
| Hospedagem | Lovable ou Vercel | Decidir depois |

> **Nota sobre RLS:** o diferencial de segurança está aqui. As regras de "quem vê o
> quê" ficam no Postgres via Row Level Security. Mesmo que alguém burle a interface,
> o banco não devolve o dado. Isso costuma ser o ponto fraco de sistemas do tipo.

## 6. Fases

- **Fase 0 — Mapeamento** *(em andamento)*: percorrer o sistema atual como usuário,
  documentar telas, campos, status, regras e permissões.
- **Fase 1 — Modelagem**: schema Postgres, políticas RLS, design system.
- **Fase 2 — Núcleo**: auth, cadastros, importação de planilha, CRUD de OS.
- **Fase 3 — Campo**: interface do técnico, execução de OS, offline.
- **Fase 4 — Periféricos**: almoxarifado, ferramental, frota.
- **Fase 5 — Inteligência**: painéis COP, relatórios, indicadores.

## 7. Insumos que o Emanuel vai fornecer

- [ ] Acesso ao sistema atual (login feito por ele)
- [ ] Relatório de rota (exemplo real)
- [ ] Planilha de importação de OS (exemplo real) — **crítico**
- [ ] Descrição do acompanhamento do Controlador e do COP
- [ ] Matriz de níveis de permissão
- [ ] Fluxo de abastecimento
- [ ] Logo AFLINE em alta resolução
