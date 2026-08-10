# deploy-with-token.ps1 - one-shot Cloudflare deploy for the ITP/ITR app.
# Fully non-interactive. Launch via RUN-DEPLOY.cmd. Logs to deploy-log.txt.
# The token line is scrubbed from this file after a successful run.

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
Start-Transcript -Path (Join-Path $PSScriptRoot "deploy-log.txt") -Force | Out-Null

function Fail($msg) {
  Write-Host ""
  Write-Host "ERROR: $msg" -ForegroundColor Red
  try { Stop-Transcript | Out-Null } catch { }
  exit 1
}

$token = "TOKEN-REMOVED"
$r2Token = "TOKEN-REMOVED"
if ($token -eq "TOKEN-REMOVED") { Fail "This script already ran and its token was scrubbed. Add a fresh token." }
$env:CLOUDFLARE_API_TOKEN = $token
$wrangler = "./node_modules/wrangler/bin/wrangler.js"
if (-not (Test-Path $wrangler)) { Fail "wrangler not found in node_modules - this file must sit in the repo root." }

# ---- 0. Verify token (works for both User and Account-owned tokens) ---------
Write-Host "Verifying API token..." -ForegroundColor Cyan
$headers = @{ Authorization = "Bearer $token" }
$verified = $false
try {
  $verify = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify" -Headers $headers
  if ($verify.success) { $verified = $true; Write-Host "User token OK" -ForegroundColor Green }
} catch { }
try {
  $acct = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts" -Headers $headers
  if ($acct.success -and $acct.result.Count -ge 1) {
    $env:CLOUDFLARE_ACCOUNT_ID = $acct.result[0].id
    Write-Host ("Using Cloudflare account: " + $acct.result[0].name + " (" + $acct.result[0].id + ")") -ForegroundColor Green
    $verified = $true
  }
} catch { }
if (-not $verified) {
  Fail "Cloudflare rejected this token (401). Create a token via My Profile > API Tokens > Create Token > Edit Cloudflare Workers template (plus D1:Edit, Workers R2 Storage:Edit), copy the value shown after creation, and update the token line in this script."
}

# ---- 1. Create D1 database (idempotent) -------------------------------------
Write-Host ""
Write-Host "Creating D1 database itp-itr (ok if it already exists)..." -ForegroundColor Cyan
$createOut = (node $wrangler d1 create itp-itr 2>&1 | ForEach-Object { "$_" }) -join "; "
Write-Host $createOut

$dbId = $null
if ($createOut -match 'database_id\s*=\s*"([0-9a-f-]{36})"') { $dbId = $Matches[1] }
if (-not $dbId) {
  $listRaw = (node $wrangler d1 list --json 2>$null | Out-String)
  try {
    $dbs = $listRaw | ConvertFrom-Json
    foreach ($d in $dbs) { if ($d.name -eq "itp-itr") { $dbId = $d.uuid } }
  } catch { }
}
if (-not $dbId) { Fail "Could not determine the itp-itr database id." }
Write-Host "database_id: $dbId" -ForegroundColor Green

$toml = Get-Content "api/wrangler.toml" -Raw
$toml = $toml -replace 'database_id\s*=\s*"[^"]*"', ('database_id = "' + $dbId + '"')
Set-Content "api/wrangler.toml" $toml -NoNewline
Write-Host "api/wrangler.toml updated." -ForegroundColor Green

# ---- 2. Create R2 bucket (idempotent) ---------------------------------------
Write-Host ""
Write-Host "Creating R2 bucket itp-itr-signatures (ok if it already exists)..." -ForegroundColor Cyan
$r2Out = (node $wrangler r2 bucket create itp-itr-signatures 2>&1 | ForEach-Object { "$_" }) -join "; "
Write-Host $r2Out
if ($LASTEXITCODE -ne 0 -and $r2Out -notmatch "already exists") {
  Write-Host "Main token could not create the bucket - retrying with the R2-scoped token..." -ForegroundColor Yellow
  $env:CLOUDFLARE_API_TOKEN = $r2Token
  $r2Out2 = (node $wrangler r2 bucket create itp-itr-signatures 2>&1 | ForEach-Object { "$_" }) -join "; "
  Write-Host $r2Out2
  $env:CLOUDFLARE_API_TOKEN = $token
  if ($LASTEXITCODE -ne 0 -and $r2Out2 -notmatch "already exists") { Fail "Could not create the R2 bucket with either token - see output above." }
}

