# deploy-worker.ps1 - deploys ONLY the Worker (itp-itr-api) to Cloudflare.
# Does NOT touch D1 migrations, the frontend build, or user seeding.
# Launch via RUN-WORKER-DEPLOY.cmd. Logs to worker-deploy-log.txt.
# The token line is scrubbed from this file after a successful run.

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
Start-Transcript -Path (Join-Path $PSScriptRoot "worker-deploy-log.txt") -Force | Out-Null

function Fail($msg) {
  Write-Host ""
  Write-Host "ERROR: $msg" -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}

$token = "TOKEN-REMOVED"
if ($token -eq "TOKEN-REMOVED") { Fail "This script already ran and its token was scrubbed. Add a fresh token." }
$env:CLOUDFLARE_API_TOKEN = $token

$wrangler = "./node_modules/wrangler/bin/wrangler.js"
if (-not (Test-Path $wrangler)) { Fail "wrangler not found in node_modules - this file must sit in the repo root." }

# ---- 0. Verify token (cfat_ account tokens do not pass /user/tokens/verify;
#         verify via /accounts instead - see HANDOVER-2026-08-05.md) ----------
Write-Host "Verifying API token..." -ForegroundColor Cyan
$headers = @{ Authorization = "Bearer $token" }
$verified = $false
try {
  $acct = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts" -Headers $headers
  if ($acct.success -and $acct.result.Count -ge 1) {
    $env:CLOUDFLARE_ACCOUNT_ID = $acct.result[0].id
    Write-Host ("Using Cloudflare account: " + $acct.result[0].name + " (" + $acct.result[0].id + ")") -ForegroundColor Green
    $verified = $true
  }
} catch { }
if (-not $verified) {
  try {
    $verify = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify" -Headers $headers
    if ($verify.success) { $verified = $true; Write-Host "User token OK" -ForegroundColor Green }
  } catch { }
}
if (-not $verified) {
  Fail "Cloudflare rejected this token (401). It may have been revoked or mistyped. Create a fresh token via My Profile > API Tokens > Create Token > Edit Cloudflare Workers template, and update the token line in this script."
}

# ---- 1. Deploy the Worker ---------------------------------------------------
Write-Host ""
Write-Host "Deploying the Worker (itp-itr-api)..." -ForegroundColor Cyan
$deployOut = (node $wrangler deploy --config api/wrangler.toml 2>&1 | ForEach-Object { "$_" }) -join "`n"
Write-Host $deployOut
if ($LASTEXITCODE -ne 0) {
  if ($deployOut -match "Authentication error|code: 10000|403") {
    Fail "Deploy failed with an auth/permission error. This token likely lacks Workers Scripts:Edit - it may be the R2-only token. Create a token from the Edit Cloudflare Workers template and update the token line in this script."
  }
  Fail "Worker deploy failed - see output above."
}
$workerUrl = $null
if ($deployOut -match 'https://[a-z0-9.-]+\.workers\.dev') { $workerUrl = $Matches[0] }

# ---- 2. Scrub the token from this file --------------------------------------
try {
  $self = Get-Content $PSCommandPath -Raw
  $self = $self.Replace($token, "TOKEN-REMOVED")
  Set-Content $PSCommandPath $self -NoNewline
  Write-Host ""
  Write-Host "Token scrubbed from deploy-worker.ps1." -ForegroundColor Green
} catch { Write-Host "Could not scrub the token - delete deploy-worker.ps1 manually." -ForegroundColor Yellow }

# ---- Done -------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host " WORKER DEPLOY COMPLETE" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
if ($workerUrl) { Write-Host " API (Worker):  $workerUrl" }
Write-Host " Note: the token is scrubbed from this script but NOT revoked."
try { Stop-Transcript | Out-Null } catch { }
