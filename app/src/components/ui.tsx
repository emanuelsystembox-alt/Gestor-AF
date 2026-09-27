import { useId, type ReactNode } from 'react'
import { SITUACAO_INFO, type Situacao } from '../lib/supabase'

/**
 * A marca da AFLINE, redesenhada em vetor a partir da arte oficial.
 *
 * ┌─ por que SVG e não o PNG ────────────────────────────────────────┐
 * │ A arte veio como imagem quadrada com o fundo grafite "de esfera" │
 * │ pintado junto. No menu recolhido ela tem 28px, e um PNG reduzido │
 * │ a isso vira borrão vermelho; no tema claro o fundo escuro        │
 * │ pintado viraria um carimbo preto no meio da tela branca.         │
 * │                                                                  │
 * │ Em vetor o "AF" fica nítido em qualquer tamanho, e o "LINE" usa  │
 * │ `currentColor`: branco no controle escuro, grafite no claro —    │
 * │ a mesma marca, legível nos dois. O traçado foi sobreposto à arte │
 * │ original para conferir a geometria (26/09).                      │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * As coordenadas estão na grade da arte original (447 × 447).
 */
const AF_PERNA = 'M142 136 L152 136 L127 296 L76 296 Z'
const AF_F = 'M154 121 L371 121 L358 164.5 L228 164.5 L236 187 L321 187 L308 226 L249 226 L288 338 L229 338 Z'

function GradienteAF({ id }: { id: string }) {
  // O vermelho da arte não é chapado: acende no alto e escurece embaixo.
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="#f2464e" />
      <stop offset="1" stopColor="#c81a23" />
    </linearGradient>
  )
}

/** Só o "AF", num selo — para onde a marca inteira não caberia legível
 *  (menu recolhido, celular, favicon). */
export function Logo({ tamanho = 32 }: { tamanho?: number }) {
  const g = useId()
  return (
    <svg width={tamanho} height={tamanho} viewBox="58 64 330 330" aria-hidden
         className="shrink-0 select-none">
      <defs>
        <GradienteAF id={g} />
        <radialGradient id={`${g}f`} cx="0.7" cy="0.25" r="0.9">
          {/* var() em `style`, não no atributo: atributo de
              apresentação do SVG não resolve variável CSS */}
          <stop offset="0" style={{ stopColor: 'var(--color-graf-700)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-graf-900)' }} />
        </radialGradient>
      </defs>
      {/* o fundo "de esfera" da arte, em tokens: acompanha o tema */}
      <rect x="58" y="64" width="330" height="330" rx="78" fill={`url(#${g}f)`} />
      <g fill={`url(#${g})`} transform="translate(223 229.5) scale(.8) translate(-223 -229.5)">
        <path d={AF_PERNA} /><path d={AF_F} />
      </g>
    </svg>
  )
}

/** A marca inteira: AF + LINE, sem fundo. */
export function LogoCompleto({ altura = 36 }: { altura?: number }) {
  const g = useId()
  return (
    <svg height={altura} width={altura * 320 / 232} viewBox="58 112 320 232"
         role="img" aria-label="AFLINE" className="shrink-0 select-none">
      <defs><GradienteAF id={g} /></defs>
      <g fill={`url(#${g})`}><path d={AF_PERNA} /><path d={AF_F} /></g>
      {/* "LINE" em traço inclinado, como na arte; a base do E corre
          até o pé do F, que é o que amarra as duas palavras */}
      <g fill="none" stroke="currentColor" strokeWidth="4.5"
         transform="translate(0 336) skewX(-16) translate(0 -336)">
        <path d="M72 307 V334 H100" /><path d="M114 307 V336" />
        <path d="M128 336 V307 L156 336 V307" />
        <path d="M200 309 H170 V334 H232 M170 321.5 H196" />
      </g>
    </svg>
  )
}

export function Marca({ compacto = false }: { compacto?: boolean }) {
  if (compacto) return <Logo tamanho={30} />
  return (
    <div className="flex items-center gap-3">
      <LogoCompleto altura={34} />
      <div className="border-l border-graf-700 pl-3 leading-tight">
        <div className="text-[13px] font-semibold tracking-tight">Manager</div>
        <div className="text-[10px] uppercase tracking-widest text-graf-400">Gestão de campo</div>
      </div>
    </div>
  )
}

