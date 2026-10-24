# 打包两个 Release 资产：
#   1) dsh-qq-plugin-<version>.zip   —— DSH 侧插件
#   2) dsh-agent-skill-<version>.zip —— QQ Agent 侧技能
# 用法：powershell -File scripts/pack-release.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$pkg = Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = $pkg.version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

$stage = Join-Path $dist '_stage_plugin'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
$pluginFiles = @('index.js','hint.js','privacy.js','permission-policy.js','rotation-policy.js',
                 'package.json','README.md','INSTALL.md','cordis.patch.yml','cordis.patch.yml.example')
foreach ($f in $pluginFiles) {
  $p = Join-Path $root $f
  if (Test-Path $p) { Copy-Item $p (Join-Path $stage $f) -Force }
}
$zip1 = Join-Path $dist ("dsh-qq-plugin-{0}.zip" -f $ver)
Remove-Item $zip1 -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip1

$skillSrc = Join-Path $root 'skills/dsh-agent'
$stage2 = Join-Path $dist '_stage_skill'
Remove-Item -Recurse -Force $stage2 -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $stage2 'dsh-agent') | Out-Null
Copy-Item (Join-Path $skillSrc '*') (Join-Path $stage2 'dsh-agent') -Force
$zip2 = Join-Path $dist ("dsh-agent-skill-{0}.zip" -f $ver)
Remove-Item $zip2 -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage2 'dsh-agent') -DestinationPath $zip2
Remove-Item -Recurse -Force $stage, $stage2

Get-ChildItem $dist -Filter *.zip | ForEach-Object { "{0}  {1:N1} KB" -f $_.Name, ($_.Length / 1KB) }
