namespace SdlMdComment
{
    using System;
    using System.IO;
    using System.Threading;

    /// <summary>
    /// Studio 会吞掉扩展加载期的异常，日志里也不留痕，面板没出来时无从下手。
    /// 所以自己记一条，排查先看 %LocalAppData%\sdl-md-comment\trace.log。
    /// 写失败一律吞掉——追踪不能反过来把插件搞挂。
    /// </summary>
    internal static class Trace
    {
        private static readonly object Gate = new object();

        private static readonly string LogPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "sdl-md-comment",
            "trace.log");

        public static void Write(string message)
        {
            try
            {
                lock (Gate)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                    File.AppendAllText(
                        LogPath,
                        $"{DateTime.Now:HH:mm:ss.fff} [t{Thread.CurrentThread.ManagedThreadId}] {message}{Environment.NewLine}");
                }
            }
            catch
            {
                // ignore
            }
        }
    }
}
