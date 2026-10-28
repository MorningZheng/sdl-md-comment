namespace SdlMdComment
{
    using Sdl.Desktop.IntegrationApi;
    using Sdl.Desktop.IntegrationApi.DefaultLocations;
    using Sdl.Desktop.IntegrationApi.Extensions;

    /// <summary>
    /// 功能区组。第三方插件不往 Studio 自己的组里塞按钮，惯例是自带一个组，
    /// 挂在「附加功能」页签下——那里专门留给插件。
    /// </summary>
    [RibbonGroup("SdlMdComment.RibbonGroup", "MdCommentRibbonGroup_Name")]
    [RibbonGroupLayout(typeof(StudioDefaultRibbonTabs.AddinsRibbonTabLocation))]
    public class MdCommentRibbonGroup : AbstractRibbonGroup
    {
    }
}
