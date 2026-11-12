<#!
  拼接内嵌数据 + 安装器源码 → tjs compile 出独立 exe

  .\tools\make-installer.ps1            出 dist\install-sdl-md-comment.exe（含冒烟提示）
  .\tools\make-installer.ps1 -NoSmoke   跳过冒烟

  前置：dist 里已有 *-studioYYYY.sdlplugin（build.ps1 -Package 的产物）
#>
param([switch]$NoSmoke)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$tjs = 'D:\Bin\tjs\tjs-lite-min.exe'
# node 不一定在 PATH；按本机工具箱约定回退到 board 目录
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'D:\Object\board\node-v26.11.1-win-x64\node.exe' }

# 1) 重新生成内嵌数据（保证 dist 里是最新包）
& $node (Join-Path $PSScriptRoot 'gen-embed.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 2) 拼接：数据在前（globalThis.__PKGS__），安装器逻辑在后 —— 不走 import，规避 compile 的模块解析不确定性。
#    必须用 node 做二进制拼接：PS5.1 的 Get-Content 会把无 BOM UTF-8 按 GBK 读，中文内容直接损坏（踩过）
$build = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$full = Join-Path $build 'install-full.js'
& $node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],Buffer.concat([fs.readFileSync(process.argv[2]),Buffer.from('\n'),fs.readFileSync(process.argv[3])]))" $full (Join-Path $root 'tools\packages.data.js') (Join-Path $root 'tools\tjs-install.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 3) 编译
$out = Join-Path $root 'dist\install-sdl-md-comment.exe'
& $tjs compile $full $out
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
"exe: $out  ($([math]::Round((Get-Item $out).Length/1MB,1)) MB)"

if (-not $NoSmoke) {
    "—— 冒烟：--no-pause 实际安装一轮 ——"
    & $out --no-pause
    if ($LASTEXITCODE -ne 0) { "冒烟失败"; exit 1 }
}
