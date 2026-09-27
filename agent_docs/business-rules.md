# Regras de negócio e domínio

O que este sistema **nunca** pode violar. É o contexto que uma sessão
nova não tem como deduzir lendo o código: o código mostra o que o
sistema faz hoje, não o que ele tem de garantir sempre.

> **Regra zero: não invente regra de negócio.** Se não estiver aqui nem
> em `docs/03-DECISOES.md`, **pergunte ao Emanuel**. Ele pediu isso
> explicitamente, e é a origem de metade das decisões documentadas.

---

## O negócio

A **AFLINE** é prestadora da **CLARO**. Recebe ordens de serviço pelo
**TOA (Oracle Field Service)**, manda técnico a campo, executa e dá
baixa. Este projeto é a camada operacional própria — importar,
despachar, executar, medir e cobrar — substituindo o **Alfa Gestor /
ngestor**, que é caro e cujo roadmap não controlamos.

## Vocabulário — não confunda estes

| Termo | O que é | Onde vive |
|---|---|---|
| **Visita** (Atividade no TOA) | uma ida a um endereço | `visita` |
| **O.S.** | uma ordem de serviço; **1 visita tem de 1 a 10** | `ordem_servico` |
| **Tipo de atividade** | como o **TOA** chama (`Instalacao`, `Visita Tecnica`) | `tipo_atividade` |
| **Grupo/Tipo de serviço** | como a **operação e a CLARO** agrupam (`ADESAO`, `VISITA TECNICA`, `MIGRACAO GPON`) | `tipo_servico` |
| **Tipo de O.S.** | o código numérico da CLARO (`1`, `43`, `191`) | `tipo_os` |
| **Tipo de O.S. Consolidado** | o item da **LPU** que é faturado | *ainda não modelado* |

**O caso mais comum é 2 O.S. por visita.** Achatar em "1 linha = 1 O.S."
conta o deslocamento em dobro **e erra o faturamento**.

O.S. com número `AF-00000001` nasceu **aqui**, não na CLARO — é cadastro
manual (D-063). Os números da operadora têm 10 dígitos.

---

## A importação (090, D-166)

**O dia da visita é o DIA DE ATUAÇÃO, não a coluna "Data" da planilha.**
Quem decide é quem importa: a tela nasce em **hoje** (Manaus) e só vai
para outro dia quando a pessoa escolhe. *"so sera importado para o dia
anterior quando nos escolhermos a data que vamos atuar"* (Emanuel, 26/09).

- `importacao.data_atuacao` guarda a escolha; sem ela, vale
  `hoje_local()` — nunca `current_date`, nunca a "Data" do arquivo.
- O dia de atuação governa **tudo** que é dia: `data_agendada` (na
  criação e na atualização), a equipe do login na data, `inicio`/`fim` e
  o `toa_recurso`. Um contrato com o dia num lugar e a hora de outro dia
  estraga o TEC1 em 24 h.
- A "Data" da planilha **não se perde**: fica em `dados_origem` e no
  evento. Contrato que já existia e muda de dia deixa evento
  `DIA_DE_ATUACAO`.
- A prévia mostra a divergência **antes** do clique. Não adivinhe o dia
  pelo mais frequente do arquivo — isso é o sistema decidindo no lugar de
  quem opera (D-088).

---

## A baixa

**O status da operadora NÃO diz a situação; o CÓDIGO diz.** No analítico
do ngestor, `EXECUTADA` virou Reagendamento 1.075 vezes e Cancelado 657.
`codigo_baixa.situacao_destino` guarda o significado (derivado de 67.485
linhas); o parâmetro `baixa_automatica` decide se agimos sozinhos.
Ver D-097.

**São duas baixas, e elas divergem.** A da operadora vem do TOA e não se
edita (D-042). A da AFLINE é a nossa afirmação do que aconteceu. A tela
mostra as duas lado a lado justamente para a diferença aparecer.

**Situação terminal exige TODAS as O.S. baixadas** — concluir, cancelar
ou reagendar com uma O.S. sem código mente duas vezes: diz que o serviço
acabou e deixa sem resultado justamente o que a CLARO fatura.
`situacoes_terminais()` é a lista canônica (035); não escreva uma cópia.

**`visita.fim` vem preenchido mesmo em atividade só INICIADA.** Quem diz
que fechou é `finalizado_toa`. Ver D-103.

---

## As quatro travas do campo (055, D-113 a D-115)

Elas moram no **banco**, não na tela. A tela só antecipa o recado para o
botão não falhar sem explicar.

