// A aba do Portal Técnico da Claro (0.9.0, 222, D-330).
//
// O fundo da extensão lê o sinal antes/depois pela API do portal, com o
// cookie do login da Claro — mas a lista do dia é filtrada pelo login do
// LÍDER, que só a página sabe (fica no "User" do localStorage dela). Este
// script só conta esse login ao fundo. Não lê mais nada, não clica em nada
// e não pede medição nenhuma.

function contarLogin() {
  try {
    const u = JSON.parse(localStorage.getItem('User') || 'null')
    if (!u || typeof u.login !== 'string') return
    chrome.runtime.sendMessage({
      tipo: 'portal-claro-login',
      login: u.login,
      nome: typeof u.name === 'string' ? u.name : null,
    }).catch(() => {})
  } catch { /* página sem login ainda */ }
}

contarLogin()
// quem acabou de entrar no portal grava o "User" depois do carregamento
setInterval(contarLogin, 60_000)
