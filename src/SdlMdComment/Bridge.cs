namespace SdlMdComment
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Web.Script.Serialization;

    /// <summary>
    /// WebView2 消息与 JSON-RPC 之间的转换。
    /// 字段名用 camelCase —— 和 ui/src/protocol.ts 的 TS 接口对齐，跨语言以那一侧为准。
    /// M2 只有"宿主推事件 + 前端发 ready"；M3 再把 getComments / addComment 的请求分发补上。
    /// </summary>
    internal static class Bridge
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        public static string SegmentChanged(SegmentSnapshot snapshot)
        {
            var payload = new Dictionary<string, object>
            {
                ["jsonrpc"] = "2.0",
                ["method"] = "segmentChanged",
                ["params"] = new Dictionary<string, object>
                {
                    ["documentName"] = snapshot.DocumentName,
                    ["segmentId"] = snapshot.SegmentId,
                    ["comments"] = snapshot.Comments.Select(ToPayload).ToArray(),
                },
            };

            return Json.Serialize(payload);
        }

        /// <summary>只取 method：M2 前端只发 ready 这种通知，不需要完整分发。</summary>
        public static string ReadMethod(string json)
        {
            try
            {
                var message = Json.DeserializeObject(json) as Dictionary<string, object>;
                if (message != null && message.TryGetValue("method", out var method))
                {
                    return method as string;
                }
            }
            catch (Exception ex)
            {
                Trace.Write("bridge: 解析消息失败 " + ex.Message);
            }

            return null;
        }

        private static Dictionary<string, object> ToPayload(CommentDto comment)
        {
            return new Dictionary<string, object>
            {
                ["index"] = comment.Index,
                ["text"] = comment.Text,

                // 日期在这里就格式化成 ISO，别让 DataContract/JavaScript 序列化器自己发明格式
                ["date"] = comment.Date.ToString("o"),
                ["author"] = comment.Author ?? string.Empty,
                ["severity"] = comment.Severity,
                ["version"] = comment.Version ?? string.Empty,
            };
        }
    }
}
