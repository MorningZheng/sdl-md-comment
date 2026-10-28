// 消息之上的极简 JSON-RPC：id 关联 Promise、method 分发事件。
// 传输层是 WebView2 的 postMessage；没有宿主（普通浏览器 / vite dev）时 call 会 reject、notify 静默丢弃，
// 方便直接用浏览器调 UI。

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

interface WebViewHost {
  postMessage(message: unknown): void
  addEventListener(type: 'message', handler: (e: { data: unknown }) => void): void
}

type Handler = (params: unknown) => void

const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const handlers = new Map<string, Handler>()
let nextId = 1

function host(): WebViewHost | null {
  const w = window as unknown as { chrome?: { webview?: WebViewHost } }
  return w.chrome?.webview ?? null
}

function dispatch(message: JsonRpcMessage): void {
  // 有 id 没 method = 宿主对我们请求的应答
  if (message.id !== undefined && message.method === undefined) {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
    return
  }

  if (message.method) {
    handlers.get(message.method)?.(message.params)
  }
}

host()?.addEventListener('message', (e) => dispatch(e.data as JsonRpcMessage))

export const bridge = {
  /** 前端 → 宿主，等结果 */
  call<T>(method: string, params?: unknown): Promise<T> {
    const t = host()
    if (!t) return Promise.reject(new Error('bridge: 没有宿主（浏览器调试模式）'))

    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      t.postMessage({ jsonrpc: '2.0', id, method, params })
    })
  },

  /** 前端 → 宿主，不等结果 */
  notify(method: string, params?: unknown): void {
    host()?.postMessage({ jsonrpc: '2.0', method, params })
  },

  /** 宿主 → 前端事件 */
  on<T>(method: string, handler: (params: T) => void): void {
    handlers.set(method, handler as Handler)
  },

  get connected(): boolean {
    return host() !== null
  },
}
