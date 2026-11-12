# sdl-md-comment 开发计划

> **产品名：悬浮批注**（2026-10-29 定名）。功能区「附加功能」页签下的按钮、悬浮窗口标题、插件管理器显示名统一为「悬浮批注」。
> 代码内部标识保持 `SdlMdComment` / `sdl-md-comment`（程序集名、插件 id、包名、部署目录），改名只动面向用户的字符串——改标识要连强名称和 plugin.xml 一起动，收益为零、风险不小。

> Trados Studio 备注（Comments）Markdown/HTML 预览插件。基于 2026-10 调研结论（见 `D:\Object\Node\LM.Gateway\trados-comments-plugin-research.md`）。
> 开发主环境：Trados Studio 2021 (16.2.10, net48)，目标兼容 16 → 19（2021/2022/2024/2026）。

## 一、需求映射

| 需求 | 实现方式 |
|---|---|
| 启动预览后出现窗口 | **独立悬浮窗口**（WPF `Window`，owner = Studio 主窗口）+「附加功能」页签里的「悬浮备注」按钮。不进 Studio 的停靠系统 |
| 可以拖放（拖动/浮动） | 就是普通顶层窗口：随便拖、随便摆；owner 是 Studio，所以跟着 Studio 最小化、不会被 Studio 盖住 |
| 窗口随意调整大小 | 标准可缩放窗口；位置和尺寸存在 `%LocalAppData%\sdl-md-comment\window.json`，下次照旧打开 |
| 支持关闭 | 窗口 X 关闭即释放（事件退订 + WebView2 Dispose）；按钮重开，记忆的位置尺寸不变 |
| 点击 Trados 条目自动切换内容 | `EditorController.ActiveDocumentChanged` + `Document.ActiveSegmentChanged` → 推送当前句段备注到前端 |
| HTML / Markdown 渲染 | WebView2 + markdown-it（md→HTML）+ github-markdown-css（好看）+ highlight.js（代码高亮）+ DOMPurify（净化 HTML 直通） |

> **决策记录（2026-10-28）**：最初按 ViewPart 做成 Studio 底部停靠面板并已验收通过，但需求方明确要「不要嵌入 Trados，要漂浮出来」，于是改为独立悬浮窗口。
> 事件层（`StudioEvents`）、数据层（`CommentReader`）、渲染层（`MdCommentPanel` + WebView2 + `ui/`）**一行没改**，只把挂载方式从 `[ViewPart]` 换成 `[Action]` + `[RibbonGroup]`，这正是当初留备选路径的价值。

> 原来的备选路径（ViewPart 停靠面板）已实现并验收通过，现作为「若想回到嵌入模式」的现成退路保留在提交历史里（`dde8d50`..`c092e8d`）。M0~M3 不再涉及停靠。

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
- 面板显示：句段号 + 备注（临时纯文本），空备注显示占位
- **验收**：在编辑器里点击/移动句段，面板 200ms 内跟随刷新；切换文档不崩、事件正确重挂

#### M1 实施记录（已通过）

结构：
- `StudioEvents`：`EditorController.ActiveDocumentChanged` / `Closed` 管文档级，`IStudioDocument.ActiveSegmentChanged` 管句段级。切文档一律先 `DetachDocument()`（退旧文档的 `ActiveSegmentChanged`）再挂新的，否则事件会漏在死对象上。所有回调包 try/catch——Studio 的事件处理器里抛异常会直接影响宿主。
- 线程：构造在 `Initialize`（UI 线程），拿 `Dispatcher.CurrentDispatcher` 兜底；读备注与刷面板都走 `Dispatcher`，不在事件线程上直接碰 Studio API。
- `CommentReader`：`IStudioDocument.ActiveSegmentPair` → `Properties.Id.Id` 取句段号（`SegmentId` 是**结构体**，不能接 `?.`），`GetCommentsFromSegment(pair)` 转 `CommentDto{Index,Text,Author,Date,Severity,Version}`，严重级别只往前端漏小写字符串。
- 面板：句段号 + 备注条数；每条按严重级别画左色条（高红 / 中橙 / 低黄 / 未定级灰）+ 正文 + `级别 · 作者 · 时间`；无备注时显示占位文案。

实测（Studio 16.2.10，3330 句段的真实文件）：
- `controller.ctor → Initialize → StudioEvents.Hook: ok → GetContentControl`，随后 `event: ActiveDocumentChanged`。
- 句段 1 → 5 点击切换，面板从「句段 1」刷成「句段 5」，备注正常显示（`新增机翻` / 高 / 未知作者 / 2026-10-24 16:36）。
- 这份文件 3331 条 `cmt-def`、3330 个 `x-sdl-comment` marker，**几乎每个句段都挂着同一条备注**，所以句段 1 和 5 内容相同是数据本身，不是读错。

