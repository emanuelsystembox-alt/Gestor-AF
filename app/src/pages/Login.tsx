import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { Alerta, Marca } from '../components/ui'

export default function Login() {
  const { session } = useAuth()
  const local = useLocation() as { state?: { de?: string } }
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (session) return <Navigate to={local.state?.de ?? '/'} replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEnviando(false)
    if (error) {
      // Mensagem genérica de propósito: dizer "e-mail não existe" entrega
      // a quem tenta adivinhar quais contas existem.
      setErro('E-mail ou senha incorretos.')
    }
  }

  return (
    <main className="sup-controle relative grid min-h-screen place-items-center px-4">
      {/* brilho vermelho discreto ao fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(60rem 32rem at 50% -12%, rgba(228,38,47,0.16), transparent 62%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3">
          <Marca />
          <p className="text-sm text-graf-400">Gestão de campo · CLARO Manaus</p>
        </div>

        <form onSubmit={entrar} className="card-controle space-y-4 p-6">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-graf-300">
              E-mail
            </label>
            <input
              id="email" type="email" required autoComplete="username"
              autoFocus value={email} onChange={e => setEmail(e.target.value)}
              className="toque w-full rounded-lg border border-graf-700 bg-graf-900 px-3
                         text-graf-100 placeholder-graf-500 outline-none
                         focus:border-af-500"
              placeholder="voce@afline.com.br"
            />
          </div>

          <div>
            <label htmlFor="senha" className="mb-1.5 block text-xs font-medium text-graf-300">
              Senha
            </label>
            <input
              id="senha" type="password" required autoComplete="current-password"
              value={senha} onChange={e => setSenha(e.target.value)}
              className="toque w-full rounded-lg border border-graf-700 bg-graf-900 px-3
                         text-graf-100 outline-none focus:border-af-500"
              placeholder="••••••••"
            />
          </div>

          {erro && <Alerta tipo="erro">{erro}</Alerta>}

          <button
            type="submit" disabled={enviando}
            className="toque w-full rounded-lg bg-af-600 font-semibold text-white
                       transition hover:bg-af-500 disabled:opacity-50"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-graf-500">
          Acesso restrito. Cada ação fica registrada com o seu nome.
        </p>
      </div>
    </main>
  )
}
