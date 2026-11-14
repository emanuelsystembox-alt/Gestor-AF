-- 267 · O supervisor importa a planilha do TOA; a trava vira a PERMISSÃO, não a lista de papéis (D-382)
--
-- > "Este usuário (...) está informando que não está conseguindo importar" — Emanuel, 14/11, com o
-- > FLAVIO (Supervisor, São Luís) logado. Perguntado, escolheu: "Liberar para o perfil Supervisor".
--
-- O QUE TRAVAVA (três lugares, nenhum na planilha — o arquivo de teste estava no formato certo):
--   1. `importacao` e `importacao_linha`: o RLS só aceitava gestor (Admin/COP) ou Controlador. O
--      supervisor levava "new row violates row-level security" já na primeira gravação — por isso
--      ele não tinha NENHUMA importação no histórico, nem com erro.
--   2. `importar_toa` / `reconciliar_importacao` / `desatribuir_ausentes`: exigem gestão (o
--      supervisor é) + a permissão `importacao.executar` — que o perfil Supervisor não tinha.
--   3. A tela deixava tentar (corrigida no mesmo dia: avisa e não oferece o botão).
--
-- AGORA: quem tem `importacao.executar` grava a importação da cidade que vê — o poder mora no perfil
-- de acesso (Administração › Perfis), não numa lista de papéis no RLS. Gestor e Controlador seguem
-- como estavam. A linha crua (`importacao_linha`, tem dado de assinante) fica AMARRADA à importação
-- que a pessoa enxerga (a cidade dela): a regra antiga dela não filtrava cidade nenhuma, e abrir
-- assim para o supervisor daria a ele a planilha das outras cidades.

drop policy if exists importacao_gestao on public.importacao;
create policy importacao_gestao on public.importacao for all to authenticated
  using ((empresa_id = (select minha_empresa()))
         and (base_id in (select bases_visiveis()))
         and ((select eh_gestor()) or (select tem_papel('CONTROLADOR'::papel_tipo))
              or (select tem_permissao('importacao.executar'))))
  with check ((empresa_id = (select minha_empresa()))
         and (base_id in (select bases_visiveis()))
         and ((select eh_gestor()) or (select tem_papel('CONTROLADOR'::papel_tipo))
              or (select tem_permissao('importacao.executar'))));

-- a de gestor/controlador fica como era; a nova só vale para a importação que a pessoa enxerga
drop policy if exists importacao_linha_permissao on public.importacao_linha;
create policy importacao_linha_permissao on public.importacao_linha for all to authenticated
  using ((select tem_permissao('importacao.executar'))
         and importacao_id in (select i.id from importacao i))
  with check ((select tem_permissao('importacao.executar'))
         and importacao_id in (select i.id from importacao i));

-- o perfil Supervisor ganha ver (o menu Importar TOA) e executar
insert into perfil_acesso_permissao (perfil_acesso_id, permissao_chave)
select pa.id, k.chave
  from perfil_acesso pa
 cross join (values ('importacao.ver'), ('importacao.executar')) k(chave)
 where pa.nome = 'Supervisor'
on conflict do nothing;

notify pgrst, 'reload schema';