顺带修正调研里的一处存储格式描述：实测 `doc-info` 用的是默认命名空间，元素是
`<cmt-def id="..."><Comments><Comment severity="High" user="" date="..." version="1.0">文本</Comment></Comments></cmt-def>`，
不是 `<sdl:cmt-def><sdl:Comment>`。正文锚定仍是 `<mrk mtype="x-sdl-comment" sdl:cid="{id}">`。

未实测项：关闭文档后的重挂（自动化下 `Ctrl+W` 没能让 Studio 关文档），代码路径是「`DetachDocument` 先退订再挂新的」，与已通过的启动/切换路径同一条；留待人工点一下关闭文档确认。

### M2 WebView2 + Markdown 渲染（约 1 天）
- **第一步先解决 UserDataFolder**：默认值会落在宿主 exe 旁（`Program Files (x86)\...\Studio16\`，不可写）→ `EnsureCoreWebView2Async` 直接抛异常。必须 `CoreWebView2Environment.CreateAsync(userDataFolder: %LocalAppData%\sdl-md-comment\webview2)`，之后所有初始化都基于这个 environment
- WebView2 初始化（EnsureCoreWebView2Async），`SetVirtualHostNameToFolderMapping("appassets.sdlmdcomment", <dist>)`（dev 指向 `ui/dist` watch 产物，prod 指向包内目录，仅一个路径变量之差）
- 前端：markdown-it + github-markdown-css + highlight.js；消息推送渲染
- HTML 直通约定：备注文本以 `<!--html-->` 开头则按 HTML 渲染（DOMPurify 净化），否则按 Markdown；纯文本天然是合法 Markdown，原生备注无损兼容
- 严重级别配色（High 红 / Medium 橙 / Low 黄）+ 作者/时间戳
- **验收**：含 `# 标题`、表格、代码块、链接的备注渲染成 GitHub 风格页面；F12 DevTools 可断点；改 `ui/src` 保存后 F5 即生效（不重编插件）

#### M2 实施记录（已通过）

前端（`ui/`，Vite 6 + TS + markdown-it 14 + highlight.js 11 + DOMPurify 3 + github-markdown-css 5）：
- `protocol.ts` 是协议唯一事实源；`bridge.ts` 是 ~60 行 JSON-RPC（id 关联 Promise、method 分发事件），没有宿主（浏览器里）时 `call` reject、`notify` 静默丢弃，可以直接用浏览器调 UI。
- `render.ts` 统一净化：Markdown 渲染出的 HTML 和 `<!--html-->` 直通走同一条 DOMPurify，禁用 `style/form/input/button/iframe/object/embed`；`highlight.js` 走 markdown-it 的 `highlight` 回调，输出 `<pre class="hljs">`。
- 产物名固定（`app.js` / `app.css` / `index.html`，关掉内容 hash），既是插件按固定路径加载的前提，也是以后能写进包清单的前提。

C# 宿主：
- `CoreWebView2Environment.CreateAsync(null, userDataFolder)`，`userDataFolder = %LocalAppData%\sdl-md-comment\webview2`——**这条是硬要求**，默认位置在 `Program Files (x86)` 下必然抛异常。
- 原生 loader 不用管：net48 下 WebView2 按进程位数去 `runtimes\win-<arch>\native\WebView2Loader.dll` 找，SDK 包已经把它铺在输出目录里了，**不需要**再平铺一份到插件根目录。
- 托管 DLL（`Microsoft.Web.WebView2.{Core,Wpf,WinForms}.dll`）必须落到输出目录：`CopyLocalLockFileAssemblies=false` 时它们不会复制，改成 `true` 才有——改完 Sdl.* 因为 `Private=false` 仍然不会被带进来。
- 初始化仍放 `Loaded` 之后异步做；`Dispose` 先摘 `WebMessageReceived` 再 `Dispose()`。
- 起不来时（例如目标机器没装运行时）面板显示错误文案 + 指向 trace.log，不留空白。

