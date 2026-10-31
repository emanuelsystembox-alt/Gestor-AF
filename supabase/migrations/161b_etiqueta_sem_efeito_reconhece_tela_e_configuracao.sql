-- 161b: a etiqueta "sem efeito ainda" (157c) procurava a chave LITERAL nas
-- funcoes e policies. Depois da 161a, duas familias passaram a valer por
-- outro caminho e seriam acusadas de "sem efeito" mentindo:
--   · configuracoes.cadastrar/editar/excluir -- conferidas por
--     `pode_configurar('cadastrar')`, que monta a chave por concatenacao;
--   · os "Visualizar menu" (servicos/equipes/importacao/relatorios/
--     configuracoes.ver) -- conferidos pela TELA (menu e rota), nao pelo banco.
-- A segunda e uma lista escrita aqui: e a unica coisa que o banco nao enxerga
-- sozinho. Quem passar a conferir outra chave so na tela acrescenta aqui.
do $$
declare d text; antes text;
begin
  d := pg_get_functiondef('permissoes_do_usuario(uuid, uuid)'::regprocedure); antes := d;
  d := replace(d,
    $a$         exists (select 1 from fonte f
                  where strpos(f.txt, 'tem_permissao(''' || pm.chave || '''') > 0
                     or strpos(f.txt, '''' || pm.chave || '''') > 0
                        and strpos(f.txt, 'tem_permissao') > 0)$a$,
    $b$         pm.chave = any (array['servicos.ver','equipes.ver','importacao.ver',
                                'relatorios.ver','configuracoes.ver'])
         or exists (select 1 from fonte f
                  where strpos(f.txt, 'tem_permissao(''' || pm.chave || '''') > 0
                     or strpos(f.txt, '''' || pm.chave || '''') > 0
                        and strpos(f.txt, 'tem_permissao') > 0
                     or pm.chave like 'configuracoes.%'
                        and strpos(f.txt, 'pode_configurar(''' || split_part(pm.chave, '.', 2) || '''') > 0)$b$);
  if d = antes then raise exception '161b: expressao do em_uso nao achada'; end if;
  execute d;
end $$;
