namespace SdlMdComment
{
    using System;
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
        Description = "MdCommentViewPart_Description",
        Icon = "MdCommentViewPart_Icon")]
    [ViewPartLayout(typeof(EditorController), Dock = DockType.Bottom, Width = 420, Height = 240)]
    public class MdCommentViewPartController : AbstractViewPartController
    {
        // 必须延迟创建：控制器可能在不属于 UI 线程的初始化线程上被构造，
        // 而 WPF 控件在非 STA 线程上 new 会抛，异常又被 Studio 吞掉，表现是面板根本不出现。
        private readonly Lazy<MdCommentPanel> _panel = new Lazy<MdCommentPanel>(() => new MdCommentPanel());

        public MdCommentViewPartController()
        {
            Trace.Write("controller.ctor");
        }

        // 面板被 Studio 纳入布局时回调。M1 的 ActiveSegmentChanged 订阅挂这里，Dispose 里退订。
        protected override void Initialize()
        {
            Trace.Write("controller.Initialize");
        }

        protected override IUIControl GetContentControl()
        {
            Trace.Write("controller.GetContentControl");
            return _panel.Value;
        }
    }
}
