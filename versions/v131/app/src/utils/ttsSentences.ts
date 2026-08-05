const SENTENCE_END_CHARS = new Set(['。', '！', '？', '；', '…', '\n', '.', '!', '?'])

/** 略缩短单句，降低 /tts 生成耗时，减轻句间空档 */
const MAX_SENTENCE_LENGTH = 42
/** 首段更短，加快首包 /tts 生成（点击后尽快出声） */
const FIRST_SNIPPET_MAX = 14
const FIRST_SNIPPET_MIN = 4
const FIRST_BREAK_CHARS = /[。！？；…，、,.!?;\n]/

export function cleanSpeechText(text: string) {
  return text.replace(/[#*_`>]/g, '').replaceAll('[', '').replaceAll(']', '').replace(/\s+/g, ' ').trim()
}

/**
 * 将第一句再切一小段优先送去 TTS，其余保持原序。
 * 取窗口内【最早】标点，避免切到接近上限的句号导致首段仍偏长。
 */
export function prioritizeFirstSnippet(sentences: string[]): string[] {
  if (sentences.length === 0) return sentences
  const first = sentences[0] ?? ''
  if (first.length <= FIRST_SNIPPET_MAX) return sentences

  let splitAt = -1
  const searchEnd = Math.min(FIRST_SNIPPET_MAX, first.length)
  for (let index = FIRST_SNIPPET_MIN; index < searchEnd; index += 1) {
    if (FIRST_BREAK_CHARS.test(first[index] ?? '')) {
      splitAt = index + 1
      break
    }
  }
  if (splitAt <= 0) {
    for (let index = FIRST_SNIPPET_MIN; index < searchEnd; index += 1) {
      if (/[\s]/.test(first[index] ?? '')) {
        splitAt = index + 1
        break
      }
    }
  }
  if (splitAt <= 0) splitAt = searchEnd

  const head = first.slice(0, splitAt).trim()
  const tail = first.slice(splitAt).trim()
  if (!head) return sentences
  const rest = sentences.slice(1)
  return tail ? [head, tail, ...rest] : [head, ...rest]
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
