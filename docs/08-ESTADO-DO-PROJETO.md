# Estado do projeto — 07/09/2026

> Se você está assumindo o projeto agora, comece pelo **`HANDOFF.md`** na
> raiz. Este documento é o inventário; aquele é o mapa.

Consolidação de tudo que existe. Levantado **consultando o banco e o
repositório**, não de memória.

---

## O que é este projeto

Camada operacional própria da **AFLINE**, prestadora da **CLARO**, para
substituir o **Alfa Gestor (ngestor)**. Recebe as ordens de serviço do
**TOA (Oracle Field Service)** da CLARO, despacha para as equipes, recebe
a execução do campo, mede e pontua.

Nasce **multi-empresa**: o Emanuel pretende vendê-lo a outras credenciadas.

---

## Infraestrutura

| | |
|---|---|
| Banco | Supabase `AFLINE manager` · `kqfflkxjijzdtnfshdlv` · sa-east-1 |
| Repositório | `github.com/emanuelsystembox-alt/Gestor-AF` |
| Front-end | Vite + React 18 + TypeScript + Tailwind v4 |
| Edge Function | `admin-usuarios` — criação de login com `service_role` |
| Local | `C:\Users\Emanu\OneDrive\Documentos\PROJETO - NGESTOR AFLINE` |

**Fora do escopo:** o Supabase `BANCO PRO - AFLINE 360` é outro projeto
(camada analítica, 350+ migrations). Não tocamos nele desde 04/09.

---

## Banco — números reais

**41 tabelas · 2 views · 85 funções · 82 policies · zero tabela sem RLS ·
zero função `SECURITY DEFINER` alcançável pelo `anon`**

E, desde 07/09, uma **bateria de teste de policy com 16 cenários**:

```sql
select * from testar_policies();   -- esperado: passou = true em tudo
```

### Estrutura

```
empresa ─── base (praça) ─── equipe ─── tecnico
                              │  └── equipe_login_toa (histórico)
                              │  └── equipe_tipo_servico
                              └── visita ─── ordem_servico
                                    ├── evidencia
                                    ├── equipamento_movimento
                                    ├── reincidencia
                                    ├── visita_marcador
                                    └── visita_evento (auditoria)
```

**Acesso:** `perfil` · `usuario_papel` · `usuario_base` · `carteira` ·
`cargo` · `perfil_acesso` · `permissao` · `perfil_acesso_permissao`

**Entrada:** `importacao` · `importacao_linha`

**Domínios:** `tipo_atividade` · `tipo_servico` · `tipo_os` ·
`codigo_baixa` · `sub_falha` · `situacao_visita` · `segmentacao` ·
`categoria_capacidade` · `area_trabalho` · `indicador_qualidade`

**Dinheiro:** `tabela_preco` · `combinacao_os` · `regra_pontuacao` ·
`regra_pontuacao_log`

### Dados carregados

| | |
|---|---|
| Empresas | 1 (AFLINE) · Praças **18** |
| Equipes | **89** · Técnicos **104** · Supervisores 5 |
| Visitas | **504** em 3 dias (04/09: 344 · 05/09: 129 · 06/09: 31) |
| Ordens de serviço | **610** |
| Produtivas × jornada | 349 produtivas · 152 de jornada · 3 sem tipo |
| Códigos de baixa | **168** classificados |
| Sub-falhas | **1.466** — CASO 1 (528) e NÍVEL HARD (938) |
| Conjunto vigente | **NÍVEL HARD** |
| Indicadores de qualidade | **7** |
| Combinações de O.S. | **546** · Regras de pontuação **1.021** |
| Cobertura da pontuação | **95,4%** das produtivas · 386,06 pontos |
| Cargos / perfis de acesso / permissões | 10 / 6 / 26 |
| Usuários com login | **1** (o admin) |
| Eventos de auditoria | 508 |

---

## Migrations aplicadas

