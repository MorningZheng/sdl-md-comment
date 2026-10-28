namespace SdlMdComment
{
    using System;
    using System.Windows;
    using System.Windows.Controls;
    using Sdl.Desktop.IntegrationApi.Interfaces;

    /// <summary>
    /// M0 占位面板，只用来证明 ViewPart 能挂进 Editor 底部、停靠/浮动/关闭/重开都正常。
    /// 刻意不写 XAML：M0 的内容太少，代码构建省掉一整套 XAML 编译管道；
    /// M2 上来之后这里的 Content 会被 WebView2 整体替换。
    /// </summary>
    public class MdCommentPanel : UserControl, IUIControl
    {
        // IUIControl 只是 IDisposable 的纯标记接口，WPF UserControl 直接实现即可
        private readonly TextBlock _headline = new TextBlock
        {
            Text = "sdl-md-comment loaded",
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
        };

        private readonly TextBlock _detail = new TextBlock
        {
            Margin = new Thickness(0, 8, 0, 0),
            FontSize = 11,
            Opacity = 0.65,
            TextWrapping = TextWrapping.Wrap,
        };

        public MdCommentPanel()
        {
            Content = new StackPanel
            {
                Margin = new Thickness(12),
                Children = { _headline, _detail },
            }
            ;
            ShowEnvironment();
        }

        private void ShowEnvironment()
        {
            var asm = GetType().Assembly.GetName();
            _detail.Text = string.Join(
                Environment.NewLine,
                $"{asm.Name} {asm.Version}",
                $"CLR {Environment.Version}",
                $"{Environment.OSVersion}");
        }

        public void Dispose()
        {
            // M1 起这里要退订 ActiveSegmentChanged；M2 起还要 Dispose WebView2
        }
    }
}
