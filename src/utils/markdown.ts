import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

function createCopyButton(documentFragment: Document, label: string) {
  const button = documentFragment.createElement('button')
  button.type = 'button'
  button.className = 'code-copy-button'
  button.dataset.codeCopy = 'true'
  button.setAttribute('aria-label', label)
  button.title = label
  button.innerHTML = '<span class="copy-glyph" aria-hidden="true"></span>'
  return button
}

export function renderMarkdown(text: string): string {
  const parsed = marked.parse(text, { async: false }) as string
  const parsedDocument = new DOMParser().parseFromString(`<div>${parsed}</div>`, 'text/html')
  const parsedContainer = parsedDocument.body.firstElementChild
  if (!parsedContainer) return ''

  Array.from(parsedContainer.querySelectorAll('textarea'))
    .filter((textArea) => !textArea.closest('form'))
    .forEach((textArea) => {
      const renderedTextArea = parsedDocument.createElement('div')
      renderedTextArea.className = 'rendered-textarea'
      renderedTextArea.dataset.renderedTextArea = 'true'
      renderedTextArea.setAttribute('role', 'group')
      renderedTextArea.setAttribute('aria-label', '文本内容')
      const content = parsedDocument.createElement('div')
      content.className = 'rendered-textarea-content'
      content.textContent = textArea.textContent
      renderedTextArea.appendChild(content)
      textArea.replaceWith(renderedTextArea)
    })

  const interactiveSelector = 'form, input, select, button'
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
    codeBlock.prepend(createCopyButton(documentFragment, '复制代码'))
  })
  container.querySelectorAll('.rendered-textarea').forEach((textArea) => {
    textArea.prepend(createCopyButton(documentFragment, '复制文本内容'))
  })

  return container.innerHTML
}
