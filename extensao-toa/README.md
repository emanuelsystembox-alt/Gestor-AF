# AFLINE — ponte com o TOA (0.4.0)

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
3. Marque **"Sincronizar por este computador"**. A janelinha diz em uma frase
   como está: sincronizando, de reserva (outro computador está com a vez), a
   sessão do TOA caiu, ou desligado no Gestor AF.
4. Quem opera liga o sincronismo e escolhe buckets e intervalos em
   **Gestor AF › Operação › Sincronismo** (lá também fica o histórico de cada
   rodada, com sucesso ou falha).

**Para a varredura:** clique em **"Abrir a janela da varredura"** no painel.
Abre o TOA numa **janela só dela**; deixe-a no **Console de Alocação**, no
bucket e no dia de hoje. A extensão abre cada contrato por ela (uns 9 s cada),
e **você navega à vontade na outra janela**. Use **"Varrer o TOA agora"**, ou a
rodada automática configurada no Gestor AF. A % aparece no ícone.

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
