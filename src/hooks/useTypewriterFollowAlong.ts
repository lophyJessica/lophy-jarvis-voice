import { useEffect, useRef, useState } from 'react'

const MIN_CHAR_MS = 24
/** 上限要够大：ASR 约 600ms 才回一次、每次仅 3~4 字，打太快就会「冲一下再干等」 */
const MAX_CHAR_MS = 150
/** 相邻两次 ASR 更新的默认间隔估计（首次没有历史时使用） */
const DEFAULT_GAP_MS = 520
const MIN_GAP_MS = 240
const MAX_GAP_MS = 900

/**
 * 识别区逐字展开。
 *
 * 百度 MID 会回头修订已经出过的字（账→帐、apm→Amber），因此新文本经常
 * 不是旧文本的严格前缀。这种情况**不清空重打**：保持已显示的字数不变，
 * 只把字符原地替换成新版本，再继续向后逐字展开，避免整段闪烁重载。
 */
export function useTypewriterFollowAlong(target: string, enabled: boolean) {
  const [display, setDisplay] = useState('')
  const displayRef = useRef('')
  const targetRef = useRef('')
  const timerRef = useRef(0)
  const lastUpdateAtRef = useRef(0)

  useEffect(() => {
    window.clearInterval(timerRef.current)
    timerRef.current = 0

    if (!enabled) {
      displayRef.current = target
      targetRef.current = target
      setDisplay(target)
      return
    }

    if (!target) {
      displayRef.current = ''
      targetRef.current = ''
      lastUpdateAtRef.current = 0
      setDisplay('')
      return
    }

    if (target === targetRef.current && displayRef.current === target) return

    const now = performance.now()
    const gap = lastUpdateAtRef.current
      ? Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, now - lastUpdateAtRef.current))
      : DEFAULT_GAP_MS
    lastUpdateAtRef.current = now
    targetRef.current = target

    let current = displayRef.current
    if (!target.startsWith(current)) {
      // 已出过的字被 ASR 修订：原地换字，长度不变，不回退也不清空
      current = target.slice(0, Math.min(current.length, target.length))
      displayRef.current = current
      setDisplay(current)
    }

    const suffixLen = target.length - current.length
    if (suffixLen <= 0) return

    // 把本次增量摊到下一次更新到达前展完，读起来才是连续的
    const charMs = Math.max(
      MIN_CHAR_MS,
      Math.min(MAX_CHAR_MS, Math.floor((gap * 0.95) / suffixLen)),
    )

    timerRef.current = window.setInterval(() => {
      const cur = displayRef.current
      if (!target.startsWith(cur) || cur.length >= target.length) {
        displayRef.current = target
        setDisplay(target)
        window.clearInterval(timerRef.current)
        timerRef.current = 0
        return
      }
      const next = target.slice(0, cur.length + 1)
      displayRef.current = next
      setDisplay(next)
    }, charMs)

    return () => {
      window.clearInterval(timerRef.current)
      timerRef.current = 0
    }
  }, [target, enabled])

  return enabled ? display : target
}
