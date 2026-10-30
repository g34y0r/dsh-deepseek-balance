﻿<#
.SYNOPSIS
    把 dsh-deepseek-balance 重新安装到本机所有已安装它的 dsh profile。

.DESCRIPTION
    `link:` 安装让源码改动立刻生效，但 profile 里的清单是安装时的快照：
    改了 package.json（版本号、dsh.bundle、exports、files 等）之后，
    每个 profile 都必须重新 `dsh plugin add` 一次才能同步。

    本脚本自动发现 ~/.dsh/profiles/* 下「已经装过本插件」的 profile，
    逐个重新安装，然后核对落地的版本号并报告。

    它**不会**：
      - 安装到从未装过该插件的 profile（避免意外扩散）
      - 同步 profile 之间的个人配置（主题、模型、权限等）
      - 重启应用（desktop profile 没有热重载，需手动重启）

.PARAMETER Profile
    只同步指定的 profile，可重复指定。省略时同步全部符合条件的 profile。

.PARAMETER PackagePath
    插件源码目录。默认是本脚本所在目录。

.PARAMETER DryRun
    只显示将要处理哪些 profile，不实际执行安装。

.EXAMPLE
    .\sync-profiles.ps1

.EXAMPLE
    .\sync-profiles.ps1 -Profile web

.EXAMPLE
    .\sync-profiles.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string[]] $Profile,
    [string] $PackagePath,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# Resolve the default after binding: $PSScriptRoot is not reliably available as a
# param default when the script runs via `powershell -File`.
if (-not $PackagePath) {
    $PackagePath = if ($PSScriptRoot) {
        $PSScriptRoot
    } else {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
}

$PackageName = 'dsh-deepseek-balance'

# ---------------------------------------------------------------- helpers ---

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok($message)   { Write-Host "  OK  $message" -ForegroundColor Green }
function Write-Warn2($message) { Write-Host "  !   $message" -ForegroundColor Yellow }
function Write-Err($message)  { Write-Host "  X   $message" -ForegroundColor Red }

function Get-DshHome {
    if ($env:DSH_HOME) { return $env:DSH_HOME }
    return (Join-Path $env:USERPROFILE '.dsh')
}

function Resolve-DshCommand {
    $found = Get-Command dsh -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }

    # The desktop app ships its own CLI; prefer it when `dsh` is not on PATH.
    $bundled = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
    if (Test-Path -LiteralPath $bundled) { return $bundled }

    throw "找不到 dsh 命令：既不在 PATH 上，也不在 $bundled"
}

function Read-JsonFile($path) {
    # Read as UTF-8 explicitly: Windows PowerShell 5.1's Get-Content decodes as
    # the ANSI code page and mangles non-ASCII (e.g. the Chinese description).
    $bytes = [System.IO.File]::ReadAllBytes($path)
    return ([System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
}

function Get-InstalledVersion($profileDir) {
    $manifest = Join-Path $profileDir "node_modules\$PackageName\package.json"
    if (-not (Test-Path -LiteralPath $manifest)) { return $null }
    try { return (Read-JsonFile $manifest).version } catch { return $null }
}

# ------------------------------------------------------------ preflight ---

$dshHome = Get-DshHome
$profilesRoot = Join-Path $dshHome 'profiles'

if (-not (Test-Path -LiteralPath $profilesRoot)) {
    throw "未找到 profile 目录：$profilesRoot"
}

$sourceManifest = Join-Path $PackagePath 'package.json'
if (-not (Test-Path -LiteralPath $sourceManifest)) {
    throw "未在 $PackagePath 找到 package.json ——用 -PackagePath 指定插件源码目录"
}

$sourcePkg = Read-JsonFile $sourceManifest
if ($sourcePkg.name -ne $PackageName) {
    throw "$sourceManifest 的包名是 '$($sourcePkg.name)'，期望 '$PackageName'"
}

$dsh = Resolve-DshCommand
$sourceVersion = $sourcePkg.version

Write-Step "dsh-deepseek-balance $sourceVersion"
Write-Host "    源码: $PackagePath"
Write-Host "    CLI : $dsh"
Write-Host "    home: $dshHome"
Write-Host ''

# Which profiles have this package installed already?
$candidates = @()
foreach ($dir in Get-ChildItem -LiteralPath $profilesRoot -Directory) {
    $installed = Get-InstalledVersion $dir.FullName
    if ($null -ne $installed) {
        $candidates += [pscustomobject]@{
            Name      = $dir.Name
            Directory = $dir.FullName
            Version   = $installed
        }
    }
}

if ($Profile) {
    $missing = $Profile | Where-Object { $p = $_; -not ($candidates | Where-Object { $_.Name -eq $p }) }
    foreach ($name in $missing) {
        Write-Err "profile '$name' 没有安装 $PackageName ——本脚本只同步已安装的 profile"
    }
    # @() keeps the result an array: a single match would otherwise be a scalar
    # without a usable .Count.
    $candidates = @($candidates | Where-Object { $Profile -contains $_.Name })
}

if (-not $candidates) {
    if ($Profile) {
        Write-Warn2 "指定的 profile 都不符合条件，未做任何改动。"
    } else {
        Write-Warn2 "没有任何 profile 安装过 $PackageName，无需同步。"
    }
    Write-Host '    首次安装请手动执行（profile 名自行替换）:'
    Write-Host "    dsh plugin --profile web add `"link:$($PackagePath -replace '\\','/')`"" -ForegroundColor DarkGray
    exit 0
}

Write-Step "将同步 $($candidates.Count) 个 profile"
foreach ($c in $candidates) {
    $mark = if ($c.Version -eq $sourceVersion) { '(已是该版本)' } else { "(当前 $($c.Version) → $sourceVersion)" }
    Write-Host "    - $($c.Name) $mark"
}
Write-Host ''

if ($DryRun) {
    Write-Warn2 'DryRun：未执行任何安装。'
    exit 0
}

# ------------------------------------------------------------- reinstall ---

$linkSpec = "link:$($PackagePath -replace '\\','/')"
$results = @()

foreach ($c in $candidates) {
    Write-Step "安装到 profile '$($c.Name)'"
    try {
        # --profile must follow `plugin` directly, not `add`.
        $output = & $dsh plugin --profile $c.Name add $linkSpec 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            $tail = ($output.Trim() -split "`n" | Select-Object -Last 3) -join ' / '
            throw "dsh plugin add 返回 ${LASTEXITCODE}: $tail"
        }

        $after = Get-InstalledVersion $c.Directory
        if ($after -ne $sourceVersion) {
            throw "安装后版本是 '$after'，期望 '$sourceVersion'"
        }
        Write-Ok "$($c.Name): $($c.Version) -> $after"
        $results += [pscustomobject]@{ Profile = $c.Name; Ok = $true; Version = $after; Note = '' }
    }
    catch {
        Write-Err "$($c.Name): $($_.Exception.Message)"
        $results += [pscustomobject]@{ Profile = $c.Name; Ok = $false; Version = $null; Note = $_.Exception.Message }
    }
    Write-Host ''
}

# --------------------------------------------------------------- summary ---

Write-Step '结果'
foreach ($r in $results) {
    if ($r.Ok) { Write-Host ("    {0,-10} {1}" -f $r.Profile, $r.Version) -ForegroundColor Green }
    else       { Write-Host ("    {0,-10} 失败: {1}" -f $r.Profile, $r.Note) -ForegroundColor Red }
}

$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ''

if ($failed.Count -gt 0) {
    Write-Err "$($failed.Count) 个 profile 同步失败，见上方错误。"
    exit 1
}

# Profiles without dsh-hot-reload cannot pick this up until the app restarts.
$needsRestart = @()
foreach ($c in $candidates) {
    $profilePkg = Join-Path $c.Directory 'package.json'
    $bundles = @()
    try { $bundles = (Read-JsonFile $profilePkg).dsh.profile.bundles } catch { }
    if ($bundles -notcontains 'dsh-hot-reload') { $needsRestart += $c.Name }
}

if ($needsRestart) {
    Write-Warn2 "这些 profile 没有热重载，需完全退出并重启应用才会生效：$($needsRestart -join ', ')"
    Write-Host '    桌面端：右键任务栏托盘图标 → 退出（仅关闭窗口不够）' -ForegroundColor DarkGray
}

Write-Ok '同步完成。'
