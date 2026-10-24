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

# 官方技能市场是"直接打包 skills/dsh-agent/ 整个目录"，
# 所以这里也保留 skills/ 这一层：解压后在 app 根目录即可得到 skills/dsh-agent/
$skillSrc = Join-Path $root 'skills/dsh-agent'
$stage2 = Join-Path $dist '_stage_skill'
Remove-Item -Recurse -Force $stage2 -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $stage2 'skills/dsh-agent') | Out-Null
Copy-Item (Join-Path $skillSrc '*') (Join-Path $stage2 'skills/dsh-agent') -Force
$skillVer = (Get-Content (Join-Path $skillSrc 'skill.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
# ① 市场版：skills/dsh-agent/ 目录**内容**放 zip 根（官方市场就是直接打包这个目录）
$zip2 = Join-Path $dist ("dsh-agent-skill-{0}.zip" -f $skillVer)
Remove-Item $zip2 -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage2 'skills/dsh-agent/*') -DestinationPath $zip2

# ② 安装版：保留 skills/ 层，解压到 <app>/resources/app 即得 skills/dsh-agent/
$zip3 = Join-Path $dist ("dsh-agent-skill-{0}-app.zip" -f $skillVer)
Remove-Item $zip3 -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage2 'skills') -DestinationPath $zip3
Remove-Item -Recurse -Force $stage, $stage2

Get-ChildItem $dist -Filter *.zip | ForEach-Object { "{0}  {1:N1} KB" -f $_.Name, ($_.Length / 1KB) }
