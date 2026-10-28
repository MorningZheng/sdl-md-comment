# sdl-md-comment 开发计划

> Trados Studio 备注（Comments）Markdown/HTML 预览插件。基于 2026-10 调研结论（见 `D:\Object\Node\LM.Gateway\trados-comments-plugin-research.md`）。
> 开发主环境：Trados Studio 2021 (16.2.10, net48)，目标兼容 16 → 19（2021/2022/2024/2026）。

## 一、需求映射

| 需求 | 实现方式 |
|---|---|
| 启动预览后出现窗口 | 面板 = Studio ViewPart（挂 Editor 视图，Dock 底部）；功能区按钮「MD 备注」打开/激活面板 |
| 可以拖放（拖动/浮动） | ViewPart 原生继承 Studio 停靠系统：可拖出成浮动窗口、可吸附、可 Tab 合并，零代码 |
| 窗口随意调整大小 | 停靠系统原生支持（拖边框/浮动窗缩放） |
| 支持关闭 | 面板 X 关闭；按钮可重新打开 |
| 点击 Trados 条目自动切换内容 | `EditorController.ActiveDocumentChanged` + `Document.ActiveSegmentChanged` → 推送当前句段备注到前端 |
| HTML / Markdown 渲染 | WebView2 + markdown-it（md→HTML）+ github-markdown-css（好看）+ highlight.js（代码高亮）+ DOMPurify（净化 HTML 直通） |

> 备选：若后续想要"真正悬浮置顶"的独立窗口（不参与停靠），再加一个 WPF owned Window 版本，事件/渲染层完全复用。M0~M3 不做。

## 二、技术栈（已定）

- 插件壳：C#，net48，SDK 风格 csproj，强命名（snk），`UseWPF`
- 打包：`Sdl.Core.PluginFramework.Build`（NuGet 实测有 16.0.0/16.0.1/16.1.0/17.0.0/18.0.0/18.0.1，19 无）——它从 `[ViewPart]` 特性生成 `.plugin.xml`，并压出 **OPC 容器**的 `.sdlplugin`。实测该包内是 `_rels/.rels` + `[Content_Types].xml` + 数字签名 + 部件，**不是普通 zip，不能手工 zip 顶替**
- manifest：`<RequiredProduct name="SDLTradosStudio" minversion="16.0" maxversion="16.9"/>`（照已装插件的实测写法，产品名是 `SDLTradosStudio`，不是 `TradosStudio`）
- UI 容器：`AbstractViewPartController` + `[ViewPartLayout(typeof(EditorController), Dock = DockType.Bottom)]`
- 面板控件：WPF `UserControl` 直接实现 `IUIControl`（该接口只继承 `IDisposable`，是纯标记接口；Studio 自带 Bookmarks / MixedSource 面板亦为此写法）
- Web 层：WebView2（Evergreen，`Microsoft.Web.WebView2` net48 兼容）+ `SetVirtualHostNameToFolderMapping`
- 前端：Vite + TypeScript，markdown-it / github-markdown-css / highlight.js / DOMPurify
- 桥：消息之上的极简 JSON-RPC（约 50 行），`protocol.ts` 为协议唯一事实源，C# 镜像
- 事件→渲染数据：`GetCommentsFromSegment(ActiveSegmentPair)` → JSON 推送
- 多版本：MSBuild 属性矩阵（StudioVersion = 16/17/18/19），同一源码出 4 个 .sdlplugin

## 三、目录结构

