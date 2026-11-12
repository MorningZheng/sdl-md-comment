<#!
  sdl-md-comment 构建脚本

  .\build.ps1                     编译 + 出包（bin\Release\*.sdlplugin）
  .\build.ps1 -Deploy             额外铺到 Studio 的插件目录，重启 Studio 即生效
  .\build.ps1 -Package            出包并复制到 dist\悬浮批注-<版本>.sdlplugin（可直接双击安装）

  跨版本：
  .\build.ps1 -StudioVersion 17                        自动找 Studio 17 的安装目录
  .\build.ps1 -StudioVersion 17 -StudioRoot "D:\S17"   手动指定引用程序集所在目录

  执行策略受限时用： powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
param(
    [ValidateSet('16', '17', '18', '19')]
    [string]$StudioVersion = '16',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    # 引用程序集所在目录；不给就按版本猜（16 在 x86 品牌目录，17+ 在 Trados 品牌目录）
    [string]$StudioRoot,

    [switch]$Deploy,

    [switch]$Package
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

# 引用程序集目录：没显式给就按版本猜。
# 16（2021）在各版本里是唯一装在 Program Files (x86)\SDL 品牌目录下的，
# 17/18/19 统一在 Program Files\Trados\Trados Studio\StudioN。
if (-not $StudioRoot) {
    if ($StudioVersion -eq '16') {
        $StudioRoot = 'C:\Program Files (x86)\SDL\SDL Trados Studio\Studio16'
    }
    else {
        $StudioRoot = "C:\Program Files\Trados\Trados Studio\Studio$StudioVersion"
    }
}

if (-not (Test-Path (Join-Path $StudioRoot 'Sdl.Desktop.IntegrationApi.dll'))) {
    throw "引用程序集不全：$StudioRoot 下没有 Sdl.Desktop.IntegrationApi.dll。装对应版本 Studio，或用 -StudioRoot 指过去。"
}

Write-Host "refs   : $StudioRoot"

# RequiredProduct 的产品名在 17（Studio 2022）改过：16=SDLTradosStudio，17/18/19=TradosStudio。
# 而且 manifest schema 只允许写一个产品名——"一个包通吃 16-19"不成立，官方也是按版本各出一包。
# 所以构建时现场把 manifest 补丁成当前版本的产品名+区间，构建完还原（源文件保持 16 的默认值进 git）。
$product = if ($StudioVersion -eq '16') { 'SDLTradosStudio' } else { 'TradosStudio' }
$verMin = "${StudioVersion}.0"
$verMax = "${StudioVersion}.9"
$manifestPath = Join-Path $root 'src\SdlMdComment\pluginpackage.manifest.xml'
$manifestBackup = [IO.File]::ReadAllText($manifestPath)
$manifestPatched = $manifestBackup -replace
    '<RequiredProduct name="[^"]*" minversion="[^"]*" maxversion="[^"]*" />',
    "<RequiredProduct name=`"$product`" minversion=`"$verMin`" maxversion=`"$verMax`" />"
[IO.File]::WriteAllText($manifestPath, $manifestPatched, (New-Object System.Text.UTF8Encoding($true)))
Write-Host "product: $product $verMin-$verMax"

try {

# restore 走 dotnet 即可，跟插件打包 task 无关
& dotnet restore $proj
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& $msbuild.FullName $proj `
    /nologo /v:minimal `
    /p:Configuration=$Configuration `
    /p:StudioVersion=$StudioVersion `
    /p:StudioRoot=$StudioRoot `
    /p:CreatePluginPackage=true `
    /p:MSBuildEnableWorkloadResolver=false

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$out = Join-Path $root "src\SdlMdComment\bin\$Configuration"
Write-Host "output: $out"
Get-ChildItem $out -File | Select-Object Name, Length | Format-Table -AutoSize

if ($Package) {
    $dist = Join-Path $root 'dist'
    New-Item -ItemType Directory -Force -Path $dist | Out-Null
    $pkg = Join-Path $out 'SdlMdComment.sdlplugin'
    # 包里没有文件版本信息，版本从插件程序集读
    $version = [System.Reflection.AssemblyName]::GetAssemblyName((Join-Path $out 'SdlMdComment.dll')).Version.ToString()
    $target = Join-Path $dist "悬浮批注-$version.sdlplugin"
    Copy-Item $pkg $target -Force
    Write-Host "package: $target  ($([math]::Round((Get-Item $target).Length/1MB,2)) MB)"
}

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

# 开发态：ui\dist 建目录联接指回仓库，`npm run watch` 写完直接 F5 就生效。
# 打包后的 ui 是平铺的（打包工具会压平嵌套目录），运行时优先用这个联接。
$uiDist = Join-Path $root 'ui\dist'
if (Test-Path (Join-Path $uiDist 'index.html')) {
    $uiParent = Join-Path $unpacked 'ui'
    New-Item -ItemType Directory -Force -Path $uiParent | Out-Null
    $link = Join-Path $uiParent 'dist'
    if (Test-Path $link) {
        Remove-Item $link -Recurse -Force
    }
    New-Item -ItemType Junction -Path $link -Target $uiDist | Out-Null
    Write-Host "ui (dev) : $link -> $uiDist"
}
else {
    Write-Warning "ui\dist 不存在，面板会报找不到前端产物；先在 ui 目录跑 npm run build"
}

}
finally {
    # 无论成败都还原 manifest（含 exit 0 的路径，finally 都会走）
    [IO.File]::WriteAllText($manifestPath, $manifestBackup, (New-Object System.Text.UTF8Encoding($true)))
}




