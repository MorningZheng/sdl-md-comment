# Trados 备注（Comments）插件调研报告

> 调研日期：2026-10-28。调研方式：本地安装目录/插件 DLL 逆向核实 + Studio 本机程序集 API 验证 + GitHub/RWS 文档网络调研（走本地代理 socks5h://127.0.0.1:10808）。

---

## 一、结论（TL;DR）

**三个需求全部可行，但"悬停"除外**：

| 需求 | 可行性 | 路径 |
|---|---|---|
| 点击/移动到某一行，备注面板自动切换显示该句段的备注 | ✅ 现成 API | `EditorController.ActiveDocumentChanged` + `Document.ActiveSegmentChanged` + `ActiveSegmentPair`，开源的 DSI Viewer 已实现同款体验 |
| 鼠标悬停某行预览备注 | ⚠️ 无公开 API | Studio 没有悬停事件；只能用"点击/光标进入句段即切换"近似（体验上已足够顺手）。硬做要 hack 编辑器内部 WPF 可视树，不支持、不稳定，不建议 |
| 备注支持 HTML / Markdown 渲染 | ✅ 自研可做，生态空白 | 原生备注是纯文本（三重证据确认）；在插件面板内用 WebView2/WPF 渲染 Markdown→HTML 即可，写回时仍以纯文本存储，不破坏原生数据 |

**建议路径**：fork **DSI Viewer**（RWS 官方社区开源，WPF/MVVM，面板已挂在编辑器视图底部、已实现活动句段跟随），把它的纯文本显示区换成 WebView2 + markdown 渲染层，即得到你要的东西。次选 fork Capybara Comment View Plugin（MIT 开源），但要把面板从 Files 视图挪到 Editor 视图并新写跟随逻辑，工作量更大。

---

## 二、本机现状（实地核实）

- 快捷方式名叫 "Trados Studio 2021"，实际安装为 **Trados Studio 2021，版本 16.2.10.9305**（目录 `C:\Program Files (x86)\SDL\SDL Trados Studio\Studio16\`）。**内部版本 16 = Studio 2021**，不是 2022（2022 = 17，2024 = 18）。插件目标框架是 **.NET Framework 4.8**。
- 已装第三方插件：**Comment View Plugin v1.6.0**（作者 Capybara Translation，日本开发者 Junya Takaichi；RWS AppStore 已由官方团队接手维护新版）。
  - 出处实锤：`RWS/CommentViewPlugin` 官方仓库的文件结构（`FilesCommentViewPartController.cs`、`ProjectsCommentViewPartController.cs`、`CommentExtractor.cs`）与本机 DLL 及其 plugin.xml 声明完全一致。开源仓库：<https://github.com/capybara-translation/CommentViewPlugin_2019>（MIT）。
  - **它不好用的架构原因**（反汇编 + 声明文件确认）：
    1. 两个备注面板挂在 **Projects 视图和 Files 视图**（`ViewPartLayout(typeof(ProjectsController)/typeof(FilesController))`），不在翻译用的 **Editor 视图**里——翻译时面板根本不在旁边；
    2. UI 是 WinForms `DataGridView` + DataGridViewGrouper 分组，纯文本网格，无富文本、无 Markdown；
    3. 与编辑器没有句段级联动（设计上靠"双击列表项跳转"，方向反了：是列表→编辑器，不是编辑器→列表自动跟随）；
    4. 它的强项是**项目级批注总览 + 导出 Excel**（NPOI），这个定位和你想要的"翻译时跟随显示"是两个场景。

---

## 三、生态里现成的同类插件（全量对比）

AppStore（appstore.rws.com）318 个插件全量过滤后的备注类：

| 插件 | 跟随活动句段 | 富文本 | 写回 | 开源 | 链接 |
|---|---|---|---|---|---|
| 原生备注窗口（CommentsViewPart） | ❌ 要自己滚动列表 | ❌ 纯文本+严重级别三色 | ✅ | — | 视图选项卡 → 备注 |
| Comment View Plugin（你装的，152） | ❌ Files 视图列表 | ❌ | 间接 | ✅ MIT | [plugin/152](https://appstore.rws.com/plugin/152) |
| Comment View Plugin（官方接管版，274） | ❌ 同上 | ❌ | 间接 | ✅ | [Plugin/274](https://appstore.rws.com/Plugin/274) |
| **DSI Viewer**（25）⭐ | ✅ **进入句段即自动显示** | ❌ 纯文本（长内容截断是已知缺陷） | ❌ 只读 | ✅ [Sdl-Community](https://github.com/RWS/Sdl-Community/tree/master/DSI%20Viewer) | [Plugin/25](https://appstore.rws.com/Plugin/25) |
| Segment Information Viewer（260，2026-07 新出） | ✅ 可调布局 | ❌ | ❌ | ❌ | [Plugin/260](https://appstore.rws.com/Plugin/260) |
| Export to Excel（27） | ❌ 批处理 | ❌ | ❌ | ✅ | [Plugin/27](https://appstore.rws.com/Plugin/27) |

**结论**：
- 需求①的现成答案是 **DSI Viewer**——先装来试试（注意在商店页选 Studio 2021/16.x 兼容的历史版本；当前 master 的 manifest 标的是 18.1，未逐一核实 16.x 的发布版本号）。
- **Markdown/HTML 渲染备注：全生态查无此物**（318 个插件里零命中；RWS 2024-12 宣布的富文本只针对云端 Trads Team 的 Project Conversations，不是桌面句段批注）。这是自研插件真正的差异化空间。

---

## 四、关键 API（名称已逐一核实）

前两项在**本机 Studio16 目录的 DLL 元数据/官方 XML 文档里直接验证过**（不依赖网络资料），后三项经官方 17.2 API 文档 + DSI Viewer 源码双重验证：

```csharp
// 1. 挂到编辑器视图底部的面板（DSI Viewer 原文写法）
[ViewPart(Id = "MyComments", Name = "备注", Description = "...", Icon = "ds")]
[ViewPartLayout(typeof(EditorController), Dock = DockType.Bottom)]
public class CommentsController : AbstractViewPartController
{
    protected override IUIControl GetContentControl() => _control;
}

