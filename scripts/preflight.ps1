[CmdletBinding()]
param(
  [string]$ContainerName = "sss-postgres-test"
)

$ErrorActionPreference = "Stop"

Write-Host "== Preflight: apply schema ==" -ForegroundColor Cyan
.\sql\apply.ps1 -ContainerName $ContainerName

Write-Host ""
Write-Host "== Preflight: run tests ==" -ForegroundColor Cyan
npx vitest run
