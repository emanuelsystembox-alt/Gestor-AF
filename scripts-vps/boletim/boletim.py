#!/usr/bin/env python3
"""Boletim do dia com IA (migration 265).

O BANCO prepara o boletim (07:00 e 18:10 de Manaus, pelo pg_cron) com os números e o texto
POR REGRA. Este script, no cron do host, pega os pendentes, pede ao Gemini o texto escrito e
grava. Se a IA falhar — rede, cota, "high demand", texto truncado, número fora dos dados —, o
boletim continua o da regra e a tela diz "por regra". O boletim nunca depende deste script.

O QUE VAI PARA A IA: só `boletim_dia.dados`, montado por lista branca no banco
(`dados_do_boletim`): números, códigos de baixa/agrupamento, código de equipe, node e área.
Nenhum nome de técnico, nenhum dado de cliente, nenhum número de contrato.

A CHAVE: lida de /opt/supabase/segredos/gemini_api_key só dentro de `chamar_gemini`, vai no
cabeçalho `x-goog-api-key` (nunca na URL, que aparece em mensagem de erro) e nunca é escrita
em log, saída ou banco.

Só biblioteca padrão (a VPS tem python3, sem pip). Rode com `python3 -I`.

Uso:
  boletim.py                 escreve com IA os boletins pendentes (o que o cron chama)
  boletim.py --teste ARQ     manda ARQ (o jsonb `dados`) a UM modelo e imprime o texto; não grava
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

CHAVE = '/opt/supabase/segredos/gemini_api_key'
# Principal: o flash-lite (o que respondeu no teste de 12/11). Segunda opção: um "flash".
MODELOS = [m.strip() for m in os.environ.get(
    'BOLETIM_MODELOS', 'gemini-3.5-flash-lite,gemini-flash-latest').split(',') if m.strip()]
API = 'https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent'
TEMPO_LIMITE = 45            # segundos por chamada
MAX_CARACTERES = 2500        # o banco recusa acima de 3000
PSQL = ['docker', 'exec', '-i', 'supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres',
        '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1']

INSTRUCAO = """Você escreve o boletim operacional de UMA cidade para a gestão da AFLINE, prestadora de serviços técnicos da operadora CLARO (instalação e manutenção de internet e TV).

Regras obrigatórias:
- Use SOMENTE os números do JSON. Não calcule, não some, não subtraia e não arredonde de outro jeito; não invente número, nome, causa ou contrato. Se um dado estiver null ou listado em "indisponivel", diga que não há o dado.
- Cite equipe só pelo código ("equipe 111"); node e área pelo código.
- Português do Brasil, direto, frases curtas. Sem saudação, sem assinatura, sem título. Texto puro: sem markdown, sem asterisco, sem #.
- Porcentagem com vírgula e o sinal: 93,6%.
- No máximo 150 palavras.
- Ação é da operação (redistribuir, acompanhar equipe, conferir contrato na tela, levar node à CLARO). Nunca proponha mudar meta nem falar com cliente.
- {momento}

