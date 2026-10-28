namespace SdlMdComment
{
    using System;
    using Sdl.Desktop.IntegrationApi;
    using Sdl.Desktop.IntegrationApi.Extensions;
    
    /// <summary>
    /// 功能区按钮：开/切到悬浮窗口。挂到 Editor 视图的 ribbon 上，
    /// 翻译时点一下就出来，不占 Studio 的停靠位。
    /// </summary>
    [Action(
        "SdlMdComment.OpenWindow",
        Name = "MdCommentAction_Name",
        Description = "MdCommentAction_Description",
        Icon = "MdCommentIcon")]
    [ActionLayout(typeof(MdCommentRibbonGroup), 0, DisplayType.Large)]
    public class OpenMdCommentAction : AbstractAction
    {
        private static MdCommentWindow _window;

        protected override void Execute()
        {
            try
            {
                if (_window != null)
                {
                    Trace.Write("action: 窗口已存在，激活");
                    _window.Activate();
                    return;
                }

                _window = new MdCommentWindow();
                _window.Closed += (s, e) =>
                {
                    Trace.Write("action: 窗口已关闭");
                    _window = null;
                };
                _window.Show();
                Trace.Write("action: 窗口已打开");
            }
            catch (Exception ex)
            {
                // 动作里抛异常会直接冒到宿主，必须自己兜住
                Trace.Write("action failed: " + ex);
                _window = null;
            }
        }
    }
}