部署与打包：
- `.sdlplugin` 现在**自带全部运行时**：`pluginpackage.manifest.xml` 的 `<Include>` 里列了 WebView2 三个托管 DLL、原生 loader、以及 `ui\dist` 三件套；`StageUiDist` 目标先把前端产物铺进输出目录，让 `Include` 都是相对输出目录的固定路径。
- **打包工具会压平嵌套目录**：`ui\dist\index.html` 进包后变成 `ui/index.html`，`runtimes\win-x86\native\WebView2Loader.dll` 变成 `runtimes/WebView2Loader.dll`。这两处都会打断运行时查找，因此：
  - loader：`CoreWebView2Environment.SetLoaderDllFolderPath()` 显式指定目录（按 `runtimes\win-<arch>\native` → `runtimes` → 插件根 依次探测），必须在第一次碰 WebView2 之前调用；
  - 前端：`FindDist()` 先找 `ui\dist`（开发态联接），再退到 `ui`（打包后的平铺布局）。
- `build.ps1 -Deploy` 直接解包 `.sdlplugin` 铺到 `Unpacked\SdlMdComment`，保证加载的就是刚打出来的包；开发态再额外把 `ui\dist` 建成指回仓库的**目录联接**，`npm run watch` 写完 F5 即生效。

实测（Studio 16.2.10）：
- trace：`panel.ctor → webview userDataFolder → webview dist → bridge <- ready`，随后 `ActiveDocumentChanged`。
- HTML 直通：`<!--html-->` 开头的备注渲染出 `<h3>`、`<strong>`、`<em>`，其中的 `<script>alert(1)</script>` 被 DOMPurify 摘掉。
- Markdown：`# 稳定性总结` 渲染成标题、`**Markdown**` 加粗、`- 列表项` 成列表；表格与代码块在滚动区下方（面板高度按 `ViewPartLayout Height=240`）。
- 打开第三个文档时再次触发 `ActiveDocumentChanged`，面板随之切换，未崩。

踩到的两个环境问题（与插件无关，但会挡住构建）：
- 本机没有全局 Node，用的是 `D:\Object\board\node-v24.21.0-win-x64`（v24.21.0 / npm 11.19.0），命令前把它加进 PATH。
- esbuild 默认往 `%TEMP%` 写临时文件，在这台机器上删除时可能报 `Access is denied` 导致 `vite build` 失败。把 `TMP`/`TEMP` 指到工作区内（例如 `.scratch\tmp`）即可稳定复现通过。

### M2.5 改为独立悬浮窗口（已完成）

需求方明确「不要嵌入 Trados，要漂浮出来」，于是把 ViewPart 换成独立窗口。

- `[Action("SdlMdComment.OpenWindow")]` + `[ActionLayout(typeof(MdCommentRibbonGroup), 0, DisplayType.Large)]` → ribbon 按钮。
- `[RibbonGroup("SdlMdComment.RibbonGroup")]` + `[RibbonGroupLayout(typeof(StudioDefaultRibbonTabs.AddinsRibbonTabLocation))]` → 自带一个功能区组，落在「附加功能」页签。
  **坑**：只写 `[ActionLayout(typeof(EditorController), 10, DisplayType.Large)]` 是**不会出现按钮**的——第三方插件必须自带 `AbstractRibbonGroup`，并把 action 挂到自己的组上。
- `MdCommentWindow`：普通 WPF `Window`，owner 用 `Process.GetCurrentProcess().MainWindowHandle`（Studio 多文档时拿 `ActiveWindow` 会跟着文档窗口跑）；位置尺寸存 `%LocalAppData%\sdl-md-comment\window.json`，恢复时夹回虚拟屏幕内。
- 开窗才 hook 事件、关窗就 `Dispose`（`StudioEvents` + `MdCommentPanel`），不留悬挂订阅。

实测：点「悬浮备注」→ trace `panel.ctor → window.ctor → StudioEvents.Hook: ok → webview loader → userDataFolder → dist → bridge <- ready`；窗口显示句段 1 的备注；再打开一份 Markdown 备注的文档，窗口内容随之切成标题 + 加粗 + 列表。

#### 0.5.0 修复：标题栏按钮"失灵"

现象：关闭/最小化按钮点了没反应，尤其是关掉 Studio 之后。

根因有两层：
1. 窗口建在 **Studio 的 UI 线程**上，和 Studio 共用一个消息循环 —— Studio 忙或收尾时窗口必然僵住；
2. 窗口用 `WindowInteropHelper` 挂了 Studio 主窗口做 owner，而 owner 在**另一个线程**。于是"点击未激活的窗口"这一步只做激活，激活又要等 Studio 的线程回应；Studio 一卡，这一次点击就被吞掉，第二次点才有反应——手感就是按钮失灵。

