# Boletim do dia com IA (migration 265)

O banco prepara o boletim por regra às 07:00 e às 18:10 de Manaus (pg_cron). Este script,
no cron do host, troca o texto pelo do Gemini quando a IA responde. Sem o script, o
boletim continua saindo, só que por regra.

| arquivo | vai para |
|---|---|
| `boletim.py` | `/opt/afline/boletim/boletim.py` |
| `boletim.sh` | `/opt/afline/boletim/boletim.sh` |
| `afline-boletim.cron` | `/etc/cron.d/afline-boletim` (sem ponto no nome, senão o cron ignora) |

A chave fica onde já está: `/opt/supabase/segredos/gemini_api_key` (root, 600). O script lê
o arquivo só na hora da chamada. Não copie a chave para lugar nenhum.

## Instalar (depois de aplicar a 265)

Do PowerShell, na raiz do repositório, uma linha por vez:

```powershell
ssh root@187.41.127.166 "mkdir -p /opt/afline/boletim"
scp scripts-vps/boletim/boletim.py scripts-vps/boletim/boletim.sh root@187.41.127.166:/opt/afline/boletim/
scp scripts-vps/boletim/afline-boletim.cron root@187.41.127.166:/etc/cron.d/afline-boletim
ssh root@187.41.127.166 "sed -i 's/\r$//' /opt/afline/boletim/boletim.py /opt/afline/boletim/boletim.sh /etc/cron.d/afline-boletim"
ssh root@187.41.127.166 "chmod 700 /opt/afline/boletim/boletim.sh; chmod 600 /opt/afline/boletim/boletim.py; chmod 644 /etc/cron.d/afline-boletim"
```

O `sed` tira o `\r`: com `core.autocrlf` ligado, o Git do Windows entrega `.py` e `.cron`
com CRLF, e o cron recusa linha com `\r`.

## Conferir

Rodar uma vez à mão (só escreve se houver boletim pendente de hoje ou de ontem):

```powershell
ssh root@187.41.127.166 "/opt/afline/boletim/boletim.sh"
ssh root@187.41.127.166 "tail -5 /var/log/afline-boletim.log"
```

O log tem uma linha por boletim: base, momento, `IA` ou `REGRA`, modelo, tokens, tempo e o
erro. Não tem o texto nem a chave.

No banco, o que saiu e por quê:

```powershell
ssh root@187.41.127.166 "docker exec supabase-db psql -U postgres -d postgres -c 'select base_id, dia, momento, fonte, modelo, ia_tentativas, ia_erro from boletim_dia order by dia desc, momento limit 8'"
```

Refazer o boletim de hoje (números novos, texto por regra; a IA tenta de novo na próxima
rodada do cron, se ainda estiver na janela):

```powershell
"select rodar_por_cidade('preparar_boletim_manha');" | ssh root@187.41.127.166 "docker exec -i supabase-db psql -U postgres -d postgres"
```

(O SQL vai pela entrada, não dentro das aspas do `ssh`: o PowerShell 5.1 corta aspas
duplas internas.)

## Desligar a IA

```powershell
ssh root@187.41.127.166 "rm /etc/cron.d/afline-boletim"
```

O boletim continua saindo por regra (quem prepara é o banco).

## Trocar o modelo

O principal é `gemini-3.5-flash-lite`; a segunda opção, `gemini-flash-latest`. Para mudar,
ponha a variável no `boletim.sh`, antes do `python3`:

```bash
export BOLETIM_MODELOS=gemini-3.5-flash-lite,gemini-flash-latest
```

## Medido em 13/11 (3 chamadas, só teste)

`gemini-3.5-flash-lite`: 1,3 a 1,7 s por boletim, ~2.100 tokens de entrada e 180 a 300 de
saída. Duas cidades × dois boletins por dia = 4 chamadas, ~9.500 tokens por dia.