| # | O que faz |
|---|---|
| 001 | Domínios: áreas, tipos de atividade (com natureza), tipos de serviço, tipos de O.S. |
| 002 | 166 códigos de baixa da CLARO + classificação própria |
| 003 | Base, perfil, papéis, equipe, técnico, carteira, funções de permissão |
| 004 | Importação, **visita → ordem_servico**, evidência, equipamento, reincidência, auditoria |
| 005 | RLS em todas as tabelas + view do técnico |
| 006-007 | Importador do TOA (helpers + função) |
| 008-009 | Correção da trava D-006 e reconstrução do importador |
| 010-011 | Endurecimento: `SECURITY DEFINER`, revogação nominal do `anon`, `search_path` |
| 012 | Pseudo-códigos `-1` e `-2` do NETSMS |
| 013 | Tempo de atribuição real do TOA |
| 014 | **Grupo de serviço** derivado do cruzamento TOA × ngestor |
| 015 | Cadastro de equipes e importador |
| 016-018 | **Multi-tenant**: empresa, 18 praças, RLS por tenant, carimbo automático |
| 019 | **Isolamento por praça** |
| 020 | Técnicos fora do cadastro + `vw_equipe_resumo` |
| 021 | **Login TOA da equipe, com histórico por período** |
| 022 | Sub-falha, histórico completo e transferência de equipe |
| 023 | Escolha do conjunto de sub-falha vigente + resumo por conjunto |
| 024 | **Painel de equipes por dia** com períodos, situações e OCIOSO |
| 025 | **Cadastro de situação**, indicadores de qualidade e `visita_marcador` |
| 026 | **Reatendimento**, **dupla baixa** TOA×AFLINE com sub-falha, exclusão arquivada |
| 027 | **Pontuação por combinação de O.S. × edificação** |
| 028 | **Administração**: cargo, perfil de acesso, permissões, fecho da escalada |
| 029 | **`testar_policies()`** (16 cenários) + permissão fina nas RPCs |
| 030 | **Histórico com autor** e **cadastro manual** de contrato/O.S.; `reverter_situacao` |
| 031 | SUPERVISOR passa a enxergar as equipes que supervisiona |
| 032 | `registrar_etapa` do técnico; escopo de equipe em `baixar_os`; histórico legível por quem enxerga a visita |
| 033 | **Reincidência derivada do dado**, recalculada a cada importação |
| 034 | O login do TOA manda na equipe; login único por base |
| 035 | Situação terminal exige todas as O.S. baixadas |
| 036 | Equipe abrigo — **revertida pela 039** |
| 037 | Meta, comissão e `produtividade_periodo` |
| 038 | **A receber = pontuação × fator**; faixa por piso |
| 039 | Desfaz o cadastro deduzido e o abrigo |
| 040 | Vínculo supervisor ↔ equipes; origem do login na tela |
| 041 | Login TOA no cadastro de acesso |
| 042 | **Só o cadastro roteia**; equipe "Sem login definido" |
| 043 | **Cadastro sem autor não roteia**; técnico se desliga, não se apaga |
| 044 | O nome do técnico vem do TOA (coluna `Recurso`), não do palpite |
| 045 | Skill do técnico: ADESÃO, MANUTENÇÃO, DESCONEXÃO — e a comissão por skill |

---

## Telas prontas

| Rota | O que faz |
|---|---|
| `/entrar` | Login com identidade AFLINE |
| `/controle` | Painel: cartões de situação, **volume × pontos** por tipo de serviço, improdutivas por responsabilidade, encerramentos por hora, tempo por etapa, CSV |
| `/controle/servicos` | Lista com 9 filtros, duas densidades, faixa de cor por situação, menu no botão direito, **contrato em janela** e **+ Nova O.S.** (cadastro manual) |
| `/controle/equipes` | Painel por dia: contratos, períodos, situações, OCIOSO, contratos de cada equipe, **bolinha do técnico**; abre só com quem tem contrato |
| `/controle/produtividade` | **Produtividade e comissão** em três dimensões (técnico · equipe · supervisor): pontos, dias, média/dia, previsão, meta, fator e **a receber**; edita a tabela de comissão com a permissão `comissao.editar` |
| `/controle/relatorios` | Relatório **por contrato** (72 colunas) e **por O.S.** (87), com **pontuação** e **serviço anterior**, filtros, Excel e CSV; marca a primeira O.S. do endereço |
| `/controle/importar` | Importação do TOA com prévia e **histórico com log** |
| `/controle/sub-falhas` | Importa os conjuntos da CLARO (arquivo largo) e escolhe o vigente |
| `/controle/configuracoes` | Status, indicadores de qualidade e **tabela de pontuação** (1.021 regras) |
| `/controle/administracao` | Usuários, cargos, perfis de acesso e matriz de permissões |
| `/controle/visita/:id` | Detalhe completo do contrato, com histórico e transferência |
| `/campo` e `/campo/visita/:id` | Agenda e execução do técnico (tema claro, alvo de toque 48px): a caminho → cheguei → baixa com sub-falha → impedimento com observação → finalizar, e o **passo a passo com o login** de quem fez cada etapa |

---

## As 95 decisões

Todas em `docs/03-DECISOES.md`, com o porquê de cada uma. Resumo por tema:

**Modelagem** — D-001 visita 1→N O.S. · D-013 cabeçalho repetido lido por
posição · D-019 multi-empresa · D-024/025 login TOA é da equipe e muda de
dono · D-027 sub-falha é o segundo nível da causa · D-032 o arquivo da
CLARO é largo, não longo · **D-041 o mesmo contrato é atendido mais de
uma vez** · **D-042 são dois códigos de baixa, e eles divergem** · D-036 a
situação virou cadastro sem virar chave estrangeira

**Dinheiro** — D-018 recálculo retroativo · **D-045 a pontuação é
combinação de O.S. × edificação** · D-038 relatório por contrato e por
O.S. são leituras diferentes · D-057 volume e pontos também

