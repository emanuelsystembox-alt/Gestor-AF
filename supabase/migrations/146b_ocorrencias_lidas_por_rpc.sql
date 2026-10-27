-- 146b · A lista de ocorrências sai montada do banco (D-226)
--
-- A tela lia sinalizacao_material com embed de tecnico, equipe e veiculo.
-- Só que o RLS de `veiculo` libera para quem tem frota.ver, e o de
-- `tecnico` só as equipes que o supervisor supervisiona: o coordenador
-- veria "sem carro no cadastro" onde HÁ carro, e técnico "—" onde há nome.
-- Zero e desconhecido não são a mesma coisa (D-117) — e aqui o "não sei"
-- viraria uma afirmação falsa.
--
-- A RPC aplica a MESMA regra da policy sinalizacao_leitura (146) e
-- devolve a linha pronta, com nome, equipe, item, problema e placa.

create or replace function ocorrencias_do_campo(p_assunto text default null,
                                                p_so_abertas boolean default true)
returns table (id uuid, assunto text, tipo text, situacao text, criado_em timestamptz,
               resolvido_em timestamptz, resposta text, descricao text, serial text,
               tecnico text, equipe text, item text, item_codigo text,
               problema text, placa text, modelo text)
language sql stable security definer set search_path to 'public' as $fn$
  select s.id, s.assunto, s.tipo, s.situacao, s.criado_em, s.resolvido_em, s.resposta,
         s.descricao, s.serial, t.nome, e.codigo, i.nome, i.codigo, p.rotulo, v.placa, v.modelo
    from sinalizacao_material s
    join tecnico t on t.id = s.tecnico_id
    left join equipe e on e.id = t.equipe_id
    left join item_miscelanea i on i.id = s.item_id
    left join problema_veiculo p on p.id = s.problema_id
    left join veiculo v on v.id = s.veiculo_id
   where s.empresa_id = minha_empresa()
     and (p_assunto is null or s.assunto = p_assunto)
     and (not p_so_abertas or s.situacao = 'ABERTA')
     and ((s.assunto = 'FERRAMENTAL' and tem_permissao('almoxarifado.ver'))
          or (tem_permissao('campo.ocorrencias')
              and t.base_id in (select bases_visiveis())))
   order by s.criado_em desc
   limit 300;
$fn$;
revoke all on function ocorrencias_do_campo(text, boolean) from public, anon;
grant execute on function ocorrencias_do_campo(text, boolean) to authenticated;

notify pgrst, 'reload schema';
