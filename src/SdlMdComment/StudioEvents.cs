namespace SdlMdComment
{
    using System;
    using System.Windows.Threading;
    using Sdl.TranslationStudioAutomation.IntegrationApi;

    /// <summary>
    /// 句段跟随：EditorController 的文档切换 + Document 的 ActiveSegmentChanged。
    ///
    /// 两个要点：
    /// 1. 切换文档必须把旧文档的事件退掉再挂新的，否则关掉文档后事件还挂在死对象上；
    /// 2. Studio 的事件不一定在 UI 线程上回调，读备注和刷面板都要 marshal 回 Dispatcher，
    ///    而且事件处理器里抛异常会直接影响宿主，所以全部包 try/catch。
    /// </summary>
    internal sealed class StudioEvents : IDisposable
    {
        private readonly Action<SegmentSnapshot> _publish;
        private readonly Dispatcher _dispatcher;

        private EditorController _editor;
        private IStudioDocument _document;

        public StudioEvents(Action<SegmentSnapshot> publish)
        {
            _publish = publish;
            // 构造发生在 Initialize 里，此时已经在 UI 线程
            _dispatcher = Dispatcher.CurrentDispatcher;
        }

        public void Hook()
        {
            try
            {
                _editor = SdlTradosStudio.Application.GetController<EditorController>();
                if (_editor == null)
                {
                    Trace.Write("StudioEvents.Hook: EditorController 拿不到");
                    return;
                }

                _editor.ActiveDocumentChanged += OnActiveDocumentChanged;
                _editor.Closed += OnDocumentClosed;
                Trace.Write("StudioEvents.Hook: ok");

                AttachDocument(_editor.ActiveDocument);
            }
            catch (Exception ex)
            {
                Trace.Write("StudioEvents.Hook failed: " + ex);
            }
        }

        public void Dispose()
        {
            try
            {
                DetachDocument();

                if (_editor != null)
                {
                    _editor.ActiveDocumentChanged -= OnActiveDocumentChanged;
                    _editor.Closed -= OnDocumentClosed;
                    _editor = null;
                }

                Trace.Write("StudioEvents.Dispose: ok");
            }
            catch (Exception ex)
            {
                Trace.Write("StudioEvents.Dispose failed: " + ex);
            }
        }

        private void OnActiveDocumentChanged(object sender, DocumentEventArgs e)
        {
            Trace.Write("event: ActiveDocumentChanged");
            AttachDocument(_editor?.ActiveDocument);
        }

        private void OnDocumentClosed(object sender, DocumentEventArgs e)
        {
            Trace.Write("event: DocumentClosed");
            AttachDocument(_editor?.ActiveDocument);
        }

        private void OnActiveSegmentChanged(object sender, EventArgs e)
        {
            Publish();
        }

        private void AttachDocument(IStudioDocument document)
        {
            DetachDocument();

            _document = document;
            if (_document == null)
            {
                Publish();
                return;
            }

            _document.ActiveSegmentChanged += OnActiveSegmentChanged;
            Publish();
        }

        private void DetachDocument()
        {
            if (_document == null)
            {
                return;
            }

            _document.ActiveSegmentChanged -= OnActiveSegmentChanged;
            _document = null;
        }

        private void Publish()
        {
            if (_dispatcher.CheckAccess())
            {
                PublishCore();
                return;
            }

            _dispatcher.BeginInvoke(new Action(PublishCore));
        }

        private void PublishCore()
        {
            try
            {
                _publish(CommentReader.Read(_document));
            }
            catch (Exception ex)
            {
                Trace.Write("Publish failed: " + ex);
            }
        }
    }
}