修法：
- 窗口改到**独立 STA 线程**（`MdCommentWindowHost`），自建 `Dispatcher` + `Dispatcher.Run()`，线程设为 `IsBackground = true`（Studio 退出时进程能正常结束，不会被它拖住）；
- **去掉 owner**，改用 `Topmost = true` 保持盖在 Studio 之上 —— 不再依赖任何跨线程激活；
- 跨线程带来的两个必答问题：Studio API 仍只在 Studio 线程调用（`StudioEvents` 的挂载/退订都在那边），快照经窗口线程的 Dispatcher 送过去；构造期间收到的首帧快照先缓存在宿主里，窗口起来后补推（否则面板会一直显示 `—`）。
- 顺手修了深色模式错配：`github-markdown-css` 默认会跟随系统深色切变量，导致浅色卡片里的表格/代码块出现深底浅字，改用 `github-markdown-light.css`。

验证：
- 先点 Studio 抢走焦点（让悬浮窗口处于非前台），**单击一次**最小化即生效；同样条件下单击关闭即关闭；
- 开着窗口关 Studio：4.7s 干净退出，无残留进程/窗口；
- 15 轮开合：WS 509→531（增长收敛、后几轮持平），**GDI 1549→1549 完全持平**，句柄 2456–2816 震荡无趋势，WebView2 进程开 1 关 0。

`Topmost` 的代价是会盖住其它程序（包括浏览器）。若要"只在 Studio 之上"，需要回到 owner 方案，但那条路正是本次故障的来源，不建议。

### M3 写回（已取消）

需求方确认为**只读**：不需要在面板里编辑或新增备注。因此不做 `addComment` / `updateComment`，面板不提供编辑框。

只读定位下仍然有效的那部分简单留着：前端收到 `<!--html-->` 会按 HTML 渲染、其余按 Markdown，但**永远不写回**——原生备注里的纯文本不动。

### （原）M3 桥与写回
- BridgeDispatcher：`getComments` 拉取 + 事件推送统一走 JSON-RPC（id 关联 Promise、错误透传）
- 面板内 Markdown 编辑框 → `AddCommentOnSegment` 写回（原生备注里存 Markdown 源码，Studio 原生窗口可见纯文本）
- **验收**：面板新增备注 → Studio 原生备注窗口可见同一文本；保存 sdlxliff 后重开不丢

### M4 多版本出包（0.7.0）

**产出**：`dist\悬浮批注-0.7.0.0.sdlplugin`（2.26 MB，自包含）。

包内结构（打包工具会压平嵌套目录，清单里的路径都按"第一层目录 + 文件名"落盘）：

```
SdlMdComment.dll                插件本体
SdlMdComment.plugin.xml         由 [Action] 生成
SdlMdComment.plugin.resources   名称/图标
pluginpackage.manifest.xml      产品版本区间
Microsoft.Web.WebView2.*.dll    托管层（Core / WinForms / Wpf）
win-x86\WebView2Loader.dll      32 位宿主（2021/2022/2024）
win-x64\WebView2Loader.dll      64 位宿主（2026）
ui\index.html, app.js, app.css  渲染层
```

**版本支持**：按 Studio 大版本各出一个包——`RequiredProduct` schema 只允许一个产品名，且产品名 17 起改名（见下"0.7.3 修复"），"一个包通吃 16-19"不成立，官方也是按版本各发一包。

| 版本 | 状态 |
|---|---|
| 2021 (16.2.10) | **已实测**：双击/放入 Packages → Studio 自行解包 → 按钮出现 → 开窗正常 → loader 从 `win-x86` 解析、前端从 `ui` 解析 |
| 2022 (17.0.0.1159) | **首测失败**（插件列表不显示）→ 根因已定位并修复（0.7.3，产品名），待复测 |
| 2024 / 2026 (18/19) | 未实测。18 同 17 修法；19 64 位宿主已备 `win-x64` loader，`Environment.Is64BitProcess` 选路 |

未实测的**真实风险**：我们编译时引用的 `Sdl.*` 程序集版本是 `16.0.0.0`。Studio 16 的 `SDLTradosStudio.exe.config` 里**没有**针对 `Sdl.Desktop.IntegrationApi` / `Sdl.TranslationStudioAutomation.IntegrationApi` 的 bindingRedirect（只有 `Sdl.ApiClientSdk.Core` 一条）。若 17/18/19 把这些程序集版本号抬高了，插件会加载失败——官方自己留三个分支分别编译，原因就在这里。

**应对**：`build.ps1` 现在支持按版本出包：

