import 'github-markdown-css/github-markdown.css'
import 'highlight.js/styles/github.css'
import './style.css'

import { bridge } from './bridge'
import { Event } from './protocol'
import type { CommentDto, SegmentSnapshot, Severity } from './protocol'
import { renderComment } from './render'

const segmentEl = document.getElementById('segment') as HTMLElement
const metaEl = document.getElementById('meta') as HTMLElement
const commentsEl = document.getElementById('comments') as HTMLElement

const severityLabel: Record<Severity, string> = {
  high: '高',
  medium: '中',
  low: '低',
  undefined: '未定级',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso ?? ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 面板里的链接不能把 WebView 导航走，先拦住；外部打开留给 M3 由宿主 Process.Start
function blockNavigation(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) return
  event.preventDefault()
}

function buildCard(comment: CommentDto): HTMLElement {
  const article = document.createElement('article')
  article.className = `comment severity-${comment.severity}`

  const body = document.createElement('div')
  body.className = 'markdown-body'
  body.innerHTML = renderComment(comment.text)
  body.addEventListener('click', blockNavigation)

  const footer = document.createElement('footer')
  footer.className = 'comment-meta'
  footer.textContent = [
    severityLabel[comment.severity] ?? severityLabel.undefined,
    comment.author || '(未知作者)',
    formatDate(comment.date),
  ].join(' · ')

  article.append(body, footer)
  return article
}

function show(snapshot: SegmentSnapshot | null): void {
  commentsEl.replaceChildren()

  if (!snapshot || !snapshot.segmentId) {
    segmentEl.textContent = '—'
    metaEl.textContent = '没有打开的文档，或光标还没落进任何句段'
    return
  }

  segmentEl.textContent = `句段 ${snapshot.segmentId}`

  if (snapshot.comments.length === 0) {
    metaEl.textContent = '本句段没有备注'
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = '在 Studio 里给这个句段加一条备注，切回来就会显示在这里。'
    commentsEl.append(empty)
    return
  }

  metaEl.textContent = `${snapshot.comments.length} 条备注`
  for (const comment of snapshot.comments) {
    commentsEl.append(buildCard(comment))
  }
}

bridge.on<SegmentSnapshot>(Event.segmentChanged, show)

// 告诉宿主"我准备好了"，宿主收到后会把当前句段推过来
bridge.notify('ready')

// 浏览器里直接调 UI 时没有宿主，塞一份样例，免得对着一片空白
if (!bridge.connected) {
  const now = new Date().toISOString()
  show({
    segmentId: '12',
    comments: [
      {
        index: 1,
        text: '# 样例备注\n\n这是 **Markdown** 渲染效果，包含 `inline code`、列表和代码块：\n\n```ts\nconst x: number = 1\n```\n\n| 列 | 值 |\n|---|---|\n| a | 1 |',
        author: 'demo',
        date: now,
        severity: 'high',
        version: '1.0',
      },
      {
        index: 2,
        text: '<!--html--><p>这条走 HTML 直通，<strong>加粗</strong> 生效，<script>alert(1)</script> 会被净化掉。</p>',
        author: 'demo',
        date: now,
        severity: 'low',
        version: '1.0',
      },
    ],
  })
}
