namespace SdlMdComment
{
    using System;
    using System.Windows;
    using System.Windows.Controls;
    using System.Windows.Media;
    using Sdl.Desktop.IntegrationApi.Interfaces;

    /// <summary>
    /// M1 的面板：显示当前句段号和它的备注（纯文本）。
    /// 仍是代码构建 UI，没有 XAML——M2 换成 WebView2 时这里整块会被替换掉。
    /// </summary>
    public class MdCommentPanel : UserControl, IUIControl
    {
        private static readonly Color High = Color.FromRgb(0xC6, 0x28, 0x28);
        private static readonly Color Medium = Color.FromRgb(0xEF, 0x6C, 0x00);
        private static readonly Color Low = Color.FromRgb(0xF9, 0xA8, 0x25);
        private static readonly Color Undefined = Color.FromRgb(0x75, 0x75, 0x75);

        private readonly TextBlock _segment = new TextBlock
        {
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
        };

        private readonly TextBlock _meta = new TextBlock
        {
            FontSize = 11,
            Opacity = 0.6,
            Margin = new Thickness(0, 2, 0, 8),
        };

        private readonly StackPanel _comments = new StackPanel();

        public MdCommentPanel()
        {
            Trace.Write("panel.ctor");

            var header = new StackPanel
            {
                Margin = new Thickness(12, 10, 12, 0),
                Children = { _segment, _meta },
            };

            var scroll = new ScrollViewer
            {
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                Content = _comments,
                Margin = new Thickness(12, 0, 12, 10),
            };

            var root = new DockPanel();
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);
            root.Children.Add(scroll);
            Content = root;

            Show(null);
        }

        /// <summary>由 StudioEvents 在 UI 线程上调用。</summary>
        internal void Show(SegmentSnapshot snapshot)
        {
            _comments.Children.Clear();

            if (snapshot == null || snapshot.SegmentId == null)
            {
                _segment.Text = "—";
                _meta.Text = "没有打开的文档，或光标还没落进任何句段";
                return;
            }

            _segment.Text = "句段 " + snapshot.SegmentId;

            if (snapshot.Comments.Count == 0)
            {
                _meta.Text = "本句段没有备注";
                _comments.Children.Add(new TextBlock
                {
                    Text = "在 Studio 里给这个句段加一条备注，切回来就会显示在这里。",
                    TextWrapping = TextWrapping.Wrap,
                    FontSize = 12,
                    Opacity = 0.55,
                });
                return;
            }

            _meta.Text = $"{snapshot.Comments.Count} 条备注";

            foreach (var comment in snapshot.Comments)
            {
                _comments.Children.Add(BuildComment(comment));
            }
        }

        private static FrameworkElement BuildComment(CommentDto comment)
        {
            var color = SeverityColor(comment.Severity);

            var body = new TextBlock
            {
                Text = comment.Text ?? string.Empty,
                TextWrapping = TextWrapping.Wrap,
                FontSize = 12.5,
            };

            var author = string.IsNullOrWhiteSpace(comment.Author) ? "(未知作者)" : comment.Author;
            var meta = new TextBlock
            {
                Text = $"{SeverityLabel(comment.Severity)} · {author} · {comment.Date:yyyy-MM-dd HH:mm}",
                FontSize = 10.5,
                Opacity = 0.6,
                Margin = new Thickness(0, 4, 0, 0),
            };

            var stack = new StackPanel { Margin = new Thickness(9, 6, 0, 6) };
            stack.Children.Add(body);
            stack.Children.Add(meta);

            return new Border
            {
                BorderThickness = new Thickness(3, 0, 0, 0),
                BorderBrush = new SolidColorBrush(color),
                Background = new SolidColorBrush(Color.FromArgb(12, color.R, color.G, color.B)),
                Margin = new Thickness(0, 0, 4, 6),
                Child = stack,
            };
        }

        private static Color SeverityColor(string severity)
        {
            switch (severity)
            {
                case "high":
                    return High;
                case "medium":
                    return Medium;
                case "low":
                    return Low;
                default:
                    return Undefined;
            }
        }

        private static string SeverityLabel(string severity)
        {
            switch (severity)
            {
                case "high":
                    return "高";
                case "medium":
                    return "中";
                case "low":
                    return "低";
                default:
                    return "未定级";
            }
        }

        public void Dispose()
        {
            // 事件退订在控制器那边做；这里等 M2 接了 WebView2 再负责释放它
        }
    }
}
