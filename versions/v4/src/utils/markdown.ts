import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

export function renderMarkdown(text: string): string {
  const parsed = marked.parse(text, { async: false }) as string
  const sanitized = String(DOMPurify.sanitize(parsed))
  const documentFragment = new DOMParser().parseFromString(`<div>${sanitized}</div>`, 'text/html')
  const container = documentFragment.body.firstElementChild
  if (!container) return sanitized

  container.querySelectorAll('pre').forEach((codeBlock) => {
    const button = documentFragment.createElement('button')
    button.type = 'button'
    button.className = 'code-copy-button'
    button.dataset.codeCopy = 'true'
    button.setAttribute('aria-label', '复制代码')
    button.textContent = '复制代码'
    codeBlock.prepend(button)
  })

  return container.innerHTML
}
