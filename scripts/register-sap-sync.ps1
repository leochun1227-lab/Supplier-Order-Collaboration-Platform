param([Parameter(Mandatory=$true)][string]$ConfigFile,[ValidateRange(5,1440)][int]$IntervalMinutes=30)
$ErrorActionPreference='Stop'
$resolvedConfig=(Resolve-Path -LiteralPath $ConfigFile).Path
$config=Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
foreach($path in @($config.sapCredentialPath,$config.serviceAccountPath,$config.nodePath)){if(-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)){throw 'Complete the credential and runtime paths before registering the task.'}}
$scriptFile=Join-Path $PSScriptRoot 'sync-sap.ps1'
if($resolvedConfig.Contains('"') -or $scriptFile.Contains('"')){throw 'Invalid path.'}
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$scriptFile`" -ConfigFile `"$resolvedConfig`""
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 25) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$taskName='Regent Supplier SAP to Firebase'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'Task already exists. Inspect it before explicitly updating its schedule.'}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Read-only SAP extraction to protected Firebase; platform collaboration remains separate.' | Select-Object TaskName,State
Write-Output 'Runs while this Windows user is signed in and the machine is awake on the company network.'
