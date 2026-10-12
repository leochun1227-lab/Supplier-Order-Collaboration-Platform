param([string]$NodePath)
$ErrorActionPreference='Stop'
if(-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)){
  $command=Get-Command node.exe -ErrorAction SilentlyContinue
  if(-not $command){throw 'Install Node.js 22.13 or later, then reopen setup-sap-sync.bat.'}
  $NodePath=$command.Source
}
& $NodePath -e 'const [major,minor]=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)'
if($LASTEXITCODE -ne 0){throw 'Node.js 22.13 or later is required.'}
$modulePath=Join-Path $PSScriptRoot 'sync-workbook-from-sap.mjs'
# Import only: the module guard prevents SAP/Firebase updates during this check.
# argv[1] must differ from the imported module so its CLI guard stays false.
& $NodePath --input-type=module -e "globalThis.fetch=()=>{throw Error('Runtime check must not access the network')};import('node:url').then(({pathToFileURL})=>import(pathToFileURL(process.argv[2]).href)).catch(()=>{process.exitCode=1})" 'runtime-check' $modulePath
if($LASTEXITCODE -ne 0){throw 'Workbook dependencies are missing or invalid. Run npm ci in the project folder, then run setup-sap-sync.bat again.'}
return $NodePath
