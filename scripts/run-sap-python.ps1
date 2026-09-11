param([string]$ConfigFile=(Join-Path $PSScriptRoot '../secrets/sap-sync.config.json'),[switch]$DryRun)
$ErrorActionPreference='Stop'
try {
  $configPath=(Resolve-Path -LiteralPath $ConfigFile).Path
  $config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if(-not (Test-Path -LiteralPath $config.pythonPath -PathType Leaf)){throw 'Python is not configured.'}
  $arguments=@('-X','utf8',(Join-Path $PSScriptRoot 'sync_sap.py'),'--config',$configPath)
  if($DryRun){$arguments+='--dry-run'}
  & $config.pythonPath @arguments
  exit $LASTEXITCODE
} catch {
  Write-Output 'Sync could not start. Run setup-sap-sync.bat on this computer first, using the same Windows user.'
  exit 1
}
