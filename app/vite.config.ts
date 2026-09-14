import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
