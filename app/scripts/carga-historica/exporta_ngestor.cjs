// Converte a planilha anual do ngestor em uma linha JSON por visita, para
// a carga histórica (docs/14-CARGA-HISTORICA.md, D-282).
// A SAÍDA TEM DADO DE CLIENTE (nome, telefone, endereço — LGPD): grave numa
// pasta temporária, nunca no repositório, e apague depois da carga.
// Uso: node app/scripts/carga-historica/exporta_ngestor.cjs <raiz do projeto> <planilha.xlsx> <saida.jsonl>

// ADAPTE: o início da coluna "Operação" → o `op` que carga.sql conhece
const CIDADES = [['MANAUS', 'MAN'], ['SAO LUIS', 'SLS']]
// ADAPTE: o período da carga (linha fora dele tenta a "Data Situação")
const DE = '2026-01-01', ATE = '2026-10-31'
const path = require('path'); const fs = require('fs')
const XLSX = require(path.resolve(process.argv[2], 'app/node_modules/xlsx'))
const wb = XLSX.readFile(process.argv[3], { cellDates: true, dense: true })
const m = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1, raw: false, defval: '', blankrows: false })
const h = m[0]; const L = m.slice(1)
const ix = n => { const i = h.indexOf(n); if (i < 0) throw new Error('coluna ' + n); return i }
const C = {}; for (const n of h) C[n] = ix(n)
const t = (r, n) => String(r[C[n]] ?? '').replace(/\r/g, '').trim()
const nulo = v => (v === '' ? null : v)

// m/d/aa (o ngestor exporta em formato americano) → AAAA-MM-DD, só dentro de DE..ATE
function data(v) {
  const p = v.split('/'); if (p.length !== 3) return null
  const mes = +p[0], dia = +p[1], ano = 2000 + (+p[2] % 100)
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  const iso = d.toISOString().slice(0, 10)
  return iso >= DE && iso <= ATE ? iso : null
}
const num = v => { const x = Number(String(v).replace(',', '.')); return v !== '' && Number.isFinite(x) && x !== 0 ? x : null }
const SIT = { 'concluido': 'CONCLUIDA', 'cancelado': 'CANCELADA', 'reagendamento': 'REAGENDAMENTO',
  'entrada - in box': 'ENTRADA', 'em execução': 'EM_EXECUCAO', 'em deslocamento': 'EM_DESLOCAMENTO',
  'com impedimento': 'COM_IMPEDIMENTO' }

let fora = 0, semData = 0
const out = fs.createWriteStream(process.argv[4])
for (const r of L) {
  const op = (CIDADES.find(([ini]) => t(r, 'Operação').toUpperCase().startsWith(ini)) ?? [])[1] ?? null
  if (!op) { fora++; continue }
  const dt = data(t(r, 'Data Agendamento')) ?? data(t(r, 'Data Situação'))
  if (!dt) { semData++; continue }
  const dsitD = data(t(r, 'Data Situação')) ?? (() => {
    // data da situação pode ser 01–02/11 (baixa no dia seguinte): aceita até 30/11
    const p = t(r, 'Data Situação').split('/'); if (p.length !== 3) return null
    const iso = `20${p[2].padStart(2, '0').slice(-2)}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`
    return /^2026-1[01]-\d\d$/.test(iso) ? iso : null })()
  const hr = /^\d{1,2}:\d{2}(:\d{2})?$/.test(t(r, 'Situação Hr')) ? t(r, 'Situação Hr').padStart(8, '0') : null
  const per = t(r, 'Periodo'); const jm = per.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/)
  const os = []
  for (const p of t(r, 'OS').split(/\n|,(?=\s*\d{8})/)) {
    const mm = p.trim().match(/^(\d{8,12})\s*-\s*(.*)$/)
    if (mm) os.push([mm[1], mm[2].replace(/^\d{4,6}\s*-\s*/, '').trim()])
  }
  const codNg = t(r, 'Código De Baixa Ngestor').match(/^(-?\d+)/)
  const codToa = t(r, 'Código De Baixa Toa').match(/^(\d+)/)
  const tec1 = { 'COM PADRAO': 'PADRAO', 'SEM PADRAO': 'SEM_PADRAO' }[t(r, 'Tec Um')] ?? null
  const linha = {
    id: t(r, 'ID'), op,
    origem: t(r, 'Origem') === 'TOA' ? 'TOA' : 'MANUAL',
    st_op: { 'EXECUTADA': 'EXECUTADA', 'NãO EXECUTADA': 'NAO_EXECUTADA', 'NÃO EXECUTADA': 'NAO_EXECUTADA' }[t(r, 'Status Operadora')] ?? null,
    cod_toa: codToa ? +codToa[1] : null,
    wo: nulo(t(r, 'WO')), contrato: nulo(t(r, 'Contrato')), grupo: nulo(t(r, 'Tipo de Serviço')),
    os, dt,
    ji: jm ? jm[1] : null, jf: jm ? jm[2] : null, imed: per === 'IMEDIATA',
    equipe: t(r, 'Equipe'), sit: SIT[t(r, 'Situação').toLowerCase()] ?? 'ENTRADA',
    cod_ng: codNg ? +codNg[1] : null, cod_ng_txt: nulo(t(r, 'Código De Baixa Ngestor')),
    dsit: dsitD && hr ? `${dsitD} ${hr}` : null,
    tec1, obs: nulo(t(r, 'Observação')), cliente: nulo(t(r, 'Cliente')),
    node: nulo(t(r, 'Node')), area: nulo(t(r, 'Área')), end: nulo(t(r, 'Endereço')),
    res: ['CASA', 'APTO'].includes(t(r, 'Tipo De Residência')) ? t(r, 'Tipo De Residência') : null,
    bairro: nulo(t(r, 'Bairro')), cep: nulo(t(r, 'CEP')), cidade: nulo(t(r, 'Cidade')), uf: nulo(t(r, 'Estado').slice(0, 2)),
    tel: t(r, 'Telefones').split(',').map(x => x.trim()).filter(Boolean),
    pessoa: ['FISICA', 'JURIDICA'].includes(t(r, 'TipoDePessoa')) ? t(r, 'TipoDePessoa') : null,
    clat: num(t(r, 'Lat_Cliente')), clng: num(t(r, 'Lng_Cliente')),
    elat: num(t(r, 'Lat_Equipe')), elng: num(t(r, 'Lng_Equipe')),
    login: nulo(t(r, 'Login')),
    extra: {
      'ID ngestor': t(r, 'ID'), 'Bucket': nulo(t(r, 'Bucket')), 'Monitor': nulo(t(r, 'Monitor')),
      'Marcadores': nulo(t(r, 'Marcadores')), 'Equi. Instalado': nulo(t(r, 'Equi. Instalado')),
      'Equi. Retirado': nulo(t(r, 'Equi. Retirado')), 'Obs. Operadora': nulo(t(r, 'Obs. Operadora')),
      'Sub-Falha': nulo(t(r, 'Sub-Falha')), 'Tempo De Conclusão': nulo(t(r, 'Tempo De Conclusão')),
      'Pontuação': nulo(t(r, 'Pontuação')), 'Data Abertura': nulo(t(r, 'Data Abertura')),
      'Código De Baixa Ngestor': nulo(t(r, 'Código De Baixa Ngestor')),
      'Login': nulo(t(r, 'Login')), 'Equipe': nulo(t(r, 'Equipe')),
    },
  }
  out.write(JSON.stringify(linha) + '\n')
}
out.end()
console.log(JSON.stringify({ lidas: L.length, fora_de_operacao: fora, sem_data_valida: semData }))
