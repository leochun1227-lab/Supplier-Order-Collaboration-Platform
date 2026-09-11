# Compatibility entry point; extraction and publishing now run in Python.
param([Parameter(Mandatory=$true)][string]$ConfigFile,[switch]$DryRun)
& (Join-Path $PSScriptRoot 'run-sap-python.ps1') -ConfigFile $ConfigFile -DryRun:$DryRun
exit $LASTEXITCODE
