import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { INDICADORES_ENTRADA, type IndicadoresEntrada } from '../lib/entrada'

/**
 * A entrada do sistema — o design "Entrada Gestor AF" (Claude Design) que o
 * Emanuel mandou em 27/09, com as correções dele:
 *
 * > "agora vamos mudar o norte, vamos colocar todo o brasil"
 * > "area técnico vamos colocar [a foto do time] e tirar a parte do
 * >  coordenador da entrada"
 *
 * ┌─ O QUE MUDOU DO DESENHO, DE PROPÓSITO (D-175) ────────────────────┐
 * │ NÚMEROS: vêm de `lib/entrada.ts` — ilustrativos, por decisão do   │
 * │   Emanuel, com a fonte escrita na tela. Bloco sem número some.    │
 * │ ABERTURA: 10 s de animação toda vez que o COP entra é castigo.    │
 * │   Roda UMA vez por navegador; "Ver abertura" repete; quem pede    │
 * │   menos movimento no sistema não a vê.                             │
 * │ LOGIN: o do desenho era de mentira (sempre "Acesso liberado").    │
 * │   Aqui é o Supabase de verdade, com a mensagem genérica de erro.  │
 * │ "Esqueci minha senha": diz quem troca (a Administração), em vez   │
 * │   de prometer um e-mail que o sistema não envia (D-173).           │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ NEXUS MANAGER (Emanuel, 30/10 — D-242) ──────────────────────────┐
 * │ > "agora não será mais Gestor AF, prestador de serviço CLARO. vai │
 * │ >  ser NEXUS MANAGER, tem que ter sim agora a logo da AFLINE por  │
 * │ >  que ela que esta financiando o sistema"                         │
 * │ O letreiro NEXUS / MANAGER é o título da página (o h1). A AFLINE  │
 * │ assina em cima: o AF com "16 anos conectando vidas." (que era o   │
 * │ título) e "Conectados com o futuro." — a história e o rumo. Sem   │
 * │ "uma iniciativa AFLINE", que o Emanuel tirou (o logo já diz de    │
 * │ quem é). Azul (Nexus) + vermelho                                   │
 * │ (AFLINE) são o par do logo; a rede do fundo pulsa nas duas cores.  │
 * │ Saíram, a pedido: o cartão "Fibra no Brasil" (os 27 estados) e a   │
 * │ chamada "Do Oiapoque ao Chuí", trocada por uma de velocidade.      │
 * └────────────────────────────────────────────────────────────────────┘
 */

const ABERTURA_VISTA = 'entrada:abertura-vista'

/** O par do logo: o azul do Nexus encontra o vermelho da AFLINE. */
const AZUL = ['#4f9bff', '#1d5fbf'] as const
const VERMELHO = ['#ff4d58', '#c10f1b'] as const

const FRASES_DA_ABERTURA: [string, string][] = [
  ['Mais clientes ', 'conectados.'],
  ['Mais clientes ', 'felizes.'],
  ['Fibra chegando a todo o ', 'Brasil.'],
  ['Graças a quem está em ', 'campo.'],
]

const CHAMADAS = [
  'A fibra chega. O sorriso fica.',
  'Cada O.S. fechada é uma família conectada.',
  'Na velocidade da fibra, do despacho à baixa.',
  'Qualidade que se mede. Cuidado que se sente.',
]

const menosMovimento = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function lerVista(): boolean {
  try { return localStorage.getItem(ABERTURA_VISTA) === '1' } catch { return true }
}
function marcarVista() {
  try { localStorage.setItem(ABERTURA_VISTA, '1') } catch { /* navegador sem armazenamento */ }
}

const subir = (on: boolean, atraso = 0, extra = '') => ({
  opacity: on ? 1 : 0,
  transform: on ? 'translateY(0)' + extra : 'translateY(28px)',
  transition: `opacity .9s ease ${atraso}s, transform 1.1s cubic-bezier(.2,.8,.2,1) ${atraso}s`,
})

