<#!
  版本改写流水线：把 studio2022 包转换为 studio2024/2026 包（无源码重编译）
  原理：18/19 与 17 仅 Sdl.* AssemblyRef 版本号不同（Toolkit 5.1.0/6.1.0 实锤：
  IntegrationApi 家族+ProjectAutomation = 18.0.0.0/19.0.0.0，token c28cdb26c445c888 不变；
  PluginFramework 1.8 / FileTypeSupport 1.0 恒定）。ildasm → 改 .ver → ilasm /key 重签。

  .\tools\patch-version.ps1              # 18 与 19 都出
  前置：dist\悬浮批注-0.7.3.0-studio2022.sdlplugin 存在
#>
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$ildasm = 'C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\ildasm.exe'
$ilasm = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\ilasm.exe'
$sn = 'C:\Program Files (x86)\Microsoft SDKs\Windows\v10.0A\bin\NETFX 4.8 Tools\sn.exe'
$node = 'D:\Object\board\node-v26.11.1-win-x64\node.exe'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Join-Path $root 'dist\悬浮批注-0.7.3.0-studio2022.sdlplugin'
if (-not (Test-Path $src)) { throw "源包不存在：$src" }

# 参数：目标大版本 → 年份
$targets = @(
    @{ n = '18'; year = '2024' },
    @{ n = '19'; year = '2026' }
)

foreach ($t in $targets) {
    $work = Join-Path $root "build\patch-$($t.year)"
    if (Test-Path $work) { Remove-Item $work -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $work | Out-Null

    # 1) 解包源包
    $zip = [System.IO.Compression.ZipFile]::OpenRead($src)
    try {
        foreach ($e in $zip.Entries) {
            # OPC 容器部件（[Content_Types]/_rels）必须保留 —— 重打包时原样带回，否则 Studio 解不开包
            $dest = Join-Path $work ($e.FullName -replace '/', '\')
            New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
        }
    } finally { $zip.Dispose() }

    # 2) ildasm
    Push-Location $work
    & $ildasm /nobar /out=SdlMdComment.il SdlMdComment.dll | Out-Null
    if (-not (Test-Path (Join-Path $work 'SdlMdComment.il'))) { throw "ildasm 失败（$($t.year)）" }

    # 3) 改 .ver：仅 17:0:0:0 会被命中（PluginFramework 1.8/FileType 1.0 不匹配），无误伤
    $il = Join-Path $work 'SdlMdComment.il'
    $text = [IO.File]::ReadAllText($il)
    $count = ([regex]::Matches($text, '\.ver 17:0:0:0')).Count
    if ($count -ne 4) { throw "预期 4 处 .ver 17:0:0:0，实际 $count 处 —— 中止（防误伤）" }
    $text = $text -replace '\.ver 17:0:0:0', ".ver $($t.n):0:0:0"
    [IO.File]::WriteAllText($il, $text)

    # 4) ilasm 重汇编 + 原 snk 重签（/key 直接强命名，一步到位）
    & $ilasm /dll /quiet /output=SdlMdComment.dll /key="$(Join-Path $root 'src\SdlMdComment\SdlMdComment.snk')" SdlMdComment.il
    if ($LASTEXITCODE -ne 0) { throw "ilasm 失败（$($t.year)）" }

    # 5) 强命名校验
    & $sn -q -vf SdlMdComment.dll
    Push-Location $work

    # 6) plugin.xml（UTF-16）：Version=17.0.0.0 → N.0.0.0
    & $node -e "const fs=require('fs');const p='SdlMdComment.plugin.xml';let b=fs.readFileSync(p);let s=b.toString('utf16le');const n=s.split('Version=17.0.0.0').length-1;if(n!==6){console.error('plugin.xml 预期6处，实际'+n);process.exit(1)};s=s.split('Version=17.0.0.0').join('Version=$($t.n).0.0.0');fs.writeFileSync(p,Buffer.from(s,'utf16le'));console.log('plugin.xml 改写 OK')"

    # 7) manifest：17.0-17.9 → N.0-N.9
    $m = Join-Path $work 'pluginpackage.manifest.xml'
    $mt = [IO.File]::ReadAllText($m) -replace 'minversion="17\.0" maxversion="17\.9"', "minversion=""$($t.n).0"" maxversion=""$($t.n).9"""
    [IO.File]::WriteAllText($m, $mt, (New-Object System.Text.UTF8Encoding($true)))

    # 8) 重打包（OPC 同构：[Content_Types] + _rels + 内容）
    $out = Join-Path $root "dist\悬浮批注-0.7.3.0-studio$($t.year).sdlplugin"
    if (Test-Path $out) { Remove-Item $out -Force }
    $zo = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $order = @('[Content_Types].xml', '_rels\.rels', '_rels\pluginpackage.manifest.xml.rels', 'pluginpackage.manifest.xml', 'SdlMdComment.dll', 'SdlMdComment.plugin.resources', 'SdlMdComment.plugin.xml', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'Microsoft.Web.WebView2.Wpf.dll')
        $files = Get-ChildItem $work -Recurse -File | ForEach-Object { @{ Full = $_.FullName; Rel = $_.FullName.Substring($work.Length + 1).Replace('\', '/') } }
        $sorted = @()
        foreach ($o in $order) { $m2 = $files | Where-Object { $_.Rel -eq ($o -replace '\\', '/') }; if ($m2) { $sorted += $m2 } }
        foreach ($f in ($files | Where-Object { $sorted -notcontains $_ -and $_.Rel -notmatch '\.(il|res|resources)$' })) { $sorted += $f }
        foreach ($f in $sorted) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zo, $f.Full, $f.Rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zo.Dispose() }
    Pop-Location
    Write-Host ("出包: {0}  ({1:N2} MB)" -f $out, ((Get-Item $out).Length / 1MB))
}
Write-Host '全部完成。patch 产物未经 18/19 真机验证，安装器/文档需标注实验性。'
