/**
 * Termo de responsabilidade em A4 — o papel que o técnico assina.
 *
 * ┌─ DE ONDE VEIO ───────────────────────────────────────────────────┐
 * │ O concorrente imprime, da carga da equipe e de cada remessa:      │
 * │ "Imprimir em A4", "Imprimir Cupom" e "Termo de Responsabilidade   │
 * │ A4" (Alfa Gestor → Alocações → Opções). O Emanuel mandou seguir a │
 * │ regra deles (D-163). Aqui entra o A4, que é o que se arquiva.     │
 * │                                                                   │
 * │ O TEXTO da declaração é nosso e neutro: o PDF deles é gerado no   │
 * │ servidor e não foi baixado. Se a AFLINE tiver um texto jurídico   │
 * │ próprio, ele entra em DECLARACAO, e só ali.                       │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * Abre uma janela com HTML simples e chama a impressão do navegador —
 * "Salvar como PDF" sai de graça. Nada de biblioteca de PDF: seria peso
 * no bundle para fazer o que o navegador já faz.
 */

export interface LinhaTermo { serial: string; tipo: string | null; modelo: string | null; obs?: string | null }
export interface MiscTermo { codigo: string; nome: string; quantidade: number; unidade: string }

export interface DadosTermo {
  titulo: string
  /** Ex.: "Romaneio 12 · entrega", "Carga em 26/09/2026". */
  referencia: string
  tecnico: { nome: string; matricula: string | null }
  pecas: LinhaTermo[]
  misc?: MiscTermo[]
  /** Como e quando foi aceito, quando já foi. */
  aceite?: string | null
  observacao?: string | null
}

const DECLARACAO =
  'Declaro que recebi os equipamentos e materiais relacionados abaixo, em ' +
  'comodato da operadora sob guarda da AFLINE, e que ficam sob minha ' +
  'responsabilidade até a instalação no endereço do cliente ou a devolução ' +
  'ao almoxarifado.'

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function imprimirTermo(d: DadosTermo): boolean {
  const pecas = d.pecas.map((p, i) => `
    <tr><td class="n">${i + 1}</td><td class="mono">${esc(p.serial)}</td>
        <td>${esc(p.tipo) || '—'}</td><td>${esc(p.modelo) || '—'}</td>
        <td>${esc(p.obs)}</td></tr>`).join('')
  const misc = (d.misc ?? []).map(m => `
    <tr><td class="mono">${esc(m.codigo)}</td><td>${esc(m.nome)}</td>
        <td class="n">${m.quantidade.toLocaleString('pt-BR')} ${esc(m.unidade)}</td></tr>`).join('')

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(d.titulo)} — ${esc(d.tecnico.nome)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font: 11pt/1.4 system-ui, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  .ref { color: #444; margin-bottom: 6mm; }
  .quem { border: 1px solid #999; padding: 3mm 4mm; margin-bottom: 5mm; }
  p.decl { margin: 0 0 5mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; font-size: 10pt; }
  th, td { border: 1px solid #999; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  th { background: #eee; }
  td.n { text-align: right; white-space: nowrap; }
  .mono { font-family: ui-monospace, Consolas, monospace; }
  h2 { font-size: 11pt; margin: 0 0 2mm; }
  .assin { display: flex; gap: 12mm; margin-top: 18mm; }
  .assin div { flex: 1; border-top: 1px solid #111; padding-top: 1.5mm; text-align: center; font-size: 10pt; }
  .rodape { margin-top: 8mm; font-size: 9pt; color: #555; }
</style></head><body>
<h1>${esc(d.titulo)}</h1>
<div class="ref">${esc(d.referencia)} · impresso em ${esc(new Date().toLocaleString('pt-BR'))}</div>
<div class="quem"><strong>${esc(d.tecnico.nome)}</strong>${d.tecnico.matricula ? ` · matrícula ${esc(d.tecnico.matricula)}` : ''}</div>
<p class="decl">${esc(DECLARACAO)}</p>
<h2>Equipamentos · ${d.pecas.length}</h2>
${d.pecas.length ? `<table><thead><tr><th>#</th><th>Serial</th><th>Tipo</th><th>Modelo</th><th>Obs.</th></tr></thead><tbody>${pecas}</tbody></table>` : '<p>Nenhum equipamento.</p>'}
${d.misc && d.misc.length ? `<h2>Materiais · ${d.misc.length}</h2><table><thead><tr><th>Código</th><th>Item</th><th>Quantidade</th></tr></thead><tbody>${misc}</tbody></table>` : ''}
${d.observacao ? `<p><strong>Observação:</strong> ${esc(d.observacao)}</p>` : ''}
<div class="assin"><div>${esc(d.tecnico.nome)}<br>técnico</div><div>almoxarifado</div></div>
<div class="rodape">${d.aceite ? esc(d.aceite) : 'Aceite ainda não registrado no sistema.'}</div>
<script>window.onload = () => { window.focus(); window.print() }</script>
</body></html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return false          // bloqueador de janela: quem chama avisa
  w.document.open(); w.document.write(html); w.document.close()
  return true
}

/** "aceito pelo técnico no aparelho (biometria ou senha do celular) em …" */
export function rotuloAceite(metodo: string | null | undefined, quando: string | null | undefined): string | null {
  if (!quando) return null
  const em = new Date(quando).toLocaleString('pt-BR')
  switch (metodo) {
    case 'APARELHO': return `Aceito pelo técnico no celular (biometria ou bloqueio do aparelho) em ${em}.`
    case 'SENHA':    return `Aceito pelo técnico no celular, com a senha do sistema, em ${em}.`
    case 'BALCAO':   return `Confirmado no balcão do almoxarifado em ${em}.`
    default:         return `Confirmado em ${em}.`
  }
}