```
sdl-md-comment/
├── PLAN.md
├── build.ps1                  # 一键构建（可选 -StudioVersion 16|17|18|19，默认全矩阵）
├── src/
│   └── SdlMdComment/          # 插件壳（net48）
│       ├── SdlMdComment.csproj
│       ├── SdlMdComment.snk
│       ├── pluginpackage.manifest.xml
│       ├── PluginResources.resx              # 名称/描述/图标，plugin.xml 里存的是键名
│       ├── PluginInfo.cs                     # [assembly: Plugin(...)]，缺它报 PFE004
│       ├── MdCommentViewPartController.cs    # ViewPart 注册（面板延迟创建）
│       ├── MdCommentPanel.cs                 # 面板 UI（M0 无 XAML，代码构建）
│       ├── Trace.cs                          # 写 %LocalAppData%\sdl-md-comment\trace.log
│       ├── icon.ico                          # ViewPart 图标，RWS 自家面板都有，缺了不注册
│       ├── StudioEvents.cs                   # M1：ActiveSegmentChanged 订阅与转发
│       ├── CommentReader.cs                  # M1：GetCommentsFromSegment 封装
│       └── BridgeDispatcher.cs               # M3：JSON-RPC 分发（方法表 + id 关联）
└── ui/                        # 前端（Vite + TS）
    ├── package.json
    ├── src/
    │   ├── main.ts            # bridge 封装 + segmentChanged 订阅 + 渲染入口
    │   ├── protocol.ts        # 请求/事件类型（与 C# 镜像）
    │   └── render.ts          # markdown-it 配置、HTML 直通判定、净化、主题
    └── dist/                  # 产物，随插件 <Include> 分发
```

## 四、里程碑

