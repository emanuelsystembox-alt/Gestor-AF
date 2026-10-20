import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// ┌─ a versão que está no ar (Emanuel, 20/10: "crie um controle de versão na
// │  lateral"). Carimbada NO BUILD, sem ninguém lembrar de mudar número:
// │  v<major.minor do package.json>.<nº de commits> + o commit + a hora.
// │  "sujo" = o build saiu com mudança não commitada (o deploy usa
// │  --commit-dirty), e a dica da lateral avisa. Sem git (ex.: pasta copiada),
// │  diz "sem git" em vez de inventar número.
// └──────────────────────────────────────────────────────────────────────────
function git(cmd: string): string {
  try { return execSync(cmd, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return '' }
}
const pacote = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
const [maior, menor] = pacote.version.split('.')
const commits = git('git rev-list --count HEAD')
const VERSAO = {
  numero: commits ? `${maior}.${menor}.${commits}` : `${pacote.version} (sem git)`,
  commit: git('git rev-parse --short HEAD') || null,
  sujo: git('git status --porcelain -- .') !== '',
  em: new Date().toISOString(),
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __VERSAO__: JSON.stringify(VERSAO) },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // A porta continua sendo a 5173 no dia a dia -- e a que esta na
  // documentacao e a que todo mundo digita. Mas ela deixa de ser
  // IMPOSTA: quem chamar com PORT no ambiente manda. Sem isso, uma
  // segunda instancia (outra sessao, outro agente) morre na largada
  // com "port in use", e nao ha nada aqui que exija a 5173 -- o
  // Supabase nao usa redirect de OAuth (`detectSessionInUrl: false`)
  // nem lista de origens.
  server: { port: Number(process.env.PORT) || 5173 },
})
