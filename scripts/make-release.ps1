# 生成 GitHub Release 资产
#
#   powershell -NoProfile -File scripts/make-release.ps1 -Version 0.1.0
#
# 产物：
#   release/<version>/main.js
#   release/<version>/manifest.json
#   release/<version>/styles.css
#   release/<version>/fqsidecar.exe
#   release/ex-libris-<version>.zip   （解压得到 ex-libris/ 文件夹）

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$bin = Join-Path $root 'bin/fqsidecar.exe'
$out = Join-Path $root "release/$Version"

if (-not (Test-Path (Join-Path $dist 'main.js'))) {
    throw 'dist/main.js 不存在，先运行 npm run build'
}
if (-not (Test-Path $bin)) {
    throw 'bin/fqsidecar.exe 不存在，先运行 scripts/build-sidecar.ps1'
}

$manifest = Get-Content (Join-Path $dist 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne $Version) {
    throw "manifest.json version=$($manifest.version)，与 -Version $Version 不一致"
}

New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item (Join-Path $dist 'main.js') $out -Force
Copy-Item (Join-Path $dist 'manifest.json') $out -Force
Copy-Item (Join-Path $dist 'styles.css') $out -Force
Copy-Item $bin $out -Force

$stage = Join-Path $root "release/.stage/ex-libris"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item (Join-Path $dist 'main.js') $stage -Force
Copy-Item (Join-Path $dist 'manifest.json') $stage -Force
Copy-Item (Join-Path $dist 'styles.css') $stage -Force
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'bin') | Out-Null
Copy-Item $bin (Join-Path $stage 'bin/fqsidecar.exe') -Force

$zip = Join-Path $root "release/ex-libris-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Remove-Item (Join-Path $root 'release/.stage') -Recurse -Force

Write-Host "release assets: $out"
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
Write-Host "zip: $zip"