```powershell
.\build.ps1 -StudioVersion 17 -Package                  # 自动找 C:\Program Files\Trados\Trados Studio\Studio17
.\build.ps1 -StudioVersion 17 -StudioRoot "D:\S17" -Package   # 或手动指引用程序集目录
```

拿到 17/18/19 的安装（或只把它们的 `Sdl.*.dll` 拷一份过来），各出一包即可，源码零改动。

### 0.7.3 修复：2022（17）装不上——产品名在 17 改名了

**现象**：17.0.0.1159 上双击 `.sdlplugin` 后，Studio 的插件列表里不显示。

**根因（实锤）**：`RequiredProduct` 按产品名严格匹配，而 SDL→Trados 的内部产品名改名正好发生在 17：

| 证据（官方仓库历史提交） | 版本 | RequiredProduct |
|---|---|---|
| DSI Viewer `434d8745`（v3.0.8.4） | 16.x | `name="SDLTradosStudio" minversion="16.0" maxversion="16.9"` |
| DSI Viewer `cc62d0fd`（v4.0.0.2，2022 包） | 17.0 | `name="TradosStudio" minversion="17.0" maxversion="17.9"` |
| DSI Viewer `291526aa`（v4.2.0.3） | 17.1+ | `name="TradosStudio" minversion="17.1.9" maxversion="17.9"` |
| CommentViewPlugin `Studio_2024`/`Studio_2026` | 18/19 | `name="TradosStudio"` |

我们 0.7.2 包里写的是 16 的老名字 `SDLTradosStudio` + 区间 16.0–19.9——17 的插件框架按名字对不上，扫描阶段直接过滤，症状就是"不出现"（连错误都不给）。

**修复**：
1. `build.ps1` 按 `-StudioVersion` 现场补丁 manifest（16→SDLTradosStudio 16.0-16.9；17/18/19→TradosStudio N.0-N.9），构建完还原源文件；源文件进 git 的默认值是 16。
2. 免编译测试包（0.7.3 正式构建产物只改 manifest 产品名/区间重打包）：
   - 2022(17.0.0.1159)：`dist\悬浮批注-0.7.3.0-studio2022-test.sdlplugin`（TradosStudio 17.0-17.9）
   - 2024(18.1.4.6694)：`dist\悬浮批注-0.7.3.0-studio2024-test.sdlplugin`（TradosStudio 18.0-18.9）
   - 双产品名实验包：`dist\悬浮批注-0.7.3.0-dualproduct-test.sdlplugin`（SDLTradosStudio 16.0-16.9 + TradosStudio 17.0-19.9 两个元素并存，赌框架容忍；测试前必须先清同 id 旧包）

**18/19 是否同产品名坑（已核实）**：是。产品线没有 2023（2022 直接跳 2024），17/18/19 全部要求 `TradosStudio`（官方 17.0 指南原文 "Name should be set to: TradosStudio"；仓库 manifest 证据 17.0/17.1+/18.0/18.1/19.0 全一致）。我们的 N.0-N.9 宽区间是官方锁小版本口径的超集，兼容；17.2 指南的 bindingRedirect 只针对新 Terminology Provider API（本插件不用）。

**第二层坑坐实（2026-11-12 本机 Studio17 实测）**：17（2022）把 IntegrationApi 家族 + ProjectAutomation.Core 抬到了 **17.0.0.0**（16 时代 16.0.0.0），PluginFramework 1.8.0.0 / FileTypeSupport.Framework.Core 1.0.0.0 不变；exe.config **没有**对 Sdl.* 的 bindingRedirect。18 的 API 警告框点名同样四个程序集（18 抬到 18.x）。结论：**跨大版本免编译行不通，每个大版本必须对着该版安装目录重编译**；"双 RequiredProduct 全家桶"实验随之作废（manifest 层就算容忍，二进制层也过不去）。

**17 正式包已出**：本机装了 `C:\Program Files (x86)\Trados\Trados Studio\Studio17`（17.0.0.11594，32 位），`build.ps1 -StudioVersion 17 -Package -Deploy` 直接编译部署，plugin.xml 引用已是 17.0.0.0。**dist 命名规则改为 `-studio<年份>`**（同一程序集版本会为每个 Studio 各编一次，裸版本号会互相覆盖——16 包被 17 包顶掉踩过一次）。

