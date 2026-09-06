# Modelo de Domínio — Rascunho v0.1

> **Status: RASCUNHO NÃO VALIDADO.** Montado a partir da descrição do Emanuel,
> antes do mapeamento do sistema atual. Cada bloco tem perguntas em aberto (❓).
> Serve para o Emanuel corrigir rápido — é mais barato refutar do que adivinhar.

---

## A. Organização e Pessoas

### `empresa` (tenant)
Preparar multi-tenant desde o início mesmo usando só AFLINE — muda quase nada agora
e evita reescrita se houver outra base/contrato no futuro.

### `base` / `regional`
Manaus é a base atual. Unidade de escopo de permissão.

### `contratante`
CLARO. Importa porque a planilha, o SLA e a nomenclatura de OS vêm do contratante.
Se um dia entrar outro cliente, o modelo aguenta.

### `usuario`
Auth via Supabase. Um usuário tem **um ou mais papéis**, cada papel com **escopo**.

### `tecnico`
| Campo | Obs |
|---|---|
| matricula | identificador operacional, aparece na planilha |
| nome, cpf, telefone, admissão | |
| equipe_id | |
| veiculo_id | vínculo atual |
| status | ativo / férias / afastado / desligado |
| usuario_id | conta de acesso (nem todo técnico faz login?) ❓ |

### `equipe`
Técnicos agrupados. ❓ Uma equipe tem líder? Uma OS é atribuída à equipe ou ao técnico?
❓ Um técnico pode estar em duas equipes?

### `controlador`
❓ É um papel do usuário ou uma entidade com carteira própria?
❓ Como se define a carteira: por equipe, por técnico, por região, por tipo de serviço?

---

## B. Ordem de Serviço — o núcleo

### `importacao_planilha`
O coração do sistema. Fluxo proposto:

```
upload .xlsx
   ↓
guarda arquivo original no Storage  ← nunca descartar
   ↓
parse → linhas cruas em importacao_linha (JSONB)
   ↓
validação (duplicidade, técnico inexistente, endereço vazio, tipo inválido)
   ↓
PRÉ-VISUALIZAÇÃO: X criar / Y atualizar / Z com erro   ← ponto onde o
   ↓                                                      sistema atual
confirmação humana                                        provavelmente é fraco
   ↓
gera/atualiza ordem_servico
```

❓ **Perguntas críticas — preciso da planilha real:**
- Quais colunas exatamente? Nomes e ordem são fixos?
- A planilha traz a OS já atribuída a um técnico, ou a atribuição é feita no sistema?
- Reimportar o mesmo arquivo atualiza ou duplica? Qual campo é a chave única?
- Vem uma planilha por dia? Por período? Quantas linhas em média?

### `ordem_servico`
| Campo | Obs |
|---|---|
| codigo | número da OS da CLARO |
| tipo_servico | instalação / reparo / mudança de endereço / retirada / … ❓ |
| cliente_nome, contato | cliente final |
| endereco completo + lat/lng | geocodificação para roteirização |
| data_agendada, janela/turno | |
| prioridade, prazo_sla | |
| status | ver máquina de estados |
| tecnico_id, equipe_id | atribuição |
| controlador_id | quem acompanha |
| importacao_id, linha_original | rastreabilidade até o arquivo |

### Máquina de estados proposta
```
   PENDENTE ──► ROTEIRIZADA ──► ATRIBUÍDA ──► EM DESLOCAMENTO ──► EM EXECUÇÃO
                                    │                                  │
                                    │                    ┌─────────────┼─────────────┐
                                    ▼                    ▼             ▼             ▼
                               CANCELADA            CONCLUÍDA    IMPRODUTIVA    REAGENDADA
                                                                      │             │
                                                                      └──► volta p/ PENDENTE
```
❓ Quais os status reais do sistema atual? Nomes exatos importam — a operação já
tem vocabulário próprio e mudar isso gera atrito.
❓ Quais os **motivos de improdutiva**? (cliente ausente, endereço não localizado,
sem viabilidade técnica, recusa…) Essa lista é um cadastro, não um campo livre.

### `os_execucao` — o que o técnico registra em campo
- check-in com GPS e horário
- checklist do serviço (varia por tipo_servico ❓)
- **fotos** (quantas? obrigatórias? quais ângulos?)
- **equipamentos instalados/retirados** → serial
- **metragem de cabo** aplicada → baixa no saldo do técnico
- **miscelânea** consumida
- assinatura do cliente ❓
- observações
- check-out

### `os_evento` (auditoria)
Todo movimento gera evento imutável: quem, quando, de onde, o que mudou.
Isso é o que permite reconstruir qualquer história — e costuma faltar nos concorrentes.

---

## C. Materiais

Três naturezas **diferentes**, com regras diferentes. Tratar como um só é o erro clássico:

| Natureza | Controle | Exemplo |
|---|---|---|
| **Equipamento serializado** | unidade a unidade, por serial | ONT, decoder, cable modem, roteador |
| **Cabo** | metragem (decimal), saldo contínuo | drop óptico, coaxial |
| **Miscelânea** | quantidade inteira, consumo | conector, abraçadeira, parafuso |

### `estoque_movimento`
Toda posição de estoque é **derivada de movimentos**, nunca um campo editável.
Almoxarifado → técnico → OS (ou devolução). Saldo é soma. Isso torna qualquer
divergência auditável.

❓ Como é hoje a carga do técnico? Ele "retira" material e vai baixando?
❓ Tem inventário/acerto periódico?
❓ Equipamento retirado do cliente volta como usado/defeito?

### `ferramental`
Diferente de material de consumo: é **patrimônio emprestado**.
- número de patrimônio, descrição, valor
- termo de responsabilidade assinado
- estado na entrega e na devolução
- ❓ tem conferência periódica? desconto em folha por perda?

---

## D. Frota

### `veiculo`
placa, modelo, ano, renavam, tipo, situação, vínculo com técnico/equipe.
Documentação: CRLV, seguro, vencimentos (com alerta).

### `abastecimento`
data, hodômetro, litros, valor/litro, valor total, posto, **foto do cupom**, quem abasteceu.
→ calcula **km/l por veículo e por técnico**.
> Aqui há espaço claro para superar o sistema atual: detecção de anomalia
> (hodômetro menor que o anterior, consumo fora da curva, dois abastecimentos
> no mesmo dia). É o tipo de coisa que paga o projeto sozinha.

❓ O Emanuel mencionou "fluxo de abastecimento" — tem aprovação? Cartão/vale?
Limite por veículo?

### `manutencao` e `checklist_veiculo`
Preventiva/corretiva, custo, oficina. Checklist diário do técnico (pneu, óleo, avarias).

---

## E. Permissões

Modelo proposto: **RBAC + escopo**, materializado em RLS no Postgres.

```
permissão = papel (o que pode fazer) × escopo (sobre quais registros)

escopos:  GLOBAL  │  BASE  │  EQUIPE  │  CARTEIRA  │  PRÓPRIO
```

Exemplo: Controlador tem papel `controlador` com escopo `CARTEIRA` → enxerga apenas
OS dos técnicos vinculados a ele. Técnico tem escopo `PRÓPRIO`.

❓ **Preciso da matriz real.** Especialmente:
- O que o técnico **não pode** ver? (valores? OS de outros? dados do cliente?)
- Controlador vê custo/financeiro?
- Quem pode alterar OS já concluída?
- Quem aprova o quê?

---

## Próximo passo
Percorrer o sistema atual tela a tela e substituir cada ❓ por fato observado.
