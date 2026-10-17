import type { Workbook, Worksheet } from 'exceljs'
import { conferirCadastro, soDigitos } from './validacao'
import { PERNOITE, PROPRIEDADE, TIPO_VEICULO } from './frota'
import { isoLocal } from './formato'

/**
 * A planilha padrão de cadastro de uma cidade (100, D-176).
 *
 * > "preciso que a planilha excel seja padrão ou seja, já defina o que o
 * >  usuário pode cadastrar […] atualize nosso sistema para ter o download
 * >  da planilha padrão, e para importar dados depois que o usuário
 * >  preencher" — Emanuel, 14/10
 *
 * ┌─ por que exceljs, e só aqui ──────────────────────────────────────┐
 * │ "Já define o que pode cadastrar" = lista suspensa na célula: perfil│
 * │ de acesso, cargo, skill, tipo de veículo… só aceitam o que existe  │
 * │ no cadastro. O SheetJS (que a web já usa para LER) não grava       │
 * │ validação de célula na versão livre. O exceljs grava — e é carregado│
 * │ por `import()` dinâmico só nesta tela: não pesa no resto do sistema.│
 * └───────────────────────────────────────────────────────────────────┘
 *
 * As listas vêm do BANCO na hora do download (perfis, cargos, skills
 * desta empresa): planilha baixada hoje sabe o cadastro de hoje. A
 * conferência de verdade continua sendo a prévia, no servidor.
 */

export type ChaveAba = 'areas' | 'equipes' | 'pessoas' | 'veiculos'

interface Coluna {
  chave: string
  titulo: string
  obrigatorio?: boolean
  largura: number
  nota: string
  /** Lista fixa de valores aceitos (lista suspensa que recusa o resto). */
  lista?: string[]
  /** Sugestão a partir de outra aba (aceita valor que já existe no sistema). */
  referencia?: { aba: string; coluna: string }
  tipo?: 'data' | 'inteiro'
}

export interface Catalogos {
  cidade: { id: string; codigo: string; nome: string }
  perfis: { id: string; nome: string; papel: string | null }[]
  cargos: { id: string; nome: string }[]
  skills: string[]
  /** O que a cidade já tem — vai no Leia-me, para quem preenche saber. */
  areasExistentes: string[]
  equipesExistentes: string[]
}

const SIM_NAO = ['SIM', 'NÃO']

export const ABAS: { chave: ChaveAba; nome: string; explica: string }[] = [
  { chave: 'areas', nome: 'Áreas', explica: 'As áreas (zonas) de trabalho da cidade.' },
  { chave: 'equipes', nome: 'Equipes', explica: 'As equipes de campo, com área e supervisor.' },
  { chave: 'pessoas', nome: 'Pessoas', explica: 'Quem usa o sistema: técnicos, supervisores, controladores…' },
  { chave: 'veiculos', nome: 'Veículos', explica: 'Os carros e motos, com o técnico que dirige.' },
]

