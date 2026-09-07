import type { ReactNode } from 'react'
import { SITUACAO_INFO, type Situacao } from '../lib/supabase'

/** Marca AFLINE: o "AF" em vermelho sobre grafite. */
export function Logo({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <div
      className="grid place-items-center rounded-full bg-graf-900 ring-1 ring-graf-700 select-none"
      style={{ width: tamanho, height: tamanho }}
      aria-hidden
    >
      <span
        className="font-black leading-none text-af-500 tracking-tighter"
        style={{ fontSize: tamanho * 0.42 }}
      >
        AF
      </span>
    </div>
  )
}

export function Marca({ compacto = false }: { compacto?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo tamanho={compacto ? 28 : 34} />
      {!compacto && (
        <div className="leading-tight">
          <div className="font-semibold tracking-tight">AFLINE</div>
          <div className="text-[11px] text-graf-400 -mt-0.5">Manager</div>
        </div>
      )}
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

/** Etiqueta de situação. Mesma cor em toda a aplicação. */
export function Pill({ situacao }: { situacao: Situacao }) {
  const info = SITUACAO_INFO[situacao]
  if (!info) return <span className="pill" style={{ ['--pill-cor' as string]: '#64748b' }}>{situacao}</span>
  return (
    <span className="pill" style={{ ['--pill-cor' as string]: info.cor }}>
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
