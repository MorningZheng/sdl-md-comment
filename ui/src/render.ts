import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'

/**
 * HTML 直通约定：备注文本以这个注释开头就按 HTML 渲染，否则按 Markdown。
 * 纯文本天然是合法 Markdown，所以原生备注无损兼容。
 */
const HTML_PREFIX = '<!--html-->'

function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const md = new MarkdownIt({
  // 备注里允许直写 HTML（这是需求的一部分），最终一律过 DOMPurify
  html: true,
  linkify: true,
  breaks: false,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        // 落到下面的纯转义
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`
  },
})

/** 统一在这里净化：Markdown 渲染出的 HTML、以及直通的 HTML 走同一条路。 */
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  })
}

export function isHtmlComment(text: string): boolean {
  return (text ?? '').trimStart().startsWith(HTML_PREFIX)
}

/** 一条备注 → 净化后的 HTML 片段 */
export function renderComment(text: string): string {
  const raw = text ?? ''

  if (isHtmlComment(raw)) {
    const body = raw.trimStart().slice(HTML_PREFIX.length)
    return sanitize(body)
  }

  return sanitize(md.render(raw))
}