function colunas(c: Catalogos): Record<ChaveAba, Coluna[]> {
  return {
    areas: [
      { chave: 'codigo', titulo: 'Código da área', obrigatorio: true, largura: 18,
        nota: `Único no sistema INTEIRO (não só nesta cidade). Use o prefixo da cidade: ${c.cidade.codigo}-AREA01.` },
      { chave: 'nome', titulo: 'Nome', largura: 30, nota: 'Como a operação chama a área. Ex.: Zona Norte.' },
      { chave: 'apelido', titulo: 'Apelido no TOA', largura: 22,
        nota: 'Como a área aparece na planilha do TOA, se for diferente do código.' },
    ],
    equipes: [
      { chave: 'codigo', titulo: 'Código da equipe', obrigatorio: true, largura: 16,
        nota: 'O número da equipe. "45" e "045" são a mesma equipe. Não use SEM-LOGIN.' },
      { chave: 'nome', titulo: 'Nome da equipe', obrigatorio: true, largura: 28, nota: 'Ex.: 045 - EQUIPE' },
      { chave: 'area', titulo: 'Área', largura: 18, referencia: { aba: 'Áreas', coluna: 'A' },
        nota: 'O código de uma área da aba Áreas (ou que já existe na cidade).' },
      { chave: 'supervisor', titulo: 'Supervisor (nome completo)', largura: 32,
        nota: 'Igual ao nome da pessoa na aba Pessoas, com perfil Supervisor. É assim que a equipe fica ligada a ele.' },
    ],
    pessoas: [
      { chave: 'nome', titulo: 'Nome completo', obrigatorio: true, largura: 32, nota: 'Nome e sobrenome.' },
      { chave: 'email', titulo: 'E-mail', largura: 30,
        nota: 'É o login no sistema. Sem e-mail, a pessoa não ganha acesso (o técnico é cadastrado mesmo assim).' },
      { chave: 'criar_acesso', titulo: 'Criar acesso', largura: 13, lista: SIM_NAO,
        nota: 'SIM (padrão) cria login e senha. NÃO cadastra sem acesso.' },
      { chave: 'perfil', titulo: 'Perfil de acesso', largura: 20, lista: c.perfis.map(p => p.nome),
        nota: 'Obrigatório para criar acesso: é ele que diz o que a pessoa enxerga.' },
      { chave: 'cargo', titulo: 'Cargo', largura: 20, lista: c.cargos.map(x => x.nome), nota: 'O cargo da pessoa.' },
      { chave: 'apelido', titulo: 'Apelido', largura: 16, nota: 'Como é chamada.' },
      { chave: 'whatsapp', titulo: 'WhatsApp', largura: 17, nota: 'Com DDD. Ex.: 92991234567' },
      { chave: 'cpf', titulo: 'CPF', largura: 15, nota: 'Só números ou com pontos; o dígito verificador é conferido.' },
      { chave: 'rg', titulo: 'RG', largura: 14, nota: '' },
      { chave: 'nascimento', titulo: 'Nascimento', largura: 13, tipo: 'data', nota: 'DD/MM/AAAA' },
      { chave: 'matricula_ponto', titulo: 'Matrícula do ponto', largura: 17, nota: 'Só números.' },
      { chave: 'login_toa', titulo: 'Login TOA', largura: 13,
        nota: 'Só para técnico. Ex.: Z384041. É ele que liga a pessoa aos contratos do TOA.' },
      { chave: 'skill', titulo: 'Skill', largura: 15, lista: c.skills, nota: 'Precisa do login TOA. Decide meta e comissão.' },
      { chave: 'equipe', titulo: 'Equipe', largura: 12, referencia: { aba: 'Equipes', coluna: 'A' },
        nota: 'O código de uma equipe da aba Equipes (ou que já existe na cidade). Precisa do login TOA.' },
      { chave: 'rotear', titulo: 'Rotear contratos para a equipe', largura: 16, lista: SIM_NAO,
        nota: 'SIM (padrão): os contratos do login TOA dele vão para a equipe dele, inclusive os já importados.' },
    ],
    veiculos: [
      { chave: 'placa', titulo: 'Placa', obrigatorio: true, largura: 11, nota: 'ABC1D23 ou ABC-1234.' },
      { chave: 'apelido', titulo: 'Apelido', largura: 16, nota: 'Como a equipe chama o carro.' },
      { chave: 'modelo', titulo: 'Modelo', largura: 18, nota: 'Ex.: Fiat Strada' },
      { chave: 'tipo', titulo: 'Tipo', largura: 13, lista: Object.values(TIPO_VEICULO), nota: '' },
      { chave: 'ano', titulo: 'Ano', largura: 8, tipo: 'inteiro', nota: '1950 a 2100' },
      { chave: 'propriedade', titulo: 'De quem é', largura: 20, lista: Object.values(PROPRIEDADE), nota: '' },
      { chave: 'pernoite', titulo: 'Onde dorme', largura: 16, lista: Object.values(PERNOITE), nota: '' },
      { chave: 'chassi', titulo: 'Chassi', largura: 20, nota: '' },
      { chave: 'renavam', titulo: 'Renavam', largura: 14, nota: '' },
      { chave: 'rastreador', titulo: 'Rastreador', largura: 14, nota: 'Código do rastreador, se tiver.' },
      { chave: 'hodometro', titulo: 'Hodômetro inicial (km)', largura: 14, tipo: 'inteiro', nota: '' },
      { chave: 'condutor', titulo: 'Condutor (login TOA)', largura: 16, referencia: { aba: 'Pessoas', coluna: 'LOGIN_TOA' },
        nota: 'O login TOA do técnico que dirige (aba Pessoas, ou técnico que já existe na cidade).' },
      { chave: 'observacao', titulo: 'Observação', largura: 28, nota: '' },
    ],
  }
}

