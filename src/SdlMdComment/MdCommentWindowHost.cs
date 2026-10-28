namespace SdlMdComment
{
    using System;
    using System.Threading;
    using System.Windows.Threading;

    /// <summary>
    /// 悬浮窗口的宿主：把窗口放到**独立的 STA 线程**上，带自己的 Dispatcher。
    ///
    /// 为什么必须这样：窗口如果和 Studio 共用 UI 线程，Studio 一忙（打开大文件）或者一收尾，
    /// 窗口就跟着僵住，表现就是"标题栏按钮点了没反应"。独立线程之后它自己跑消息循环。
    ///
    /// 跨线程的两条硬约束：
    /// 1. Studio 的 API（事件、读备注）只能在 Studio 的 UI 线程上调 —— StudioEvents 仍在 Studio 线程挂载与退订；
    /// 2. WPF 控件只能在创建它的线程上碰 —— 面板与窗口都在窗口线程创建，快照通过它的 Dispatcher 送过去。
    /// </summary>
    internal sealed class MdCommentWindowHost
    {
        private readonly Dispatcher _studio;
        private readonly StudioEvents _events;
        private readonly ManualResetEventSlim _ready = new ManualResetEventSlim();
        private readonly object _gate = new object();

        private Thread _thread;
        private Dispatcher _ui;
        private MdCommentWindow _window;

        // 窗口线程还没就绪时，快照先存这里；窗口一出来就补推，否则首帧会丢
        private SegmentSnapshot _pending;

        /// <summary>必须在 Studio 的 UI 线程上构造。</summary>
        public MdCommentWindowHost()
        {
            _studio = Dispatcher.CurrentDispatcher;

            // 回调在 Studio 线程触发，ShowSnapshot 内部再切到窗口线程
            _events = new StudioEvents(ShowSnapshot);
            _events.Hook();

            _studio.ShutdownStarted += OnStudioShutdown;
        }

        public void Start()
        {
            _thread = new Thread(Run)
            {
                IsBackground = true,
                Name = "sdl-md-comment-window",
            };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();

            // 等窗口线程把面板和窗口建好，避免 Activate 撞上空引用
            _ready.Wait(8000);
        }

        public void Activate()
        {
            var ui = _ui;
            ui?.BeginInvoke(new Action(() =>
            {
                if (_window == null)
                {
                    return;
                }

                if (_window.WindowState == System.Windows.WindowState.Minimized)
                {
                    _window.WindowState = System.Windows.WindowState.Normal;
                }

                _window.Activate();
            }));
        }

        private void Run()
        {
            _ui = Dispatcher.CurrentDispatcher;
            Trace.Write("window thread: started");

            try
            {
                var panel = new MdCommentPanel();
                _window = new MdCommentWindow(panel);
                _window.Closed += OnWindowClosed;
                _window.Show();

                // 构造期间（窗口线程还没起来）收到的快照在这里补推
                SegmentSnapshot pending;
                lock (_gate)
                {
                    pending = _pending;
                }

                if (pending != null)
                {
                    _window.ShowSnapshot(pending);
                }
            }
            catch (Exception ex)
            {
                Trace.Write("window thread: 建窗口失败 " + ex);
                _ready.Set();
                return;
            }

            _ready.Set();
            Dispatcher.Run();
        }

        private void ShowSnapshot(SegmentSnapshot snapshot)
        {
            lock (_gate)
            {
                _pending = snapshot;
            }

            var ui = _ui;
            if (ui == null)
            {
                // 窗口线程还没把 Dispatcher 建好，等 Run 里补推
                return;
            }

            ui.BeginInvoke(new Action(() =>
            {
                _window?.ShowSnapshot(snapshot);
            }));
        }

        private void OnWindowClosed(object sender, EventArgs e)
        {
            Trace.Write("window thread: closed");

            // 事件退订必须回到 Studio 的 UI 线程；这里不能直接碰 EditorController
            _studio.BeginInvoke(new Action(ReleaseFromStudioThread));

            Dispatcher.CurrentDispatcher.BeginInvokeShutdown(DispatcherPriority.Background);
        }

        private void ReleaseFromStudioThread()
        {
            try
            {
                _studio.ShutdownStarted -= OnStudioShutdown;
                _events.Dispose();
                Closed?.Invoke(this, EventArgs.Empty);
            }
            catch (Exception ex)
            {
                Trace.Write("host release failed: " + ex);
            }
        }

        private void OnStudioShutdown(object sender, EventArgs e)
        {
            // Studio 要退出了，先把我们的窗口关掉，别留一条僵死的壳
            var ui = _ui;
            ui?.BeginInvoke(new Action(() =>
            {
                try
                {
                    _window?.Close();
                }
                catch (Exception ex)
                {
                    Trace.Write("close on shutdown failed: " + ex.Message);
                }
            }));
        }

        /// <summary>窗口真正关掉（且 Studio 线程已处理完退订）后触发。</summary>
        public event EventHandler Closed;
    }
}
