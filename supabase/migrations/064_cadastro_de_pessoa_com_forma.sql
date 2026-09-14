-- ============================================================
-- 064 · Cadastro de pessoa com forma: CPF é CPF, telefone é telefone
--
-- > "campos de cadastro estão deixando eu colocar qualquer coisa,
-- >  inclusive número de telefone fora do padrão, cpf e etc, precisa
-- >  corrigir isso" — Emanuel
--
-- Os três cadastros de teste ficaram assim no banco:
--
--     cpf              123123123213   (12 dígitos)
--     whatsapp         213123213213   (12 dígitos)
--     data_nascimento  22222-02-22    ← ano vinte e dois mil
--
-- O Postgres aceitou o ano 22222 sem reclamar: `date` vai até 5874897
-- AD. Nada em lugar nenhum conferia.
--
-- A tela agora confere (`app/src/lib/validacao.ts`, com dígito
-- verificador de CPF). Mas **tela não é barreira** — a barreira é o
-- banco, como em todo o resto deste sistema. Um `insert` pelo
-- PostgREST, um script, uma tela futura: todos passam por aqui.
--
-- ┌─ por que NOT VALID ──────────────────────────────────────────────┐
-- │ As três linhas de teste do Emanuel violam quase tudo. `NOT VALID` │
-- │ não olha para trás: as linhas existentes ficam onde estão, e a    │
-- │ regra vale para todo INSERT e para todo UPDATE **daquela linha**. │
-- │                                                                   │
-- │ Ou seja: no dia em que alguém editar o cadastro do GABRIEL pela   │
-- │ tela nova de edição, vai ter de arrumar o CPF para salvar. É o    │
-- │ conserto no lugar certo — na mão de quem sabe o número —, não um  │
-- │ `update` meu adivinhando dado de pessoa de verdade.               │
-- │                                                                   │
-- │ Para valer para trás também, um dia: `alter table perfil validate │
-- │ constraint <nome>;` depois de limpar.                             │
-- └───────────────────────────────────────────────────────────────────┘
--
-- CPF e telefone são guardados **só com dígitos**. Guardar
-- "123.456.789-09" e "12345678909" na mesma coluna faz duas linhas do
-- mesmo CPF nunca se encontrarem; a máscara é da tela.
--
-- RG NÃO ganha regra de formato: não existe padrão nacional (cada
-- estado emite o seu, com letra, tamanho e dígito diferentes).
-- Conferimos tamanho e caracteres, e só — inventar dígito verificador
-- de RG reprovaria documento de gente de verdade.
-- ============================================================

alter table perfil
  add constraint perfil_cpf_forma
  check (cpf is null or cpf ~ '^[0-9]{11}$') not valid;

alter table perfil
  add constraint perfil_whatsapp_forma
  check (whatsapp is null or whatsapp ~ '^[0-9]{10,11}$') not valid;

-- Ano plausível, não idade: `current_date` não é IMMUTABLE e não entra
-- em CHECK. A idade (16 a 90) fica na tela, que sabe que dia é hoje.
alter table perfil
  add constraint perfil_nascimento_plausivel
  check (data_nascimento is null
         or (data_nascimento > date '1900-01-01'
             and data_nascimento < date '2100-01-01')) not valid;

alter table perfil
  add constraint perfil_matricula_ponto_forma
  check (matricula_ponto is null or matricula_ponto ~ '^[0-9]{1,20}$') not valid;

alter table perfil
  add constraint perfil_rg_forma
  check (rg is null or rg ~ '^[0-9A-Za-z./ -]{5,20}$') not valid;

alter table perfil
  add constraint perfil_email_forma
  check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$') not valid;

comment on constraint perfil_cpf_forma on perfil is
  'CPF guardado so com digitos (11). Mascara e da tela; o digito '
  'verificador e conferido em app/src/lib/validacao.ts. Ver 064.';
comment on constraint perfil_nascimento_plausivel on perfil is
  'Barra o absurdo (ano 22222 entrou assim). A idade plausivel, 16 a '
  '90 anos, e conferida na tela, que sabe a data de hoje. Ver 064.';

notify pgrst, 'reload schema';