### M0 骨架点亮（约 0.5 天）
- net48 类库 + snk + manifest（`RequiredProduct 16.0–16.9`），引用本机 Studio16 DLL（HintPath，`Private=false` 不复制）
- ViewPart 挂 Editor 底部；内容先用 WPF TextBlock 显示 "sdl-md-comment loaded"
- **开发期不做 OPC 打包**：直接把产物目录丢进 `%AppData%\SDL\SDL Trados Studio\16\Plugins\Unpacked\SdlMdComment\`（含 `pluginpackage.manifest.xml` + `.plugin.xml` + dll），Studio 扫 Unpacked 即加载；`Packages\*.sdlplugin` 只在 M4 出包时用
- 部署后附加 SDLTradosStudio.exe 调试；加载失败先看 `%AppData%\SDL\SDL Trados Studio\Studio16\logs\`
- **验收**：Studio 打开任意双语文件 → 视图功能区出现面板，可拖动/浮动/缩放/关闭/重开

#### M0 实施记录（2026-10-28，Studio 16.2.10 实测通过）

踩到的坑，按顺序：

1. **打包 task 必须跑在 .NET Framework 版 MSBuild 上**（`Sdl.Core.PluginFramework.BuildTasks.dll` 是 net48），`dotnet build` 加载不了它，插件清单根本不会生成。
2. **VS 的 MSBuild 不带 .NET SDK 解析器**，SDK 式工程报 `MSB4236 找不到 Microsoft.NET.Sdk`。解法：显式设 `MSBuildSDKsPath=<dotnet sdk>\<ver>\Sdks` 并 `-p:MSBuildEnableWorkloadResolver=false`（workload 自动导入同样依赖那套解析器）。restore 仍可走 `dotnet restore`。
3. **必须显式引用 `Sdl.Core.PluginFramework`**：`[assembly: Plugin("Plugin_Name")]`。没有它，task 报 `PFE004 Assembly could not be found`——它要求插件程序集自己有对框架的引用。
4. **`PluginResources.resx` 是必需的**（`PFE100`），plugin.xml 里的 name/description 存的是**资源键**而不是字面量，键值在生成出来的 `.plugin.resources` 里。
5. **`Icon` 不能省**：`.plugin.resources` 里存的是 `System.Drawing.Icon` 对象，RWS 自家的 ViewPart 全都带 `Icon`。resx 用 `System.Resources.ResXFileRef` 指向 `icon.ico` 即可，task 会正确序列化成 Icon。
6. **面板必须延迟创建**：控制器可能在非 UI 线程上被构造，WPF 控件在非 STA 线程 `new` 会抛异常，而 **Studio 会吞掉扩展加载期的异常**（日志里一个字都没有）。用 `Lazy<MdCommentPanel>`，并自己往 `%LocalAppData%\sdl-md-comment\trace.log` 记痕，否则只能盲猜。
7. **task 反射加载插件时需要引用程序集能解析到**：`Private=false` 的话宿主的 `Sdl.*.dll` 不在输出目录，task 找不到。做法是生成清单前临时拷进 `$(TargetDir)`、生成完按输出目录路径删掉（别删 `@(_StudioRefForManifest)` 本身，那指向 Studio 安装目录里的原件）。
8. **Studio 只在 `Unpacked\SdlMdComment` 不存在时才解包 `.sdlplugin`**，改版本号也不重解。所以 `build.ps1 -Deploy` 直接把包里的部件铺到 Unpacked（OPC 的 `_rels/`、`[Content_Types].xml`、`package/` 跳过）；Studio 开着时 DLL 被占用会失败，先关 Studio 再部署。
9. **部署后不会自动进布局**：`视图` 页签里会多出「MD 备注」按钮，点一下才把面板停到编辑器底部；`重置窗口布局` 也能让它归位。这是 Studio 的既有行为，不是插件问题。
10. 手开文档要用文件关联那个开关：`SDLTradosStudio.exe /openDocument "<path>"`；裸路径不会打开。Studio 是单实例，命令行会转交给已在运行的实例。

验收结果：编辑器视图底部出现「MD 备注」面板（`视图` 页签按钮 + 图标正常），显示 `sdl-md-comment loaded` 与程序集/CLR/OS 版本；`controller.ctor → Initialize → GetContentControl → panel.ctor` 全在 UI 线程（t1）。停靠/浮动/缩放由 Studio 原生接管；点面板 X 关闭、再从 `视图 → MD 备注` 重开，行为与原生面板一致（X 的实际点击由人工确认）。

### M1 句段跟随（约 0.5 天）
- 订阅 `ActiveDocumentChanged` / `ActiveSegmentChanged`，读 `ActiveSegmentPair` + `GetCommentsFromSegment`
- 面板显示：句段号 + 备注 JSON（临时纯文本），空备注显示占位
- **验收**：在编辑器里点击/移动句段，面板 200ms 内跟随刷新；切换文档不崩、事件正确重挂

### M2 WebView2 + Markdown 渲染（约 1 天）
- **第一步先解决 UserDataFolder**：默认值会落在宿主 exe 旁（`Program Files (x86)\...\Studio16\`，不可写）→ `EnsureCoreWebView2Async` 直接抛异常。必须 `CoreWebView2Environment.CreateAsync(userDataFolder: %LocalAppData%\sdl-md-comment\webview2)`，之后所有初始化都基于这个 environment
- WebView2 初始化（EnsureCoreWebView2Async），`SetVirtualHostNameToFolderMapping("appassets.sdlmdcomment", <dist>)`（dev 指向 `ui/dist` watch 产物，prod 指向包内目录，仅一个路径变量之差）
- 前端：markdown-it + github-markdown-css + highlight.js；消息推送渲染
- HTML 直通约定：备注文本以 `<!--html-->` 开头则按 HTML 渲染（DOMPurify 净化），否则按 Markdown；纯文本天然是合法 Markdown，原生备注无损兼容
- 严重级别配色（High 红 / Medium 橙 / Low 黄）+ 作者/时间戳
- **验收**：含 `# 标题`、表格、代码块、链接的备注渲染成 GitHub 风格页面；F12 DevTools 可断点；改 `ui/src` 保存后 F5 即生效（不重编插件）

### M3 桥与写回（可选，约 0.5–1 天）
- BridgeDispatcher：`getComments` 拉取 + 事件推送统一走 JSON-RPC（id 关联 Promise、错误透传）
- 面板内 Markdown 编辑框 → `AddCommentOnSegment` 写回（原生备注里存 Markdown 源码，Studio 原生窗口可见纯文本）
- **验收**：面板新增备注 → Studio 原生备注窗口可见同一文本；保存 sdlxliff 后重开不丢

