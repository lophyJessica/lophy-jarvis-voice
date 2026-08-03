import { useEffect, useRef, useState } from 'react'

const MIN_CHAR_MS = 30
const MAX_CHAR_MS = 42
/** 单块 ASR 增量展完预算：略快以贴近跟嘴体感 */
const CATCH_UP_BUDGET_MS = 1_800

/**
 * 识别区逐字展开：ASR 按句/块返回时，UI 对新增后缀逐字露出（非整句瞬间铺满）。
 */
export function useTypewriterFollowAlong(target: string, enabled: boolean) {
  const [display, setDisplay] = useState('')
  const displayRef = useRef('')
  const targetRef = useRef('')
  const timerRef = useRef(0)

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
      setDisplay('')
      return
    }

    if (target === targetRef.current && displayRef.current === target) return
    targetRef.current = target

    let current = displayRef.current
    if (!target.startsWith(current)) {
      let prefix = 0
      while (prefix < current.length && prefix < target.length && current[prefix] === target[prefix]) {
        prefix += 1
      }
      current = target.slice(0, prefix)
      displayRef.current = current
      setDisplay(current)
    }

    const suffixLen = target.length - current.length
    if (suffixLen <= 0) return

    const charMs = Math.max(
      MIN_CHAR_MS,
      Math.min(MAX_CHAR_MS, Math.floor(CATCH_UP_BUDGET_MS / suffixLen)),
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