// ----------------------------------------------------------------------------
// o modelo para baixar
// ----------------------------------------------------------------------------
const VERMELHO = 'FFD11A24'
const CINZA = 'FF566072'

export async function baixarModelo(c: Catalogos) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Gestor AF'
  wb.created = new Date()
  const cols = colunas(c)

  // ---- Leia-me ----
  const leia = wb.addWorksheet('Leia-me', { properties: { tabColor: { argb: VERMELHO } } })
  leia.getColumn(1).width = 110
  const linhasLeia: [string, 'titulo' | 'sub' | 'texto' | 'alerta'][] = [
    [`Cadastro da cidade — ${c.cidade.nome}`, 'titulo'],
    ['Planilha padrão do Gestor AF. Preencha as abas e importe em Administração › Importar planilha.', 'texto'],
    ['', 'texto'],
    ['Como preencher', 'sub'],
    ['1. Uma linha por item. Não mude o nome das abas nem dos cabeçalhos.', 'texto'],
    ['2. Coluna com * é obrigatória. As colunas com lista só aceitam os valores da lista.', 'texto'],
    ['3. Preencha na ordem: Áreas → Equipes → Pessoas → Veículos. Uma aba usa o que a anterior cadastrou.', 'texto'],
    ['4. Passe o mouse no cabeçalho para ver a explicação de cada coluna.', 'texto'],
    ['5. Pode deixar uma aba vazia. Célula vazia NÃO apaga o que já está no sistema.', 'texto'],
    ['6. Importar de novo a mesma planilha atualiza — não duplica.', 'texto'],
    ['', 'texto'],
    ['Os acessos', 'sub'],
    ['Quem tem e-mail e "Criar acesso = SIM" ganha login. A senha é gerada pelo sistema e aparece UMA vez, numa planilha de resultado, no fim da importação.', 'texto'],
    ['Quem já tem acesso (mesmo e-mail) não tem o acesso alterado.', 'texto'],
    ['', 'texto'],
    ['O que esta cidade já tem', 'sub'],
    [`Áreas: ${c.areasExistentes.length ? c.areasExistentes.join(', ') : 'nenhuma'}`, 'texto'],
    [`Equipes: ${c.equipesExistentes.length ? c.equipesExistentes.join(', ') : 'nenhuma'}`, 'texto'],
    ['', 'texto'],
    ['ATENÇÃO — LGPD: esta planilha leva CPF, RG, telefone e data de nascimento. Não mande por WhatsApp nem deixe em pasta compartilhada. Depois de importar, apague.', 'alerta'],
  ]
  linhasLeia.forEach(([t, estilo], i) => {
    const cel = leia.getCell(i + 1, 1)
    cel.value = t
    cel.alignment = { wrapText: true, vertical: 'top' }
    if (estilo === 'titulo') cel.font = { bold: true, size: 16, color: { argb: VERMELHO } }
    if (estilo === 'sub') cel.font = { bold: true, size: 12 }
    if (estilo === 'alerta') cel.font = { bold: true, color: { argb: VERMELHO } }
  })

  // ---- as quatro abas ----
  for (const a of ABAS) {
    const ws = wb.addWorksheet(a.nome, { views: [{ state: 'frozen', ySplit: 1 }] })
    cols[a.chave].forEach((col, i) => {
      const n = i + 1
      ws.getColumn(n).width = col.largura
      const cab = ws.getCell(1, n)
      cab.value = col.titulo + (col.obrigatorio ? ' *' : '')
      cab.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.obrigatorio ? VERMELHO : CINZA } }
      cab.alignment = { vertical: 'middle', wrapText: true }
      const explica = [col.nota, col.lista ? `Aceita: ${col.lista.join(' · ')}` : ''].filter(Boolean).join('\n')
      if (explica) cab.note = explica
      // Texto, para o Excel não comer o zero de "045" nem virar CPF em 1,23E+10.
      if (!col.tipo) ws.getColumn(n).numFmt = '@'
      if (col.tipo === 'data') ws.getColumn(n).numFmt = 'dd/mm/yyyy'

      const letra = ws.getColumn(n).letter
      for (let r = 2; r <= 1000; r++) {
        const cel = ws.getCell(`${letra}${r}`)
        if (col.lista?.length) {
          cel.dataValidation = {
            type: 'list', allowBlank: true, showErrorMessage: true,
            formulae: [`Listas!$${letraLista(a.chave, col.chave)}$2:$${letraLista(a.chave, col.chave)}$${col.lista.length + 1}`],
            errorTitle: col.titulo, error: `Escolha um valor da lista: ${col.lista.join(', ')}`,
          }
        } else if (col.referencia) {
          // Aviso, não recusa: o valor pode já existir no sistema sem estar nesta planilha.
          // A letra do Login TOA sai da posição dele, não de uma letra escrita à mão.
          const ref = col.referencia.coluna === 'LOGIN_TOA'
            ? String.fromCharCode(65 + cols.pessoas.findIndex(x => x.chave === 'login_toa'))
            : col.referencia.coluna
          cel.dataValidation = {
            type: 'list', allowBlank: true, showErrorMessage: true, errorStyle: 'warning',
            formulae: [`'${col.referencia.aba}'!$${ref}$2:$${ref}$1000`],
            errorTitle: col.titulo,
            error: `Não está na aba ${col.referencia.aba}. Se já existe no sistema, pode seguir.`,
          }
        } else if (col.tipo === 'data') {
          cel.dataValidation = {
            type: 'date', operator: 'between', allowBlank: true, showErrorMessage: true,
            formulae: [new Date(1930, 0, 1), new Date(2015, 11, 31)],
            errorTitle: col.titulo, error: 'Data no formato DD/MM/AAAA.',
          }
        } else if (col.tipo === 'inteiro') {
          cel.dataValidation = {
            type: 'whole', operator: col.chave === 'ano' ? 'between' : 'greaterThanOrEqual', allowBlank: true,
            showErrorMessage: true,
            formulae: col.chave === 'ano' ? [1950, 2100] : [0],
            errorTitle: col.titulo, error: col.chave === 'ano' ? 'Ano entre 1950 e 2100.' : 'Número inteiro, zero ou mais.',
          }
        }
      }
    })
    ws.getRow(1).height = 32
  }

  // ---- as listas (escondida) e a identidade da planilha ----
  const li = wb.addWorksheet('Listas', { state: 'veryHidden' })
  for (const a of ABAS) {
    for (const col of cols[a.chave]) {
      if (!col.lista?.length) continue
      const letra = letraLista(a.chave, col.chave)
      li.getCell(`${letra}1`).value = `${a.nome} · ${col.titulo}`
      col.lista.forEach((v, i) => { li.getCell(`${letra}${i + 2}`).value = v })
    }
  }
  // A cidade para a qual a planilha nasceu: a importação avisa se for
  // levada para outra (planilha de Belém importada em Manaus).
  li.getCell('Z1').value = 'cidade'
  li.getCell('Z2').value = c.cidade.codigo
  li.getCell('Z3').value = 'versao'
  li.getCell('Z4').value = VERSAO_MODELO

  const buf = await wb.xlsx.writeBuffer()
  salvar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `cadastro-${c.cidade.codigo}-planilha-padrao.xlsx`)
}

