param([string]$ConfigFile=(Join-Path $PSScriptRoot '../secrets/sap-sync.config.json'),[switch]$DryRun)
$ErrorActionPreference='Stop'
$runLock=$null
try {
  $configPath=(Resolve-Path -LiteralPath $ConfigFile).Path
  $config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $nodePath=& (Join-Path $PSScriptRoot 'check-node-runtime.ps1') -NodePath $config.nodePath
  if(-not $config.outputDir){throw 'Missing log directory.'}
  New-Item -ItemType Directory -Force -Path $config.outputDir | Out-Null
  $lockPath=Join-Path $config.outputDir 'supplier-update.lock'
  try {$runLock=[IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}
  catch {Write-Output 'An update is already running; no second SAP query was started.';exit 2}
  & (Join-Path $PSScriptRoot 'run-sap-python.ps1') -ConfigFile $configPath -DryRun:$DryRun
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
  if($DryRun){exit 0}
  & $nodePath (Join-Path $PSScriptRoot 'sync-workbook-from-sap.mjs') 2>&1 |
    Tee-Object -FilePath (Join-Path $config.outputDir 'workbook-last-run.log')
  exit $LASTEXITCODE
} catch {
  Write-Output 'Update failed. Run setup-sap-sync.bat on this computer and check outputs/firebase-sync logs. No Git operation was run.'
  exit 1
} finally {if($runLock){$runLock.Dispose()}}
