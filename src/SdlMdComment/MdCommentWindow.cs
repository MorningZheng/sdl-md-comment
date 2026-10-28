namespace SdlMdComment
{
    using System;
    using System.Diagnostics;
    using System.IO;
    using System.Windows;
    using System.Windows.Interop;
    using System.Web.Script.Serialization;

    /// <summary>
    /// 真正独立的悬浮窗口：不进 Studio 的停靠系统，跟 Studio 主窗口是 owner 关系
    /// （跟着主窗口最小化、不会被主窗口盖住，但也不是全局 Topmost）。
    ///
    /// 事件与渲染层与原来的 ViewPart 完全复用：MdCommentPanel + StudioEvents 一行没改。
    /// </summary>
    internal sealed class MdCommentWindow : Window
    {
        private static readonly string GeometryPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "sdl-md-comment",
            "window.json");

        private readonly MdCommentPanel _panel = new MdCommentPanel();
        private readonly StudioEvents _events;

        public MdCommentWindow()
        {
            Trace.Write("window.ctor");

            Title = "MD 备注";
            Width = 620;
            Height = 460;
            MinWidth = 320;
            MinHeight = 200;
            ShowInTaskbar = true;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Content = _panel;

            RestoreGeometry();

            // owner 用本进程的主窗口句柄：Studio 是多文档的，拿 ActiveWindow 反而会跟着文档窗口跑
            SourceInitialized += OnSourceInitialized;
            Closing += OnClosing;
            Closed += OnClosed;

            _events = new StudioEvents(snapshot => _panel.Show(snapshot));
            _events.Hook();
        }

        private void OnSourceInitialized(object sender, EventArgs e)
        {
            try
            {
                // using 里包着：Process 对象本身持有一个进程句柄，忘了释放就是每开一次窗漏一个
                using (var self = Process.GetCurrentProcess())
                {
                    if (self.MainWindowHandle != IntPtr.Zero)
                    {
                        new WindowInteropHelper(this).Owner = self.MainWindowHandle;
                    }
                }

                // 记住的位置可能落在已拔掉的显示器上，夹回虚拟屏幕内
                var screen = SystemParameters.VirtualScreenLeft;
                var top = SystemParameters.VirtualScreenTop;
                var right = screen + SystemParameters.VirtualScreenWidth;
                var bottom = top + SystemParameters.VirtualScreenHeight;

                Left = Math.Min(Math.Max(Left, screen), Math.Max(screen, right - Width - 40));
                Top = Math.Min(Math.Max(Top, top), Math.Max(top, bottom - Height - 40));
            }
            catch (Exception ex)
            {
                Trace.Write("window.OnSourceInitialized failed: " + ex);
            }
        }

        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            SaveGeometry();
        }

        private void OnClosed(object sender, EventArgs e)
        {
            Trace.Write("window.Closed");

            // 窗口关掉就把句段事件退干净；下次点按钮是全新的一套
            _events.Dispose();
            _panel.Dispose();
        }

        private void RestoreGeometry()
        {
            try
            {
                if (!File.Exists(GeometryPath))
                {
                    // 没有历史位置就摆在屏幕右下角，比 CenterScreen 更不碍事
                    Left = SystemParameters.WorkArea.Right - Width - 60;
                    Top = SystemParameters.WorkArea.Bottom - Height - 80;
                    return;
                }

                var json = File.ReadAllText(GeometryPath);
                var state = new JavaScriptSerializer().DeserializeObject(json) as System.Collections.Generic.Dictionary<string, object>;
                if (state == null)
                {
                    return;
                }

                Left = Convert.ToDouble(state["left"]);
                Top = Convert.ToDouble(state["top"]);
                Width = Convert.ToDouble(state["width"]);
                Height = Convert.ToDouble(state["height"]);
            }
            catch (Exception ex)
            {
                Trace.Write("window.RestoreGeometry failed: " + ex.Message);
            }
        }

        private void SaveGeometry()
        {
            try
            {
                var state = new
                {
                    left = (int)Left,
                    top = (int)Top,
                    width = (int)Width,
                    height = (int)Height,
                };

                Directory.CreateDirectory(Path.GetDirectoryName(GeometryPath));
                File.WriteAllText(GeometryPath, new JavaScriptSerializer().Serialize(state));
            }
            catch (Exception ex)
            {
                Trace.Write("window.SaveGeometry failed: " + ex.Message);
            }
        }
    }
}
