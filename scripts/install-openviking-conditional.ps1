param([string]$Container='dsh-openviking')
$ErrorActionPreference='Stop'
$site='/app/.venv/lib/python3.13/site-packages/openviking'
$patch=(Resolve-Path (Join-Path $PSScriptRoot '../integrations/openviking-conditional-memory.patch')).Path
docker cp $patch "${Container}:/tmp/censhu-conditional-memory.patch"
if($LASTEXITCODE){throw 'Cannot copy the OpenViking adapter'}
docker exec -w $site $Container git apply --reverse --check /tmp/censhu-conditional-memory.patch 2>$null
if($LASTEXITCODE -eq 0){Write-Output 'Adapter already present';return}
docker exec -w $site $Container git apply --check /tmp/censhu-conditional-memory.patch
if($LASTEXITCODE){throw 'Incompatible OpenViking source. No changes applied.'}
docker exec -w $site $Container git apply /tmp/censhu-conditional-memory.patch
if($LASTEXITCODE){throw 'OpenViking patch failed'}
docker restart $Container
if($LASTEXITCODE){throw 'OpenViking restart failed'}
