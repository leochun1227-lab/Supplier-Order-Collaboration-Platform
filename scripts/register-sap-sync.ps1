# Optional helper; setup does not register any scheduled task.
param([string]$ConfigFile=(Join-Path $PSScriptRoot '../secrets/sap-sync.config.json'),[string[]]$Times=@('17:00'))
$ErrorActionPreference='Stop'
if($Times.Count -lt 1 -or @($Times | Select-Object -Unique).Count -ne $Times.Count){throw 'Choose distinct daily times.'}
$resolvedConfig=(Resolve-Path -LiteralPath $ConfigFile).Path
$config=Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
foreach($path in @($config.sapCredentialPath,$config.pythonPath)){if(-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)){throw 'Run setup-sap-sync.bat first.'}}
$null=& (Join-Path $PSScriptRoot 'check-node-runtime.ps1') -NodePath $config.nodePath
try{
  $credential=Import-Clixml -LiteralPath $config.sapCredentialPath
  if($credential -isnot [System.Management.Automation.PSCredential] -or -not $credential.GetNetworkCredential().Password){throw 'Invalid credential.'}
}catch{throw 'Run setup-sap-sync.bat on this computer with the Windows user who will run the scheduled task.'}
$scriptFile=Join-Path $PSScriptRoot 'run-supplier-update.ps1'
if($resolvedConfig.Contains('"') -or $scriptFile.Contains('"')){throw 'Invalid path.'}
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$scriptFile+'" -ConfigFile "'+$resolvedConfig+'"'
$action=New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $arguments -WorkingDirectory (Split-Path $PSScriptRoot)
$triggers=@(foreach($time in $Times){
  if($time -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$'){throw 'Use HH:mm, such as 08:00.'}
  $parts=$time.Split(':')
  New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours([int]$parts[0]).AddMinutes([int]$parts[1]))
})
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 25) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$taskName='Regent Supplier SAP to Firebase'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'Task already exists. Inspect and update its triggers in Task Scheduler.'}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Read-only SAP snapshots and workbook updates to Firebase; no Git operations or SAP writes.' | Select-Object TaskName,State
Write-Output ('Daily times (this computer local time): '+($Times -join ', '))
Write-Output 'Runs while this Windows user is signed in and the machine is awake on the company network.'