/**
 * Bolinha do técnico: foto quando existe, iniciais quando não.
 *
 * A cor de fundo sai do próprio texto, não é sorteada — assim a mesma
 * pessoa tem sempre a mesma cor, em qualquer tela e em qualquer sessão.
 * Bolinha que muda de cor a cada carregamento não ajuda a reconhecer
 * ninguém, que é a única razão de ela existir.
 */
export function Avatar({ nome, foto, tamanho = 34, titulo }: {
  nome: string | null | undefined
  foto?: string | null
  tamanho?: number
  titulo?: string
}) {
  const texto = (nome ?? '?').trim()
  const iniciais = texto
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '').join('') || '?'

  let soma = 0
  for (let i = 0; i < texto.length; i++) soma = (soma * 31 + texto.charCodeAt(i)) % 360

  if (foto) {
    return (
      <img src={foto} alt={titulo ?? texto} title={titulo ?? texto}
        width={tamanho} height={tamanho}
        className="shrink-0 rounded-full object-cover ring-1 ring-graf-700"
        style={{ width: tamanho, height: tamanho }} />
    )
  }
  return (
    <div
      title={titulo ?? texto} aria-hidden={!titulo}
      className="avatar grid shrink-0 place-items-center rounded-full font-semibold
                 ring-1 ring-graf-700 select-none"
      style={{
        width: tamanho, height: tamanho,
        fontSize: tamanho * 0.36,
        // A cor sai daqui; a LUMINOSIDADE sai do CSS, que sabe em que
        // tema está. Mesma técnica do D-065.
        ['--avatar-h' as string]: String(soma),
      }}>
      {iniciais}
    </div>
  )
}

/** Etiqueta de situação. Mesma cor em toda a aplicação.
 *
 *  `vivo` faz a bolinha pulsar — deslocamento e execução são as duas
 *  situações que estão ACONTECENDO enquanto a tela é lida. O pulso é
 *  reforço, nunca o único portador: o rótulo continua escrito, e quem
 *  pediu menos movimento (`prefers-reduced-motion`) vê a etiqueta
 *  parada com a mesma informação. */
export function Pill({ situacao, vivo = false }: {
  situacao: Situacao; vivo?: boolean
}) {
  const info = SITUACAO_INFO[situacao]
  const classe = `pill${vivo ? ' pill-vivo' : ''}`
  if (!info) return <span className={classe} style={{ ['--pill-cor' as string]: '#64748b' }}>{situacao}</span>
  return (
    <span className={classe} style={{ ['--pill-cor' as string]: info.cor }}>
      {info.label}
    </span>
  )
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="sup-controle grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-graf-700 border-t-af-500" />
        <p className="text-sm text-graf-400">{texto}</p>
      </div>
    </div>
  )
}

export function Vazio({ titulo, descricao, acao }: {
  titulo: string; descricao?: string; acao?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="font-medium">{titulo}</p>
      {descricao && <p className="max-w-sm text-sm text-graf-400">{descricao}</p>}
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  )
}

export function Alerta({ tipo = 'erro', children }: {
  tipo?: 'erro' | 'aviso' | 'ok' | 'info'; children: ReactNode
}) {
  const estilo = {
    erro:  'border-af-700/60 bg-af-900/25 text-af-200',
    aviso: 'border-amber-700/60 bg-amber-900/20 text-amber-200',
    ok:    'border-emerald-700/60 bg-emerald-900/20 text-emerald-200',
    info:  'border-graf-600 bg-graf-800 text-graf-200',
  }[tipo]
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'}
         className={`rounded-lg border px-3.5 py-2.5 text-sm ${estilo}`}>
      {children}
    </div>
  )
}

/** Número grande com rótulo. A unidade de leitura do painel do COP. */
export function Metrica({ valor, rotulo, cor, alerta = false }: {
  valor: number | string; rotulo: string; cor?: string; alerta?: boolean
}) {
  return (
    <div className={`card-controle px-3.5 py-3 ${alerta ? 'ring-1 ring-af-600/50' : ''}`}>
      <div className="tabular text-2xl font-semibold leading-none"
           style={cor ? { color: cor } : undefined}>
        {valor}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-graf-400">
        {rotulo}
      </div>
    </div>
  )
}
