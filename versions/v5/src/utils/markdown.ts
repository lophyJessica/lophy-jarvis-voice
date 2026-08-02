import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

export function renderMarkdown(text: string): string {
  const parsed = marked.parse(text, { async: false }) as string
  const parsedDocument = new DOMParser().parseFromString(`<div>${parsed}</div>`, 'text/html')
  const parsedContainer = parsedDocument.body.firstElementChild
  if (!parsedContainer) return ''

  const interactiveSelector = 'form, textarea, input, select, button'
  const interactiveElements = Array.from(parsedContainer.querySelectorAll(interactiveSelector))
    .filter((element) => !element.parentElement?.closest(interactiveSelector))
  interactiveElements.forEach((element) => {
    const codeBlock = parsedDocument.createElement('pre')
    const code = parsedDocument.createElement('code')
    code.className = 'language-html'
    code.textContent = element.outerHTML
    codeBlock.appendChild(code)
    element.replaceWith(codeBlock)
  })

  const sanitized = String(DOMPurify.sanitize(parsedContainer.innerHTML, {
    FORBID_TAGS: ['form', 'textarea', 'input', 'select', 'option', 'button'],
  }))
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
