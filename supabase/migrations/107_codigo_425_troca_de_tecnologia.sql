-- ┌─ 107 · o código 425 — TROCA DE TECNOLOGIA — fecha como Concluída ──┐
-- │ > "Precisamos adicionar o código 425 em nosso sistema, não tem     │
-- │ >  cadastrado penso eu, temos que fechar ele como concluído,       │
-- │ >  atualmente ele esta em execução no nosso sistema" — Emanuel,    │
-- │ >  19/10                                                           │
-- │                                                                    │
-- │ Conferido: 168 códigos no cadastro, o 425 não estava. É o ÚNICO    │
-- │ código das importações desde 17/10 sem cadastro (8 linhas — a      │
-- │ mesma atividade nas reimportações do dia). Sem cadastro a          │
-- │ importação grava a O.S. com codigo_baixa_id NULO, a baixa          │
-- │ automática não tem o que aplicar, e o contrato fica em             │
-- │ EM_EXECUCAO mesmo com o TOA dizendo "concluído".                   │
-- │                                                                    │
-- │ Na planilha de 19/10: atividade "Troca Decoder Digital", O.S. 148  │
-- │ (TROCA DECODER PARA ATUALIZACAO DIGITAL), status da O.S.           │
-- │ "Executada", código "425 - TROCA DE TECNOLOGIA".                   │
-- │                                                                    │
-- │ situacao_destino = CONCLUIDA — decisão do Emanuel.                 │
-- │ natureza = SUCESSO — do dado: a O.S. veio Executada, como os       │
-- │   409/428/430 (SUCESSO, CONCLUIDA). Não é IMPRODUTIVA, então não   │
-- │   conta como "quebrado".                                           │
-- │ familia = EQUIPAMENTO, com revisar = true — a coluna é NOT NULL e  │
-- │   não há família "indefinida"; EQUIPAMENTO é a do 513              │
-- │   (Incompatibilidade da Tecnologia). PROVISÓRIA: ninguém disse     │
-- │   qual é, e `revisar` marca isso. Só agrupa relatório — quem fecha │
-- │   o contrato é o destino.                                          │
-- │ situacao_origem = CADASTRO, com o autor: é declaração de quem      │
-- │   opera, não derivação do analítico (ANALISE). Ver D-184.          │
-- └────────────────────────────────────────────────────────────────────┘

insert into codigo_baixa (codigo, descricao, familia, natureza, responsabilidade,
                          revisar, ativo, empresa_id,
                          situacao_destino, situacao_origem, situacao_por, situacao_em)
select 425, 'TROCA DE TECNOLOGIA', 'EQUIPAMENTO', 'SUCESSO', null,
       true, true, null,
       'CONCLUIDA', 'CADASTRO',
       (select p.id from perfil p where p.email = 'admin@afline.com.br'), now()
on conflict (codigo) do nothing;
