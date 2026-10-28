// 协议的唯一事实源。C# 侧 SdlMdComment/CommentReader.cs + Bridge.cs 镜像这里的形状。

/** 严重级别用字符串跨进程传递，别把 C# 枚举漏到前端。 */
export type Severity = 'high' | 'medium' | 'low' | 'undefined'

export interface CommentDto {
  index: number
  text: string
  author: string
  /** ISO 8601 字符串，C# 侧已经格式化好 */
  date: string
  severity: Severity
  version: string
}

export interface SegmentSnapshot {
  /** 当前活动文件名，窗口标题用它 */
  documentName?: string | null
  /** null = 没有打开的文档，或光标还没落进任何句段 */
  segmentId: string | null
  comments: CommentDto[]
}

/** 宿主 → 前端的事件名 */
export const Event = {
  segmentChanged: 'segmentChanged',
} as const

/** 前端 → 宿主的请求名（M2 只用 notify 的 ready，M3 再加 getComments / addComment） */
export const Request = {
  ready: 'ready',
} as const
