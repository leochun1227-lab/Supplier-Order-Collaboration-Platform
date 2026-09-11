# Optional helper; setup does not register any scheduled task.
param([string]$ConfigFile=(Join-Path $PSScriptRoot '../secrets/sap-sync.config.json'),[string[]]$Times=@('08:00','16:00'))
$ErrorActionPreference='Stop'
if($Times.Count -ne 2 -or @($Times | Select-Object -Unique).Count -ne 2){throw 'Choose two distinct daily times.'}
$resolvedConfig=(Resolve-Path -LiteralPath $ConfigFile).Path
$config=Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
foreach($path in @($config.sapCredentialPath,$config.pythonPath)){if(-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)){throw 'Run setup-sap-sync.bat first.'}}
$scriptFile=Join-Path $PSScriptRoot 'run-sap-python.ps1'
if($resolvedConfig.Contains('"') -or $scriptFile.Contains('"')){throw 'Invalid path.'}
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$scriptFile+'" -ConfigFile "'+$resolvedConfig+'"'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory (Split-Path $PSScriptRoot)
$triggers=@(foreach($time in $Times){
  if($time -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$'){throw 'Use HH:mm, such as 08:00.'}
  $parts=$time.Split(':')
  New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours([int]$parts[0]).AddMinutes([int]$parts[1]))
})
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 25) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$taskName='Regent Supplier SAP to Firebase'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'Task already exists. Inspect and update its triggers in Task Scheduler.'}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Python read-only SAP snapshots to Firebase, twice daily; collaboration records remain separate.' | Select-Object TaskName,State
Write-Output ('Daily times (this computer local time): '+($Times -join ', '))
Write-Output 'Runs while this Windows user is signed in and the machine is awake on the company network.'
