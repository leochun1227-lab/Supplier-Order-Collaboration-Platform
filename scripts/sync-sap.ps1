param([Parameter(Mandatory=$true)][string]$ConfigFile,[switch]$DryRun)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
$mutex=[Threading.Mutex]::new($false,'Local\RegentSupplierSapFirebaseSync')
try{$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
if(-not $acquired){$mutex.Dispose();Write-Output 'Previous SAP sync is still running.';exit 0}
$connection=$null
try {
  foreach($name in @('client','company','plant','supplier','salesOrg','customer')){if([string]$config.$name -notmatch '^\d{3,10}$'){throw 'Invalid SAP scope configuration.'}}
  $credential=Import-Clixml -LiteralPath $config.sapCredentialPath
  if($credential -isnot [System.Management.Automation.PSCredential]){throw 'Expected a Windows-protected SAP credential.'}
  $builder=[System.Data.Odbc.OdbcConnectionStringBuilder]::new()
  $builder['DRIVER']='HDBODBC';$builder['SERVERNODE']=$config.serverNode;$builder['UID']=$credential.UserName;$builder['PWD']=$credential.GetNetworkCredential().Password
  $connection=[System.Data.Odbc.OdbcConnection]::new($builder.ConnectionString)
  $connection.Open();$builder.Clear();$credential=$null
  $started=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $tables=[ordered]@{}
  foreach($name in @('po','so','deliveries','schedules','history')){
    $sql=Get-Content -LiteralPath (Join-Path $PSScriptRoot "sap-queries/$name.sql") -Raw
    foreach($key in @('client','company','plant','supplier','salesOrg','customer')){$sql=$sql.Replace(('{' + $key + '}'),[string]$config.$key)}
    if($sql -notmatch '^\s*SELECT\b' -or $sql -match ';|\b(INTO|UPDATE|DELETE|INSERT|DROP|ALTER|CREATE|CALL|MERGE|UPSERT)\b'){throw 'Only read-only SELECT queries are allowed.'}
    $command=$connection.CreateCommand();$command.CommandText=$sql;$command.CommandTimeout=120
    $reader=$command.ExecuteReader();$rows=[Collections.Generic.List[object]]::new()
    try{while($reader.Read()){
      if($rows.Count -ge 50000){throw 'SAP extraction exceeded the approved row bound.'}
      $row=[ordered]@{};for($i=0;$i -lt $reader.FieldCount;$i++){$row[$reader.GetName($i)]=if($reader.IsDBNull($i)){$null}else{$reader.GetValue($i)}};$rows.Add($row)
    }}finally{$reader.Close();$command.Dispose()}
    $tables[$name]=$rows.ToArray()
  }
  $connection.Close()
  $outputDir=Join-Path (Split-Path $PSScriptRoot) 'outputs/firebase-sync'
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
  $snapshotFile=Join-Path $outputDir 'latest-extraction.json'
  $scope=[ordered]@{};foreach($key in @('client','company','plant','supplier','salesOrg','customer')){$scope[$key]=[string]$config.$key}
  @{schemaVersion=1;startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();scope=$scope;tables=$tables} | ConvertTo-Json -Depth 15 -Compress | Set-Content -LiteralPath $snapshotFile -Encoding UTF8
  if($config.serviceAccountPath){$env:GOOGLE_APPLICATION_CREDENTIALS=$config.serviceAccountPath}
  $argsList=@((Join-Path $PSScriptRoot 'publish-sap-snapshot.mjs'),$snapshotFile)
  if($DryRun){$argsList+='--dry-run'}
  & $config.nodePath @argsList
  if($LASTEXITCODE -ne 0){throw 'Firebase publishing failed; previous current snapshot was retained.'}
}catch{
  # ODBC errors may contain connection details. Keep scheduled-task output generic.
  Write-Error 'SAP/Firebase sync failed. Latest published data was not cleared. Check credentials, connectivity and scope.'
  exit 1
}finally{if($connection){$connection.Dispose()};$mutex.ReleaseMutex();$mutex.Dispose()}