// 2. 活动句段跟踪（编辑器 → 备注面板自动切换）
var editor = SdlTradosStudio.Application.GetController<EditorController>();
editor.Opened += (s, e) => {                          // 文档打开时挂事件
    editor.ActiveDocument.ActiveSegmentChanged += (s2, e2) => {
        ISegmentPair pair = editor.ActiveDocument.ActiveSegmentPair;  // 当前句段
        RenderComments(pair);                          // 刷新面板
    };
};
// editor.ActiveDocumentChanged 也存在（切换文档时重挂）

// 3. 备注读写（IStudioDocument 上的便捷方法）
IComment[] cs = doc.GetCommentsFromSegment(segmentPair);
doc.AddCommentOnSegment(segmentPair, text, Severity.Medium);
doc.UpdateCommentOnSegment(segmentPair, comment, newText, Severity.High);
doc.DeleteCommentOnSegment(segmentPair, comment);

// 4. 备注数据模型（Sdl.FileTypeSupport.Framework.NativeApi）
//    IComment: Text(string) / Author / Date / Severity(High|Medium|Low) / Version
//    ICommentProperties.Comments / .Add / .Delete / .Xml（线程序列化口子）
//    句段内部锚定：BilingualApi.ICommentMarker（可在句段内任意位置挂）

