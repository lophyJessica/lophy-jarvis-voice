const SENTENCE_END_CHARS = new Set(['。', '！', '？', '；', '…', '\n', '.', '!', '?'])

const MAX_SENTENCE_LENGTH = 50

export function cleanSpeechText(text: string) {
  return text.replace(/[#*_`>]/g, '').replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').trim()
}

function splitOversizedSentence(sentence: string): string[] {
  const trimmed = sentence.trim()
  if (!trimmed) return []
  if (trimmed.length <= MAX_SENTENCE_LENGTH) return [trimmed]

  const parts: string[] = []
  let rest = trimmed
  while (rest.length > MAX_SENTENCE_LENGTH) {
    let splitAt = -1
    for (let index = Math.min(MAX_SENTENCE_LENGTH, rest.length) - 1; index >= 12; index -= 1) {
      if (/[，,、\s]/.test(rest[index] ?? '')) {
        splitAt = index + 1
        break
      }
    }
    if (splitAt <= 0) splitAt = MAX_SENTENCE_LENGTH
    const chunk = rest.slice(0, splitAt).trim()
    if (chunk) parts.push(chunk)
    rest = rest.slice(splitAt).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

export function extractCompleteSentences(buffer: string, finalize = false): { complete: string[]; remainder: string } {
  const complete: string[] = []
  let current = ''

  for (const char of buffer) {
    current += char
    if (SENTENCE_END_CHARS.has(char)) {
      const cleaned = cleanSpeechText(current)
      if (cleaned) complete.push(...splitOversizedSentence(cleaned))
      current = ''
    }
  }

  let remainder = current
  if (finalize) {
    const cleaned = cleanSpeechText(remainder)
    if (cleaned) complete.push(...splitOversizedSentence(cleaned))
    remainder = ''
  }

  return { complete, remainder }
}
