-- ============================================================
-- 068 · Os técnicos do supervisor, escolhidos um a um
--
-- > "precisa ter um botão seletor em alguma parte selecionando
-- >  supervisor X vai ser supervisor dos nomes x, y, z, e quando
-- >  quisesse trocar seria fácil" — Emanuel
--
-- O vínculo da D-132 é pelo NOME DA PLANILHA e pega tudo de uma vez —
-- 21 equipes, 29 técnicos. Serve para casar o acesso com o que a CLARO
-- manda; não serve para dizer "estes três são dele".
--
-- `tecnico.supervisor_id` é a DECLARAÇÃO de quem opera, com autor e
-- carimbo de hora, e tem **precedência** sobre `equipe.supervisor_nome`,
-- que é o padrão herdado da planilha. Técnico que ninguém marcar
-- continua com o supervisor da equipe: não usar isto não quebra nada.
--
-- ┌─ a divergência que a tela tem de mostrar ────────────────────────┐
-- │ Os dois fatos convivem, e vão divergir. Dos três técnicos do      │
-- │ teste, dois herdam `SUPERVISOR - RAPHAEL FELIPE` da planilha e    │
-- │ foram declarados de outra pessoa. Esconder um dos dois faria a    │
-- │ tela mentir metade do tempo, então a aba Técnicos mostra o        │
-- │ declarado com a etiqueta DECLARADO e, embaixo, o que a planilha   │
-- │ diz. Mesmo padrão do login (CADASTRADO / SEM CADASTRO).           │
-- └───────────────────────────────────────────────────────────────────┘
--
-- **Soltar é tão importante quanto ligar.** A função solta quem era
-- daquele supervisor e saiu da lista — sem isso, desmarcar não
-- desmarcaria nada, só acrescentaria. É o que faz "trocar ser fácil".
--
-- Exige o papel SUPERVISOR, como a 040: papel e vínculo andam juntos,
-- senão quem cadastrou acha que fez e não fez.
--
-- CONFERIDO na tela, com o acesso "Supervisor X" (a pedido do Emanuel):
--
--     marcar Z384041, Z515564, Z656921 → "3 técnico(s) sob ele (+3)"
--     banco: os três com supervisor_id e carimbo de autor
-- ============================================================

alter table tecnico add column if not exists supervisor_id  uuid references perfil(id);
alter table tecnico add column if not exists supervisor_em  timestamptz;
alter table tecnico add column if not exists supervisor_por uuid references perfil(id);

comment on column tecnico.supervisor_id is
  'O supervisor DECLARADO deste tecnico, escolhido por alguem na tela. '
  'Tem precedencia sobre equipe.supervisor_nome, que vem da planilha e e '
  'o padrao herdado. Nulo = ninguem declarou, vale o da equipe. Ver 068.';

create index if not exists tecnico_supervisor_idx
  on tecnico (supervisor_id) where supervisor_id is not null;

create or replace function public.definir_tecnicos_do_supervisor(
  p_usuario uuid, p_tecnicos uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_nome text; n_lig int; n_sol int;
begin
  if not eh_gestor() then
    raise exception 'Sem permissao.' using errcode = '42501';
  end if;
  if not tem_permissao('equipes.editar') then
    raise exception 'Seu perfil de acesso nao inclui "Editar equipe e tecnico".'
      using errcode = '42501';
  end if;

  select nome into v_nome from perfil
   where id = p_usuario and empresa_id = minha_empresa();
  if v_nome is null then
    raise exception 'Usuario nao encontrado nesta empresa.' using errcode = 'P0002';
  end if;

  if not exists (select 1 from usuario_papel
                  where usuario_id = p_usuario and papel = 'SUPERVISOR') then
    raise exception 'Este usuario nao tem o papel SUPERVISOR. De o papel antes de vincular.'
      using errcode = '23514';
  end if;

  -- Solta quem era dele e saiu da lista. Sem isto, tirar um tecnico da
  -- selecao nao tiraria nada -- so acrescentaria.
  update tecnico set supervisor_id = null, supervisor_em = null, supervisor_por = null
   where supervisor_id = p_usuario
     and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis())
     and not (id = any(coalesce(p_tecnicos, '{}'::uuid[])));
  get diagnostics n_sol = row_count;

  update tecnico set supervisor_id = p_usuario,
                     supervisor_em = now(), supervisor_por = auth.uid()
   where id = any(coalesce(p_tecnicos, '{}'::uuid[]))
     and empresa_id = minha_empresa()
     and base_id in (select bases_visiveis())
     and supervisor_id is distinct from p_usuario;
  get diagnostics n_lig = row_count;

  return jsonb_build_object('supervisor', v_nome,
                            'vinculados', n_lig, 'soltos', n_sol,
                            'total', (select count(*) from tecnico
                                       where supervisor_id = p_usuario));
end;
$function$;

revoke all on function public.definir_tecnicos_do_supervisor(uuid, uuid[]) from public, anon;
grant execute on function public.definir_tecnicos_do_supervisor(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
