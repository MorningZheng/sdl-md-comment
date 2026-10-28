namespace SdlMdComment
{
    using Sdl.Desktop.IntegrationApi;
    using Sdl.Desktop.IntegrationApi.Extensions;
    using Sdl.Desktop.IntegrationApi.Interfaces;
    using Sdl.TranslationStudioAutomation.IntegrationApi;

    /// <summary>
    /// 挂到 Editor 视图底部的面板控制器。
    /// Dock = Bottom 就是"拖放/浮动/缩放/关闭"全部交给 Studio 停靠系统的开关，
    /// 不用自己写任何窗口管理代码。
    /// </summary>
    [ViewPart(
        Id = "SdlMdComment.MdCommentViewPart",
        Name = "MdCommentViewPart_Name",
        Description = "MdCommentViewPart_Description")]
    [ViewPartLayout(typeof(EditorController), Dock = DockType.Bottom, Width = 420, Height = 240)]
    public class MdCommentViewPartController : AbstractViewPartController
    {
        private readonly MdCommentPanel _panel = new MdCommentPanel();

        // 面板正在被 Studio 创建时回调。M1 的 ActiveSegmentChanged 订阅挂在这里，
        // Dispose 里退订；M0 只需要存在这个 override（基类是 abstract）。
        protected override void Initialize()
        {
        }

        protected override IUIControl GetContentControl()
        {
            return _panel;
        }
    }
}
