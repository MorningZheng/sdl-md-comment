namespace SdlMdComment
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using Sdl.FileTypeSupport.Framework.BilingualApi;
    using Sdl.FileTypeSupport.Framework.NativeApi;
    using Sdl.TranslationStudioAutomation.IntegrationApi;

    /// <summary>一条备注的渲染数据。字段与 protocol.ts 里的 CommentDto 一一对应。</summary>
    internal sealed class CommentDto
    {
        public int Index { get; set; }

        public string Text { get; set; }

        public string Author { get; set; }

        public DateTime Date { get; set; }

        /// <summary>high / medium / low / undefined，跨进程用字符串，别把枚举漏给前端。</summary>
        public string Severity { get; set; }

        public string Version { get; set; }
    }

    /// <summary>一次句段快照：当前文档名 + 当前句段号 + 它的备注。M2 会往里加 source / target。</summary>
    internal sealed class SegmentSnapshot
    {
        /// <summary>当前活动文件的名字，用来做窗口标题。</summary>
        public string DocumentName { get; set; }

        public string SegmentId { get; set; }

        public List<CommentDto> Comments { get; } = new List<CommentDto>();
    }

    internal static class CommentReader
    {
        public static SegmentSnapshot Read(IStudioDocument document)
        {
            var snapshot = new SegmentSnapshot();
            if (document == null)
            {
                return snapshot;
            }

            // 文档名要在句段判断之前取：刚打开文档、还没落到句段时也要能更新标题
            snapshot.DocumentName = ReadDocumentName(document);

            // 文档刚打开、或编辑器里还没落到任何句段时这里是 null，不算异常
            var pair = document.ActiveSegmentPair;
            if (pair == null)
            {
                return snapshot;
            }

            // SegmentId 是结构体，不能直接接在 ?. 后面
            snapshot.SegmentId = pair.Properties == null ? null : pair.Properties.Id.Id;

            // 双通道收集：官方 GetCommentsFromSegment 覆盖段落属性级备注，但实测漏掉
            // 锚在句中 markup 的局部备注（sdlxliff 里 target 文本中间的 mrk x-sdl-comment，
            // 即 ICommentMarker）——所以再加一道对 source/target 的递归 markup 遍历。
            var collected = new List<IComment>();
            var official = document.GetCommentsFromSegment(pair);
            if (official != null)
            {
                collected.AddRange(official.OfType<IComment>());
            }

            CollectMarkerComments(pair.Source, collected);
            CollectMarkerComments(pair.Target, collected);

            // 同一线程可能被两条通道同时读到（author+date+text 去重），顺序保持首次出现
            var index = 1;
            foreach (var comment in Dedupe(collected))
            {
                snapshot.Comments.Add(new CommentDto
                {
                    Index = index++,
                    Text = comment.Text,
                    Author = comment.Author,
                    Date = comment.Date,
                    Severity = MapSeverity(comment.Severity),
                    Version = comment.Version,
                });
            }

            return snapshot;
        }

        /// <summary>递归收集容器里所有 ICommentMarker（句中局部备注）挂的备注线程。</summary>
        private static void CollectMarkerComments(IAbstractMarkupDataContainer container, List<IComment> acc)
        {
            if (container == null)
            {
                return;
            }

            foreach (var item in container)
            {
                if (item is ICommentMarker marker)
                {
                    var thread = marker.Comments;
                    if (thread != null)
                    {
                        acc.AddRange(thread.Comments.OfType<IComment>());
                    }
                }
                else if (item is IAbstractMarkupDataContainer nested)
                {
                    // 标签对/其它容器内部还可能再有备注标记，递归下去
                    CollectMarkerComments(nested, acc);
                }
            }
        }

        private static IEnumerable<IComment> Dedupe(List<IComment> comments)
        {
            var seen = new HashSet<string>();
            foreach (var c in comments)
            {
                var key = c.Author + "|" + c.Date.Ticks + "|" + c.Text;
                if (seen.Add(key))
                {
                    yield return c;
                }
            }
        }

        /// <summary>
        /// 当前活动文件的名字，用来做窗口标题。取不到就当没有——标题回落到产品名。
        /// 文档关闭过程中 ActiveFile 可能抛，别让它冒到事件处理器里。
        /// </summary>
        private static string ReadDocumentName(IStudioDocument document)
        {
            try
            {
                return document.ActiveFile?.Name;
            }
            catch (Exception ex)
            {
                Trace.Write("ReadDocumentName failed: " + ex.Message);
                return null;
            }
        }

        private static string MapSeverity(Severity severity)
        {
            switch (severity)
            {
                case Severity.High:
                    return "high";
                case Severity.Medium:
                    return "medium";
                case Severity.Low:
                    return "low";
                default:
                    return "undefined";
            }
        }
    }
}