export const VERSAO_MODELO = 'cadastro-v1'

/** Cada lista fixa ganha uma coluna própria na aba Listas. */
const ORDEM_LISTAS = ['pessoas.criar_acesso', 'pessoas.perfil', 'pessoas.cargo', 'pessoas.skill',
  'pessoas.rotear', 'veiculos.tipo', 'veiculos.propriedade', 'veiculos.pernoite']
function letraLista(aba: ChaveAba, chave: string): string {
  const i = ORDEM_LISTAS.indexOf(`${aba}.${chave}`)
  return String.fromCharCode(65 + Math.max(0, i))
}

function salvar(b: Blob, nome: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(b)
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ----------------------------------------------------------------------------
// a leitura da planilha preenchida
// ----------------------------------------------------------------------------
export interface LinhaLida {
  linha: number
  [campo: string]: string | number
}

export interface ProblemaLocal { aba: string; linha: number; msg: string }

export interface PlanilhaLida {
  cidadeCodigo: string | null
  versao: string | null
  areas: LinhaLida[]
  equipes: LinhaLida[]
  pessoas: (LinhaLida & { perfil_acesso_id?: string; cargo_id?: string; papel?: string })[]
  veiculos: LinhaLida[]
  /** Erros que a tela pega antes do banco (formato de CPF, e-mail…). */
  problemas: ProblemaLocal[]
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '')
  .trim().toLowerCase()

function texto(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) {
    // Data do Excel chega como meia-noite UTC: lê em UTC para não virar o dia anterior.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
  }
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string }
    if (o.richText) return o.richText.map(t => t.text).join('').trim()
    if (o.text != null) return String(o.text).trim()
    if (o.result != null) return texto(o.result)
    return ''
  }
  return String(v).trim()
}