**17 复测的两种结果与后续**：
- **正常出按钮、开窗可用** → 17 的 `Sdl.*` 程序集版本仍是 16.0.0.0，免重编译，17/18 大概率同法全过；
- **列表出现但按钮报错/开窗失败** → 17 抬了程序集版本号，需要针对 17 重编译：把 `C:\Program Files (x86)\Trados\Trados Studio\Studio17\` 下这 6 个 DLL 拷过来，再跑 `.\build.ps1 -StudioVersion 17 -Package`：`Sdl.Core.PluginFramework.dll`、`Sdl.Desktop.IntegrationApi.dll`、`Sdl.Desktop.IntegrationApi.Extensions.dll`、`Sdl.FileTypeSupport.Framework.Core.dll`、`Sdl.ProjectAutomation.Core.dll`、`Sdl.TranslationStudioAutomation.IntegrationApi.dll`。

**安装方式**（给用户）：
1. 双击 `.sdlplugin` → 系统按文件关联调起 `Sdl.Community.SdlPluginInstaller.exe`（Studio 自带）；
2. 或手工放入（绕过安装器）：
   - 2021(16)：`%AppData%\SDL\SDL Trados Studio\16\Plugins\Packages\`
   - 2022/2024/2026(17+)：`%AppData%\Trados\Trados Studio\17\Plugins\Packages\`（AppData 根目录 17 起也换成了 Trados 品牌，版本号随 Studio 大版本）
3. 重启 Studio，打开「附加功能 → 悬浮批注」。

**分发选型（2026-11-12 定稿）**：只用 `.sdlplugin` 官方包。机制依据：①插件发现=纯目录扫描（Packages→启动自动解包 Unpacked，实测），无 COM/注册表/GAC，"注册"是伪需求；②官方安装器按 RequiredProduct 自动路由目标版本；③MSI 仅在企业 GPO/Intune 批量场景才有意义；④自制"扫描+拷贝"等于劣化版官方安装器，还最容易踩双包残留崩溃。若将来要"一键装任意版本"，加一个只做"检测版本→释放对应 sdlplugin→调官方安装器"的 Inno 选择器，不自己拷贝。

**两个自研一键安装器（2026-11-12）**：
- `install.ps1`（**主推**，Win10/11 零依赖）：注册表自动寻找 Trados（16=HKLM\WOW6432Node\SDL\Studio16，17/18=Trados 品牌 x86 键，19=Trados 64 位键），`InstallLocation` 反查 exe 二次确认，按年份选包、升级清残留、Studio 运行中拒绝执行、`-Force/-Uninstall` 可选。本机实测：2021 升 0.7.2→0.7.3、2022 同版本智能跳过。
- `tools/tjs-install.js`（tjs 版，`tjs run tools/tjs-install.js` 运行）：同逻辑，run 模式实测三模式（常规跳过/`--force` 重装/`--uninstall`）全通过。**这版 tjs（tjs-lite-min v26.6.0）的实测坑**：①文件 API 只认正斜杠（反斜杠路径 ENOENT）；②spawn 只认数组形式且**吞参数里的单个反斜杠**——注册表键必须经 bs() 双写（reg 会归一化）；③TextDecoder 不认 utf-16le（手写解码）；④`tjs.cwd` 是字符串属性；⑤`import.meta.url` run 态指向脚本、编译态是裸文件名。**`tjs compile` 打包的独立 exe 在本机有确定性 bug**：部分构建的 exe 启动即 `Error: EPERM`（无任何 JS 输出，改名/换目录无效，同源码 run 模式完全正常）——上游引擎问题，不要用 lite-min 的 compile 分发，安装器一律走 install.ps1。

**compile 单文件方案的真相 + 最终形态（2026-11-12 深夜攻关）**：之前"compile 有上游 bug"是误诊。真凶 = **火绒按调用链拦截新编译 exe 写 %AppData%**（五重实验实锤：D 盘任意写放行/Roaming 一律 EPERM；老 tjs.exe 放行/新 exe 拦截；spawn 的 cmd/PS/老 tjs 子进程全部继承拦截；拷贝的 cmd.exe 直接拒运行；Defender 服务未启用 + HipsTray 在跑）。同源码 run 态全通只是因为老 tjs.exe 是火绒认识的"老面孔"。唯一出路 = **用户把 exe 加入火绒信任区（一次性，仅自用可接受）**。已落地内嵌单文件方案：
- `tools/gen-embed.js`：dist 出包后生成 base64 数据（`tools/packages.data.js`，gitignore）
- `tools/tjs-install.js`：内嵌版——不依赖 dist，base64 解码后 writeFile 字节直写（绕开 compile 态 copyFile EPERM）；全流程进度输出（检测/解码/写入/字节数/写后校验/耗时）；**注册表 + 文件路径扫描双通道找 Trados**（编译态 reg 子进程同样被拦 exit 1——文件扫描是可靠通道：盘符 C~Z × SDL/Trados 品牌 × x86/x64 目录形状）；guardedWrite/guardedRemove 加白引导环（EPERM → 打印火绒信任区指引 → 按回车重试 ×3）
- `tools/make-installer.ps1`：node 二进制拼接（**PS5.1 Get-Content 会把无 BOM UTF-8 按 GBK 读，中文损坏**——拼接严禁走 PowerShell 文本管道）+ `tjs compile` → `dist\install-sdl-md-comment.exe`（9.3MB 自包含）+ 冒烟
- 分发更新节奏：`build.ps1 -Package`（出新包）→ `make-installer.ps1`（重嵌+重编+冒烟），两步出单文件

**官方安装器"no versions installed"弹窗真相（2026-11-12 反射实证）**：双击 sdlplugin 弹 "There are no versions of Trados Studio Installed" 时，**不代表没检测到 Studio，而是"没有可安装的版本"**——安装器（Trados\Plugin installer\，v17.0.0.0，文件关联指向它）的逻辑：StudioVersionService.GetInstalledStudioVersions() 检测两代 Studio 都正常（反射调用实测返回 16.2.10 + 17.0.0.11594）；版本匹配 StudioVersionSuported(**min, max, installed**——参数顺序曾传错致全 False，勿再踩) 对两个包都返回 True；但 GetSelectableVersions 会用 IsPluginInstalledForVersion 把**已装着本插件**的版本剔除（本机 16 有 0.7.2 旧版、17 有 0.7.3 已部署），剔除后列表为空 → 弹误导文案。**对全新机器双击安装无影响**；升级场景需先卸旧版（删 Unpacked 目录 + Packages 包，或 Studio 插件管理器卸载）再双击。检测逻辑在 sdl.versioning.dll（16 系查 SDL 品牌、17 系查 Trados 品牌注册表键）。

**卸载**：从 `Packages` 删掉包、删掉 `Unpacked\<包名>` 目录，或在「附加功能 → 插件」里取消勾选。

**卸载必须清干净（踩过）**：同一插件残留两份（例如 `Packages` 里两个不同文件名的包 → `Unpacked` 下两个目录）时，两份 plugin.xml 里有相同的 action id，Studio 启动阶段注册功能区就炸：

```
FATAL 无法启动服务 'Sdl.Desktop.Platform.CommandBars.IActionService'
System.ArgumentException: 已添加了具有相同键的项
```

表现是 Studio 只弹一个「错误」对话框、主窗口根本不出现。删掉重复的那一份即可恢复。

### 图标（0.7.2）

源图 `C:\Users\zheng\Pictures\玉米饼.png`（1600×1600，32bpp ARGB）。生成多尺寸 ICO：16/24/32/48/64 用 32bpp DIB 帧（兼容性最好），256 用 PNG 帧（体积小）。resx 里仍走 `System.Resources.ResXFileRef` → 打包后的 `.plugin.resources` 里是 `System.Drawing.Icon`。

写 ICO 时踩的坑：DIB 帧的 `BITMAPINFOHEADER.biSize` 必须是 40，留 0 的话三种 `new Icon(...)` 全部抛「The operation completed successfully」——错误信息完全不指向真正原因。

生成脚本：`.scratch\make-icon.ps1 -Source <png>`（接受任意正方形/非正方形 PNG，按等比缩放）。

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
- Node ≥ 18（前端 Vite）——本机用的是便携版 `D:\Object\board\node-v24.21.0-win-x64`
- WebView2 Evergreen Runtime（Win10/11 一般自带）
- 本机 Trados Studio 2021 16.2.10（调试宿主）

## 八、测试记录（2026-10-28，Studio 16.2.10）

脚本在 `.scratch/`（不入库）：`cycle-test.ps1` 开合循环、`open-window.ps1` 开窗口并读内容、`capture-window.ps1` 截图、`quit-studio.ps1` 退出测试。

### 内存与句柄（开关悬浮窗口）

| 轮次 | WS(MB) | Private(MB) | Handles | GDI | USER | WebView2 进程 |
|---|---|---|---|---|---|---|
| 0（关） | 518 | 408 | 2676 | 1542 | 828 | 0 |
| 15（关） | 523 | 412 | 2598 | 1542 | 828 | 0 |

- WS 15 轮 +5MB（≈0.33MB/轮），私有内存 +4MB；**GDI/USER 完全持平**，句柄在 2517–2742 之间震荡、无趋势 —— 没有泄漏特征。
- WebView2 进程开窗时 1 个（约 100MB）、关窗后归零，反复 15 次不堆积。
- 0.4.2 最终构建再回归 5 轮，同样稳定。

### 竞态（开窗后 400ms 内关闭）

**测出并修复了一个真 bug**：`CoreWebView2Environment.SetLoaderDllFolderPath()` 只能在进程内第一次碰该类型之前调用，第二次调用抛 `InvalidOperationException`，表现是**关掉窗口再打开就只剩错误面板**。修法：移到静态构造函数里只执行一次。

追加的防御：初始化过程中窗口被关掉时，控件已 Dispose，若再走 `ShowError()` 会二次抛异常（`async void` 里的二次异常会直接冒到宿主），因此 catch 里先判 `_disposed`。

### 资源缺失兜底

把 `Unpacked\SdlMdComment\ui` 整个挪走再开窗：面板显示「找不到前端产物：ui\dist\index.html。先在 ui 目录跑 npm run build，再用 build.ps1 -Deploy 部署。」，Studio 不崩；把目录挪回后再次开窗即恢复（无需重启 Studio）。

### 内容边界

构造了一份 3330 句段全部挂同一段压测备注的 sdlxliff（副本，不动原件）：

| 输入 | 结果 |
|---|---|
| 数百字长段 | 正常换行、滚动，不撑破布局 |
| emoji 🚀🔥🧪 + 中文标点 + 阿拉伯文 RTL | 正常渲染 |
| `<img src=x onerror=alert()>` | 图片保留、`onerror` 被摘；无弹窗 |
| `<script>` / `<iframe>` / `<svg onload>` | 完全移除 |
| `[点我](javascript:alert())` | markdown-it 拒绝该协议，退化成纯文本 |
| 未闭合 ``` 代码块 | 把后续内容都收进代码块 —— Markdown 标准行为 |
| `<img>` 无 alt | 显示 WebView 的「缺少图片说明」占位 |

