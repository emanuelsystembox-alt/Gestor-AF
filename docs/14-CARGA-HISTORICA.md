# Carga histórica de contratos (planilha do ngestor)

Como povoar o banco com contratos antigos de uma cidade, a partir da planilha
anual que o ngestor exporta. Feito pela primeira vez em **03/11/2026**: Manaus
e São Luís, janeiro a outubro, **97.600 contratos** e 139.629 O.S. (D-282).

> *"gostaria muito de pesquisar um contrato ou uma WO e aparecer o histórico
> deles, quem executou (...) os números de telefone já subir no nosso sistema,
> para quando esse contrato voltar de novo, já aparecer para o técnico"*
> — Emanuel, 03/11. *"em breve faremos de outras cidades e com um volume grande
> também"*.

O que a carga entrega: o contrato pesquisado mostra todas as visitas antigas
(equipe, situação, as duas baixas, quem baixou e onde); a rota de uma equipe
de meses atrás aparece; produtividade, pontos e relatórios contam esses meses;
e o telefone do cliente aparece no contrato de hoje e no app do técnico
(`telefones_do_cliente`, 192).

**A VPS não tem backup.** A carga é desfazível só porque é marcada (ver
"Desfazer"). Não pule o ensaio.

---

## Os arquivos

| | |
|---|---|
| `app/scripts/carga-historica/exporta_ngestor.cjs` | lê a planilha e grava uma linha JSON por visita |
| `app/scripts/carga-historica/carga.sql` | grava tudo no banco, numa transação |

Os dois estão no Git; **a planilha e o `.jsonl` nunca** (`*.xlsx` e `*.jsonl`
estão no `.gitignore` — nome, telefone e endereço de assinante são LGPD).

---

## 1. Perguntar antes (não decida pelo Emanuel)

Na primeira carga as respostas foram estas — confirme para a cidade nova:

| Pergunta | Resposta em 03/11 |
|---|---|
| Entra nos números (produtividade, pontos, relatórios, indicadores) ou só na busca? | **Entra em tudo** |
| Equipe da planilha que não existe no cadastro? | **Criar com o nome da planilha, ativa** — o histórico mostra o número da equipe |
| Contrato que ficou aberto no ngestor? | **Entra como estava** |
| Período? | jan até o mês passado |
| Apagar o que já existe no banco nesse período? | Em 03/11 o banco foi zerado até 02/11 antes (D-279) — **pergunte de novo**: a carga não confere duplicata com contrato que já existe |

## 2. Olhar a planilha sem expor dado de cliente

Leia só cabeçalho, contagens e formatos (troque dígito por `9`, letra por
`a`) — nunca imprima nome, telefone ou endereço. Confira:

- as **colunas** (a de 03/11 tinha 65; `exporta_ngestor.cjs` falha com
  "coluna X" se faltar alguma que ele lê);
- a coluna **Operação** (o começo dela diz a cidade) e a contagem **por mês**
  — na de 03/11, jun–out tinham ~5 mil por mês contra ~14 mil de jan–mai:
  avise o Emanuel quando o volume cair assim;
- quanto **casa com o cadastro**: equipes (em 03/11, 83 de 177 nomes), código de
  baixa do ngestor (95%) e do TOA (99,5%), grupo de serviço (6 de 6), tipo de O.S.
  pela descrição (99%), área. O que não casa entra sem aquele dado — diga quanto.

## 3. Ajustar os scripts para a cidade

- `exporta_ngestor.cjs`: `CIDADES` (início da Operação → `op`) e `DE`/`ATE`.
- `carga.sql`, tabela `_b`: uma linha por `op` com a cidade (`base.nome`), o
  **prefixo da WO** que o TOA manda nela e o **fuso**:

  ```sql
  select b.nome, split_part(v.wo_numero, '|', 1), count(*)
    from visita v join base b on b.id = v.base_id
   where v.wo_numero like '%|%' group by 1, 2;
  ```

  Manaus `00121|` e `America/Manaus` (−4); São Luís `00696|` e
  `America/Fortaleza` (−3).
- `carga.sql`, tabela `_ta` (tipo de atividade pelo grupo): é o par mais
  frequente grupo → atividade no dado atual. Refaça a conta se a cidade for
  diferente.

## 4. Exportar (na máquina, numa pasta temporária)

```powershell
node --max-old-space-size=6000 app/scripts/carga-historica/exporta_ngestor.cjs . "C:\caminho\planilha.xlsx" "$env:TEMP\ngestor.jsonl"
```

Imprime `lidas`, `fora_de_operacao` e `sem_data_valida` — os dois últimos
precisam ser explicados. 97.600 linhas viraram 133 MB (20 MB comprimido).

## 5. Enviar e ensaiar (termina em `rollback`)

```bash
gzip -k ngestor.jsonl
scp ngestor.jsonl.gz root@179.197.82.110:/tmp/
ssh root@179.197.82.110 "gunzip -f /tmp/ngestor.jsonl.gz && docker cp /tmp/ngestor.jsonl supabase-db:/tmp/ngestor.jsonl"
```

Monte o ensaio = `carga.sql` + uma linha `rollback;` no fim, copie para o
container e rode **em segundo plano** (em 03/11 levou ~3,5 min — a O.S.
dispara um gatilho por linha):

```bash
ssh root@179.197.82.110 "docker exec supabase-db psql -U postgres -d postgres -f /tmp/carga_ensaio.sql"
```

O fim imprime a conferência. Em 03/11:

| item | n |
|---|---|
| visitas | 97.600 |
| ordens de servico | 139.629 |
| os sem tipo | 742 |
| os com baixa afline / toa | 134.799 / 105.697 |
| eventos de baixa | 94.989 |
| visitas sem equipe / sem grupo | 0 / 0 |
| visitas sem area | 873 |
| avisos restantes da carga | **0** (tem de ser 0) |

## 6. Valer (termina em `commit`)

O mesmo arquivo com `commit;` no lugar do `rollback;`. Depois:

```sql
analyze visita; analyze ordem_servico; analyze visita_evento; analyze equipe;
```

## 7. Limpar o dado de cliente

```bash
ssh root@179.197.82.110 "docker exec supabase-db rm -f /tmp/ngestor.jsonl /tmp/carga_*.sql; rm -f /tmp/ngestor.jsonl* /tmp/carga_*.sql"
```

E apague o `.jsonl` e o `.gz` da máquina. Confira que não sobrou nada.

## 8. Conferir

- Um contrato de hoje que tem histórico: pesquise o número em Serviços — tem de
  vir **todas** as visitas (a busca ignora os filtros da lista, D-283).
- A página do contrato de hoje mostra os telefones antigos.
- Quantos contratos de hoje ganharam histórico (em 03/11: 120 de 422) e telefone
  (128 de 422).
- Um mês cheio na Produtividade como `authenticated` (maio, 9.319 contratos de
  Manaus: 0,6 s). Se passar de alguns segundos, o `statement_timeout` de 8 s
  do `authenticated` vai derrubar a tela.
- As duas baterias (`testar_policies()`, `testar_campo()`).

## Desfazer

Tudo da carga aponta para as importações `fonte = 'NGESTOR'`:

```sql
begin;
set local statement_timeout = 0;
create temp table _imp as select id from importacao where arquivo_path = 'carga-historica-ngestor';
update reincidencia set visita_anterior_id = null
 where visita_anterior_id in (select id from visita where importacao_id in (select id from _imp));
update casa_cliente set visita_id = null
 where visita_id in (select id from visita where importacao_id in (select id from _imp));
delete from visita where importacao_id in (select id from _imp);   -- O.S. e eventos vão junto
delete from importacao where id in (select id from _imp);
-- confira e só então: commit;
```

As equipes criadas pela carga ficam (equipe com histórico não se apaga, D-090);
sem contrato, elas não aparecem nas telas do dia.

---

## O que a carga faz, e por quê

- **Uma linha = uma visita**, com até 11 O.S. na mesma célula ("número - tipo",
  uma por linha) — separadas.
- **Situação** do ngestor → a nossa (Concluido, Cancelado, Reagendamento, Entrada,
  Em execução, Em deslocamento, Com impedimento).
- **Código do ngestor → baixa da AFLINE; código do TOA → baixa da operadora**, nas
  O.S. da visita. O 800 do ngestor vira o nosso "Auditar".
- **WO** com o prefixo da cidade (o TOA manda `00121|…`; a planilha, só o número).
  WO "0" fica vazia.
- **Equipe** pelo nome; senão pelo número ("049 - EQUIPE - THIAGO" é a 049);
  senão criada. **Técnico não vem**: a coluna "Login" é quem deu a baixa no
  ngestor (o COP) — vai no evento de baixa, não no técnico.
- **Evento de baixa** (`visita_evento` tipo `BAIXA`): quem baixou, quando e, se a
  planilha trouxer, onde a equipe estava (`Lat/Lng_Equipe`) com origem `MOBILE` —
  é o que faz o "onde baixou" funcionar no histórico.
- **TEC1** vem pronto do "Tec Um"; `fim` e `situacao_em` da data/hora da situação,
  no fuso da cidade. A pontuação é a das regras de hoje, não a do ngestor.
- O resto (marcadores, equipamento, monitor, sub-falha, ID do ngestor) vai em
  `dados_origem`.
- **Nenhum aviso** vai para o técnico.

## Armadilhas que apareceram na primeira carga

- **`janela_imediata` é coluna gerada**: insert com valor estoura (o ensaio pegou).
- **O gatilho da O.S. recalcula o grupo de serviço** da visita
  (`aplica_grupo_servico`) e passaria por cima do grupo da planilha: o script
  regrava o grupo depois das O.S.
- **O aviso de "dois em andamento" só dispara com `app.origem = 'IMPORTACAO'`** —
  e é com ela que o gatilho de um status por técnico deixa passar os abertos
  antigos. O script usa `IMPORTACAO` e apaga, no fim, aviso e sinal das visitas da
  carga (foram 28).
- **Evento `SITUACAO` vindo da importação vira aviso** (`aviso_do_evento`): por
  isso o histórico usa o tipo `BAIXA`, que o gatilho ignora.
- **Data em formato americano** (m/d/aa) e ~35 linhas com ano errado (2001, 2020…):
  o exportador cai para a "Data Situação" quando a do agendamento sai do período.
- **O histórico não tem bucket**: filtro de bucket escondia as visitas antigas na
  busca — a busca por número passou a ignorar os filtros (D-283).
- **Arquivo do Storage não se apaga por SQL** (`protect_objects_delete`): se a
  limpeza envolver evidência, use a API do Storage de dentro da VPS (D-279).
- **SSH cai às vezes** (tempo esgotado): rode a carga em segundo plano e, depois de
  um erro de conexão, confira se o passo rodou antes de repetir — a limpeza de
  03/11 não tinha rodado na primeira tentativa.