/** DD/MM/AAAA, AAAA-MM-DD ou data do Excel → AAAA-MM-DD. */
function dataIso(t: string): string | null {
  if (!t) return null
  let a: number, m: number, d: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
  if (iso) { a = +iso[1]; m = +iso[2]; d = +iso[3] }
  else if (br) { a = +br[3]; m = +br[2]; d = +br[1] }
  else return null
  // 31/02 o JavaScript aceita e vira 03/03, calado: confere se o dia existe.
  const x = new Date(Date.UTC(a, m - 1, d))
  if (x.getUTCFullYear() !== a || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== d) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const deRotulo = (mapa: Record<string, string>, v: string) => {
  if (!v) return ''
  const achado = Object.entries(mapa).find(([cod, rot]) => norm(rot) === norm(v) || norm(cod) === norm(v))
  return achado ? achado[0] : `?${v}`
}

export async function lerPreenchida(arquivo: File, c: Catalogos): Promise<PlanilhaLida> {
  const ExcelJS = (await import('exceljs')).default
  const wb: Workbook = new ExcelJS.Workbook()
  await wb.xlsx.load(await arquivo.arrayBuffer())
  const cols = colunas(c)
  const problemas: ProblemaLocal[] = []

  const faltando = ABAS.filter(a => !wb.getWorksheet(a.nome)).map(a => a.nome)
  if (faltando.length === ABAS.length) {
    throw new Error('Esta não é a planilha padrão do cadastro: não achei as abas Áreas, Equipes, Pessoas e Veículos. Baixe a planilha padrão e preencha nela.')
  }

  const li = wb.getWorksheet('Listas')
  const lido: PlanilhaLida = {
    cidadeCodigo: li ? texto(li.getCell('Z2').value) || null : null,
    versao: li ? texto(li.getCell('Z4').value) || null : null,
    areas: [], equipes: [], pessoas: [], veiculos: [], problemas,
  }

  for (const a of ABAS) {
    const ws: Worksheet | undefined = wb.getWorksheet(a.nome)
    if (!ws) continue
    // Cabeçalho pelo NOME (sem o *), não pela posição: coluna movida de
    // lugar continua sendo lida certo.
    const indice = new Map<number, Coluna>()
    ws.getRow(1).eachCell((cel, n) => {
      const col = cols[a.chave].find(x => norm(x.titulo) === norm(texto(cel.value)))
      if (col) indice.set(n, col)
    })
    const naoAchadas = cols[a.chave].filter(x => x.obrigatorio && ![...indice.values()].includes(x))
    if (naoAchadas.length) {
      problemas.push({ aba: a.nome, linha: 1, msg: `Cabeçalho sem a coluna obrigatória: ${naoAchadas.map(x => x.titulo).join(', ')}.` })
      continue
    }
    ws.eachRow((row, numero) => {
      if (numero === 1) return
      const o: LinhaLida = { linha: numero }
      let vazia = true
      indice.forEach((col, n) => {
        const t = texto(row.getCell(n).value)
        if (t) { o[col.chave] = t; vazia = false }
      })
      if (vazia) return
      for (const col of cols[a.chave]) {
        if (col.obrigatorio && !o[col.chave]) {
          problemas.push({ aba: a.nome, linha: numero, msg: `"${col.titulo}" é obrigatória.` })
        }
        if (col.lista && o[col.chave] && !col.lista.some(v => norm(v) === norm(String(o[col.chave])))) {
          problemas.push({ aba: a.nome, linha: numero, msg: `"${o[col.chave]}" não é um valor aceito em ${col.titulo}.` })
        }
      }
      ;(lido[a.chave] as LinhaLida[]).push(o)
    })
  }

  // ---- Pessoas: o que vai para a função de acesso, conferido aqui ----
  for (const p of lido.pessoas) {
    const s = (k: string) => String(p[k] ?? '')
    const nasc = dataIso(s('nascimento'))
    if (s('nascimento') && !nasc) problemas.push({ aba: 'Pessoas', linha: p.linha, msg: `Nascimento "${s('nascimento')}" não é uma data que existe — use DD/MM/AAAA.` })
    if (nasc) p.nascimento = nasc
    const querAcesso = !!s('email') && norm(s('criar_acesso') || 'SIM') !== 'nao'
    const e = conferirCadastro({
      nome: s('nome'), email: s('email'), cpf: s('cpf'), rg: s('rg'), whatsapp: s('whatsapp'),
      data_nascimento: nasc ?? '', matricula_ponto: s('matricula_ponto'), apelido: s('apelido'),
    }, { exigeEmail: !!s('email') })
    for (const msg of Object.values(e)) problemas.push({ aba: 'Pessoas', linha: p.linha, msg })

    const perfil = c.perfis.find(x => norm(x.nome) === norm(s('perfil')))
    if (perfil) { p.perfil_acesso_id = perfil.id; p.papel = perfil.papel ?? '' }
    if (querAcesso && !perfil) {
      problemas.push({ aba: 'Pessoas', linha: p.linha, msg: 'Para criar acesso, escolha o perfil de acesso (é ele que diz o que a pessoa enxerga).' })
    }
    const cargo = c.cargos.find(x => norm(x.nome) === norm(s('cargo')))
    if (cargo) p.cargo_id = cargo.id
    if (s('cpf')) p.cpf = soDigitos(s('cpf'))
    if (s('whatsapp')) p.whatsapp = soDigitos(s('whatsapp'))
    p.criar_acesso = norm(s('criar_acesso') || 'SIM') === 'nao' ? 'NAO' : 'SIM'
    p.rotear = norm(s('rotear') || 'SIM') === 'nao' ? 'NAO' : 'SIM'
  }

  // ---- Veículos: rótulo da lista → código do banco ----
  for (const v of lido.veiculos) {
    for (const [k, mapa] of [['tipo', TIPO_VEICULO], ['propriedade', PROPRIEDADE], ['pernoite', PERNOITE]] as const) {
      // Valor fora da lista já foi acusado acima, na conferência de lista.
      const cod = deRotulo(mapa, String(v[k] ?? ''))
      if (cod && !cod.startsWith('?')) v[k] = cod
    }
  }

  return lido
}

/** O que vai para `importar_cadastro_cidade` (sem os dados pessoais). */
export function paraOBanco(l: PlanilhaLida) {
  return {
    areas: l.areas,
    equipes: l.equipes,
    pessoas: l.pessoas.map(p => ({
      linha: p.linha, nome: p.nome, email: p.email ?? null, login_toa: p.login_toa ?? null,
      equipe: p.equipe ?? null, skill: p.skill ?? null, papel: p.papel ?? null,
      criar_acesso: p.criar_acesso, rotear: p.rotear,
    })),
    veiculos: l.veiculos,
  }
}

// ----------------------------------------------------------------------------
// o resultado, com as senhas — uma vez só
// ----------------------------------------------------------------------------
export interface ResultadoPessoa {
  linha: number; nome: string; email: string; senha: string | null
  perfil: string; situacao: string
}

export async function baixarResultado(cidade: string, linhas: ResultadoPessoa[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Acessos', { views: [{ state: 'frozen', ySplit: 2 }] })
  ws.getCell('A1').value = `Acessos criados — ${cidade} — ${new Date().toLocaleString('pt-BR')}. `
    + 'Senha temporária: repasse a cada pessoa e peça para trocar no primeiro acesso. Depois, APAGUE este arquivo.'
  ws.getCell('A1').font = { bold: true, color: { argb: VERMELHO } }
  ws.mergeCells('A1:F1')
  const cab = ['Linha', 'Nome', 'E-mail (login)', 'Senha temporária', 'Perfil', 'Situação']
  cab.forEach((t, i) => {
    const c = ws.getCell(2, i + 1)
    c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA } }
  })
  ;[8, 32, 32, 20, 18, 60].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  linhas.forEach((l, i) => {
    ws.getRow(i + 3).values = [l.linha, l.nome, l.email, l.senha ?? '—', l.perfil, l.situacao]
  })
  const buf = await wb.xlsx.writeBuffer()
  salvar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    // isoLocal, não toISOString: depois das 20h em Manaus o UTC já é amanhã.
    `acessos-${cidade.replace(/\W+/g, '-')}-${isoLocal()}.xlsx`)
}
