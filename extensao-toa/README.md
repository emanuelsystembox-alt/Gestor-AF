# AFLINE — ponte com o TOA

Extensão do Chrome usada pelo **Sincronismo** (migrations 111 e 113, D-189).
Ela faz uma coisa só: a mesma chamada do botão **Ações › Exportar** do
Console de Alocação do TOA, com a sessão do TOA que já está aberta naquele
Chrome, e entrega a planilha à tela Sincronismo do Gestor AF.

Por que existe: o navegador proíbe um site de usar o login de outro. A tela
do Gestor AF não consegue baixar do TOA sozinha; a extensão tem permissão
para o endereço do TOA e consegue.

**Ela não altera nada no TOA**, não guarda senha e não fala com nenhum
outro endereço.

## Sincronizar pelo seu computador

Qualquer pessoa que importa à mão (gestão ou controlador) pode — com o
**próprio login**, no Gestor AF e no TOA:

1. abra `chrome://extensions`, ligue o **Modo do desenvolvedor**;
2. **Carregar sem compactação** → escolha esta pasta `extensao-toa`;
3. entre no TOA (`https://clarobrasil.fs.ocs.oraclecloud.com`) nesse Chrome;
4. no Gestor AF, abra **Operação › Sincronismo** e clique em
   **Sincronizar por este computador**.

A importação entra em seu nome. Deixe a aba do Gestor AF aberta e à frente,
e o computador sem suspender (Windows › Energia › "Nunca").

**Um computador sincroniza por vez** — dois importariam tudo em dobro. Se
outro já estiver sincronizando, o seu fica **de reserva** e assume sozinho
se o outro parar por 3 minutos (ou na hora, com **Assumir agora**).
**Parar neste computador** devolve a vez.

Cuidado com o login do TOA: entrar com o mesmo usuário do TOA em outro
navegador **derruba** a sessão anterior (testado em 19/10). Se isso
acontecer, a tela de todo mundo mostra "a sessão do TOA caiu".

## PC dedicado (opcional)

Quem quiser um computador só para isso, sem o login de uma pessoa, pode
criar em Administração › Novo usuário um login com o perfil
**Robo de sincronismo** — ele só importa, não vê nem mexe em contrato.
Não é obrigatório.

## Atualizar

Depois de mudar um arquivo daqui, em `chrome://extensions` clique em
**recarregar** na extensão e recarregue a aba do Gestor AF.
