param([switch]$Reconfigure)
$ErrorActionPreference='Stop'
try {
  $project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  $secureDir=Join-Path $project 'secrets'
  $outputDir=Join-Path $project 'outputs/firebase-sync'
  New-Item -ItemType Directory -Force -Path $secureDir,$outputDir | Out-Null
  $configPath=Join-Path $secureDir 'sap-sync.config.json'
  $config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sap-sync.config.example.json') -Raw | ConvertFrom-Json
  if(Test-Path -LiteralPath $configPath){$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json}
  $nodePath=& (Join-Path $PSScriptRoot 'check-node-runtime.ps1')
  $pythonPath=$config.pythonPath
  if(-not $pythonPath -or -not (Test-Path -LiteralPath $pythonPath -PathType Leaf)){$pythonPath=$null}
  if(-not $pythonPath -and (Get-Command py.exe -ErrorAction SilentlyContinue)){$pythonPath=& py.exe -3 -c 'import sys; print(sys.executable)'}
  if(-not $pythonPath -and (Get-Command python.exe -ErrorAction SilentlyContinue)){$pythonPath=& python.exe -c 'import sys; print(sys.executable)'}
  if(-not $pythonPath -or -not (Test-Path -LiteralPath $pythonPath -PathType Leaf)){throw 'Install 64-bit Python 3.11 or later first.'}
  & $pythonPath -c 'import sys; assert sys.version_info >= (3,11); assert sys.maxsize > 2**32'
  if($LASTEXITCODE -ne 0){throw '64-bit Python 3.11 or later is required.'}
  & $pythonPath -c "import importlib.util, importlib.metadata, sys; spec=importlib.util.find_spec('pyodbc'); sys.exit(0 if spec and (5,2) <= tuple(map(int,importlib.metadata.version('pyodbc').split('.')[:2])) < (6,0) else 1)"
  if($LASTEXITCODE -ne 0){
    & $pythonPath -m pip install -r (Join-Path $PSScriptRoot 'requirements-sap.txt')
    if($LASTEXITCODE -ne 0){throw 'Could not install the Python ODBC dependency.'}
  }
  # Windows PowerShell 5.1 strips embedded double quotes in native arguments.
  & $pythonPath -c "import pyodbc; assert 'HDBODBC' in pyodbc.drivers()"
  if($LASTEXITCODE -ne 0){throw 'Install the 64-bit SAP HANA client / HDBODBC driver first.'}
  $server=$config.serverNode
  if($Reconfigure){$enteredServer=Read-Host "SAP server:port [$server]";if($enteredServer){$server=$enteredServer}}
  if($server -notmatch '^[a-zA-Z0-9.-]+:\d{1,5}$'){throw 'Invalid server:port.'}
  $credentialPath=Join-Path $secureDir 'sap.credential.xml'
  $credential=$null
  if(-not $Reconfigure -and (Test-Path -LiteralPath $credentialPath -PathType Leaf)){
    try{
      $credential=Import-Clixml -LiteralPath $credentialPath
      if($credential -isnot [System.Management.Automation.PSCredential] -or -not $credential.UserName -or -not $credential.GetNetworkCredential().Password){$credential=$null}
    }catch{$credential=$null}
    if(-not $credential){Write-Output 'Saved credential belongs to another computer/user or is invalid. Enter it again for this computer.'}
  }
  if($credential){
    Write-Output 'Reusing saved SAP configuration and encrypted credential. No input required.'
  }else{
    $credential=Get-Credential -Message 'One-time SAP read-only account setup. Saved encrypted for this Windows user on this computer.'
    if(-not $credential){throw 'SAP credential is required.'}
    $credential | Export-Clixml -LiteralPath $credentialPath
  }
  $config.serverNode=$server
  $config.sapCredentialPath=$credentialPath
  $config.pythonPath=[string]$pythonPath
  $config | Add-Member -NotePropertyName nodePath -NotePropertyValue ([string]$nodePath) -Force
  $config.outputDir=$outputDir
  $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
  Write-Output 'Configuration saved locally. Run run.bat -DryRun to check SAP, then run.bat to publish to Firebase.'
  Write-Output 'No scheduled task was registered. After verifying run.bat, run install-daily-task.bat on the intended sync computer.'
} catch {
  Write-Output ('Setup failed: '+$_.Exception.Message)
  exit 1
}
