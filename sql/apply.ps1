[CmdletBinding()]
param(
  # Nome del container Postgres (default: sss-postgres)
  [string]$ContainerName = "sss-postgres",

  # DB usato dai contract test
  [string]$Database = "sss_test",

  # User Postgres
  [string]$DbUser = "postgres",

  # Script schema da applicare
  [string]$SqlFile = ".\sql\001_init.sql"
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host ""
  Write-Host "ERROR: $msg" -ForegroundColor Red
  exit 1
}

# Verifiche base
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker non trovato nel PATH."
}

if (-not (Test-Path $SqlFile)) {
  Fail "File SQL non trovato: $SqlFile"
}

# Verifica container
$running = docker ps --format "{{.Names}}"
if (-not ($running -split "`n" | Where-Object { $_ -eq $ContainerName })) {
  Write-Host ""
  Write-Host "Container '$ContainerName' non trovato tra quelli in esecuzione." -ForegroundColor Yellow
  Write-Host "Container attivi:" -ForegroundColor Yellow
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Ports}}"
  Write-Host ""
  Fail "Avvia il container Postgres o passa -ContainerName <nome-corretto>."
}

# Applica schema
$resolvedSql = (Resolve-Path $SqlFile).Path

Write-Host "Applying schema..." -ForegroundColor Cyan
Write-Host "  Container : $ContainerName"
Write-Host "  Database  : $Database"
Write-Host "  User      : $DbUser"
Write-Host "  SQL file  : $resolvedSql"
Write-Host ""

# Nota: redirect file su docker exec -i
Get-Content $resolvedSql | docker exec -i $ContainerName psql -U $DbUser -d $Database

Write-Host ""
Write-Host "OK: schema applied." -ForegroundColor Green