### M4 多版本出包（约 0.5–1 天）
- Directory.Build.props 矩阵：StudioVersion 切 HintPath（Studio16/17/18/19）、RequiredProduct 区间、部署路径
- 16=AnyCPU + `Program Files (x86)\SDL\...`；19=AnyCPU（64 位进程可加载）+ `Program Files\Trados\...Studio19`
- **引用程序集来源要先解决**：本机只有 Studio16 的 `Sdl.*` DLL，17/18/19 的 HintPath 无源可指。两条路二选一——①装 17/18/19 取引用（真机矩阵）；②只编 16 一份二进制，靠强名称重定向跨版本加载（需实测 17/18/19 是否放行，官方自己都按大版本各编一份，风险高）
- **`WebView2Loader.dll` 位数随矩阵走**：16/17/18 是 32 位宿主 → x86 loader；19 是 64 位 → x64 loader。两个同名 native DLL 无法并存于插件根目录，所以只能按版本分包
- build.ps1 全矩阵出 4 个 .sdlplugin；AppStore 分发按版本各一包
- **验收**：16.2 真机全功能回归；17/18/19 至少装机启动不崩、面板出现、跟随正常（19 需 64 位验证 WebView2）

## 五、关键约定

- 协议事件：`segmentChanged {segmentId, source, target, comments[]}` / `documentChanged {fileName}`；请求：`getComments(segmentId)`、`addComment(text, severity)`
- `comments[]` 元素形状：`{ index, text, author, date, severity: "high"|"medium"|"low", version }`；`index` 是当前句段内的稳定序号，M3 的 update/delete 靠它回指 `IComment`
- 握手：前端加载完发 `ready` → 宿主回 `documentChanged` + 当前 `segmentChanged`。C# 侧所有 Studio API 调用必须 marshal 回 UI 线程（`ActiveSegmentChanged` 在编辑器线程触发，`PostWebMessageAsJson` 也只能 UI 线程）
- 备注范围（M0~M3 明确不做）：只读**目标句段**的备注；文件级/项目级备注 `GetCommentsFromSegment` 取不到，原文侧备注官方 API 只读——两块进 P2 再议
- 备注文本约定：默认 Markdown；`<!--html-->` 前缀 = HTML 模式；始终净化
- 前端零网络依赖：全部资源本地 dist（字体走系统栈），离线可用
- WebView2 运行时要求 ≥ 1.0.774.44（Evergreen 自动满足，装机检测一次并提示）

## 六、风险与预案

| 风险 | 预案 |
|---|---|
| WebView2 初始化时序/Dispose 崩溃（社区已知坑） | 初始化放 Loaded 之后异步做；Dispose 时先隔离事件；M2 首日专项验证 |
| 17/18/19 未实测（本机仅 16.2） | M4 前找真机/虚拟机冒烟；引用版本差异全部收在构建矩阵内 |
| ViewPart 关闭后事件悬挂 | 关闭时退订 ActiveSegmentChanged，重开时重挂 |
| 原生备注窗口与面板同时编辑冲突 | M3 编辑框提交后强制刷新本地状态；不监听外部修改（M3 范围外） |
| WebView2 默认 UserDataFolder 在 `Program Files (x86)` 下，不可写 → 初始化抛异常 | 显式传 `userDataFolder`（`%LocalAppData%\sdl-md-comment\webview2`），M2 第一件事就定下来 |
| 17/18/19 引用程序集本机没有 → M4 是"编不出来"而非"未实测" | 见 M4：要么装对应 Studio，要么单二进制跨版本（需实测）；真机冒烟不可省 |
| 19 为 64 位宿主，`WebView2Loader.dll` 位数不符会 `0x8007007E` | 版本分包时各放对应位数的 loader |

## 七、前置环境

- .NET Framework 4.8 Developer Pack、VS2022 或 `dotnet build`（net48）
- Node ≥ 18（前端 Vite）
- WebView2 Evergreen Runtime（Win10/11 一般自带）
- 本机 Trados Studio 2021 16.2.10（调试宿主）
