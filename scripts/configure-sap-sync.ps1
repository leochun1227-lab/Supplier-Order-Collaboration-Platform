$ErrorActionPreference='Stop'
try {
  $project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  $secureDir=Join-Path $project 'secrets'
  $outputDir=Join-Path $project 'outputs/firebase-sync'
  New-Item -ItemType Directory -Force -Path $secureDir,$outputDir | Out-Null
  $configPath=Join-Path $secureDir 'sap-sync.config.json'
  if(Test-Path -LiteralPath $configPath){
    $answer=Read-Host 'Configuration exists. Type UPDATE to replace this computer configuration'
    if($answer -cne 'UPDATE'){Write-Output 'Existing configuration retained.';exit 0}
  }
  $pythonPath=$null
  if(Get-Command py.exe -ErrorAction SilentlyContinue){$pythonPath=& py.exe -3 -c 'import sys; print(sys.executable)'}
  if(-not $pythonPath -and (Get-Command python.exe -ErrorAction SilentlyContinue)){$pythonPath=& python.exe -c 'import sys; print(sys.executable)'}
  if(-not $pythonPath -or -not (Test-Path -LiteralPath $pythonPath -PathType Leaf)){throw 'Install 64-bit Python 3.11 or later first.'}
  & $pythonPath -c 'import sys; assert sys.version_info >= (3,11); assert sys.maxsize > 2**32'
  if($LASTEXITCODE -ne 0){throw '64-bit Python 3.11 or later is required.'}
  & $pythonPath -m pip install -r (Join-Path $PSScriptRoot 'requirements-sap.txt')
  if($LASTEXITCODE -ne 0){throw 'Could not install the Python ODBC dependency.'}
  & $pythonPath -c 'import pyodbc; assert "HDBODBC" in pyodbc.drivers()'
  if($LASTEXITCODE -ne 0){throw 'Install the 64-bit SAP HANA client / HDBODBC driver first.'}
  $server=Read-Host 'SAP server:port [10.11.2.25:30241]'
  if(-not $server){$server='10.11.2.25:30241'}
  if($server -notmatch '^[a-zA-Z0-9.-]+:\d{1,5}$'){throw 'Invalid server:port.'}
  $credential=Get-Credential -Message 'SAP read-only account. Saved encrypted for this Windows user on this computer.'
  if(-not $credential){throw 'SAP credential is required.'}
  $credentialPath=Join-Path $secureDir 'sap.credential.xml'
  $credential | Export-Clixml -LiteralPath $credentialPath
  $config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sap-sync.config.example.json') -Raw | ConvertFrom-Json
  $config.serverNode=$server
  $config.sapCredentialPath=$credentialPath
  $config.pythonPath=[string]$pythonPath
  $config.outputDir=$outputDir
  $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
  Write-Output 'Configuration saved locally. Run run.bat -DryRun to check SAP, then run.bat to publish to Firebase.'
  Write-Output 'No scheduled task was registered. Follow docs/RENDER-SAP-SETUP.md to schedule two daily runs.'
} catch {
  Write-Output ('Setup failed: '+$_.Exception.Message)
  exit 1
}