### 退出

开着悬浮窗口直接关 Studio：5.1 秒干净退出，`msedgewebview2` 无残留，`DocumentClosed` 事件处理未抛异常。

### 未覆盖

- **机器上没有 WebView2 运行时**的路径（无法卸载模拟；只能确认错误分支会显示提示而非白屏）
- 多显示器 + 混合 DPI 下的窗口位置记忆（本机两屏但缩放一致）
- 连续使用数小时后的表现（只做了分钟级循环）

### Topmost 与内容跟随（0.6.0 实测）

需求方确认：窗口置顶可以接受，前提是切换文件时内容必须跟着换。实测两条都过：

| 操作 | 结果 |
|---|---|
| 打开第二份文件（md-test2） | `ActiveDocumentChanged` → 面板切成该文件的 Markdown 备注 |
| 点回第一份文件的页签 | `ActiveDocumentChanged` → 面板切回原作者备注 |
| 点第 20 段行号 | `ActiveSegmentChanged` → 面板从「句段 1」变「句段 20」，内容随之更换 |

已知代价（需知悉）：`Topmost` 会盖住包括 Studio 自己弹出的对话框在内的所有窗口。若哪天觉得碍事，可以退回"仅 Studio 在前台时置顶"，但那需要监听 Studio 的激活事件，比现在复杂。

