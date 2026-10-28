namespace SdlMdComment
{
    using System;
    using System.IO;
    using System.Windows;
    using System.Windows.Controls;
    using System.Windows.Media;
    using Microsoft.Web.WebView2.Core;
    using Microsoft.Web.WebView2.Wpf;
    using Sdl.Desktop.IntegrationApi.Interfaces;

    /// <summary>
    /// WebView2 宿主。加载 ui\dist 里的前端，通过 JSON-RPC 收句段快照。
    ///
    /// 两个必须踩对的点：
    /// 1. UserDataFolder 一定要显式指定。默认位置是宿主 exe 旁边（Program Files (x86) 下），不可写，
    ///    EnsureCoreWebView2Async 会直接抛；
    /// 2. 初始化放在 Loaded 之后异步做，Dispose 时先摘事件再 Dispose，别在没初始化完就释放。
    /// </summary>
    public class MdCommentPanel : UserControl, IUIControl
    {
        private const string VirtualHost = "appassets.sdlmdcomment";

        private readonly WebView2 _webView = new WebView2 { Visibility = Visibility.Collapsed };

        private readonly TextBlock _status = new TextBlock
        {
            Margin = new Thickness(12),
            TextWrapping = TextWrapping.Wrap,
            FontSize = 12,
            Foreground = new SolidColorBrush(Color.FromRgb(0x6E, 0x77, 0x81)),
            Text = "正在启动 WebView2…",
        };

        private SegmentSnapshot _pending;
        private bool _coreReady;
        private bool _initialized;
        private bool _disposed;

        /// <summary>
        /// SetLoaderDllFolderPath 有个硬约束：**必须在进程内第一次碰 CoreWebView2Environment 之前**调用，
        /// 之后再调会抛「The function should be called before any other API is called」。
        /// 所以放静态构造里只执行一次——关掉窗口再打开时不能再碰它。
        /// </summary>
        static MdCommentPanel()
        {
            try
            {
                EnsureNativeLoader();
            }
            catch (Exception ex)
            {
                Trace.Write("static ctor: loader probe failed: " + ex.Message);
            }
        }

        public MdCommentPanel()
        {
            Trace.Write("panel.ctor");

            var root = new Grid();
            root.Children.Add(_webView);
            root.Children.Add(_status);
            Content = root;

            Loaded += OnLoaded;
        }

        /// <summary>由 StudioEvents 在 UI 线程上调用。</summary>
        internal void Show(SegmentSnapshot snapshot)
        {
            _pending = snapshot;

            if (!_coreReady)
            {
                // 前端还没就绪（或者 WebView2 起不来），先记着，ready 之后补推
                return;
            }

            PostSnapshot(snapshot);
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            if (_initialized || _disposed)
            {
                return;
            }

            _initialized = true;

            try
            {
                await InitializeWebViewAsync();
            }
            catch (Exception ex)
            {
                // WebView2 起不来（没装运行时是常见情况）不能让面板空着。
                // 但如果在初始化途中窗口就被关了，控件已经 Dispose，再碰 UI 会二次抛异常，
                // 而 async void 里的二次异常会直接冒到宿主——只记日志。
                Trace.Write("webview init failed: " + ex);
                if (!_disposed)
                {
                    ShowError(ex);
                }
            }
        }

        private async System.Threading.Tasks.Task InitializeWebViewAsync()
        {
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "sdl-md-comment",
                "webview2");

            Directory.CreateDirectory(userDataFolder);
            Trace.Write("webview userDataFolder: " + userDataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await _webView.EnsureCoreWebView2Async(environment);

            if (_disposed)
            {
                return;
            }

            var core = _webView.CoreWebView2;

            // 开发期要能 F12，也要能右键刷新
            core.Settings.AreDevToolsEnabled = true;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.IsStatusBarEnabled = false;

            // 面板里的链接一律不外跳、不弹窗：WebView 不能被导航走
            core.NewWindowRequested += (s, args) => args.Handled = true;
            core.NavigationStarting += (s, args) => args.Cancel = false;
            core.WebMessageReceived += OnWebMessageReceived;

            var dist = FindDist();
            if (dist == null)
            {
                throw new DirectoryNotFoundException(
                    "找不到前端产物：ui\\dist\\index.html。先在 ui 目录跑 npm run build，再用 build.ps1 -Deploy 部署。");
            }

            Trace.Write("webview dist: " + dist);
            core.SetVirtualHostNameToFolderMapping(VirtualHost, dist, CoreWebView2HostResourceAccessKind.Allow);

            _coreReady = true;
            core.Navigate($"https://{VirtualHost}/index.html");

            _status.Visibility = Visibility.Collapsed;
            _webView.Visibility = Visibility.Visible;
        }

        /// <summary>
        /// .sdlplugin 打包工具会把嵌套目录压平（`runtimes\win-x86\native\x.dll` → `runtimes\x.dll`），
        /// 而 WebView2 默认只按 `runtimes\win-<arch>\native` 找 loader，所以这里自己探一遍并显式指定。
        /// </summary>
        private static void EnsureNativeLoader()
        {
            var assemblyDir = Path.GetDirectoryName(typeof(MdCommentPanel).Assembly.Location);
            if (string.IsNullOrEmpty(assemblyDir))
            {
                return;
            }

            var arch = Environment.Is64BitProcess ? "win-x64" : "win-x86";
            var candidates = new[]
            {
                Path.Combine(assemblyDir, "runtimes", arch, "native"),
                Path.Combine(assemblyDir, "runtimes"),
                assemblyDir,
            };

            foreach (var dir in candidates)
            {
                if (File.Exists(Path.Combine(dir, "WebView2Loader.dll")))
                {
                    CoreWebView2Environment.SetLoaderDllFolderPath(dir);
                    Trace.Write("webview loader: " + dir);
                    return;
                }
            }

            Trace.Write("webview loader: 没找到 WebView2Loader.dll，退回默认查找");
        }

        private static string FindDist()
        {
            var assemblyDir = Path.GetDirectoryName(typeof(MdCommentPanel).Assembly.Location);
            if (string.IsNullOrEmpty(assemblyDir))
            {
                return null;
            }

            // ui\dist 是开发态（目录联接指回仓库，npm run watch 写完 F5 即生效）；
            // ui 是打包后的平铺布局。
            var candidates = new[]
            {
                Path.Combine(assemblyDir, "ui", "dist"),
                Path.Combine(assemblyDir, "ui"),
            };

            foreach (var dir in candidates)
            {
                if (File.Exists(Path.Combine(dir, "index.html")))
                {
                    return dir;
                }
            }

            return null;
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var method = Bridge.ReadMethod(e.WebMessageAsJson);
                Trace.Write("bridge <- " + (method ?? "(unknown)"));

                if (method == "ready" && _pending != null)
                {
                    PostSnapshot(_pending);
                }
            }
            catch (Exception ex)
            {
                Trace.Write("bridge receive failed: " + ex);
            }
        }

        private void PostSnapshot(SegmentSnapshot snapshot)
        {
            try
            {
                _webView.CoreWebView2?.PostWebMessageAsJson(Bridge.SegmentChanged(snapshot));
            }
            catch (Exception ex)
            {
                Trace.Write("post failed: " + ex);
            }
        }

        private void ShowError(Exception ex)
        {
            if (_disposed)
            {
                return;
            }

            _webView.Visibility = Visibility.Collapsed;
            _status.Visibility = Visibility.Visible;
            _status.Foreground = new SolidColorBrush(Color.FromRgb(0xC6, 0x28, 0x28));

            // 缺前端产物和 WebView2 起不来是两回事，别给不相干的建议
            if (ex is DirectoryNotFoundException)
            {
                _status.Text = ex.Message;
                return;
            }

            _status.Text = "WebView2 启动失败：" + ex.Message
                + Environment.NewLine + Environment.NewLine
                + "确认已安装 WebView2 Evergreen 运行时；详情见 %LocalAppData%\\sdl-md-comment\\trace.log";
        }

        public void Dispose()
        {
            _disposed = true;

            try
            {
                if (_webView.CoreWebView2 != null)
                {
                    _webView.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                }

                (_webView as IDisposable)?.Dispose();
            }
            catch (Exception ex)
            {
                Trace.Write("panel.Dispose failed: " + ex);
            }
        }
    }
}
