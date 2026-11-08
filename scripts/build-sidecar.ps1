# 编译侧车并放到 bin/fqsidecar.exe
#
# 默认构建「真实上游」版本：sidecar-upstream/（复用 vendor/fqapp 的 Rust core）。
# 加 -Demo 构建零依赖的离线样章版本：sidecar/。
#
# 工具链要求（Windows）：
#   - Rust + 一个 GNU 链接器（MSYS2 的 mingw64 gcc 即可）
#   - 本脚本会自动寻找 MSYS2 的 cargo（<repo>\.tmp\msys64、C:\msys64）
#     或 PATH 里的 cargo
#
# 为什么用 GNU 目标：rustup 的 msvc 工具链需要 Visual Studio 链接器；
# MSYS2 的 mingw64 工具链自带 gcc，装起来小得多。

[CmdletBinding()]
param(
    [switch]$Demo,
    [switch]$SkipCopy
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repo = Join-Path $root 'vendor/fqapp/rust'
$crate = if ($Demo) { Join-Path $root 'sidecar' } else { Join-Path $root 'sidecar-upstream' }

function Find-Toolchain {
    $candidates = @(
        (Join-Path $root '.tmp/msys64/mingw64/bin/cargo.exe'),
        'C:\msys64\mingw64\bin\cargo.exe',
        'D:\msys64\mingw64\bin\cargo.exe'
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return @{
                Cargo = $candidate
                Bin = Split-Path $candidate
                Kind = 'mingw64'
            }
        }
    }
    $command = Get-Command cargo -ErrorAction SilentlyContinue
    if ($command) {
        return @{ Cargo = $command.Source; Bin = Split-Path $command.Source; Kind = 'rustup' }
    }
    return $null
}

$toolchain = Find-Toolchain
if (-not $toolchain) {
    throw @'
找不到 cargo。二选一：
  1) 安装 MSYS2（推荐，体积小）：
       winget install --id MSYS2.MSYS2 -e
       C:\msys64\usr\bin\bash.exe -lc "pacman -S --noconfirm mingw-w64-x86_64-rust mingw-w64-x86_64-gcc"
  2) 安装 Rust + Visual Studio Build Tools（体积大）：
       winget install --id Rustlang.Rustup -e
'@
}

Write-Host "cargo: $($toolchain.Cargo) ($($toolchain.Kind))"
Write-Host "crate: $crate"

# MSYS2 的 gcc/dlltool/ar 需要在 PATH 里，cc 与 windows-sys 的构建脚本会用到。
$env:PATH = "$($toolchain.Bin);$env:PATH"

Push-Location $crate
try {
    if ($Demo) {
        & $toolchain.Cargo build --release
    } else {
        & $toolchain.Cargo build --release
    }
    if ($LASTEXITCODE -ne 0) {
        $hint = @'

编译失败。常见原因：
  - 只有 rustup 的 msvc 工具链，没有 link.exe：改用 MSYS2 的 mingw64 cargo，或安装
    Visual Studio Build Tools（VCTools + Windows SDK）。
  - MSYS2 工具链但 PATH 里没有 gcc/dlltool：脚本已把 mingw64/bin 加进 PATH，
    若仍失败，确认 pacman 装了 mingw-w64-x86_64-gcc。
'@
        Write-Host $hint -ForegroundColor Yellow
        throw 'cargo build failed'
    }
} finally {
    Pop-Location
}

$exe = Join-Path $crate 'target/release/fqsidecar.exe'
if (-not (Test-Path $exe)) {
    throw "没有找到产物：$exe"
}

$size = (Get-Item $exe).Length
Write-Host ("built {0} ({1:N1} MB, {2})" -f $exe, ($size / 1MB), $(if ($Demo) { 'demo provider' } else { 'fanqie upstream' }))
if ($size -gt 10MB) {
    Write-Warning '产物超过 10 MB 目标；检查 profile.release 的 opt-level / lto / strip。'
}

if (-not $SkipCopy) {
    $binDir = Join-Path $root 'bin'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Copy-Item $exe (Join-Path $binDir 'fqsidecar.exe') -Force
    Write-Host "copied to $(Join-Path $binDir 'fqsidecar.exe')"
}
