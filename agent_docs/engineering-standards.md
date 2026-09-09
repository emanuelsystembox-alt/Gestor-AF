# Padrões de engenharia

O "porquê". O "com qual comando" está em `CLAUDE.md` e em
`productivity.md`.

---

## Os princípios

- **Correção antes de velocidade.** Prefira a solução verificavelmente
  certa à que é rápida de escrever.
- **Tipagem estrita.** `npx tsc --noEmit` limpo nos dois projetos antes
  de commitar. Sem `any` para calar o compilador.
- **Legibilidade não é opcional.** Código é lido muito mais do que
  escrito.
- **Desempenho importa onde foi medido que importa.** Não micro-otimize
  no escuro — mas veja abaixo *como* medir aqui, porque o jeito errado
  mente.
- **Correção de bug começa por reproduzir.** Escreva o cenário que falha
  antes de consertar. Neste projeto isso costuma ser um cenário novo em
  `testar_policies()` ou `testar_campo()`.
- **Siga a documentação atual da biblioteca, não a memorizada.** APIs
  mudam. No `campo/`, o `.d.ts` em `node_modules/<modulo>/build/` é
  ainda melhor que a documentação: é o que o `tsc` obedece.
- **Validação automática antes do commit.** Ver `.claude/hooks/`.

---

## As três regras que este projeto aprendeu doendo

### 1. Medir como dono mente

`produtividade_periodo` fazia 402 ms como owner e **estourava o
timeout** como `authenticated`. Teste de policy escrito como
`SECURITY DEFINER` passa em 100% dos cenários **sem o RLS ser
consultado**.

> Toda medição de desempenho e todo teste de permissão rodam como
> `authenticated`, com `set local role`. Número tirado como dono não
> vale.

### 2. Não invente regra de negócio

Se não souber, **pergunte ao Emanuel**. Um palpite bem-intencionado que
entra em produção vira dado errado que ninguém percebe.

Corolário: **derive do dado real.** O de/para de grupo de serviço saiu
do cruzamento de dois exports pela WO; a situação de cada código de
baixa saiu de 67.485 linhas do analítico. Faça o mesmo — e diga de onde
veio.

### 3. Zero e desconhecido não são a mesma coisa

Quando o sistema não sabe, ele **diz que não sabe**. Não devolve `0`,
não devolve string vazia, não esconde a linha.

- pontuação sem regra → `NULL` + "sem regra", nunca `0,00`
- foto sem coordenada → etiqueta "sem GPS", não some com a informação
- coordenada sem precisão → mostre a precisão; ±8 m e ±2.000 m contam
  histórias diferentes

Zero é uma **afirmação**. Errá-la custa dinheiro de alguém.

---

## Documentar a decisão E o porquê

Toda decisão de arquitetura, regra de negócio ou armadilha nova entra em
**`docs/03-DECISOES.md`**, numerada, com:

- a **frase do Emanuel** que originou, quando houve;
- o **número medido**, quando houve;
- o que foi **recusado** e por quê — isso vale tanto quanto o que foi
  feito, porque impede que alguém "conserte" o que era deliberado.

Armadilha nova entra em `agent_docs/traps.md` **e** no
`CLAUDE.md` se for do tipo que mata sessão nova.

> Quando você erra porque uma regra estava faltando, isso é sinal de que
> a documentação precisa mudar. **Diga isso** em vez de só consertar.

---

## Relatar honestamente

Este repositório trata o commit como documentação. Então:

- diga o que foi **verificado** e o que **não** foi — "compila" não é
  "funciona";
- se um teste falhou, mostre a saída;
- se você quebrou algo e consertou, registre o defeito, não só o
  conserto. A 061 existe porque a 059 abriu uma função para o `anon`, e
  isso está escrito.

---

## Antes de considerar uma tarefa pronta

1. `npx tsc --noEmit` nos projetos tocados
2. `npm run build` (web) e/ou `npx expo export` (aplicativo)
3. mexeu em RLS/papel/permissão → as duas baterias (`security.md`)
4. mexeu em DDL → `notify pgrst, 'reload schema';`
5. mudou o que a tela faz → **republicou?** (`productivity.md`)
6. decisão nova → `docs/03-DECISOES.md`
