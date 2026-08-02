export async function copyTextToClipboard(text: string) {
  if (!text) return false

  const isLocalQa = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const forceFallback = isLocalQa && new URLSearchParams(window.location.search).has('clipboard-fallback')

  if (!forceFallback && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Incognito and restrictive permission modes may reject Clipboard API writes.
    }
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
    copied = document.execCommand('copy')
  } finally {
    fallbackTextArea.remove()
    activeElement?.focus({ preventScroll: true })
  }
  return copied
}