1. **Sem GPS não há baixa** — nem encerramento de visita. `baixar_os`
   recusa a chamada do campo sem `lat/lng`. Andar pela tela ("a
   caminho", "cheguei") **não** exige coordenada: travar o passo a passo
   por causa de satélite é pior que registrar sem ele.
2. **Baixa dada não se desfaz pelo campo**, e situação terminal não
   volta — inclusive o `REAGENDAMENTO` que a baixa automática aplica
   sozinha. Corrigir é do controlador, via `reverter_situacao`, que pede
   motivo (D-030).
3. **Depois de baixado o técnico ainda ANEXA** foto, vídeo e equipamento
   — mas só enquanto o contrato for **do dia**. Medido em
   `hoje_local()`, nunca `current_date`.
4. **Quem carimba o autor é o servidor.** Nenhuma tela manda
   `usuario_id` (D-061).

"Campo" é quem **só** tem o papel do campo. Um controlador que também
está cadastrado como técnico não perde os poderes de controlador por
abrir o aplicativo — a mesma conta é feita no banco e nas duas telas.

**Evidência é prova: não se apaga.** Não há policy de UPDATE nem DELETE
no bucket, nem RPC de exclusão. Foto errada hoje só sai pelo
`service_role` — e a saída certa, se virar necessidade, é *ocultar com
motivo*, não deletar.

**Nenhuma foto é obrigatória para baixar** — decisão do Emanuel entre
quatro opções (D-115). Se virar exigência, é tabela nova + cenário em
`testar_campo()`.

---

## Equipe, técnico e login

**Só o cadastro roteia contrato para equipe, e cadastro sem AUTOR não é
cadastro.** O sistema não declara no lugar de quem opera — nem gravando
cadastro que ninguém digitou (D-079), nem roteando por dedução calada
(D-088), nem sugerindo o que o usuário só teria de clicar (D-089).
Login sem cadastro vai para a equipe **"Sem login definido"**, visível,
até alguém dizer de quem é.

`equipe_do_login` lê **só** `equipe_login_toa` com `criado_por is not
null`: "estava lá antes" não é prova de nada — a 039 preservou 9 seeds
de migration achando que eram declaração, e eles rotearam 121 contratos.

**Técnico se desliga, não se apaga.** DELETE em `tecnico`/`equipe` é só
para ADMIN (policy), e trigger recusa quem tem histórico — inclusive
para o ADMIN. A tela só oferece Desligar/Reativar. Ver D-090.

**`tecnico.skill` não é rótulo: é a chave do dinheiro.** É por ela que o
técnico acha `meta_tecnico` e `faixa_comissao`. Gravar uma skill sem
faixa zera o "a receber" **em silêncio**. `SINGLE MASTER` foi default
nosso (037), não veio do TOA. Ver D-094.

---

## Medição e dinheiro

**A regra do dinheiro** (D-077): `a receber = pontuação × fator`, com o
fator saindo da faixa do mês. A faixa é por **piso**, não intervalo
fechado — a tabela em inteiros deixava buraco (199,50 pts → R$ 0,00).

**A pontuação é combinação de O.S. × edificação** (D-045), derivada do
relatório mensal. `pontos_claro` é o número que vale; `pontos_equipe`
**ainda não existe** e depende do Emanuel levantar as Regras de
Comissionamento.

**Zero e desconhecido não são a mesma coisa.** Quando não há regra de
pontuação, a coluna devolve **NULO** e a tela escreve "sem regra" — não
`0,00`. Zero é uma afirmação: *este serviço não vale nada*. Em 09/09,
125 das 364 visitas do dia caíam nisso. Ver D-117.

**Jornada não entra em produtividade.** `Na Base` e `Refeição` foram 103
de 344 apontamentos num dia. `tipo_atividade.natureza` separa
`PRODUTIVA` de `JORNADA`. **Sempre filtre.**

**Não meça tempo a partir de `visita.criado_em`** — é a hora da
importação, não do evento. A métrica útil é **aderência à janela**
(TEC1, D-047), lida do painel do próprio Emanuel, não inventada.

---

## Avisos ao campo (059, D-119)

O controlador muda o status **com observação**, e o técnico precisa ver.
A "mensagem" não é chat: é a observação que acompanha a mudança.

O gatilho mora em `visita_evento` — o funil por onde toda mudança já
passa. `origem = 'MOBILE'` **não** vira aviso: o que o próprio técnico
fez ele já viu acontecer.

**A linha na tabela `aviso` é a verdade; o Realtime é só o carregador.**
Quem estava sem sinal lê o que perdeu ao voltar.

---

## Almoxarifado (077 a 087, D-152 a D-163)

**Três eixos por peça, três donos.** `estado_atlas` é da CLARO e só a
importação grava. `estado_afline` é a nossa correção dele, no
vocabulário dele, com motivo (D-160). `posse` + `condicao` são a leitura
operacional do almoxarifado (onde está; inicializado / retirado / com
defeito). Não misture: a condição **não** é estado do Atlas.

**A importação não inventa posse.** Peça importada nasce com `posse`
nula — "sem posse declarada" é o trabalho que falta, não um estoque
redondo (D-152).

**Posse só se move por documento ou pelo campo.** Romaneio (entrega,
devolutiva, transferência) ou o serial lançado na baixa (079). Nada se
move enquanto o romaneio está ABERTO; confirmado não se cancela — a
correção é o documento inverso (D-154).

**O aceite é do técnico, pelo celular, com prova.** Quem recebe confirma
— na transferência, o técnico de destino; a origem nunca confirma pelo
outro. O técnico **tem** de declarar o método (`APARELHO` = biometria
ou bloqueio do celular; `SENHA` = senha do sistema); a web grava
`BALCAO` e ninguém pelo cliente se passa por balcão (087-D, D-163).

**Prazo da carga.** Quem tem peça parada há mais de
`carga_dias_limite` dias não **recebe** peça nova (entrega nem
transferência). O bloqueio é no bipar, nunca na confirmação — a peça já
pode estar na mão dele. **0 desliga, e é o valor da AFLINE** (copiado do
sistema anterior, onde está em 0). Só seriais contam (087-A, D-163).

**A devolutiva declara a condição** antes de bipar, sem padrão marcado.
O campo carimba `RETIRADO` sozinho (087-B).

**Transferência pedida pelo técnico tem três mãos** (089-C, D-165): o
técnico de origem pede pelo celular, o de destino **aceita** (biometria
ou senha) e o almoxarifado **aprova**. Só na aprovação a posse e o
saldo mudam — até lá, continua na carga de quem pediu. A origem pode
desistir e o destino pode recusar enquanto não houver aprovação.
Transferência aberta pelo almoxarifado dispensa a aprovação (quem montou
já é o almoxarifado).

**Material gasto no contrato sai do saldo do TÉCNICO**, amarrado ao
contrato (`baixar_miscelanea`). Baixar o que ele não tem é recusado.

**Auditoria não sobrescreve saldo**: o contado entra como AJUSTE com a
diferença e motivo obrigatório. O saldo é sempre soma do razão.

**Peça em PERDA/SUCATA entra no romaneio com aviso, não com bloqueio.**
48,9% da carga está em PERDA; travar seria política de patrimônio que
ninguém combinou (D-154).

**O que o campo declara nunca trava a baixa.** Serial fora da carga não
move nada e não levanta exceção (D-157).

---

## Frota (088, D-164)

**O condutor é o TÉCNICO, pelo nome — nunca a equipe.** "Nada de equipe
pra não ter duplicada" (Emanuel). O concorrente grava o login da equipe e
a dupla vira um nome só. O condutor tem **período** (`desde`/`ate`), um
atual por carro; o histórico diz quem dirigiu cada carro e quando.

**De quem é o carro, onde ele dorme e onde ele está são campos
separados.** (O `pernoite` entrou na 089.) `propriedade` (própria, locadora, do técnico), `pernoite`
(leva para casa ou dorme na base) e `situacao` (ativo, na garagem, fora
da garagem, em manutenção). O concorrente mistura tudo num campo
"origem" de 19 opções. A AFLINE precisa responder: quantos alugados,
quantos próprios, quantos levam para casa.

**Vendido, devolvido ou sinistrado sai da lista com motivo** —
arquivar, nunca apagar e nunca virar "origem". O histórico continua.

**O consumo é medido, não suposto.** Km/l sai do odômetro dos
abastecimentos aprovados/abastecidos, de leitura válida a leitura
válida. Não existe km/l "de referência": sem trecho medido, a tela diz
"sem km medido". As exceções (odômetro que voltou, sem odômetro, km
muito baixo) são para conferir, **nunca bloqueiam** lançamento.

---

## Em aberto — pergunte antes de assumir

- `pontos_equipe` (o que a equipe recebe)
- meta e faixas de ADESÃO, MANUTENÇÃO e DESCONEXÃO (D-094)
- `ITEM` / `CONSOLID` / `VALOR` por O.S. — a LPU, não modelada
- 34 regras de pontuação marcadas `CONFERIR`; 448 regras coringa
- retenção de evidência: por quanto tempo a CLARO audita?

Lista completa e atualizada em `docs/08-ESTADO-DO-PROJETO.md`.
