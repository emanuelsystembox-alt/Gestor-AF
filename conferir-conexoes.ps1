# Confere se esta maquina tem todas as conexoes do projeto vivas.
# Nao mostra nenhum segredo: so diz OK / FALHA. Ver docs/13-CONEXOES-E-CHAVES.md.
#   powershell -ExecutionPolicy Bypass -File .\conferir-conexoes.ps1
# (Texto sem acento de proposito: o PowerShell 5.1 le script sem BOM como ANSI.)

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$falhas = 0

function Item($nome, $ok, $dica) {
  if ($ok) { Write-Host ("[ OK  ] " + $nome) -ForegroundColor Green }
  else {
    Write-Host ("[FALHA] " + $nome + "  ->  " + $dica) -ForegroundColor Red
    $script:falhas++
  }
}

# 1. SSH da VPS (o banco mora la)
$ssh = & ssh -o BatchMode=yes -o ConnectTimeout=10 root@187.41.127.166 "test -r /opt/supabase/.env && docker ps --format '{{.Names}}' | grep -c supabase" 2>$null
Item "SSH root@187.41.127.166 e o Supabase da VPS" ($LASTEXITCODE -eq 0 -and [int]("0" + $ssh) -gt 0) "chave ~/.ssh/id_ed25519 (secoes 2 e 4 do doc)"

# 2. Banco respondendo
$q = & ssh -o BatchMode=yes -o ConnectTimeout=10 root@187.41.127.166 "docker exec supabase-db psql -U postgres -d postgres -Atc 'select hoje_local()'" 2>$null
Item "Banco (psql na VPS) respondendo" ($LASTEXITCODE -eq 0 -and $q) "docker do Supabase na VPS (docs/12-VPS-ERP.md)"

# 3. MCPs do Claude Code
$mcp = (& claude mcp list 2>$null) -join "`n"
Item "MCP hostinger-api conectado" ($mcp -match "hostinger-api:.*Connected") "~/.claude.json (secoes 1 e 4 do doc)"
Item "MCP do Expo (plugin) conectado" ($mcp -match "plugin:expo:expo:.*Connected") "/plugin install expo@claude-plugins-official e /mcp"

# 4. Cloudflare
Push-Location (Join-Path $raiz "app")
$cf = (& npx --yes wrangler whoami 2>$null) -join "`n"
Pop-Location
Item "Cloudflare (wrangler) logado" ($cf -match "logged in") "cd app ; npx wrangler login"

# 5. Expo / EAS
Push-Location (Join-Path $raiz "campo")
$eas = (& npx --yes eas-cli@latest whoami 2>$null) -join "`n"
Pop-Location
Item "Expo / EAS logado" ($eas -match "afline-instalacao-e-manutencao-eletrica") "cd campo ; npx eas-cli@latest login"

# 6. GitHub (push)
& git -C $raiz ls-remote origin HEAD *> $null
Item "GitHub (git push pelo Credential Manager)" ($LASTEXITCODE -eq 0) "git push pede o login uma vez"

# 7. Os .env (so confere que as chaves existem, sem ler valor)
function TemChaves($arquivo, $chaves) {
  if (-not (Test-Path $arquivo)) { return $false }
  $t = Get-Content $arquivo -Raw
  foreach ($c in $chaves) { if ($t -notmatch ("(?m)^" + $c + "=\S+")) { return $false } }
  return $true
}
Item "app/.env completo" (TemChaves (Join-Path $raiz "app\.env") @("VITE_SUPABASE_URL","VITE_SUPABASE_ANON_KEY","VITE_GOOGLE_MAPS_API_KEY")) "copiar de app/.env.example e preencher"
Item "campo/.env completo" (TemChaves (Join-Path $raiz "campo\.env") @("EXPO_PUBLIC_SUPABASE_URL","EXPO_PUBLIC_SUPABASE_ANON_KEY","GOOGLE_MAPS_ANDROID_KEY")) "copiar de campo/.env.example e preencher"

# 8. A API publica do Supabase (o que o site e o app usam)
try {
  $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 "https://api.pulsoline.grupoafline.com.br/auth/v1/health" -ErrorAction Stop
  $api = $true
} catch { $api = ($_.Exception.Response -ne $null) }
Item "API https://api.pulsoline.grupoafline.com.br no ar" $api "Caddy / Supabase na VPS"

Write-Host ""
if ($falhas -eq 0) { Write-Host "Tudo conectado." -ForegroundColor Green }
else { Write-Host ("$falhas item(ns) com falha - ver docs/13-CONEXOES-E-CHAVES.md") -ForegroundColor Yellow }