export default function Login() {
  const { session } = useAuth()
  const local = useLocation() as { state?: { de?: string } }
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [esqueci, setEsqueci] = useState(false)

  // A abertura: só na primeira visita deste navegador.
  const [abertura, setAbertura] = useState(() => !lerVista() && !menosMovimento())
  const [pronto, setPronto] = useState(!abertura)
  // A tela aparece ENQUANTO a abertura some (sem o segundo de tela vazia
  // entre as duas); a abertura sai de cena quando terminou de sumir.
  const revelar = useCallback(() => { marcarVista(); setPronto(true) }, [])
  const fecharAbertura = useCallback(() => { revelar(); setAbertura(false) }, [revelar])

  if (session) return <Navigate to={local.state?.de ?? '/'} replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setEnviando(false)
    // Mensagem genérica de propósito: dizer "e-mail não existe" entrega a
    // quem tenta adivinhar quais contas existem.
    if (error) setErro('E-mail ou senha incorretos.')
  }

  const ind = INDICADORES_ENTRADA
  const campo = 'h-14 w-full rounded-[14px] border border-[#e1e5ef] bg-[#f1f4fa] px-[18px] ' +
                'text-base text-[#0e0f14] outline-none transition placeholder:text-[#9aa1b3] ' +
                'focus:border-[#e8212e] focus:bg-white focus:ring-4 focus:ring-[#e8212e]/12'
  const rotulo = 'text-xs font-semibold tracking-[.14em] text-[#2a2f3d]'

  return (
    <main className="entrada relative min-h-screen w-full overflow-hidden bg-[#f6f7fb] text-[#0e0f14]">
      <Constelacao />
      {/* Dois brilhos, um de cada cor da marca: o vermelho da AFLINE à
          direita (onde sempre esteve) e o azul do Nexus atrás do letreiro. */}
      <div aria-hidden className="pointer-events-none absolute right-[-10vw] top-[-20vw] h-[60vw] w-[60vw]
                                  rounded-full"
        style={{ background: 'radial-gradient(closest-side,rgba(232,33,46,.10),rgba(232,33,46,0))' }} />
      <div aria-hidden className="pointer-events-none absolute left-[-18vw] top-[2vw] h-[56vw] w-[56vw]
                                  rounded-full"
        style={{ background: 'radial-gradient(closest-side,rgba(29,95,191,.10),rgba(29,95,191,0))' }} />

      {/* ================= 01 · entrar ================= */}
      <section className="relative mx-auto grid min-h-screen max-w-[1320px] items-center gap-16
                          px-4 py-12 sm:px-10 lg:grid-cols-2 lg:gap-[72px] lg:py-14">

        {/* ---- quem financia, o nome do sistema, a frase e as fotos ---- */}
        <div className="flex flex-col gap-7">
          <div className="flex items-center gap-4" style={subir(pronto)}>
            <SeloAFLINE largura={84} />
            {/* Sem "uma iniciativa AFLINE": o logo já diz de quem é. As duas
                frases juntas, a história e o rumo (Emanuel, 30/10). */}
            <span className="entrada-titulo flex flex-col gap-1 border-l border-[#dde0ea] pl-4 leading-tight">
              <span className="text-[17px] font-bold text-[#1b1e27]">
                <span className="font-black italic text-[#d4121f]">16 anos</span> conectando vidas.
              </span>
              <span className="text-[15px] font-semibold text-[#4a5064]">Conectados com o futuro.</span>
            </span>
          </div>

          <div className="flex flex-col gap-4" style={subir(pronto, .12)}>
            {/* aria-label: as duas palavras são blocos, e o leitor de tela
                juntaria em "NEXUSMANAGER". */}
            <h1 aria-label="Nexus Manager" className="m-0 flex items-center gap-[clamp(14px,1.6vw,24px)]">
              <SimboloNexus largura="clamp(78px,8.6vw,124px)" />
              <LetreiroNexus />
            </h1>
            <span className="entrada-titulo flex items-center gap-3 text-xs font-semibold
                             tracking-[.18em] text-[#4a5064] sm:text-sm sm:tracking-[.3em]">
              <span aria-hidden className="h-[2px] w-7 flex-none rounded-sm"
                style={{ background: `linear-gradient(90deg,${AZUL[1]},${VERMELHO[1]})` }} />
              SISTEMA DE GESTÃO INTELIGENTE
            </span>
          </div>

          <div style={subir(pronto, .24)}><Chamadas /></div>

          {/* As fotos: o time de verdade (Emanuel, 27/09). A de coordenação
              saiu; técnico desconhecido de banco de imagem, também. */}
          <div className="flex flex-wrap gap-4" style={subir(pronto, .36)}>
            <figure className="m-0 flex w-full max-w-[330px] flex-col gap-2.5">
              <div className="h-[190px] overflow-hidden rounded-[22px]
                              shadow-[0_20px_40px_-18px_rgba(14,15,20,.35)]"
                style={{ animation: menosMovimento() ? undefined : 'afFlutua 7s ease-in-out infinite' }}>
                <img src="/entrada/time-de-campo.webp" alt="O time de campo da AFLINE reunido"
                  className="h-full w-full object-cover" style={{ objectPosition: '42% 45%' }}
                  loading="eager" />
              </div>
              <figcaption className="text-[13px] font-semibold text-[#2a2f3d]">
                Nosso time de campo
              </figcaption>
            </figure>
            <figure className="m-0 mt-7 flex w-[150px] flex-col gap-2.5">
              <div className="h-[190px] overflow-hidden rounded-[22px]
                              shadow-[0_20px_40px_-18px_rgba(14,15,20,.35)]"
                style={{ animation: menosMovimento() ? undefined : 'afFlutua 7.5s ease-in-out -4s infinite' }}>
                <img alt="Cliente conectado em casa" className="h-full w-full object-cover"
                  src="https://images.unsplash.com/photo-1758598738092-a7cd486baadd?fm=jpg&q=70&w=600&auto=format&fit=crop"
                  title="Foto: Vitaly Gariev / Unsplash" loading="lazy" referrerPolicy="no-referrer" />
              </div>
              <figcaption className="text-[13px] font-semibold text-[#2a2f3d]">Cliente conectado</figcaption>
            </figure>
          </div>
        </div>

        {/* ---- o cartão de entrar, com os cartões que flutuam ---- */}
        <div className="relative flex flex-col items-center gap-5 lg:py-10">
          {/* Alto o bastante para pousar só na margem de cima do cartão:
              mais baixo, ele tampava o "NEXUS MANAGER" do topo do formulário
              (mais largo que o antigo "GESTOR AF"). */}
          {ind?.clientes && (
            <div className="z-[2] hidden lg:absolute lg:-left-2.5 lg:-top-20 lg:block" style={subir(pronto, .6)}>
              <CartaoClientes c={ind.clientes} />
            </div>
          )}

          <form onSubmit={entrar} style={{ ...subir(pronto, .45), transform: pronto ? 'none' : 'translateY(40px) scale(.96)' }}
            className="relative z-[1] flex w-full max-w-[440px] flex-col gap-[22px] rounded-[28px] bg-white
                       px-7 pb-9 pt-12 shadow-[0_40px_90px_-40px_rgba(14,15,20,.35),0_0_0_1px_rgba(14,15,20,.04)]
                       sm:px-11">
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="entrada-titulo flex items-center gap-2 text-xs font-extrabold tracking-[.28em]
                               text-[#1d5fbf]">
                <SimboloNexus largura={22} parado />
                NEXUS MANAGER
              </span>
              <h2 className="entrada-titulo m-0 text-[34px] font-extrabold tracking-[-.01em]">Entrar</h2>
              <span className="text-base text-[#5b6275]">Acesse com seu e-mail e senha</span>
            </div>

            <label className="flex flex-col gap-2">
              <span className={rotulo}>E-MAIL</span>
              <input type="email" required autoComplete="username" autoFocus={!abertura}
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="voce@grupoafline.com.br" className={campo} />
            </label>

            <label className="flex flex-col gap-2">
              <span className={rotulo}>SENHA</span>
              <span className="relative flex">
                <input type={verSenha ? 'text' : 'password'} required autoComplete="current-password"
                  value={senha} onChange={e => setSenha(e.target.value)}
                  placeholder="••••••••" className={`${campo} pr-[86px]`} />
                <button type="button" onClick={() => setVerSenha(x => !x)}
                  aria-label={verSenha ? 'Ocultar a senha' : 'Mostrar a senha'}
                  className="absolute right-2 top-2 h-10 rounded-[10px] px-3 text-[13px] font-semibold
                             text-[#5b6275] hover:bg-[#e7ebf3]">
                  {verSenha ? 'Ocultar' : 'Mostrar'}
                </button>
              </span>
            </label>

            {erro && (
              <p role="alert" className="m-0 rounded-xl border border-[#f5c2c5] bg-[#fef2f3] px-3 py-2
                                         text-sm text-[#b3141d]">
                {erro}
              </p>
            )}

            <button type="submit" disabled={enviando}
              className="entrada-titulo h-[58px] rounded-2xl text-lg font-semibold text-white transition
                         hover:-translate-y-px active:translate-y-px active:scale-[.99] disabled:opacity-70"
              style={{
                background: 'linear-gradient(180deg,#ee2a36,#c10f1b)',
                boxShadow: '0 18px 30px -14px rgba(212,18,31,.7)',
              }}>
              {enviando ? 'Verificando…' : 'Entrar'}
            </button>

            <div className="text-center">
              <button type="button" onClick={() => setEsqueci(x => !x)} aria-expanded={esqueci}
                className="text-[15px] font-medium text-[#2a2f3d] hover:text-[#d4121f]">
                Esqueci minha senha
              </button>
              {esqueci && (
                <p className="mx-auto mb-0 mt-2 max-w-xs text-[13px] leading-snug text-[#5b6275]">
                  A senha é trocada pela <strong className="text-[#2a2f3d]">Administração</strong> do
                  sistema. Fale com o COP ou com o administrador da sua base.
                </p>
              )}
            </div>

            <div className="border-t border-[#eceef4] pt-[18px] text-center text-sm leading-normal text-[#6b7285]">
              Acesso restrito. Cada ação fica registrada com o seu nome.
            </div>
          </form>
        </div>
      </section>

      {/* ================= 02 · qualidade (só com número real) ================= */}
      {ind && (ind.satisfacao || ind.qualidadeTecnica || ind.nps) && <SecaoQualidade ind={ind} />}

      {!abertura && pronto && !menosMovimento() && (
        <button type="button" onClick={() => { window.scrollTo(0, 0); setPronto(false); setAbertura(true) }}
          className="fixed bottom-[22px] left-6 z-[5] hidden h-9 items-center gap-2 whitespace-nowrap rounded-full
                     border border-[#e1e5ef] bg-white/80 px-3.5 text-[13px] font-semibold text-[#2a2f3d]
                     hover:bg-white sm:flex">
          <span className="h-0 w-0 border-y-[5px] border-l-8 border-y-transparent border-l-[#d4121f]" />
          Ver abertura
        </button>
      )}

      {abertura && <Abertura ind={ind} aoRevelar={revelar} aoTerminar={fecharAbertura} />}
    </main>
  )
}

// ---------------------------------------------------------------------------
// as peças
// ---------------------------------------------------------------------------

/** O AF do desenho (polígonos), com o "LINE" em Exo 2 fina. */
function MarcaAF({ largura, cor = ['#ff4d58', '#c10f1b'], line = '#d4121f', estilo }: {
  largura: number | string; cor?: [string, string]; line?: string
  estilo?: (i: number) => React.CSSProperties
}) {
  const id = useRef(`af${Math.random().toString(36).slice(2, 8)}`).current
  const partes = ['4,106 22,106 54,8 48,0', '55,0 95,0 140,135 100,135',
                  '95,0 194,0 180,32 105.7,32', '112.3,52 166,52 156,76 120.3,76']
  return (
    <svg viewBox="0 0 196 140" role="img" aria-label="AFLINE" className="shrink-0 overflow-visible"
      style={{ width: largura, height: 'auto', filter: 'drop-shadow(0 18px 30px rgba(212,18,31,.25))',
               transition: 'width 1.2s cubic-bezier(.7,0,.3,1)' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={cor[0]} /><stop offset="1" stopColor={cor[1]} />
        </linearGradient>
      </defs>
      {partes.map((p, i) => <polygon key={p} points={p} fill={`url(#${id})`} style={estilo?.(i)} />)}
      <text x="0" y="134" fontFamily="'Exo 2'" fontStyle="italic" fontWeight={300} fontSize={30}
        letterSpacing={3} fill={line} style={estilo?.(4)}>LINE</text>
    </svg>
  )
}

/**
 * O selo original da AFLINE: o AF vermelho num círculo grafite, com o LINE
 * em branco e o traço embaixo (Emanuel, 30/10: "incluir o simbolo original
 * da afline onde esta AF quase apagado"). O AF solto, com o LINE vermelho
 * fino sobre o fundo claro, sumia; no círculo escuro ele tem contraste.
 * Os traços do AF são os mesmos do ícone da aba (`public/favicon.svg`).
 * Redesenhado em SVG, e não a foto: nítido em qualquer tamanho.
 */
function SeloAFLINE({ largura }: { largura: number | string }) {
  const id = useRef(`sl${Math.random().toString(36).slice(2, 8)}`).current
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="AFLINE" className="shrink-0"
      style={{ width: largura, height: 'auto', filter: 'drop-shadow(0 16px 26px rgba(14,15,20,.28))' }}>
      <defs>
        <radialGradient id={`${id}f`} cx=".68" cy=".22" r=".95">
          <stop offset="0" stopColor="#4a4f5b" /><stop offset=".55" stopColor="#2b2f38" />
          <stop offset="1" stopColor="#17191f" />
        </radialGradient>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4a54" /><stop offset="1" stopColor="#c81a23" />
        </linearGradient>
      </defs>
      <circle cx={100} cy={100} r={98} fill={`url(#${id}f)`} />
      {/* o brilho do selo, como no original */}
      <ellipse cx={128} cy={46} rx={58} ry={26} fill="#fff" opacity={.06} transform="rotate(28 128 46)" />
      <g fill={`url(#${id}a)`} transform="translate(12 -4) scale(.42)">
        <path d="M142 136 L152 136 L127 296 L76 296 Z" />
        <path d="M154 121 L371 121 L358 164.5 L228 164.5 L236 187 L321 187 L308 226 L249 226 L288 338 L229 338 Z" />
      </g>
      <text x={40} y={154} fontFamily="'Exo 2'" fontStyle="italic" fontWeight={300} fontSize={31}
        letterSpacing={3} fill="#fff">LINE</text>
      <path d="M37 160 H118" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" opacity={.9} />
    </svg>
  )
}

/** As chamadas que se revezam embaixo do título. */
function Chamadas() {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (menosMovimento()) return
    const t = setInterval(() => setI(x => (x + 1) % CHAMADAS.length), 3800)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="relative h-16 max-w-[560px]" aria-live="off">
      {CHAMADAS.map((t, k) => (
        <p key={t} className="entrada-titulo absolute inset-0 m-0 flex items-center gap-3.5 font-semibold
                              leading-tight text-[#2a2f3d]"
          style={{
            fontSize: 'clamp(20px,1.9vw,26px)',
            opacity: i === k ? 1 : 0, filter: `blur(${i === k ? 0 : 8}px)`,
            transform: i === k ? 'translateY(0)' : 'translateY(14px)',
            transition: 'opacity .7s ease, filter .7s ease, transform .9s cubic-bezier(.2,.8,.2,1)',
          }}
          aria-hidden={i !== k}>
          <span className="h-[3px] w-7 flex-none rounded-sm bg-[#e8212e]" />
          <span>{t}</span>
        </p>
      ))}
    </div>
  )
}

const vidro = 'rounded-[18px] border border-white/90 bg-white/85 backdrop-blur-[14px] ' +
              'shadow-[0_24px_50px_-24px_rgba(14,15,20,.35)]'

/**
 * O símbolo do Nexus: duas órbitas que se cruzam — a azul (Nexus) e a
 * vermelha (AFLINE) — em volta de um núcleo com o N. É o átomo do logo,
 * sem o robô: em 22 px um robô vira borrão, a órbita continua legível.
 * O sinal correndo em cada órbita é a "velocidade"; para quem pede menos
 * movimento (ou `parado`), as órbitas ficam e o sinal não corre.
 */
function SimboloNexus({ largura, parado = false }: { largura: number | string; parado?: boolean }) {
  const id = useRef(`nx${Math.random().toString(36).slice(2, 8)}`).current
  const corre = !parado && !menosMovimento()
  // A elipse como caminho, para o sinal andar por cima dela.
  const orbita = 'M4 50 a46 17 0 1 0 92 0 a46 17 0 1 0 -92 0'
  const orbitas = [
    { giro: -32, cor: `${id}a`, sinal: '#9cc8ff', dur: '3.2s' },
    { giro: 32, cor: `${id}v`, sinal: '#ffb3b8', dur: '3.8s' },
  ]
  return (
    <svg viewBox="0 0 100 100" aria-hidden className="shrink-0 overflow-visible"
      style={{ width: largura, height: 'auto', filter: 'drop-shadow(0 14px 22px rgba(29,95,191,.22))' }}>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={AZUL[0]} /><stop offset="1" stopColor={AZUL[1]} />
        </linearGradient>
        <linearGradient id={`${id}v`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={VERMELHO[0]} /><stop offset="1" stopColor={VERMELHO[1]} />
        </linearGradient>
        <radialGradient id={`${id}n`} cx=".35" cy=".3" r=".9">
          <stop offset="0" stopColor="#3a4052" /><stop offset="1" stopColor="#12141b" />
        </radialGradient>
      </defs>
      {orbitas.map(o => (
        <g key={o.giro} transform={`rotate(${o.giro} 50 50)`}>
          <path d={orbita} fill="none" stroke={`url(#${o.cor})`} strokeWidth={5.5} />
          {corre && (
            <circle r={3.4} fill={o.sinal}>
              <animateMotion dur={o.dur} repeatCount="indefinite" path={orbita} />
            </circle>
          )}
        </g>
      ))}
      <circle cx={50} cy={50} r={18} fill={`url(#${id}n)`} stroke="#fff" strokeWidth={2.5} />
      <path d="M42.5 58.5V41.5h4l7 10.6V41.5h4v17h-4l-7-10.6v10.6z" fill="#fff" />
    </svg>
  )
}

/**
 * O letreiro: NEXUS no degradê do logo (o "NE" azul, o "X" na virada, o
 * "US" vermelho) e MANAGER em grafite, espaçado para fechar a largura do
 * NEXUS. Texto de verdade, não imagem: é o h1 da página, e é o que o
 * leitor de tela anuncia.
 */
function LetreiroNexus({ escuro = false }: { escuro?: boolean }) {
  return (
    <span className="entrada-titulo flex flex-col">
      <span className="font-extrabold leading-[.88] tracking-[.02em] text-transparent"
        style={{
          fontSize: 'clamp(54px,7.2vw,104px)',
          // No claro, o meio do degradê escurece: #4f9bff e #ff4d58 sobre o
          // fundo #f6f7fb ficam abaixo de 3:1 (o piso da AA para texto grande).
          // backgroundImage, não `background`: o atalho junto do backgroundClip
          // faz o React avisar (e pode perder o recorte) ao redesenhar.
          backgroundImage: escuro
            ? `linear-gradient(90deg,${AZUL[0]} 0%,${AZUL[0]} 36%,${VERMELHO[0]} 58%,${VERMELHO[0]} 100%)`
            : `linear-gradient(90deg,${AZUL[1]} 0%,#2b78d8 36%,#e8212e 58%,${VERMELHO[1]} 100%)`,
          WebkitBackgroundClip: 'text', backgroundClip: 'text',
        }}>
        NEXUS
      </span>
      <span className="font-semibold leading-none"
        style={{ fontSize: 'clamp(21px,2.75vw,40px)', letterSpacing: '.36em',
                 color: escuro ? '#e9ebf1' : '#1b1e27', marginTop: '.18em' }}>
        MANAGER
      </span>
    </span>
  )
}

/** Clientes conectados — só existe com o número real (lib/entrada.ts). */
function CartaoClientes({ c }: { c: NonNullable<IndicadoresEntrada['clientes']> }) {
  const barras = c.ultimos10Meses ?? []
  const max = Math.max(1, ...barras)
  return (
    <div className={`${vidro} flex w-[230px] flex-col gap-2.5 px-[18px] py-4`}>
      <span className="text-xs font-semibold tracking-[.08em] text-[#6b7285]">CLIENTES CONECTADOS</span>
      <div className="flex items-baseline gap-2.5">
        <span className="entrada-titulo text-[30px] font-extrabold">{c.total.toLocaleString('pt-BR')}</span>
        {c.porMes && <span className="text-[13px] font-semibold text-[#16a34a]">{c.porMes}</span>}
      </div>
      {barras.length > 0 && (
        <div className="flex h-[34px] items-end gap-[5px]">
          {barras.map((v, k) => (
            <div key={k} className="flex-1 rounded-[3px]"
              style={{ height: `${Math.max(6, (v / max) * 100)}%`,
                       background: k === barras.length - 1 ? '#e8212e' : '#f3c3c7' }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** "Qualidade que se mede" — só com os números reais e a fonte. */
function SecaoQualidade({ ind }: { ind: IndicadoresEntrada }) {
  const pct = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
  const cartoes = [
    ind.satisfacao && { r: 'SATISFAÇÃO DO CLIENTE', v: pct(ind.satisfacao.valor), d: ind.satisfacao.variacao,
      f: 'Cliente feliz é a nossa melhor propaganda.', bg: 'linear-gradient(160deg,#ee2a36,#b80e19)', fg: '#fff' },
    ind.qualidadeTecnica && { r: 'QUALIDADE TÉCNICA', v: pct(ind.qualidadeTecnica.valor), d: ind.qualidadeTecnica.variacao,
      f: 'Instalação certa na primeira visita.', bg: '#fff', fg: '#0e0f14' },
    ind.nps && { r: 'RECOMENDAÇÃO · NPS', v: String(ind.nps.valor), d: ind.nps.variacao,
      f: 'Quem recebe o nosso técnico, indica.', bg: '#0e0f14', fg: '#fff' },
  ].filter(Boolean) as { r: string; v: string; d?: string; f: string; bg: string; fg: string }[]

  return (
    <section className="relative mx-auto flex max-w-[1320px] flex-col gap-12 px-4 pb-28 pt-10 sm:px-10 lg:pt-44">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="entrada-titulo text-xs font-extrabold tracking-[.28em] text-[#d4121f]">
          QUALIDADE QUE SE MEDE
        </span>
        <h2 className="entrada-titulo m-0 max-w-[900px] font-extrabold leading-[1.02] tracking-[-.02em]"
          style={{ fontSize: 'clamp(38px,4.6vw,68px)', textWrap: 'balance' }}>
          Cada visita bem feita vira um <span className="font-black italic text-[#e8212e]">sorriso</span> no indicador.
        </h2>
        <p className="m-0 max-w-[620px] text-lg leading-relaxed text-[#4a5064]">
          Satisfação, qualidade técnica e recomendação dos clientes — subindo juntas.
        </p>
      </div>
      <div className="flex flex-wrap items-stretch gap-5">
      {ind.evolucao && <GraficoEvolucao e={ind.evolucao} />}
      <div className="flex min-w-0 flex-[1_1_300px] flex-wrap gap-5">
        {cartoes.map(k => (
          <div key={k.r} className="flex flex-[1_1_240px] flex-col justify-between gap-2.5 rounded-3xl px-6 py-6
                                     shadow-[0_30px_70px_-45px_rgba(14,15,20,.4),0_0_0_1px_rgba(14,15,20,.04)]"
            style={{ background: k.bg, color: k.fg }}>
            <span className="text-xs font-semibold tracking-[.12em] opacity-75">{k.r}</span>
            <div className="flex items-baseline gap-2.5">
              <span className="entrada-titulo text-[44px] font-extrabold leading-none">{k.v}</span>
              {k.d && <span className="text-sm font-semibold opacity-85">{k.d}</span>}
            </div>
            <span className="text-[15px] leading-snug opacity-80">{k.f}</span>
          </div>
        ))}
      </div>
      </div>
      <p className="m-0 text-center text-xs text-[#6b7285]">Fonte: {ind.fonte}</p>
    </section>
  )
}

function GraficoEvolucao({ e }: { e: NonNullable<IndicadoresEntrada['evolucao']> }) {
  const X0 = 50, X1 = 620, Y0 = 20, Y1 = 230, min = 50, max = 100
  const x = (i: number) => X0 + (X1 - X0) * i / 11
  const y = (v: number) => Y1 - (Y1 - Y0) * (Math.min(max, Math.max(min, v)) - min) / (max - min)
  // Mês sem medida quebra a linha — não se liga ponto a ponto por cima do buraco.
  const linha = (a: (number | null)[]) => a.map((v, i) =>
    v == null ? '' : `${i && a[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const series = [
    { nome: 'Satisfação', cor: '#e8212e', a: e.satisfacao },
    { nome: 'Qualidade técnica', cor: '#0e0f14', a: e.qualidadeTecnica },
    { nome: 'Recomendação (NPS)', cor: '#f08a91', a: e.nps },
  ]
  return (
    <div className="min-w-0 flex-[2_1_560px] rounded-[28px] bg-white p-8 shadow-[0_40px_90px_-50px_rgba(14,15,20,.35),0_0_0_1px_rgba(14,15,20,.04)]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <span className="entrada-titulo text-[22px] font-extrabold">Evolução em {e.ano}</span>
        <div className="flex flex-wrap gap-[18px]">
          {series.map(s => (
            <span key={s.nome} className="flex items-center gap-2 text-sm font-medium text-[#4a5064]">
              <span className="h-1 w-3.5 rounded-sm" style={{ background: s.cor }} />{s.nome}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 640 260" className="h-auto w-full overflow-visible" role="img"
        aria-label={`Evolução dos indicadores em ${e.ano}`}>
        {[50, 60, 70, 80, 90, 100].map(v => (
          <g key={v}>
            <line x1={36} x2={630} y1={y(v)} y2={y(v)} stroke="#eceef4" />
            <text x={0} y={y(v) + 4} fontSize={12} fill="#6b7285">{v}</text>
          </g>
        ))}
        {'JFMAMJJASOND'.split('').map((l, i) => (
          <text key={i} x={x(i)} y={256} fontSize={12} fill="#6b7285" textAnchor="middle">{l}</text>
        ))}
        {series.map(s => {
          // O último mês MEDIDO ganha o ponto — não dezembro.
          const u = s.a.reduce<number>((k, v, i) => (v == null ? k : i), -1)
          return (
            <g key={s.nome}>
              <path d={linha(s.a)} fill="none" stroke={s.cor} strokeWidth={3}
                strokeLinecap="round" strokeLinejoin="round" />
              {u >= 0 && <circle cx={x(u)} cy={y(s.a[u]!)} r={5} fill="#fff" stroke={s.cor} strokeWidth={3} />}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * A abertura — tela escura, o AF montando, quatro frases e o "16 anos
 * conectando vidas." Uma vez por navegador (ver o topo do arquivo).
 */
function Abertura({ ind, aoRevelar, aoTerminar }: {
  ind: IndicadoresEntrada | null; aoRevelar: () => void; aoTerminar: () => void
}) {
  const [s, setS] = useState(0)
  useEffect(() => {
    const passos = [300, 1900, 3100, 4300, 5500, 6900, 9400]
    const ts = passos.map((ms, i) => setTimeout(() => {
      setS(i + 1)
      if (i + 1 === 7) aoRevelar()
    }, ms))
    ts.push(setTimeout(aoTerminar, 10500))
    // Pular = sumir já (o mesmo fade), e a tela vem junto.
    const pular = () => { setS(7); aoRevelar(); ts.push(setTimeout(aoTerminar, 1000)) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') pular() }
    window.addEventListener('keydown', esc)
    pularRef.current = pular
    return () => { ts.forEach(clearTimeout); window.removeEventListener('keydown', esc) }
  }, [aoRevelar, aoTerminar])
  const pularRef = useRef<() => void>(() => {})

  const on1 = s >= 1, fim = s >= 6, saindo = s >= 7
  const desloc = ['translate(-30px,60px)', 'translate(20px,-70px)', 'translate(80px,0)', 'translate(70px,0)']
  return (
    <div role="dialog" aria-label="Abertura" className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#08080b]"
      style={{ opacity: saindo ? 0 : 1, transform: saindo ? 'scale(1.06)' : 'scale(1)',
               transition: 'opacity 1s ease, transform 1.2s cubic-bezier(.7,0,.3,1)',
               pointerEvents: saindo ? 'none' : 'auto' }}>
      <div className="absolute h-[900px] w-[900px] rounded-full"
        style={{ background: 'radial-gradient(closest-side,rgba(232,33,46,.28),rgba(232,33,46,0))',
                 opacity: on1 ? 1 : 0, transform: `scale(${on1 ? (fim ? 1.4 : 1) : .4})`,
                 transition: 'opacity 1.6s ease, transform 3s cubic-bezier(.2,.8,.2,1)' }} />

      <div className="relative flex flex-col items-center gap-10 px-6 text-center">
        <MarcaAF largura={s >= 2 ? 'clamp(90px,10vw,130px)' : 'clamp(160px,22vw,280px)'}
          cor={['#ff5a64', '#d4121f']} line="#ff4d58"
          estilo={i => i < 4
            ? { opacity: on1 ? 1 : 0, transform: on1 ? 'translate(0,0)' : desloc[i],
                transition: `opacity .8s ease ${[0, .12, .28, .4][i]}s, transform 1s cubic-bezier(.2,.8,.2,1) ${[0, .12, .28, .4][i]}s` }
            : { opacity: on1 ? 1 : 0, transition: 'opacity 1s ease .7s' }} />

        <div className="relative w-[min(92vw,1100px)]" style={{ height: 'clamp(120px,16vw,200px)' }}>
          {FRASES_DA_ABERTURA.map(([a, b], k) => {
            const cur = s === k + 2, passou = s > k + 2
            return (
              <div key={b} className="entrada-titulo absolute inset-0 flex items-center justify-center
                                      font-extrabold leading-[1.05] tracking-[-.02em] text-white"
                style={{ fontSize: 'clamp(34px,5.6vw,84px)', textWrap: 'balance',
                         opacity: cur ? 1 : 0, filter: `blur(${cur ? 0 : 14}px)`,
                         transform: cur ? 'none' : passou ? 'translateY(-30px) scale(1.04)' : 'translateY(30px) scale(.97)',
                         transition: 'opacity .7s ease, filter .8s ease, transform 1.1s cubic-bezier(.2,.8,.2,1)' }}>
                <span>{a}<span className="text-[#ff4d58]">{b}</span></span>
              </div>
            )
          })}
          {/* O fecho: a AFLINE (o AF lá em cima) apresenta o Nexus Manager. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4"
            style={{ opacity: fim ? 1 : 0, filter: `blur(${fim ? 0 : 16}px)`, transform: fim ? 'scale(1)' : 'scale(.92)',
                     transition: 'opacity .9s ease, filter 1s ease, transform 1.4s cubic-bezier(.2,.8,.2,1)' }}>
            <span className="flex items-center gap-[clamp(14px,1.8vw,26px)] text-left">
              <SimboloNexus largura="clamp(72px,8vw,120px)" />
              <LetreiroNexus escuro />
            </span>
            <span className="entrada-titulo text-sm font-semibold tracking-[.28em] text-[#a3a9b8]">
              16 ANOS CONECTANDO VIDAS · CONECTADOS COM O FUTURO
            </span>
          </div>
        </div>

        {/* Os números da abertura: só os que existem de verdade. */}
        {(ind?.clientes || ind?.satisfacao) && (
          <div className="flex flex-wrap justify-center" style={{ gap: 'clamp(24px,6vw,88px)',
            opacity: fim ? 1 : 0, transform: fim ? 'none' : 'translateY(20px)',
            transition: 'opacity .9s ease .3s, transform 1.1s cubic-bezier(.2,.8,.2,1) .3s' }}>
            {ind?.clientes && <Numero v={ind.clientes.total.toLocaleString('pt-BR')} r="CLIENTES CONECTADOS" />}
            {ind?.satisfacao && <Numero v={ind.satisfacao.valor.toLocaleString('pt-BR') + '%'} r="CLIENTES SATISFEITOS" />}
          </div>
        )}
      </div>

      <button type="button" onClick={() => pularRef.current()}
        className="absolute bottom-7 right-7 h-10 rounded-full border border-white/20 bg-white/5 px-[18px]
                   text-sm font-medium text-[#d6d9e2] hover:bg-white/15 hover:text-white">
        Pular abertura
      </button>
      <div className="absolute bottom-0 left-0 h-[3px]"
        style={{ width: on1 ? '100%' : '0%', background: `linear-gradient(90deg,${AZUL[0]},${VERMELHO[0]})`,
                 transition: on1 ? 'width 9.1s linear' : 'none' }} />
    </div>
  )
}

function Numero({ v, r }: { v: string; r: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="entrada-titulo text-[40px] font-extrabold text-white">{v}</span>
      <span className="text-sm tracking-[.14em] text-[#8d93a5]">{r}</span>
    </div>
  )
}

/**
 * A rede de pontos do fundo, com o pulso vermelho que corre pelas ligações
 * (o "sinal" passando). Canvas à mão; parada para quem pede menos movimento.
 */
function Constelacao() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const tela = ref.current
    const ctx = tela?.getContext('2d')
    if (!tela || !ctx) return
    const parado = menosMovimento()

    // Nó colorido: um em cada oito é da marca — metade azul (Nexus), metade
    // vermelho (AFLINE). E o pulso que corre na ligação também alterna.
    type P = { x: number; y: number; vx: number; vy: number; cor: 'cinza' | 'azul' | 'vermelho' }
    let nos: P[] = [], pulsos: { a: P; b: P; t: number; rgb: string }[] = []
    let L = 0, A = 0, quadro = 0

    function medir() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      L = tela!.offsetWidth; A = tela!.offsetHeight
      tela!.width = L * dpr; tela!.height = A * dpr
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      const n = Math.min(110, Math.max(24, Math.round((L * A) / 26000)))
      nos = Array.from({ length: n }, () => ({
        x: Math.random() * L, y: Math.random() * A,
        vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18,
        cor: (r => r < .065 ? 'azul' : r < .13 ? 'vermelho' : 'cinza')(Math.random()),
      }))
    }

    const LIGA = 150
    function desenhar() {
      ctx!.clearRect(0, 0, L, A)
      const ligacoes: [P, P][] = []
      for (let i = 0; i < nos.length; i++) for (let j = i + 1; j < nos.length; j++) {
        const a = nos[i], b = nos[j], d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d < LIGA) {
          ligacoes.push([a, b])
          ctx!.strokeStyle = `rgba(120,128,150,${(1 - d / LIGA) * .22})`
          ctx!.lineWidth = 1
          ctx!.beginPath(); ctx!.moveTo(a.x, a.y); ctx!.lineTo(b.x, b.y); ctx!.stroke()
        }
      }
      for (const a of nos) {
        ctx!.fillStyle = a.cor === 'vermelho' ? 'rgba(232,33,46,.8)'
                       : a.cor === 'azul' ? 'rgba(29,95,191,.8)' : 'rgba(120,128,150,.55)'
        ctx!.beginPath(); ctx!.arc(a.x, a.y, a.cor === 'cinza' ? 1.8 : 2.4, 0, 7); ctx!.fill()
      }
      return ligacoes
    }

    function passo() {
      if (tela!.offsetHeight !== A) medir()
      for (const a of nos) {
        a.x += a.vx; a.y += a.vy
        if (a.x < 0 || a.x > L) a.vx *= -1
        if (a.y < 0 || a.y > A) a.vy *= -1
      }
      const ligacoes = desenhar()
      if (ligacoes.length && Math.random() < .05 && pulsos.length < 8) {
        const [a, b] = ligacoes[Math.floor(Math.random() * ligacoes.length)]
        pulsos.push({ a, b, t: 0, rgb: Math.random() < .5 ? '29,95,191' : '232,33,46' })
      }
      pulsos = pulsos.filter(p => p.t <= 1)
      for (const p of pulsos) {
        p.t += .012
        const x = p.a.x + (p.b.x - p.a.x) * p.t, y = p.a.y + (p.b.y - p.a.y) * p.t
        const g = ctx!.createRadialGradient(x, y, 0, x, y, 8)
        g.addColorStop(0, `rgba(${p.rgb},.9)`); g.addColorStop(1, `rgba(${p.rgb},0)`)
        ctx!.fillStyle = g; ctx!.beginPath(); ctx!.arc(x, y, 8, 0, 7); ctx!.fill()
      }
      quadro = requestAnimationFrame(passo)
    }

    medir()
    if (parado) desenhar(); else quadro = requestAnimationFrame(passo)
    const aoRedimensionar = () => { medir(); if (parado) desenhar() }
    window.addEventListener('resize', aoRedimensionar)
    return () => { cancelAnimationFrame(quadro); window.removeEventListener('resize', aoRedimensionar) }
  }, [])

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
}
