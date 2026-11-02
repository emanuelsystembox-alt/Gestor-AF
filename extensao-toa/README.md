# AFLINE — ponte com o TOA (0.8.0)

Extensão do Chrome que **sincroniza o Gestor AF com o TOA sozinha**
(D-189, D-192, D-193):

- **Baixa:** a cada 5/10/15/30/60 min, baixa a planilha de Atividades de cada
  bucket marcado (a mesma chamada do botão Exportar do TOA) e importa, pelo
  mesmo caminho da importação manual.
- **Varredura:** pelas telas do TOA, lê de cada contrato o **nome do cliente**,
  o **equipamento instalado e retirado** e a **miscelânea**, e grava no
  contrato — só como registro, sem mexer no estoque.

Funciona **com a tela do Gestor AF fechada**: basta o Chrome aberto, logado no
TOA. **Ela não altera nada no TOA** e não guarda a sua senha.

> **Vai mexer na extensão?** Como ela funciona, as regras que não se quebram e
> como acrescentar uma ação estão em
> [`docs/11-EXTENSAO-TOA.md`](../docs/11-EXTENSAO-TOA.md). `fundo.js` e
> `popup.js` são **gerados** de `app/extensao/` — não edite os `.js` à mão.

## Instalar (uma vez por computador)

1. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor** (canto
   superior direito).
2. **Carregar sem compactação** → escolha esta pasta `extensao-toa`.
3. Fixe o ícone (o quebra-cabeça da barra do Chrome → alfinete em "AFLINE").
   Clicar nele abre o **painel lateral**, que fica fixo ao lado da página
   enquanto você navega.

## Usar

1. **Entre no TOA** neste Chrome, com o seu login.
2. **Clique no ícone da extensão** (abre o painel lateral) → entre com o seu **e-mail e senha do
   Gestor AF**. A extensão guarda só a sessão, como o navegador faz no site.
3. Clique em **"Atualizar a lista"** (com o TOA aberto numa aba): aparecem os
   **buckets do seu login** — os que a árvore do TOA mostra e que são de cidades
   que você acessa no PulsoLine (o ADMIN vê todas). Marque os que este computador
   sincroniza e escolha os tempos: **rota a cada 5, 15, 30 ou 60 min** e
   **varredura a cada 5, 15, 30 ou 60 min, ou só no botão** (0.8.0, D-251).
4. Marque **"Sincronizar por este computador"**. Cada bucket é sincronizado por um
   computador por vez: o painel mostra "este computador", "com Fulano" ou "livre".
   Em **PulsoLine › Operação › Sincronismo** se acompanha quem sincroniza cada
   bucket e o histórico de cada rodada.

**Para a varredura (0.7.0):** basta o **TOA logado numa aba deste Chrome**, em
qualquer tela — pode ficar escondida ou minimizada. A varredura **pede os dados
direto ao TOA** (uma chamada por bucket e uma por técnico, D-250): o bucket inteiro
em menos de um segundo, sem abrir contrato por contrato. Sem aba do TOA, a extensão
abre uma, fixada e ao fundo (se pedir login, entre nela). O que não vier direto é
lido pelas telas, do jeito antigo abaixo — só isso precisa do Console à vista.

**A leitura pelas telas (a reserva):** clique em **"Abrir a janela da varredura"** no painel.
Abre o TOA numa **janela só dela**; deixe-a no **Console de Alocação**, no dia
de hoje, com a **lista de buckets (a árvore à esquerda) à vista**: desde a 0.5.0
a varredura **troca de bucket sozinha** — abre MAN-AFLINE, depois
MAN-AFLINE_01_VT, e no fim volta ao que estava. A extensão abre cada contrato
por ela (uns 9 s cada),
e **você navega à vontade na outra janela**. Use **"Varrer o TOA agora"**, ou a
rodada automática configurada no Gestor AF. A % aparece no ícone.

**O que varrer (0.6.0):** no painel, marque os **buckets** (cada um mostra quanto
falta: sem nome · equipamento) e o que **ler** — nome e equipamento, só o nome,
ou só equipamento e material dos encerrados. A escolha vale para o "Varrer
agora" e para a rodada automática deste computador. A varredura **começa pelo
bucket que estiver aberto no Console**: abra a VT para começar por ela.

O Chrome não desenha uma tela escondida, e a varredura pilota as telas do TOA:
a janela da varredura **não pode ser minimizada**. Se ela ficar escondida, a
varredura **pausa** (ícone "II") e continua sozinha quando a janela aparece.

**Para poder cobrir a janela da varredura com outras (opcional, uma vez):** no
Windows, o Chrome também trata como escondida uma janela totalmente coberta.
Para desligar isso no computador que sincroniza: botão direito no atalho do
Chrome → **Propriedades** → em **Destino**, depois de `chrome.exe"`, acrescente
um espaço e `--disable-backgrounding-occluded-windows` → OK. Feche **todas** as
janelas do Chrome e abra pelo atalho. (Minimizar continua pausando.)

**Um computador sincroniza por vez** — dois importariam em dobro. Se outro já
estiver, este fica de reserva e assume sozinho se o outro parar por 3 minutos
(ou na hora, com **Assumir a vez**).

**Cuidado com o login do TOA:** entrar com o mesmo usuário do TOA em outro
navegador **derruba** a sessão deste (testado em 19/10). A janelinha e o
ícone (um "!") avisam quando a sessão cai.

## Atualizar

Quando o projeto trouxer uma versão nova: em `chrome://extensions` clique em
**recarregar** (↻) na extensão e recarregue a aba do TOA (F5). O login no
Gestor AF continua.

## Montar (quem desenvolve)

```powershell
cd app
npm run tsc:extensao
npm run extensao
```