### 窗口标题跟随文档（0.6.1）

标题 = 当前活动文件名（即编辑器里那个标签的名字，取自 `IStudioDocument.ActiveFile.Name`，类型是 `Sdl.ProjectAutomation.Core.ProjectFile`），没有文档时回落到「悬浮批注」。

实测：开着 `(初译-pv-pfizer)…-导新翻.sdlxliff` 时标题就是它；打开 `md-test2.sdlxliff` → 标题变 `md-test2.sdlxliff`；切回第一个页签 → 标题变回去。

实现注意：文档名要在**判断句段之前**取，否则刚打开文档、还没落到句段时标题不会更新；`ActiveFile` 在文档关闭过程中可能抛，取值包了 try/catch。

### 一个测试本身的坑

抓悬浮窗口时坐标一直对不上：`GetWindowRect` 在非 DPI 感知进程里返回的是**虚拟化后的逻辑坐标**，而 `CopyFromScreen` 按物理像素取图，两者差 1.5 倍。脚本里先调 `SetProcessDPIAware()` 才对齐。另外 `PrintWindow` 抓 WebView2 会拿到**过期的 GPU 层**（内容按旧宽度排版、右侧被切），判断布局是否正确要看子窗口实际尺寸（`Chrome_WidgetWin_0` 605×423 == 客户区 605×422 即为对齐）或直接屏幕截图。
