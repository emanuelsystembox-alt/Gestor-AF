# Gestor AF — AFLINE Manager

Camada operacional de gestão de ordens de serviço da **AFLINE**, prestadora
de serviços da **CLARO** em Manaus.

O sistema recebe a planilha de atividades exportada do **TOA (Oracle Field
Service)** da CLARO, transforma em visitas e ordens de serviço, distribui
para as equipes e recebe a execução do técnico em campo — tudo pelo
navegador, sem aplicativo.

## Como rodar

```bash
cd app
npm install
cp .env.example .env      # já vem com o projeto Supabase preenchido
npm run dev               # http://localhost:5173
```

## Estrutura

```
app/                 front-end (Vite + React + TypeScript + Tailwind v4)
  src/lib/toa.ts     leitor da planilha do TOA
  src/lib/supabase   cliente e domínios
  src/pages/         Login · Controle · Importação · Campo · Visita
docs/                mapeamento, modelo de domínio e log de decisões
supabase/migrations/ schema do banco, em ordem
```

## Conceitos que o código assume

**Uma visita carrega várias O.S.** No TOA, uma Atividade (ida a um endereço)
contém de 1 a 10 ordens de serviço — e o caso mais comum são 2. Deslocamento e
produtividade contam por *visita*; baixa e faturamento contam por *O.S.*
Achatar isso em uma linha por O.S. faz o deslocamento ser contado em dobro.

**A planilha do TOA tem cabeçalhos repetidos.** `Tipo de Atividade` aparece
duas vezes: a primeira é a categoria (`Normal`), a segunda é o tipo real
(`Instalacao`). Um leitor que monte objeto pela chave perde a primeira sem
erro nenhum. Por isso `src/lib/toa.ts` lê **por posição** e sufixa as
repetidas com `__2`.

**O campo vence o TOA.** A planilha sobe várias vezes ao dia. Depois que o
técnico age numa visita, a importação só pode alterar dado cadastral
(endereço, telefone, agendamento). Status, código de baixa, foto e material
passam a ser exclusivos do campo, e toda divergência vira alerta em vez de
sobrescrita.

**A permissão vive no banco.** Row Level Security no Postgres, não na tela.
Se a interface for burlada, o banco não devolve a linha.

**Códigos de baixa são classificados.** Os 166 códigos oficiais da CLARO
ganharam `natureza` (sucesso / improdutiva / cancelamento) e
`responsabilidade` (cliente / rede / operadora / técnico / terceiro) — é o que
permite responder quanto da improdutiva do dia é culpa nossa.

## Documentação

- `docs/01-MAPEAMENTO-DADOS.md` — o que vem do TOA e do sistema atual
- `docs/02-MODELO-DOMINIO.md` — entidades e máquina de estados
- `docs/03-DECISOES.md` — **log de decisões**, com o porquê de cada uma
- `supabase/README.md` — ordem das migrations e conferências

## Dados de cliente

Planilhas (`*.xlsx`, `*.csv`) estão no `.gitignore`. Nome, telefone e endereço
de assinante não entram no repositório.
