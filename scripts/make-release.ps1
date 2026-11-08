# 生成插件 Release 资产（只含 Obsidian 安装器需要的三件套）
#
#   powershell -NoProfile -File scripts/make-release.ps1 -Version 0.1.1
#
# 产物：
#   release/<version>/plugin/    main.js / manifest.json / styles.css
#   release/ex-libris-<version>.zip
#
# 侧车不在这里：见 https://github.com/Yolkbun/ex-libris-sidecar

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$out = Join-Path $root "release/$Version"

if (-not (Test-Path (Join-Path $dist 'main.js'))) {
    throw 'dist/main.js 不存在，先运行 npm run build'
}

$manifest = Get-Content (Join-Path $dist 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne $Version) {
    throw "manifest.json version=$($manifest.version)，与 -Version $Version 不一致"
}

$pluginDir = Join-Path $out 'plugin'
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
Copy-Item (Join-Path $dist 'main.js') $pluginDir -Force
Copy-Item (Join-Path $dist 'manifest.json') $pluginDir -Force
Copy-Item (Join-Path $dist 'styles.css') $pluginDir -Force

$stage = Join-Path $root 'release/.stage/ex-libris'
if (Test-Path (Join-Path $root 'release/.stage')) {
    Remove-Item (Join-Path $root 'release/.stage') -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $pluginDir '*') $stage -Force

$zip = Join-Path $root "release/ex-libris-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Remove-Item (Join-Path $root 'release/.stage') -Recurse -Force

Write-Host "plugin: $pluginDir"
Get-ChildItem $pluginDir | Select-Object Name, Length | Format-Table -AutoSize
Write-Host "zip: $zip"