**Segurança** — D-015 `SECURITY DEFINER` checa papel por dentro · D-016
`revoke from public` não remove concessão nominal · **D-050 autoedição
não pode mudar o que dá poder** · D-051 criar login passa por Edge
Function · **D-054 teste de policy vem antes de mexer em policy** ·
**D-055 papel é a barreira, permissão é a granularidade**

**Produto** — D-011 duas linguagens visuais · D-029 carga sob demanda por
causa do técnico no 4G · D-043 excluir é arquivar · D-056 o contrato abre
em janela

---

## Defeitos do sistema atual que já corrigimos

1. **Código de baixa duplicado por caixa.** `409 - Servico Concluido` e
   `409 - SERVICO CONCLUIDO` eram contados separado.
2. **Supervisor como texto livre.** Três grafias da mesma pessoa.
3. **Visita achatada em O.S.** Contava deslocamento em dobro.
4. **Jornada dentro da produtividade.** 152 de 504 são `Na Base` e
   `Refeição`.
5. **Improdutiva sem responsável.** O ngestor diz o motivo, não de quem
   é a culpa.
6. **Erro de importação invisível.** 8 O.S. eram recusadas em silêncio;
   o log revelou e o D-041 corrigiu a causa.

---

## O que descobrimos sobre o negócio

- **Uma visita carrega até 10 O.S.** O caso mais comum são 2.
- **O mesmo contrato é atendido mais de uma vez** — 2.656 casos em 17.987
  linhas do relatório mensal. Quebrou de manhã, o cliente reagendou, foi
  de novo à tarde: dois atendimentos, dois deslocamentos, duas baixas, e
  o TOA emite WO nova.
- **A pontuação é combinação de O.S. × edificação.** Tipo de pessoa quase
  não influencia: das 43 combinações presentes em física e jurídica, só 5
  mudam de valor; das 105 presentes em casa e apartamento, 43 mudam.
- **São dois códigos de baixa**, e eles divergem em 13.021 das 17.987
  linhas. A da AFLINE é a que manda no comissionamento.
- **A LPU distingue DESLOCAMENTO de AGREGADA.** A primeira O.S. do
  endereço paga cheio; as demais, reduzido.
- **Retorno de Credenciada é desconto**, e teve a pior taxa de conclusão
  do dia 04/09: 51,6%.

---

## O que falta, e por quê

| O quê | Por que está parado |
|---|---|
| ~~**`pontos_equipe`**~~ | **RESOLVIDO em 07/09:** `a receber = pontuação × fator`, com o fator saindo da faixa do mês (D-077). Meta e faixas viraram cadastro editável. |
| ~~**O critério 3 conta como cadastro?**~~ | **RESOLVIDO em 07/09: NÃO vale** (D-088, revoga D-082). Só o login cadastrado roteia; o resto vai para a equipe "Sem login definido" e a tela de Equipes lista os 46 logins esperando declaração. |
| **Faixa de comissão: piso ou intervalo fechado?** | Está por piso, porque a tabela em inteiros deixava buraco (199,50 pts → R$ 0,00). Difere da tabela literal do sistema atual — D-077. |
| **Declarar os 46 logins sem dono** | 337 visitas estão em "Sem login definido" até alguém dizer de quem é cada login. A tela de Equipes faz isso num clique por login, com a equipe sugerida já preenchida — D-088. |
| **Criar os logins dos supervisores e dos técnicos** | Criar conta é ação do Emanuel (Administração → Usuários). O campo **Login TOA** no formulário já liga o acesso ao técnico — D-087. A aba *Supervisores* foi retirada a pedido; as RPCs seguem no banco. |
| **Formato do número de O.S. manual** | Geramos `AF-00000001` para não colidir com os 10 dígitos da CLARO. Formato escolhido por nós, não observado no dado — **confirmar com o Emanuel**. |
| **"Data de Abertura"** | A tela do sistema atual tem o campo; a planilha do TOA não traz nada equivalente. Não criamos a coluna: daria 100% de vazio no que é importado. Se a CLARO expuser a data em algum lugar, vira coluna de verdade. |
| **ITEM / CONSOLID / VALOR na O.S.** | O detalhe do sistema atual tem essas três colunas, e elas são a **LPU** — o tipo de O.S. consolidado que é faturado. Continua **não modelado** (ver Vocabulário no `CLAUDE.md`); não inventamos rateio de pontos por O.S. |
| **Abas de equipamento no modal de baixa** | Dependem do módulo de almoxarifado, que não existe. Sem cadastro de serial e movimento, seriam campo de texto fingindo ser controle de estoque. |
| **Miscelânea** | Não sabemos o que é. No export do ngestor é 100% "Não" em 454 registros — parece funcionalidade morta. |
| **Marcador exigido por tipo de serviço** | Não foi combinado quais indicadores são obrigatórios em cada grupo. |
| **`equipe.skill`** | O sistema atual mostra "SINGLE MASTER"; não modelamos porque não sabemos o domínio. |
| **7 migrations sem arquivo local** | Dívida conhecida; `supabase/README.md` explica como sincronizar. |
| Estoque, frota, produtividade, aferição | Fase 2 |
