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
                // WebView2 起不来（没装运行时是常见情况）不能让面板空着
                Trace.Write("webview init failed: " + ex);
                ShowError(ex);
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

        private static string FindDist()
        {
            // 插件目录下的 ui\dist。开发时这里是 build.ps1 建出来的目录联接，
            // 指向仓库的 ui\dist，vite build --watch 写完直接 F5 就生效，不用重编插件。
            var assemblyDir = Path.GetDirectoryName(typeof(MdCommentPanel).Assembly.Location);
            if (string.IsNullOrEmpty(assemblyDir))
            {
                return null;
            }

            var dist = Path.Combine(assemblyDir, "ui", "dist");
            return File.Exists(Path.Combine(dist, "index.html")) ? dist : null;
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
            _webView.Visibility = Visibility.Collapsed;
            _status.Visibility = Visibility.Visible;
            _status.Foreground = new SolidColorBrush(Color.FromRgb(0xC6, 0x28, 0x28));
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