Glossário dos campos:
- TEC1 = % das O.S. encerradas dentro da janela mais a tolerância (meta 94%). "salvar_para_a_meta" = O.S. previstas sem padrão que precisam virar com padrão para o TEC1 chegar à meta.
- quebra = O.S. com baixa improdutiva; "quebras_por_agrupamento" agrupa pela causa (AGENDAMENTO, PROCESSO VENDA, INFRA CLARO...).
- revisitas = serviço concluído que voltou em até 30 dias. "revisita_30d" (VT) = visita técnica que voltou como visita técnica em até 30 dias.
- VT = visita técnica (manutenção). "atraso_nos_marcos": equipes de VT que baixaram menos que o esperado nos horários marcados; "maior_falta" = quantos contratos faltaram no pior marco.
- "nao_cabem_na_jornada" = contratos cuja previsão de fim passa do fim da jornada.
- risco de quebra e de revisita: contagem por faixa (alto, médio, baixo) pela régua histórica da cidade.
- node em degradação = vários VT no mesmo node com indício de falha da rede da CLARO, não do técnico.
- "cobertura" = quantos contratos do dia já estavam importados do TOA na hora dos números, e o total do mesmo dia da semana passada.
- "abaixo_do_ritmo" = técnicos com menos contratos feitos que o esperado até o corte; a lista traz a equipe de cada um."""

MOMENTO = {
    'MANHA': ('É o boletim das 07h: o plano do dia. Em 2 ou 3 frases, o que mais preocupa HOJE '
              '(carga por janela e área, VT por equipe, TEC1 previsto e o que não cabe, risco de '
              'quebra, node em degradação). Comece pela cobertura com os números dela (contratos '
              'importados, hora da última importação e o total do mesmo dia da semana passada), sem '
              'concluir se falta importar. Termine com exatamente 3 ações para hoje, numeradas '
              '1., 2. e 3., uma por linha.'),
    'NOITE': ('É o boletim das 18h: o fechamento do dia. Fale do TEC1, da conclusão, das quebras por '
              'agrupamento, das revisitas, das equipes atrasadas e do acerto da previsão; compare com '
              'a semana passada quando o dado existir. Termine com exatamente 3 ações para amanhã, '
              'numeradas 1., 2. e 3., uma por linha.'),
}


class Falha(Exception):
    """Falha da IA. A mensagem vai para `boletim_dia.ia_erro`: nunca ponha a chave nela."""


def psql(sql, variaveis=None):
    cmd = list(PSQL)
    for k, v in (variaveis or {}).items():
        cmd += ['-v', f'{k}={v}']
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f'psql: {r.stderr.strip()[:300]}')
    return r.stdout.strip()


def pendentes():
    return json.loads(psql('select public.boletins_pendentes()::text;') or '[]')


def chamar_gemini(modelo, momento, dados):
    corpo = json.dumps({
        'systemInstruction': {'parts': [{'text': INSTRUCAO.format(momento=MOMENTO[momento])}]},
        'contents': [{'role': 'user', 'parts': [{'text': 'Dados do boletim (JSON):\n'
                                                 + json.dumps(dados, ensure_ascii=False)}]}],
        'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 2048},
    }).encode('utf-8')
    with open(CHAVE, encoding='ascii') as f:
        req = urllib.request.Request(API.format(modelo), data=corpo, method='POST', headers={
            'Content-Type': 'application/json', 'x-goog-api-key': f.read().strip()})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TEMPO_LIMITE) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            err = json.load(e).get('error', {})
        except Exception:
            err = {}
        raise Falha(f'{modelo}: HTTP {e.code} {err.get("status", "")}: {str(err.get("message", ""))[:160]}')
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise Falha(f'{modelo}: rede: {getattr(e, "reason", e)}')
    finally:
        del req          # o objeto com o cabeçalho da chave não sobrevive à chamada
    ms = round((time.monotonic() - t0) * 1000)

    u = resp.get('usageMetadata') or {}
    uso = {'modelo': resp.get('modelVersion') or modelo, 'ms': ms,
           'tokens_entrada': u.get('promptTokenCount'), 'tokens_saida': u.get('candidatesTokenCount'),
           'tokens_pensamento': u.get('thoughtsTokenCount'), 'tokens_total': u.get('totalTokenCount')}
    cands = resp.get('candidates') or []
    if not cands:
        raise Falha(f'{modelo}: sem resposta ({(resp.get("promptFeedback") or {}).get("blockReason")})')
    fim = cands[0].get('finishReason')
    texto = ''.join(p.get('text', '') for p in (cands[0].get('content') or {}).get('parts', [])
                    if not p.get('thought'))
    if fim not in (None, 'STOP'):
        raise Falha(f'{modelo}: terminou em {fim}')
    return limpar(texto), uso


def limpar(texto):
    t = texto.replace('**', '').replace('__', '')
    t = re.sub(r'^\s*#+\s*', '', t, flags=re.M)
    t = re.sub(r'^\s*[*•]\s+', '- ', t, flags=re.M)
    t = re.sub(r'\n{3,}', '\n\n', t).strip()
    return t[:MAX_CARACTERES]


_NUM = re.compile(r'\d+(?:[.,]\d+)?')
_HORA = re.compile(r'\b\d{1,2}(?::\d{2}|h\d{0,2})\b')


def _numeros(s):
    return {float(x.replace(',', '.')) for x in _NUM.findall(s)}


def numeros_fora(texto, dados):
    """Os números do texto que NÃO estão nos dados — a IA calculou ou inventou.
    Hora ("07h", "18:00") e a numeração das ações (1, 2, 3) não contam."""
    permitidos = _numeros(json.dumps(dados, ensure_ascii=False)) | {1.0, 2.0, 3.0}
    return sorted(n for n in _numeros(_HORA.sub(' ', texto)) if n not in permitidos)


def escrever(item):
    """Tenta os modelos em ordem. Devolve (texto, modelo, uso, erro)."""
    erros, uso = [], None
    for modelo in MODELOS:
        try:
            texto, uso = chamar_gemini(modelo, item['momento'], item['dados'])
        except Falha as e:
            erros.append(str(e))
            continue
        if len(texto) < 40:
            erros.append(f'{modelo}: texto curto demais ({len(texto)} caracteres)')
            continue
        fora = numeros_fora(texto, item['dados'])
        if fora:
            erros.append(f'{modelo}: número fora dos dados: {", ".join(f"{n:g}" for n in fora[:5])}')
            continue
        return texto, uso['modelo'], uso, None
    return None, None, uso, ' | '.join(erros)[:500]


def gravar(item, texto, modelo, uso, erro):
    return psql("select public.gravar_boletim(:'base'::uuid, :'dia'::date, :'momento', "
                "nullif(:'texto', ''), nullif(:'modelo', ''), nullif(:'uso', '')::jsonb, "
                "nullif(:'erro', ''));",
                {'base': item['base_id'], 'dia': item['dia'], 'momento': item['momento'],
                 'texto': texto or '', 'modelo': modelo or '',
                 'uso': json.dumps(uso) if uso else '', 'erro': erro or ''})


def main():
    agora = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())
    if len(sys.argv) == 3 and sys.argv[1] == '--teste':
        with open(sys.argv[2], encoding='utf-8') as f:
            dados = json.load(f)
        try:
            texto, uso = chamar_gemini(MODELOS[0], dados['momento'], dados)
        except Falha as e:
            print(json.dumps({'erro': str(e)}, ensure_ascii=False))
            return 1
        print(json.dumps({'uso': uso, 'numeros_fora': numeros_fora(texto, dados), 'texto': texto},
                         ensure_ascii=False, indent=1))
        return 0

    for item in pendentes():
        texto, modelo, uso, erro = escrever(item)
        r = gravar(item, texto, modelo, uso, erro)
        # Log: sem texto e sem chave. Base, momento, resultado, modelo, tokens, tempo, erro.
        print(f'{agora}Z base={item["base_id"]} dia={item["dia"]} {item["momento"]} '
              f'tentativa={item["tentativas"] + 1} -> {r} modelo={modelo or "-"} '
              f'tokens={(uso or {}).get("tokens_total")} ms={(uso or {}).get("ms")} '
              f'erro={erro or "-"}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
