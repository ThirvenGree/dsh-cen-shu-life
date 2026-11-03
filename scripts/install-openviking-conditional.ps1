param(
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]*$')][string]$Container='dsh-openviking',
  [string]$StateDirectory
)
$ErrorActionPreference='Stop'
if(!$StateDirectory){
  $dshHome=if($env:DSH_HOME){$env:DSH_HOME}else{Join-Path $env:USERPROFILE '.dsh'}
  $StateDirectory=Join-Path $dshHome 'cen-shu-life'
}
$site='/app/.venv/lib/python3.13/site-packages/openviking'
$bundle=Join-Path $PSScriptRoot '../integrations'
$report=[ordered]@{container=$Container;containerId='';imageId='';ready=$false;code='checking';detail='正在检查 OpenViking';checkedAt=''}
function Save-Status {
  [IO.Directory]::CreateDirectory($StateDirectory)|Out-Null
  $report.checkedAt=[DateTime]::UtcNow.ToString('o')
  $dest=Join-Path $StateDirectory 'openviking-adapter.json'
  $tmp=$dest+'.'+$PID+'.tmp'
  [IO.File]::WriteAllText($tmp,($report|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  if([IO.File]::Exists($dest)){[IO.File]::Replace($tmp,$dest,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($tmp,$dest)}
}
function Docker-Result([string[]]$Arguments){
  $output=& docker @Arguments 2>&1
  if($LASTEXITCODE){throw (($output|Out-String).Trim())}
  return $output
}
function Get-SourceState {
  $names=@($manifest.PSObject.Properties.Name)
  $hashes=@(Docker-Result (@('exec','-w',$site,$report.containerId,'sha256sum')+$names))
  $base=0;$patched=0;$unexpected=@()
  foreach($line in $hashes){
    if($line -notmatch '^([a-f0-9]{64})\s+(.+)$'){throw '无法识别服务端源码摘要'}
    $entry=$manifest.($Matches[2])
    if($entry.original -eq $Matches[1]){$base++}elseif($entry.patched -eq $Matches[1]){$patched++}else{$unexpected+=$Matches[2]}
  }
  if($base -eq $names.Count){return 'original'}
  if($patched -eq $names.Count){return 'patched'}
  $report.code='incompatible'
  if($unexpected){throw ('升级后的源码与已验证版本不符：'+($unexpected -join '、'))}
  throw '服务端同时存在原版与已修改文件，需要核对适配版本。'
}
function Get-PublishedUrl {
 $endpoints=@(Docker-Result @('port',$id,'1933/tcp'))
 $endpoint=$endpoints|Where-Object {$_ -match '^127\.0\.0\.1:\d+$'}|Select-Object -First 1
 if(!$endpoint){throw '未找到绑定在 127.0.0.1 的 OpenViking 端口'}
 return 'http://'+$endpoint
}
function Test-Routes {
 try{
  $spec=Invoke-RestMethod -Uri ($url+'/openapi.json') -TimeoutSec 4
  return ($null -ne $spec.paths.'/api/v1/content/versioned-read'.get -and $null -ne $spec.paths.'/api/v1/fs/if-version'.delete -and $null -ne $spec.paths.'/api/v1/content/batch-write'.post)
 }catch{return $false}
}
function Wait-Api {
 $until=(Get-Date).AddSeconds(90)
 do{try{if(Invoke-RestMethod -Uri ($url+'/health') -TimeoutSec 3){return}}catch{}
   Start-Sleep -Seconds 2
 }while((Get-Date) -lt $until)
 throw 'OpenViking 服务未能在 90 秒内就绪'
}
$mutex=[Threading.Mutex]::new($false,('Local\censhu-openviking-'+$Container))
$locked=$false
try{
 try{$locked=$mutex.WaitOne(180000)}catch [Threading.AbandonedMutexException]{$locked=$true}
 if(!$locked){throw '已有 OpenViking 启动检查正在运行，请稍后重试'}
 Save-Status
 $report.code='service_unavailable'
 $dockerReady=$false
 try{$null=Docker-Result @('info','--format','{{.ServerVersion}}');$dockerReady=$true}catch{}
 if(!$dockerReady){
  Start-Process (Join-Path $env:ProgramFiles 'Docker/Docker/Docker Desktop.exe') -WindowStyle Hidden
  $until=(Get-Date).AddSeconds(90)
  do{Start-Sleep -Seconds 2;try{$null=Docker-Result @('info','--format','{{.ServerVersion}}');$dockerReady=$true}catch{}}while(!$dockerReady -and (Get-Date) -lt $until)
  if(!$dockerReady){throw 'Docker 引擎未就绪'}
 }
 $id=(Docker-Result @('inspect','--format','{{.Id}}',$Container)).Trim()
 $report.containerId=$id
 $report.imageId=(Docker-Result @('inspect','--format','{{.Image}}',$id)).Trim()
 if((Docker-Result @('inspect','--format','{{.State.Running}}',$id)) -ne 'true'){$null=Docker-Result @('start',$id)}
 $url=Get-PublishedUrl
 Wait-Api
 $manifest=Get-Content -LiteralPath (Join-Path $bundle 'openviking-conditional-sources.json') -Raw|ConvertFrom-Json
 $report.code='incompatible'
 $before=Get-SourceState
 if($before -eq 'original'){
  $patch=(Resolve-Path (Join-Path $bundle 'openviking-conditional-memory.patch')).Path
  $remote='/tmp/censhu-conditional-memory.patch'
  $null=Docker-Result @('cp',$patch,("${id}:"+$remote))
  $null=Docker-Result @('exec','-w',$site,$id,'git','apply','--check',$remote)
  $report.code='install_failed'
  $null=Docker-Result @('exec','-w',$site,$id,'git','apply',$remote)
  if((Get-SourceState) -ne 'patched'){throw '写入后服务端源码校验失败'}
 }
 if($before -eq 'original' -or !(Test-Routes)){
  $report.code='restart_failed'
  $null=Docker-Result @('restart',$id)
  $url=Get-PublishedUrl
  Wait-Api
 }
 $report.code='protocol_mismatch'
 if(!(Test-Routes)){throw '服务已启动，但版本读取、条件删除或批量替换接口未加载'}
 if((Docker-Result @('inspect','--format','{{.Id}}',$Container)).Trim() -ne $id){throw '检查期间容器已被替换，请重新启动检查'}
 $report.ready=$true
 if($before -eq 'original'){$report.code='restored';$report.detail='已自动安装适配，重启后服务接口已通过检查'}
 else{$report.code='ready';$report.detail='适配源码与运行中的服务接口均已核对'}
 Save-Status
 Write-Output $report.detail
}catch{
 if($locked){$report.ready=$false;$report.detail=$_.Exception.Message;Save-Status}
 throw
}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