# ---- 3. Apply migrations to remote D1 ---------------------------------------
Write-Host ""
Write-Host "Applying migrations to the REMOTE database..." -ForegroundColor Cyan
$migOut = ("y" | node $wrangler d1 migrations apply itp-itr --remote --config api/wrangler.toml 2>&1 | ForEach-Object { "$_" }) -join "; "
Write-Host $migOut
if ($LASTEXITCODE -ne 0) { Fail "Migrations failed - see output above." }

# ---- 4. Deploy the Worker ---------------------------------------------------
Write-Host ""
Write-Host "Deploying the Worker..." -ForegroundColor Cyan
$deployOut = (node $wrangler deploy --config api/wrangler.toml 2>&1 | ForEach-Object { "$_" }) -join "; "
Write-Host $deployOut
if ($LASTEXITCODE -ne 0) { Fail "Worker deploy failed - see output above." }
$workerUrl = $null
if ($deployOut -match 'https://[a-z0-9.-]+\.workers\.dev') { $workerUrl = $Matches[0] }
if (-not $workerUrl) { Fail "Worker deployed but no workers.dev URL found in the output." }
Write-Host "Worker URL: $workerUrl" -ForegroundColor Green

# ---- 5. Rebuild the frontend pointed at the Worker --------------------------
Write-Host ""
Write-Host "Rebuilding the frontend with VITE_API_URL=$workerUrl ..." -ForegroundColor Cyan
$env:VITE_API_URL = $workerUrl
$buildOut = (node ./node_modules/vite/bin/vite.js build 2>&1 | ForEach-Object { "$_" }) -join "; "
Write-Host $buildOut
if ($LASTEXITCODE -ne 0) { Fail "Frontend build failed - see output above." }

# ---- 6. Seed the first user -------------------------------------------------
$email = "burinc16@gmail.com"
$name = "Burin Chotwatanakul"
$role = "qa_qc"
$alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz"
$password = ""
for ($i = 0; $i -lt 16; $i++) { $password += $alphabet[(Get-Random -Maximum $alphabet.Length)] }

Write-Host ""
Write-Host "Seeding user $email ..." -ForegroundColor Cyan
$sql = (node api/scripts/create-user.mjs $email $name $role $password | Out-String).Trim()
if (-not $sql.StartsWith("INSERT")) { Fail "create-user.mjs did not produce SQL." }
$seedOut = (node $wrangler d1 execute itp-itr --remote --config api/wrangler.toml --command $sql 2>&1 | ForEach-Object { "$_" }) -join "; "
Write-Host $seedOut
if ($LASTEXITCODE -ne 0) {
  Write-Host "User insert failed. If it mentions UNIQUE constraint, the account already exists with its previous password." -ForegroundColor Yellow
  $password = "(insert failed - see above)"
}

# ---- Scrub the token from this file -----------------------------------------
try {
  $self = Get-Content $PSCommandPath -Raw
  $self = $self.Replace($token, "TOKEN-REMOVED")
  $self = $self.Replace($r2Token, "TOKEN-REMOVED")
  Set-Content $PSCommandPath $self -NoNewline
  Write-Host ""
  Write-Host "Token scrubbed from deploy-with-token.ps1." -ForegroundColor Green
} catch { Write-Host "Could not scrub the token - delete deploy-with-token.ps1 manually." -ForegroundColor Yellow }

# ---- Done -------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host " DEPLOY COMPLETE" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host " API (Worker):  $workerUrl"
Write-Host " App login:     $email"
Write-Host " Password:      $password"
Write-Host ""
Write-Host " Save the password now. Then roll/revoke the API token in the Cloudflare dashboard." -ForegroundColor Yellow
try { Stop-Transcript | Out-Null } catch { }
