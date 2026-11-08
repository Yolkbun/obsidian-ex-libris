# 把插件安装到指定 vault 的 .obsidian/plugins/ex-libris/
#
# 用法：
#   powershell -NoProfile -File scripts/install.ps1 -VaultPath "D:\SomeVault" -Enable
#
# 会复制 dist/（main.js、manifest.json、styles.css）与 bin/fqsidecar.exe。
# -KeepData（默认行为）不会删除插件已有的 data/ 与 cache/。

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath,
    [switch]$Enable,
    [switch]$KeepData
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$bin = Join-Path $root 'bin'

if (-not (Test-Path $dist)) {
    throw 'dist/ 不存在。先运行 `npm run build`。'
}
if (-not (Test-Path $VaultPath)) {
    throw "vault 不存在：$VaultPath"
}

$target = Join-Path $VaultPath '.obsidian/plugins/ex-libris'
New-Item -ItemType Directory -Force -Path $target | Out-Null

Get-ChildItem $dist -Force | ForEach-Object {
    $destination = Join-Path $target $_.Name
    if ($_.PSIsContainer) {
        Copy-Item $_.FullName $destination -Recurse -Force
    } else {
        Copy-Item $_.FullName $destination -Force
    }
}

if (Test-Path $bin) {
    $targetBin = Join-Path $target 'bin'
    New-Item -ItemType Directory -Force -Path $targetBin | Out-Null
    Copy-Item (Join-Path $bin '*') $targetBin -Recurse -Force
}

if (-not $KeepData) {
    Write-Host '保留已有 data/ 与 cache/（不删除用户数据）。'
}

Write-Host "installed to $target"

if ($Enable) {
    $configPath = Join-Path $VaultPath '.obsidian/community-plugins.json'
    $plugins = @()
    if (Test-Path $configPath) {
        try {
            $parsed = Get-Content $configPath -Raw | ConvertFrom-Json
            if ($null -ne $parsed) { $plugins = @($parsed) }
        } catch {
            $plugins = @()
        }
    }
    if ($plugins -notcontains 'ex-libris') {
        $plugins += 'ex-libris'
    }
    $json = ConvertTo-Json -InputObject @($plugins) -Compress
    [System.IO.File]::WriteAllText($configPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "community-plugins.json: $json"
}

Write-Host @'

下一步：
  1. 打开 Obsidian → 设置 → 第三方插件，确认 Ex Libris 已启用。
  2. 命令面板运行 "Ex Libris: 打开书架"。
  3. 番茄：确认 .obsidian/plugins/ex-libris/bin/fqsidecar.exe 存在；
     设置页点"重启并检查"，应显示"侧车就绪"。
'@