// 5. sdlxliff 存储格式（doc-info 下，sdl 命名空间，非 mqc）
//    <sdl:cmt-defs><sdl:cmt-def id="..."><sdl:Comment user=".." date=".." severity=".." version="..">纯文本</sdl:Comment>
//    正文锚定：<mrk mtype="x-sdl-comment" sdl:cid="{id}">
```

**富文本三重证据（原生备注只能是纯文本）**：① `IComment.Text` 类型就是 `string`；② `AddCommentOnSegment(..., string text, ...)`；③ sdlxliff 里 `<sdl:Comment>` 元素内容为纯字符数据。（mqc 命名空间是质量评分 Quality Metrics，与备注无关。）

**WebView2 先例**：RWS 官方开发者论坛有 "Use of WebView2 in Studio plugins" 专帖，Studio 2024 社区也有插件内嵌 WebView2 的实践帖；Studio 自带 `Sdl.Desktop.Platform.Controls.Browser` 封装。可行，注意异步初始化与 Dispose 时机。

---

## 五、自研方案（推荐架构）

### 技术栈
- C# 类库，**target net48**（16/17/18 全系 Studio 均可加载 net48 插件，DSI Viewer master 至今是 net48 且支持到 Studio 2024/2026）
- 引用本机 `Studio16\` 下的 `Sdl.Desktop.IntegrationApi(.Extensions)`、`Sdl.TranslationStudioAutomation.IntegrationApi`、`Sdl.FileTypeSupport.Framework.Core`、`Sdl.ProjectAutomation.*`（或 NuGet `Sdl.Core.PluginFramework.Build` 16.x，构建时自动生成 `.sdlplugin` 包）
- 程序集必须**强命名**（snk），否则不加载
- manifest：`<RequiredProduct name="TradosStudio" minversion="16.0" maxversion="16.9"/>`，第三方 DLL（WebView2Loader 等）列入 `<Include>`
- UI：WPF UserControl（`UseWPF`）内嵌 **WebView2**，markdig 做 Markdown→HTML，本地 `file://` 或虚拟主机映射加载
- 部署：`%AppData%\SDL\SDL Trados Studio\16\Plugins\`（Packages/Unpacked）；调试 = VS 附加到 `SDLTradosStudio.exe`

### 功能切片
1. **P0 跟随显示**：Editor 底部面板 + ActiveSegmentChanged → 渲染当前句段备注（Markdown 渲染 + 严重级别配色 + 作者/时间）。点击面板中的句段号反向跳转（`doc.SetActiveSegmentPair(file, id)`）。
2. **P1 富文本编辑**：面板内 Markdown 编辑框（所见即所得可后置），保存时把 Markdown 源文本写回 `AddCommentOnSegment`（原生备注里存的就是 Markdown 源码，Studio 原生窗口里可见纯文本，兼容无损）。
3. **P2 增强**：全部句段备注列表/过滤/搜索（学 Capybara 的项目级总览 + Excel 导出）；hover 在面板内预览（面板内是自己的 UI，hover 随便做；编辑器内的 hover 不可行）。

### 风险
- 编辑器**悬停**事件不存在，别把它当硬需求写进 P0；
- 原文（source）句段备注官方 API 只读；
- WebView2 Runtime 需要目标机器有（Win10/11 一般自带，或随插件带 fixed version 分发）；
- Studio 升级到 17/18 时无需改代码（net48 通用），只需放开 manifest 版本区间。

## 六、语言选型（二开可用什么）

约束：Studio 宿主只加载 **.NET Framework 4.8 的强命名 IL 程序集**，两个参考资产（DSI Viewer、Capybara）都是 C#。所以"插件壳"没有选择余地，但实际代码大头可以不在壳里：

| 语言/技术 | 角色 | 结论 |
|---|---|---|
| **C#（net48）** | 插件 DLL：ViewPart 注册、事件订阅、备注读写、WebView2 宿主 | 唯一现实选择；只需写"薄桥"（约 200~400 行），事件→JSON→推给 WebView，收消息→调 API 写回 |
| **TypeScript/JS + HTML/CSS** | WebView2 里的整个 UI 层：Markdown 渲染（markdown-it/marked）、代码高亮（highlight.js）、Mermaid、虚拟列表、编辑器（CodeMirror） | **主力发挥区**，复用 Node 生态；与 C# 桥用 `PostWebMessageAsJson` / `WebMessageReceived` 双向通信 |
| VB.NET / F# / C++-CLI | 理论上都能编成 net48 IL 被加载 | 不要用：零参考代码、零社区样例 |
| Python / Rust / Go / Java | 不能直接做插件 | 宿主不加载；需要时走本地 sidecar 进程（localhost/命名管道），由 C# 壳拉起并桥接——仅当逻辑重到值得时才上 |
| Node.js（sidecar，可选） | 重逻辑外包：AI 调用、批量导出、独立存储（比原生备注多存富文本/附件） | P2+ 再考虑；P0/P1 全部塞进 WebView2 内即可，不起进程 |

WebView2 的 .NET 控件支持 .NET Framework 4.6.2+，net48 宿主可直接用 `Microsoft.Web.WebView2`（WinForms/WPF 包装均有），这是 JS 层能进来的通道。

资产映射：DSI Viewer 的 C# 壳（ViewPart+事件+WPF/MVVM 骨架）直接复用；前端 HTML/TS 全新写；Capybara 的批注提取/Excel 导出逻辑后置移植。

## 八、C#↔JS 互操作的方案分级（net48 约束下）

| 方案 | 定位 | 判断 |
|---|---|---|
| 裸 `PostWebMessageAsJson` / `WebMessageReceived` | 最底层通道 | 只当传输层用，业务别直接裸写（要自己做 id 关联/错误/取消） |
| **手写 50 行 JSON-RPC 调度器**（消息上封装 id→Promise 关联） | 推荐基线 | 无依赖、全控；TS 侧 30 行 `bridge.call/on` 封装 |
| **StreamJsonRpc**（微软，netstandard2.0 → net48 可用） | 进阶 | 接口即协议：C# 定义 interface 得到类型化代理，自带取消/进度/错误规范；自定义 IJsonRpcMessageHandler 桥接 WebView2 消息即可 |
| `AddHostObjectToScript` | JS→C# 直调的官方捷径 | 快但有坑：类型 marshal 有限、**同步代理会卡死 JS 线程**、不能反向推事件；只适合少量拉取式调用 |
| `SetVirtualHostNameToFolderMapping` | 静态资源装载 | 关键 DX：dev 指向 esbuild/vite watch 的 dist 目录，**改前端不用重编插件**；prod 指向安装目录，零改动 |
| C#→JS 事件 | 只有 `PostWebMessageAsJson` 一条路 | host object 无法反向推送，`segmentChanged/documentChanged` 走消息 |
| **Blazor Hybrid** | 真正"无桥"（组件内直接调 C#） | 要求 .NET 6+ 宿主，**Studio 2021 = net48 此路不通**；将来若升 2022 SR2+/2024 再评估（未验证宿主是否加载 .NET 6 插件） |
| 本地 HTTP 服务 + SignalR（OWIN/SignalR2 net48 自托管，或 Core sidecar） | 极致 DX（真浏览器多端调试） | 要管端口/进程生命周期，备注面板这个体量不值得 |
| 进程内 JS 引擎（ClearScript V8 / Jint） | 只跑 JS 逻辑不要 web UI 时 | 与本项目诉求相反；纯 Markdown 转换用 Markdig 即可，不需要 JS |

落地协议样例：

```ts
// renderer（protocol.ts 是唯一事实源，C# 侧镜像同一形状）
const comments = await bridge.call<IComment[]>("getComments", { segmentId });
bridge.on<IComment[]>("segmentChanged", render);
```

```csharp
// host：WebMessageReceived → JSON-RPC 分发 → 方法表 Map<string, Func<JsonElement, Task<object>>>
//      推送：PostWebMessageAsJson(new { @event = "segmentChanged", payload = ... })
```

DX 要点：WebView2 自带 DevTools（F12）+ source map；`AddScriptToExecuteOnDocumentCreated` 注入 `window.bridge` shim 让前端代码浏览器/插件双环境可跑。

## 七、建议动作顺序

1. 先到 AppStore 装 DSI Viewer 的 Studio 2021 版，体验"自动跟随"，确认布局/信息密度是否满意；
2. 若要做富文本，从 `RWS/Sdl-Community/DSI Viewer` fork，替换显示区为 WebView2（P0 约两三天工作量；编辑/写回 P1 再加两三天）；
3. Capybara 仓库（MIT）留作"项目级总览 + Excel 导出"的参考实现。

## 九、跨 Studio 版本兼容性（2021 → 2026，已逐项核实）

版本谱系（内部版本号 = 安装目录 StudioN）：2019=15.x，**2021=16.x（本机 16.2.10）**，2022=17.x，2024=18.x，**2026=19.0（2026 年发布，官方已出）**。

| | 2021 (16.x) | 2022 (17.x) | 2024 (18.x) | 2026 (19.0) |
|---|---|---|---|---|
| 宿主运行时 | .NET FW 4.8 | .NET FW 4.8 | .NET FW 4.8 | **.NET FW 4.8（64 位进程）** |
| 插件 TFM | net48 | net48 | net48 | **net48**（官方 2026 分支实证） |
| PlatformTarget | x86/AnyCPU | x86/AnyCPU | x86/AnyCPU | 官方分支用 **x64**（AnyCPU 亦可加载） |
| 安装目录 | `Program Files (x86)\SDL\SDL Trados Studio\Studio16` | `Program Files\Trados\Trados Studio\Studio17` | 同左 Studio18 | `Program Files\Trados\Trados Studio\Studio19` |
| 插件部署目录 | `%AppData%\SDL\SDL Trados Studio\16\Plugins` | `%AppData%\Trados\Trados Studio\17\Plugins` | 同左 18 | 同左 19 |
| Build NuGet | Sdl.Core.PluginFramework.Build 16.0.x–16.1.0 | 17.0.0 | 18.0.1 | 19.x 未上 NuGet，官方分支直接 HintPath 引用 Studio19 安装目录 |

**API 稳定性**：ViewPart/`AbstractViewPartController`/`EditorController.ActiveSegmentChanged`/`IStudioDocument` 备注四方法，已验证存在于 16.2（本机 DLL）、17.2、18.0、18.1（官方 API 文档逐版核对）；19.0 由官方 CommentViewPlugin `Studio_2026` 分支实证——同一套 ViewPart 控制器代码原样迁移，仅改 csproj/manifest。**业务代码 16→19 零改动**。

**官方多版本发布模式**（`RWS/CommentViewPlugin` 仓库实证）：master（18）/`Studio_2024`/`Studio_2026` 三分支同一份源码，差异仅三处：① Sdl.\* 引用指向各版本安装目录；② RequiredProduct 区间（如 2026 包 = `minversion="19.0" maxversion="19.0.9"`）；③ 部署路径。AppStore 按版本各发一个包。

**本插件的多版本策略**：
1. 一份源码 + MSBuild 属性矩阵（Directory.Build.props 切 StudioVersion），CI 一次产出 4 个 .sdlplugin（16/17/18/19），不做"一个包跨全部版本"的豪赌——强命名引用按大版本锁定，官方自己都不跨（AppStore 模型也是按版本分发）。
2. WebView2 部分天然全版本通用：Evergreen 运行时与 Studio 无关，`SetVirtualHostNameToFolderMapping` 最低运行时 **1.0.774.44**（2021 年起所有更新过的 Win10/11 都满足）；前端 dist 目录随包 `<Include>` 分发。
3. 16.2 为开发/调试主战场（本机实测）；17/18 走 CI 产物 + 至少一台真机冒烟后再发布。

来源：[RWS/CommentViewPlugin 三分支](https://github.com/RWS/CommentViewPlugin/branches/all)、[studio-api-docs 版本序列](https://developers.rws.com/studio-api-docs/)、[Studio 2026 发布公告](https://www.prnewswire.com/news-releases/rws-launches-trados-studio-2026-delivering-major-advances-in-ai-performance-and-productivity-for-language-professionals-302816052.html)、[Studio 2026 64 位讨论](https://www.translatum.gr/forum/index.php?topic=1053526.0)、[WebView2 ICoreWebView2_3 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_3?view=webview2-1.0.2210.55)、[Sdl.Core.PluginFramework.Build NuGet](https://www.nuget.org/packages/Sdl.Core.PluginFramework.Build)。

**修正**：第五/八节遗留的"Studio 2022 SR2 宿主切 .NET 6"说法不成立——官方 2024/2026 分支至今仍是 net48，.NET 6 仅涉及个别组件（如 Terminology Provider），插件线 TFM 自 2021 至 2026 始终是 net48。

