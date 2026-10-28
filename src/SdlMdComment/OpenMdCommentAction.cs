namespace SdlMdComment
{
    using System;
    using Sdl.Desktop.IntegrationApi;
    using Sdl.Desktop.IntegrationApi.Extensions;

    /// <summary>
    /// 功能区按钮：开/切到悬浮窗口。窗口跑在独立 STA 线程上（见 MdCommentWindowHost），
    /// 所以 Studio 忙或退出时不会把窗口一起拖死。
    /// </summary>
    [Action(
        "SdlMdComment.OpenWindow",
        Name = "MdCommentAction_Name",
        Description = "MdCommentAction_Description",
        Icon = "MdCommentIcon")]
    [ActionLayout(typeof(MdCommentRibbonGroup), 0, DisplayType.Large)]
    public class OpenMdCommentAction : AbstractAction
    {
        private static MdCommentWindowHost _host;

        protected override void Execute()
        {
            try
            {
                if (_host != null)
                {
                    Trace.Write("action: 窗口已存在，激活");
                    _host.Activate();
                    return;
                }

                var host = new MdCommentWindowHost();
                host.Closed += (s, e) =>
                {
                    Trace.Write("action: 窗口已关闭");
                    _host = null;
                };

                host.Start();
                _host = host;
                Trace.Write("action: 窗口已打开");
            }
            catch (Exception ex)
            {
                // 动作里抛异常会直接冒到宿主，必须自己兜住
                Trace.Write("action failed: " + ex);
                _host = null;
            }
        }
    }
}
