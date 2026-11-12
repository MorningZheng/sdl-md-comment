<#!
  悬浮批注 一键安装器 —— 自动寻找已安装的 Trados Studio，安装对应版本的插件

  .\install.ps1                检测 + 安装/升级（同版本已装则跳过）
  .\install.ps1 -Force         同版本也强制重装
  .\install.ps1 -Uninstall     从所有检测到的 Studio 卸载本插件
  .\install.ps1 -DistDir X     指定 sdlplugin 所在目录（默认 <脚本目录>\dist）

  原理（无需管理员、不写任何注册表）：
    1) 读注册表定位已装的 Studio：16=SDL 品牌(x86)，17/18=Trados 品牌(x86)，19=Trados(x64)；
       键里的 InstallLocation 反查 SDLTradosStudio.exe 做二次确认；
    2) 把对应年份的 .sdlplugin 拷进该版本 %AppData% 的 Plugins\Packages\；
    3) 预解包到 Unpacked\SdlMdComment（先清旧目录——同 id 双包会让 Studio 启动崩溃）。
  Studio 发现插件靠纯目录扫描，没有"注册"环节。
#>
param(
    [switch]$Force,
    [switch]$Uninstall,
    [string]$DistDir
)
$ErrorActionPreference = 'Stop'
$pluginId = 'SdlMdComment'
$root = $PSScriptRoot
if (-not $DistDir) { $DistDir = Join-Path $root 'dist' }

# 三个来源都已实证：注册表键形（2026-11-12 reg query）、AppData 品牌分界（17 起 SDL→Trados）、年份映射
$targets = @(
    @{ Year = '2021'; Reg = 'HKLM:\SOFTWARE\WOW6432Node\SDL\Studio16';    AppData = 'SDL\SDL Trados Studio\16' },
    @{ Year = '2022'; Reg = 'HKLM:\SOFTWARE\WOW6432Node\Trados\Studio17'; AppData = 'Trados\Trados Studio\17' },
    @{ Year = '2024'; Reg = 'HKLM:\SOFTWARE\WOW6432Node\Trados\Studio18'; AppData = 'Trados\Trados Studio\18' },
    @{ Year = '2026'; Reg = 'HKLM:\SOFTWARE\Trados\Studio19';             AppData = 'Trados\Trados Studio\19' }
)

if (-not $Uninstall) {
    $packages = Get-ChildItem (Join-Path $DistDir '*.sdlplugin') -ErrorAction SilentlyContinue
    if (-not $packages) { throw "在 $DistDir 找不到任何 .sdlplugin —— 先跑 build.ps1 -Package" }
}

# Studio 在跑必须停手：Unpacked 里的 DLL 被占用，装了也是下次才生效且可能半途失败
if (Get-Process SDLTradosStudio -ErrorAction SilentlyContinue) {
    throw 'Trados Studio 正在运行，请先全部关闭再执行。'
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$found = 0
foreach ($t in $targets) {
    # --- 检测：注册表键 + InstallLocation 反查 exe ---
    $exe = $null
    if (Test-Path $t.Reg) {
        $loc = (Get-ItemProperty $t.Reg -ErrorAction SilentlyContinue).InstallLocation
        if ($loc -and (Test-Path (Join-Path $loc 'SDLTradosStudio.exe'))) { $exe = $loc }
    }
    if (-not $exe) { continue }
    $found++

    $pluginsRoot = Join-Path $env:APPDATA (Join-Path $t.AppData 'Plugins')
    $packagesDir = Join-Path $pluginsRoot 'Packages'
    $unpacked    = Join-Path $pluginsRoot "Unpacked\$pluginId"

    if ($Uninstall) {
        foreach ($p in @((Join-Path $packagesDir "$pluginId.sdlplugin"), $unpacked)) {
            if (Test-Path $p) { Remove-Item $p -Recurse -Force }
        }
        Write-Host ("卸载: Studio {0}  ({1})" -f $t.Year, $exe)
        continue
    }

    # --- 选包：文件名带年份（悬浮批注-0.7.3.0-studio2022.sdlplugin）---
    $pkg = Get-ChildItem (Join-Path $DistDir ("*studio{0}.sdlplugin" -f $t.Year)) -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $pkg) { Write-Warning ("没有 {0} 年的包（dist 里缺 *studio{0}.sdlplugin），跳过该版本" -f $t.Year); continue }
    $pkgVer = if ($pkg.Name -match '-(\d+\.\d+\.\d+\.\d+)-') { $Matches[1] } else { $null }

    # --- 已装版本：Unpacked 里的 plugin.xml（UTF-16 带 BOM，-Raw 转 [xml]）---
    $installedVer = $null
    $pluginXml = Join-Path $unpacked "$pluginId.plugin.xml"
    if (Test-Path $pluginXml) {
        try { $installedVer = ([xml](Get-Content $pluginXml -Raw)).plugin.version } catch {}
    }

    if (-not $Force -and $installedVer -eq $pkgVer) {
        Write-Host ("跳过: Studio {0} 已是 {1}" -f $t.Year, $pkgVer)
        continue
    }

    # --- 安装：清旧（防同 id 双包崩溃）→ 拷包 → 预解包 ---
    if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $packagesDir | Out-Null
    Copy-Item $pkg.FullName (Join-Path $packagesDir "$pluginId.sdlplugin") -Force

    $zip = [System.IO.Compression.ZipFile]::OpenRead($pkg.FullName)
    try {
        New-Item -ItemType Directory -Force -Path $unpacked | Out-Null
        foreach ($e in $zip.Entries) {
            # OPC 容器部件不是插件内容
            if ($e.FullName -match '^(_rels/|\[Content_Types\]|package/)') { continue }
            $dest = Join-Path $unpacked $e.FullName
            New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
        }
    }
    finally { $zip.Dispose() }
    Write-Host ("安装: Studio {0}  {1}  ->  {2}" -f $t.Year, $pkgVer, $unpacked)
}

if (-not $found) { Write-Warning '注册表里没找到任何已安装的 Trados Studio。'; exit 1 }
Write-Host '完成。重启 Trados Studio 后生效（附加功能 → 悬浮批注）。'
