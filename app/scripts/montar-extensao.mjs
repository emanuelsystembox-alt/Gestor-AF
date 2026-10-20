// Monta a extensão do TOA (D-193) a partir do código da web:
//   app/extensao/fundo.ts  → extensao-toa/fundo.js
//   app/extensao/popup.ts  → extensao-toa/popup.js
//
// Usa o esbuild que já vem com o Vite. O endereço do Supabase e a chave
// PUBLISHABLE saem do app/.env — a mesma que vai no site (security.md: ela
// não dá acesso a nada sozinha; quem protege é o RLS). A service_role
// NUNCA entra aqui.
//
// Rodar (de app/):  npm run extensao
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const app = resolve(aqui, '..')
const destino = resolve(app, '..', 'extensao-toa')

const env = Object.fromEntries(
  readFileSync(resolve(app, '.env'), 'utf8').split(/\r?\n/)
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const url = env.VITE_SUPABASE_URL, chave = env.VITE_SUPABASE_ANON_KEY
if (!url || !chave) throw new Error('Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em app/.env')
if (/service_role|sb_secret_/i.test(chave)) throw new Error('A chave do .env não é a publishable — recusado.')

const comum = {
  bundle: true, format: 'iife', target: 'chrome116', minify: true, legalComments: 'none',
  define: { __SUPABASE_URL__: JSON.stringify(url), __SUPABASE_KEY__: JSON.stringify(chave) },
  banner: { js: '// GERADO por app/scripts/montar-extensao.mjs — não edite à mão. Fonte: app/extensao/' },
  logLevel: 'info',
}
await build({ ...comum, entryPoints: [resolve(app, 'extensao/fundo.ts')], outfile: resolve(destino, 'fundo.js') })
await build({ ...comum, entryPoints: [resolve(app, 'extensao/popup.ts')], outfile: resolve(destino, 'popup.js') })
