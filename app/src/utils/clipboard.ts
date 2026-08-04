function runCopyCommand(text: string) {
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', text)
  }
  document.addEventListener('copy', handleCopy)
  try {
    return document.execCommand('copy')
  } finally {
    document.removeEventListener('copy', handleCopy)
  }
}

function copyWithExecCommand(text: string, sourceElement?: HTMLTextAreaElement | null) {
  if (sourceElement && sourceElement.value === text) {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const selectionStart = sourceElement.selectionStart
    const selectionEnd = sourceElement.selectionEnd
    sourceElement.focus({ preventScroll: true })
    sourceElement.select()

    let copied = false
    try {
      copied = runCopyCommand(text)
    } finally {
      sourceElement.setSelectionRange(selectionStart, selectionEnd)
      activeElement?.focus({ preventScroll: true })
    }
    return copied
  }

  const fallbackTextArea = document.createElement('textarea')
  fallbackTextArea.value = text
  fallbackTextArea.readOnly = true
  fallbackTextArea.tabIndex = -1
  fallbackTextArea.setAttribute('aria-hidden', 'true')
  fallbackTextArea.style.position = 'fixed'
  fallbackTextArea.style.top = '-9999px'
  fallbackTextArea.style.left = '-9999px'
  fallbackTextArea.style.width = '1px'
  fallbackTextArea.style.height = '1px'
  fallbackTextArea.style.opacity = '0'

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.body.appendChild(fallbackTextArea)
  fallbackTextArea.focus({ preventScroll: true })
  fallbackTextArea.select()
  fallbackTextArea.setSelectionRange(0, fallbackTextArea.value.length)

  let copied = false
  try {
    copied = runCopyCommand(text)
  } finally {
    fallbackTextArea.remove()
    activeElement?.focus({ preventScroll: true })
  }
  return copied
}

export async function copyTextToClipboard(text: string, sourceElement?: HTMLTextAreaElement | null) {
  if (!text) return false

  const isLocalQa = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const forceFallback = isLocalQa && new URLSearchParams(window.location.search).has('clipboard-fallback')
  let clipboardWrite: Promise<void> | null = null

  if (!forceFallback && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      clipboardWrite = navigator.clipboard.writeText(text)
    } catch {
      clipboardWrite = null
    }
  }

  // Run the fallback before the click's transient user activation expires.
  const fallbackCopied = copyWithExecCommand(text, sourceElement)
  if (!clipboardWrite) return fallbackCopied

  try {
    await clipboardWrite
    return true
  } catch {
    return fallbackCopied
  }
}
