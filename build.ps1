<#!
  sdl-md-comment 构建脚本

  .\build.ps1                    编译 + 出包到 bin\Release（含 .sdlplugin）
  .\build.ps1 -Deploy            额外铺到 Studio 的 Plugins\Unpacked\SdlMdComment，重启 Studio 即生效
  .\build.ps1 -StudioVersion 17  切 Studio 大版本（只换引用程序集路径）

  执行策略受限时用： powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
param(
    [ValidateSet('16', '17', '18', '19')]
    [string]$StudioVersion = '16',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [switch]$Deploy
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$proj = Join-Path $root 'src\SdlMdComment\SdlMdComment.csproj'

# 必须用 .NET Framework 版 MSBuild：Sdl.Core.PluginFramework.Build 的 task 是 net48 程序集，
# dotnet build（netcore MSBuild）加载不了它，插件清单就不会生成。
# 但 VS 的 MSBuild 不带 .NET SDK 解析器，SDK 式工程的 targets 在 dotnet SDK 里，
# 所以手工指 MSBuildSDKsPath 并关掉 workload 自动导入（它同样依赖那套解析器）。
$msbuild = @(
    'C:\Program Files\Microsoft Visual Studio\2022\*\MSBuild\Current\Bin\MSBuild.exe',
    'C:\Program Files (x86)\Microsoft Visual Studio\2022\*\MSBuild\Current\Bin\MSBuild.exe',
    'C:\Program Files\Microsoft Visual Studio\18\*\MSBuild\Current\Bin\MSBuild.exe',
    'C:\Program Files (x86)\Microsoft Visual Studio\2019\*\MSBuild\Current\Bin\MSBuild.exe'
) | ForEach-Object { Get-ChildItem $_ -ErrorAction SilentlyContinue } | Select-Object -First 1

if (-not $msbuild) {
    throw 'MSBuild.exe not found — 需要 VS2022 或 Build Tools'
}

if (-not $env:MSBuildSDKsPath) {
    $sdkLine = dotnet --list-sdks | Select-Object -Last 1
    if ($sdkLine -match '^(\S+)\s+\[(.+)\]$') {
        $env:MSBuildSDKsPath = Join-Path (Join-Path $Matches[2] $Matches[1]) 'Sdks'
    }
}

Write-Host "msbuild: $($msbuild.FullName)"
Write-Host "sdk    : $env:MSBuildSDKsPath"
Write-Host "studio : $StudioVersion / $Configuration"

# restore 走 dotnet 即可，跟插件打包 task 无关
& dotnet restore $proj
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& $msbuild.FullName $proj `
    /nologo /v:minimal `
    /p:Configuration=$Configuration `
    /p:StudioVersion=$StudioVersion `
    /p:CreatePluginPackage=true `
    /p:MSBuildEnableWorkloadResolver=false

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$out = Join-Path $root "src\SdlMdComment\bin\$Configuration"
Write-Host "output: $out"
Get-ChildItem $out -File | Select-Object Name, Length | Format-Table -AutoSize

if (-not $Deploy) {
    exit 0
}

# 16 用 SDL 品牌目录，17+ 换成 Trados 品牌目录
$pluginsRoot = if ($StudioVersion -eq '16') {
    Join-Path $env:APPDATA 'SDL\SDL Trados Studio\16\Plugins'
}
else {
    Join-Path $env:APPDATA "Trados\Trados Studio\$StudioVersion\Plugins"
}

# 走真正的分发路径：.sdlplugin 丢进 Packages，Studio 启动时自己解包到 Unpacked\<名字>
$packages = Join-Path $pluginsRoot 'Packages'
New-Item -ItemType Directory -Force -Path $packages | Out-Null
Copy-Item (Join-Path $out 'SdlMdComment.sdlplugin') $packages -Force
Write-Host "package : $(Join-Path $packages 'SdlMdComment.sdlplugin')"

# Studio 只在目录不存在时才从 Packages 重新解包，版本号变了也不一定会重来。
# 所以直接把包里的部件铺到 Unpacked，保证加载的一定是刚编出来的这套。
# DLL 被 Studio 占用时这里会失败——先关 Studio 再部署。
$unpacked = Join-Path $pluginsRoot 'Unpacked\SdlMdComment'
if (Test-Path $unpacked) {
    try {
        Remove-Item $unpacked -Recurse -Force
    }
    catch {
        Write-Warning "删不掉 $unpacked —— Studio 还开着，关掉之后再跑一次"
        exit 1
    }
}

New-Item -ItemType Directory -Force -Path $unpacked | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $packages 'SdlMdComment.sdlplugin'))
foreach ($entry in $zip.Entries) {
    # OPC 的容器部件不是插件内容，跳过
    if ($entry.FullName -match '^(_rels/|\[Content_Types\]|package/)') {
        continue
    }
    $dest = Join-Path $unpacked $entry.FullName
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
}
$zip.Dispose()
Write-Host "unpacked: $unpacked"

# WebView2 的托管 DLL 与原生 loader 目前不进 .sdlplugin（M4 出正式包时再补 Include），
# 直接从构建输出铺过去。loader 走 runtimes\win-<arch>\native，WebView2 在 net48 下按进程位数找这里。
Get-ChildItem $out -Filter 'Microsoft.Web.WebView2.*.dll' | ForEach-Object {
    Copy-Item $_.FullName $unpacked -Force
}
$runtimes = Join-Path $out 'runtimes'
if (Test-Path $runtimes) {
    Copy-Item $runtimes (Join-Path $unpacked 'runtimes') -Recurse -Force
}

# 前端产物：建目录联接指回仓库的 ui\dist，`npm run watch` 写完直接 F5 就生效，不用重编插件
$uiDist = Join-Path $root 'ui\dist'
if (Test-Path (Join-Path $uiDist 'index.html')) {
    $uiParent = Join-Path $unpacked 'ui'
    New-Item -ItemType Directory -Force -Path $uiParent | Out-Null
    $link = Join-Path $uiParent 'dist'
    if (Test-Path $link) {
        Remove-Item $link -Recurse -Force
    }
    New-Item -ItemType Junction -Path $link -Target $uiDist | Out-Null
    Write-Host "ui      : $link -> $uiDist"
}
else {
    Write-Warning "ui\dist 不存在，面板会报找不到前端产物；先在 ui 目录跑 npm run build"
}




