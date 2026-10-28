namespace SdlMdComment
{
    using System;
        using System.IO;
    using System.Windows;
        using System.Web.Script.Serialization;

    /// <summary>
    /// 悬浮窗口本体。跑在 MdCommentWindowHost 起的独立 STA 线程上，
    /// 因此这里**不要**直接调 Studio 的 API —— 快照由宿主送进来。
    /// </summary>
    internal sealed class MdCommentWindow : Window
    {
        private static readonly string GeometryPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "sdl-md-comment",
            "window.json");

        private readonly MdCommentPanel _panel;

        public MdCommentWindow(MdCommentPanel panel)
        {
            Trace.Write("window.ctor");

            _panel = panel;

            Title = "悬浮批注";
            Width = 620;
            Height = 460;
            MinWidth = 320;
            MinHeight = 200;
            ShowInTaskbar = true;
            WindowStartupLocation = WindowStartupLocation.Manual;

            // 不设 Owner：窗口跑在独立线程上，一旦挂到 Studio（另一个线程）的窗口上，
            // 激活就要等 Studio 的线程响应——Studio 一忙或一收尾，第一次点击只会"激活"而不执行，
            // 表现就是标题栏按钮像失灵。改为置顶，既保持盖在 Studio 之上，又完全自成一体。
            Topmost = true;

            Content = _panel;

            RestoreGeometry();

            SourceInitialized += OnSourceInitialized;
            Closing += OnClosing;
            Closed += OnClosed;
        }

        /// <summary>由宿主的窗口线程调用。</summary>
        public void ShowSnapshot(SegmentSnapshot snapshot)
        {
            // 标题跟随当前文档（即编辑器里那个标签的名字）；没有文档时回落到产品名
            var name = snapshot == null ? null : snapshot.DocumentName;
            Title = string.IsNullOrWhiteSpace(name) ? "悬浮批注" : name;

            _panel.Show(snapshot);
        }

        private void OnSourceInitialized(object sender, EventArgs e)
        {
            try
            {
                // 记住的位置可能落在已拔掉的显示器上，夹回虚拟屏幕内
                var left = SystemParameters.VirtualScreenLeft;
                var top = SystemParameters.VirtualScreenTop;
                var right = left + SystemParameters.VirtualScreenWidth;
                var bottom = top + SystemParameters.VirtualScreenHeight;

                Left = Math.Min(Math.Max(Left, left), Math.Max(left, right - Width - 40));
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
